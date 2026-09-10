import {
  isGooglePlayServiceWorkerRegistrationRejection,
  isStaleServiceWorkerRegistrationError,
  reportServiceWorkerRegistrationError,
  reportServiceWorkerUpdateError,
} from './serviceWorkerRegistration';

const buildRegistrationError = (
  message = 'Rejected',
  stack = 'Error: Rejected\n    at wrsParams.serviceWorkers.navigator.serviceWorker.register (<anonymous>:12:648)',
): Error => {
  const error = new Error(message);
  error.stack = stack;
  return error;
};

describe('Google Play service-worker registration rejection', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it.each([
    'Mozilla/5.0 PlayStore-Google',
    'Mozilla/5.0 (compatible; Google-Read-Aloud; +https://support.google.com/webmasters/answer/1061943)',
  ])('quietly ignores the exact automated-renderer rejection signature for %s', (userAgent) => {
    const error = buildRegistrationError();

    expect(
      isGooglePlayServiceWorkerRegistrationRejection(
        error,
        userAgent,
      ),
    ).toBe(true);

    reportServiceWorkerRegistrationError(error, userAgent);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'a normal browser user agent',
      error: buildRegistrationError(),
      userAgent: 'Mozilla/5.0 Chrome/152.0.0.0',
    },
    {
      name: 'a similar but non-token user agent',
      error: buildRegistrationError(),
      userAgent: 'NotPlayStore-GoogleCrawler',
    },
    {
      name: 'a different rejection message',
      error: buildRegistrationError('Registration rejected'),
      userAgent: 'PlayStore-Google',
    },
    {
      name: 'a rejection without the Google renderer stack marker',
      error: buildRegistrationError(
        'Rejected',
        'Error: Rejected\n    at registerServiceWorker (serviceWorkerRegistration.ts:44:5)',
      ),
      userAgent: 'PlayStore-Google',
    },
    {
      name: 'a rejected string instead of the expected Error object',
      error: 'Rejected',
      userAgent: 'PlayStore-Google',
    },
  ])('keeps reporting $name', ({ error, userAgent }) => {
    expect(
      isGooglePlayServiceWorkerRegistrationRejection(error, userAgent),
    ).toBe(false);

    reportServiceWorkerRegistrationError(error, userAgent);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error during service worker registration:',
      error,
    );
  });
});

describe('service-worker update failures', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('quietly stops reporting a stale registration InvalidStateError', () => {
    const error = Object.assign(new Error('The object is in an invalid state.'), {
      name: 'InvalidStateError',
    });

    expect(isStaleServiceWorkerRegistrationError(error)).toBe(true);
    reportServiceWorkerUpdateError(error);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('continues reporting other update failures', () => {
    const error = new TypeError('Network unavailable');

    expect(isStaleServiceWorkerRegistrationError(error)).toBe(false);
    reportServiceWorkerUpdateError(error);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error checking for app update:',
      error,
    );
  });
});
