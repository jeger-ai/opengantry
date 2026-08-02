# Skill: iii-integration

Manifest key `iii-integration`. Minimal iii.dev example for **OpenGantry governance functions only** (`gantry::verify`, `gantry::middleware`, RBAC hooks).

Admission (`auth_function_id`) is an adopters' worker — see `workers/session-auth/` as a replaceable stub.

Uses `@jeger-ai/opengantry/kernel` for in-process verify and verdict tokens.
