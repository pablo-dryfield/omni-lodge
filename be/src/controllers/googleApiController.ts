import type { Response } from 'express';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  completeGoogleOAuthAuthorization,
  createGoogleOAuthAuthorizationUrl,
  getGoogleApiAccessStatus,
  listGoogleOAuthScopeCatalog,
} from '../services/googleApiAccessService.js';

const extractExternalStatus = (error: unknown): number | null => {
  const status = (error as { response?: { status?: unknown } })?.response?.status;
  return typeof status === 'number' ? status : null;
};

const getRequestBaseUrl = (req: AuthenticatedRequest): string => {
  const protocol = req.protocol;
  const host = req.get('host');
  if (!host) {
    throw new HttpError(400, 'Request host is required.');
  }
  return `${protocol}://${host}`;
};

const resolveRedirectUri = (req: AuthenticatedRequest): string => `${getRequestBaseUrl(req)}/api/google-api/oauth/callback`;

const resolveReturnUrl = (req: AuthenticatedRequest): string => {
  const origin = req.get('origin');
  const fallbackOrigin = origin ?? getRequestBaseUrl(req);
  const fallback = `${fallbackOrigin}/settings/google-api`;
  const requested = typeof req.body?.returnUrl === 'string' ? req.body.returnUrl.trim() : '';
  if (!requested) {
    return fallback;
  }

  try {
    const parsed = new URL(requested);
    if (origin && parsed.origin !== origin) {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
};

const appendOAuthResult = (
  returnUrl: string,
  status: 'success' | 'error',
  params: Record<string, string | number | boolean | null | undefined>,
): string => {
  const url = new URL(returnUrl);
  url.searchParams.set('googleOAuth', status);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
};

const sendCallbackError = (res: Response, message: string): void => {
  res.status(400).send(`
    <!doctype html>
    <html>
      <head><title>Google OAuth failed</title></head>
      <body style="font-family: system-ui, sans-serif; line-height: 1.5; padding: 24px;">
        <h1>Google OAuth failed</h1>
        <p>${message.replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char] ?? char))}</p>
        <p><a href="/settings/google-api">Return to Google API settings</a></p>
      </body>
    </html>
  `);
};

export const getGoogleApiAccess = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const access = await getGoogleApiAccessStatus();
    res.json({ access });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message, details: error.details }]);
      return;
    }

    const externalStatus = extractExternalStatus(error);
    const message = error instanceof Error ? error.message : 'Failed to inspect Google API access.';
    res.status(externalStatus && externalStatus >= 400 && externalStatus < 500 ? 400 : 502).json([{ message }]);
  }
};

export const getGoogleApiScopes = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const catalog = await listGoogleOAuthScopeCatalog();
    res.json({ catalog });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message, details: error.details }]);
      return;
    }

    const externalStatus = extractExternalStatus(error);
    const message = error instanceof Error ? error.message : 'Failed to load Google OAuth scope catalog.';
    res.status(externalStatus && externalStatus >= 400 && externalStatus < 500 ? 400 : 502).json([{ message }]);
  }
};

export const startGoogleOAuthAuthorization = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = req.authContext?.id;
    if (!actorId) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const result = createGoogleOAuthAuthorizationUrl({
      actorId,
      scopes: req.body?.scopes,
      redirectUri: resolveRedirectUri(req),
      returnUrl: resolveReturnUrl(req),
    });
    res.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message, details: error.details }]);
      return;
    }
    const message = error instanceof Error ? error.message : 'Failed to start Google OAuth authorization.';
    res.status(500).json([{ message }]);
  }
};

export const completeGoogleOAuthCallback = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const actorId = req.authContext?.id;
  if (!actorId) {
    res.status(403).json([{ message: 'Forbidden' }]);
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!code || !state) {
    sendCallbackError(res, 'Google OAuth callback is missing code or state.');
    return;
  }

  try {
    const result = await completeGoogleOAuthAuthorization({ code, state, actorId });
    res.redirect(
      appendOAuthResult(result.returnUrl, 'success', {
        scopeCount: result.scopes.length,
        missingScopeCount: result.missingRequestedScopes.length,
        refreshTokenUpdated: result.refreshTokenUpdated,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google OAuth callback failed.';
    sendCallbackError(res, message);
  }
};
