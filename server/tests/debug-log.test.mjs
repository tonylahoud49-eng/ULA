import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { debugLogInternals } from "../ai/debugLog.mjs";

test("AI debug output absorbs an asynchronous EPIPE from a closed output stream", () => {
  const stream = new EventEmitter();
  debugLogInternals.protectDebugStream(stream);

  const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
  assert.doesNotThrow(() => stream.emit("error", error));
});
