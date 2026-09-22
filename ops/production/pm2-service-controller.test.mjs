import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRODUCTION_PM2,
  createProductionPm2ServiceController,
  parsePm2Jlist,
  pm2DeleteAllCommand,
  pm2DeleteCommand,
  pm2JlistCommand,
  pm2ResurrectCommand,
  pm2SaveCommand,
  pm2StartCommand,
  validatePm2ProcessList,
} from './libexec/deploy/pm2-service-controller.mjs';

const pm2Record = ({
  component,
  status = 'online',
  script = PRODUCTION_PM2.runtimeLauncher,
  cwd = PRODUCTION_PM2.cwd,
  args = [component],
  execMode = 'fork_mode',
  pmId = component === 'backend' ? 1 : 0,
}) => ({
  name: PRODUCTION_PM2.processNames[component],
  pm_id: pmId,
  pid: 10_000 + pmId,
  pm2_env: {
    name: PRODUCTION_PM2.processNames[component],
    status,
    exec_mode: execMode,
    pm_exec_path: script,
    pm_cwd: cwd,
    args,
    instances: 1,
    autorestart: true,
    watch: false,
  },
});

const validProcessList = () => [
  pm2Record({ component: 'ui-server' }),
  pm2Record({ component: 'backend' }),
];

test('PM2 controller uses fixed Ubuntu PM2 commands and process names', () => {
  assert.deepEqual(pm2DeleteCommand('backend'), {
    executable: '/usr/bin/pm2',
    args: [
      'delete',
      'omni-lodge-be',
    ],
    cwd: '/',
  });
  assert.deepEqual(pm2StartCommand('backend'), {
    executable: '/usr/bin/pm2',
    args: [
      'start',
      '/etc/omnilodge/ecosystem.production.json',
      '--only',
      'omni-lodge-be',
      '--update-env',
    ],
    cwd: '/',
  });
  assert.deepEqual(pm2DeleteCommand('ui-server'), {
    executable: '/usr/bin/pm2',
    args: [
      'delete',
      'omni-lodge-ui-server',
    ],
    cwd: '/',
  });
  assert.deepEqual(pm2StartCommand('ui-server'), {
    executable: '/usr/bin/pm2',
    args: [
      'start',
      '/etc/omnilodge/ecosystem.production.json',
      '--only',
      'omni-lodge-ui-server',
      '--update-env',
    ],
    cwd: '/',
  });
  assert.deepEqual(pm2JlistCommand(), {
    executable: '/usr/bin/pm2',
    args: ['jlist'],
    cwd: '/',
  });
  assert.deepEqual(pm2DeleteAllCommand(), {
    executable: '/usr/bin/pm2',
    args: ['delete', 'all'],
    cwd: '/',
  });
  assert.deepEqual(pm2ResurrectCommand(), {
    executable: '/usr/bin/pm2',
    args: ['resurrect'],
    cwd: '/',
  });
  assert.deepEqual(pm2SaveCommand(), {
    executable: '/usr/bin/pm2',
    args: ['save', '--force'],
    cwd: '/',
  });
});

test('PM2 process-list validation accepts the reviewed fork-mode runtime launcher shape', () => {
  const validation = validatePm2ProcessList({ processes: validProcessList() });
  assert.equal(validation.ok, true);
  assert.equal(validation.processCount, 2);
  assert.deepEqual(
    validation.processes.map((process) => [process.component, process.name, process.script, process.args]),
    [
      ['backend', 'omni-lodge-be', '/usr/local/libexec/omnilodge/runtime-launcher.mjs', ['backend']],
      ['ui-server', 'omni-lodge-ui-server', '/usr/local/libexec/omnilodge/runtime-launcher.mjs', ['ui-server']],
    ],
  );
});

