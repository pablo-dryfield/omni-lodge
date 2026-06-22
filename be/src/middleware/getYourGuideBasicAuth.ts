import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import { getConfigValue } from '../services/configService.js';

type CredentialPair = {
  username: string;
  password: string;
};

const REALM = 'GetYourGuide Supplier API';

const readConfiguredPair = (usernameKey: string, passwordKey: string): CredentialPair | null => {
  const username = String(getConfigValue(usernameKey) ?? '').trim();
  const password = String(getConfigValue(passwordKey) ?? '').trim();

  if (!username || !password) {
    return null;
  }

  return { username, password };
};

const readBasicAuthHeader = (authorizationHeader: string | undefined): CredentialPair | null => {
  if (!authorizationHeader || !authorizationHeader.toLowerCase().startsWith('basic ')) {
    return null;
  }

  try {
    const decoded = Buffer.from(authorizationHeader.slice(6).trim(), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex <= 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
};

const timingSafeEqualString = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const matchesConfiguredPair = (candidate: CredentialPair, configured: CredentialPair | null): boolean => {
  if (!configured) {
    return false;
  }

  return (
    timingSafeEqualString(candidate.username, configured.username) &&
    timingSafeEqualString(candidate.password, configured.password)
  );
};

const sendChallenge = (res: Response): void => {
  res.setHeader('WWW-Authenticate', `Basic realm="${REALM}"`);
  res.status(401).json({ error: 'Unauthorized' });
};

export const getYourGuideBasicAuthMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const candidate = readBasicAuthHeader(req.headers.authorization);
  if (!candidate) {
    sendChallenge(res);
    return;
  }

  const testingCredentials = readConfiguredPair(
    'GYG_TEST_SUPPLIER_API_USERNAME',
    'GYG_TEST_SUPPLIER_API_PASSWORD',
  );
  const productionCredentials = readConfiguredPair(
    'GYG_PROD_SUPPLIER_API_USERNAME',
    'GYG_PROD_SUPPLIER_API_PASSWORD',
  );

  if (
    !matchesConfiguredPair(candidate, testingCredentials) &&
    !matchesConfiguredPair(candidate, productionCredentials)
  ) {
    sendChallenge(res);
    return;
  }

  next();
};

