import { attestMission } from "./attest-mission.js";

export function handleAttest(input: {
  mission_file_path: string;
  out?: string;
  sign?: boolean;
}): Record<string, unknown> {
  const result = attestMission({
    mission: input.mission_file_path,
    out: input.out,
    sign: input.sign === true,
  });
  return {
    status: "ok",
    repo_root: result.repo_root,
    receipt: result.receipt,
    receipt_path: result.receipt_path,
  };
}
