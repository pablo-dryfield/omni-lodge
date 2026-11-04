import test from "node:test";
import assert from "node:assert/strict";
import { decodeText } from "../src/textFiles.js";
test("UTF-8 previews retain BOM and distinguish every newline style without silently normalizing mixed files", () => {
  assert.deepEqual(decodeText(Buffer.from("\ufeffhello\r\nworld\r\n")), {
    text: "hello\r\nworld\r\n",
    bom: true,
    newline: "CRLF",
  });
  assert.equal(decodeText(Buffer.from("a\rb")).newline, "CR");
  assert.equal(decodeText(Buffer.from("a\nb")).newline, "LF");
  assert.equal(decodeText(Buffer.from("a\r\nb\nc")).newline, "mixed");
  assert.throws(() => decodeText(Buffer.from([0xff, 0xfe, 0x41])));
  assert.throws(() => decodeText(Buffer.from("text\0binary")));
});
