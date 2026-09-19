import {
  APPLICATION_RUNTIME_MODES,
  buildApplicationRuntimeModePolicy,
  resolveApplicationRuntimeMode,
} from '../applicationRuntimeMode.js';

const safeCandidatePolicy = (overrides: Record<string, unknown> = {}) => ({
  value: APPLICATION_RUNTIME_MODES.deploymentCandidate,
  nodeEnv: 'production',
  skipDbSync: true,
  alterSchema: false,
  seedAccessControl: false,
  ...overrides,
});

describe('application runtime mode', () => {
  it('preserves primary behavior when the transition setting is absent', () => {
    expect(resolveApplicationRuntimeMode(undefined)).toBe('primary');
    expect(buildApplicationRuntimeModePolicy({
      value: undefined,
      nodeEnv: 'development',
      skipDbSync: false,
      alterSchema: true,
      seedAccessControl: true,
    })).toEqual({
      mode: 'primary',
      allowStartupMutations: true,
      allowBackgroundJobs: true,
    });
  });

  it('disables startup mutation and background jobs for a safe deployment candidate', () => {
    expect(buildApplicationRuntimeModePolicy(safeCandidatePolicy())).toEqual({
      mode: 'deployment-candidate',
      allowStartupMutations: false,
      allowBackgroundJobs: false,
    });
  });

  it.each([
    ['non-production environment', { nodeEnv: 'development' }, 'NODE_ENV'],
    ['runtime schema sync', { skipDbSync: false }, 'SKIP_DB_SYNC'],
    ['schema alteration', { alterSchema: true }, 'DB_SYNC_ALTER'],
    ['access-control seeding', { seedAccessControl: true }, 'SEED_ACCESS_CONTROL'],
  ])('rejects candidate mode with %s', (_label, overrides, expected) => {
    expect(() => buildApplicationRuntimeModePolicy(safeCandidatePolicy(overrides)))
      .toThrow(expected);
  });

  it.each(['candidate', 'deploy', 'true', 'primary-candidate'])(
    'fails closed for unknown mode %s',
    (value) => {
      expect(() => resolveApplicationRuntimeMode(value)).toThrow('APP_RUNTIME_MODE is invalid');
    },
  );
});
