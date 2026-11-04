import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import pg from "pg";
import { Store } from "../src/store.js";

const source = process.env.MANAGEMENT_TEST_ADMIN_URL;
test(
  "PostgreSQL journal roles, atomic intents, idempotency, public summaries, reservations and hard quotas",
  { skip: !source, timeout: 60000 },
  async () => {
    assert(
      source &&
        ["127.0.0.1", "localhost", "::1"].includes(new URL(source).hostname),
      "Only an explicitly configured local/disposable test cluster is permitted.",
    );
    const admin = new pg.Client({ connectionString: source });
    await admin.connect();
    const suffix = crypto.randomBytes(6).toString("hex"),
      database = "omnilodge_system_test_" + suffix,
      broker = "system_test_b_" + suffix,
      authority = "system_test_a_" + suffix,
      password = crypto.randomBytes(24).toString("hex");
    let owner: pg.Client | undefined, store: Store | undefined;
    const url = (role: string) => {
      const result = new URL(source);
      result.pathname = "/" + database;
      result.username = role;
      result.password = password;
      return result.toString();
    };
    try {
      await admin.query(`CREATE DATABASE ${database}`);
      for (const role of [broker, authority])
        await admin.query(
          `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
        );
      const ownerUrl = new URL(source);
      ownerUrl.pathname = "/" + database;
      owner = new pg.Client({ connectionString: ownerUrl.toString() });
      await owner.connect();
      const schema = (
        await fs.readFile(
          new URL(
            "../../ops/system-management/control-schema.sql",
            import.meta.url,
          ),
          "utf8",
        )
      )
        .replaceAll("omnilodge_system_broker", broker)
        .replaceAll("omnilodge_system_authority", authority);
      await owner.query(schema);
      store = new Store(url(broker), crypto.randomBytes(32));
      await store.ready();
      const intent = {
          path: "report.txt",
          text: "private editor draft",
          size: 16,
        },
        first = await store.create(
          901,
          "fixture",
          "file-operation",
          intent,
          "same-intent",
        );
      const parallel = await Promise.all(
        Array.from({ length: 8 }, () =>
          store!.create(
            901,
            "fixture",
            "file-operation",
            intent,
            "same-intent",
          ),
        ),
      );
      assert(parallel.every((job) => job.id === first.id));
      await assert.rejects(
        store.create(
          901,
          "fixture",
          "file-operation",
          { ...intent, text: "different" },
          "same-intent",
        ),
      );
      await store.update(first, "reviewed", { phase: "review" });
      const summaries = await store.list(901);
      assert.equal(summaries[0].data.text, undefined);
      assert.equal(summaries[0].data.path, "report.txt");
      assert.equal((await store.get(first.id, 901)).data.text, intent.text);
      await assert.rejects(store.get(first.id, 902));
      for (const statement of [
        "SELECT * FROM system_management.authority_sessions",
        "INSERT INTO system_management.launch_grants VALUES('forged',901,gen_random_uuid(),'forged',now(),null)",
        "DELETE FROM system_management.audit_events",
        "UPDATE system_management.journal_usage SET bytes=0",
        "CREATE TABLE system_management.escalated(id int)",
      ])
        await assert.rejects(store.pool.query(statement));
      const existing = Number(
        (await owner.query("SELECT count(*) AS n FROM system_management.jobs"))
          .rows[0].n,
      );
      await owner.query(
        `REVOKE INSERT ON system_management.audit_events FROM ${broker}`,
      );
      await assert.rejects(
        store.create(
          901,
          "fixture",
          "upload",
          { path: "rollback.txt" },
          "must-rollback",
        ),
      );
      assert.equal(
        Number(
          (
            await owner.query(
              "SELECT count(*) AS n FROM system_management.jobs",
            )
          ).rows[0].n,
        ),
        existing,
      );
      await owner.query(
        `GRANT INSERT ON system_management.audit_events TO ${broker}`,
      );
      await owner.query(
        `REVOKE UPDATE ON system_management.jobs FROM ${broker}`,
      );
      await assert.rejects(store.update(first, "completed"));
      assert.equal(first.state, "reviewed");
      await owner.query(`GRANT UPDATE ON system_management.jobs TO ${broker}`);
      const second = await store.create(902, "fixture", "upload", {
        path: "other.txt",
      });
      const claims = await Promise.allSettled([
        store.claim({ ...second }, ["queued"], "streaming"),
        store.claim({ ...second }, ["queued"], "streaming"),
      ]);
      assert.equal(
        claims.filter((r) => r.status === "fulfilled").length,
        1,
        "Only one HTTP stream can claim a download operation.",
      );
      assert.equal(claims.filter((r) => r.status === "rejected").length, 1);
      await store.reserve(first, "work", 80, 100, 10);
      await assert.rejects(store.reserve(second, "work", 20, 100, 10));
      await store.reservationProgress(first.id, 0);
      await store.reserve(second, "work", 20, 100, 10);
      await owner.query(
        "UPDATE system_management.journal_usage SET jobs=5000 WHERE singleton",
      );
      await assert.rejects(
        store.pool.query(
          "INSERT INTO system_management.jobs(id,actor_id,host_id,kind,state,payload,public_payload,idempotency_key,intent_hash) VALUES($1,901,'fixture','upload','queued','ciphertext','ciphertext',$2,'digest')",
          [crypto.randomUUID(), crypto.randomUUID()],
        ),
      );
      await owner.query(
        "UPDATE system_management.journal_usage SET jobs=(SELECT count(*) FROM system_management.jobs) WHERE singleton",
      );
      const auth = new pg.Client({ connectionString: url(authority) });
      await auth.connect();
      try {
        await assert.rejects(
          auth.query(
            "INSERT INTO system_management.jobs(id,actor_id,host_id,kind,state,payload,public_payload,idempotency_key,intent_hash) VALUES(gen_random_uuid(),901,'fixture','upload','queued','forged','forged','forged','forged')",
          ),
        );
        await assert.rejects(
          auth.query("UPDATE system_management.jobs SET state='completed'"),
        );
      } finally {
        await auth.end();
      }
      const usage = (
        await owner.query(
          "SELECT jobs,events,bytes FROM system_management.journal_usage",
        )
      ).rows[0];
      assert.equal(Number(usage.jobs), 2);
      assert.equal(Number(usage.events), 2);
      assert(Number(usage.bytes) > 0);
    } finally {
      await store?.pool.end();
      await owner?.end();
      await admin.query(`DROP DATABASE IF EXISTS ${database}`);
      for (const role of [broker, authority])
        await admin.query(`DROP ROLE IF EXISTS ${role}`);
      await admin.end();
    }
  },
);
