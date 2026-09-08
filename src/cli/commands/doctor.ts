import { logInfo, setExitCode, errorMessage } from "../lib/cli-io.js";
import { emitCliJson } from "../lib/command-boundary.js";
import {
  audienceSectionTitle,
  filterTaggedStepsForAudience,
  type OutputAudience,
} from "../lib/audience-output.js";
import { collectDoctorReport } from "../lib/doctor-core.js";
import type { AdapterPreflightOptions } from "../lib/doctor-adapter-preflight.js";
import { doctorLinesHasFail, type DoctorLine } from "../lib/doctor-types.js";
import { isGateAdapterId, type GateAdapterId } from "../lib/types.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface DoctorReport {
  lines: DoctorLine[];
  next_step: string | null;
  exit_code: number;
}

export interface DoctorOptions {
  json?: boolean;
  audience?: OutputAudience;
  policy?: string;
  gateAdapter?: string;
  adapterBaseline?: boolean;
}

function typedForceAdapter(raw: string | undefined): GateAdapterId | { fail: DoctorLine } | undefined {
  if (raw === undefined) return undefined;
  if (!isGateAdapterId(raw)) {
    return { fail: { level: "fail", message: `unknown --gate-adapter ${raw} (use tsc or eslint)` } };
  }
  switch (raw) {
    case "tsc":
    case "eslint":
      return raw;
    case "generic":
      return { fail: { level: "fail", message: "unknown --gate-adapter generic (use tsc or eslint)" } };
    default: {
      const unreachable: never = raw;
      throw new Error(`unknown gate adapter: ${String(unreachable)}`);
    }
  }
}

function emitDoctor(
  lines: DoctorLine[],
  nextStep: string | null,
  hasFail: boolean,
  json: boolean | undefined,
  audience?: OutputAudience,
): void {
  const exitCode = hasFail ? 1 : 0;
  if (json) {
    emitCliJson({ lines, next_step: nextStep, exit_code: exitCode });
  } else {
    for (const line of lines) {
      logInfo(`${line.level}: ${line.message}`);
    }
    const section = audienceSectionTitle(audience);
    const steps = filterTaggedStepsForAudience(
      audience,
      nextStep ? [{ audience: "platform", step: nextStep }] : [],
    );
    if (section && steps.length > 0) {
      logInfo(`${section}:`);
      for (const step of steps) logInfo(`  ${step}`);
    } else if (nextStep) {
      logInfo(`Next: ${nextStep}`);
    }
  }
  if (hasFail) setExitCode(1);
}

export function runDoctor(options: DoctorOptions = {}): void {
  try {
    const forced = typedForceAdapter(options.gateAdapter);
    if (forced !== undefined && typeof forced === "object") {
      emitDoctor([forced.fail], null, true, options.json, options.audience);
      return;
    }
    const adapterPreflight: AdapterPreflightOptions = {
      ...(forced !== undefined ? { forceAdapter: forced } : {}),
      ...(options.adapterBaseline === true ? { baseline: true } : {}),
    };
    const { root, manifest } = loadWorkspace();
    const report = collectDoctorReport(root, manifest, undefined, options.policy, adapterPreflight);
    emitDoctor(
      report.lines,
      report.nextStep,
      doctorLinesHasFail(report.lines),
      options.json,
      options.audience,
    );
  } catch (e) {
    const msg = errorMessage(e);
    emitDoctor([{ level: "fail", message: msg }], null, true, options.json, options.audience);
  }
}
