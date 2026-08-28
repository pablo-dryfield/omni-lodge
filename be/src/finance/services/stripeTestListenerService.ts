import { execFile, spawn, type ChildProcess } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { delimiter, join } from 'path';
import HttpError from '../../errors/HttpError.js';
import { getConfigValueRaw, updateConfigValue } from '../../services/configService.js';
import logger from '../../utils/logger.js';

const TEST_WEBHOOK_CONFIG_KEY = 'STOREFRONT_STRIPE_TEST_WEBHOOK_SECRET';
const LISTENER_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
].join(',');
const READY_TIMEOUT_MS = 20_000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;

type ListenerState = 'stopped' | 'starting' | 'running' | 'error';
type AuthenticationState = 'unknown' | 'authenticated' | 'awaiting_approval' | 'unauthenticated' | 'error';

export type StripeTestListenerStatus = {
  available: boolean;
  cliInstalled: boolean;
  state: ListenerState;
  pid: number | null;
  startedAt: string | null;
  forwardTo: string;
  secretConfigured: boolean;
  message: string | null;
  authentication: {
    state: AuthenticationState;
    message: string | null;
    browserUrl: string | null;
    verificationCode: string | null;
  };
};

type LoginPayload = {
  browser_url?: unknown;
  verification_code?: unknown;
  next_step?: unknown;
  poll_url?: unknown;
};

let listenerProcess: ChildProcess | null = null;
let listenerState: ListenerState = 'stopped';
let listenerStartedAt: Date | null = null;
let listenerMessage: string | null = null;
let loginProcess: ChildProcess | null = null;
let loginTimeout: NodeJS.Timeout | null = null;
let authenticationState: AuthenticationState = 'unknown';
let authenticationMessage: string | null = null;
let authenticationBrowserUrl: string | null = null;
let authenticationVerificationCode: string | null = null;

export const isStripeTestListenerAllowed = (environment = process.env.NODE_ENV): boolean =>
  environment !== 'production';

const listenerPort = (): number => {
  const parsed = Number(process.env.PORT ?? 3001);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 3001;
};

const listenerForwardUrl = (): string =>
  `http://localhost:${listenerPort()}/api/storefront/webhooks/stripe`;

export const stripeTestListenerArgs = (forwardTo = listenerForwardUrl()): string[] => [
  'listen',
  '--events',
  LISTENER_EVENTS,
  '--forward-to',
  forwardTo,
];

const executableFromPath = (): string | null => {
  const executableNames = process.platform === 'win32' ? ['stripe.exe', 'stripe'] : ['stripe'];
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const name of executableNames) {
      const candidate = join(directory.replace(/^"|"$/g, ''), name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
};

const winGetExecutable = (): string | null => {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null;
  const packageRoot = join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
  if (!existsSync(packageRoot)) return null;

  try {
    const packageDirectory = readdirSync(packageRoot, { withFileTypes: true })
      .find((entry) => entry.isDirectory() && entry.name.startsWith('Stripe.StripeCli_'));
    if (!packageDirectory) return null;
    const candidate = join(packageRoot, packageDirectory.name, 'stripe.exe');
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
};

const stripeExecutable = (): string | null => {
  const configured = process.env.STRIPE_CLI_PATH?.trim();
  if (configured) return existsSync(configured) ? configured : null;
  return executableFromPath() ?? winGetExecutable();
};

const executeStripe = (
  executable: string,
  args: string[],
  timeout = READY_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });

const requireAvailableExecutable = (): string => {
  if (!isStripeTestListenerAllowed()) {
    throw new HttpError(403, 'Stripe CLI controls are available only outside production.');
  }
  const executable = stripeExecutable();
  if (!executable) {
    throw new HttpError(503, 'Stripe CLI is not installed or is not available on the backend PATH.');
  }
  return executable;
};

const parseJsonObject = (output: string): LoginPayload => {
  const firstBrace = output.indexOf('{');
  const lastBrace = output.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new HttpError(502, 'Stripe CLI did not return a valid authentication response.');
  }
  return JSON.parse(output.slice(firstBrace, lastBrace + 1)) as LoginPayload;
};

