import path from "node:path";
import { decodeText } from "./textFiles.js";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import yazl from "yazl";
import type { Writable, Readable } from "node:stream";
import type { Client, SFTPWrapper, Stats } from "ssh2";
import { Authority } from "./authority.js";
import { Store, type Job } from "./store.js";
import { connect, sftp, execAdapter } from "./ssh.js";
import {
  Fault,
  requireValue,
  limit,
  type Context,
  type Host,
  type Root,
  type Action,
} from "./types.js";

export function safeRelative(value: unknown): string {
  requireValue(
    typeof value === "string" &&
      Buffer.byteLength(value) <= 4096 &&
      !/[\0\\]/.test(value) &&
      !value.startsWith("/") &&
      !value
        .split("/")
        .some((part) => part === ".." || part.startsWith(".omnilodge-")),
    400,
    "INVALID_PATH",
    "Choose a path inside the selected root.",
  );
  return path.posix.normalize(value || ".");
}
export function remotePath(root: Root, relative: string) {
  const base = path.posix.resolve(root.path);
  const p = path.posix.resolve(base, relative);
  requireValue(
    p === base || p.startsWith(base.replace(/\/$/, "") + "/"),
    403,
    "PROTECTED_PATH",
    "Path leaves the approved root.",
  );
  return p;
}
export function fingerprint(stat: Stats) {
  return `${stat.size}:${stat.mtime}:${stat.mode}:${stat.uid}:${stat.gid}`;
}
export const stat = (s: SFTPWrapper, p: string) =>
  new Promise<Stats>((resolve, reject) =>
    s.lstat(p, (e, v) => (e ? reject(e) : resolve(v))),
  );
export const rename = (s: SFTPWrapper, a: string, b: string) =>
  new Promise<void>((resolve, reject) =>
    s.ext_openssh_rename(a, b, (e) => (e ? reject(e) : resolve())),
  );
export const unlink = (s: SFTPWrapper, p: string) =>
  new Promise<void>((resolve, reject) =>
    s.unlink(p, (e) => (e ? reject(e) : resolve())),
  );
export const mkdir = (s: SFTPWrapper, p: string) =>
  new Promise<void>((resolve, reject) =>
    s.mkdir(p, { mode: 0o700 }, (e) => (e ? reject(e) : resolve())),
  );
