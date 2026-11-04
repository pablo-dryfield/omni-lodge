import "reflect-metadata";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import pg from "pg";

// This is a trusted infrastructure entry point, never an HTTP endpoint. The
// release control plane provides the immutable source and protected environment.
const apply = process.argv.includes("--apply");
if (
  process.platform !== "linux" ||
  process.getuid?.() !== 0 ||
  process.env.NODE_ENV !== "production" ||
  !/^\/opt\/omnilodge\/releases\/omnilodge-[a-z0-9-]+\/be$/.test(process.cwd())
)
  throw new Error("Run from the trusted immutable production backend as root.");
const envPath = "/etc/omnilodge/backend.env",
  base = "/etc/omnilodge-system";
const envStat = await fs.lstat(envPath);
if (
  !envStat.isFile() ||
  envStat.isSymbolicLink() ||
  envStat.uid !== 0 ||
  (envStat.mode & 0o077) !== 0
)
  throw new Error("Protected backend environment ownership/mode is invalid.");
const adminOptions = {
  host: "127.0.0.1",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: false, // This infrastructure path is pinned to the local cluster.
  connectionTimeoutMillis: 5000,
};
const controlUrl = process.env.DB_WORKSPACE_CONTROL_URL
  ? new URL(process.env.DB_WORKSPACE_CONTROL_URL)
  : undefined;
const loopback = (host: string) =>
  ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
if (
  !controlUrl ||
  !loopback(controlUrl.hostname) ||
  Number(controlUrl.port || 5432) !== adminOptions.port ||
  !loopback(process.env.DB_HOST || "127.0.0.1")
)
  throw new Error(
    "System Management bootstrap requires the verified local application/control cluster.",
  );
const controlDatabase = controlUrl.pathname.slice(1);
if (!/^[a-zA-Z0-9_]{1,63}$/.test(controlDatabase))
  throw new Error("Provision the independent control database first.");
