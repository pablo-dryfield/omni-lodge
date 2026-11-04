import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import type { SFTPWrapper } from "ssh2";
import { guardSftpStreams } from "../src/ssh.js";
test("SFTP read faults reject the active consumer while late CLOSE errors cannot crash the broker", async () => {
  const read = new PassThrough(),
    write = new PassThrough();
  const wrapper = guardSftpStreams({
    createReadStream: () => read,
    createWriteStream: () => write,
  } as unknown as SFTPWrapper);
  const stream = wrapper.createReadStream("/fixture");
  const consumed = (async () => {
    for await (const bytes of stream) void bytes;
  })();
  read.destroy(new Error("fixture transport closed"));
  await assert.rejects(consumed, /transport closed/);
  assert.doesNotThrow(() => read.emit("error", new Error("late close")));
  const writer = wrapper.createWriteStream("/fixture");
  assert.doesNotThrow(() =>
    writer.emit("error", new Error("late write close")),
  );
});
