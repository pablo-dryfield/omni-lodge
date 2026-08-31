import {
  getProductionApiBaseUrl,
  getNewTransactionPwaInstallUrl,
  NEW_TRANSACTION_PWA_INSTALL_PATH,
} from "./newTransactionPwa";

const location = (
  origin: string,
  hostname: string,
  protocol = "https:",
  port = "",
) => ({ origin, hostname, protocol, port });

describe("New Transaction PWA install URL", () => {
  it("uses a separate production origin so Chrome can install a second app", () => {
    expect(
      getNewTransactionPwaInstallUrl(location("https://omni-lodge.com", "omni-lodge.com")),
    ).toBe(`https://transaction.omni-lodge.com${NEW_TRANSACTION_PWA_INSTALL_PATH}`);
  });

  it("keeps companion API calls on the primary origin for shared authentication", () => {
    expect(getProductionApiBaseUrl("transaction.omni-lodge.com")).toBe(
      "https://omni-lodge.com/api",
    );
    expect(getProductionApiBaseUrl("omni-lodge.com")).toBe("/api");
  });

  it("uses a separate localhost origin while retaining the UI port", () => {
    expect(
      getNewTransactionPwaInstallUrl(
        location("http://localhost:3000", "localhost", "http:", "3000"),
      ),
    ).toBe(`http://transaction.localhost:3000${NEW_TRANSACTION_PWA_INSTALL_PATH}`);
  });

  it("stays on the companion origin after it has been opened", () => {
    expect(
      getNewTransactionPwaInstallUrl(
        location(
          "https://transaction.omni-lodge.com",
          "transaction.omni-lodge.com",
        ),
      ),
    ).toBe(`https://transaction.omni-lodge.com${NEW_TRANSACTION_PWA_INSTALL_PATH}`);
  });

  it("does not redirect unknown development hosts to production", () => {
    expect(
      getNewTransactionPwaInstallUrl(location("https://staging.example.test", "staging.example.test")),
    ).toBe(`https://staging.example.test${NEW_TRANSACTION_PWA_INSTALL_PATH}`);
  });
});