const pollUrlFromLoginPayload = (payload: LoginPayload): string | null => {
  if (typeof payload.poll_url === 'string' && payload.poll_url.startsWith('https://')) {
    return payload.poll_url;
  }
  if (typeof payload.next_step !== 'string') return null;
  const match = payload.next_step.match(/--complete\s+(?:'([^']+)'|"([^"]+)"|(https:\/\/\S+))/);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
};

const clearLoginTimeout = (): void => {
  if (loginTimeout) clearTimeout(loginTimeout);
  loginTimeout = null;
};

const finishLoginProcess = (state: AuthenticationState, message: string | null): void => {
  clearLoginTimeout();
  loginProcess = null;
  authenticationState = state;
  authenticationMessage = message;
  if (state !== 'awaiting_approval') {
    authenticationBrowserUrl = null;
    authenticationVerificationCode = null;
  }
};

const refreshAuthenticationState = async (executable: string): Promise<void> => {
  if (authenticationState !== 'unknown') return;
  try {
    const result = await executeStripe(executable, ['login', 'list'], 8_000);
    authenticationState = /\*\s+.+\(active\)/.test(`${result.stdout}\n${result.stderr}`)
      ? 'authenticated'
      : 'unauthenticated';
  } catch {
    authenticationState = 'unauthenticated';
  }
};

export const getStripeTestListenerStatus = async (): Promise<StripeTestListenerStatus> => {
  const executable = stripeExecutable();
  if (isStripeTestListenerAllowed() && executable) {
    await refreshAuthenticationState(executable);
  }
  return {
    available: isStripeTestListenerAllowed(),
    cliInstalled: Boolean(executable),
    state: listenerState,
    pid: listenerProcess?.pid ?? null,
    startedAt: listenerStartedAt?.toISOString() ?? null,
    forwardTo: listenerForwardUrl(),
    secretConfigured: Boolean(getConfigValueRaw(TEST_WEBHOOK_CONFIG_KEY)),
    message: listenerMessage,
    authentication: {
      state: authenticationState,
      message: authenticationMessage,
      browserUrl: authenticationBrowserUrl,
      verificationCode: authenticationVerificationCode,
    },
  };
};

export const beginStripeCliAuthentication = async (): Promise<StripeTestListenerStatus> => {
  const executable = requireAvailableExecutable();
  if (loginProcess && authenticationState === 'awaiting_approval') {
    return getStripeTestListenerStatus();
  }

  try {
    const result = await executeStripe(
      executable,
      ['login', '--non-interactive', '--new-session'],
      READY_TIMEOUT_MS,
    );
    const payload = parseJsonObject(`${result.stdout}\n${result.stderr}`);
    const browserUrl = typeof payload.browser_url === 'string' ? payload.browser_url : null;
    const verificationCode = typeof payload.verification_code === 'string' ? payload.verification_code : null;
    const pollUrl = pollUrlFromLoginPayload(payload);
    if (!browserUrl || !verificationCode || !pollUrl) {
      throw new HttpError(502, 'Stripe CLI returned an incomplete authentication response.');
    }

    authenticationState = 'awaiting_approval';
    authenticationMessage = 'Approve the Stripe pairing request in your browser.';
    authenticationBrowserUrl = browserUrl;
    authenticationVerificationCode = verificationCode;

    const child = spawn(executable, ['login', '--complete', pollUrl], { windowsHide: true });
    loginProcess = child;
    child.once('error', () => {
      finishLoginProcess('error', 'Stripe CLI authentication could not be completed.');
    });
    child.once('exit', (code) => {
      if (loginProcess !== child) return;
      finishLoginProcess(
        code === 0 ? 'authenticated' : 'error',
        code === 0 ? 'Stripe CLI authentication completed.' : 'Stripe CLI authentication was not completed.',
      );
    });
    loginTimeout = setTimeout(() => {
      if (loginProcess !== child) return;
      child.kill();
      finishLoginProcess('error', 'Stripe CLI authentication timed out. Start it again to retry.');
    }, LOGIN_TIMEOUT_MS);

    return getStripeTestListenerStatus();
  } catch (error) {
    finishLoginProcess('error', 'Stripe CLI authentication could not be started.');
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'Stripe CLI authentication could not be started.');
  }
};

