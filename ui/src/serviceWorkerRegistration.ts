/* eslint-disable no-console */

type Config = {
  onSuccess?: (registration: ServiceWorkerRegistration) => void;
  onUpdate?: (registration: ServiceWorkerRegistration) => void;
};

const APP_UPDATE_CHECK_INTERVAL_MS = 60 * 1000;
const GOOGLE_AUTOMATED_RENDERER_USER_AGENT_TOKEN =
  /(?:^|[^A-Za-z0-9_-])(?:PlayStore-Google|Google-Read-Aloud)(?:$|[^A-Za-z0-9_-])/;
const GOOGLE_PLAY_SERVICE_WORKER_STACK_MARKER = 'wrsParams.serviceWorkers';

const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
    window.location.hostname === '[::1]' ||
    window.location.hostname.match(
      /^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/,
    ),
);

export const isGooglePlayServiceWorkerRegistrationRejection = (
  error: unknown,
  userAgent: string,
): boolean => {
  if (!GOOGLE_AUTOMATED_RENDERER_USER_AGENT_TOKEN.test(userAgent)) {
    return false;
  }

  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const errorLike = error as { message?: unknown; stack?: unknown };
  return (
    errorLike.message === 'Rejected' &&
    typeof errorLike.stack === 'string' &&
    errorLike.stack.includes(GOOGLE_PLAY_SERVICE_WORKER_STACK_MARKER)
  );
};

export const reportServiceWorkerRegistrationError = (
  error: unknown,
  userAgent = navigator.userAgent,
): void => {
  if (isGooglePlayServiceWorkerRegistrationRejection(error, userAgent)) {
    return;
  }

  console.error('Error during service worker registration:', error);
};

export const isStaleServiceWorkerRegistrationError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { name?: unknown }).name === 'InvalidStateError';

export const reportServiceWorkerUpdateError = (error: unknown): void => {
  // update() rejects with InvalidStateError after this particular registration
  // object has been unregistered/replaced. Continuing the per-minute poll only
  // repeats noise; a reload will register the current worker normally.
  if (isStaleServiceWorkerRegistrationError(error)) {
    return;
  }

  console.error('Error checking for app update:', error);
};

export function register(config?: Config) {
  if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
    const publicUrl = new URL(process.env.PUBLIC_URL ?? '', window.location.href);
    if (publicUrl.origin !== window.location.origin) {
      return;
    }

    window.addEventListener('load', () => {
      const swUrl = `${process.env.PUBLIC_URL}/service-worker.js`;

      if (isLocalhost) {
        checkValidServiceWorker(swUrl, config);
        navigator.serviceWorker.ready.then(() => {
          console.log(
            'This web app is being served cache-first by a service worker.',
          );
        });
      } else {
        registerValidSW(swUrl, config);
      }
    });
  }
}

function registerValidSW(swUrl: string, config?: Config) {
  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      scheduleUpdateChecks(registration);
      if (registration.waiting && navigator.serviceWorker.controller) {
        config?.onUpdate?.(registration);
      }
      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
        installingWorker.onstatechange = () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              console.log('New content is available and will be used when all tabs are closed.');
              config?.onUpdate?.(registration);
            } else {
              console.log('Content is cached for offline use.');
              config?.onSuccess?.(registration);
            }
          }
        };
      };
    })
    .catch((error) => {
      reportServiceWorkerRegistrationError(error);
    });
}

function scheduleUpdateChecks(registration: ServiceWorkerRegistration) {
  let intervalId: number | null = null;
  const stopUpdateChecks = () => {
    window.removeEventListener('focus', checkForUpdate);
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  };
  const checkForUpdate = () => {
    if (document.visibilityState !== 'visible') {
      return;
    }
    registration.update().catch((error) => {
      if (isStaleServiceWorkerRegistrationError(error)) {
        stopUpdateChecks();
        return;
      }
      reportServiceWorkerUpdateError(error);
    });
  };

  window.addEventListener('focus', checkForUpdate);
  intervalId = window.setInterval(checkForUpdate, APP_UPDATE_CHECK_INTERVAL_MS);
}

function checkValidServiceWorker(swUrl: string, config?: Config) {
  fetch(swUrl, {
    headers: { 'Service-Worker': 'script' },
  })
    .then((response) => {
      const contentType = response.headers.get('content-type');
      if (
        response.status === 404 ||
        (contentType != null && contentType.indexOf('javascript') === -1)
      ) {
        navigator.serviceWorker.ready
          .then((registration) => registration.unregister())
          .then(() => window.location.reload());
      } else {
        registerValidSW(swUrl, config);
      }
    })
    .catch(() => {
      console.log('No internet connection found. App is running in offline mode.');
    });
}

export function unregister() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.unregister();
      })
      .catch((error) => {
        console.error(error.message);
      });
  }
}
