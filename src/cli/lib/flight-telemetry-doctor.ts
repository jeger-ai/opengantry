import type { DoctorLine } from "./doctor-types.js";
import { loadGxtConfig, resolveFlightTelemetryBodyMode } from "./gxt-config.js";
import { isDefensiveProfilePresetName } from "./defensive-profile-presets.js";

export function runFlightTelemetryDoctorChecks(root: string): DoctorLine[] {
  const lines: DoctorLine[] = [];
  const config = loadGxtConfig(root);
  const mode = resolveFlightTelemetryBodyMode(config);
  const rawMode = config.flight_telemetry?.body_mode;
  if (rawMode && rawMode !== "hash_only" && rawMode !== "full") {
    lines.push({
      level: "fail",
      message: `flight_telemetry.body_mode invalid (${rawMode}); use hash_only or full`,
    });
    return lines;
  }

  lines.push({ level: "ok", message: `flight_telemetry.body_mode: ${mode}` });

  const preset = config.defensive_profile?.preset;
  if (isDefensiveProfilePresetName(preset ?? "") && preset === "strict_enterprise" && mode === "full") {
    lines.push({
      level: "warn",
      message:
        "strict_enterprise preset with flight_telemetry.body_mode=full stores gate stream bodies in EXECUTOR_LOG",
    });
  }

  return lines;
}
