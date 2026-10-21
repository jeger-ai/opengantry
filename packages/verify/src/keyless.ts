import type { Bundle } from "sigstore";
import { GantryUserError } from "#core/user-error.js";
import { canonicalReceiptUtf8 } from "#git/receipt-signing.js";
import type { VerifyContractResult } from "./run.js";

/**
 * Keyless signing of a verify result (ADR-0055): a Sigstore bundle over the same canonical payload `--sign` signs,
 * with a short-lived certificate for the CI's OIDC identity and a transparency-log entry. The only network path in
 * verify: `sigstore` is loaded when a keyless signature is made or checked, never in a default run.
 */

/** The OIDC issuer of GitHub Actions job tokens, the default `--certificate-oidc-issuer`. */
export const GITHUB_ACTIONS_ISSUER = "https://token.actions.githubusercontent.com";

export interface KeylessSignature {
  kind: "sigstore";
  payload_encoding: "canonical_json_utf8";
  /** Signing certificate, signature and transparency-log entry (Sigstore bundle v0.3). */
  bundle: Bundle;
}

/** The part of `sigstore` verify uses; tests pass a stand-in. */
export interface SigstoreApi {
  sign(payload: Buffer): Promise<Bundle>;
  verify(bundle: Bundle, payload: Buffer, options: Record<string, string>): Promise<{ identity?: { subjectAlternativeName?: string } }>;
}

export interface KeylessCheck {
  /** Regular expression the certificate identity (a workflow URI or an email address) must match. */
  identity: string;
  issuer: string;
}

async function loadSigstore(): Promise<SigstoreApi> {
  return (await import("sigstore")) as SigstoreApi;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Whether sigstore can get an OIDC token without a browser: `SIGSTORE_ID_TOKEN`, or a GitHub Actions job with `id-token: write`. */
export function hasAmbientIdentity(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SIGSTORE_ID_TOKEN) || Boolean(env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
}

function payloadOf(result: Partial<VerifyContractResult>): Buffer {
  // Sign exactly what the result file holds: the JSON round trip drops keys whose value is undefined.
  return Buffer.from(canonicalReceiptUtf8(JSON.parse(JSON.stringify(result)) as Partial<VerifyContractResult>), "utf8");
}

/** `--sign keyless`: the result with a Sigstore bundle as its signature. Exit 2 without an identity or when signing fails. */
export async function signVerifyResultKeyless(
  result: VerifyContractResult,
  api?: SigstoreApi,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VerifyContractResult> {
  if (!hasAmbientIdentity(env)) {
    throw new GantryUserError(
      "GXT_VERIFY_SIGN_NO_IDENTITY",
      "--sign keyless needs an OIDC identity: run in a GitHub Actions job with `permissions: id-token: write`, or set SIGSTORE_ID_TOKEN",
      undefined,
      2,
    );
  }
  const sigstore = api ?? (await loadSigstore());
  let bundle: Bundle;
  try {
    bundle = await sigstore.sign(payloadOf(result));
  } catch (err) {
    throw new GantryUserError("GXT_VERIFY_SIGN_FAILED", `keyless signing failed: ${message(err)}`, undefined, 2);
  }
  return { ...result, signature: { kind: "sigstore", payload_encoding: "canonical_json_utf8", bundle } };
}

/** The Rekor log index of a keyless signature, for the summary line. */
export function keylessLogIndex(signature: KeylessSignature): string | null {
  return signature.bundle.verificationMaterial.tlogEntries[0]?.logIndex ?? null;
}

/** `--certificate-identity`: a problem unless the result carries a keyless signature by a matching identity. */
export async function checkKeylessSignature(
  result: Partial<VerifyContractResult>,
  check: KeylessCheck,
  api?: SigstoreApi,
): Promise<{ problem: string | null; signer: string | null }> {
  const signature = result.signature;
  if (!signature) return { problem: "the result is not signed", signer: null };
  if (signature.kind !== "sigstore") return { problem: "the result is not signed keyless (Sigstore)", signer: null };
  const sigstore = api ?? (await loadSigstore());
  const identity: Record<string, string> = check.identity.includes("@") && !check.identity.includes("://")
    ? { certificateIdentityEmail: check.identity }
    : { certificateIdentityURI: check.identity };
  try {
    const signer = await sigstore.verify(signature.bundle, payloadOf(result), { ...identity, certificateIssuer: check.issuer });
    return { problem: null, signer: signer.identity?.subjectAlternativeName ?? check.identity };
  } catch (err) {
    return { problem: `the keyless signature does not verify for ${check.identity} from ${check.issuer} (${message(err)})`, signer: null };
  }
}
