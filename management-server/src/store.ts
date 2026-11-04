import pg from "pg";
import crypto from "node:crypto";
import { Fault, limit, type Context } from "./types.js";
export type Job = {
  id: string;
  actorId: number;
  hostId: string;
  kind: string;
  state: string;
  data: Record<string, unknown>;
  updatedAt?: string;
};
export function publicJobData(
  data: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const key of [
    "path",
    "rootId",
    "serviceId",
    "offset",
    "size",
    "sha256",
    "error",
    "verification",
    "phase",
    "managed",
    "recording",
    "expires",
    "cleanup",
  ]) {
    const value = data[key];
    if (typeof value === "string")
      result[key] = value.slice(0, key === "error" ? 1000 : 4096);
    else if (typeof value === "number" || typeof value === "boolean")
      result[key] = value;
  }
  return result;
}
export class Store {
  readonly pool: pg.Pool;
  private admission = { jobs: 4000, events: 90000, bytes: 100663296 };
  configure(ctx: Context) {
    this.admission = {
      jobs: Math.min(4000, limit(ctx, "JOURNAL_LIMITS", "jobs", 4000)),
      events: Math.min(90000, limit(ctx, "JOURNAL_LIMITS", "events", 90000)),
      bytes: Math.min(
        100663296,
        limit(ctx, "JOURNAL_LIMITS", "bytes", 100663296),
      ),
    };
  }
  constructor(
    url: string,
    private key: Buffer,
  ) {
    if (!url || key.length !== 32)
      throw new Error(
        "Restricted journal URL and encryption key are required.",
      );
    this.pool = new pg.Pool({
      connectionString: url,
      max: 4,
      statement_timeout: 5000,
      application_name: "omnilodge-system-broker",
    });
  }
  seal(value: unknown) {
    const iv = crypto.randomBytes(12),
      c = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      c.update(JSON.stringify(value)),
      c.final(),
    ]);
    return Buffer.concat([iv, c.getAuthTag(), ciphertext]).toString("base64");
  }
  open(value: string) {
    const b = Buffer.from(value, "base64"),
      d = crypto.createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([d.update(b.subarray(28)), d.final()]).toString(),
    ) as Record<string, unknown>;
  }
  async ready() {
    const version = await this.pool.query(
      "SELECT version,checksum FROM system_management.schema_versions ORDER BY version DESC LIMIT 1",
    );
    if (
      version.rows[0]?.version !== 1 ||
      version.rows[0]?.checksum !== "system-management-v1"
    )
      throw new Error("Management control schema is incompatible.");
    await this.pool.query("SELECT 1 FROM system_management.jobs LIMIT 0");
  }
  async create(
    actorId: number,
    hostId: string,
    kind: string,
    data: Record<string, unknown>,
    idempotency?: string,
  ): Promise<Job> {
    const id = crypto.randomUUID(),
      intent = crypto
        .createHash("sha256")
        .update(JSON.stringify(data))
        .digest("hex");
    if (idempotency && !/^[a-zA-Z0-9_-]{1,128}$/.test(idempotency))
      throw new Fault(
        400,
        "INVALID_IDEMPOTENCY",
        "Invalid operation idempotency key.",
      );
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('system-management.admission'))",
      );
      const usage = (
        await client.query(
          "SELECT jobs,events,bytes FROM system_management.journal_usage WHERE singleton",
        )
      ).rows[0];
      const prior = (
        await client.query(
          "SELECT * FROM system_management.jobs WHERE actor_id=$1 AND idempotency_key=$2",
          [actorId, idempotency || id],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.intent_hash !== intent ||
          prior.host_id !== hostId ||
          prior.kind !== kind
        )
          throw new Fault(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This idempotency key belongs to a different operation.",
          );
        await client.query("COMMIT");
        return this.decode(prior);
      }
      const payload = this.seal(data),
        publicPayload = this.seal(publicJobData(data));
      if (
        Number(usage.jobs) >= this.admission.jobs ||
        Number(usage.events) >= this.admission.events ||
        Number(usage.bytes) +
          Buffer.byteLength(payload) +
          Buffer.byteLength(publicPayload) >
          this.admission.bytes
      )
        throw new Fault(
          507,
          "JOURNAL_FULL",
          "Management history is at its admission limit. Clean expired records before starting another operation.",
        );
      await client.query(
        "INSERT INTO system_management.jobs(id,actor_id,host_id,kind,state,payload,idempotency_key,intent_hash,public_payload) VALUES($1,$2,$3,$4,'queued',$5,$6,$7,$8)",
        [
          id,
          actorId,
          hostId,
          kind,
          payload,
          idempotency || id,
          intent,
          publicPayload,
        ],
      );
      await client.query(
        "INSERT INTO system_management.audit_events(actor_id,host_id,action,outcome,operation_id,summary) VALUES($1,$2,$3,'accepted',$4,$5)",
        [actorId, hostId, kind, id, this.seal({})],
      );
      await client.query("COMMIT");
      return { id, actorId, hostId, kind, state: "queued", data };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "54000")
        throw new Fault(
          507,
          "JOURNAL_FULL",
          "Management history is full. Existing uncertain outcomes have been retained.",
        );
      throw error;
    } finally {
      client.release();
    }
  }
  private decode(r: Record<string, unknown>): Job {
    return {
      id: String(r.id),
      actorId: Number(r.actor_id),
      hostId: String(r.host_id),
      kind: String(r.kind),
      state: String(r.state),
      data: this.open(String(r.payload)),
      updatedAt: String(r.updated_at),
    };
  }
  async get(id: string, actorId: number) {
    const r = await this.pool.query(
      "SELECT * FROM system_management.jobs WHERE id=$1 AND actor_id=$2",
      [id, actorId],
    );
    if (!r.rows[0]) throw new Fault(404, "NOT_FOUND", "Operation not found.");
    return this.decode(r.rows[0]);
  }
  async claim(job: Job, states: string[], next: string) {
    const result = await this.pool.query(
      "UPDATE system_management.jobs SET state=$3,updated_at=now() WHERE id=$1 AND actor_id=$2 AND state=ANY($4::text[]) RETURNING id",
      [job.id, job.actorId, next, states],
    );
    if (result.rowCount !== 1)
      throw new Fault(
        409,
        "TRANSFER_STATE",
        "Another request owns this operation.",
      );
    job.state = next;
  }
  async update(job: Job, state: string, patch: Record<string, unknown> = {}) {
    const data = { ...job.data, ...patch };
    await this.pool.query(
      "UPDATE system_management.jobs SET state=$2,payload=$3,public_payload=$5,updated_at=now() WHERE id=$1 AND actor_id=$4",
      [
        job.id,
        state,
        this.seal(data),
        job.actorId,
        this.seal(publicJobData(data)),
      ],
    );
    job.state = state;
    job.data = data;
    return job;
  }
  async list(actorId: number, kind?: string) {
    const r = await this.pool.query(
      "SELECT id,actor_id,host_id,kind,state,public_payload AS payload,updated_at FROM system_management.jobs WHERE actor_id=$1 AND ($2::text IS NULL OR kind=$2) ORDER BY created_at DESC LIMIT 100",
      [actorId, kind || null],
    );
    return r.rows.map((row) => this.decode(row));
  }
  async event(
    actorId: number,
    hostId: string,
    action: string,
    outcome: string,
    operationId?: string,
    summary: Record<string, unknown> = {},
  ) {
    await this.pool.query(
      "INSERT INTO system_management.audit_events(actor_id,host_id,action,outcome,operation_id,summary) VALUES($1,$2,$3,$4,$5,$6)",
      [
        actorId,
        hostId,
        action,
        outcome,
        operationId || null,
        this.seal(summary),
      ],
    );
  }
  async activity(actorId: number, before?: string) {
    const r = await this.pool.query(
      "SELECT id,actor_id,host_id,action,outcome,operation_id,created_at FROM system_management.audit_events WHERE actor_id=$1 AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT 100",
      [actorId, before || null],
    );
    return r.rows;
  }
  async recover() {
    await this.pool.query(
      `UPDATE system_management.jobs SET state='outcome_unknown',updated_at=now() WHERE state IN ('running','publishing','transferring','verifying','connecting','active')`,
    );
  }
  async reserve(
    job: Job,
    rootId: string,
    remaining: number,
    free: number,
    reserve: number,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "system-transfer:" + job.hostId + ":" + rootId,
      ]);
      const used = Number(
        (
          await client.query(
            "SELECT COALESCE(sum(remaining_bytes),0)::text AS bytes FROM system_management.reservations WHERE host_id=$1 AND root_id=$2 AND job_id<>$3 AND expires_at>now()",
            [job.hostId, rootId, job.id],
          )
        ).rows[0].bytes,
      );
      if (
        !Number.isSafeInteger(free) ||
        !Number.isSafeInteger(used) ||
        free - used - remaining < reserve
      )
        throw new Fault(
          507,
          "CAPACITY_EXCEEDED",
          "Destination capacity is already reserved by another transfer.",
        );
      await client.query(
        `INSERT INTO system_management.reservations(job_id,host_id,root_id,remaining_bytes,expires_at) VALUES($1,$2,$3,$4,now()+interval '24 hours') ON CONFLICT(job_id) DO UPDATE SET remaining_bytes=excluded.remaining_bytes,expires_at=excluded.expires_at`,
        [job.id, job.hostId, rootId, remaining],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async reservationProgress(id: string, remaining: number) {
    await this.pool.query(
      "UPDATE system_management.reservations SET remaining_bytes=$2,expires_at=now()+interval '24 hours' WHERE job_id=$1",
      [id, Math.max(0, remaining)],
    );
  }
}
