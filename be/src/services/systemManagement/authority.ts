import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import pg from "pg";
import bcrypt from "bcryptjs";
import { QueryTypes } from "sequelize";
import sequelize from "../../config/database.js";
import {
  getConfigValue,
  refreshConfigCacheKeys,
  updateConfigValue,
  withSystemManagementConfigLock,
} from "../configService.js";
import {
  SYSTEM_ACTIONS,
  SYSTEM_MANAGEMENT_CONFIG,
  type SystemAction,
  type SystemHost,
} from "../../config/systemManagementConfig.js";
import { validLoginSession } from "./loginSessions.js";

export class ManagementError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
function fail(status: number, code: string, message: string): never {
  throw new ManagementError(status, code, message);
}
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const nonce = () => crypto.randomBytes(32).toString("base64url");
const keys = SYSTEM_MANAGEMENT_CONFIG.map((c) => c.key);
let pool: pg.Pool | undefined;
export function authorityPool(): pg.Pool {
  const url = process.env.SYSTEM_MANAGEMENT_AUTHORITY_URL;
  if (!url)
    fail(503, "UNAVAILABLE", "System Management authority is not provisioned.");
  return (pool ??= new pg.Pool({
    connectionString: url,
    max: 3,
    statement_timeout: 5000,
    application_name: "omnilodge-system-authority",
  }));
}
export async function systemPolicy() {
  await refreshConfigCacheKeys(keys);
  const values = Object.fromEntries(
    keys.map((key) => [key, getConfigValue(key)]),
  );
  const revision = hash(JSON.stringify(values));
  return {
    values,
    revision,
    enabled: values.SYSTEM_MANAGEMENT_ENABLED === true,
    origin: String(values.SYSTEM_MANAGEMENT_ORIGIN),
    hosts: (values.SYSTEM_MANAGEMENT_HOSTS || []) as SystemHost[],
  };
}
export async function actorAuthority(
  actorId: number,
  action: SystemAction = "view",
) {
  const rows = await sequelize.query<{
    id: number;
    role: string;
    scoped: boolean;
    page: boolean;
    actions: string[];
    name: string;
  }>(
    `SELECT u.id,r.slug AS role,concat_ws(' ',u."firstName",u."lastName") AS name,
    EXISTS(SELECT 1 FROM user_type_product_types s WHERE s.user_type_id=r.id) AS scoped,
    EXISTS(SELECT 1 FROM "rolePagePermissions" p JOIN pages g ON g.id=p."pageId" AND g.status AND g.slug='settings-system-management' WHERE p."userTypeId"=r.id AND p.status AND p."canView") AS page,
    ARRAY(SELECT a.key FROM "roleModulePermissions" p JOIN modules m ON m.id=p."moduleId" AND m.status AND m.slug='system-management' JOIN actions a ON a.id=p."actionId" AND a.status JOIN "moduleActions" ma ON ma."moduleId"=m.id AND ma."actionId"=a.id AND ma.enabled WHERE p."userTypeId"=r.id AND p.allowed AND p.status) AS actions
    FROM users u JOIN "userTypes" r ON r.id=u."userTypeId" AND r.status WHERE u.id=$1 AND u.status AND u.approved`,
    { bind: [actorId], type: QueryTypes.SELECT },
  );
  const actor = rows[0];
  if (
    !actor ||
    actor.scoped ||
    !["admin", "administrator"].includes(actor.role) ||
    !actor.page ||
    !actor.actions.includes("view") ||
    !actor.actions.includes(action)
  )
    fail(
      403,
      "FORBIDDEN",
      "System Management requires a global administrator with this action enabled.",
    );
  return actor;
}
export async function createLaunch(actorId: number, parent: unknown) {
  await actorAuthority(actorId);
  if (!(await validLoginSession(parent, actorId)))
    fail(
      401,
      "SIGN_IN_REQUIRED",
      "Please sign in again before opening System Management.",
    );
  const policy = await systemPolicy();
  if (!policy.enabled)
    fail(503, "DISABLED", "System Management is disabled in Control Panel.");
  const token = nonce();
  await authorityPool().query(
    `INSERT INTO system_management.launch_grants(token_hash,actor_id,parent_jti,policy_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 seconds')`,
    [hash(token), actorId, parent, policy.revision],
  );
  return { grant: token, origin: policy.origin };
}
type SessionRow = {
  token_hash: string;
  actor_id: number;
  parent_jti: string;
  policy_hash: string;
  expires_at: Date;
  last_activity_at: Date;
  step_up_until: Date | null;
};
async function session(token: unknown, action: SystemAction, stepUp = true) {
  if (typeof token !== "string" || !/^[\w-]{43}$/.test(token))
    fail(401, "SIGN_IN_REQUIRED", "Open System Management from Settings.");
  const row = (
    await authorityPool().query<SessionRow>(
      "SELECT * FROM system_management.authority_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()",
      [hash(token)],
    )
  ).rows[0];
  if (!row || !(await validLoginSession(row.parent_jti, row.actor_id)))
    fail(
      401,
      "SESSION_EXPIRED",
      "Management session expired. Open it again from Settings.",
    );
  const actor = await actorAuthority(row.actor_id, action),
    policy = await systemPolicy();
  if (
    row.last_activity_at.getTime() +
      Number(
        (
          policy.values.SYSTEM_MANAGEMENT_SESSION_POLICY as {
            idleSeconds: number;
          }
        ).idleSeconds,
      ) *
        1000 <
    Date.now()
  )
    fail(
      401,
      "SESSION_EXPIRED",
      "Management session timed out after inactivity. Open it again from Settings.",
    );
  if (!policy.enabled || policy.revision !== row.policy_hash)
    fail(
      409,
      "POLICY_CHANGED",
      "Administration policy changed. Open a new management session.",
    );
  if (
    stepUp &&
    (!row.step_up_until || row.step_up_until.getTime() < Date.now())
  )
    fail(401, "STEP_UP_REQUIRED", "Confirm your password to continue.");
  return { row, actor, policy };
}
export async function authorityRpc(
  method: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (method === "redeem") {
    if (typeof args.grant !== "string")
      fail(401, "INVALID_GRANT", "Invalid launch grant.");
    const row = (
      await authorityPool().query(
        `UPDATE system_management.launch_grants SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING *`,
        [hash(args.grant)],
      )
    ).rows[0];
    if (!row)
      fail(401, "INVALID_GRANT", "Launch grant expired or already used.");
    await actorAuthority(row.actor_id);
    if (!(await validLoginSession(row.parent_jti, row.actor_id)))
      fail(401, "SESSION_EXPIRED", "Parent login expired.");
    const policy = await systemPolicy();
    if (
      !policy.enabled ||
      policy.revision !== row.policy_hash ||
      args.origin !== policy.origin
    )
      fail(
        409,
        "POLICY_CHANGED",
        "Policy or console origin changed. Launch again from Settings.",
      );
    if (typeof args.existingSession === "string") {
      try {
        const current = await session(args.existingSession, "view", false);
        if (
          current.row.actor_id === row.actor_id &&
          current.row.parent_jti === row.parent_jti
        )
          return { token: args.existingSession };
      } catch (error) {
        if (!(error instanceof ManagementError)) throw error;
      }
    }
    const token = nonce();
    await authorityPool().query(
      `INSERT INTO system_management.authority_sessions(token_hash,actor_id,parent_jti,policy_hash,expires_at) VALUES($1,$2,$3,$4,now()+($5 * interval '1 second'))`,
      [
        hash(token),
        row.actor_id,
        row.parent_jti,
        policy.revision,
        (
          policy.values.SYSTEM_MANAGEMENT_SESSION_POLICY as {
            absoluteSeconds: number;
          }
        ).absoluteSeconds,
      ],
    );
    return { token };
  }
  const action = SYSTEM_ACTIONS.includes(args.action as SystemAction)
    ? (args.action as SystemAction)
    : "view";
  const ctx = await session(
    args.session,
    ["config", "profiles"].includes(method)
      ? "manageHosts"
      : ["credentials", "credential-metadata"].includes(method)
        ? "manageCredentials"
        : action,
    !["check", "touch", "step-up", "logout"].includes(method) &&
      !(method === "envelope" && args.operation === "renewOperation"),
  );
  const { row, actor, policy } = ctx;
  if (method === "touch") {
    await authorityPool().query(
      "UPDATE system_management.authority_sessions SET last_activity_at=now() WHERE token_hash=$1",
      [row.token_hash],
    );
    return { ok: true };
  }
  if (method === "logout") {
    await authorityPool().query(
      "UPDATE system_management.authority_sessions SET revoked_at=now() WHERE token_hash=$1",
      [row.token_hash],
    );
    return { ok: true };
  }
  if (method === "step-up") {
    const attempts = await authorityPool().query(
      `INSERT INTO system_management.auth_attempts(actor_id,window_start,attempts) VALUES($1,date_trunc('hour',now()),1) ON CONFLICT(actor_id,window_start) DO UPDATE SET attempts=system_management.auth_attempts.attempts+1 RETURNING attempts`,
      [row.actor_id],
    );
    if (attempts.rows[0].attempts > 10)
      fail(
        429,
        "RATE_LIMITED",
        "Too many authentication attempts. Try again later.",
      );
    const user = (
      await sequelize.query<{ password: string }>(
        "SELECT password FROM users WHERE id=$1",
        { bind: [row.actor_id], type: QueryTypes.SELECT },
      )
    )[0];
    if (
      typeof args.password !== "string" ||
      args.password.length > 1024 ||
      !user ||
      !(await bcrypt.compare(args.password, user.password))
    )
      fail(403, "AUTH_REJECTED", "Password was not accepted.");
    const seconds = (
      policy.values.SYSTEM_MANAGEMENT_SESSION_POLICY as {
        stepUpSeconds: number;
      }
    ).stepUpSeconds;
    const until = new Date(Date.now() + seconds * 1000);
    await authorityPool().query(
      "UPDATE system_management.authority_sessions SET step_up_until=$2 WHERE token_hash=$1",
      [row.token_hash, until],
    );
    return { expiresAt: until };
  }
  const hosts = policy.hosts.filter(
    (h) => h.enabled && h.identities[String(row.actor_id)],
  );
  if (method === "check")
    return {
      actorId: actor.id,
      name: actor.name,
      actions: actor.actions,
      policyHash: policy.revision,
      expiresAt: row.expires_at,
      stepUpUntil: row.step_up_until,
      hosts: hosts.map((h) => ({
        ...h,
        identities: undefined,
        username: h.identities[String(actor.id)].username,
      })),
      limits: Object.fromEntries(
        Object.entries(policy.values).filter(
          ([k]) =>
            ![
              "SYSTEM_MANAGEMENT_CREDENTIALS",
              "SYSTEM_MANAGEMENT_HOSTS",
              "SYSTEM_MANAGEMENT_HOST_GRANTS",
            ].includes(k),
        ),
      ),
    };
  if (method === "profiles") return { hosts: policy.hosts };
  if (method === "credential-metadata")
    return {
      credentials: Object.entries(
        policy.values.SYSTEM_MANAGEMENT_CREDENTIALS as Record<
          string,
          Record<string, unknown>
        >,
      ).map(([id, value]) => ({
        id,
        type: typeof value.privateKey === "string" ? "privateKey" : "password",
        references: policy.hosts.flatMap((h) =>
          Object.entries(h.identities).flatMap(([actorId, identity]) =>
            [identity.credentialId, identity.fileCredentialId].includes(id)
              ? [{ hostId: h.id, actorId: Number(actorId) }]
              : [],
          ),
        ),
      })),
    };
  const host = hosts.find((h) => h.id === args.hostId);
  if (method === "config")
    return withSystemManagementConfigLock(async () => {
      await actorAuthority(actor.id, "manageHosts");
      const latest = await systemPolicy();
      if (
        typeof args.key !== "string" ||
        !keys.includes(args.key) ||
        args.key === "SYSTEM_MANAGEMENT_CREDENTIALS"
      )
        fail(
          400,
          "INVALID_CONFIG",
          "Use the protected credential operation for secret updates.",
        );
      if (args.revision !== latest.revision)
        fail(
          409,
          "POLICY_CHANGED",
          "Refresh the server configuration before saving.",
        );
      await updateConfigValue({
        key: args.key,
        value: args.value,
        actorId: actor.id,
        reason: String(args.reason || "System Management configuration").slice(
          0,
          500,
        ),
      });
      return { ok: true };
    });
  if (method === "credentials")
    return withSystemManagementConfigLock(async () => {
      await actorAuthority(actor.id, "manageCredentials");
      const latest = await systemPolicy();
      if (
        args.revision !== latest.revision ||
        typeof args.id !== "string" ||
        !/^[a-zA-Z0-9][\w-]{0,63}$/.test(args.id)
      )
        fail(
          409,
          "POLICY_CHANGED",
          "Refresh configuration before changing credentials.",
        );
      if (typeof args.reason !== "string" || args.reason.trim().length < 3)
        fail(
          400,
          "REASON_REQUIRED",
          "Record a reason for changing SSH credentials.",
        );
      const credentials = {
        ...(latest.values.SYSTEM_MANAGEMENT_CREDENTIALS as Record<
          string,
          unknown
        >),
      };
      if (args.remove === true) delete credentials[args.id];
      else credentials[args.id] = args.value;
      await updateConfigValue({
        key: "SYSTEM_MANAGEMENT_CREDENTIALS",
        value: credentials,
        actorId: actor.id,
        reason:
          `Credential ${args.id}: ${String(args.reason || "rotation")}`.slice(
            0,
            500,
          ),
      });
      return { ok: true };
    });
  if (!host)
    fail(403, "HOST_FORBIDDEN", "This server is not assigned to your account.");
  const grants = policy.values.SYSTEM_MANAGEMENT_HOST_GRANTS as {
    actorId: number;
    hostId: string;
    actions: string[];
  }[];
  if (
    !grants.some(
      (g) =>
        g.actorId === actor.id &&
        g.hostId === host.id &&
        g.actions.includes(action),
    )
  )
    fail(
      403,
      "HOST_FORBIDDEN",
      "The requested action is not granted on this server.",
    );
  if (method === "authorize") return { ok: true };
  if (method === "connection") {
    const identity = host.identities[String(actor.id)];
    const file = args.kind === "sftp";
    const credentialId = file
      ? identity.fileCredentialId || identity.credentialId
      : identity.credentialId;
    const allCredentials = policy.values
      .SYSTEM_MANAGEMENT_CREDENTIALS as Record<string, unknown>;
    const credential = Object.hasOwn(allCredentials, credentialId)
      ? allCredentials[credentialId]
      : undefined;
    if (!credential)
      fail(
        503,
        "CREDENTIAL_UNAVAILABLE",
        "This server credential is not configured.",
      );
    return {
      host: { ...host, identities: undefined },
      username: file
        ? identity.fileUsername || identity.username
        : identity.username,
      credential,
      connectionLimits: policy.values.SYSTEM_MANAGEMENT_CONNECTION_LIMITS,
      actorId: actor.id,
      policyHash: policy.revision,
    };
  }
  if (method === "envelope") {
    const operationActions: Record<string, SystemAction> = {
      status: "view",
      renewOperation: "writeFiles",
      trashList: "readFiles",
      terminal: "connectTerminal",
      renew: "connectTerminal",
      stop: "connectTerminal",
      metrics: "view",
      services: "view",
      logs: "viewLogs",
      restart: "controlServices",
      publish: "writeFiles",
      mkdir: "writeFiles",
      rename: "writeFiles",
      copy: "writeFiles",
      trash: "deleteFiles",
      delete: "deleteFiles",
      restore: "writeFiles",
      chmod: "changePermissions",
      checksum: "readFiles",
      statvfs: "readFiles",
      registerStaging: "writeFiles",
    };
    const required = operationActions[String(args.operation)];
    if (!required || action !== required)
      fail(403, "FORBIDDEN", "Operation and permission do not match.");
    const inputParams = args.params;
    if (
      !inputParams ||
      typeof inputParams !== "object" ||
      Array.isArray(inputParams)
    )
      fail(400, "INVALID_OPERATION", "Invalid adapter parameters.");
    const params = {
      ...(inputParams as Record<string, unknown>),
      stagingExpiresAt: Math.max(
        Date.now() +
          Number(
            (policy.values.SYSTEM_MANAGEMENT_RETENTION as { tempHours: number })
              .tempHours,
          ) *
            3600000,
        row.expires_at.getTime() + 300000,
      ),
      runtimeBudget: policy.values.SYSTEM_MANAGEMENT_REMOTE_BUDGET,
      storagePolicy: policy.values.SYSTEM_MANAGEMENT_STORAGE_POLICY,
      remoteLeaseSeconds: (
        policy.values.SYSTEM_MANAGEMENT_SESSION_POLICY as {
          remoteLeaseSeconds: number;
        }
      ).remoteLeaseSeconds,
      authorizationExpiresAt: row.expires_at.getTime(),
      metadataExpiresAt:
        Date.now() +
        Number(
          (
            policy.values.SYSTEM_MANAGEMENT_RETENTION as {
              transferDays: number;
            }
          ).transferDays,
        ) *
          86400000,
    };
    const key = await fs.readFile(
      process.env.SYSTEM_MANAGEMENT_SIGNING_KEY_FILE || "",
    );
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        actorId: actor.id,
        hostId: host.id,
        action: args.operation,
        params,
        nonce: crypto.randomUUID(),
        expires: Date.now() + 30000,
        policyHash: policy.revision,
      }),
    );
    return {
      ticket: `${payload.toString("base64url")}.${crypto.sign(null, payload, key).toString("base64url")}`,
    };
  }
  fail(400, "INVALID_OPERATION", "Unknown management authority operation.");
}

