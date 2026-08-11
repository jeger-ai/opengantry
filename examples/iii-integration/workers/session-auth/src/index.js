/**
 * Example iii admission worker — NOT OpenGantry.
 * Wired as `auth_function_id: session::auth` on the governed listener.
 */
import {
  extractBearer,
  verifySessionAdmissionToken,
} from "./admission.js";

// Auth workers connect to the trusted bus; the governed listener calls session::auth.
const url = process.env.III_URL ?? "ws://127.0.0.1:49134";

const { registerWorker } = await import("iii-sdk");
const worker = registerWorker(url, {
  workerName: "session-auth",
  workerDescription: "Example admission (replace with your IdP worker)",
  otel: { enabled: process.env.OTEL_ENABLED === "true" },
});

worker.registerFunction("session::auth", async (input) => {
  const token = extractBearer(input.headers ?? {});
  if (!token) throw new Error("missing session admission token");
  const ctx = verifySessionAdmissionToken(token);
  if (!ctx) throw new Error("invalid session admission token");
  return {
    allowed_functions: [],
    forbidden_functions: [],
    allow_trigger_type_registration: false,
    allow_function_registration: true,
    function_registration_prefix: `${ctx.holder_id}::`,
    context: ctx,
  };
});

console.log(`session-auth worker registered session::auth → ${url}`);
