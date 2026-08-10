import {
  evaluateScope,
  verifyMission,
  mintVerdictToken,
  verifyVerdictToken,
  isPromoteClassFunctionId,
} from "@jeger-ai/opengantry/kernel";

import {
  createMiddlewareHandler,
  isReservedGovernanceFunctionId,
} from "./lib/middleware.js";
import { VerifyCoalescer } from "./lib/verify-coalescer.js";
import { opengantryWorkerOptions } from "./lib/worker-init.js";
import { resolveVerifyRepoRoot } from "./lib/repo-path.js";

const state = {
  leaseStores: new Map(),
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
    const repoRoot = resolveVerifyRepoRoot(data.repo_root);
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

  console.log(`opengantry worker registered (verify, middleware, RBAC hooks) → ${url}`);
}

startWorker().catch((err) => {
  console.error(err);
  process.exit(1);
});

export { state, evaluateScope, mintVerdictToken, verifyVerdictToken, isPromoteClassFunctionId };
