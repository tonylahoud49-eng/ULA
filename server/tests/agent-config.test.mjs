import test from "node:test";
import assert from "node:assert/strict";
import { getAgentConfig, setAgentConfig } from "../ai/agent/agentConfig.mjs";

test("getAgentConfig and setAgentConfig persist configuration", async () => {
  const config = await getAgentConfig();
  assert.ok(["free", "hybrid", "forensic"].includes(config.mode));

  await setAgentConfig({ mode: "free", enable_dossier_caching: true });
  const updated = await getAgentConfig();
  assert.equal(updated.mode, "free");
  assert.equal(updated.enable_dossier_caching, true);
});
