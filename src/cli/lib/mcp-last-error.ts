import fs from "node:fs";
import path from "node:path";
import type { AgentErrorPayload } from "./errors.js";
import { type LastErrorResult } from "./mcp-governance-shared.js";
import { loadWorkspace } from "./workspace.js";

export function handleLastError(): LastErrorResult {
  const { root } = loadWorkspace();
  const errPath = path.join(root, ".gitagent", "history", ".ignored-last-error.json");
  if (!fs.existsSync(errPath)) {
    return { status: "empty", message: "No last error recorded." };
  }
  try {
    const payload = JSON.parse(fs.readFileSync(errPath, "utf8")) as AgentErrorPayload;
    return { status: "found", payload };
  } catch {
    return { status: "error", message: "Failed to parse last error file." };
  }
}
