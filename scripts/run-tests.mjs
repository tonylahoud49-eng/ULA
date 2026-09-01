import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const testsDir = path.resolve("server/tests");
const entries = await fs.readdir(testsDir);
const testFiles = entries
  .filter((file) => file.endsWith(".test.mjs"))
  .map((file) => path.join("server/tests", file));

if (testFiles.length === 0) {
  console.error("No .test.mjs test files found in server/tests.");
  process.exit(1);
}

const child = spawn(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
