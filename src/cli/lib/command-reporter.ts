import { logInfo } from "./cli-io.js";
import {
  audienceSectionTitle,
  filterTaggedStepsForAudience,
  formatAudienceNextStep,
  type OutputAudience,
} from "./audience-output.js";
import { getOutputAudience } from "./output-context.js";
import type { AudienceTaggedStep } from "./verify-remediation.js";

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

  static forVerify(options: { json?: boolean; audience?: OutputAudience }): CommandReporter {
    if (options.json) {
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

  emitJson(payload: unknown): void {
    if (this.channel === "silent") return;
    logInfo(JSON.stringify(payload, null, 2));
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
