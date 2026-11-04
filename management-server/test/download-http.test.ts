import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import type { Client, SFTPWrapper, Stats } from "ssh2";
import { Files } from "../src/files.js";
import type { Authority } from "../src/authority.js";
import type { Store } from "../src/store.js";
import type { Context, Host, Root } from "../src/types.js";

test("HTTP file completion waits for source verification, including after all bytes arrived", async () => {
  const payload = Buffer.alloc(16384, "a"),
    root: Root = {
      id: "work",
      name: "Work",
      path: "/work",
      writable: false,
      managed: false,
    };
  let changed = true;
  const files = new Files(
    {} as Authority,
    { event: async () => {} } as unknown as Store,
  );
  files.withRoot = async <T>(
    _session: string,
    _ctx: Context,
    _host: string,
    _root: string,
    _action: any,
    fn: (client: Client, s: SFTPWrapper, host: Host, root: Root) => Promise<T>,
  ) => {
    let reads = 0;
    const sftp = {
      lstat(_path: string, callback: (error: null, result: Stats) => void) {
        const count = ++reads;
        setTimeout(
          () =>
            callback(null, {
              size: payload.length,
              mtime: changed && count === 3 ? 2 : 1,
              mode: 0o100640,
              uid: 1001,
              gid: 1001,
              isFile: () => true,
              isSymbolicLink: () => false,
            } as Stats),
          count === 3 ? 25 : 0,
        );
      },
      open(
        _path: string,
        _flags: string,
        callback: (error: null, handle: Buffer) => void,
      ) {
        callback(null, Buffer.from([1]));
      },
      createReadStream() {
        return Readable.from([payload]);
      },
    } as unknown as SFTPWrapper;
    return fn({} as Client, sftp, {} as Host, root);
  };
  const server = http.createServer(async (req, res) => {
    if (req.url === "/auth") {
      res.statusCode = 401;
      res.end(JSON.stringify({ code: "STEP_UP_REQUIRED" }));
      return;
    }
    try {
      await files.download(
        "synthetic",
        { actorId: 1 } as Context,
        "fixture",
        "work",
        "file.txt",
        res,
      );
    } catch {
      if (res.headersSent) res.destroy();
      else {
        res.statusCode = 409;
        res.end();
      }
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const request = (path: string) =>
    new Promise<{
      complete: boolean;
      bytes: number;
      status: number;
      headers: http.IncomingHttpHeaders;
    }>((resolve, reject) => {
      const req = http.get({ hostname: "127.0.0.1", port, path }, (res) => {
        let bytes = 0;
        const finish = (complete: boolean) =>
          resolve({
            complete,
            bytes,
            status: res.statusCode!,
            headers: res.headers,
          });
        res.on("data", (part) => {
          bytes += part.length;
        });
        res.on("end", () => finish(true));
        res.on("aborted", () => finish(false));
        res.on("error", () => finish(false));
      });
      req.on("error", reject);
    });
  try {
    const rejected = await request("/file");
    assert.equal(
      rejected.bytes,
      payload.length,
      "The entire payload arrives before the trailing check fails.",
    );
    assert.equal(
      rejected.complete,
      false,
      "A changed source must still be an incomplete HTTP download.",
    );
    changed = false;
    const verified = await request("/file");
    assert.equal(verified.complete, true);
    assert.equal(verified.bytes, payload.length);
    assert.equal(verified.headers["content-length"], undefined);
    const auth = await request("/auth");
    assert.equal(auth.status, 401);
    assert.equal(auth.complete, true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
