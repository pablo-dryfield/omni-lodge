import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { google } from 'googleapis';
import HttpError from '../errors/HttpError.js';
import { getConfigValue, updateConfigValue } from './configService.js';

type GoogleCredentialKey = 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET' | 'GOOGLE_REFRESH_TOKEN';

export type GoogleApiAccessStatus = {
  configured: Record<GoogleCredentialKey, boolean>;
  missingKeys: GoogleCredentialKey[];
  scopes: string[];
  rawScope: string | null;
  refreshedAt: string;
  expiresAt: string | null;
  audience: string | null;
};

export type GoogleOAuthScopeCatalogEntry = {
  api: string;
  version: string | null;
  scope: string;
  description: string;
  documentationUrl: string | null;
};

export type GoogleOAuthScopeCatalog = {
  scopes: GoogleOAuthScopeCatalogEntry[];
  sourceUrl: string;
  fetchedAt: string;
};

export type GoogleOAuthAuthorizationStart = {
  authorizationUrl: string;
  redirectUri: string;
  scopes: string[];
};

export type GoogleOAuthCompletionResult = {
  scopes: string[];
  missingRequestedScopes: string[];
  rawScope: string | null;
  refreshTokenUpdated: boolean;
  expiresAt: string | null;
};

type GoogleOAuthStatePayload = {
  actorId: number;
  scopes: string[];
  redirectUri: string;
  returnUrl: string;
  nonce: string;
  iat: number;
};

const CREDENTIAL_KEYS: GoogleCredentialKey[] = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
];

const GOOGLE_SCOPE_CATALOG_URL = 'https://developers.google.com/identity/protocols/oauth2/scopes?hl=en';
const SCOPE_CATALOG_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const OAUTH_STATE_MAX_AGE_MS = 30 * 60 * 1000;

let scopeCatalogCache: { value: GoogleOAuthScopeCatalog; expiresAt: number } | null = null;

const readConfigString = (key: GoogleCredentialKey): string | null => {
  const value = getConfigValue(key);
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readRequiredConfigString = (key: GoogleCredentialKey): string => {
  const value = readConfigString(key);
  if (!value) {
    throw new HttpError(400, `${key} is required.`);
  }
  return value;
};

const normalizeScopes = (scopes: unknown): string[] => {
  if (!Array.isArray(scopes)) {
    throw new HttpError(400, 'scopes must be an array.');
  }
  const normalized = scopes
    .map((scope) => (typeof scope === 'string' ? scope.trim() : ''))
    .filter((scope) => scope.length > 0);
  const invalid = normalized.find((scope) => !/^https?:\/\/[^\s]+$/.test(scope));
  if (invalid) {
    throw new HttpError(400, `Invalid Google OAuth scope: ${invalid}`);
  }
  return Array.from(new Set(normalized)).sort((left, right) => left.localeCompare(right));
};

const getStateSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new HttpError(500, 'JWT_SECRET is required to sign Google OAuth state.');
  }
  return secret;
};

const encodeBase64Url = (value: string): string => Buffer.from(value, 'utf-8').toString('base64url');

const decodeBase64Url = (value: string): string => Buffer.from(value, 'base64url').toString('utf-8');

const signPayload = (encodedPayload: string): string =>
  createHmac('sha256', getStateSecret()).update(encodedPayload).digest('base64url');

const encodeState = (payload: GoogleOAuthStatePayload): string => {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
};

const decodeState = (state: string): GoogleOAuthStatePayload => {
  const [encodedPayload, signature] = state.split('.');
  if (!encodedPayload || !signature) {
    throw new HttpError(400, 'Invalid Google OAuth state.');
  }

  const expectedSignature = signPayload(encodedPayload);
  const providedBuffer = Buffer.from(signature, 'base64url');
  const expectedBuffer = Buffer.from(expectedSignature, 'base64url');
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw new HttpError(400, 'Invalid Google OAuth state signature.');
  }

  const payload = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<GoogleOAuthStatePayload>;
  if (
    typeof payload.actorId !== 'number' ||
    !Array.isArray(payload.scopes) ||
    typeof payload.redirectUri !== 'string' ||
    typeof payload.returnUrl !== 'string' ||
    typeof payload.nonce !== 'string' ||
    typeof payload.iat !== 'number'
  ) {
    throw new HttpError(400, 'Invalid Google OAuth state payload.');
  }
  if (Date.now() - payload.iat > OAUTH_STATE_MAX_AGE_MS) {
    throw new HttpError(400, 'Google OAuth state expired.');
  }
  return payload as GoogleOAuthStatePayload;
};

