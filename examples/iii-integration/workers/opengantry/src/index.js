import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  evaluateScope,
  verifyMission,
  mintVerdictToken,
  verifyVerdictToken,
  isPromoteClassFunctionId,
} from "@jeger-ai/opengantry/kernel";

import { LeaseStore } from "../../../lib/lease-store.js";
import {
  createMiddlewareHandler,
  isReservedGovernanceFunctionId,
} from "../../../lib/middleware.js";
import { VerifyCoalescer } from "../../../lib/verify-coalescer.js";
import { opengantryWorkerOptions } from "../../../lib/worker-init.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INTEGRATION_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_TARGET_REPO = path.join(INTEGRATION_ROOT, "target-repo");
const STORE_PATH = path.join(INTEGRATION_ROOT, ".runtime/leases.json");

function hasGxtSubstrate(root) {
  return fs.existsSync(path.join(root, ".gitagent/foreman/MANIFEST.json"));
}

function resolveRepoRoot(repoRoot) {
  if (!repoRoot || typeof repoRoot !== "string") {
    throw new Error("gantry::verify: repo_root required");
  }
  if (path.isAbsolute(repoRoot)) {
    if (!hasGxtSubstrate(repoRoot)) {
      throw new Error(`gantry::verify: missing GXT substrate under ${repoRoot}`);
    }
    return repoRoot;
  }

  const candidates = [
    path.resolve(INTEGRATION_ROOT, repoRoot),
    path.resolve(process.cwd(), repoRoot),
  ];
  if (repoRoot === "." || repoRoot === "target-repo") {
    candidates.push(DEFAULT_TARGET_REPO);
  }

  for (const candidate of candidates) {
    if (hasGxtSubstrate(candidate)) return candidate;
  }

  throw new Error(
    `gantry::verify: no .gitagent/foreman/MANIFEST.json for repo_root=${repoRoot} (try target-repo or an absolute path)`,
  );
}

const state = {
  leases: new LeaseStore(STORE_PATH),
  coalescer: new VerifyCoalescer(),
  forwardTrigger: async (function_id, payload) => ({ ok: true, function_id, payload }),
};

async function startWorker() {
  const url = process.env.III_URL;
  if (!url) {
    console.log("opengantry worker: III_URL not set — idle (use demo.mjs for offline harness)");
    return;
  }

  const { registerWorker } = await import("iii-sdk");
  const worker = registerWorker(url, opengantryWorkerOptions());

  const middleware = createMiddlewareHandler(state);

  state.forwardTrigger = async (function_id, payload) =>
    worker.trigger({ function_id, payload });

  worker.registerFunction("gantry::middleware", middleware);

  worker.registerFunction("gantry::verify", async (data) => {
    const repoRoot = resolveRepoRoot(data.repo_root);
    const key = `${repoRoot}:${data.msn_id}`;
    return state.coalescer.run(key, async () =>
      verifyMission({
        repoRoot,
        missionRelPath: data.mission_rel_path,
        options: data.options ?? { skipStaleEvidence: true },
      }),
    );
  });

  worker.registerFunction("gantry::on-function-registration", async (input) => {
    if (isReservedGovernanceFunctionId(input.function_id)) {
      throw new Error(`reserved namespace: ${input.function_id}`);
    }
    return { function_id: input.function_id };
  });

  worker.registerFunction("gantry::on-trigger-registration", async (input) => {
    if (input.function_id.startsWith("gantry::")) {
      throw new Error("cannot bind trigger to gantry namespace");
    }
    return input;
  });

  worker.registerFunction("gantry::on-trigger-type-registration", async () => {
    throw new Error("trigger type registration denied");
  });

  worker.registerTriggerType({
    id: "gantry::verdict",
    description: "Emitted when gantry verify completes",
  });

  // Fixture target for middleware promote-gate demos (not part of gantry:: namespace).
  worker.registerFunction("demo::promote", async (data) => ({ promoted: true, ...data }));

  console.log(`opengantry worker registered (verify, middleware, RBAC hooks) → ${url}`);
}

startWorker().catch((err) => {
  console.error(err);
  process.exit(1);
});

export { state, evaluateScope, mintVerdictToken, verifyVerdictToken, isPromoteClassFunctionId };
