import path from "node:path";
import { getRepoRoot } from "../lib/git.js";
import { loadManifest } from "../lib/manifest.js";
import { emitActiveMissionFromTemplate } from "../lib/mission-emit.js";
import { formatTriageJson, triageIntent } from "../lib/triage-logic.js";

export function runTriage(opts: {
  text: string;
  json?: boolean;
  emitMission?: boolean;
  msn?: string;
  out?: string;
}): void {
  const root = getRepoRoot();
  const manifest = loadManifest(root);
  const result = triageIntent(opts.text, manifest);
  if (opts.json) {
    console.log(formatTriageJson(result));
  } else {
    console.log(`Action: ${result.action}`);
    console.log(`Skill_key: ${result.skill_key}`);
    console.log(`Risk_tier: ${result.risk_tier}`);
    console.log(`tmvc_roots: ${JSON.stringify(result.tmvc_roots)}`);
    console.log(`forbidden_zones: ${JSON.stringify(result.forbidden_zones)}`);
    console.log(`Reason: ${result.reason}`);
  }
  if (opts.emitMission) {
    if (result.action !== "DIRECT_EXECUTION" || result.skill_key === "NONE") {
      console.error("gapman triage: --emit-mission requires DIRECT_EXECUTION with a skill_key");
      process.exitCode = 1;
      return;
    }
    const msn = opts.msn ?? "MSN-0000";
    if (!/^MSN-\d{4}$/.test(msn)) {
      console.error("gapman triage: --msn must look like MSN-0007");
      process.exitCode = 1;
      return;
    }
    const out = emitActiveMissionFromTemplate(root, {
      skillKey: result.skill_key,
      msnId: msn,
      outPath: opts.out,
    });
    console.error(`Wrote ${path.relative(root, out)}`);
  }
}

/** @internal */
export function readStdinIfEmpty(text: string): Promise<string> {
  if (text.trim()) return Promise.resolve(text);
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      data += c;
    });
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}
