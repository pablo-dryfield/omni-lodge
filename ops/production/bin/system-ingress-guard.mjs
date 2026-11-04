// Installed outside release directories. Reserve the console origin even when
// an older application is activated during rollback. No application telemetry,
// fallback SPA, middleware or upgrade listener may receive this origin.
import http from "node:http";
import https from "node:https";
import { pathToFileURL } from "node:url";

const installed = Symbol.for("omnilodge.system-ingress.v1");
const incomingHeaders = new Set([
  "host",
  "origin",
  "cookie",
  "content-type",
  "content-length",
  "accept",
  "x-management-csrf",
  "x-upload-offset",
  "x-chunk-sha256",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
  "connection",
  "upgrade",
]);
const failureHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors https://omni-lodge.com",
  "X-Content-Type-Options": "nosniff",
  "X-Omnilodge-System-Ingress": "v1",
};

export function installSystemIngress({
  hostname = "system.omni-lodge.com",
  port = 3011,
} = {}) {
  if (
    !/^[a-z0-9.-]+$/.test(hostname) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("Invalid reserved console ingress");
  }
  const matches = (req) =>
    String(req.headers.host || "")
      .toLowerCase()
      .replace(/:443$/, "")
      .replace(/\.$/, "") === hostname;
  const headers = (req) => {
    const result = Object.fromEntries(
      Object.entries(req.headers).filter(([key]) => incomingHeaders.has(key)),
    );
    // Parent-domain application cookies and telemetry credentials never cross.
    result.cookie = String(req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x.startsWith("__Host-omnilodge-management="))
      .join("; ");
    result.host = hostname;
    return result;
  };
  const proxy = (req, res, socket, head) => {
    const upgrade = Boolean(socket);
    if (upgrade && req.url !== "/management/stream") {
      socket.destroy();
      return;
    }
    if (
      !upgrade &&
      Number(req.headers["content-length"] || 0) > 4 * 1024 * 1024 + 65536
    ) {
      res.writeHead(413, failureHeaders);
      res.end('{"code":"REQUEST_TOO_LARGE"}');
      return;
    }
    const upstream = http.request({
      hostname: "127.0.0.1",
      port,
      path: req.url,
      method: req.method,
      headers: headers(req),
      agent: false,
    });
    upstream.setTimeout(120000, () =>
      upstream.destroy(new Error("Ingress timeout")),
    );
    upstream.on("error", () => {
      if (upgrade) socket.destroy();
      else if (!res.headersSent) {
        res.writeHead(503, failureHeaders);
        res.end(
          '{"code":"BROKER_UNAVAILABLE","message":"System Management is temporarily unavailable."}',
        );
      } else res.destroy();
    });
    upstream.on("response", (response) => {
      if (upgrade) {
        response.resume();
        socket.destroy();
        return;
      }
      res.writeHead(response.statusCode || 502, {
        ...response.headers,
        "x-omnilodge-system-ingress": "v1",
      });
      response.on("error", () => res.destroy());
      response.pipe(res);
      res.once("close", () => upstream.destroy());
    });
    if (upgrade) {
      upstream.once("upgrade", (response, remote, remoteHead) => {
        upstream.setTimeout(0);
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(
            response.headers,
          )
            .map(([key, value]) => `${key}: ${value}`)
            .join("\r\n")}\r\nX-Omnilodge-System-Ingress: v1\r\n\r\n`,
        );
        if (remoteHead.length) socket.write(remoteHead);
        if (head.length) remote.write(head);
        socket.on("error", () => remote.destroy());
        remote.on("error", () => socket.destroy());
        socket.once("end", () => {
          remote.destroy();
          socket.destroy();
        });
        remote.once("end", () => {
          socket.destroy();
          remote.destroy();
        });
        socket.once("close", () => remote.destroy());
        remote.once("close", () => socket.destroy());
        socket.pipe(remote);
        remote.pipe(socket);
      });
      socket.once("close", () => upstream.destroy());
      upstream.end();
    } else {
      let bytes = 0;
      req.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024 + 65536) {
          upstream.destroy();
          req.destroy();
        }
      });
      req.once("aborted", () => upstream.destroy());
      req.pipe(upstream);
    }
  };
  for (const prototype of [http.Server.prototype, https.Server.prototype]) {
    if (Object.hasOwn(prototype, installed)) continue;
    const original = prototype.emit;
    Object.defineProperty(prototype, installed, { value: true });
    prototype.emit = function (event, ...args) {
      if (
        (event === "request" || event === "upgrade") &&
        this.address()?.port !== port &&
        matches(args[0])
      ) {
        if (event === "request") proxy(args[0], args[1]);
        else proxy(args[0], undefined, args[1], args[2]);
        return true;
      }
      return Reflect.apply(original, this, [event, ...args]);
    };
  }
}

// --import executes before any release-owned application module is loaded.
if (
  process.execArgv.some(
    (value) =>
      value === import.meta.url ||
      pathToFileURL(value).href === import.meta.url,
  )
)
  installSystemIngress();
