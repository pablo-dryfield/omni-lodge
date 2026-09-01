import { existsSync, readFileSync } from "fs";
import path from "path";

type ManifestIcon = {
  src: string;
  sizes: string;
  purpose?: string;
};

type WebAppManifest = {
  id: string;
  name: string;
  start_url: string;
  scope: string;
  orientation: string;
  icons: ManifestIcon[];
  shortcuts?: Array<{
    name: string;
    url: string;
    icons: ManifestIcon[];
  }>;
};

const publicDirectory = path.join(process.cwd(), "public");
const readManifest = (relativePath: string): WebAppManifest =>
  JSON.parse(readFileSync(path.join(publicDirectory, relativePath), "utf8")) as WebAppManifest;

describe("New Transaction companion PWA", () => {
  const mainManifest = readManifest("manifest.json");
  const companionManifest = readManifest(
    path.join("finance", "new-transaction", "new-transaction.webmanifest"),
  );

  it("has a stable identity that is installed from the companion origin", () => {
    expect(mainManifest.id).toBe("/");
    expect(companionManifest.id).toBe("/pwa/new-transaction");
    expect(companionManifest.id).not.toBe(mainManifest.id);
  });

  it("allows both installed apps to follow the device orientation", () => {
    expect(mainManifest.orientation).toBe("any");
    expect(companionManifest.orientation).toBe("any");
  });

  it("launches the permission-guarded create transaction URL within its scope", () => {
    const origin = "https://transaction.omni-lodge.com";
    const startUrl = new URL(companionManifest.start_url, origin);
    const scopeUrl = new URL(companionManifest.scope, origin);

    expect(startUrl.pathname.startsWith(scopeUrl.pathname)).toBe(true);
    expect(startUrl.pathname).toBe("/finance/transactions");
    expect(startUrl.searchParams.get("transactionModal")).toBe("create");
    expect(startUrl.searchParams.get("pwa")).toBe("new-transaction");
    expect(scopeUrl.pathname).toBe("/");
  });

  it("ships installable and maskable icon files", () => {
    expect(companionManifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
      ]),
    );

    companionManifest.icons.forEach((icon) => {
      expect(existsSync(path.join(publicDirectory, icon.src.replace(/^\//, "")))).toBe(true);
    });
  });

  it("uses the companion manifest from the dedicated installation document", () => {
    const installer = readFileSync(
      path.join(publicDirectory, "finance", "new-transaction", "install.html"),
      "utf8",
    );

    expect(installer).toContain(
      'rel="manifest" href="/finance/new-transaction/new-transaction.webmanifest"',
    );
    expect(installer).toContain('rel="apple-touch-icon"');
  });

  it("selects the companion manifest by hostname rather than a nested main-app URL", () => {
    const selector = readFileSync(path.join(publicDirectory, "pwa-manifest-selector.js"), "utf8");

    expect(selector).toContain('window.location.hostname === "transaction.omni-lodge.com"');
    expect(selector).not.toContain('params.get("pwa")');
  });
});

describe("New Counter companion PWA", () => {
  const mainManifest = readManifest("manifest.json");
  const transactionManifest = readManifest(
    path.join("finance", "new-transaction", "new-transaction.webmanifest"),
  );
  const counterManifest = readManifest(
    path.join("counters", "new-counter", "new-counter.webmanifest"),
  );

  it("has a stable identity separate from both existing apps", () => {
    expect(counterManifest.id).toBe("/pwa/new-counter");
    expect(counterManifest.id).not.toBe(mainManifest.id);
    expect(counterManifest.id).not.toBe(transactionManifest.id);
    expect(counterManifest.orientation).toBe("any");
  });

  it("launches the create-counter deep link within its scope", () => {
    const origin = "https://counter.omni-lodge.com";
    const startUrl = new URL(counterManifest.start_url, origin);
    const scopeUrl = new URL(counterManifest.scope, origin);

    expect(startUrl.pathname.startsWith(scopeUrl.pathname)).toBe(true);
    expect(startUrl.pathname).toBe("/counters");
    expect(startUrl.searchParams.get("mode")).toBe("create");
    expect(startUrl.searchParams.get("pwa")).toBe("new-counter");
    expect(scopeUrl.pathname).toBe("/");
  });

  it("ships installable and maskable counter icon files", () => {
    expect(counterManifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
      ]),
    );

    counterManifest.icons.forEach((icon) => {
      expect(existsSync(path.join(publicDirectory, icon.src.replace(/^\//, "")))).toBe(true);
    });
  });

  it("uses the counter manifest from the dedicated installation document", () => {
    const installer = readFileSync(
      path.join(publicDirectory, "counters", "new-counter", "install.html"),
      "utf8",
    );

    expect(installer).toContain(
      'rel="manifest" href="/counters/new-counter/new-counter.webmanifest"',
    );
    expect(installer).toContain('rel="apple-touch-icon"');
    expect(installer).toContain('/counters?mode=create&amp;pwa=new-counter');
  });

  it("selects the counter companion manifest by hostname", () => {
    const selector = readFileSync(path.join(publicDirectory, "pwa-manifest-selector.js"), "utf8");

    expect(selector).toContain('window.location.hostname === "counter.omni-lodge.com"');
    expect(selector).toContain('window.location.hostname === "counter.localhost"');
    expect(selector).toContain('"/counters/new-counter/new-counter.webmanifest"');
  });

  it("also exposes Create counter as a shortcut from the main OmniLodge app", () => {
    const counterShortcut = mainManifest.shortcuts?.find(
      (shortcut) => shortcut.name === "Create counter",
    );

    expect(counterShortcut?.url).toBe("/counters?mode=create");
    counterShortcut?.icons.forEach((icon) => {
      expect(existsSync(path.join(publicDirectory, icon.src.replace(/^\//, "")))).toBe(true);
    });
  });
});
