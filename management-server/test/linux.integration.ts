// Deliberately separate from ordinary tests. This provisions real OS identities,
// SSH, chroots and cgroups ONLY on a disposable GitHub-hosted Linux runner.
import "node:process";
import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { WebSocket } from "ws";
const exec = promisify(execFile),
  root = path.resolve(import.meta.dirname, "../..");
const required = process.env.SYSTEM_MANAGEMENT_LINUX_TEST_REQUIRED === "true";
const digest = (b: Buffer) =>
  crypto.createHash("sha256").update(b).digest("hex");
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  "real authority, restricted PostgreSQL roles, OpenSSH/chroot, managed files, PTY isolation and orphan watchdog",
  { skip: !required, timeout: 900000 },
  async (testContext) => {
    assert(
      process.platform === "linux" &&
        process.getuid?.() === 0 &&
        process.env.GITHUB_ACTIONS === "true" &&
        process.env.RUNNER_ENVIRONMENT === "github-hosted",
      "This destructive fixture is restricted to a disposable GitHub-hosted Linux runner.",
    );
    const base = "/etc/omnilodge-system",
      state = "/var/lib/omnilodge-system";
    await assert.rejects(
      fs.stat(base),
      "Fixture must not adopt an existing host configuration.",
    );
    const adminUrl = process.env.MANAGEMENT_TEST_ADMIN_URL;
    assert(adminUrl && new URL(adminUrl).hostname === "127.0.0.1");
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    const applicationDatabase = "omnilodge_system_ci",
      controlDatabase = "omnilodge_system_control_ci";
    const actor = 901,
      release =
        "/opt/omnilodge/releases/omnilodge-system-ci/be/dist/systemManagement";
    let app: pg.Client | undefined,
      control: pg.Client | undefined,
      closeAuthority: (() => Promise<void>) | undefined,
      database: any,
      authorityPool: any,
      brokerUnit = "";
    const childUnits: string[] = [];
    const module = async (name: string) =>
      import(pathToFileURL(path.join(root, "be/dist", name + ".js")).href);
    const run = async (
      command: string,
      args: string[],
      env: NodeJS.ProcessEnv = {},
    ) =>
      exec(command, args, {
        env: { ...process.env, ...env },
        maxBuffer: 1048576,
        timeout: 60000,
      });
    const urlFor = (
      database: string,
      username = "postgres",
      password = "system-ci-only",
    ) => {
      const url = new URL(adminUrl);
      url.pathname = "/" + database;
      url.username = username;
      url.password = password;
      return url.toString();
    };
    const importBackend = async () => {
      const require = createRequire(path.join(root, "be/package.json"));
      require("reflect-metadata");
      Object.assign(process.env, {
        DB_HOST: "127.0.0.1",
        DB_PORT: new URL(adminUrl).port || "5432",
        DB_NAME: applicationDatabase,
        DB_USER: "postgres",
        DB_PASSWORD: "system-ci-only",
        CONFIG_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
        OMNILODGE_WORKSPACE_WORKER: "true",
        NODE_ENV: "test",
      });
      database = (await module("config/database")).default;
      for (const name of ["ConfigKey", "ConfigValue", "ConfigHistory"])
        await (await module("models/" + name)).default.sync();
      const config = await module("services/configService");
      await config.syncConfigDefinitions();
      return config;
    };
    try {
      for (const name of [applicationDatabase, controlDatabase]) {
        assert.equal(
          (
            await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [
              name,
            ])
          ).rowCount,
          0,
        );
        await admin.query(`CREATE DATABASE ${name}`);
      }
      app = new pg.Client({ connectionString: urlFor(applicationDatabase) });
      control = new pg.Client({ connectionString: urlFor(controlDatabase) });
      await app.connect();
      await control.connect();
      const require = createRequire(path.join(root, "be/package.json")),
        password = await require("bcryptjs").hash("fixture-password", 4);
      await app.query(
        `CREATE TABLE "userTypes"(id integer PRIMARY KEY,slug text,status boolean);CREATE TABLE users(id integer PRIMARY KEY,"userTypeId" integer,"firstName" text,"lastName" text,password text,status boolean,approved boolean);CREATE TABLE user_type_product_types(user_type_id integer,product_type_id integer);CREATE TABLE pages(id integer,slug text,status boolean);CREATE TABLE modules(id integer,slug text,status boolean);CREATE TABLE actions(id serial PRIMARY KEY,key text,status boolean);CREATE TABLE "rolePagePermissions"("userTypeId" integer,"pageId" integer,status boolean,"canView" boolean);CREATE TABLE "roleModulePermissions"("userTypeId" integer,"moduleId" integer,"actionId" integer,allowed boolean,status boolean);CREATE TABLE "moduleActions"("moduleId" integer,"actionId" integer,enabled boolean);CREATE TABLE auth_sessions(id uuid PRIMARY KEY,actor_id integer,expires_at timestamptz,revoked_at timestamptz,password_fingerprint text);INSERT INTO "userTypes" VALUES(1,'admin',true),(2,'manager',true),(3,'admin',true);INSERT INTO user_type_product_types VALUES(3,1);INSERT INTO pages VALUES(1,'settings-system-management',true);INSERT INTO modules VALUES(1,'system-management',true);INSERT INTO "rolePagePermissions" SELECT id,1,true,true FROM "userTypes";`,
      );
      for (const [id, role] of [
        [901, 1],
        [902, 2],
        [903, 3],
        [904, 1],
      ])
        await app.query(
          "INSERT INTO users VALUES($1,$2,'Fixture','Administrator',$3,true,true)",
          [id, role, password],
        );
      const { SYSTEM_ACTIONS } = await module("config/systemManagementConfig");
      for (const action of SYSTEM_ACTIONS) {
        const id = (
          await app.query(
            "INSERT INTO actions(key,status) VALUES($1,true) RETURNING id",
            [action],
          )
        ).rows[0].id;
        await app.query('INSERT INTO "moduleActions" VALUES(1,$1,true)', [id]);
        for (const role of [1, 2, 3])
          await app.query(
            'INSERT INTO "roleModulePermissions" VALUES($1,1,$2,true,true)',
            [role, id],
          );
      }
      for (const kind of ["authority", "broker"])
        await control.query(
          `CREATE ROLE omnilodge_system_${kind} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'fixture-${kind}'`,
        );
      await control.query(
        await fs.readFile(
          path.join(root, "ops/system-management/control-schema.sql"),
          "utf8",
        ),
      );
      const restricted = new pg.Client({
        connectionString: urlFor(
          controlDatabase,
          "omnilodge_system_broker",
          "fixture-broker",
        ),
      });
      await restricted.connect();
      for (const sql of [
        "SELECT * FROM system_management.authority_sessions",
        "INSERT INTO system_management.launch_grants VALUES('forged',1,gen_random_uuid(),'forged',now(),null)",
        "DELETE FROM system_management.audit_events",
        "CREATE TABLE public.broker_escalation(id int)",
      ])
        await assert.rejects(restricted.query(sql));
      await restricted.end();
      await fs.mkdir(release, { recursive: true });
      await fs.copyFile(
        path.join(root, "ops/system-management/bootstrap-host.sh"),
        path.join(release, "bootstrap-host.sh"),
      );
      await fs.copyFile(
        path.join(root, "ops/system-management/bin/adapter"),
        path.join(release, "adapter"),
      );
      await fs.copyFile(
        path.join(root, "management-server/dist/server.mjs"),
        path.join(release, "server.mjs"),
      );
      const fixtureUi =
        "/opt/omnilodge/releases/omnilodge-system-ci/ui/build/system-management";
      await fs.mkdir(fixtureUi, { recursive: true, mode: 0o755 });
      await fs.cp(path.join(root, "management-ui/dist"), fixtureUi, {
        recursive: true,
      });
      const pgEnv = {
        PGHOST: "127.0.0.1",
        PGPORT: new URL(adminUrl).port || "5432",
        PGUSER: "postgres",
        PGPASSWORD: "system-ci-only",
      };
      await run(
        "/bin/bash",
        [path.join(release, "bootstrap-host.sh"), applicationDatabase],
        pgEnv,
      );
      await assert.rejects(fs.stat(base)); // default plan did not mutate the host
      await run(
        "/bin/bash",
        [
          path.join(release, "bootstrap-host.sh"),
          "--apply",
          applicationDatabase,
        ],
        pgEnv,
      );
      await run(
        "/bin/bash",
        [
          path.join(release, "bootstrap-host.sh"),
          "--apply",
          applicationDatabase,
        ],
        pgEnv,
      ); // idempotent boundary installation
      for (const id of [901, 904]) {
        const uid = Number(
          (
            await run("/usr/bin/id", ["-u", "omnilodge-sftp-" + id])
          ).stdout.trim(),
        );
        const gid = Number(
          (
            await run("/usr/bin/id", ["-g", "omnilodge-sftp-" + id])
          ).stdout.trim(),
        );
        assert.equal(
          (await fs.stat("/srv/omnilodge-staging/u" + id)).uid,
          uid,
          "Repeated setup must preserve staging ownership through the bind mount.",
        );
        assert.equal(
          (await fs.stat("/srv/omnilodge-operations/u" + id)).gid,
          gid,
          "Repeated setup must preserve approved-root read access.",
        );
      }
      const group = Number(
        (await run("/usr/bin/getent", ["group", "omnilodge-system"])).stdout
          .trim()
          .split(":")[2],
      );
      const signing = crypto.generateKeyPairSync("ed25519"),
        publicKey = Buffer.from(
          signing.publicKey.export({ format: "der", type: "spki" }),
        )
          .subarray(-32)
          .toString("base64");
      await fs.writeFile(
        path.join(base, "authority-signing.pem"),
        signing.privateKey.export({ format: "pem", type: "pkcs8" }),
        { mode: 0o600 },
      );
      const shared = async (name: string, bytes: string) => {
        const file = path.join(base, name);
        await fs.writeFile(file, bytes, { mode: 0o640 });
        await fs.chown(file, 0, group);
        return file;
      };
      const rpc = await shared(
          "rpc-secret",
          crypto.randomBytes(32).toString("hex"),
        ),
        artifact = await shared(
          "artifact-key",
          crypto.randomBytes(32).toString("base64"),
        );
      const identities: Record<string, unknown> = {},
        credentials: Record<string, unknown> = {},
        actors: Record<string, unknown> = {};
      const key = async (id: string, user: string) => {
        const file = path.join(base, ".fixture-key-" + id);
        await run("/usr/bin/ssh-keygen", [
          "-q",
          "-t",
          "ed25519",
          "-N",
          "",
          "-f",
          file,
        ]);
        const privateKey = await fs.readFile(file, "utf8");
        await fs.copyFile(file + ".pub", "/etc/ssh/authorized_keys/" + user);
        await fs.chmod("/etc/ssh/authorized_keys/" + user, 0o644);
        return { privateKey, revision: crypto.randomUUID() };
      };
      credentials.gateway = await key("gateway", "omnilodge-sys-gw");
      for (const id of [901, 904]) {
        const user = "omnilodge-sftp-" + id,
          gid = Number((await run("/usr/bin/id", ["-g", user])).stdout.trim());
        credentials["files-" + id] = await key("files-" + id, user);
        identities[id] = {
          username: "omnilodge-sys-gw",
          credentialId: "gateway",
          fileUsername: user,
          fileCredentialId: "files-" + id,
        };
        actors[id] = {
          username: "omnilodge-op-" + id,
          workingDirectory: "/srv/omnilodge-shell/u" + id,
          roots: {
            work: {
              path: "/srv/omnilodge-operations/u" + id,
              staging: "/srv/omnilodge-staging/u" + id,
              writable: true,
              gid,
            },
          },
          services: [],
        };
      }
      await fs.writeFile(
        path.join(base, "adapter.json"),
        JSON.stringify({
          version: 1,
          hostId: "fixture",
          publicKey,
          actors,
          services: {},
          memoryMiB: 256,
          cpuPercent: 25,
          tasks: 64,
          reserveBytes: 1073741824,
        }),
        { mode: 0o600 },
      );
      const fingerprint = (
        await run("/usr/bin/ssh-keygen", [
          "-lf",
          "/etc/ssh/ssh_host_ed25519_key.pub",
          "-E",
          "sha256",
        ])
      ).stdout
        .trim()
        .split(/\s+/)[1];
      const config = await importBackend();
      for (const [key, value] of Object.entries({
        SYSTEM_MANAGEMENT_ENABLED: true,
        SYSTEM_MANAGEMENT_HOSTS: [
          {
            id: "fixture",
            name: "CI managed host",
            environment: "development",
            hostname: "127.0.0.1",
            port: 22,
            addresses: ["127.0.0.1"],
            fingerprints: [fingerprint],
            enabled: true,
            managed: true,
            identities,
            roots: [
              {
                id: "work",
                name: "Work",
                path: "/work",
                writable: true,
                managed: true,
              },
            ],
            services: [],
          },
        ],
        SYSTEM_MANAGEMENT_CREDENTIALS: credentials,
        SYSTEM_MANAGEMENT_HOST_GRANTS: [
          { actorId: 901, hostId: "fixture", actions: SYSTEM_ACTIONS },
        ],
      }))
        await config.updateConfigValue({
          key,
          value,
          actorId: 901,
          reason: "Disposable Linux integration fixture",
        });
      Object.assign(process.env, {
        SYSTEM_MANAGEMENT_AUTHORITY_URL: urlFor(
          controlDatabase,
          "omnilodge_system_authority",
          "fixture-authority",
        ),
        SYSTEM_MANAGEMENT_AUTHORITY_SOCKET:
          "/run/omnilodge-system/authority.sock",
        SYSTEM_MANAGEMENT_RPC_SECRET_FILE: rpc,
        SYSTEM_MANAGEMENT_SIGNING_KEY_FILE: path.join(
          base,
          "authority-signing.pem",
        ),
      });
      const authority = await module("services/systemManagement/authority"),
        logins = await module("services/systemManagement/loginSessions");
      authorityPool = authority.authorityPool();
      closeAuthority = await authority.startSystemManagementAuthority();
      for (const id of [902, 903])
        await assert.rejects(authority.actorAuthority(id));
      const parent = await logins.createLoginSession(901),
        launch = await authority.createLaunch(901, parent),
        token = (
          await authority.authorityRpc("redeem", {
            grant: launch.grant,
            origin: "https://system.omni-lodge.com",
          })
        ).token;
      await assert.rejects(
        authority.authorityRpc("redeem", {
          grant: launch.grant,
          origin: "https://system.omni-lodge.com",
        }),
      );
      await assert.rejects(
        authority.authorityRpc("step-up", {
          session: token,
          password: "incorrect",
        }),
      );
      await authority.authorityRpc("step-up", {
        session: token,
        password: "fixture-password",
      });
      const otherParent = await logins.createLoginSession(904),
        otherGrant = await authority.createLaunch(904, otherParent),
        other = (
          await authority.authorityRpc("redeem", {
            grant: otherGrant.grant,
            origin: "https://system.omni-lodge.com",
          })
        ).token;
      await authority.authorityRpc("step-up", {
        session: other,
        password: "fixture-password",
      });
      await assert.rejects(
        authority.authorityRpc("connection", {
          session: other,
          hostId: "fixture",
          kind: "terminal",
          action: "connectTerminal",
        }),
      );
      const envFile = await shared(
        "fixture-broker.env",
        `NODE_ENV=production\nSYSTEM_MANAGEMENT_CONTROL_URL=${urlFor(controlDatabase, "omnilodge_system_broker", "fixture-broker")}\nSYSTEM_MANAGEMENT_AUTHORITY_SOCKET=/run/omnilodge-system/authority.sock\nSYSTEM_MANAGEMENT_RPC_SECRET_FILE=${rpc}\nSYSTEM_MANAGEMENT_ARTIFACT_KEY_FILE=${artifact}\nSYSTEM_MANAGEMENT_PUBLIC_ORIGIN=https://system.omni-lodge.com\nSYSTEM_MANAGEMENT_UI_PATH=/opt/omnilodge/releases/omnilodge-system-ci/ui/build/system-management\nAPP_VERSION=system-ci\n`,
      );
      const startBroker = async () => {
        brokerUnit =
          "omnilodge-system-fixture-" + crypto.randomBytes(4).toString("hex");
        childUnits.push(brokerUnit);
        await run("/usr/bin/systemd-run", [
          "--quiet",
          "--collect",
          "--unit=" + brokerUnit,
          "--uid=omnilodge-system",
          "--gid=omnilodge-system",
          "--property=MemoryMax=268435456",
          "--property=CPUQuota=25%",
          "--property=TasksMax=64",
          "--property=EnvironmentFile=" + envFile,
          process.execPath,
          path.join(release, "server.mjs"),
        ]);
        for (let i = 0; i < 50; i++) {
          try {
            const r = await fetch(
              "http://127.0.0.1:3011/management/health/ready",
            );
            if (r.ok) return;
          } catch {}
          await delay(200);
        }
        const diagnostics = await run("/usr/bin/journalctl", [
          "--no-pager",
          "--unit=" + brokerUnit,
          "--lines=30",
        ]);
        throw new Error(
          "Fixture broker failed readiness: " +
            diagnostics.stdout.replace(
              /(postgresql:\/\/)[^\s]+/g,
              "[redacted database URL]",
            ),
        );
      };
      await startBroker();
      const cookie = "__Host-omnilodge-management=" + token;
      let csrf = "";
      const request = async (
        route: string,
        body?: any,
        extra: Record<string, string> = {},
        method?: string,
      ) => {
        const value = await new Promise<any>((resolve, reject) => {
          const payload =
            body === undefined
              ? undefined
              : Buffer.isBuffer(body)
                ? body
                : Buffer.from(JSON.stringify(body));
          const req = http.request(
            {
              hostname: "127.0.0.1",
              port: 3011,
              path: "/management" + route,
              method: method || (body === undefined ? "GET" : "POST"),
              headers: {
                Host: "system.omni-lodge.com",
                Origin: "https://system.omni-lodge.com",
                Cookie: cookie,
                "X-Management-CSRF": csrf,
                "Content-Type": Buffer.isBuffer(body)
                  ? "application/octet-stream"
                  : "application/json",
                ...(payload ? { "Content-Length": payload.length } : {}),
                ...extra,
              },
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (c) => chunks.push(c));
              res.on("error", reject);
              res.on("end", () => {
                try {
                  const data = JSON.parse(Buffer.concat(chunks).toString());
                  if ((res.statusCode || 500) >= 400)
                    reject(
                      Object.assign(
                        new Error(
                          route +
                            ": " +
                            (data.message || "Fixture request rejected"),
                        ),
                        { code: data.code, status: res.statusCode },
                      ),
                    );
                  else resolve(data);
                } catch (e) {
                  reject(e);
                }
              });
            },
          );
          req.on("error", reject);
          req.setTimeout(30000, () =>
            req.destroy(new Error("Fixture request timed out")),
          );
          req.end(payload);
        });
        return value;
      };
      csrf = (await request("/session")).csrf;
      await assert.rejects(
        request("/session/touch", {}, { Origin: "https://untrusted.example" }),
        { code: "ORIGIN_REJECTED" },
      );
      await assert.rejects(
        request("/session/touch", {}, { "X-Management-CSRF": "forged" }),
        { code: "CSRF_REJECTED" },
      );
      await assert.rejects(
        request("/session", undefined, { Host: "omni-lodge.com" }),
        { code: "HOST_REJECTED" },
      );
      await assert.rejects(request("/session/touch", undefined, {}, "GET"), {
        code: "METHOD_NOT_ALLOWED",
      });
      await assert.rejects(request("/../assets/private.js.map"), {
        code: "NOT_FOUND",
      });
      for (const invalidPath of [
        "../outside",
        "/etc/passwd",
        "folder/../../outside",
        ".omnilodge-private/hidden",
      ])
        await assert.rejects(
          request(
            "/files/list?hostId=fixture&rootId=work&path=" +
              encodeURIComponent(invalidPath),
          ),
          { code: "INVALID_PATH" },
        );
      await assert.rejects(
        request("/files/list?hostId=fixture&rootId=not-enrolled&path=."),
        { code: "PROTECTED_PATH" },
      );
      await assert.rejects(
        request("/services/restart", {
          hostId: "fixture",
          serviceId: "arbitrary-service",
          confirm: "arbitrary-service",
          reason: "Fixture negative test",
        }),
      );
      const source = crypto.randomBytes(9000),
        upload = await request("/transfers", {
          hostId: "fixture",
          rootId: "work",
          path: "fixture.txt",
          size: source.length,
          sha256: digest(source),
          idempotencyKey: crypto.randomUUID(),
        });
      await request(
        "/transfers/" + upload.id + "/chunks",
        source,
        { "X-Upload-Offset": "0", "X-Chunk-SHA256": digest(source) },
        "PUT",
      );
      await assert.rejects(
        request(
          "/transfers/" + upload.id + "/chunks",
          source,
          { "X-Upload-Offset": "0", "X-Chunk-SHA256": digest(source) },
          "PUT",
        ),
      );
      await run("/usr/bin/systemctl", ["stop", brokerUnit]);
      await startBroker();
      await request("/transfers/" + upload.id + "/resume", {
        sha256: digest(source),
      });
      assert.equal(
        (await request("/transfers/" + upload.id + "/publish", {})).state,
        "completed",
      );
      assert.equal(
        digest(await fs.readFile("/srv/omnilodge-operations/u901/fixture.txt")),
        digest(source),
      );
      // A sparse fixture avoids consuming the runner disk while exercising ten
      // GiB through real OpenSSH, the immutable broker and bounded HTTP streams.
      const largePath = "/srv/omnilodge-operations/u901/large-stream.bin",
        largeBytes = 10 * 1024 ** 3;
      const largeFile = await fs.open(largePath, "wx", 0o640);
      await largeFile.truncate(largeBytes);
      await largeFile.close();
      await fs.chown(
        largePath,
        0,
        Number(
          (
            await run("/usr/bin/id", ["-g", "omnilodge-sftp-901"])
          ).stdout.trim(),
        ),
      );
      const listing = await request(
        "/files/list?hostId=fixture&rootId=work&path=.",
      );
      assert.equal(listing.complete, true);
      assert(
        listing.entries.some((v: any) => v.name === "large-stream.bin"),
        "Real directory enumeration must handle OpenSSH EOF and include the source.",
      );
      const baseline: number[] = [];
      for (let i = 0; i < 5; i++) {
        const started = Date.now();
        await request("/session/touch", {});
        baseline.push(Date.now() - started);
      }
      const download = await request("/downloads", {
          hostId: "fixture",
          rootId: "work",
          path: "large-stream.bin",
        }),
        started = Date.now();
      const probes: number[] = [],
        activeProbes = new Set<Promise<void>>();
      let probeFailures = 0;
      const activity = setInterval(() => {
        const started = Date.now();
        const probe = request("/session/touch", {})
          .then(() => probes.push(Date.now() - started))
          .catch(() => {
            probeFailures++;
          })
          .then(() => {});
        activeProbes.add(probe);
        void probe.finally(() => activeProbes.delete(probe));
      }, 30000);
      let received: number, expiredConfirmation: Promise<unknown> | undefined;
      try {
        received = await new Promise<number>((resolve, reject) => {
          const req = http.get(
            {
              hostname: "127.0.0.1",
              port: 3011,
              signal: testContext.signal,
              path: "/management/download?id=" + download.id,
              headers: { Host: "system.omni-lodge.com", Cookie: cookie },
            },
            (res) => {
              if (res.statusCode !== 200) {
                res.resume();
                reject(new Error("Large stream returned " + res.statusCode));
                return;
              }
              let count = 0,
                nextProgress = 1024 ** 3;
              res.on("data", (part) => {
                // A read already admitted must survive password-confirmation
                // expiry, while its continuing general authorization stays live.
                expiredConfirmation ||= control!.query(
                  "UPDATE system_management.authority_sessions SET step_up_until=now()-interval '1 second' WHERE actor_id=901",
                );
                count += part.length;
                if (count >= nextProgress) {
                  console.log(
                    JSON.stringify({
                      streamedBytes: count,
                      elapsedMs: Date.now() - started,
                    }),
                  );
                  nextProgress += 1024 ** 3;
                }
              });
              res.on("error", reject);
              res.on("end", () => resolve(count));
            },
          );
          req.on("error", reject);
          req.setTimeout(30000, () =>
            req.destroy(new Error("Large stream stalled")),
          );
        });
      } finally {
        clearInterval(activity);
      }
      await Promise.all(activeProbes);
      await expiredConfirmation;
      assert.equal(
        probeFailures,
        0,
        "Concurrent session health probes must remain successful.",
      );
      assert.equal(received, largeBytes);
      const resourceSample = (
        await run("/usr/bin/systemctl", [
          "show",
          brokerUnit,
          "--property=MemoryPeak,MemoryCurrent",
        ])
      ).stdout;
      const peak = Number(/MemoryPeak=([0-9]+)/.exec(resourceSample)?.[1]);
      assert(
        peak > 0 && peak <= 268435456,
        "Ten GiB transfer must stay inside the enforced broker memory budget.",
      );
      console.log(
        JSON.stringify({
          largeStreamBytes: received,
          milliseconds: Date.now() - started,
          brokerPeakBytes: peak,
          baselineMilliseconds: baseline,
          concurrentProbeMilliseconds: probes,
        }),
      );
      await fs.unlink(largePath);
      await assert.rejects(
        request("/file-operations/review", {
          hostId: "fixture",
          rootId: "work",
          path: "fixture.txt",
          operation: "trash",
        }),
        { code: "STEP_UP_REQUIRED" },
      );
      await request("/session/step-up", { password: "fixture-password" }); // New mutations require a fresh confirmation after a long accepted read.
      const review = await request("/file-operations/review", {
        hostId: "fixture",
        rootId: "work",
        path: "fixture.txt",
        operation: "trash",
        reason: "Fixture recovery check",
      });
      await request("/file-operations/execute", { id: review.id });
      const trash = (await request("/trash?hostId=fixture&rootId=work"))
        .entries;
      assert.equal(trash.length, 1);
      const restore = await request("/file-operations/review", {
        hostId: "fixture",
        rootId: "work",
        path: "fixture.txt",
        operation: "restore",
        trashId: trash[0].trashId,
      });
      await request("/file-operations/execute", { id: restore.id });
      assert.equal(
        digest(await fs.readFile("/srv/omnilodge-operations/u901/fixture.txt")),
        digest(source),
      );
      await fs.symlink("/etc", "/srv/omnilodge-operations/u901/escape");
      await assert.rejects(
        request("/files/list?hostId=fixture&rootId=work&path=escape"),
      );
      await fs.unlink("/srv/omnilodge-operations/u901/escape");
      const terminal = await request("/terminals", {
          hostId: "fixture",
          cols: 80,
          rows: 24,
        }),
        ticket = await request(
          "/terminals/" + terminal.id + "/attach-ticket",
          {},
        );
      const socket = new WebSocket("ws://127.0.0.1:3011/management/stream", {
        headers: {
          Host: "system.omni-lodge.com",
          Origin: "https://system.omni-lodge.com",
          Cookie: cookie,
        },
      });
      let output = "";
      let sequence = 0;
      let attached = false;
      socket.on("message", (bytes) => {
        const frame = JSON.parse(bytes.toString());
        if (frame.type === "attached") attached = true;
        if (frame.type === "output") {
          output += Buffer.from(frame.data, "base64").toString();
          socket.send(
            JSON.stringify({ type: "renderAck", sequence: frame.sequence }),
          );
        }
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("open", () => {
          socket.send(JSON.stringify({ ticket: ticket.ticket, fresh: true }));
          resolve();
        });
        socket.once("error", reject);
      });
      for (let i = 0; i < 50 && !attached; i++) await delay(100);
      assert(attached, "WebSocket must redeem its attachment before input.");
      socket.send(
        JSON.stringify({
          type: "input",
          data: "printf 'FIXTURE_UID='; id -u; printf 'FIXTURE_READY\\n'\r",
          sequence: ++sequence,
        }),
      );
      for (
        let i = 0;
        i < 100 && !/FIXTURE_UID=[1-9][0-9]*[\r\n]/.test(output);
        i++
      )
        await delay(100);
      assert(
        /FIXTURE_UID=[1-9][0-9]*[\r\n]/.test(output),
        "PTY must execute as the enrolled nonroot identity.",
      );
      const unit = "omnilodge-console-" + terminal.id + ".service",
        limits = JSON.parse(
          JSON.stringify(
            (
              await run("/usr/bin/systemctl", [
                "show",
                unit,
                "--property=MemoryMax,CPUQuotaPerSecUSec,TasksMax,ControlGroup",
              ])
            ).stdout,
          ),
        );
      assert(/MemoryMax=268435456/.test(limits) && /TasksMax=64/.test(limits));
      await logins.revokeLoginSession(parent);
      await assert.rejects(request("/files/list?hostId=fixture&rootId=work"));
      socket.close();
      await run("/usr/bin/systemctl", ["kill", "--signal=SIGKILL", brokerUnit]);
      await delay(65000);
      await run("/usr/local/libexec/omnilodge/system-adapter", ["watchdog"]);
      await assert.rejects(
        run("/usr/bin/systemctl", ["is-active", "--quiet", unit]),
      );
      assert.equal(
        (
          await control.query(
            "SELECT count(*)::int AS n FROM system_management.audit_events WHERE actor_id=901",
          )
        ).rows[0].n > 0,
        true,
      );
    } catch (error) {
      const diagnostics = await run("/usr/bin/journalctl", [
        "--no-pager",
        "--unit=ssh",
        "--lines=35",
      ]).catch(() => ({ stdout: "SSH diagnostics unavailable" }));
      console.error(
        diagnostics.stdout.replace(
          /(postgresql:\/\/)[^\s]+/g,
          "[redacted database URL]",
        ),
      );
      if (brokerUnit) {
        const journal = await run("/usr/bin/journalctl", [
          "--no-pager",
          "--unit=" + brokerUnit,
          "--lines=40",
        ]).catch(() => ({ stdout: "Broker diagnostic unavailable" }));
        console.error(
          journal.stdout.replace(
            /(postgresql:\/\/)[^\s]+/g,
            "[redacted database URL]",
          ),
        );
      }
      throw error;
    } finally {
      for (const unit of childUnits)
        await run("/usr/bin/systemctl", ["stop", unit]).catch(() => {});
      await closeAuthority?.().catch(() => {});
      await authorityPool?.end();
      await database?.close();
      await app?.end();
      await control?.end();
      // This is a disposable runner; host namespaces remain available for CI failure
      // inspection. Database names/roles were created and checked exclusively above.
      await admin.end();
    }
  },
);
