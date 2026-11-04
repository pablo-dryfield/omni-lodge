import { afterEach, expect, test, vi } from "vitest";
import { api, ApiError, setCsrf, uploadChunk } from "./api";
afterEach(() => vi.unstubAllGlobals());
test("mutations use a same-origin CSRF header; credentials never enter URLs", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ id: "operation" }) });
  vi.stubGlobal("fetch", fetch);
  setCsrf("csrf-fixture");
  await api("/file-operations/execute", { id: "operation" });
  expect(fetch).toHaveBeenCalledWith(
    "/management/file-operations/execute",
    expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Management-CSRF": "csrf-fixture",
      },
      body: '{"id":"operation"}',
    }),
  );
});
test("revocation retains the structured error code for clearing sensitive UI state", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: false,
        json: async () => ({
          code: "POLICY_CHANGED",
          message: "Launch again.",
        }),
      }),
  );
  await expect(api("/session")).rejects.toEqual(
    new ApiError("POLICY_CHANGED", "Launch again."),
  );
});
test("upload chunks carry confirmed offsets and checksums without serializing raw bytes into JSON", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ state: "paused" }) });
  vi.stubGlobal("fetch", fetch);
  setCsrf("csrf-fixture");
  const bytes = new Uint8Array([0, 255, 32]);
  await uploadChunk("fixture", 4194304, bytes, "digest");
  expect(fetch).toHaveBeenCalledWith(
    "/management/transfers/fixture/chunks",
    expect.objectContaining({
      method: "PUT",
      body: bytes,
      headers: expect.objectContaining({
        "X-Upload-Offset": "4194304",
        "X-Chunk-SHA256": "digest",
        "X-Management-CSRF": "csrf-fixture",
      }),
    }),
  );
});
