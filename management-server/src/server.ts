import { testHost } from "./capabilities.js";
import { Recordings } from "./recordings.js";
import { assertProductionResources } from "./resources.js";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Authority } from "./authority.js";
import { Store, publicJobData } from "./store.js";
import { Terminals } from "./terminals.js";
import { Files } from "./files.js";
import { Fault, requireValue, type Action } from "./types.js";

const production = process.env.NODE_ENV === "production";
const origin =
  process.env.SYSTEM_MANAGEMENT_PUBLIC_ORIGIN ||
  (production ? "https://system.omni-lodge.com" : "http://localhost:3010");
const appOrigin =
  process.env.SYSTEM_MANAGEMENT_APP_ORIGIN ||
  (production ? "https://omni-lodge.com" : "http://localhost:3000");
const cookieName = production
  ? "__Host-omnilodge-management"
  : "omnilodge-management";
function cookie(req: http.IncomingMessage) {
  const values = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x.startsWith(cookieName + "="));
  requireValue(
    values.length <= 1,
    401,
    "INVALID_SESSION",
    "Invalid session cookie.",
  );
  return values[0]?.slice(cookieName.length + 1) || "";
}
function send(res: http.ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify(value, (_key, v) =>
      v &&
      typeof v === "object" &&
      typeof v.actorId === "number" &&
      typeof v.kind === "string" &&
      typeof v.state === "string" &&
      v.data
        ? { ...v, data: publicJobData(v.data) }
        : v,
    ),
  );
}
async function body(req: http.IncomingMessage, max = 262144) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    requireValue(
      length <= max,
      413,
      "TOO_LARGE",
      "Request exceeds its size limit.",
    );
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function start() {
  const effectiveResources = assertProductionResources();
  const authority = await Authority.fromEnvironment();
  const key = Buffer.from(
    (
      await fs.readFile(
        process.env.SYSTEM_MANAGEMENT_ARTIFACT_KEY_FILE || "",
        "utf8",
      )
    ).trim(),
    "base64",
  );
  const store = new Store(process.env.SYSTEM_MANAGEMENT_CONTROL_URL || "", key);
  await store.ready();
  const leader = await store.pool.connect();
  const elected = await leader.query(
    "SELECT pg_try_advisory_lock(hashtext('omnilodge.system-management.active')) AS acquired",
  );
  requireValue(
    elected.rows[0].acquired,
    503,
    "ALREADY_ACTIVE",
    "Another broker owns the active generation.",
  );
  await store.recover();
  const recordings = new Recordings(
    store,
    path.resolve(
      process.env.SYSTEM_MANAGEMENT_ARTIFACT_DIRECTORY ||
        "/var/lib/omnilodge-system/broker/recordings",
    ),
    key,
  );
  await recordings.recover();
  const recordingCleanup = setInterval(
    () => void recordings.cleanup().catch(() => {}),
    60000,
  );
  recordingCleanup.unref();
  const terminals = new Terminals(authority, store, recordings),
    files = new Files(authority, store);
  const csrf = (session: string) =>
    crypto
      .createHmac("sha256", key)
      .update("csrf:" + session)
      .digest("hex");
  const ui = path.resolve(
    process.env.SYSTEM_MANAGEMENT_UI_PATH ||
      fileURLToPath(new URL("../../management-ui/dist", import.meta.url)),
  );
  let draining = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors ${appOrigin}; base-uri 'none'; form-action 'none'; object-src 'none'`,
    );
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), clipboard-read=(self), clipboard-write=(self)",
    );
    try {
      const url = new URL(req.url || "/", origin),
        route = url.pathname;
      if (route === "/management/health/ready") {
        send(res, draining ? 503 : 200, {
          ok: !draining,
          service: "system-management",
          release: process.env.APP_VERSION || "development",
          resources: effectiveResources,
        });
        return;
      }
      requireValue(
        req.headers.host === new URL(origin).host ||
          (!production && req.headers.host === "localhost:3011"),
        421,
        "HOST_REJECTED",
        "Unknown management host.",
      );
      if (req.method !== "GET" && req.method !== "HEAD")
        requireValue(
          req.headers.origin ===
            (route === "/management/session/launch" ? appOrigin : origin),
          403,
          "ORIGIN_REJECTED",
          "Management origin required.",
        );
      if (!route.startsWith("/management/")) {
        requireValue(
          req.method === "GET",
          405,
          "METHOD_NOT_ALLOWED",
          "Method not allowed.",
        );
        const file =
          route === "/" ? "index.html" : decodeURIComponent(route.slice(1));
        requireValue(
          /^(?:index\.html|assets\/[a-zA-Z0-9_.-]+)$/.test(file) &&
            !file.endsWith(".map"),
          404,
          "NOT_FOUND",
          "Asset not found.",
        );
        const bytes = await fs.readFile(path.join(ui, file));
        const extension = path.extname(file);
        res.setHeader(
          "Content-Type",
          (
            {
              ".html": "text/html; charset=utf-8",
              ".js": "text/javascript; charset=utf-8",
              ".css": "text/css; charset=utf-8",
              ".woff2": "font/woff2",
              ".svg": "image/svg+xml",
            } as Record<string, string>
          )[extension] || "application/octet-stream",
        );
        res.end(bytes);
        return;
      }
      requireValue(
        !draining,
        503,
        "DRAINING",
        "Administration is draining for a release.",
      );
      const readOnly = new Set([
        "/management/session",
        "/management/sessions",
        "/management/files/list",
        "/management/files/content",
        "/management/download",
        "/management/jobs",
        "/management/activity",
        "/management/overview",
        "/management/services",
        "/management/logs",
        "/management/profiles",
        "/management/download-folder",
        "/management/trash",
        "/management/recordings",
        "/management/recording",
        "/management/recording/download",
      ]);
      requireValue(
        req.method ===
          (readOnly.has(route)
            ? "GET"
            : route.endsWith("/chunks")
              ? "PUT"
              : "POST"),
        405,
        "METHOD_NOT_ALLOWED",
        "This operation does not support that HTTP method.",
      );
      if (route === "/management/session/launch" && req.method === "POST") {
        const form = new URLSearchParams((await body(req, 4096)).toString()),
          result = await authority.rpc<{ token: string }>("redeem", {
            grant: form.get("grant"),
            origin,
            existingSession: cookie(req),
          });
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=${result.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200${production ? "; Secure" : ""}`,
        );
        res.statusCode = 303;
        res.setHeader("Location", "/");
        res.end();
        return;
      }
      if (route === "/management/session/redeem" && req.method === "POST") {
        const input = JSON.parse((await body(req, 4096)).toString());
        const result = await authority.rpc<{ token: string }>("redeem", {
          grant: input.grant,
          origin,
          existingSession: cookie(req),
        });
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=${result.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200${production ? "; Secure" : ""}`,
        );
        send(res, 200, { ok: true });
        return;
      }
      const token = cookie(req);
      requireValue(
        token,
        401,
        "SIGN_IN_REQUIRED",
        "Open System Management from Settings.",
      );
      if (req.method !== "GET")
        requireValue(
          req.headers["x-management-csrf"] === csrf(token),
          403,
          "CSRF_REJECTED",
          "Refresh the management session before continuing.",
        );
      if (route === "/management/session" && req.method === "GET") {
        send(res, 200, {
          ...(await authority.check(token)),
          csrf: csrf(token),
        });
        return;
      }
      const input =
        req.method === "GET"
          ? Object.fromEntries(url.searchParams)
          : route.endsWith("/chunks")
            ? {}
            : JSON.parse((await body(req, 3 * 1048576)).toString() || "{}");
      if (route === "/management/session/touch") {
        send(res, 200, await authority.rpc("touch", { session: token }));
        return;
      }
      if (route === "/management/session/step-up") {
        send(
          res,
          200,
          await authority.rpc("step-up", {
            session: token,
            password: input.password,
          }),
        );
        return;
      }
      if (route === "/management/session/logout") {
        await authority.rpc("logout", { session: token });
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${production ? "; Secure" : ""}`,
        );
        send(res, 200, { ok: true });
        return;
      }
      if (route === "/management/profiles") {
        send(res, 200, await authority.rpc("profiles", { session: token }));
        return;
      }
      if (
        route === "/management/config" ||
        route === "/management/credentials"
      ) {
        send(
          res,
          200,
          await authority.rpc(
            route.endsWith("credentials") ? "credentials" : "config",
            { ...input, session: token },
          ),
        );
        return;
      }
      const ctx = await authority.check(token);
      store.configure(ctx);
      const requireAction = async (action: Action) => {
        await authority.check(token, action);
      };
      if (route === "/management/hosts/test") {
        await requireAction("readFiles");
        send(
          res,
          200,
          await testHost(authority, store, token, ctx, input.hostId),
        );
        return;
      }
      if (route === "/management/sessions") {
        send(res, 200, { sessions: await terminals.list(token, ctx) });
        return;
      }
      if (route === "/management/terminals" && req.method === "POST") {
        await requireAction("connectTerminal");
        send(
          res,
          201,
          await terminals.create(
            token,
            ctx,
            input.hostId,
            Number(input.cols) || 100,
            Number(input.rows) || 28,
          ),
        );
        return;
      }
      const terminal = route.match(
        /^\/management\/terminals\/([0-9a-f-]{36})\/(attach-ticket|terminate)$/,
      );
      if (terminal) {
        await requireAction("connectTerminal");
        send(
          res,
          200,
          terminal[2] === "attach-ticket"
            ? await terminals.ticket(
                token,
                ctx,
                terminal[1],
                input.takeover === true,
              )
            : await terminals.terminate(token, ctx, terminal[1], input.reason),
        );
        return;
      }
      if (route === "/management/files/list") {
        send(
          res,
          200,
          await files.list(
            token,
            ctx,
            input.hostId,
            input.rootId,
            input.path || ".",
          ),
        );
        return;
      }
      if (route === "/management/files/content" && req.method === "GET") {
        send(
          res,
          200,
          await files.read(token, ctx, input.hostId, input.rootId, input.path),
        );
        return;
      }
      if (route === "/management/files/compare") {
        await requireAction("writeFiles");
        send(res, 201, await files.compare(token, ctx, input));
        return;
      }
      if (route === "/management/files/copy-plan") {
        await requireAction("writeFiles");
        send(res, 200, await files.copyPlan(token, ctx, input.id));
        return;
      }
      if (route === "/management/file-operations/review") {
        await requireAction(
          input.operation === "delete" || input.operation === "trash"
            ? "deleteFiles"
            : input.operation === "chmod"
              ? "changePermissions"
              : "writeFiles",
        );
        send(res, 201, await files.review(token, ctx, input));
        return;
      }
      if (route === "/management/file-operations/execute") {
        send(res, 200, await files.execute(token, ctx, input.id));
        return;
      }
      if (route === "/management/download-folder" && req.method === "GET") {
        await requireAction("readFiles");
        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(path.posix.basename(input.path || "folder"))}.zip`,
        );
        await files.downloadFolder(
          token,
          ctx,
          input.hostId,
          input.rootId,
          input.path,
          res,
        );
        return;
      }
      if (route === "/management/download" && req.method === "GET") {
        await requireAction("readFiles");
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(path.posix.basename(input.path || "download"))}`,
        );
        await files.download(
          token,
          ctx,
          input.hostId,
          input.rootId,
          input.path,
          res,
        );
        return;
      }
      if (route === "/management/transfers" && req.method === "POST") {
        await requireAction("transfer");
        send(res, 201, await files.uploadCreate(token, ctx, input));
        return;
      }
      const transfer = route.match(
        /^\/management\/transfers\/([0-9a-f-]{36})\/(chunks|publish|resume|cancel)$/,
      );
      if (transfer) {
        await requireAction("transfer");
        if (transfer[2] === "chunks") {
          const bytes = await body(req, 4194304);
          send(
            res,
            200,
            await files.chunk(
              token,
              ctx,
              transfer[1],
              Number(req.headers["x-upload-offset"]),
              bytes,
              String(req.headers["x-chunk-sha256"] || ""),
            ),
          );
        } else if (transfer[2] === "resume")
          send(
            res,
            200,
            await files.resume(token, ctx, transfer[1], input.sha256),
          );
        else if (transfer[2] === "publish")
          send(res, 200, await files.publish(token, ctx, transfer[1]));
        else send(res, 200, await files.cancel(token, ctx, transfer[1]));
        return;
      }
      if (route === "/management/jobs") {
        await requireAction("viewActivity");
        send(res, 200, { jobs: await store.list(ctx.actorId, input.kind) });
        return;
      }
      if (route === "/management/trash") {
        send(
          res,
          200,
          await files.adapter(
            token,
            input.hostId,
            "trashList",
            { rootId: input.rootId },
            "readFiles",
          ),
        );
        return;
      }
      if (route === "/management/operations/reconcile") {
        const job = await store.get(input.id, ctx.actorId);
        await requireAction("view");
        const result = await files.adapter(
          token,
          job.hostId,
          "status",
          { operationId: job.id },
          "view",
        );
        if (["completed", "failed"].includes(String(result.state))) {
          await store.update(job, String(result.state), {
            outcome: result.result,
          });
          await store.event(
            ctx.actorId,
            job.hostId,
            "operation.reconciled",
            String(result.state),
            job.id,
          );
        }
        send(res, 200, result);
        return;
      }
      if (route === "/management/recordings") {
        await requireAction("viewRecordings");
        send(res, 200, { recordings: await recordings.list(ctx.actorId) });
        return;
      }
      if (
        route === "/management/recording" ||
        route === "/management/recording/download"
      ) {
        await requireAction("viewRecordings");
        const artifact = await recordings.metadata(ctx.actorId, input.id);
        await authority.rpc("authorize", {
          session: token,
          hostId: artifact.host_id,
          action: "viewRecordings",
        });
        if (route.endsWith("/download")) {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="terminal-${input.id}.txt"`,
          );
          await recordings.download(ctx.actorId, input.id, res);
        } else send(res, 200, await recordings.read(ctx.actorId, input.id));
        return;
      }
      if (route === "/management/activity") {
        await requireAction("viewActivity");
        send(res, 200, {
          events: await store.activity(ctx.actorId, input.before),
        });
        return;
      }
      if (
        route === "/management/overview" ||
        route === "/management/services"
      ) {
        send(
          res,
          200,
          await files.adapter(
            token,
            input.hostId,
            route.endsWith("overview") ? "metrics" : "services",
            {},
            "view",
          ),
        );
        return;
      }
      if (route === "/management/logs") {
        await requireAction("viewLogs");
        send(
          res,
          200,
          await files.adapter(
            token,
            input.hostId,
            "logs",
            {
              serviceId: input.serviceId,
              lines: Math.min(2000, Number(input.lines) || 200),
            },
            "viewLogs",
          ),
        );
        return;
      }
      if (route === "/management/services/restart") {
        await requireAction("controlServices");
        requireValue(
          typeof input.reason === "string" &&
            input.reason.trim().length >= 3 &&
            input.confirm === input.serviceId,
          400,
          "REVIEW_REQUIRED",
          "Confirm the service name and record a reason.",
        );
        const job = await store.create(
          ctx.actorId,
          input.hostId,
          "restart",
          { serviceId: input.serviceId, reason: input.reason },
          input.idempotencyKey,
        );
        if (job.state === "queued") {
          await store.update(job, "running");
          void files
            .adapter(
              token,
              input.hostId,
              "restart",
              { serviceId: input.serviceId, operationId: job.id, fence: 1 },
              "controlServices",
            )
            .then((result) =>
              store.update(
                job,
                result.verifiedHealthy === true ? "completed" : "running",
                { result },
              ),
            )
            .catch(() => store.update(job, "outcome_unknown"));
        }
        send(res, 202, job);
        return;
      }
      throw new Fault(404, "NOT_FOUND", "Management route not found.");
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      send(res, error instanceof Fault ? error.status : 503, {
        code: error instanceof Fault ? error.code : "OPERATION_FAILED",
        message:
          error instanceof Fault
            ? error.message
            : "The operation could not be confirmed. Check Activity before retrying.",
      });
    }
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 65536,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    try {
      requireValue(
        !draining &&
          req.url === "/management/stream" &&
          req.headers.origin === origin &&
          req.headers.host === new URL(origin).host,
        403,
        "ORIGIN_REJECTED",
        "Stream denied.",
      );
      const token = cookie(req);
      requireValue(token, 401, "SIGN_IN_REQUIRED", "Authentication required.");
      wss.handleUpgrade(req, socket, head, (ws) => {
        const timeout = setTimeout(
          () => ws.close(4003, "Attachment ticket required."),
          5000,
        );
        ws.once("message", (raw) => {
          clearTimeout(timeout);
          try {
            void terminals
              .attach(ws, token, JSON.parse(raw.toString()))
              .catch(() => ws.close(4003, "Attachment denied."));
          } catch {
            ws.close(4003, "Invalid attachment.");
          }
        });
      });
    } catch {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  server.maxHeadersCount = 64;
  const port = Number(process.env.SYSTEM_MANAGEMENT_PORT || 3011);
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  const stop = async () => {
    draining = true;
    clearInterval(recordingCleanup);
    await terminals.drain();
    wss.close();
    server.close();
    leader.release();
    await store.pool.end();
  };
  if (process.env.SYSTEM_MANAGEMENT_PARENT_PID) {
    const parent = Number(process.env.SYSTEM_MANAGEMENT_PARENT_PID),
      expected = process.env.SYSTEM_MANAGEMENT_PARENT_START;
    const watcher = setInterval(() => {
      void fs
        .readFile(`/proc/${parent}/stat`, "utf8")
        .then((stat) => {
          const start = stat
            .slice(stat.lastIndexOf(")") + 2)
            .trim()
            .split(/\s+/)[19];
          if (start !== expected) {
            clearInterval(watcher);
            void stop();
          }
        })
        .catch(() => {
          clearInterval(watcher);
          void stop();
        });
    }, 3000);
    watcher.unref();
  }
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
  return { server, store, stop };
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  start().catch(() => {
    process.stderr.write(
      "System Management startup failed. Check protected bootstrap configuration and journal readiness.\n",
    );
    process.exitCode = 1;
  });
