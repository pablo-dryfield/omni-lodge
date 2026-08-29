export const SERVER_AVAILABILITY_CANDIDATE_EVENT = "omni-server-availability-candidate";

export interface ServerAvailabilityCandidateDetail {
  status?: number;
  isNetworkError: boolean;
  message?: string;
  code?: string;
  method?: string;
  url?: string;
  visibilityState?: DocumentVisibilityState;
  occurredAt: number;
}

export interface ServerHealthProbeOptions {
  baseURL?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ServerHealthProbeResult {
  available: boolean;
  status?: number;
}

const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 4_000;

const getHealthUrl = (baseURL?: string): string => {
  const normalizedBaseURL = (baseURL || "/api").replace(/\/+$/, "");
  return `${normalizedBaseURL}/health`;
};

export const dispatchServerAvailabilityCandidate = (
  detail: ServerAvailabilityCandidateDetail,
): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.dispatchEvent(
      new CustomEvent<ServerAvailabilityCandidateDetail>(SERVER_AVAILABILITY_CANDIDATE_EVENT, {
        detail,
      }),
    );
  } catch {
    // Availability reporting must never replace the original request error.
  }
};

export const probeServerHealth = async (
  options: ServerHealthProbeOptions = {},
): Promise<ServerHealthProbeResult> => {
  const fetcher = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    return { available: false };
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_HEALTH_PROBE_TIMEOUT_MS);
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(getHealthUrl(options.baseURL), {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    return {
      // Any non-server-error response proves the API/proxy is reachable. This
      // also keeps phased UI/backend deployments from treating an older 404
      // response as a full outage before the health route is available.
      available: response.status < 500,
      status: response.status,
    };
  } catch {
    return { available: false };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
};
