# opengantry

Runs OpenGantry's verify gate on the iii bus and checks your project's local `workers/` tree against iii's own worker contracts (manifest, `request_format` / `response_format`, isolation) before promote-class calls go through.

Until this worker is listed in the iii-hq registry, install it from the path in this repo.

## Install

```bash
cd workers/opengantry && npm run build:bundle && cp sandbox.mjs index.mjs
cd ../..
iii worker add ./workers/opengantry
```

`npm start` on the host still uses the thin `index.mjs` → `src/index.js` re-export and host `node_modules`. Sandbox VMs hide host `node_modules` and overlay `dist/`, so the worker must boot from a single-file bundle at the worker root. Bundle workers must not set `scripts.install`.

`iii worker add` writes a `worker_path` block into your iii `config.yaml`. Start the engine from that project so the worker comes up on the next boot.

Named install (`iii worker add opengantry`) is not available until iii-hq lists the worker.

## Sandbox mounts

libkrun mounts **only this worker folder** at `/workspace`. Host paths such as `/home/you/my-repo` are not visible. `gantry::verify` with an absolute `repo_root` on the host therefore fails closed (the path does not exist inside the VM). Extra virtiofs mounts are not a `iii.worker.yaml` field in iii 0.22.

Until iii can attach the governed git repo into the VM, run verify from a **host** worker process:

```bash
export III_URL=ws://127.0.0.1:49134
export OTEL_ENABLED=false
cd workers/opengantry && npm start
```

That process can read any absolute `repo_root` on the machine. The scan of `<repo_root>/workers` and `verifyMission` then run as designed.

## Quickstart

After install, initialize OpenGantry in the git repo you want governed, then call verify with an absolute `repo_root`:

```bash
gantry init
node scripts/activate-opengantry-iii.mjs --bootstrap --repo-root "$(pwd)"
```

```js
import { registerWorker } from "iii-sdk";

const iii = registerWorker("ws://127.0.0.1:49134", { workerName: "caller" });

const result = await iii.trigger({
  function_id: "gantry::verify",
  payload: {
    repo_root: "/absolute/path/to/your/repo",
    msn_id: "MSN-0001",
    mission_rel_path: ".gitagent/missions/MSN-0001.iii-local-workers.yaml",
  },
});

console.log(result);
```

`gantry::verify` scans `<repo_root>/workers` first. Findings fail verify even when the GXT mission gate would pass. Missing `.gitagent` also fails, with a hint to run `gantry init` and `--bootstrap`. It does not skip the gate.

On the governed listener, wire `gantry::middleware` plus the `gantry::on-*` registration hooks. Promote-class functions still need a verify pass.

## Configuration

```yaml
workers:
  - name: opengantry
  - name: iii-worker-manager
    config:
      host: 0.0.0.0
      port: 49135
      middleware_function_id: gantry::middleware
      rbac:
        auth_function_id: session::auth   # your IdP worker, not OpenGantry
        on_function_registration_function_id: gantry::on-function-registration
        on_trigger_registration_function_id: gantry::on-trigger-registration
        on_trigger_type_registration_function_id: gantry::on-trigger-type-registration
```

`repo_root` / `worktree_path` must be absolute. There is no cwd fallback. Leases live at `<repo>/.gitagent/leases.json`.

## Custom trigger types

| Trigger type | Fires when | Payload to subscribers |
|---|---|---|
| `gantry::verdict` | After `gantry::verify` completes | Verify result (`status` plus findings when failed) |
