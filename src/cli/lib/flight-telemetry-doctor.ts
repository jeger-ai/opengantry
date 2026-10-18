import type { DoctorLine } from "./doctor/doctor-types.js";
import { loadGxtConfig, resolveFlightTelemetryBodyMode } from "./gxt-config.js";

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


  return lines;
}
