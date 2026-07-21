import fs from "node:fs";

export async function loadConfig(path) {
  const raw = fs.readFileSync(path, "utf8");
  return JSON.parse(raw);
}