const control = new pg.Client({ ...adminOptions, database: controlDatabase });
let closeConfigurationDatabase: (() => Promise<void>) | undefined;
await control.connect();
try {
  const roles = await control.query(
    "SELECT rolname FROM pg_roles WHERE rolname IN ('omnilodge_system_authority','omnilodge_system_broker')",
  );
  const application = new pg.Client({
    ...adminOptions,
    database: process.env.DB_NAME,
  });
  await application.connect();
  try {
    const actors = (
      await application.query(
        `SELECT u.id,concat_ws(' ',u."firstName",u."lastName") AS name FROM users u JOIN "userTypes" r ON r.id=u."userTypeId" WHERE u.status AND u.approved AND r.status AND r.slug IN ('admin','administrator') AND NOT EXISTS(SELECT 1 FROM user_type_product_types p WHERE p.user_type_id=r.id)`,
      )
    ).rows as { id: number; name: string }[];
    if (!apply) {
      console.log(
        JSON.stringify(
          {
            mode: "read-only plan",
            controlDatabase,
            existingRoles: roles.rowCount,
            administrators: actors.map((a) => ({ id: a.id, name: a.name })),
            changes:
              "Provision isolated runtime, dedicated identities, restricted control schema and encrypted Control Panel SSH credentials. Admission remains disabled until verified.",
          },
          null,
          2,
        ),
      );
    } else {
      if (!process.argv.includes(`--confirm-database=${process.env.DB_NAME}`))
        throw new Error("Confirm the exact application database.");
      if (roles.rowCount || process.env.SYSTEM_MANAGEMENT_AUTHORITY_URL)
        throw new Error(
          "Existing or partial provisioning found. Verify it rather than implicitly rotating/adopting credentials.",
        );
      process.env.OMNILODGE_WORKSPACE_WORKER = "true";
      const { default: sequelize } = await import("../config/database.js");
      closeConfigurationDatabase = () => sequelize.close();
      const { initializeConfigRegistry, updateConfigValue } =
        await import("../services/configService.js");
      // Initialize the real models and configuration before creating any
      // infrastructure credentials, so a configuration failure is fail-fast.
      await sequelize.authenticate();
      await initializeConfigRegistry();
      await fs.mkdir(base, { recursive: true, mode: 0o750 });
      const group = Number(
        execFileSync("/usr/bin/getent", ["group", "omnilodge-system"], {
          encoding: "utf8",
        })
          .trim()
          .split(":")[2],
      );
      if (!Number.isSafeInteger(group))
        throw new Error("Provision the broker OS group first.");
      const privateFile = async (
        name: string,
        value: string,
        shared = false,
      ) => {
        const f = path.join(base, name);
        await fs.writeFile(f, value, {
          mode: shared ? 0o640 : 0o600,
          flag: "wx",
        });
        await fs.chown(f, 0, shared ? group : 0);
      };
      const passwords = {
        authority: crypto.randomBytes(32).toString("hex"),
        broker: crypto.randomBytes(32).toString("hex"),
      };
      for (const kind of ["authority", "broker"] as const)
        await control.query(
          `CREATE ROLE omnilodge_system_${kind} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${kind === "broker" ? 6 : 4} PASSWORD '${passwords[kind]}'`,
        );
      await control.query(
        `GRANT CONNECT ON DATABASE ${controlDatabase} TO omnilodge_system_authority,omnilodge_system_broker`,
      );
      const schema = await fs.readFile(
        path.resolve("dist/systemManagement/control-schema.sql"),
        "utf8",
      );
      await control.query(schema);
      const url = (kind: "authority" | "broker") => {
        const u = new URL(
          `postgresql://127.0.0.1:${adminOptions.port}/${controlDatabase}`,
        );
        u.username = `omnilodge_system_${kind}`;
        u.password = passwords[kind];
        u.searchParams.set("sslmode", "disable");
        return u.toString();
      };
      const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
      await privateFile(
        "authority-signing.pem",
        privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      );
      const publicBytes = publicKey
        .export({ type: "spki", format: "der" })
        .subarray(-32);
      await privateFile(
        "rpc-secret",
        crypto.randomBytes(32).toString("base64") + "\n",
        true,
      );
      await privateFile(
        "artifact-key",
        crypto.randomBytes(32).toString("base64") + "\n",
        true,
      );
      const hostPolicy: {
        version: number;
        hostId: string;
        publicKey: string;
        actors: Record<string, unknown>;
        services: Record<string, unknown>;
        memoryMiB: number;
        cpuPercent: number;
        tasks: number;
        reserveBytes: number;
      } = {
        version: 1,
        hostId: "production",
        publicKey: publicBytes.toString("base64"),
        actors: {},
        services: {
          broker: {
            name: "System Management broker",
            healthKind: "broker",
            restartable: true,
          },
          postgresql: {
            name: "PostgreSQL",
            unit: "postgresql.service",
            restartable: false,
          },
          backend: {
            name: "Backend",
            pm2Name: "omni-lodge-be",
            healthKind: "backend",
            restartable: true,
          },
          ui: {
            name: "UI server",
            pm2Name: "omni-lodge-ui-server",
            healthKind: "ui",
            restartable: true,
          },
        },
        memoryMiB: 256,
        cpuPercent: 25,
        tasks: 64,
        reserveBytes: 1073741824,
      };
      const credentials: Record<string, unknown> = {};
      const publicKeyFile = "/etc/ssh/authorized_keys/omnilodge-sys-gw";
      const generateKey = async (id: string, authorized: string) => {
        const filename = path.join(base, ".key-" + id);
        execFileSync(
          "/usr/bin/ssh-keygen",
          ["-q", "-t", "ed25519", "-N", "", "-f", filename],
          { stdio: "ignore" },
        );
        const privateKey = await fs.readFile(filename, "utf8"),
          publicKey = await fs.readFile(filename + ".pub", "utf8");
        await fs.writeFile(authorized, publicKey, { mode: 0o644, flag: "wx" });
        await fs.unlink(filename);
        await fs.unlink(filename + ".pub");
        return { privateKey, revision: crypto.randomUUID() };
      };
      credentials["production-gateway"] = await generateKey(
        "gateway",
        publicKeyFile,
      );
      const identityMap: Record<string, unknown> = {};
      for (const actor of actors) {
        const username = `omnilodge-op-${actor.id}`,
          fileUsername = `omnilodge-sftp-${actor.id}`,
          work = `/srv/omnilodge-operations/u${actor.id}`,
          staging = `/srv/omnilodge-staging/u${actor.id}`;
        credentials[`production-files-${actor.id}`] = await generateKey(
          `files-${actor.id}`,
          `/etc/ssh/authorized_keys/${fileUsername}`,
        );
        identityMap[String(actor.id)] = {
          username: "omnilodge-sys-gw",
          credentialId: "production-gateway",
          fileUsername,
          fileCredentialId: `production-files-${actor.id}`,
        };
        const gid = Number(
          execFileSync("/usr/bin/id", ["-g", fileUsername], {
            encoding: "utf8",
          }),
        );
        hostPolicy.actors[String(actor.id)] = {
          username,
          workingDirectory: `/srv/omnilodge-shell/u${actor.id}`,
          roots: { work: { path: work, staging, writable: true, gid } },
          services: ["backend", "ui", "broker", "postgresql"],
        };
      }
      await privateFile(
        "adapter.json",
        JSON.stringify(hostPolicy, null, 2) + "\n",
      );
      const fingerprints = execFileSync(
        "/usr/bin/ssh-keygen",
        ["-lf", "/etc/ssh/ssh_host_ed25519_key.pub", "-E", "sha256"],
        { encoding: "utf8" },
      )
        .trim()
        .split(/\s+/)[1];
      const hosts = [
        {
          id: "production",
          name: "OmniLodge production",
          environment: "production",
          hostname: "127.0.0.1",
          port: 22,
          addresses: ["127.0.0.1"],
          fingerprints: [fingerprints],
          enabled: true,
          managed: true,
          identities: identityMap,
          roots: [
            {
              id: "work",
              name: "Operational files",
              path: "/work",
              writable: true,
              managed: true,
            },
          ],
          services: ["backend", "ui", "broker", "postgresql"],
        },
      ];
      const { SYSTEM_ACTIONS } =
        await import("../config/systemManagementConfig.js");
      for (const [key, value] of Object.entries({
        SYSTEM_MANAGEMENT_HOSTS: hosts,
        SYSTEM_MANAGEMENT_CREDENTIALS: credentials,
        SYSTEM_MANAGEMENT_HOST_GRANTS: actors.map((a) => ({
          actorId: a.id,
          hostId: "production",
          actions: SYSTEM_ACTIONS,
        })),
      }))
        await updateConfigValue({
          key,
          value,
          actorId: null,
          reason: "Trusted initial System Management provisioning",
        });
      const additions = `\nSYSTEM_MANAGEMENT_AUTHORITY_URL=${url("authority")}\nSYSTEM_MANAGEMENT_AUTHORITY_SOCKET=/run/omnilodge-system/authority.sock\nSYSTEM_MANAGEMENT_RPC_SECRET_FILE=${base}/rpc-secret\nSYSTEM_MANAGEMENT_SIGNING_KEY_FILE=${base}/authority-signing.pem\n`;
      await fs.appendFile(envPath, additions, { mode: 0o600 });
      await privateFile(
        "broker.env",
        `NODE_ENV=production\nSYSTEM_MANAGEMENT_CONTROL_URL=${url("broker")}\nSYSTEM_MANAGEMENT_AUTHORITY_SOCKET=/run/omnilodge-system/authority.sock\nSYSTEM_MANAGEMENT_RPC_SECRET_FILE=${base}/rpc-secret\nSYSTEM_MANAGEMENT_ARTIFACT_KEY_FILE=${base}/artifact-key\nSYSTEM_MANAGEMENT_PUBLIC_ORIGIN=https://system.omni-lodge.com\nSYSTEM_MANAGEMENT_PORT=3011\n`,
        true,
      );
      execFileSync(
        "/bin/systemctl",
        [
          "enable",
          "--now",
          "omnilodge-system-watchdog.timer",
          "omnilodge-system-cleanup.timer",
        ],
        { stdio: "ignore" },
      );
      console.log(
        JSON.stringify({
          ok: true,
          admissionEnabled: false,
          administrators: actors.length,
          controlSchema: "system_management",
          next: "Reload protected backend environment through the release control plane, verify isolated origin and runtime limits, then enable admission in Control Panel.",
        }),
      );
    }
  } finally {
    await application.end();
  }
} finally {
  await closeConfigurationDatabase?.();
  await control.end();
}