export async function cleanupSystemManagementHistory(): Promise<void> {
  const policy = await systemPolicy(),
    retention = policy.values.SYSTEM_MANAGEMENT_RETENTION as {
      activityDays: number;
      transferDays: number;
      tempHours: number;
    };
  const db = authorityPool();
  await db.query(
    "DELETE FROM system_management.launch_grants WHERE token_hash IN(SELECT token_hash FROM system_management.launch_grants WHERE expires_at<now()-interval '1 day' LIMIT 1000)",
  );
  await db.query(
    "DELETE FROM system_management.authority_sessions WHERE token_hash IN(SELECT token_hash FROM system_management.authority_sessions WHERE expires_at<now()-interval '1 day' OR revoked_at<now()-interval '1 day' LIMIT 1000)",
  );
  await db.query(
    "DELETE FROM system_management.auth_attempts WHERE window_start<now()-interval '1 day'",
  );
  await db.query(
    "DELETE FROM system_management.reservations WHERE job_id IN(SELECT job_id FROM system_management.reservations WHERE expires_at<now() LIMIT 1000)",
  );
  await db.query(
    "DELETE FROM system_management.jobs WHERE id IN(SELECT j.id FROM system_management.jobs j WHERE NOT EXISTS(SELECT 1 FROM system_management.reservations r WHERE r.job_id=j.id) AND ((j.state IN('completed','closed','expired','failed','cancelled','skipped') AND j.updated_at<now()-($1*interval '1 day')) OR(j.state='reviewed' AND j.updated_at<now()-($2*interval '1 hour'))) LIMIT 500)",
    [retention.transferDays, retention.tempHours],
  );
  await db.query(
    "DELETE FROM system_management.audit_events WHERE id IN(SELECT id FROM system_management.audit_events WHERE created_at<now()-($1*interval '1 day') LIMIT 5000)",
    [retention.activityDays],
  );
}