const waitForListenerReady = (child: ChildProcess): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const inspect = (chunk: Buffer | string): void => {
      if (/Ready!/.test(chunk.toString())) finish();
    };
    const timeout = setTimeout(() => finish(new Error('Stripe CLI listener did not become ready in time.')), READY_TIMEOUT_MS);
    child.stdout?.on('data', inspect);
    child.stderr?.on('data', inspect);
    child.once('error', (error) => finish(error));
    child.once('exit', (code) => {
      if (!settled) finish(new Error(`Stripe CLI listener exited with code ${code ?? 'unknown'}.`));
    });
  });

export const startStripeTestListener = async (actorId: number | null): Promise<StripeTestListenerStatus> => {
  const executable = requireAvailableExecutable();
  if (listenerProcess && listenerState === 'running') return getStripeTestListenerStatus();
  if (listenerState === 'starting') {
    throw new HttpError(409, 'Stripe CLI listener is already starting.');
  }
  if (authenticationState === 'awaiting_approval') {
    throw new HttpError(409, 'Complete Stripe CLI authentication before starting the listener.');
  }

  listenerState = 'starting';
  listenerMessage = null;
  try {
    let result: { stdout: string; stderr: string };
    try {
      result = await executeStripe(executable, ['listen', '--print-secret'], READY_TIMEOUT_MS);
    } catch {
      authenticationState = 'unauthenticated';
      authenticationMessage = 'Stripe CLI authentication expired or is unavailable.';
      throw new HttpError(401, 'Authenticate Stripe CLI again before starting the listener.');
    }
    const secret = `${result.stdout}\n${result.stderr}`.match(/whsec_[A-Za-z0-9]+/)?.[0];
    if (!secret) {
      authenticationState = 'unauthenticated';
      throw new HttpError(502, 'Stripe CLI did not provide a webhook signing secret. Authenticate the CLI and retry.');
    }

    authenticationState = 'authenticated';
    await updateConfigValue({
      key: TEST_WEBHOOK_CONFIG_KEY,
      value: secret,
      actorId,
      reason: 'Automatically captured from the local Stripe CLI webhook listener.',
    });

    const child = spawn(executable, stripeTestListenerArgs(), { windowsHide: true });
    listenerProcess = child;
    child.once('exit', (code) => {
      if (listenerProcess !== child) return;
      listenerProcess = null;
      listenerStartedAt = null;
      listenerState = code === 0 ? 'stopped' : 'error';
      listenerMessage = code === 0 ? null : `Stripe CLI listener exited with code ${code ?? 'unknown'}.`;
    });
    await waitForListenerReady(child);
    listenerState = 'running';
    listenerStartedAt = new Date();
    logger.info(`[stripe-test-listener] Started pid=${child.pid ?? 'unknown'} forwardTo=${listenerForwardUrl()}`);
    return getStripeTestListenerStatus();
  } catch (error) {
    listenerProcess?.kill();
    listenerProcess = null;
    listenerStartedAt = null;
    listenerState = 'error';
    listenerMessage = error instanceof Error ? error.message : 'Stripe CLI listener could not be started.';
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, listenerMessage);
  }
};

export const stopStripeTestListener = async (): Promise<StripeTestListenerStatus> => {
  if (!isStripeTestListenerAllowed()) {
    throw new HttpError(403, 'Stripe CLI controls are available only outside production.');
  }
  const child = listenerProcess;
  listenerProcess = null;
  listenerStartedAt = null;
  listenerState = 'stopped';
  listenerMessage = null;
  if (child && child.exitCode === null) child.kill();
  logger.info('[stripe-test-listener] Stopped');
  return getStripeTestListenerStatus();
};

process.once('exit', () => {
  listenerProcess?.kill();
  loginProcess?.kill();
});
