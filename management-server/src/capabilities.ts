import { Authority } from "./authority.js";
import { connect, sftp, execAdapter } from "./ssh.js";
import { Store } from "./store.js";
import { Fault, type Context } from "./types.js";

export async function testHost(
  authority: Authority,
  store: Store,
  session: string,
  ctx: Context,
  hostId: string,
) {
  const stages: { name: string; ok: boolean; details?: unknown }[] = [];
  try {
    const c = await authority.connection(session, hostId, "sftp", "readFiles"),
      client = await connect(c);
    stages.push({
      name: "Network, pinned host key and authentication",
      ok: true,
    });
    try {
      const subsystem = await sftp(client);
      stages.push({ name: "SFTP subsystem", ok: true });
      const roots = [];
      for (const root of c.host.roots) {
        const capacity = await new Promise<Record<string, unknown> | null>(
          (resolve) => {
            try {
              subsystem.ext_openssh_statvfs(root.path, (error, result) =>
                resolve(error ? null : result),
              );
            } catch {
              resolve(null);
            }
          },
        );
        roots.push({
          id: root.id,
          writable: root.writable,
          managed: root.managed,
          capacityAvailable: capacity !== null,
          uploadSupported: root.managed || capacity !== null,
          symlinkTraversal: false,
          conditionalReplace: root.managed
            ? "adapter-serialized"
            : "optimistic; external writers can race",
        });
      }
      stages.push({ name: "File root capabilities", ok: true, details: roots });
    } finally {
      client.end();
    }
    if (c.host.managed) {
      const gateway = await authority.connection(
          session,
          hostId,
          "terminal",
          "view",
        ),
        client = await connect(gateway);
      try {
        const ticket = await authority.ticket(
          session,
          hostId,
          "metrics",
          {},
          "view",
        );
        const metrics = await execAdapter(client, ticket);
        stages.push({
          name: "Managed adapter",
          ok: true,
          details: {
            sampledAt: metrics.sampledAt,
            release: metrics.release,
            resources: metrics.resources,
          },
        });
      } finally {
        client.end();
      }
    }
    await store.event(ctx.actorId, hostId, "host.test", "completed");
    return { ok: true, stages };
  } catch (error) {
    await store.event(ctx.actorId, hostId, "host.test", "failed");
    if (
      error instanceof Fault &&
      [
        "STEP_UP_REQUIRED",
        "SESSION_EXPIRED",
        "POLICY_CHANGED",
        "FORBIDDEN",
      ].includes(error.code)
    )
      throw error;
    stages.push({
      name: "Connection or capability check",
      ok: false,
      ...{
        message:
          error instanceof Fault
            ? error.message
            : "The saved server could not complete this check.",
      },
    });
    return { ok: false, stages };
  }
}
