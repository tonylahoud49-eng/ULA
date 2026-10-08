import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const windowsOnly = { skip: process.platform !== "win32" };
const saveScript = fileURLToPath(new URL("../../scripts/save-release-rollback.ps1", import.meta.url));
const literal = (value) => `'${value.replaceAll("'", "''")}'`;

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ula-release-rollback-"));
  t.after(() => {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith("ula-release-rollback-"));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const write = (name, contents) => {
    const target = path.join(directory, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  };
  const git = (...args) => execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=release");
  git("config", "user.name", "Rollback test");
  git("config", "user.email", "rollback-test@example.invalid");
  write(".gitignore", ".data/\ndist/\n.env\nuploads/\n");
  write("server/index.mjs", "// previous server\n");
  write("package.json", '{"name":"rollback-fixture","version":"1.0.0"}\n');
  write("package-lock.json", '{"lockfileVersion":3}\n');
  write(".env", "PORT=8787\nAI_JOB_CONCURRENCY=1\nEXAMPLE=\"retain=é\"\n");
  write("dist/index.html", "<html>previous frontend</html>\n");
  write("dist/assets/previous.js", "// previous asset\n");
  write("uploads/current.pdf", Buffer.from([0, 1, 255]));
  write(".data/analysis-jobs/checkpoint.json", '{"paid":"previous"}\n');
  git("add", ".gitignore", "server/index.mjs", "package.json", "package-lock.json");
  git("commit", "-m", "Previous release");
  const previous = git("rev-parse", "HEAD");
  const point = path.join(directory, ".data", "rollback-before-parallel");
  const run = (script) => {
    const callsPath = path.join(directory, ".data", "service-calls.txt");
    fs.mkdirSync(path.dirname(callsPath), { recursive: true });
    const command = `
$global:serviceCalls = @()
function Get-Service { param($Name) [pscustomobject]@{Name=$Name;Status='Running'} }
function Stop-Service { param($Name) $global:serviceCalls += 'stop' }
function Start-Service { param($Name) $global:serviceCalls += 'start' }
function Start-Sleep { param($Seconds) }
function Invoke-RestMethod { param($Uri) [pscustomobject]@{ok=$true;storage='postgresql'} }
try { & ${literal(script)} -ApplicationDirectory ${literal(directory)} }
catch { Write-Error $_; exit 1 }
finally { [System.IO.File]::WriteAllLines(${literal(callsPath)}, [string[]]$global:serviceCalls) }
`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { encoding: "utf8", timeout: 30_000 });
    assert.ifError(result.error);
    return { ...result, calls: fs.readFileSync(callsPath, "utf8").trim().split(/\r?\n/).filter(Boolean) };
  };
  const update = () => {
    write("server/index.mjs", "// updated server\n");
    write(".env", "PORT=8787\nAI_JOB_CONCURRENCY=2\nAI_JOB_BATCH_MAX_PAGES=60\n");
    write("dist/index.html", "<html>updated frontend</html>\n");
    write("dist/assets/updated.js", "// updated asset\n");
    write(".data/analysis-jobs/checkpoint.json", '{"paid":"updated result"}\n');
    git("add", "server/index.mjs");
    git("commit", "-m", "Updated release");
    return git("rev-parse", "HEAD");
  };
  return { directory, write, git, previous, point, run, update, restore: () => run(path.join(point, "restore.ps1")) };
}

test("a release rollback restores the saved code, environment and frontend while retaining later paid work", windowsOnly, (t) => {
  const f = fixture(t);
  const originalEnvironment = fs.readFileSync(path.join(f.directory, ".env"));
  const saved = f.run(saveScript);
  assert.equal(saved.status, 0, saved.stderr);
  assert.deepEqual(saved.calls, [], "saving a point must not stop the live service");
  const record = JSON.parse(fs.readFileSync(path.join(f.point, "release.json"), "utf8"));
  assert.equal(record.commit, f.previous);
  const updatedCommit = f.update();
  const currentEnvironment = fs.readFileSync(path.join(f.directory, ".env"));
  f.write("untracked-owner-note.txt", "keep this file");
  const restored = f.restore();
  assert.equal(restored.status, 0, restored.stderr);
  assert.deepEqual(restored.calls, ["stop", "start"]);
  assert.equal(f.git("rev-parse", "HEAD"), f.previous);
  assert.equal(f.git("rev-parse", "release"), updatedCommit, "the updated branch must remain intact");
  assert.deepEqual(fs.readFileSync(path.join(f.directory, ".env")), originalEnvironment);
  assert.equal(fs.readFileSync(path.join(f.directory, "dist/index.html"), "utf8"), "<html>previous frontend</html>\n");
  assert.equal(fs.readFileSync(path.join(f.directory, "dist/assets/previous.js"), "utf8"), "// previous asset\n");
  assert.equal(fs.readFileSync(path.join(f.directory, ".data/analysis-jobs/checkpoint.json"), "utf8"), '{"paid":"updated result"}\n');
  assert.deepEqual(fs.readFileSync(path.join(f.directory, "uploads/current.pdf")), Buffer.from([0, 1, 255]));
  assert.equal(fs.readFileSync(path.join(f.directory, "untracked-owner-note.txt"), "utf8"), "keep this file");
  const backupRoot = path.join(f.directory, ".data", "deployment-backups");
  const backups = fs.readdirSync(backupRoot);
  assert.equal(backups.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(backupRoot, backups[0], ".env")), currentEnvironment);
});

test("rollback refuses tracked edits and dependency changes before stopping the service", windowsOnly, (t) => {
  const f = fixture(t);
  assert.equal(f.run(saveScript).status, 0);
  const updatedCommit = f.update();
  f.write("server/index.mjs", "// owner's local change\n");
  const dirty = f.restore();
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /tracked local changes/);
  assert.deepEqual(dirty.calls, []);
  assert.equal(f.git("rev-parse", "HEAD"), updatedCommit);
  f.git("add", "server/index.mjs");
  f.git("commit", "-m", "Keep owner change");
  f.write("package.json", '{"name":"rollback-fixture","version":"2.0.0"}\n');
  f.git("add", "package.json");
  f.git("commit", "-m", "Dependency change");
  const changed = f.restore();
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /Dependency manifests changed/);
  assert.deepEqual(changed.calls, []);
  assert.match(fs.readFileSync(path.join(f.directory, ".env"), "utf8"), /AI_JOB_CONCURRENCY=2/);
});

test("rollback points cannot be overwritten or saved with uncommitted code", windowsOnly, (t) => {
  const f = fixture(t);
  f.write("server/index.mjs", "// uncommitted change\n");
  const dirty = f.run(saveScript);
  assert.equal(dirty.status, 1);
  assert.equal(fs.existsSync(f.point), false);
  f.git("add", "server/index.mjs");
  f.git("commit", "-m", "Keep owner change");
  assert.equal(f.run(saveScript).status, 0);
  const originalRecord = fs.readFileSync(path.join(f.point, "release.json"));
  const duplicate = f.run(saveScript);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /already exists/);
  assert.deepEqual(fs.readFileSync(path.join(f.point, "release.json")), originalRecord);
});
