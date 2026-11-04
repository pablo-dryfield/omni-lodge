import pg from "pg";
import crypto from "node:crypto";
import { Fault } from "./types.js";
export type Job = {
  id: string;
  actorId: number;
  hostId: string;
  kind: string;
  state: string;
  data: Record<string, unknown>;
  updatedAt?: string;
};
export class Store {
  readonly pool: pg.Pool;
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
    const version=await this.pool.query("SELECT version,checksum FROM system_management.schema_versions ORDER BY version DESC LIMIT 1");
    if(version.rows[0]?.version!==1 || version.rows[0]?.checksum!=='system-management-v1')throw new Error('Management control schema is incompatible.');
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
    const result = await this.pool.query(
      `INSERT INTO system_management.jobs(id,actor_id,host_id,kind,state,payload,idempotency_key,intent_hash) VALUES($1,$2,$3,$4,'queued',$5,$6,$7) ON CONFLICT(actor_id,idempotency_key) DO NOTHING RETURNING id`,
      [id, actorId, hostId, kind, this.seal(data), idempotency || id, intent],
    );
    if (!result.rowCount) {
      const old = await this.pool.query(
        "SELECT * FROM system_management.jobs WHERE actor_id=$1 AND idempotency_key=$2",
        [actorId, idempotency],
      );
      if (
        old.rows[0].intent_hash !== intent ||
        old.rows[0].host_id !== hostId ||
        old.rows[0].kind !== kind
      )
        throw new Fault(
          409,
          "IDEMPOTENCY_CONFLICT",
          "This idempotency key belongs to a different operation.",
        );
      return this.decode(old.rows[0]);
    }
    await this.event(actorId, hostId, kind, "accepted", id);
    return { id, actorId, hostId, kind, state: "queued", data };
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
  async update(job: Job, state: string, patch: Record<string, unknown> = {}) {
    job.state = state;
    Object.assign(job.data, patch);
    await this.pool.query(
      "UPDATE system_management.jobs SET state=$2,payload=$3,updated_at=now() WHERE id=$1 AND actor_id=$4",
      [job.id, state, this.seal(job.data), job.actorId],
    );
    return job;
  }
  async list(actorId: number, kind?: string) {
    const r = await this.pool.query(
      "SELECT * FROM system_management.jobs WHERE actor_id=$1 AND ($2::text IS NULL OR kind=$2) ORDER BY created_at DESC LIMIT 100",
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
