import path from "node:path";
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
      !value.split("/").some((part) => part === ".." || part.startsWith(".omnilodge-")),
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
  ): Promise<T> {
    const c = await this.authority.connection(session, hostId, "sftp", action),
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
    const client = await connect(c);
    try {
      return await fn(client, await sftp(client), c.host, root);
    } finally {
      client.end();
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
      return await execAdapter(
        client,
        await this.authority.ticket(session, hostId, operation, params, action),
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
        let complete = true;
        try {
          for (;;) {
            const batch = await new Promise<
              false | { filename: string; attrs: Stats }[]
            >((resolve, reject) =>
              s.readdir(handle, (e, list) =>
                e ? reject(e) : resolve(list || false),
              ),
            );
            if (!batch) break;
            for (const item of batch) {
              if ([".", ".."].includes(item.filename) || item.filename.startsWith(".omnilodge-")) continue;
              if (entries.length >= max) {
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
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          throw new Fault(
            415,
            "BINARY_FILE",
            "This file is not valid UTF-8. Download it instead.",
          );
        }
        requireValue(
          !text.includes("\0"),
          415,
          "BINARY_FILE",
          "Binary files cannot be edited.",
        );
        requireValue(
          fingerprint(before) === fingerprint(await stat(s, p)),
          409,
          "VERSION_CONFLICT",
          "File changed while reading. Refresh and try again.",
        );
        return {
          text,
          version: fingerprint(before),
          sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
          bom: bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])),
          newline: text.includes("\r\n") ? "CRLF" : "LF",
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
    if (operation === "save")
      requireValue(
        typeof input.text === "string" &&
          Buffer.byteLength(input.text) <=
            limit(ctx, "FILE_POLICY", "editBytes", 2097152),
        413,
        "TOO_LARGE",
        "Edited text is too large.",
      );
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
              const capacity = await this.capacity(session, ctx, job.hostId, s, host, root);
              requireValue(attrs.size <= limit(ctx,'TRANSFER_LIMITS','fileBytes',10737418240) && capacity.free-attrs.size >= capacity.reserve,507,'CAPACITY_EXCEEDED','Copy exceeds the file or destination reserve limit.');
              const temporary=remotePath(root,path.posix.join(path.posix.dirname(safeRelative(d.target)),`.omnilodge-${id}.partial`)),hash=crypto.createHash('sha256');
              try {
                await pipeline(s.createReadStream(p),new Transform({transform(chunk,_encoding,callback){hash.update(chunk);callback(null,chunk);}}),s.createWriteStream(temporary,{flags:'wx',mode:0o600}));
                const copied=hash.digest('hex');
                requireValue(fingerprint(await stat(s,p))===fingerprint(attrs) && await digest(s,p)===copied && await digest(s,temporary)===copied,409,'SOURCE_CHANGED','Source changed while copying. The destination was not published.');
                await new Promise<void>((resolve,reject)=>s.rename(temporary,target,e=>e?reject(e):resolve()));
              } finally {await unlink(s,temporary).catch(()=>{});}
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
        await this.store.event(
          ctx.actorId,
          hostId,
          "file.download",
          "started",
          undefined,
          { rootId, path: relative },
        );
        await pipeline(s.createReadStream(p), response);
      },
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
                  e ? reject(e) : resolve(v || false),
                ),
              );
              if (!entries) break;
              for (const item of entries) {
                if ([".", ".."].includes(item.filename) || item.filename.startsWith(".omnilodge-")) continue;
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
          "omnilodge-download-manifest.json",
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
      requireValue(
        this.active < limit(ctx, "TRANSFER_LIMITS", "total", 2),
        429,
        "CAPACITY_EXCEEDED",
        "Transfer concurrency is full. Retry this chunk later.",
      );
      this.active++;
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
        this.active--;
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
          !["publishing", "completed"].includes(job.state),
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
      await this.store.update(job, "verifying");
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
        await this.store.update(job, "publishing");
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
              createOnly: true,
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
              try {
                await stat(s, destination);
                throw new Fault(
                  409,
                  "VERSION_CONFLICT",
                  "Destination already exists. Choose another name or review an overwrite.",
                );
              } catch (error) {
                if ((error as { code?: number }).code !== 2) throw error;
              }
              await new Promise<void>((resolve, reject) =>
                s.rename(this.staging(job, root), destination, (e) =>
                  e ? reject(e) : resolve(),
                ),
              );
              return {
                sha256,
                atomicCreateOnly: true,
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
    });
  }
}
