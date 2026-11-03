import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile),
  required = process.env.WORKSPACE_LINUX_ISOLATION_REQUIRED === 'true';
const linux = process.platform === 'linux';
const compiled = fileURLToPath(
  new URL(
    '../../be/dist/services/databaseWorkspace/workerLaunch.js',
    import.meta.url,
  ),
);
const fixtureRoot = fileURLToPath(
  new URL('../../.tmp/', import.meta.url),
).replace(/[\\/]$/, '');
let fixture;
async function command(binary, args) {
  return execute(binary, args, { timeout: 40000, maxBuffer: 128 * 1024 });
}
async function systemctl(...args) {
  return command('sudo', ['-n', '/usr/bin/systemctl', ...args]);
}
async function launch(mode) {
  const { systemdWorkerLaunch, linuxProcessStart } = await import(
    pathToFileURL(compiled).href
  );
  const parent =
    mode === 'parent'
      ? spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
          stdio: 'ignore',
        })
      : undefined;
  let parentTimer;
  const pid = parent?.pid || process.pid,
    start = linuxProcessStart(await fs.readFile(`/proc/${pid}/stat`, 'utf8'));
  const unit = `omnilodge-workspace-${process.pid}-${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
  const script = path.join(fixture, `${unit}.mjs`),
    environment = path.join(fixture, 'empty.env');
  await fs.writeFile(environment, '', { mode: 0o600 });
  await fs.writeFile(
    script,
    `import fs from 'node:fs';
    import {linuxWorkerLimits,sameLinuxParent} from ${JSON.stringify(pathToFileURL(compiled).href)};
    const read=f=>fs.readFileSync(f,'utf8');
    console.log(JSON.stringify({resources:linuxWorkerLimits(read('/proc/self/cgroup'),read)}));
    if(${JSON.stringify(mode)}==='memory'){const held=[];setInterval(()=>held.push(Buffer.alloc(8*1024*1024,37)),10);}
    else {setInterval(()=>{if(!sameLinuxParent(${pid},${JSON.stringify(start)},read)){console.log(JSON.stringify({orphanStopped:true}));process.exit(0);}},100);}
  `,
    { mode: 0o600 },
  );
  const plan = systemdWorkerLaunch({
    pid,
    parentStart: start,
    unit,
    script,
    cwd: '/opt/omnilodge/releases/omnilodge-ci-test/be',
    memoryMb: 256,
    cpuPercent: 25,
    artifactDirectory: fixture,
  });
  const args = plan.args
    .filter((value) => value !== '--collect')
    .map((value) =>
      value === '--property=EnvironmentFile=/etc/omnilodge/backend.env'
        ? `--property=EnvironmentFile=${environment}`
        : value,
    );
  args.splice(1, 0, '--pipe');
  try {
    if (parent) parentTimer = setTimeout(() => parent.kill('SIGKILL'), 2000);
    let result;
    try {
      result = await command('sudo', ['-n', plan.executable, ...args]);
    } catch (error) {
      result = error;
    }
    const lines = String(result.stdout || '')
      .trim()
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line));
    assert.deepEqual(lines[0]?.resources, {
      memoryBytes: 256 * 1048576,
      cpuPercent: 25,
      tasks: 64,
    });
    if (mode === 'memory') {
      const state = await systemctl(
        'show',
        unit + '.service',
        '--property=Result',
        '--property=MemoryPeak',
      );
      assert.match(state.stdout, /Result=oom-kill/);
      const peak = Number(/MemoryPeak=(\d+)/.exec(state.stdout)?.[1]);
      assert.ok(
        peak > 0 && peak <= 256 * 1048576 * 1.1,
        `Bounded cgroup peak: ${peak}`,
      );
    } else {
      assert.ok(lines.some((line) => line.orphanStopped === true));
      assert.equal(result.code, undefined);
    }
  } finally {
    clearTimeout(parentTimer);
    parent?.kill('SIGKILL');
    await systemctl('stop', unit + '.service').catch(() => {});
    await systemctl('reset-failed', unit + '.service').catch(() => {});
  }
}
test(
  'real systemd worker caps external Buffer RSS and stops after its exact parent exits',
  { skip: !linux && !required, timeout: 100000 },
  async () => {
    assert.ok(linux, 'Linux resource qualification is required on this runner');
    await command('sudo', [
      '-n',
      '/usr/bin/systemctl',
      'show',
      '--property=Version',
    ]);
    await fs.access(compiled);
    // PrivateTmp intentionally hides host /tmp. Put this synthetic fixture in
    // the ignored checkout directory, outside immutable release paths.
    await fs.mkdir(fixtureRoot, { recursive: true });
    fixture = await fs.mkdtemp(
      path.join(fixtureRoot, 'omnilodge-worker-linux-'),
    );
    try {
      await launch('memory');
      await launch('parent');
    } finally {
      assert.equal(path.dirname(fixture), fixtureRoot);
      assert.ok(path.basename(fixture).startsWith('omnilodge-worker-linux-'));
      await fs.rm(fixture, { recursive: true, force: true });
    }
  },
);
