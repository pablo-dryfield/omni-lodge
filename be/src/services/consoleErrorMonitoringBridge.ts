import { captureProcessErrorSafe } from './errorMonitoringService.js';

type ConsoleCaptureKind = 'console_error' | 'console_warning';
type ConsoleCapture = (kind: ConsoleCaptureKind, error: unknown) => void;
type ConsoleMethod = (...args: unknown[]) => void;

const EXCLUDED_PREFIX = /^\[(?:request-error|error-monitoring|performance)\]/i;
const FAILURE_WARNING = /\b(?:fail(?:ed|ure)?|error|exception|unable|timeout|timed out|rejected)\b/i;
const MAX_CONSOLE_MESSAGE = 4_000;

type BridgeGuard = { forwarding: boolean };

const summarizeValue = (value: unknown): string => {
  if (typeof value === 'string') return value.slice(0, MAX_CONSOLE_MESSAGE);
  if (value == null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (Array.isArray(value)) return `[Array length=${value.length}]`;
  if (typeof value === 'object') {
    // Do not flatten arbitrary legacy objects into a message: those objects may
    // contain request bodies or personal data. Key names are enough to locate
    // the call site while the generated Error stack identifies the caller.
    const keys = Object.keys(value as Record<string, unknown>).slice(0, 20);
    return keys.length > 0 ? `[Object keys=${keys.join(',')}]` : '[Object]';
  }
  return `[${typeof value}]`;
};

export const consoleArgumentsToError = (args: unknown[]): Error => {
  const suppliedError = args.find((value): value is Error => value instanceof Error);
  if (suppliedError) return suppliedError;
  const message = args.length > 0
    ? args.map(summarizeValue).join(' ').slice(0, MAX_CONSOLE_MESSAGE)
    : 'Legacy console call without a message';
  return new Error(message || 'Legacy console call without a message');
};

const isExcluded = (args: unknown[], error: Error): boolean => {
  const firstString = args.find((value): value is string => typeof value === 'string');
  return EXCLUDED_PREFIX.test(firstString?.trim() ?? error.message.trim());
};

export const shouldCaptureConsoleWarning = (args: unknown[]): boolean => {
  if (args.some((value) => value instanceof Error)) return true;
  return FAILURE_WARNING.test(args.filter((value) => typeof value === 'string').join(' '));
};

export const createConsoleMonitoringHandler = (
  kind: ConsoleCaptureKind,
  original: ConsoleMethod,
  capture: ConsoleCapture,
  guard: BridgeGuard = { forwarding: false },
): ConsoleMethod => {
  const handler: ConsoleMethod = (...args: unknown[]): void => {
    // Preserve legacy output and ordering regardless of monitoring state.
    original(...args);
    if (guard.forwarding) return;
    try {
      if (kind === 'console_warning' && !shouldCaptureConsoleWarning(args)) return;

      const suppliedError = args.find((value): value is Error => value instanceof Error);
      const error = suppliedError ?? consoleArgumentsToError(args);
      if (!suppliedError && typeof Error.captureStackTrace === 'function') {
        Error.captureStackTrace(error, handler);
      }
      if (isExcluded(args, error)) return;
      guard.forwarding = true;
      capture(kind, error);
    } catch {
      // Proxies, getters, and diagnostics can never change legacy console behavior.
    } finally {
      guard.forwarding = false;
    }
  };
  return handler;
};

let installed = false;

export const installConsoleErrorMonitoringBridge = (): void => {
  if (installed) return;
  installed = true;
  const guard: BridgeGuard = { forwarding: false };
  const originalError = console.error.bind(console) as ConsoleMethod;
  const originalWarn = console.warn.bind(console) as ConsoleMethod;
  console.error = createConsoleMonitoringHandler(
    'console_error',
    originalError,
    captureProcessErrorSafe,
    guard,
  ) as typeof console.error;
  console.warn = createConsoleMonitoringHandler(
    'console_warning',
    originalWarn,
    captureProcessErrorSafe,
    guard,
  ) as typeof console.warn;
};
