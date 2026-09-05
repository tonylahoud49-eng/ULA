import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const testsDir = path.resolve("server/tests");
const testFiles = fs.readdirSync(testsDir)
  .filter((file) => file.endsWith(".test.mjs"))
  .map((file) => path.join("server", "tests", file));

const result = spawnSync(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
process.exit(result.status ?? 1);