test('PM2 process-list validation fails closed on wrong script, mode, status, duplicates, or extras', () => {
  assert.throws(
    () => validatePm2ProcessList({
      processes: [
        pm2Record({ component: 'backend', script: '/root/omni-lodge/be/node_modules/.bin/ts-node' }),
        pm2Record({ component: 'ui-server' }),
      ],
    }),
    /backend PM2 script is not the runtime launcher/,
  );

  assert.throws(
    () => validatePm2ProcessList({
      processes: [
        pm2Record({ component: 'backend', execMode: 'cluster_mode' }),
        pm2Record({ component: 'ui-server' }),
      ],
    }),
    /backend PM2 process is not in fork mode/,
  );

  assert.throws(
    () => validatePm2ProcessList({
      processes: [
        pm2Record({ component: 'backend', status: 'stopped' }),
        pm2Record({ component: 'ui-server' }),
      ],
    }),
    /backend PM2 process is not online/,
  );

  assert.throws(
    () => validatePm2ProcessList({
      processes: [
        pm2Record({ component: 'backend', pmId: 1 }),
        pm2Record({ component: 'backend', pmId: 2 }),
        pm2Record({ component: 'ui-server' }),
      ],
    }),
    /Duplicate PM2 process found: omni-lodge-be/,
  );

  assert.throws(
    () => validatePm2ProcessList({
      processes: [
        ...validProcessList(),
        { name: 'surprise-worker', pm2_env: { name: 'surprise-worker' } },
      ],
    }),
    /Unexpected PM2 process\(es\): surprise-worker/,
  );
});

test('PM2 jlist parsing is bounded and strict JSON', () => {
  const list = parsePm2Jlist({ stdout: JSON.stringify(validProcessList()) });
  assert.equal(list.length, 2);
  assert.throws(() => parsePm2Jlist({ stdout: '' }), /PM2 jlist output is empty/);
  assert.throws(() => parsePm2Jlist({ stdout: '{bad' }), /PM2 jlist output is not JSON/);
  assert.throws(() => parsePm2Jlist({ stdout: '{}'}), /PM2 jlist output must be an array/);
  assert.throws(
    () => parsePm2Jlist({ stdout: '[]', maximumBytes: 1 }),
    /PM2 jlist output exceeds the capture limit/,
  );
});

test('PM2 controller restarts components in order, validates jlist, and can persist the process list', async () => {
  const calls = [];
  const controller = createProductionPm2ServiceController({
    now: () => new Date('2026-09-22T12:30:00.000Z'),
    runner: async ({ command, timeoutMs }) => {
      calls.push({ command, timeoutMs });
      if (command.args[0] === 'jlist') {
        return {
          command,
          stdout: JSON.stringify(validProcessList()),
          stderr: '',
        };
      }
      return {
        command,
        stdout: 'ok',
        stderr: '',
      };
    },
  });

  const result = await controller.restartComponentsInOrder({ persist: true });
  assert.deepEqual(calls.map((call) => call.command.args), [
    ['delete', 'omni-lodge-be'],
    ['start', '/etc/omnilodge/ecosystem.production.json', '--only', 'omni-lodge-be', '--update-env'],
    ['delete', 'omni-lodge-ui-server'],
    ['start', '/etc/omnilodge/ecosystem.production.json', '--only', 'omni-lodge-ui-server', '--update-env'],
    ['jlist'],
    ['save', '--force'],
  ]);
  assert.deepEqual(result.restarted.map((item) => item.component), ['backend', 'ui-server']);
  assert.deepEqual(result.restarted.map((item) => item.strategy), ['delete-and-start', 'delete-and-start']);
  assert.equal(result.inspection.validation.ok, true);
  assert.equal(result.save.savedAtUtc, '2026-09-22T12:30:00.000Z');
});

test('PM2 controller restores the saved process list by clearing PM2 and resurrecting the dump', async () => {
  const calls = [];
  const controller = createProductionPm2ServiceController({
    now: () => new Date('2026-09-22T12:30:00.000Z'),
    runner: async ({ command, timeoutMs }) => {
      calls.push({ command, timeoutMs });
      return {
        command,
        stdout: 'ok',
        stderr: '',
      };
    },
  });

  const result = await controller.restoreSavedProcessList();
  assert.deepEqual(calls.map((call) => call.command.args), [
    ['delete', 'all'],
    ['resurrect'],
  ]);
  assert.equal(result.restoredAtUtc, '2026-09-22T12:30:00.000Z');
  assert.equal(result.deleteAll.deleted, true);
  assert.equal(result.resurrect.command.args[0], 'resurrect');
});
