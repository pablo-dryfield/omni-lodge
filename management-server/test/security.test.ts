import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import ssh2 from "ssh2";
const { Server, utils } = ssh2;
import { safeRelative, remotePath } from "../src/files.js";
import { connect, resolveTarget, shell } from "../src/ssh.js";
import { Store, publicJobData } from "../src/store.js";
import { Fault, type Connection } from "../src/types.js";

test("file tokens reject absolute paths, traversal, NUL and Windows separators", () => {
  for (const value of [
    "/etc/passwd",
    "../outside",
    "a/../../outside",
    "a\0b",
    "a\\b",
    null,
    {},
  ])
    assert.throws(() => safeRelative(value), Fault);
  assert.equal(safeRelative("reports/ąę.txt"), "reports/ąę.txt");
  assert.equal(safeRelative(""), ".");
  const root = {
    id: "work",
    name: "Work",
    path: "/work",
    writable: true,
    managed: true,
  };
  assert.equal(remotePath(root, "a b.txt"), "/work/a b.txt");
  assert.throws(() => remotePath(root, "../secrets"));
});
test("journal payload encryption authenticates ciphertext and keys", async () => {
  const store = new Store(
    "postgres://unused:unused@127.0.0.1:1/control",
    crypto.randomBytes(32),
  );
  const value = { path: "/private/name", text: "confidential" },
    encoded = store.seal(value);
  assert(!encoded.includes("confidential"));
  assert.deepEqual(store.open(encoded), value);
  const bytes = Buffer.from(encoded, "base64");
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => store.open(bytes.toString("base64")));
  await store.pool.end();
});
test("connection is pinned to the enrolled IP and key; real PTY carries bidirectional bytes", async () => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }),
    key = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const parsed = utils.parseKey(key);
  assert(!(parsed instanceof Error));
  const fingerprint = `SHA256:${crypto.createHash("sha256").update(parsed.getPublicSSH()).digest("base64").replace(/=+$/, "")}`;
  const server = new Server({ hostKeys: [key] }, (client) => {
    client.on("error", () => {
      /* Intentional host-key rejection disconnects during key exchange. */
    });
    client.on("authentication", (ctx) =>
      ctx.method === "password" &&
      ctx.username === "operator" &&
      ctx.password === "fixture"
        ? ctx.accept()
        : ctx.reject(),
    );
    client.on("ready", () =>
      client.on("session", (accept) => {
        const session = accept();
        session.on("exec", (accept, _reject, info) => {
          const stream = accept();
          if (info.command === "id -u") {
            stream.write("1001\n");
            stream.exit(0);
          } else stream.exit(1);
          stream.end();
        });
        session.on("pty", (accept) => accept?.());
        session.on("shell", (accept) => {
          const stream = accept();
          stream.write("ready ✓\r\n");
          stream.on("data", (data) => {
            stream.write(data);
            if (data.toString().includes("exit")) {
              stream.exit(0);
              stream.end();
            }
          });
        });
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const connection: Connection = {
    actorId: 1,
    policyHash: "fixture",
    username: "operator",
    credential: { password: "fixture" },
    host: {
      id: "fixture",
      name: "Fixture",
      environment: "development",
      username: "operator",
      hostname: "127.0.0.1",
      port: address.port,
      addresses: ["127.0.0.1"],
      fingerprints: [fingerprint],
      managed: false,
      roots: [],
      services: [],
    },
  };
  try {
    await assert.rejects(
      resolveTarget({
        ...connection,
        host: { ...connection.host, addresses: ["192.0.2.1"] },
      }),
      /outside/,
    );
    await assert.rejects(
      connect({
        ...connection,
        host: { ...connection.host, fingerprints: ["SHA256:wrong"] },
      }),
      /host key/,
    );
    const client = await connect(connection),
      channel = await shell(client, 80, 24);
    const output = await new Promise<string>((resolve, reject) => {
      let data = "";
      channel.on("data", (chunk) => {
        data += chunk.toString();
        if (data.includes("exit")) resolve(data);
      });
      channel.on("error", reject);
      channel.write("exit\r");
    });
    assert(output.includes("exit"));
    client.end();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("history summaries never contain editor drafts, credentials or arbitrary nested values", () => {
  const data = {
    path: "work/report.txt",
    offset: 0,
    size: 22,
    text: "private draft",
    privateKey: "private-key",
    password: "credential",
    stopCapability: "stop-secret",
    result: { text: "another private draft" },
    phase: "staging",
  };
  assert.deepEqual(publicJobData(data), {
    path: "work/report.txt",
    offset: 0,
    size: 22,
    phase: "staging",
  });
});
