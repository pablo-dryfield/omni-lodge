import {
  DEFAULT_RESTART_NOISE_FORWARD_MS,
  DEFAULT_RESTART_NOISE_LOOKBACK_MS,
  shouldSuppressExpectedRestartNoise,
  type RestartNoiseCandidate,
} from '../errorMonitoringNoisePolicy.js';

const PROCESS_STARTED_AT_MS = Date.parse('2026-09-10T12:57:30.000Z');
const productionWindow = {
  runtimeEnvironment: 'production',
  processStartedAtMs: PROCESS_STARTED_AT_MS,
  publicAppOrigin: 'https://omni-lodge.com',
};

const clientOutage = (overrides: Partial<RestartNoiseCandidate> = {}): RestartNoiseCandidate => ({
  source: 'client',
  kind: 'api_error',
  level: 'error',
  message: 'XMLHttpRequest failed with status 502',
  errorName: 'XMLHttpRequestError',
  occurredAt: new Date(PROCESS_STARTED_AT_MS - 5_000),
  httpUrl: '/api/schedules/weeks',
  httpStatus: 502,
  ...overrides,
});

describe('expected restart noise policy', () => {
  it('suppresses delayed client 502/503/504 API occurrences using occurrence time', () => {
    [502, 503, 504].forEach((httpStatus) => {
      expect(shouldSuppressExpectedRestartNoise(clientOutage({ httpStatus }), productionWindow)).toBe(true);
    });
  });

  it('uses inclusive default restart-window boundaries and retains events just outside them', () => {
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      occurredAt: PROCESS_STARTED_AT_MS - DEFAULT_RESTART_NOISE_LOOKBACK_MS,
    }), productionWindow)).toBe(true);
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      occurredAt: PROCESS_STARTED_AT_MS + DEFAULT_RESTART_NOISE_FORWARD_MS,
    }), productionWindow)).toBe(true);
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      occurredAt: PROCESS_STARTED_AT_MS - DEFAULT_RESTART_NOISE_LOOKBACK_MS - 1,
    }), productionWindow)).toBe(false);
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      occurredAt: PROCESS_STARTED_AT_MS + DEFAULT_RESTART_NOISE_FORWARD_MS + 1,
    }), productionWindow)).toBe(false);
  });

  it('accepts an injected narrower window', () => {
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      occurredAt: PROCESS_STARTED_AT_MS - 1_001,
    }), { ...productionWindow, lookbackMs: 1_000, forwardMs: 0 })).toBe(false);
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      occurredAt: PROCESS_STARTED_AT_MS - 1_000,
    }), { ...productionWindow, lookbackMs: 1_000, forwardMs: 0 })).toBe(true);
  });

  it.each([
    ['XHR network error', 'XMLHttpRequestNetworkError', 'XMLHttpRequest failed'],
    ['XHR timeout', 'XMLHttpRequestTimeout', 'XMLHttpRequest timed out'],
    ['fetch network error', 'TypeError', 'Failed to fetch'],
    ['Safari fetch error', 'TypeError', 'Load failed'],
    ['Firefox fetch error', 'TypeError', 'NetworkError when attempting to fetch resource.'],
    ['Axios network error', 'AxiosError', 'Network Error'],
    ['request timeout', 'AxiosError', 'timeout of 10000ms exceeded'],
  ])('suppresses a statusless %s for an API request', (_label, errorName, message) => {
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      httpStatus: null,
      errorName,
      message,
    }), productionWindow)).toBe(true);
  });

  it('does not classify an aborted or cancelled request as restart noise', () => {
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      httpStatus: null,
      errorName: 'AbortError',
      message: 'The operation was aborted',
    }), productionWindow)).toBe(false);
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      httpStatus: null,
      errorName: 'AxiosError',
      message: 'Request canceled',
    }), productionWindow)).toBe(false);
  });

  it('retains generic transport errors when their message is not a network failure', () => {
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      httpStatus: null,
      errorName: 'FetchError',
      message: 'Invalid JSON response body',
    }), productionWindow)).toBe(false);
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      httpStatus: null,
      errorName: 'XMLHttpRequestError',
      message: 'Response could not be parsed',
    }), productionWindow)).toBe(false);
  });

  it('accepts only first-party absolute API URLs', () => {
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      httpUrl: 'https://omni-lodge.com/api/schedules/weeks?private=value',
      pageUrl: 'https://transaction.omni-lodge.com/finance/new-transaction',
    }), productionWindow)).toBe(true);
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      httpUrl: 'https://omni-lodge.com/api/schedules/weeks',
      pageUrl: 'https://omni-lodge.com/finance',
    }), { ...productionWindow, publicAppOrigin: null })).toBe(true);
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      httpUrl: 'https://vendor.example/api/orders',
      pageUrl: 'https://omni-lodge.com/finance',
    }), productionWindow)).toBe(false);
  });

  it('suppresses only a trusted UI-server API proxy outage', () => {
    const proxyFailure = clientOutage({
      source: 'server',
      context: { runtime: 'ui-server', source: 'api-proxy' },
    });
    expect(shouldSuppressExpectedRestartNoise(proxyFailure, productionWindow)).toBe(true);
    expect(shouldSuppressExpectedRestartNoise({
      ...proxyFailure,
      context: { runtime: 'ui-server', source: 'express' },
    }, productionWindow)).toBe(false);
    expect(shouldSuppressExpectedRestartNoise({
      ...proxyFailure,
      context: { runtime: 'browser', source: 'api-proxy' },
    }, productionWindow)).toBe(false);
  });

  it('suppresses a native Reporting API network-error whose target is /api', () => {
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      kind: 'manual',
      errorName: 'network-error',
      message: 'Browser report: network-error',
      httpUrl: null,
      httpStatus: null,
      pageUrl: '/api/bookings/summary',
      context: { reportType: 'network-error' },
    }), productionWindow)).toBe(true);
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      kind: 'manual',
      errorName: 'network-error',
      message: 'Browser report: network-error',
      httpUrl: null,
      httpStatus: null,
      pageUrl: 'https://omni-lodge.com/api/bookings/summary',
      context: { reportType: 'network-error' },
    }), productionWindow)).toBe(true);
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      kind: 'manual',
      errorName: 'network-error',
      message: 'Browser report: network-error',
      httpUrl: null,
      httpStatus: null,
      pageUrl: 'https://omni-lodge.com/api/bookings/summary',
      context: { reportType: 'network-error' },
    }), { ...productionWindow, publicAppOrigin: null })).toBe(false);
  });

  it.each([
    ['backend 500', clientOutage({ httpStatus: 500 })],
    ['client 4xx', clientOutage({ httpStatus: 401 })],
    ['request-source error', clientOutage({ source: 'request' })],
    ['process-source error', clientOutage({ source: 'process' })],
    ['fatal outage event', clientOutage({ level: 'fatal' })],
    ['React error', clientOutage({ kind: 'react_error', message: 'Failed to fetch', httpStatus: null })],
    ['runtime exception', clientOutage({ kind: 'exception', message: 'Failed to fetch', httpStatus: null })],
    ['non-API URL', clientOutage({ httpUrl: '/finance' })],
    ['external absolute URL', clientOutage({ httpUrl: 'https://vendor.example/api/orders' })],
    ['external protocol-relative URL', clientOutage({ httpUrl: '//vendor.example/api/orders' })],
  ])('retains %s', (_label, event) => {
    expect(shouldSuppressExpectedRestartNoise(event, productionWindow)).toBe(false);
  });

  it('never suppresses outside production', () => {
    ['development', 'test', 'staging', 'unknown', null].forEach((runtimeEnvironment) => {
      expect(shouldSuppressExpectedRestartNoise(clientOutage(), {
        ...productionWindow,
        runtimeEnvironment,
      })).toBe(false);
    });
  });

  it.each([
    ['missing occurrence', clientOutage({ occurredAt: undefined }), productionWindow],
    ['invalid occurrence', clientOutage({ occurredAt: 'not-a-date' }), productionWindow],
    ['missing level', clientOutage({ level: undefined }), productionWindow],
    ['missing message', clientOutage({ message: undefined }), productionWindow],
    ['missing API path', clientOutage({ httpUrl: undefined }), productionWindow],
    ['invalid process start', clientOutage(), { ...productionWindow, processStartedAtMs: Number.NaN }],
    ['negative lookback', clientOutage(), { ...productionWindow, lookbackMs: -1 }],
    ['negative forward window', clientOutage(), { ...productionWindow, forwardMs: -1 }],
    ['malformed status', clientOutage({ httpStatus: '502' }), productionWindow],
  ])('fails open for %s', (_label, event, options) => {
    expect(shouldSuppressExpectedRestartNoise(event, options)).toBe(false);
  });

  it('fails open without throwing for hostile event/context objects', () => {
    const hostileEvent = new Proxy({}, {
      get: () => {
        throw new Error('unreadable event');
      },
    });
    const hostileContext = new Proxy({}, {
      get: () => {
        throw new Error('unreadable context');
      },
    });

    expect(() => shouldSuppressExpectedRestartNoise(hostileEvent, productionWindow)).not.toThrow();
    expect(shouldSuppressExpectedRestartNoise(hostileEvent, productionWindow)).toBe(false);
    expect(shouldSuppressExpectedRestartNoise(clientOutage({
      source: 'server',
      context: hostileContext,
    }), productionWindow)).toBe(false);
  });
});
