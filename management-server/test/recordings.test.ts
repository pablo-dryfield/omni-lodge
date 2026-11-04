import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Recordings, RecordingBuffer } from "../src/recordings.js";
import type { Store } from "../src/store.js";

test("recordings decrypt only durable authenticated frames and never store plaintext", async () => {
  const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "omnilodge-recording-"),
    ),
    id = crypto.randomUUID(),
    filename = path.join(directory, id + ".recording"),
    key = crypto.randomBytes(32);
  const row: any = {
    id,
    actor_id: 1,
    host_id: "fixture",
    path: id + ".recording",
    kind: "recording-active",
    bytes: 0,
  };
  const store = {
    pool: {
      query: async (sql: string, params: any[]) => {
        if (sql.startsWith("UPDATE")) {
          if (sql.includes("SET bytes")) row.bytes = params[1];
          if (sql.includes("SET kind")) row.kind = params[1];
        }
        return { rows: [row] };
      },
    },
    event: async () => {},
  } as unknown as Store;
  try {
    await fs.writeFile(filename, "");
    const recorder = new RecordingBuffer(
      id,
      1,
      "fixture",
      crypto.randomUUID(),
      10485760,
      filename,
      key,
      store,
      () => {},
    );
    const secret = "sensitive transcript ★\r\n";
    recorder.append(Buffer.from(secret.repeat(30000)));
    await recorder.finish();
    const encrypted = await fs.readFile(filename);
    assert(!encrypted.includes(Buffer.from(secret)));
    assert.equal(encrypted.length, row.bytes);
    const recordings = new Recordings(store, directory, key),
      preview = await recordings.read(1, id);
    assert(preview.text.startsWith(secret));
    assert(preview.previewTruncated);
    assert.equal(preview.truncated, false);
    const mutated = Buffer.from(encrypted);
    mutated[35] ^= 1;
    await fs.writeFile(filename, mutated);
    await assert.rejects(recordings.read(1, id));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("a failed checkpoint leaves an explicitly truncated committed prefix, never an invented complete transcript", async () => {
  const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "omnilodge-recording-fault-"),
    ),
    filename = path.join(directory, crypto.randomUUID() + ".recording");
  let notice = "",
    state = "";
  const store = {
    pool: {
      query: async (sql: string, params: any[]) => {
        if (sql.includes("SET bytes"))
          throw new Error("fixture journal unavailable");
        if (sql.includes("SET kind")) state = params[1];
        return { rows: [] };
      },
    },
    event: async () => {},
  } as unknown as Store;
  try {
    await fs.writeFile(filename, "");
    const recorder = new RecordingBuffer(
      crypto.randomUUID(),
      1,
      "fixture",
      crypto.randomUUID(),
      8192,
      filename,
      crypto.randomBytes(32),
      store,
      (message) => {
        notice = message;
      },
    );
    recorder.append(Buffer.alloc(16000, 65));
    await recorder.finish();
    assert(recorder.truncated);
    assert.equal(state, "recording-truncated");
    assert(notice.length > 0);
    assert((await fs.stat(filename)).size <= 8192);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
