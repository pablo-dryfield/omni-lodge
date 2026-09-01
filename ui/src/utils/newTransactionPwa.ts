import { NEW_COUNTER_PWA_HOSTNAME } from "./newCounterPwa";

export const NEW_TRANSACTION_PWA_HOSTNAME = "transaction.omni-lodge.com";
export const NEW_TRANSACTION_PWA_LOCAL_HOSTNAME = "transaction.localhost";
export const NEW_TRANSACTION_PWA_INSTALL_PATH = "/finance/new-transaction/install.html";
export const PRIMARY_PRODUCTION_API_BASE_URL = "https://omni-lodge.com/api";

type LocationLike = Pick<Location, "hostname" | "origin" | "port" | "protocol">;

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

export const getProductionApiBaseUrl = (hostname: string): string =>
  hostname === NEW_TRANSACTION_PWA_HOSTNAME || hostname === NEW_COUNTER_PWA_HOSTNAME
    ? PRIMARY_PRODUCTION_API_BASE_URL
    : "/api";

export const getNewTransactionPwaInstallUrl = (location: LocationLike): string => {
  if (
    location.hostname === NEW_TRANSACTION_PWA_HOSTNAME ||
    location.hostname === NEW_TRANSACTION_PWA_LOCAL_HOSTNAME
  ) {
    return `${location.origin}${NEW_TRANSACTION_PWA_INSTALL_PATH}`;
  }

  if (isLoopbackHostname(location.hostname)) {
    const port = location.port ? `:${location.port}` : "";
    return `${location.protocol}//${NEW_TRANSACTION_PWA_LOCAL_HOSTNAME}${port}${NEW_TRANSACTION_PWA_INSTALL_PATH}`;
  }

  if (location.hostname === "omni-lodge.com" || location.hostname === "www.omni-lodge.com") {
    return `https://${NEW_TRANSACTION_PWA_HOSTNAME}${NEW_TRANSACTION_PWA_INSTALL_PATH}`;
  }

  return `${location.origin}${NEW_TRANSACTION_PWA_INSTALL_PATH}`;
};
