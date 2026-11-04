import "reflect-metadata";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import type { SystemHost } from "../config/systemManagementConfig.js";

// Trusted, explicit root enrollment from an immutable release, never an HTTP API.
if (
  process.platform !== "linux" ||
  process.getuid?.() !== 0 ||
  process.env.NODE_ENV !== "production" ||
  !/^\/opt\/omnilodge\/releases\/omnilodge-[a-z0-9-]+\/be$/.test(process.cwd())
)
  throw new Error("Use the immutable production release as root.");
const environment = await fs.lstat("/etc/omnilodge/backend.env");
if (
  !environment.isFile() ||
  environment.isSymbolicLink() ||
  environment.uid !== 0 ||
  environment.mode & 0o077
)
  throw new Error("Protected backend environment is required.");
process.env.OMNILODGE_WORKSPACE_WORKER = "true";
const { default: database } = await import("../config/database.js");
const config = await import("../services/configService.js");
try {
  await database.authenticate();
  await config.initializeConfigRegistry();
  const hosts = config.getConfigValue(
    "SYSTEM_MANAGEMENT_HOSTS",
  ) as SystemHost[];
  const host = hosts.find((h) => h.id === "production");
  if (!host?.managed)
    throw new Error("Existing managed production host is required.");
  const [rows] = await database.query(
    `SELECT u.id FROM users u JOIN "userTypes" r ON r.id=u."userTypeId" WHERE u.status AND u.approved AND r.status AND r.slug IN ('admin','administrator') AND NOT EXISTS(SELECT 1 FROM user_type_product_types p WHERE p.user_type_id=r.id) ORDER BY u.id`,
  );
  const actors = (rows as { id: number }[]).filter(
    (a) => host.identities[String(a.id)],
  );
  if (!actors.length) throw new Error("No enrolled global administrators.");
  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log(
      JSON.stringify({
        mode: "read-only plan",
        actors: actors.map((a) => a.id),
        alreadyEnrolled: host.rootFiles === true,
        changes:
          "Enroll dedicated root Files credentials and filesystem root. The root Files master switch stays disabled until verification.",
      }),
    );
  } else {
    if (!process.argv.includes(`--confirm-database=${process.env.DB_NAME}`))
      throw new Error("Confirm the exact database.");
    const reason = process.argv
      .find((a) => a.startsWith("--reason="))
      ?.slice(9);
    if (!reason || reason.trim().length < 10)
      throw new Error("Record the explicit root enrollment reason.");
    if (host.rootFiles)
      throw new Error(
        "Already enrolled; do not implicitly rotate root credentials.",
      );
    await config.updateConfigValue({
      key: "SYSTEM_MANAGEMENT_ROOT_FILES_ENABLED",
      value: false,
      actorId: null,
      reason,
    });
    const policyPath = "/etc/omnilodge-system/adapter.json";
    const policyStat = await fs.lstat(policyPath);
    if (
      !policyStat.isFile() ||
      policyStat.isSymbolicLink() ||
      policyStat.uid !== 0 ||
      policyStat.mode & 0o077
    )
      throw new Error("Invalid root policy ownership.");
    const policy = JSON.parse(await fs.readFile(policyPath, "utf8"));
    const credentials = {
      ...(config.getConfigValue("SYSTEM_MANAGEMENT_CREDENTIALS") as Record<
        string,
        unknown
      >),
    };
    const grants = config.getConfigValue("SYSTEM_MANAGEMENT_HOST_GRANTS") as {
      actorId: number;
      hostId: string;
      actions: string[];
    }[];
    for (const actor of actors) {
      const user = `omnilodge-root-files-${actor.id}`,
        id = `production-root-files-${actor.id}`;
      if (!policy.actors[String(actor.id)] || credentials[id])
        throw new Error("Partial root enrollment requires explicit recovery.");
      const uid = Number(
        execFileSync("/usr/bin/id", ["-u", user], { encoding: "utf8" }).trim(),
      );
      if (!Number.isSafeInteger(uid) || uid <= 0)
        throw new Error("Provision the dedicated non-root login first.");
      const staging = `/srv/omnilodge-root-staging/u${actor.id}`,
        info = await fs.lstat(staging);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        info.uid !== 0 ||
        info.mode & 0o077
      )
        throw new Error("Private root staging is required.");
      const temporary = await fs.mkdtemp("/etc/omnilodge-system/.root-key-");
      try {
        const filename = temporary + "/key";
        execFileSync(
          "/usr/bin/ssh-keygen",
          ["-q", "-t", "ed25519", "-N", "", "-f", filename],
          { stdio: "ignore" },
        );
        await fs.writeFile(
          `/etc/ssh/authorized_keys/${user}`,
          await fs.readFile(filename + ".pub"),
          { mode: 0o644, flag: "wx" },
        );
        credentials[id] = {
          privateKey: await fs.readFile(filename, "utf8"),
          revision: crypto.randomUUID(),
        };
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
      Object.assign(host.identities[String(actor.id)], {
        fileUsername: user,
        fileCredentialId: id,
      });
      policy.actors[String(actor.id)].roots.server = {
        path: "/",
        staging,
        writable: true,
        gid: 0,
        privileged: true,
      };
      const grant = grants.find(
        (g) => g.actorId === actor.id && g.hostId === host.id,
      );
      if (!grant) throw new Error("Existing host grant required.");
      if (!grant.actions.includes("rootFiles")) grant.actions.push("rootFiles");
    }
    host.rootFiles = true;
    host.roots = [
      {
        id: "server",
        name: "Server filesystem",
        path: "/",
        writable: true,
        managed: true,
        privileged: true,
      },
    ];
    await config.updateConfigValue({
      key: "SYSTEM_MANAGEMENT_CREDENTIALS",
      value: credentials,
      actorId: null,
      reason,
    });
    const temporaryPolicy =
      policyPath + ".root-enrollment-" + crypto.randomUUID();
    await fs.writeFile(
      temporaryPolicy,
      JSON.stringify(policy, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    await fs.rename(temporaryPolicy, policyPath);
    await config.updateConfigValue({
      key: "SYSTEM_MANAGEMENT_HOSTS",
      value: hosts,
      actorId: null,
      reason,
    });
    await config.updateConfigValue({
      key: "SYSTEM_MANAGEMENT_HOST_GRANTS",
      value: grants,
      actorId: null,
      reason,
    });
    console.log(
      JSON.stringify({
        ok: true,
        rootFilesEnabled: false,
        actors: actors.map((a) => a.id),
        next: "Verify root SFTP read-only transport and signed managed file operations, then enable the Root Files Control Panel switch.",
      }),
    );
  }
} finally {
  await database.close();
}
