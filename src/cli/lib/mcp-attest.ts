import { attestMission } from "./attest-mission.js";
import { resolveMissionArg } from "./mission-arg.js";
import { loadWorkspace } from "./workspace.js";

export function handleAttest(input: {
  mission_file_path: string;
  out?: string;
  sign?: boolean;
}): Record<string, unknown> {
  const { root } = loadWorkspace();
  const resolved = resolveMissionArg(root, input.mission_file_path);
  const result = attestMission({
    root,
    resolved,
    out: input.out,
    sign: input.sign === true,
  });
  return {
    status: "ok",
    repo_root: result.repo_root,
    receipt: result.receipt,
    receipt_path: result.receipt_path,
    mission_file_path: result.mission_file_path,
    mission_source: result.mission_source,
  };
}
