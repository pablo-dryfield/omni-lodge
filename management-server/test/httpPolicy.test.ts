import test from "node:test";
import assert from "node:assert/strict";
import { requireRequestMethod } from "../src/httpPolicy.js";

test("link navigation is a read while publication and uploads keep explicit write methods", () => {
  assert.doesNotThrow(() => requireRequestMethod("GET", "/management/files/resolve-link"));
  assert.throws(() => requireRequestMethod("POST", "/management/files/resolve-link"), { code: "METHOD_NOT_ALLOWED" });
  assert.throws(() => requireRequestMethod("GET", "/management/file-operations/execute"), { code: "METHOD_NOT_ALLOWED" });
  assert.doesNotThrow(() => requireRequestMethod("POST", "/management/file-operations/execute"));
  assert.throws(() => requireRequestMethod("GET", "/management/uploads/id/chunks"), { code: "METHOD_NOT_ALLOWED" });
  assert.doesNotThrow(() => requireRequestMethod("PUT", "/management/uploads/id/chunks"));
});
