import {
  checkPuppeteerBrowserLaunch,
  checkSharpNativeOperation,
  probeRuntimeDatabaseReadOnly,
  runRuntimePreflightChecks,
  RuntimePreflightError,
  RUNTIME_PREFLIGHT_SCHEMA_VERSION,
} from './runtimePreflightChecks.js';
import {
  createRuntimeDatabase,
  loadRuntimeEnvironment,
  readRuntimeDatabaseConfiguration,
  RuntimeDatabaseConfigurationError,
} from './runtimeDatabase.js';

const writeJson = (stream: NodeJS.WriteStream, value: unknown): void => {
  stream.write(`${JSON.stringify(value)}\n`);
};

async function run(): Promise<void> {
  loadRuntimeEnvironment();
  const result = await runRuntimePreflightChecks({
    env: process.env,
    operations: {
      probeDatabaseReadOnly: async () => {
        const configuration = readRuntimeDatabaseConfiguration(process.env, { requirePassword: true });
        const database = createRuntimeDatabase(configuration);
        try {
          await probeRuntimeDatabaseReadOnly(database);
        } finally {
          await database.close();
        }
      },
      checkSharpNativeOperation,
      checkPuppeteerBrowserLaunch,
    },
  });
  writeJson(process.stdout, result);
}

run().catch((error: unknown) => {
  let code = 'RUNTIME_PREFLIGHT_FAILED';
  let details: Readonly<{ missing?: string[]; invalid?: string[] }> | undefined;
  if (error instanceof RuntimePreflightError) {
    code = error.code;
    details = error.details;
  } else if (error instanceof RuntimeDatabaseConfigurationError) {
    code = 'PRODUCTION_DATABASE_CONFIGURATION_INVALID';
    details = { missing: error.missing, invalid: error.invalid };
  }
  writeJson(process.stderr, {
    schemaVersion: RUNTIME_PREFLIGHT_SCHEMA_VERSION,
    kind: 'omnilodge-backend-runtime-preflight',
    ok: false,
    error: {
      code,
      ...(details ? { details } : {}),
    },
  });
  process.exitCode = 1;
});