export async function startSystemManagementAuthority(): Promise<
  () => Promise<void>
> {
  const socket = process.env.SYSTEM_MANAGEMENT_AUTHORITY_SOCKET;
  if (!socket) return async () => {};
  const secret = await fs.readFile(
    process.env.SYSTEM_MANAGEMENT_RPC_SECRET_FILE || "",
    "utf8",
  );
  await authorityPool().query(
    "UPDATE system_management.authority_sessions SET revoked_at=now() WHERE revoked_at IS NULL",
  );
  const used = new Map<string, number>();
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    try {
      if (req.method !== "POST" || req.url !== "/rpc")
        fail(404, "NOT_FOUND", "Not found.");
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 524288) fail(413, "TOO_LARGE", "Request is too large.");
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks),
        time = String(req.headers["x-management-time"] || ""),
        n = String(req.headers["x-management-nonce"] || ""),
        signature = String(req.headers["x-management-signature"] || "");
      if (
        !/^\d{13}$/.test(time) ||
        Math.abs(Date.now() - Number(time)) > 30000 ||
        !/^[\w-]{20,64}$/.test(n)
      )
        fail(401, "AUTH_REJECTED", "Invalid authority request.");
      for (const [k, v] of used) if (v < Date.now() - 60000) used.delete(k);
      const expected = crypto
        .createHmac("sha256", secret.trim())
        .update(`${time}\n${n}\n`)
        .update(body)
        .digest("hex");
      if (
        !/^[0-9a-f]{64}$/.test(signature) ||
        !crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(expected),
        ) ||
        used.has(n)
      )
        fail(401, "AUTH_REJECTED", "Invalid authority signature.");
      if (used.size >= 10000)
        fail(429, "RATE_LIMITED", "Authority request window is full.");
      used.set(n, Date.now());
      const input = JSON.parse(body.toString());
      const result = await authorityRpc(input.method, input.args || {});
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = error instanceof ManagementError ? error.status : 503;
      res.end(
        JSON.stringify({
          code:
            error instanceof ManagementError
              ? error.code
              : "AUTHORITY_UNAVAILABLE",
          message:
            error instanceof ManagementError
              ? error.message
              : "Management authority unavailable.",
        }),
      );
    }
  });
  server.requestTimeout = 15000;
  await fs.mkdir(socket.slice(0, socket.lastIndexOf("/")), {
    recursive: true,
    mode: 0o750,
  });
  try {
    const stat = await fs.lstat(socket);
    if (!stat.isSocket())
      throw new Error("Authority socket path is not a socket.");
    await fs.unlink(socket);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  await fs.chmod(socket, 0o660);
  let cleanupRunning = false;
  const cleanupTimer = setInterval(() => {
    if (cleanupRunning) return;
    cleanupRunning = true;
    void cleanupSystemManagementHistory()
      .catch(() => {})
      .finally(() => {
        cleanupRunning = false;
      });
  }, 60000);
  cleanupTimer.unref();
  return () => {
    clearInterval(cleanupTimer);
    return new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
}
