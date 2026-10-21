import test from "node:test";
import assert from "node:assert/strict";
import { judgeSecretPath, SECRET_ENV_EXCEPT, SECRET_ENV_PATTERNS } from "../src/secret-paths.js";

const HOME = "/home/dev";

test("secret paths: env files and private keys anywhere, credential stores under home; .env.example and ordinary files pass (MSN-0343)", () => {
  const rule = (p: string): string | null => judgeSecretPath(p, HOME)?.rule ?? null;
  for (const p of ["/repo/.env", "/repo/app/.env.local", "/repo/.git/config", "/srv/.git-credentials", "/tmp/keys/id_ed25519", "/repo/sub/.git/config"]) {
    assert.equal(rule(p), "secret_file", p);
  }
  for (const p of ["/home/dev/.ssh", "/home/dev/.ssh/config", "/home/dev/.aws/credentials", "/home/dev/.npmrc", "/home/dev/.config/gcloud/application_default_credentials.json", "/home/dev/.kube/config"]) {
    assert.equal(rule(p), "home_credentials", p);
  }
  for (const p of ["/repo/.env.example", "/repo/README.md", "/repo/.gitignore", "/repo/.git/HEAD", "/repo/id_ed25519.pub", "/other/.ssh/known", "/home/dev/.sshx", "/home/devil/.aws/x"]) {
    assert.equal(rule(p), null, p);
  }
  assert.equal(judgeSecretPath("/home/dev/.aws/x", "/home/dev///")?.rule, "home_credentials", "a trailing slash on home is ignored");
});

test("secret paths: the cage's secrets rule and the read guard share one env list (MSN-0343)", () => {
  assert.deepEqual([...SECRET_ENV_PATTERNS], ["**/.env", "**/.env.*"]);
  assert.deepEqual([...SECRET_ENV_EXCEPT], ["**/.env.example"]);
});