async function boundedRead(s: SFTPWrapper, p: string, max: number) {
  const chunks: Buffer[] = [];
  let count = 0;
  for await (const chunk of s.createReadStream(p)) {
    count += chunk.length;
    requireValue(
      count <= max,
      413,
      "TOO_LARGE",
      "File is too large for the text editor.",
    );
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function digest(s: SFTPWrapper, p: string) {
  const h = crypto.createHash("sha256");
  for await (const chunk of s.createReadStream(p)) h.update(chunk);
  return h.digest("hex");
}
export class Files {
  private locks = new Map<string, Promise<unknown>>();
  private active = 0;
  private actorStreams = new Map<number, number>();
  private admit(ctx: Context) {
    const own = this.actorStreams.get(ctx.actorId) || 0;
    requireValue(
      this.active < limit(ctx, "TRANSFER_LIMITS", "total", 2) &&
        own < limit(ctx, "TRANSFER_LIMITS", "perActor", 1),
      429,
      "CAPACITY_EXCEEDED",
      "Transfer concurrency is full. Pause another transfer and retry.",
    );
    this.active++;
    this.actorStreams.set(ctx.actorId, own + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const remaining = (this.actorStreams.get(ctx.actorId) || 1) - 1;
      if (remaining) this.actorStreams.set(ctx.actorId, remaining);
      else this.actorStreams.delete(ctx.actorId);
    };
  }
  constructor(
    private authority: Authority,
    private store: Store,
  ) {}
  async withRoot<T>(
    session: string,
    ctx: Context,
    hostId: string,
    rootId: string,
    action: Action,
    fn: (client: Client, s: SFTPWrapper, host: Host, root: Root) => Promise<T>,
    stream = false,
  ): Promise<T> {
    const release = stream ? this.admit(ctx) : () => {};
    let client: Client | undefined,
      timer: NodeJS.Timeout | undefined,
      checking = false;
    try {
      const c = await this.authority.connection(
          session,
          hostId,
          "sftp",
          action,
        ),
        root = c.host.roots.find((r) => r.id === rootId);
      requireValue(
        root,
        403,
        "PROTECTED_PATH",
        "This file root is not approved.",
      );
      if (
        ["writeFiles", "deleteFiles", "changePermissions", "transfer"].includes(
          action,
        )
      )
        requireValue(
          root.writable,
          403,
          "PROTECTED_PATH",
          "This root is read-only.",
        );
      client = await connect(c);
      const current = client;
      timer = setInterval(
        () => {
          if (checking) return;
          checking = true;
          void this.authority
            .rpc("authorize", { session, hostId, action, ongoing: true })
            .catch(() => current.destroy())
            .finally(() => {
              checking = false;
            });
        },
        Math.min(15, limit(ctx, "SESSION_POLICY", "authoritySeconds", 15)) *
          1000,
      );
      timer.unref();
      return await fn(client, await sftp(client), c.host, root);
    } finally {
      if (timer) clearInterval(timer);
      client?.end();
      release();
    }
  }
  async adapter(
    session: string,
    hostId: string,
    operation: string,
    params: unknown,
    action: Action,
  ) {
    const c = await this.authority.connection(
        session,
        hostId,
        "terminal",
        action,
      ),
      client = await connect(c);
    try {
      const accepted = await execAdapter(
        client,
        await this.authority.ticket(session, hostId, operation, params, action),
      );
      if (!accepted.queued) return accepted;
      const id = String(accepted.operationId),
        deadline = Date.now() + 1200000;
      let renewAt = 0;
      while (Date.now() < deadline) {
        const result = await execAdapter(
          client,
          await this.authority.ticket(
            session,
            hostId,
            "status",
            { operationId: id },
            "view",
          ),
        );
        if (result.state === "completed")
          return result.result as Record<string, unknown>;
        if (!["queued", "running"].includes(String(result.state)))
          throw new Fault(
            409,
            "OUTCOME_UNKNOWN",
            "The remote operation needs reconciliation. It will not be replayed.",
          );
        if (Date.now() >= renewAt) {
          await execAdapter(
            client,
            await this.authority.ticket(
              session,
              hostId,
              "renewOperation",
              { operationId: id },
              "writeFiles",
            ),
          );
          renewAt = Date.now() + 15000;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Fault(
        504,
        "OUTCOME_UNKNOWN",
        "The operation exceeded its bounded runtime. Verify its outcome before retrying.",
      );
    } finally {
      client.end();
    }
  }
  private async noLinks(
    s: SFTPWrapper,
    root: Root,
    relative: string,
    allowMissingLast = false,
  ) {
    const pieces = relative.split("/").filter((x) => x && x !== ".");
    let current = root.path;
    for (let i = 0; i < pieces.length; i++) {
      current = path.posix.join(current, pieces[i]);
      try {
        const attrs = await stat(s, current);
        requireValue(
          !attrs.isSymbolicLink(),
          403,
          "PROTECTED_PATH",
          "Symbolic links cannot be traversed by the file manager.",
        );
      } catch (error) {
        if (
          allowMissingLast &&
          i === pieces.length - 1 &&
          (error as { code?: number }).code === 2
        )
          return;
        throw error;
      }
    }
  }
  async list(
    session: string,
    ctx: Context,
    hostId: string,
    rootId: string,
    relative: string,
  ) {
    relative = safeRelative(relative);
    return this.withRoot(
      session,
      ctx,
      hostId,
      rootId,
      "readFiles",
      async (_client, s, _host, root) => {
        await this.noLinks(s, root, relative);
        const max = limit(ctx, "FILE_POLICY", "inventoryEntries", 100000);
        const handle = await new Promise<Buffer>((resolve, reject) =>
          s.opendir(remotePath(root, relative), (e, h) =>
            e ? reject(e) : resolve(h),
          ),
        );
        const entries: unknown[] = [];
        let complete = true,
          inventoryBytes = 0;
        try {
          for (;;) {
            const batch = await new Promise<
              false | { filename: string; attrs: Stats }[]
            >((resolve, reject) =>
              s.readdir(handle, (e, list) =>
                e && (e as { code?: number }).code !== 1
                  ? reject(e)
                  : resolve(list || false),
              ),
            );
            if (!batch) break;
            for (const item of batch) {
              if (
                [".", ".."].includes(item.filename) ||
                item.filename.startsWith(".omnilodge-")
              )
                continue;
              inventoryBytes +=
                Buffer.byteLength(path.posix.join(relative, item.filename)) +
                Buffer.byteLength(item.filename) +
                160;
              if (
                entries.length >= max ||
                inventoryBytes >
                  limit(ctx, "FILE_POLICY", "inventoryBytes", 16777216)
              ) {
                complete = false;
                break;
              }
              entries.push({
                name: item.filename,
                path: path.posix.join(relative, item.filename),
                size: String(item.attrs.size),
                mtime: item.attrs.mtime,
                mode: item.attrs.mode,
                uid: item.attrs.uid,
                gid: item.attrs.gid,
                type: item.attrs.isDirectory()
                  ? "directory"
                  : item.attrs.isSymbolicLink()
                    ? "link"
                    : item.attrs.isFile()
                      ? "file"
                      : "special",
                version: fingerprint(item.attrs),
              });
            }
            if (!complete) break;
          }
        } finally {
          await new Promise<void>((resolve) =>
            s.close(handle, () => resolve()),
          );
        }
        return {
          entries,
          complete,
          path: relative,
          rootId,
          guarantee: root.managed
            ? "managed"
            : "remote OS confinement required; directory view is not a snapshot",
        };
      },
      true,
    );
  }
  async read(
    session: string,
    ctx: Context,
    hostId: string,
    rootId: string,
    relative: string,
  ) {
    relative = safeRelative(relative);
    return this.withRoot(
      session,
      ctx,
      hostId,
      rootId,
      "readFiles",
      async (_c, s, _h, root) => {
        await this.noLinks(s, root, relative);
        const p = remotePath(root, relative),
          before = await stat(s, p);
        requireValue(
          before.isFile() &&
            before.size <= limit(ctx, "FILE_POLICY", "editBytes", 2097152),
          413,
          "TOO_LARGE",
          "Only regular text files within the editor limit can be opened.",
        );
        const bytes = await boundedRead(
          s,
          p,
          limit(ctx, "FILE_POLICY", "editBytes", 2097152),
        );
        const decoded = decodeText(bytes);
        requireValue(
          fingerprint(before) === fingerprint(await stat(s, p)),
          409,
          "VERSION_CONFLICT",
          "File changed while reading. Refresh and try again.",
        );
        return {
          ...decoded,
          version: fingerprint(before),
          sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
          path: relative,
          size: String(bytes.length),
        };
      },
    );
  }
  async review(session: string, ctx: Context, input: Record<string, unknown>) {
    const hostId = String(input.hostId),
      rootId = String(input.rootId),
      relative = safeRelative(input.path),
      operation = String(input.operation);
    const action: Action = ["delete", "trash"].includes(operation)
      ? "deleteFiles"
      : operation === "chmod"
        ? "changePermissions"
        : "writeFiles";
    requireValue(
      [
        "save",
        "mkdir",
        "rename",
        "copy",
        "trash",
        "delete",
        "chmod",
        "restore",
      ].includes(operation),
      400,
      "INVALID_OPERATION",
      "Unknown file operation.",
    );
    await this.authority.rpc("authorize", { session, hostId, action });
    const approvedRoot = ctx.hosts
      .find((h) => h.id === hostId)
      ?.roots.find((r) => r.id === rootId);
    requireValue(
      approvedRoot?.writable,
      403,
      "PROTECTED_PATH",
      "Choose an approved writable root.",
    );
    if (operation === "chmod")
      requireValue(
        Number.isInteger(input.mode) &&
          Number(input.mode) >= 0 &&
          Number(input.mode) <= 0o777 &&
          (!approvedRoot.managed || (Number(input.mode) & 0o022) === 0),
        400,
        "INVALID_MODE",
        approvedRoot.managed
          ? "Managed files must remain unwritable by group and other users. Use ordinary permission bits such as 640 or 750."
          : "Only ordinary permission bits are supported.",
      );
    const source =
      operation === "mkdir" ||
      operation === "restore" ||
      (operation === "save" && input.createOnly === true)
        ? null
        : await this.withRoot(
            session,
            ctx,
            hostId,
            rootId,
            action,
            async (_c, s, _h, r) => {
              await this.noLinks(s, r, relative);
              return fingerprint(await stat(s, remotePath(r, relative)));
            },
          );
    if (input.version)
      requireValue(
        input.version === source,
        409,
        "VERSION_CONFLICT",
        "The file changed. Reload before reviewing.",
      );
    const data: Record<string, unknown> = {
      ...input,
      path: relative,
      hostId,
      rootId,
      operation,
      source,
      expires: Date.now() + 60000,
      policyHash: ctx.policyHash,
      reason: String(input.reason || "File management").slice(0, 500),
    };
    if (input.target !== undefined) data.target = safeRelative(input.target);
    if (operation === "copy") {
      requireValue(
        data.target && data.target !== relative,
        400,
        "INVALID_PATH",
        "Choose a different copy destination.",
      );
      const destination = await this.destination(
        session,
        ctx,
        { hostId, rootId, path: data.target },
        "writeFiles",
      );
      requireValue(
        !destination.exists || input.overwrite === true,
        409,
        "DESTINATION_CONFLICT",
        "Destination exists. Choose another path or explicitly review replacement.",
      );
      data.targetVersion = destination.version;
      data.targetSha256 = destination.sha256;
    }
    if (operation === "save")
      requireValue(
        typeof input.text === "string" &&
          Buffer.byteLength(input.text) + (input.bom === true ? 3 : 0) <=
            limit(ctx, "FILE_POLICY", "editBytes", 2097152),
        413,
        "TOO_LARGE",
        "Edited text is too large.",
      );
    if (operation === "save" && input.createOnly !== true) {
      const currentHash = await this.withRoot(
        session,
        ctx,
        hostId,
        rootId,
        "writeFiles",
        async (_c, s, _h, r) => {
          const name = remotePath(r, relative),
            before = await stat(s, name);
          requireValue(
            before.isFile() &&
              before.size <= limit(ctx, "FILE_POLICY", "editBytes", 2097152),
            413,
            "TOO_LARGE",
            "The existing file is too large for a text replacement.",
          );
          const hash = await digest(s, name);
          requireValue(
            fingerprint(await stat(s, name)) === source,
            409,
            "VERSION_CONFLICT",
            "The original file changed during review.",
          );
          return hash;
        },
      );
      if (input.sha256 !== undefined)
        requireValue(
          input.sha256 === currentHash,
          409,
          "VERSION_CONFLICT",
          "The original file content changed since opening.",
        );
      data.sha256 = currentHash;
    }
    if (operation === "delete" || operation === "trash") {
      const kind = await this.withRoot(
        session,
        ctx,
        hostId,
        rootId,
        action,
        async (_c, s, _h, r) =>
          (await stat(s, remotePath(r, relative))).isDirectory()
            ? "directory"
            : "file",
      );
      if (kind === "directory") {
        requireValue(
          ctx.hosts
            .find((h) => h.id === hostId)
            ?.roots.find((r) => r.id === rootId)?.managed,
          409,
          "CAPABILITY_UNAVAILABLE",
          "Recursive operations require a managed root.",
        );
        const inventory = await this.inventory(
          session,
          ctx,
          hostId,
          rootId,
          relative,
        );
        const rows = inventory
          .map((i) => `${i.relative}\0${i.type}\0${i.version}\n`)
          .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
        data.manifestHash = crypto
          .createHash("sha256")
          .update(rows.join(""))
          .digest("hex");
        data.manifestCount = inventory.length;
        data.recursive = true;
      }
      data.trashBytes = limit(ctx, "STORAGE_POLICY", "trashBytes", 268435456);
      data.trashDays = limit(ctx, "RETENTION", "trashDays", 7);
    }
    const job = await this.store.create(
      ctx.actorId,
      hostId,
      "file-operation",
      data,
    );
    await this.store.update(job, "reviewed");
    return {
      id: job.id,
      operation,
      path: relative,
      target: input.target,
      version: source,
      affectedEntries: data.manifestCount,
      expiresAt: data.expires,
      managed: ctx.hosts
        .find((h) => h.id === hostId)
        ?.roots.find((r) => r.id === rootId)?.managed,
      warning:
        operation === "delete"
          ? "Permanent deletion cannot be undone."
          : undefined,
    };
  }
  private async serialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }
  async execute(session: string, ctx: Context, id: string) {
    return this.serialize(id, async () => {
      const job = await this.store.get(id, ctx.actorId),
        d = job.data;
      if (job.state === "completed") return job;
      requireValue(
        job.state === "reviewed" &&
          Number(d.expires) > Date.now() &&
          d.policyHash === ctx.policyHash,
        409,
        "REVIEW_EXPIRED",
        "Review expired or this operation has already been submitted.",
      );
      const operation = String(d.operation),
        action: Action = ["trash", "delete"].includes(operation)
          ? "deleteFiles"
          : operation === "chmod"
            ? "changePermissions"
            : "writeFiles";
      await this.store.update(job, "running");
      try {
        await this.withRoot(
          session,
          ctx,
          job.hostId,
          String(d.rootId),
          action,
          async (_c, s, host, root) => {
            const relative = safeRelative(d.path),
              p = remotePath(root, relative);
            await this.noLinks(
              s,
              root,
              relative,
              operation === "mkdir" ||
                operation === "restore" ||
                (operation === "save" && d.createOnly === true),
            );
            if (d.source)
              requireValue(
                fingerprint(await stat(s, p)) === d.source,
                409,
                "VERSION_CONFLICT",
                "Source changed since review.",
              );
            if (host.managed && root.managed) {
              const params: Record<string, unknown> = {
                ...d,
                rootId: root.id,
                operationId: id,
                fence: 1,
                originalSha256: d.sha256,
              };
              delete params.text;
              if (operation === "save") {
                const bytes = Buffer.from(
                  (d.bom ? "\ufeff" : "") + String(d.text),
                  "utf8",
                );
                await this.adapter(
                  session,
                  job.hostId,
                  "registerStaging",
                  { rootId: root.id, stagingId: id },
                  "writeFiles",
                );
                const staging = `/.staging/${id}`;
                await this.writeExclusive(s, staging, bytes);
                Object.assign(params, {
                  stagingId: id,
                  sha256: crypto
                    .createHash("sha256")
                    .update(bytes)
                    .digest("hex"),
                  size: bytes.length,
                });
              }
              await this.adapter(
                session,
                job.hostId,
                operation === "save" ? "publish" : operation,
                params,
                action,
              );
              return;
            }
            requireValue(
              !["trash", "restore"].includes(operation),
              409,
              "CAPABILITY_UNAVAILABLE",
              "Recoverable trash requires a managed root. Choose permanent deletion explicitly.",
            );
            if (operation === "mkdir") await mkdir(s, p);
            else if (operation === "chmod") {
              const mode = Number(d.mode);
              requireValue(
                Number.isInteger(mode) && mode >= 0 && mode <= 0o777,
                400,
                "INVALID_MODE",
                "Only ordinary owner/group/other permission bits are allowed.",
              );
              await new Promise<void>((resolve, reject) =>
                s.chmod(p, mode, (e) => (e ? reject(e) : resolve())),
              );
            } else if (operation === "delete") {
              const attrs = await stat(s, p);
              requireValue(
                attrs.isFile() || attrs.isSymbolicLink(),
                409,
                "CAPABILITY_UNAVAILABLE",
                "Recursive permanent deletion requires a managed root and reviewed inventory.",
              );
              await unlink(s, p);
            } else if (operation === "rename") {
              const target = safeRelative(d.target);
              await this.noLinks(s, root, target, true);
              await new Promise<void>((resolve, reject) =>
                s.rename(p, remotePath(root, target), (e) =>
                  e ? reject(e) : resolve(),
                ),
              );
            } else if (operation === "save") {
              requireValue(
                d.createOnly === true || (await digest(s, p)) === d.sha256,
                409,
                "VERSION_CONFLICT",
                "File content changed since opening.",
              );
              const temporary = remotePath(
                root,
                path.posix.join(
                  path.posix.dirname(relative),
                  `.omnilodge-${id}.partial`,
                ),
              );
              await this.writeExclusive(
                s,
                temporary,
                Buffer.from((d.bom ? "\ufeff" : "") + String(d.text), "utf8"),
              );
              if (d.createOnly !== true) {
                requireValue(
                  fingerprint(await stat(s, p)) === d.source,
                  409,
                  "VERSION_CONFLICT",
                  "File changed before publication. Temporary content was retained.",
                );
                await rename(s, temporary, p);
              } else
                await new Promise<void>((resolve, reject) =>
                  s.rename(temporary, p, (e) => (e ? reject(e) : resolve())),
                );
            } else if (operation === "copy") {
              const target = remotePath(root, safeRelative(d.target));
              await this.noLinks(s, root, safeRelative(d.target), true);
              const attrs = await stat(s, p);
              requireValue(
                attrs.isFile(),
                409,
                "CAPABILITY_UNAVAILABLE",
                "Folder copy requires the managed adapter.",
              );
              const capacity = await this.capacity(
                session,
                ctx,
                job.hostId,
                s,
                host,
                root,
              );
              requireValue(
                attrs.size <=
                  limit(ctx, "TRANSFER_LIMITS", "fileBytes", 10737418240) &&
                  capacity.free - attrs.size >= capacity.reserve,
                507,
                "CAPACITY_EXCEEDED",
                "Copy exceeds the file or destination reserve limit.",
              );
              const temporary = remotePath(
                  root,
                  path.posix.join(
                    path.posix.dirname(safeRelative(d.target)),
                    `.omnilodge-${id}.partial`,
                  ),
                ),
                hash = crypto.createHash("sha256");
              try {
                await pipeline(
                  s.createReadStream(p),
                  new Transform({
                    transform(chunk, _encoding, callback) {
                      hash.update(chunk);
                      callback(null, chunk);
                    },
                  }),
                  s.createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
                );
                const copied = hash.digest("hex");
                requireValue(
                  fingerprint(await stat(s, p)) === fingerprint(attrs) &&
                    (await digest(s, p)) === copied &&
                    (await digest(s, temporary)) === copied,
                  409,
                  "SOURCE_CHANGED",
                  "Source changed while copying. The destination was not published.",
                );
                if (d.targetVersion) {
                  requireValue(
                    fingerprint(await stat(s, target)) === d.targetVersion &&
                      (await digest(s, target)) === d.targetSha256,
                    409,
                    "VERSION_CONFLICT",
                    "Copy destination changed since review.",
                  );
                  await rename(s, temporary, target);
                } else
                  await new Promise<void>((resolve, reject) =>
                    s.rename(temporary, target, (e) =>
                      e ? reject(e) : resolve(),
                    ),
                  );
              } finally {
                await unlink(s, temporary).catch(() => {});
              }
            }
          },
        );
        await this.store.update(job, "completed");
        await this.store.event(
          ctx.actorId,
          job.hostId,
          operation,
          "completed",
          job.id,
        );
        return job;
      } catch (error) {
        await this.store.update(
          job,
          error instanceof Fault &&
            [
              "VERSION_CONFLICT",
              "PROTECTED_PATH",
              "CAPABILITY_UNAVAILABLE",
            ].includes(error.code)
            ? "failed"
            : "outcome_unknown",
          {
            error:
              error instanceof Fault
                ? error.message
                : "Operation outcome is unconfirmed. Inspect the destination before retrying.",
          },
        );
        throw error;
      }
    });
  }
  private async writeExclusive(s: SFTPWrapper, p: string, bytes: Buffer) {
    const writer = s.createWriteStream(p, { flags: "wx", mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      writer.once("error", reject);
      writer.once("close", resolve);
      writer.end(bytes);
    });
  }
  async download(
    session: string,
    ctx: Context,
    hostId: string,
    rootId: string,
    relative: string,
    response: Writable,
    expectedVersion?: string,
    range?: string,
    ifRange?: string,
    expectedIdentity?: string,
  ) {
    relative = safeRelative(relative);
    await this.withRoot(
      session,
      ctx,
      hostId,
      rootId,
      "readFiles",
      async (_c, s, _h, root) => {
        await this.noLinks(s, root, relative);
        const p = remotePath(root, relative),
          before = await stat(s, p);
        requireValue(
          before.isFile(),
          400,
          "NOT_A_FILE",
          "Choose a file to download.",
        );
        const version = fingerprint(before);
        requireValue(
          !expectedVersion || version === expectedVersion,
          409,
          "SOURCE_CHANGED",
          "The source changed since download preparation.",
        );
        const output = response as Writable & {
          setHeader?: (name: string, value: string) => void;
          statusCode?: number;
        };
        const etag =
          (expectedIdentity ? "" : "W/") +
          '"' +
          crypto
            .createHash("sha256")
            .update(expectedIdentity || version)
            .digest("hex") +
          '"';
        let start = 0,
          end = before.size - 1;
        output.setHeader?.(
          "Accept-Ranges",
          expectedIdentity ? "bytes" : "none",
        );
        requireValue(
          !range || Boolean(expectedIdentity),
          416,
          "CAPABILITY_UNAVAILABLE",
          "This server cannot safely resume a changed file. Start a new full download.",
        );
        output.setHeader?.("ETag", etag);
        if (range && (!ifRange || ifRange === etag)) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          requireValue(
            match && (match[1] || match[2]),
            416,
            "INVALID_RANGE",
            "Only a single byte range is supported.",
          );
          start = match[1]
            ? Number(match[1])
            : Math.max(0, before.size - Number(match[2]));
          end =
            match[1] && match[2]
              ? Math.min(Number(match[2]), before.size - 1)
              : before.size - 1;
          requireValue(
            Number.isSafeInteger(start) &&
              Number.isSafeInteger(end) &&
              start >= 0 &&
              end >= start &&
              start < before.size,
            416,
            "INVALID_RANGE",
            "Requested byte range is unavailable.",
          );
          output.statusCode = 206;
          output.setHeader?.(
            "Content-Range",
            `bytes ${start}-${end}/${before.size}`,
          );
        }
        output.setHeader?.(
          "Content-Length",
          String(Math.max(0, end - start + 1)),
        );
        await this.store.event(
          ctx.actorId,
          hostId,
          "file.download",
          "started",
          undefined,
          { rootId, path: relative },
        );
        const handle = await new Promise<Buffer>((resolve, reject) =>
          s.open(p, "r", (error, value) =>
            error ? reject(error) : resolve(value),
          ),
        );
        const source = s.createReadStream(p, {
            ...(before.size ? { start, end } : {}),
            handle,
          }),
          guard = new Transform({
            transform(chunk, _encoding, callback) {
              callback(null, chunk);
            },
            flush(callback) {
              void stat(s, p)
                .then((after) =>
                  callback(
                    fingerprint(after) === fingerprint(before)
                      ? undefined
                      : new Fault(
                          409,
                          "SOURCE_CHANGED",
                          "Source changed during download. The received file is incomplete.",
                        ),
                  ),
                )
                .catch(callback);
            },
          });
        try {
          // The SFTP handle is already open. Managed publications replace names;
          // their published root-owned files are immutable to the SFTP identity.
          if (expectedIdentity) {
            const observed = await this.adapter(
              session,
              hostId,
              "identity",
              { rootId, path: relative },
              "readFiles",
            );
            requireValue(
              observed.identity === expectedIdentity,
              409,
              "SOURCE_CHANGED",
              "The managed source identity changed. Start a new download.",
            );
          }
          await pipeline(source, guard, response);
        } finally {
          source.destroy();
        }

        await this.store.event(
          ctx.actorId,
          hostId,
          "file.download",
          "streamed",
          undefined,
          { rootId, path: relative, browserSaved: false },
        );
      },
      true,
    );
  }
  async inventory(
    session: string,
    ctx: Context,
    hostId: string,
    rootId: string,
    relative: string,
  ) {
    relative = safeRelative(relative);
    return this.withRoot(
      session,
      ctx,
      hostId,
      rootId,
      "readFiles",
      async (_c, s, _h, root) => {
        const result: {
          path: string;
          relative: string;
          type: string;
          size: string;
          version: string;
          mtime: number;
        }[] = [];
        let inventoryBytes = 0;
        const visit = async (
          directory: string,
          depth: number,
        ): Promise<void> => {
          requireValue(
            depth <= limit(ctx, "TRANSFER_LIMITS", "depth", 32),
            413,
            "INVENTORY_LIMIT",
            "Folder depth exceeds the configured limit.",
          );
          await this.noLinks(s, root, directory);
          const handle = await new Promise<Buffer>((resolve, reject) =>
            s.opendir(remotePath(root, directory), (e, h) =>
              e ? reject(e) : resolve(h),
            ),
          );
          try {
            for (;;) {
              const entries = await new Promise<
                false | { filename: string; attrs: Stats }[]
              >((resolve, reject) =>
                s.readdir(handle, (e, v) =>
                  e && (e as { code?: number }).code !== 1
                    ? reject(e)
                    : resolve(v || false),
                ),
              );
              if (!entries) break;
              for (const item of entries) {
                if (
                  [".", ".."].includes(item.filename) ||
                  item.filename.startsWith(".omnilodge-")
                )
                  continue;
                requireValue(
                  result.length < limit(ctx, "TRANSFER_LIMITS", "files", 10000),
                  413,
                  "INVENTORY_LIMIT",
                  "Folder inventory exceeds the file limit.",
                );
                const p = safeRelative(
                  path.posix.join(directory, item.filename),
                );
                requireValue(
                  item.attrs.isFile() || item.attrs.isDirectory(),
                  409,
                  "CAPABILITY_UNAVAILABLE",
                  "Folder operations do not follow links or special files.",
                );
                inventoryBytes +=
                  Buffer.byteLength(p) +
                  Buffer.byteLength(path.posix.relative(relative, p)) +
                  160;
                requireValue(
                  inventoryBytes <=
                    limit(ctx, "FILE_POLICY", "inventoryBytes", 16777216),
                  413,
                  "INVENTORY_LIMIT",
                  "Folder metadata exceeds the configured memory budget. Choose a smaller folder.",
                );
                result.push({
                  path: p,
                  relative: path.posix.relative(relative, p),
                  type: item.attrs.isDirectory() ? "directory" : "file",
                  size: String(item.attrs.size),
                  version: fingerprint(item.attrs),
                  mtime: item.attrs.mtime,
                });
                if (item.attrs.isDirectory()) await visit(p, depth + 1);
              }
            }
          } finally {
            await new Promise<void>((resolve) =>
              s.close(handle, () => resolve()),
            );
          }
        };
        await visit(relative, 0);
        return result;
      },
      true,
    );
  }
  async compare(session: string, ctx: Context, input: Record<string, unknown>) {
    const hostId = String(input.hostId),
      rootId = String(input.rootId),
      source = safeRelative(input.source),
      target = safeRelative(input.target);
    requireValue(
      source !== target &&
        source !== "." &&
        !target.startsWith(source + "/") &&
        !source.startsWith(target + "/"),
      400,
      "INVALID_COMPARISON",
      "Choose separate, non-overlapping folders in the selected root.",
    );
    const left = await this.inventory(session, ctx, hostId, rootId, source),
      right = await this.inventory(session, ctx, hostId, rootId, target),
      destinations = new Map(right.map((item) => [item.relative, item]));
    const plan = left.map((item) => {
      const destination = destinations.get(item.relative);
      return {
        ...item,
        target: path.posix.join(target, item.relative),
        status: !destination
          ? "missing"
          : destination.type !== item.type
            ? "type_conflict"
            : destination.size === item.size && destination.mtime === item.mtime
              ? "same_metadata"
              : "different",
        targetVersion: destination?.version,
      };
    });
    const job = await this.store.create(ctx.actorId, hostId, "comparison", {
      rootId,
      source,
      target,
      plan,
      expires: Date.now() + 60000,
      policyHash: ctx.policyHash,
    });
    await this.store.update(job, "reviewed");
    return {
      id: job.id,
      plan,
      expiresAt: job.data.expires,
      comparison:
        "Name, size and modified time; matching metadata does not prove identical contents.",
      deletes: false,
    };
  }
  async copyPlan(session: string, ctx: Context, id: string) {
    return this.serialize(id, async () => {
      const job = await this.store.get(id, ctx.actorId),
        d = job.data;
      requireValue(
        job.kind === "comparison" &&
          job.state === "reviewed" &&
          Number(d.expires) > Date.now() &&
          d.policyHash === ctx.policyHash,
        409,
        "REVIEW_EXPIRED",
        "Folder comparison expired. Compare again before copying.",
      );
      await this.store.update(job, "running");
      let completed = 0;
      const results: { path: string; state: string }[] = [];
      const plan = d.plan as {
        path: string;
        target: string;
        type: string;
        version: string;
        status: string;
      }[];
      try {
        const ordered = [...plan].sort((a, b) =>
          a.type === b.type
            ? a.target.split("/").length - b.target.split("/").length
            : a.type === "directory"
              ? -1
              : 1,
        );
        for (const item of ordered) {
          if (item.status !== "missing") {
            results.push({ path: item.path, state: "skipped_existing" });
            continue;
          }
          const fresh = await this.authority.check(session, "writeFiles");
          const review = await this.review(session, fresh, {
            hostId: job.hostId,
            rootId: d.rootId,
            operation: item.type === "directory" ? "mkdir" : "copy",
            path: item.type === "directory" ? item.target : item.path,
            target: item.target,
            version: item.type === "directory" ? undefined : item.version,
            reason: `Folder copy plan ${id}`,
          });
          await this.execute(session, fresh, review.id);
          completed++;
          results.push({ path: item.path, state: "completed" });
        }
        await this.store.update(job, "completed", { completed, results });
        return job;
      } catch (error) {
        await this.store.update(
          job,
          completed ? "partially_completed" : "failed",
          {
            completed,
            results,
            error:
              error instanceof Fault
                ? error.message
                : "Folder copy interrupted. Review individual child operations.",
          },
        );
        throw error;
      }
    });
  }
  async downloadFolder(
    session: string,
    ctx: Context,
    hostId: string,
    rootId: string,
    relative: string,
    response: Writable,
  ) {
    const inventory = await this.inventory(
      session,
      ctx,
      hostId,
      rootId,
      relative,
    );
    await this.withRoot(
      session,
      ctx,
      hostId,
      rootId,
      "readFiles",
      async (_c, s, _h, root) => {
        const zip = new yazl.ZipFile(),
          names = new Set<string>();
        zip.on("error", (error) =>
          (zip.outputStream as Readable).destroy(error),
        );
        for (const item of inventory) {
          const name = item.relative;
          requireValue(
            name &&
              !name.startsWith("/") &&
              !name.split("/").includes("..") &&
              !names.has(name),
            400,
            "INVALID_ARCHIVE_NAME",
            "Archive names are invalid or collide.",
          );
          names.add(name);
          if (item.type === "directory")
            zip.addEmptyDirectory(name, {
              mtime: new Date(item.mtime * 1000),
              mode: 0o755,
            });
          else
            zip.addReadStreamLazy(
              name,
              {
                mtime: new Date(item.mtime * 1000),
                mode: 0o644,
                size: Number(item.size),
              },
              (callback) => {
                void stat(s, remotePath(root, item.path))
                  .then((attrs) => {
                    if (fingerprint(attrs) !== item.version) {
                      callback(
                        new Error("Source changed during archive download."),
                        undefined!,
                      );
                      return;
                    }
                    const source = s.createReadStream(
                        remotePath(root, item.path),
                      ),
                      guard = new Transform({
                        transform(chunk, _encoding, done) {
                          done(null, chunk);
                        },
                        flush(done) {
                          void stat(s, remotePath(root, item.path))
                            .then((after) =>
                              done(
                                fingerprint(after) === item.version
                                  ? undefined
                                  : new Error(
                                      "Source changed during archive download.",
                                    ),
                              ),
                            )
                            .catch(done);
                        },
                      });
                    source.on("error", (error: Error) => guard.destroy(error));
                    source.pipe(guard);
                    callback(null, guard);
                  })
                  .catch((error) => callback(error, undefined!));
              },
            );
        }
        let manifestName = "omnilodge-download-manifest.json";
        while (names.has(manifestName)) manifestName = "_" + manifestName;
        zip.addBuffer(
          Buffer.from(
            JSON.stringify(
              {
                snapshot: false,
                hostId,
                rootId,
                path: relative,
                entries: inventory.map((i) => ({
                  path: i.relative,
                  bytes: i.size,
                  version: i.version,
                })),
              },
              null,
              2,
            ),
          ),
          manifestName,
        );
        zip.end({ forceZip64Format: true, comment: "" });
        await this.store.event(
          ctx.actorId,
          hostId,
          "folder.download",
          "started",
          undefined,
          { rootId, path: relative, files: inventory.length },
        );
        await pipeline(zip.outputStream, response);
      },
      true,
    );
  }
  private staging(job: Job, root: Root) {
    return job.data.managed === true
      ? `/.staging/${job.id}`
      : remotePath(
          root,
          path.posix.join(
            path.posix.dirname(String(job.data.path)),
            `.omnilodge-${job.id}.partial`,
          ),
        );
  }
  private async capacity(
    session: string,
    ctx: Context,
    hostId: string,
    s: SFTPWrapper,
    host: Host,
    root: Root,
  ) {
    let free: number, total: number;
    if (host.managed && root.managed) {
      const info = await this.adapter(
        session,
        hostId,
        "statvfs",
        { rootId: root.id },
        "readFiles",
      );
      free = Number(info.freeBytes);
      total = Number(info.totalBytes);
    } else {
      const info = await new Promise<Record<string, number>>(
        (resolve, reject) => {
          try {
            s.ext_openssh_statvfs(root.path, (error, result) =>
              error
                ? reject(
                    new Fault(
                      409,
                      "CAPABILITY_UNAVAILABLE",
                      "This SFTP server does not report capacity. Uploads require a verified capacity capability.",
                    ),
                  )
                : resolve(result),
            );
          } catch {
            reject(
              new Fault(
                409,
                "CAPABILITY_UNAVAILABLE",
                "This SFTP server does not support statvfs capacity checks.",
              ),
            );
          }
        },
      );
      free = Number(info.f_bavail) * Number(info.f_frsize);
      total = Number(info.f_blocks) * Number(info.f_frsize);
    }
    requireValue(
      Number.isSafeInteger(free) &&
        Number.isSafeInteger(total) &&
        free >= 0 &&
        total > 0,
      503,
      "CAPACITY_UNAVAILABLE",
      "Remote capacity is unavailable.",
    );
    return {
      free,
      total,
      reserve: Math.max(
        limit(ctx, "STORAGE_POLICY", "reserveBytes", 1073741824),
        Math.ceil(
          (total * limit(ctx, "STORAGE_POLICY", "reservePercent", 15)) / 100,
        ),
      ),
    };
  }
  async destination(
    session: string,
    ctx: Context,
    input: Record<string, unknown>,
    action: Action = "transfer",
  ) {
    const relative = safeRelative(input.path);
    return this.withRoot(
      session,
      ctx,
      String(input.hostId),
      String(input.rootId),
      action,
      async (_c, s, _h, root) => {
        await this.noLinks(s, root, relative, true);
        const name = remotePath(root, relative);
        let attrs: Stats;
        try {
          attrs = await stat(s, name);
        } catch (e) {
          if ((e as { code?: number }).code === 2)
            return { exists: false, path: relative };
          throw e;
        }
        requireValue(
          attrs.isFile() &&
            attrs.size <=
              limit(ctx, "TRANSFER_LIMITS", "fileBytes", 10737418240),
          409,
          "DESTINATION_CONFLICT",
          "The destination is not a replaceable regular file.",
        );
        const version = fingerprint(attrs),
          sha256 = await digest(s, name);
        requireValue(
          fingerprint(await stat(s, name)) === version,
          409,
          "VERSION_CONFLICT",
          "Destination changed while reviewing.",
        );
        return {
          exists: true,
          path: relative,
          version,
          sha256,
          size: attrs.size,
        };
      },
      true,
    );
  }
  async pause(session: string, ctx: Context, id: string) {
    return this.serialize(id, async () => {
      const job = await this.store.get(id, ctx.actorId);
      requireValue(
        job.kind === "upload" &&
          ["paused", "transferring"].includes(job.state) &&
          job.data.phase !== "publication",
        409,
        "TRANSFER_STATE",
        "This transfer cannot be paused during publication.",
      );
      await this.authority.rpc("authorize", {
        session,
        hostId: job.hostId,
        action: "transfer",
      });
      return this.store.update(job, "paused");
    });
  }
  async uploadCreate(
    session: string,
    ctx: Context,
    input: Record<string, unknown>,
  ) {
    const relative = safeRelative(input.path),
      hostId = String(input.hostId),
      rootId = String(input.rootId),
      size = Number(input.size);
    requireValue(
      Number.isSafeInteger(size) &&
        size >= 0 &&
        size <= limit(ctx, "TRANSFER_LIMITS", "fileBytes", 10737418240) &&
        typeof input.sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(input.sha256),
      413,
      "INVALID_SOURCE",
      "File size and complete SHA-256 are required.",
    );
    const destination = await this.destination(session, ctx, input);
    if (destination.exists)
      requireValue(
        input.overwrite === true &&
          input.destinationVersion === destination.version &&
          input.destinationSha256 === destination.sha256,
        409,
        "DESTINATION_CONFLICT",
        "Destination exists or changed. Review overwrite, rename, or skip it.",
      );
    const job = await this.store.create(
      ctx.actorId,
      hostId,
      "upload",
      {
        path: relative,
        rootId,
        size,
        offset: 0,
        sha256: input.sha256,
        createParents: input.createParents === true,
        destinationVersion: destination.version,
        destinationSha256: destination.sha256,
        overwrite: destination.exists,
        policyHash: ctx.policyHash,
      },
      String(input.idempotencyKey || crypto.randomUUID()),
    );
    if (job.state !== "queued") return job;
    try {
      await this.withRoot(
        session,
        ctx,
        hostId,
        rootId,
        "transfer",
        async (_c, s, host, root) => {
          const managed = host.managed && root.managed,
            capacity = await this.capacity(session, ctx, hostId, s, host, root);
          await this.store.reserve(
            job,
            rootId,
            size * (managed ? 2 : 1),
            capacity.free,
            capacity.reserve,
          );
          await this.store.update(job, "planning", { managed });
          if (!managed && input.createParents === true) {
            let directory = ".";
            for (const component of path.posix
              .dirname(relative)
              .split("/")
              .filter((p) => p !== "." && p)) {
              directory = path.posix.join(directory, component);
              try {
                await this.noLinks(s, root, directory);
              } catch (error) {
                if ((error as { code?: number }).code !== 2) throw error;
                await mkdir(s, remotePath(root, directory));
              }
            }
          }
          if (!managed) await this.noLinks(s, root, relative, true);
          if (managed)
            await this.adapter(
              session,
              hostId,
              "registerStaging",
              { rootId: root.id, stagingId: job.id },
              "writeFiles",
            );
          const handle = await new Promise<Buffer>((resolve, reject) =>
            s.open(this.staging(job, root), "wx", 0o600, (e, h) =>
              e ? reject(e) : resolve(h),
            ),
          );
          await new Promise<void>((resolve) =>
            s.close(handle, () => resolve()),
          );
        },
      );
      return this.store.update(job, "paused");
    } catch (error) {
      await this.store.update(job, "failed", {
        error:
          error instanceof Fault
            ? error.message
            : "Upload could not be staged.",
      });
      await this.store.reservationProgress(job.id, 0);
      throw error;
    }
  }
  async chunk(
    session: string,
    ctx: Context,
    id: string,
    offset: number,
    bytes: Buffer,
    expectedHash: string,
  ) {
    return this.serialize(id, async () => {
      const release = this.admit(ctx);
      let job: Job | undefined;
      try {
        job = await this.store.get(id, ctx.actorId);
        const d = job.data;
        requireValue(
          job.kind === "upload" &&
            ["paused", "transferring"].includes(job.state) &&
            d.policyHash === ctx.policyHash,
          409,
          "TRANSFER_STATE",
          "This transfer cannot accept data.",
        );
        requireValue(
          bytes.length > 0 &&
            bytes.length <=
              limit(ctx, "TRANSFER_LIMITS", "chunkBytes", 4194304) &&
            offset === Number(d.offset) &&
            offset + bytes.length <= Number(d.size) &&
            crypto.createHash("sha256").update(bytes).digest("hex") ===
              expectedHash,
          409,
          "CHUNK_MISMATCH",
          "Chunk offset, size or checksum does not match.",
        );
        await this.store.update(job, "transferring");
        await this.withRoot(
          session,
          ctx,
          job.hostId,
          String(d.rootId),
          "transfer",
          async (_c, s, host, root) => {
            const capacity = await this.capacity(
              session,
              ctx,
              job!.hostId,
              s,
              host,
              root,
            );
            requireValue(
              capacity.free - bytes.length >= capacity.reserve,
              507,
              "CAPACITY_EXCEEDED",
              "Destination reserve would be exceeded.",
            );
            const handle = await new Promise<Buffer>((resolve, reject) =>
              s.open(this.staging(job!, root), "r+", (e, h) =>
                e ? reject(e) : resolve(h),
              ),
            );
            try {
              await new Promise<void>((resolve, reject) =>
                s.write(handle, bytes, 0, bytes.length, offset, (e) =>
                  e ? reject(e) : resolve(),
                ),
              );
            } finally {
              await new Promise<void>((resolve) =>
                s.close(handle, () => resolve()),
              );
            }
          },
        );
        await this.store.reservationProgress(
          job.id,
          Number(d.size) * (d.managed ? 2 : 1) - offset - bytes.length,
        );
        return this.store.update(job, "paused", {
          offset: offset + bytes.length,
          lastChunkHash: expectedHash,
          lastChunkOffset: offset,
        });
      } catch (error) {
        if (job?.state === "transferring")
          await this.store.update(job, "outcome_unknown", {
            error: "The last write needs reconciliation before resuming.",
          });
        throw error;
      } finally {
        release();
      }
    });
  }
  async resume(session: string, ctx: Context, id: string, sourceHash: string) {
    return this.serialize(id, async () => {
      const job = await this.store.get(id, ctx.actorId),
        d = job.data;
      requireValue(
        job.kind === "upload" &&
          ["paused", "outcome_unknown"].includes(job.state) &&
          d.phase !== "publication" &&
          d.sha256 === sourceHash &&
          d.policyHash === ctx.policyHash,
        409,
        "SOURCE_CHANGED",
        "Source, destination or policy changed. Reconcile this transfer before resuming.",
      );
      await this.withRoot(
        session,
        ctx,
        job.hostId,
        String(d.rootId),
        "transfer",
        async (_c, s, host, root) => {
          const p = this.staging(job, root),
            attrs = await stat(s, p);
          requireValue(
            attrs.isFile() && attrs.size >= Number(d.offset),
            409,
            "SOURCE_CHANGED",
            "Remote staging is missing or shorter than the confirmed offset.",
          );
          const capacity = await this.capacity(
            session,
            ctx,
            job.hostId,
            s,
            host,
            root,
          );
          await this.store.reserve(
            job,
            root.id,
            Number(d.size) * (d.managed ? 2 : 1) - Number(d.offset),
            capacity.free,
            capacity.reserve,
          );
          if (Number(d.offset) > 0) {
            const start = Number(d.lastChunkOffset) || 0,
              h = crypto.createHash("sha256");
            for await (const chunk of s.createReadStream(p, {
              start,
              end: Number(d.offset) - 1,
            }))
              h.update(chunk);
            requireValue(
              h.digest("hex") === d.lastChunkHash,
              409,
              "SOURCE_CHANGED",
              "Previously uploaded content changed.",
            );
          }
          if (attrs.size > Number(d.offset))
            await new Promise<void>((resolve, reject) =>
              s.setstat(p, { size: Number(d.offset) }, (e) =>
                e ? reject(e) : resolve(),
              ),
            );
        },
      );
      return this.store.update(job, "paused");
    });
  }
  async cancel(session: string, ctx: Context, id: string) {
    return this.serialize(id, async () => {
      const job = await this.store.get(id, ctx.actorId);
      requireValue(
        job.kind === "upload" &&
          !["publishing", "completed"].includes(job.state) &&
          !(
            job.state === "outcome_unknown" && job.data.phase === "publication"
          ),
        409,
        "OUTCOME_UNKNOWN",
        "Publication cannot be cancelled safely. Reconcile its outcome.",
      );
      await this.store.update(job, "cancel_requested");
      try {
        await this.withRoot(
          session,
          ctx,
          job.hostId,
          String(job.data.rootId),
          "transfer",
          async (_c, s, _h, root) => {
            const p = this.staging(job, root);
            try {
              await unlink(s, p);
            } catch (error) {
              if ((error as { code?: number }).code !== 2) throw error;
            }
          },
        );
        await this.store.reservationProgress(id, 0);
        return this.store.update(job, "cancelled", {
          cleanup: "temporary file removed",
        });
      } catch {
        await this.store.reservationProgress(id, 0);
        return this.store.update(job, "cancel_requested", {
          cleanup: "pending verification",
        });
      }
    });
  }
  async publish(session: string, ctx: Context, id: string) {
    return this.serialize(id, async () => {
      const release = this.admit(ctx);
      try {
        const job = await this.store.get(id, ctx.actorId),
          d = job.data;
        if (job.state === "completed") return job;
        requireValue(
          job.kind === "upload" &&
            job.state === "paused" &&
            Number(d.offset) === Number(d.size) &&
            d.policyHash === ctx.policyHash,
          409,
          "TRANSFER_INCOMPLETE",
          "Upload is incomplete or its policy changed.",
        );
        await this.store.update(job, "verifying", { phase: "verification" });
        try {
          const sha256 = await this.withRoot(
            session,
            ctx,
            job.hostId,
            String(d.rootId),
            "transfer",
            async (_c, s, _h, root) => digest(s, this.staging(job, root)),
          );
          requireValue(
            sha256 === d.sha256,
            409,
            "SOURCE_CHANGED",
            "Uploaded file checksum differs from the selected source.",
          );
          await this.store.update(job, "publishing", { phase: "publication" });
          let outcome: Record<string, unknown>;
          if (d.managed)
            outcome = await this.adapter(
              session,
              job.hostId,
              "publish",
              {
                rootId: d.rootId,
                path: d.path,
                stagingId: id,
                operationId: id,
                fence: 1,
                size: d.size,
                sha256,
                createOnly: d.overwrite !== true,
                source: d.destinationVersion,
                originalSha256: d.destinationSha256,
                createParents: d.createParents === true,
              },
              "writeFiles",
            );
          else
            outcome = await this.withRoot(
              session,
              ctx,
              job.hostId,
              String(d.rootId),
              "writeFiles",
              async (_c, s, _h, root) => {
                const destination = remotePath(root, safeRelative(d.path));
                await this.noLinks(s, root, safeRelative(d.path), true);
                if (d.overwrite === true) {
                  requireValue(
                    fingerprint(await stat(s, destination)) ===
                      d.destinationVersion &&
                      (await digest(s, destination)) === d.destinationSha256,
                    409,
                    "VERSION_CONFLICT",
                    "Destination changed before replacement.",
                  );
                  await rename(s, this.staging(job, root), destination);
                } else {
                  try {
                    await stat(s, destination);
                    throw new Fault(
                      409,
                      "VERSION_CONFLICT",
                      "Destination appeared before publication.",
                    );
                  } catch (error) {
                    if ((error as { code?: number }).code !== 2) throw error;
                  }
                  await new Promise<void>((resolve, reject) =>
                    s.rename(this.staging(job, root), destination, (e) =>
                      e ? reject(e) : resolve(),
                    ),
                  );
                }
                return {
                  sha256,
                  atomicCreateOnly: d.overwrite !== true,
                  externalWriterProtection: "best effort",
                };
              },
            );
          await this.store.reservationProgress(id, 0);
          return await this.store.update(job, "completed", {
            verification: "remote read-back SHA-256",
            outcome,
          });
        } catch (error) {
          await this.store.update(
            job,
            error instanceof Fault && error.code === "SOURCE_CHANGED"
              ? "failed"
              : "outcome_unknown",
            {
              error:
                error instanceof Fault
                  ? error.message
                  : "Publication outcome is unconfirmed.",
            },
          );
          throw error;
        }
      } finally {
        release();
      }
    });
  }
}
