# Adoption Runbook (v0.7.0 specimen)

This runbook documents the current OpenGantry specimen flow for adopters testing `gapman` locally.

## Release posture

- `v0.7.0` is a GitHub specimen release.
- Package publishing remains disabled (`package.json` is `private: true`).
- Validate distribution shape locally with `npm pack`.

## Ordered bootstrap flow

Run these commands from a fresh repository where you want to bootstrap GXT.

1. Initialize substrate assets:

```bash
gapman init
```

2. Configure governance before any mission legislation:
   - Edit `.gitagent/foreman/MANIFEST.json` for real `tmvc_roots`, `forbidden_zones`, and risk posture.
   - Ensure each manifest skill key has a matching `skills/<key>.md` file.
   - Validate sync:

```bash
gapman check
```

3. Optional local hook setup:

```bash
git config core.hooksPath .githooks
```

4. Configure Teacher identity:

```bash
export GAPMAN_TEACHER_EMAILS="teacher@example.com"
```

5. Legislate first mission (explicit id required):

```bash
gapman legislate "Fix login spinner on checkout — ui-ralph" --msn MSN-0001 --skill-key ui-ralph
```

Notes:

- Duplicate `msn_id` values fail closed by default.
- Use `--allow-duplicate` only for intentional branch migration flows.

6. Continue with runtime/verify:

```bash
gapman runtime env --mission .gitagent/missions/MSN-0001.fix-login-spinner-on-checkout-ui-ralph.yaml
gapman verify --mission .gitagent/missions/MSN-0001.fix-login-spinner-on-checkout-ui-ralph.yaml
```

## Local specimen smoke checklist

Use this to validate the v0.7.0 specimen before tagging:

1. `npm run build && npm test`
2. `npm pack` and extract tarball
3. Run packed CLI `init` in a fresh temp git repo
4. Confirm `gapman check` passes after manifest/skills customization
5. Confirm:
   - legislate without `--msn` exits non-zero
   - duplicate `--msn` exits non-zero without `--allow-duplicate`
   - duplicate `--msn` succeeds only with `--allow-duplicate`
