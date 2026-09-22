import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export const PRODUCTION_PM2 = Object.freeze({
  executable: '/usr/bin/pm2',
  ecosystemPath: '/etc/omnilodge/ecosystem.production.json',
  runtimeLauncher: '/usr/local/libexec/omnilodge/runtime-launcher.mjs',
  processNames: Object.freeze({
    backend: 'omni-lodge-be',
    'ui-server': 'omni-lodge-ui-server',
  }),
  cwd: '/',
});

const COMPONENTS = Object.freeze(['backend', 'ui-server']);
const PM2_COMMAND_TIMEOUT_MS = 60 * 1000;
const PM2_SAVE_TIMEOUT_MS = 30 * 1000;
const PM2_JLIST_LIMIT_BYTES = 1024 * 1024;

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const validateComponent = (component) => {
  invariant(COMPONENTS.includes(component), `Unsupported PM2 component: ${component}`);
  return component;
};

const commandShape = (args) => Object.freeze({
  executable: PRODUCTION_PM2.executable,
  args: Object.freeze(args),
  cwd: PRODUCTION_PM2.cwd,
});

export const pm2DeleteCommand = (component) => {
  const validated = validateComponent(component);
  return commandShape([
    'delete',
    PRODUCTION_PM2.processNames[validated],
  ]);
};

export const pm2StartCommand = (component) => {
  const validated = validateComponent(component);
  return commandShape([
    'start',
    PRODUCTION_PM2.ecosystemPath,
    '--only',
    PRODUCTION_PM2.processNames[validated],
    '--update-env',
  ]);
};

export const pm2DeleteAllCommand = () => commandShape(['delete', 'all']);

export const pm2JlistCommand = () => commandShape(['jlist']);

export const pm2ResurrectCommand = () => commandShape(['resurrect']);

export const pm2SaveCommand = () => commandShape(['save', '--force']);

export const runPm2Command = async ({
  command,
  timeoutMs = PM2_COMMAND_TIMEOUT_MS,
} = {}) => {
  invariant(command?.executable === PRODUCTION_PM2.executable, 'PM2 command executable must be fixed');
  invariant(Array.isArray(command.args), 'PM2 command arguments must be an array');
  invariant(command.cwd === PRODUCTION_PM2.cwd, 'PM2 command cwd must be fixed');
  const result = await execFile(command.executable, command.args, {
    cwd: command.cwd,
    timeout: timeoutMs,
    maxBuffer: PM2_JLIST_LIMIT_BYTES,
    windowsHide: true,
  });
  return Object.freeze({
    exitCode: 0,
    stdout: result.stdout,
    stderr: result.stderr,
    command: Object.freeze({
      executable: command.executable,
      args: Object.freeze([...command.args]),
      cwd: command.cwd,
    }),
  });
};

