import {
  getNewCounterPwaInstallUrl,
  NEW_COUNTER_PWA_INSTALL_PATH,
} from "./newCounterPwa";
import { getProductionApiBaseUrl } from "./newTransactionPwa";

const location = (
  origin: string,
  hostname: string,
  protocol = "https:",
  port = "",
) => ({ origin, hostname, protocol, port });

describe("New Counter PWA install URL", () => {
  it("uses a separate production origin so Chrome can install a third app", () => {
    expect(
      getNewCounterPwaInstallUrl(location("https://omni-lodge.com", "omni-lodge.com")),
    ).toBe(`https://counter.omni-lodge.com${NEW_COUNTER_PWA_INSTALL_PATH}`);
  });

  it("keeps counter companion API calls on the primary origin", () => {
    expect(getProductionApiBaseUrl("counter.omni-lodge.com")).toBe(
      "https://omni-lodge.com/api",
    );
  });

  it("uses a separate localhost origin while retaining the UI port", () => {
    expect(
      getNewCounterPwaInstallUrl(
        location("http://localhost:3000", "localhost", "http:", "3000"),
      ),
    ).toBe(`http://counter.localhost:3000${NEW_COUNTER_PWA_INSTALL_PATH}`);
  });

  it("stays on the counter companion origin after it has been opened", () => {
    expect(
      getNewCounterPwaInstallUrl(
        location("https://counter.omni-lodge.com", "counter.omni-lodge.com"),
      ),
    ).toBe(`https://counter.omni-lodge.com${NEW_COUNTER_PWA_INSTALL_PATH}`);
  });

  it("does not redirect unknown development hosts to production", () => {
    expect(
      getNewCounterPwaInstallUrl(
        location("https://staging.example.test", "staging.example.test"),
      ),
    ).toBe(`https://staging.example.test${NEW_COUNTER_PWA_INSTALL_PATH}`);
  });
});
