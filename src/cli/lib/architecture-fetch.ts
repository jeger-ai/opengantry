import { CLI_NAME } from "./constants.js";
import {
  loadArchitectureCredential,
  type ArchitectureCredentialRecord,
} from "./architecture-credential.js";
import {
  loadArchitecturePointer,
  resolveArchitectureDiscoverySkill,
  type ArchitecturePointer,
} from "./architecture-pointer.js";

export type ArchFetchStatus = "fetched" | "fallback";

export interface ArchFetchResult {
  status: ArchFetchStatus;
  url?: string;
  body?: string;
  content_type?: string;
  status_code?: number;
  message: string;
  discovery_skill: string;
}

export type HttpFetcher = (
  url: string,
  init?: RequestInit,
) => Promise<{ status: number; body: string; contentType: string | null }>;

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export const defaultHttpFetcher: HttpFetcher = async (url, init) => {
  const response = await fetch(url, init);
  const buf = await response.arrayBuffer();
  if (buf.byteLength > DEFAULT_MAX_BYTES) {
    throw new Error(`response exceeds ${String(DEFAULT_MAX_BYTES)} byte limit`);
  }
  const contentType = response.headers.get("content-type");
  return {
    status: response.status,
    body: new TextDecoder("utf-8", { fatal: false }).decode(buf),
    contentType,
  };
};

function isHttpUrl(location: string): boolean {
  return /^https?:\/\//i.test(location.trim());
}

export function buildAuthHeaders(credential: ArchitectureCredentialRecord): Record<string, string> {
  switch (credential.kind) {
    case "bearer":
      return { Authorization: `Bearer ${credential.values.token}` };
    case "api_key": {
      const header = credential.values.header_name ?? "X-API-Key";
      return { [header]: credential.values.api_key };
    }
    case "basic": {
      const encoded = Buffer.from(
        `${credential.values.username}:${credential.values.password}`,
        "utf8",
      ).toString("base64");
      return { Authorization: `Basic ${encoded}` };
    }
    case "custom":
      return { ...credential.values };
    default:
      return {};
  }
}

function fallbackResult(pointer: ArchitecturePointer, message: string): ArchFetchResult {
  const discovery = resolveArchitectureDiscoverySkill(pointer);
  return {
    status: "fallback",
    message: `${message} Follow ${discovery} for manual discovery.`,
    discovery_skill: discovery,
  };
}

export interface FetchExternalArchitectureOptions {
  repoRoot: string;
  fetcher?: HttpFetcher;
}

export async function fetchExternalArchitecture(
  options: FetchExternalArchitectureOptions,
): Promise<ArchFetchResult> {
  const pointer = loadArchitecturePointer(options.repoRoot);
  const fetcher = options.fetcher ?? defaultHttpFetcher;

  if (pointer.kind !== "external") {
    return fallbackResult(
      pointer,
      `${CLI_NAME} arch fetch: pointer kind is ${pointer.kind}, not external.`,
    );
  }

  if (!isHttpUrl(pointer.location)) {
    return fallbackResult(
      pointer,
      `${CLI_NAME} arch fetch: external location is not an http(s) URL (${pointer.location}).`,
    );
  }

  const headers: Record<string, string> = { Accept: "text/plain, text/html, application/json" };
  const slot = pointer.access?.credential_slot;
  if (slot) {
    const cred = loadArchitectureCredential(options.repoRoot, slot);
    if (!cred) {
      return fallbackResult(
        pointer,
        `${CLI_NAME} arch fetch: credential slot ${slot} not configured — run gantry arch cred set.`,
      );
    }
    Object.assign(headers, buildAuthHeaders(cred));
  } else if (pointer.access?.required) {
    return fallbackResult(
      pointer,
      `${CLI_NAME} arch fetch: access.required but no credential_slot on pointer.`,
    );
  }

  try {
    const response = await fetcher(pointer.location, { headers, method: "GET" });
    if (response.status < 200 || response.status >= 300) {
      return fallbackResult(
        pointer,
        `${CLI_NAME} arch fetch: HTTP ${String(response.status)} from ${pointer.location}.`,
      );
    }
    return {
      status: "fetched",
      url: pointer.location,
      body: response.body,
      content_type: response.contentType ?? undefined,
      status_code: response.status,
      message: `Fetched ${pointer.location}`,
      discovery_skill: resolveArchitectureDiscoverySkill(pointer),
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return fallbackResult(pointer, `${CLI_NAME} arch fetch failed: ${detail}.`);
  }
}
