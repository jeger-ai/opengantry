import path from "node:path";
import {
  appendContextRequest,
  stageExecutorLogIfRequested,
  executorLogRepoRelative,
} from "../lib/context-request.js";
import { logError, logInfo, logWarn, setExitCode, errorMessage } from "../lib/cli-io.js";
import { resolveRuntimeEnv } from "../lib/runtime-env.js";
import { resolvePinnedMission } from "../lib/missions/parser.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface ContextRequestCliOptions {
  mission?: string;
  paths: string[];
  reason?: string;
  proposed?: string[];
  stageExecutorLog?: boolean;
  executorLog?: string;
  json?: boolean;
}

export function runContextRequest(options: ContextRequestCliOptions): void {
  try {
    const reason = options.reason?.trim() ?? "";
    if (reason.length === 0) {
      logError("context-request: --reason is required");
      setExitCode(2);
      return;
    }

    const paths = options.paths.map((p) => p.trim()).filter((p) => p.length > 0);
    if (paths.length === 0) {
      logError("context-request: at least one --path is required");
      setExitCode(2);
      return;
    }

    const workspace = loadWorkspace();
    const missionRel = options.mission?.trim() || resolvePinnedMission(workspace.root) || null;

    if (!missionRel) {
      logError(
        "context-request: no active mission — pin one with scripts/gxt-pin-mission.sh or pass --mission <path>",
      );
      setExitCode(2);
      return;
    }

    const resolved = resolveRuntimeEnv(workspace, missionRel);
    const executorLogPath = options.executorLog
      ? path.resolve(workspace.root, options.executorLog)
      : resolved.executor_log;

    const line = appendContextRequest({
      executorLogPath,
      entry: {
        status: "PENDING",
        paths,
        reason,
        proposed: options.proposed,
        msnId: resolved.msn_id || undefined,
      },
    });

    const stageResult = stageExecutorLogIfRequested(
      workspace.root,
      executorLogPath,
      options.stageExecutorLog === true,
    );

    const executorLogRel = executorLogRepoRelative(workspace.root, executorLogPath);

    if (options.json) {
      logInfo(
        JSON.stringify(
          {
            status: "ok",
            mission: resolved.mission_file,
            msn_id: resolved.msn_id,
            executor_log: executorLogRel,
            line,
            staged: stageResult.staged,
          },
          null,
          2,
        ),
      );
      return;
    }

    logInfo(`context-request: appended to ${executorLogRel}`);
    logInfo(`  ${line}`);
    if (options.stageExecutorLog === true) {
      if (stageResult.staged) {
        logInfo(`  staged: ${executorLogRel}`);
      } else {
        logWarn(`failed to stage ${executorLogRel}: ${stageResult.stderr || "git add failed"}`);
      }
    } else {
      logWarn(`run: git add ${executorLogRel}  (or pass --stage-worker-log to stage automatically)`);
    }
  } catch (e) {
    logError(errorMessage(e));
    setExitCode(2);
  }
}
