import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runTool } from "./recovery.js";
import { WorkspaceError } from "./types.js";

/** Back up the independent journal as a separate archive; never merge it into
 * an application dump or print its bootstrap connection string. */
export async function backupWorkspaceControl(options: {
  connectionString: string;
  directory: string;
  binary: string;
  timeoutMs: number;
}): Promise<string> {
  const connection = new URL(options.connectionString);
  if (
    !["postgres:", "postgresql:"].includes(connection.protocol) ||
    !["127.0.0.1", "localhost", "[::1]", "::1"].includes(connection.hostname)
  )
    throw new WorkspaceError(
      503,
      "CONTROL_BACKUP_TOPOLOGY",
      "The managed control-store backup currently requires the provisioned loopback database. Configure an independently verified backup for a remote control store.",
    );
  if (
    !/^\d+$/.test(String(connection.port || 5432)) ||
    !connection.username ||
    !connection.password ||
    connection.pathname.length < 2
  )
    throw new WorkspaceError(
      503,
      "CONTROL_BACKUP_CONFIGURATION",
      "Invalid private control-store bootstrap configuration.",
    );
  const directory = await fs.realpath(options.directory),
    filename = `workspace-control-${new Date().toISOString().replace(/[-:TZ.]/g, "")}-${crypto.randomBytes(4).toString("hex")}.backup`,
    destination = path.join(directory, filename),
    partial = destination + ".partial";
  await fs.writeFile(partial, Buffer.alloc(0), { flag: "wx", mode: 0o600 });
  try {
    await runTool(
      options.binary,
      [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--file",
        partial,
        "--dbname",
        decodeURIComponent(connection.pathname.slice(1)),
      ],
      {
        PGHOST: connection.hostname.replace(/^\[|\]$/g, ""),
        PGPORT: connection.port || "5432",
        PGUSER: decodeURIComponent(connection.username),
        PGPASSWORD: decodeURIComponent(connection.password),
        PGSSLMODE: "disable",
        PGAPPNAME: "omnilodge-workspace-control-backup",
      },
      options.timeoutMs,
    );
    const file = await fs.open(partial, "r");
    try {
      const header = Buffer.alloc(5);
      await file.read(header, 0, 5, 0);
      if (header.toString("ascii") !== "PGDMP")
        throw new WorkspaceError(
          500,
          "CONTROL_BACKUP_FORMAT",
          "The control backup did not produce a PostgreSQL custom archive.",
        );
    } finally {
      await file.close();
    }
    await fs.rename(partial, destination);
    return filename;
  } finally {
    await fs.unlink(partial).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

/** A full control archive includes independently protected schemas. Reuse the
 * backup process's existing database maintenance identity; never grant either
 * interactive runtime access to the other's credentials or authority tables. */
export function controlBackupConnection(
  controlUrl: string,
  environment: NodeJS.ProcessEnv,
): string {
  const control = new URL(controlUrl);
  const loopback = (host: string) =>
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (
    !loopback(control.hostname) ||
    !loopback(environment.DB_HOST || "127.0.0.1") ||
    Number(control.port || 5432) !== Number(environment.DB_PORT || 5432)
  )
    throw new WorkspaceError(
      503,
      "CONTROL_BACKUP_TOPOLOGY",
      "The control archive must use the verified local database cluster.",
    );
  if (!environment.DB_USER || !environment.DB_PASSWORD)
    throw new WorkspaceError(
      503,
      "CONTROL_BACKUP_CONFIGURATION",
      "The existing database backup maintenance identity is unavailable.",
    );
  control.username = environment.DB_USER;
  control.password = environment.DB_PASSWORD;
  return control.toString();
}
