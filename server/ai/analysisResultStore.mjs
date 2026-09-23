import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function createAnalysisResultStore(directory) {
  const fileFor = (fingerprint) => {
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error("Invalid analysis fingerprint.");
    return path.join(directory, `${fingerprint}.json`);
  };
  return {
    read(fingerprint) {
      try {
        const record = JSON.parse(fs.readFileSync(fileFor(fingerprint), "utf8"));
        return record.state === "complete" && record.expiresAt > Date.now() ? record : null;
      } catch (error) {
        if (error.code === "ENOENT") return null;
        // Do not silently charge again when a saved result cannot be read.
        throw error;
      }
    },
    write(fingerprint, record) {
      fs.mkdirSync(directory, { recursive: true });
      const target = fileFor(fingerprint);
      const temporary = `${target}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
        fs.renameSync(temporary, target);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    },
  };
}
