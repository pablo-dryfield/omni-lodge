export const REQUIRED_DATABASE_ENV = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'] as const;
export const REQUIRED_PRODUCTION_ENV = [
  'DB_PASSWORD',
  'JWT_SECRET',
  'APP_VERSION',
  'GIT_COMMIT_SHA',
] as const;

const RELEASE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,119}$/;
const GIT_SHA = /^[a-f0-9]{40}$/i;
const CANONICAL_RELEASE_ID = /^omnilodge-r[1-9][0-9]*-a[1-9][0-9]*-([0-9a-f]{12})$/;

export type RuntimeConfigurationInspection = Readonly<{
  ok: boolean;
  missing: string[];
  invalid: string[];
}>;

export function inspectRuntimeConfiguration(
  env: NodeJS.ProcessEnv,
  {
    requireProduction = false,
    requireCanonicalRelease = false,
    additionalRequiredNames = [],
  }: {
    requireProduction?: boolean;
    requireCanonicalRelease?: boolean;
    additionalRequiredNames?: readonly string[];
  } = {},
): RuntimeConfigurationInspection {
  const production = env.NODE_ENV?.trim().toLowerCase() === 'production';
  const requiredNames: readonly string[] = production || requireProduction
    ? [...REQUIRED_DATABASE_ENV, ...REQUIRED_PRODUCTION_ENV, ...additionalRequiredNames]
    : [...REQUIRED_DATABASE_ENV, ...additionalRequiredNames];
  const missing = requiredNames.filter((name) => !env[name]?.trim());
  const invalid: string[] = [];

  if (requireProduction && !production) {
    invalid.push('NODE_ENV');
  }
  if (missing.length === 0) {
    if (
      !/^\d+$/.test(env.DB_PORT ?? '')
      || Number(env.DB_PORT) < 1
      || Number(env.DB_PORT) > 65_535
    ) {
      invalid.push('DB_PORT');
    }
    const releaseId = env.APP_VERSION ?? '';
    const gitSha = env.GIT_COMMIT_SHA ?? '';
    if ((production || requireProduction) && !RELEASE_TOKEN.test(releaseId)) {
      invalid.push('APP_VERSION');
    }
    if ((production || requireProduction) && !GIT_SHA.test(gitSha)) {
      invalid.push('GIT_COMMIT_SHA');
    }
    if (requireCanonicalRelease) {
      const match = CANONICAL_RELEASE_ID.exec(releaseId);
      if (!match && !invalid.includes('APP_VERSION')) {
        invalid.push('APP_VERSION');
      }
      if (!/^[0-9a-f]{40}$/.test(gitSha) && !invalid.includes('GIT_COMMIT_SHA')) {
        invalid.push('GIT_COMMIT_SHA');
      }
      if (match && /^[0-9a-f]{40}$/.test(gitSha) && match[1] !== gitSha.slice(0, 12)) {
        invalid.push('APP_VERSION');
      }
    }
  }

  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
  };
}
