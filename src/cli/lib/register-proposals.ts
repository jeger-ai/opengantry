import path from "node:path";
import type { FolderSignature } from "./ast-discovery.js";

export interface SkillProposal {
  skill_key: string;
  tmvc_roots: string[];
  desc: string;
  suggested_forbidden_imports: string[];
  signature: FolderSignature;
}

export function suggestSkillKeyFromFolder(folderRel: string): string {
  const base = path.basename(folderRel.replace(/\/$/, ""));
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "skill";
}

export function buildSkillProposal(
  signature: FolderSignature,
  skillKey: string,
  httpLikeImports = ["express", "axios", "node-fetch", "@nestjs/common"],
): SkillProposal {
  const externalPackages = signature.imports.filter(
    (i) => !i.startsWith(".") && !i.startsWith("/") && !i.startsWith("@/"),
  );
  const hasHttp = externalPackages.some((p) =>
    httpLikeImports.some((h) => p === h || p.startsWith(`${h}/`)),
  );
  const suggestedForbidden = hasHttp
    ? []
    : httpLikeImports.filter((h) => !externalPackages.some((p) => p === h || p.startsWith(`${h}/`)));

  return {
    skill_key: skillKey,
    tmvc_roots: [`${signature.folderRel}/`],
    desc: `Auto-discovered skill for ${signature.folderRel} (${String(signature.fileCount)} TS files)`,
    suggested_forbidden_imports: suggestedForbidden,
    signature,
  };
}

export function formatProposalJson(proposal: SkillProposal): string {
  return JSON.stringify(proposal, null, 2);
}

export function formatProposalHuman(proposal: SkillProposal): string {
  const lines = [
    `Skill proposal: ${proposal.skill_key}`,
    `  tmvc_roots: ${proposal.tmvc_roots.join(", ")}`,
    `  desc: ${proposal.desc}`,
    `  imports (${String(proposal.signature.imports.length)}): ${proposal.signature.imports.slice(0, 8).join(", ")}${proposal.signature.imports.length > 8 ? "…" : ""}`,
    `  exports (${String(proposal.signature.exports.length)}): ${proposal.signature.exports.slice(0, 8).join(", ")}${proposal.signature.exports.length > 8 ? "…" : ""}`,
  ];
  if (proposal.suggested_forbidden_imports.length > 0) {
    lines.push(`  suggested forbidden imports: ${proposal.suggested_forbidden_imports.join(", ")}`);
  }
  lines.push("");
  lines.push(
    "Teacher: review proposal, add skill to MANIFEST.json (Rule 4.4), then gapman legislate with --skill-key.",
  );
  return lines.join("\n");
}
