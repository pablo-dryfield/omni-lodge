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
  icons: ManifestIcon[];
};

const publicDirectory = path.join(process.cwd(), "public");
const readManifest = (relativePath: string): WebAppManifest =>
  JSON.parse(readFileSync(path.join(publicDirectory, relativePath), "utf8")) as WebAppManifest;

describe("New Transaction companion PWA", () => {
  const mainManifest = readManifest("manifest.json");
  const companionManifest = readManifest(
    path.join("finance", "new-transaction", "new-transaction.webmanifest"),
  );

  it("has a stable identity distinct from the main OmniLodge app", () => {
    expect(mainManifest.id).toBe("/");
    expect(companionManifest.id).toBe("/pwa/new-transaction");
    expect(companionManifest.id).not.toBe(mainManifest.id);
  });

  it("launches the permission-guarded create transaction URL within its scope", () => {
    const origin = "https://omni-lodge.com";
    const startUrl = new URL(companionManifest.start_url, origin);
    const scopeUrl = new URL(companionManifest.scope, origin);

    expect(startUrl.pathname.startsWith(scopeUrl.pathname)).toBe(true);
    expect(startUrl.pathname).toBe("/finance/transactions");
    expect(startUrl.searchParams.get("transactionModal")).toBe("create");
    expect(startUrl.searchParams.get("pwa")).toBe("new-transaction");
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
});