const isMissingPm2ProcessError = (error) => {
  const output = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}`;
  return /Process or Namespace .* not found/i.test(output)
    || /process .* not found/i.test(output)
    || /No process found/i.test(output);
};

const commandByteSummary = ({ result, command }) => Object.freeze({
  command: result?.command ?? command,
  stdoutBytes: Buffer.byteLength(result?.stdout ?? '', 'utf8'),
  stderrBytes: Buffer.byteLength(result?.stderr ?? '', 'utf8'),
});

const parseArgs = (value) => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.trim()) return value.trim().split(/\s+/);
  return [];
};

export const parsePm2Jlist = ({
  stdout,
  maximumBytes = PM2_JLIST_LIMIT_BYTES,
} = {}) => {
  invariant(typeof stdout === 'string' && stdout.length > 0, 'PM2 jlist output is empty');
  invariant(Buffer.byteLength(stdout, 'utf8') <= maximumBytes, 'PM2 jlist output exceeds the capture limit');
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error('PM2 jlist output is not JSON', { cause: error });
  }
  invariant(Array.isArray(parsed), 'PM2 jlist output must be an array');
  return Object.freeze(parsed);
};

const processName = (record) => {
  if (typeof record?.name === 'string' && record.name.trim()) return record.name.trim();
  if (typeof record?.pm2_env?.name === 'string' && record.pm2_env.name.trim()) return record.pm2_env.name.trim();
  return null;
};

const validateProcessRecord = ({ record, component }) => {
  const expectedName = PRODUCTION_PM2.processNames[component];
  const name = processName(record);
  invariant(name === expectedName, `${component} PM2 process name is invalid`);
  const env = record.pm2_env;
  invariant(env && typeof env === 'object' && !Array.isArray(env), `${component} PM2 process metadata is missing`);
  invariant(env.status === 'online', `${component} PM2 process is not online`);
  invariant(env.exec_mode === 'fork_mode', `${component} PM2 process is not in fork mode`);
  invariant(env.pm_exec_path === PRODUCTION_PM2.runtimeLauncher, `${component} PM2 script is not the runtime launcher`);
  invariant(env.pm_cwd === PRODUCTION_PM2.cwd, `${component} PM2 cwd is invalid`);
  const args = parseArgs(env.args);
  invariant(args.length === 1 && args[0] === component, `${component} PM2 runtime launcher args are invalid`);
  if (env.watch !== undefined) {
    invariant(env.watch === false || env.watch === null, `${component} PM2 watch mode must be disabled`);
  }
  if (env.instances !== undefined) {
    invariant(Number(env.instances) === 1, `${component} PM2 must have one instance`);
  }
  if (env.autorestart !== undefined) {
    invariant(env.autorestart === true, `${component} PM2 autorestart must be enabled`);
  }
  return Object.freeze({
    component,
    name,
    pmId: Number.isInteger(record.pm_id) ? record.pm_id : null,
    pid: Number.isInteger(record.pid) ? record.pid : null,
    status: env.status,
    execMode: env.exec_mode,
    script: env.pm_exec_path,
    cwd: env.pm_cwd,
    args: Object.freeze(args),
  });
};

export const validatePm2ProcessList = ({
  processes,
  components = COMPONENTS,
  allowUnmanagedProcesses = false,
} = {}) => {
  invariant(Array.isArray(processes), 'PM2 process list must be an array');
  const expectedComponents = components.map(validateComponent);
  const expectedNames = new Map(expectedComponents.map((component) => [
    PRODUCTION_PM2.processNames[component],
    component,
  ]));
  const managed = new Map();
  const unmanaged = [];

  for (const record of processes) {
    const name = processName(record);
    if (!expectedNames.has(name)) {
      unmanaged.push(name ?? '<unnamed>');
      continue;
    }
    invariant(!managed.has(name), `Duplicate PM2 process found: ${name}`);
    managed.set(name, record);
  }

  if (!allowUnmanagedProcesses) {
    invariant(unmanaged.length === 0, `Unexpected PM2 process(es): ${unmanaged.join(', ')}`);
  }

  const summaries = [];
  for (const component of expectedComponents) {
    const expectedName = PRODUCTION_PM2.processNames[component];
    const record = managed.get(expectedName);
    invariant(record, `Missing PM2 process: ${expectedName}`);
    summaries.push(validateProcessRecord({ record, component }));
  }

  return Object.freeze({
    ok: true,
    processCount: processes.length,
    managedProcessCount: summaries.length,
    unmanagedProcessCount: unmanaged.length,
    processes: Object.freeze(summaries),
  });
};

export const createProductionPm2ServiceController = ({
  runner = runPm2Command,
  now = () => new Date(),
} = {}) => {
  const inspect = async ({ allowUnmanagedProcesses = false } = {}) => {
    const command = pm2JlistCommand();
    const result = await runner({
      command,
      timeoutMs: PM2_COMMAND_TIMEOUT_MS,
    });
    const processes = parsePm2Jlist({ stdout: result.stdout });
    const validation = validatePm2ProcessList({
      processes,
      allowUnmanagedProcesses,
    });
    return Object.freeze({
      schemaVersion: 1,
      capturedAtUtc: now().toISOString(),
      command: result.command ?? command,
      validation,
    });
  };

  const deleteComponent = async (component) => {
    const validated = validateComponent(component);
    const command = pm2DeleteCommand(validated);
    try {
      const result = await runner({
        command,
        timeoutMs: PM2_COMMAND_TIMEOUT_MS,
      });
      return Object.freeze({
        component: validated,
        deleted: true,
        ...commandByteSummary({ result, command }),
      });
    } catch (error) {
      if (!isMissingPm2ProcessError(error)) throw error;
      return Object.freeze({
        component: validated,
        deleted: false,
        command,
        stdoutBytes: Buffer.byteLength(error?.stdout ?? '', 'utf8'),
        stderrBytes: Buffer.byteLength(error?.stderr ?? '', 'utf8'),
      });
    }
  };

  const startComponent = async (component) => {
    const validated = validateComponent(component);
    const command = pm2StartCommand(validated);
    const result = await runner({
      command,
      timeoutMs: PM2_COMMAND_TIMEOUT_MS,
    });
    return Object.freeze({
      component: validated,
      startedAtUtc: now().toISOString(),
      ...commandByteSummary({ result, command }),
    });
  };

  const restartComponent = async (component) => {
    const deleteResult = await deleteComponent(component);
    const startResult = await startComponent(component);
    return Object.freeze({
      component: validateComponent(component),
      restartedAtUtc: now().toISOString(),
      strategy: 'delete-and-start',
      delete: deleteResult,
      start: startResult,
    });
  };

  const saveProcessList = async () => {
    const command = pm2SaveCommand();
    const result = await runner({
      command,
      timeoutMs: PM2_SAVE_TIMEOUT_MS,
    });
    return Object.freeze({
      savedAtUtc: now().toISOString(),
      command: result.command ?? command,
      stdoutBytes: Buffer.byteLength(result.stdout ?? '', 'utf8'),
      stderrBytes: Buffer.byteLength(result.stderr ?? '', 'utf8'),
    });
  };

  const restoreSavedProcessList = async () => {
    const deleteCommand = pm2DeleteAllCommand();
    let deleteAll = null;
    try {
      const deleteResult = await runner({
        command: deleteCommand,
        timeoutMs: PM2_COMMAND_TIMEOUT_MS,
      });
      deleteAll = Object.freeze({
        deleted: true,
        ...commandByteSummary({ result: deleteResult, command: deleteCommand }),
      });
    } catch (error) {
      if (!isMissingPm2ProcessError(error)) throw error;
      deleteAll = Object.freeze({
        deleted: false,
        command: deleteCommand,
        stdoutBytes: Buffer.byteLength(error?.stdout ?? '', 'utf8'),
        stderrBytes: Buffer.byteLength(error?.stderr ?? '', 'utf8'),
      });
    }

    const resurrectCommand = pm2ResurrectCommand();
    const resurrectResult = await runner({
      command: resurrectCommand,
      timeoutMs: PM2_COMMAND_TIMEOUT_MS,
    });
    return Object.freeze({
      restoredAtUtc: now().toISOString(),
      deleteAll,
      resurrect: commandByteSummary({
        result: resurrectResult,
        command: resurrectCommand,
      }),
    });
  };

  const restartComponentsInOrder = async ({
    components = COMPONENTS,
    persist = false,
  } = {}) => {
    const restarted = [];
    for (const component of components.map(validateComponent)) {
      restarted.push(await restartComponent(component));
    }
    const inspection = await inspect();
    let save = null;
    if (persist) {
      save = await saveProcessList();
    }
    return Object.freeze({
      schemaVersion: 1,
      restarted: Object.freeze(restarted),
      inspection,
      save,
    });
  };

  return Object.freeze({
    inspect,
    deleteComponent,
    startComponent,
    restartComponent,
    restoreSavedProcessList,
    saveProcessList,
    restartComponentsInOrder,
  });
};