const buildOauthClient = (redirectUri: string) => {
  const clientId = readRequiredConfigString('GOOGLE_CLIENT_ID');
  const clientSecret = readRequiredConfigString('GOOGLE_CLIENT_SECRET');
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
};

export const getGoogleApiAccessStatus = async (): Promise<GoogleApiAccessStatus> => {
  const values = CREDENTIAL_KEYS.reduce<Record<GoogleCredentialKey, string | null>>(
    (acc, key) => {
      acc[key] = readConfigString(key);
      return acc;
    },
    {
      GOOGLE_CLIENT_ID: null,
      GOOGLE_CLIENT_SECRET: null,
      GOOGLE_REFRESH_TOKEN: null,
    },
  );

  const configured = CREDENTIAL_KEYS.reduce<Record<GoogleCredentialKey, boolean>>(
    (acc, key) => {
      acc[key] = Boolean(values[key]);
      return acc;
    },
    {
      GOOGLE_CLIENT_ID: false,
      GOOGLE_CLIENT_SECRET: false,
      GOOGLE_REFRESH_TOKEN: false,
    },
  );
  const missingKeys = CREDENTIAL_KEYS.filter((key) => !values[key]);

  if (missingKeys.length > 0) {
    return {
      configured,
      missingKeys,
      scopes: [],
      rawScope: null,
      refreshedAt: new Date().toISOString(),
      expiresAt: null,
      audience: null,
    };
  }

  const clientId = values.GOOGLE_CLIENT_ID;
  const clientSecret = values.GOOGLE_CLIENT_SECRET;
  const refreshToken = values.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new HttpError(400, 'Google API OAuth credentials are incomplete.', { missingKeys });
  }

  const oauthClient = new google.auth.OAuth2(clientId, clientSecret);
  oauthClient.setCredentials({ refresh_token: refreshToken });

  const accessTokenResponse = await oauthClient.getAccessToken();
  const accessToken =
    typeof accessTokenResponse === 'string' ? accessTokenResponse : accessTokenResponse?.token ?? null;

  if (!accessToken) {
    throw new HttpError(502, 'Google did not return an access token for the configured refresh token.');
  }

  const tokenInfo = await oauthClient.getTokenInfo(accessToken);
  const info = tokenInfo as {
    aud?: string;
    audience?: string;
    expiry_date?: number;
    scopes?: string[];
  };
  const scopes = Array.isArray(info.scopes)
    ? Array.from(new Set(info.scopes.map((scope) => scope.trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      )
    : [];

  return {
    configured,
    missingKeys,
    scopes,
    rawScope: scopes.length > 0 ? scopes.join(' ') : null,
    refreshedAt: new Date().toISOString(),
    expiresAt:
      typeof info.expiry_date === 'number' && Number.isFinite(info.expiry_date)
        ? new Date(info.expiry_date).toISOString()
        : null,
    audience: info.audience ?? info.aud ?? null,
  };
};

const decodeHtml = (value: string): string =>
  value
    .replace(/&#(\d+);/g, (_match, codePoint: string) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, codePoint: string) => String.fromCodePoint(parseInt(codePoint, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');

const stripHtml = (value: string): string =>
  decodeHtml(value.replace(/<wbr\s*\/?>/gi, '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const extractDocumentationUrl = (headingHtml: string): string | null => {
  const hrefMatch = headingHtml.match(/<a\b[^>]*href="([^"]+)"/i);
  return hrefMatch ? decodeHtml(hrefMatch[1]) : null;
};

const parseApiTitle = (title: string): { api: string; version: string | null } => {
  const match = title.match(/^(.*?),\s*(v[^,]+)$/i);
  if (!match) {
    return { api: title.trim(), version: null };
  }
  return {
    api: match[1].trim(),
    version: match[2].trim(),
  };
};

const parseGoogleScopeCatalog = (html: string, fetchedAt: string): GoogleOAuthScopeCatalog => {
  const entries: GoogleOAuthScopeCatalogEntry[] = [];
  const seen = new Set<string>();
  const sectionPattern = /<section\b[^>]*>([\s\S]*?)<\/section>/gi;
  let sectionMatch: RegExpExecArray | null;

  while ((sectionMatch = sectionPattern.exec(html)) !== null) {
    const sectionHtml = sectionMatch[1];
    const headingMatch = sectionHtml.match(/<h2\b[^>]*data-text="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/i);
    if (!headingMatch) {
      continue;
    }

    const title = decodeHtml(headingMatch[1]).trim();
    const { api, version } = parseApiTitle(title);
    const documentationUrl = extractDocumentationUrl(headingMatch[2]);
    const rowPattern = /<tr\b[^>]*>\s*<td\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowPattern.exec(sectionHtml)) !== null) {
      const scope = stripHtml(rowMatch[1]);
      if (!scope.startsWith('http')) {
        continue;
      }
      const description = stripHtml(rowMatch[2]);
      const key = `${api}::${version ?? ''}::${scope}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push({
        api,
        version,
        scope,
        description,
        documentationUrl,
      });
    }
  }

  entries.sort((left, right) => left.api.localeCompare(right.api) || left.scope.localeCompare(right.scope));

  return {
    scopes: entries,
    sourceUrl: GOOGLE_SCOPE_CATALOG_URL,
    fetchedAt,
  };
};

export const listGoogleOAuthScopeCatalog = async (): Promise<GoogleOAuthScopeCatalog> => {
  const now = Date.now();
  if (scopeCatalogCache && scopeCatalogCache.expiresAt > now) {
    return scopeCatalogCache.value;
  }

  const response = await fetch(GOOGLE_SCOPE_CATALOG_URL, {
    headers: {
      accept: 'text/html',
      'accept-language': 'en',
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status >= 400 && response.status < 500 ? 400 : 502, `Failed to fetch Google OAuth scope catalog: ${response.status}`);
  }

  const html = await response.text();
  const fetchedAt = new Date().toISOString();
  const catalog = parseGoogleScopeCatalog(html, fetchedAt);
  if (catalog.scopes.length === 0) {
    throw new HttpError(502, 'Google OAuth scope catalog did not contain any scopes.');
  }

  scopeCatalogCache = {
    value: catalog,
    expiresAt: now + SCOPE_CATALOG_CACHE_TTL_MS,
  };

  return catalog;
};

export const createGoogleOAuthAuthorizationUrl = (params: {
  actorId: number;
  scopes: unknown;
  redirectUri: string;
  returnUrl: string;
}): GoogleOAuthAuthorizationStart => {
  const scopes = normalizeScopes(params.scopes);
  if (scopes.length === 0) {
    throw new HttpError(400, 'Select at least one Google OAuth scope.');
  }

  const oauthClient = buildOauthClient(params.redirectUri);
  const state = encodeState({
    actorId: params.actorId,
    scopes,
    redirectUri: params.redirectUri,
    returnUrl: params.returnUrl,
    nonce: randomBytes(16).toString('base64url'),
    iat: Date.now(),
  });

  const authorizationUrl = oauthClient.generateAuthUrl({
    access_type: 'offline',
    include_granted_scopes: true,
    prompt: 'consent',
    scope: scopes,
    state,
  } as Parameters<typeof oauthClient.generateAuthUrl>[0] & { include_granted_scopes: boolean });

  return {
    authorizationUrl,
    redirectUri: params.redirectUri,
    scopes,
  };
};

export const completeGoogleOAuthAuthorization = async (params: {
  code: string;
  state: string;
  actorId: number;
}): Promise<GoogleOAuthCompletionResult & { returnUrl: string }> => {
  const payload = decodeState(params.state);
  if (payload.actorId !== params.actorId) {
    throw new HttpError(403, 'Google OAuth callback user does not match the authorization request.');
  }

  const oauthClient = buildOauthClient(payload.redirectUri);
  const { tokens } = await oauthClient.getToken(params.code);
  if (!tokens.access_token) {
    throw new HttpError(502, 'Google did not return an access token.');
  }

  const tokenInfo = await oauthClient.getTokenInfo(tokens.access_token);
  const grantedScopes = Array.isArray(tokenInfo.scopes)
    ? Array.from(new Set(tokenInfo.scopes.map((scope) => scope.trim()).filter(Boolean))).sort((left, right) =>
        left.localeCompare(right),
      )
    : [];
  const grantedScopeSet = new Set(grantedScopes);
  const missingScopes = payload.scopes.filter((scope) => !grantedScopeSet.has(scope));

  if (!tokens.refresh_token) {
    throw new HttpError(400, 'Google did not return a refresh token. No token was saved.');
  }

  await updateConfigValue({
    key: 'GOOGLE_REFRESH_TOKEN',
    value: tokens.refresh_token,
    actorId: params.actorId,
    reason: `Updated by Google OAuth scope authorization for ${payload.scopes.length} scope(s).`,
  });

  return {
    returnUrl: payload.returnUrl,
    scopes: grantedScopes,
    missingRequestedScopes: missingScopes,
    rawScope: grantedScopes.length > 0 ? grantedScopes.join(' ') : null,
    refreshTokenUpdated: true,
    expiresAt:
      typeof tokens.expiry_date === 'number' && Number.isFinite(tokens.expiry_date)
        ? new Date(tokens.expiry_date).toISOString()
        : null,
  };
};
