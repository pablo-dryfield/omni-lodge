export const NEW_COUNTER_PWA_HOSTNAME = "counter.omni-lodge.com";
export const NEW_COUNTER_PWA_LOCAL_HOSTNAME = "counter.localhost";
export const NEW_COUNTER_PWA_INSTALL_PATH = "/counters/new-counter/install.html";

type LocationLike = Pick<Location, "hostname" | "origin" | "port" | "protocol">;

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

export const getNewCounterPwaInstallUrl = (location: LocationLike): string => {
  if (
    location.hostname === NEW_COUNTER_PWA_HOSTNAME ||
    location.hostname === NEW_COUNTER_PWA_LOCAL_HOSTNAME
  ) {
    return `${location.origin}${NEW_COUNTER_PWA_INSTALL_PATH}`;
  }

  if (isLoopbackHostname(location.hostname)) {
    const port = location.port ? `:${location.port}` : "";
    return `${location.protocol}//${NEW_COUNTER_PWA_LOCAL_HOSTNAME}${port}${NEW_COUNTER_PWA_INSTALL_PATH}`;
  }

  if (location.hostname === "omni-lodge.com" || location.hostname === "www.omni-lodge.com") {
    return `https://${NEW_COUNTER_PWA_HOSTNAME}${NEW_COUNTER_PWA_INSTALL_PATH}`;
  }

  return `${location.origin}${NEW_COUNTER_PWA_INSTALL_PATH}`;
};
