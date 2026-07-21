import { attestMission } from "./attest-mission.js";
import { loadWorkspace } from "./workspace.js";

export function handleAttest(input: {
  mission_file_path: string;
  out?: string;
  sign?: boolean;
}): Record<string, unknown> {
  const { root } = loadWorkspace();
  const result = attestMission({
    mission: input.mission_file_path,
    out: input.out,
    sign: input.sign === true,
  });
  return {
    status: "ok",
    repo_root: root,
    ...result,
  };
}
