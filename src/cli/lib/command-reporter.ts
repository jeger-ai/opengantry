import { logError, logInfo, logWarn } from "./cli-io.js";
import {
  audienceSectionTitle,
  filterTaggedStepsForAudience,
  formatAudienceNextStep,
  type OutputAudience,
} from "./audience-output.js";
import { getOutputAudience } from "./output-context.js";
import { CLI_NAME } from "./constants.js";
import { logFixHint } from "./fix-hints.js";
import type { VerifyPhaseSuccess } from "./verify-engine.js";
import type { VerifyFailurePresentation } from "./verify-failure-normalize.js";
import type { VerifyResultPayload } from "./verify-payload.js";
import type { AudienceTaggedStep } from "./verify-hints.js";

export type CommandReporterChannel = "human" | "json" | "silent";

export interface CommandReporterOptions {
  channel?: CommandReporterChannel;
  audience?: OutputAudience;
}

/**
 * Unified output reporter for json / silent / audience channels.
 * Verify sinks are the first consumer; other commands can adopt over time.
 */
export class CommandReporter {
  readonly channel: CommandReporterChannel;
  readonly audience: OutputAudience | undefined;

  constructor(options: CommandReporterOptions = {}) {
    this.channel = options.channel ?? "human";
    this.audience = options.audience;
  }

  static forVerify(options: { json?: boolean; format?: string; audience?: OutputAudience }): CommandReporter {
    if (options.json || options.format) {
      return new CommandReporter({ channel: "json", audience: options.audience });
    }
    return new CommandReporter({
      channel: "human",
      audience: options.audience ?? getOutputAudience(),
    });
  }

  emitInfo(message: string): void {
    if (this.channel === "silent" || this.channel === "json") return;
    logInfo(message);
  }

  emitError(message: string): void {
    if (this.channel === "silent" || this.channel === "json") return;
    logError(message);
  }

  emitFixHint(hint: string): void {
    if (this.channel === "silent" || this.channel === "json") return;
    logFixHint(hint);
  }

  emitJsonPayload(payload: VerifyResultPayload): void {
    if (this.channel === "silent") return;
    logInfo(JSON.stringify(payload, null, 2));
  }

  emitVerifySuccess(result: VerifyPhaseSuccess, _missionArg: string): void {
    if (this.channel === "silent" || this.channel === "json") return;
    this.emitInfo(`${CLI_NAME} verify: git-proof OK (Planner legislation for ${result.proofMsnId})`);
    if (result.gitProofWarnings) {
      for (const w of result.gitProofWarnings) {
        logWarn(w);
      }
    }
    if (result.outcome === "pre_push_stub") {
      this.emitInfo(
        `${CLI_NAME} verify: legislative stub OK (remote handoff; git-proof passed — run full verify after execution)`,
      );
      return;
    }
    this.emitInfo(`${CLI_NAME} verify: gate passed`);
    if (result.defensiveWarnings) {
      for (const w of result.defensiveWarnings) {
        logWarn(`defensive: ${w}`);
      }
    }
    if (result.defensiveAudits) {
      for (const w of result.defensiveAudits) {
        this.emitInfo(`defensive audit: ${w}`);
      }
    }
    if (result.kpiWarnings) {
      for (const w of result.kpiWarnings) {
        this.emitInfo(`  ${w}`);
      }
    }
    for (const warning of result.traceWarnings) {
      const tag = warning.autoResolved ? "auto-resolved" : "drift";
      this.emitInfo(
        `  trace: line ${tag} DoD ${warning.row.dodId} — declared ${String(warning.declaredLine)}, found ${String(warning.foundLine)}`,
      );
    }
    if (result.traceEvidenceSkippedUncommitted !== undefined) {
      this.emitInfo(
        `  trace evidence: ${String(result.traceEvidenceSkippedUncommitted)} uncommitted EXECUTOR_LOG line(s) skipped stale check`,
      );
    }
    this.emitInfo(`${CLI_NAME} verify: trace mapping OK (${result.executorLogPath})`);
  }

  emitFailurePresentation(presentation: VerifyFailurePresentation): void {
    if (this.channel === "silent" || this.channel === "json") return;
    this.emitError(`[${presentation.error_code}] ${presentation.headline}`);
    for (const line of presentation.detail_lines) {
      if (line.startsWith("---")) this.emitError(line);
      else this.emitError(`  ${line}`);
    }
    for (const hint of presentation.fix_hints) {
      this.emitFixHint(hint);
    }
    this.emitNextSteps(presentation.next_actions, presentation.tagged_steps);
  }

  emitNextSteps(steps: string[], tagged?: AudienceTaggedStep[]): void {
    if (this.channel === "silent" || this.channel === "json") return;
    const audience = this.audience;
    const filtered =
      tagged && tagged.length > 0
        ? filterTaggedStepsForAudience(audience, tagged)
        : steps;
    const formatted = filtered.map((step) => formatAudienceNextStep(step, audience));
    const section = audienceSectionTitle(audience);
    if (section && formatted.length > 0) {
      logInfo(`${section}:`);
      for (const step of formatted) logInfo(`  ${step}`);
    } else {
      logInfo("next actions:");
      for (const action of formatted) logInfo(`  ${action}`);
    }
  }
}
