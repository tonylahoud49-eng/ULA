import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(moduleDir, "../../../.data/agent_config.json");

const DEFAULT_CONFIG = {
  mode: process.env.AGENT_DEFAULT_MODE || "hybrid", // "free" | "hybrid" | "forensic"
  enable_dossier_caching: true,
  enable_prompt_caching: true,
  primary_reader_provider: "gemini",
  primary_reader_model: process.env.GEMINI_MODEL || "gemini-3.7-flash",
  primary_brain_provider: "anthropic",
  primary_brain_model: "claude-sonnet-4-6",
};

export async function getAgentConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    // If config has legacy gemini-2.0-flash, upgrade to configured GEMINI_MODEL if present
    if (parsed.primary_reader_model === "gemini-2.0-flash" && process.env.GEMINI_MODEL) {
      parsed.primary_reader_model = process.env.GEMINI_MODEL;
    }
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function setAgentConfig(updates) {
  const current = await getAgentConfig();
  const merged = { ...current, ...updates, updated_at: new Date().toISOString() };
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}
