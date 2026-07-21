import fs from "node:fs/promises";

export async function loadConfig(path) {
  const raw = await fs.readFile(path, "utf8");
  return JSON.parse(raw);
}
