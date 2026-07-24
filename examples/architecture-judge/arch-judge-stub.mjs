#!/usr/bin/env node
/**
 * Deterministic BYO architecture judge stub (no network).
 * Usage: node arch-judge-stub.mjs <file-path>
 *
 * Scans a TypeScript file for thermo-nuclear architecture smells from ARCHITECTURE_RUBRIC.md.
 */
import fs from "node:fs";

const targetPath = process.argv[2];
const metrics = { "arch_judge::reviewed": targetPath ? 1 : 0 };
const findings = [];

if (targetPath && fs.existsSync(targetPath)) {
  const src = fs.readFileSync(targetPath, "utf8");
  const rel = targetPath.split("/").slice(-3).join("/") || targetPath;
  const lineOf = (needle) => src.split("\n").findIndex((l) => l.includes(needle)) + 1 || 1;

  if (/resolveMissionArg\s*\(/.test(src) && /attestMission|verify-run/.test(src) === false) {
    if (/export function attestMission/.test(src) || /function loadVerifyContext/.test(src)) {
      findings.push({
        id: "ARCH-ENV-01",
        severity: "warn",
        path: rel,
        line: lineOf("resolveMissionArg"),
        message: "Lib resolves mission env — resolve at CLI/MCP boundary and pass ResolvedMissionArg down",
        doc_anchor: "ARCHITECTURE_RUBRIC.md#ARCH-ENV-01",
      });
    }
  }

  if (/JSON\.stringify\s*\(/.test(src) && /commands\//.test(targetPath)) {
    findings.push({
      id: "ARCH-BND-01",
      severity: "warn",
      path: rel,
      line: lineOf("JSON.stringify"),
      message: "Command-layer JSON.stringify — use emitCliJson via runUserCommand boundary",
      doc_anchor: "ARCHITECTURE_RUBRIC.md#ARCH-BND-01",
    });
  }

  if (/setExitCode\s*\(\s*e\s+instanceof\s+GantryUserError/.test(src)) {
    findings.push({
      id: "ARCH-BND-01",
      severity: "warn",
      path: rel,
      line: lineOf("setExitCode(e instanceof"),
      message: "Exit-code ladder in catch — encode exitCode on GantryUserError at throw site",
      doc_anchor: "ARCHITECTURE_RUBRIC.md#ARCH-BND-01",
    });
  }
}

console.log(JSON.stringify({ metrics, findings, exit_code: 0 }));
