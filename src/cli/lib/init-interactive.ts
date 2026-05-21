import * as p from "@clack/prompts";
import {
  INTEGRATION_IDE_KEYS,
  integrationWizardLabel,
  loadIntegrationCompat,
  type IntegrationIdeKey,
} from "./integration-compat.js";
import {
  defaultInitProfile,
  mergeInitProfile,
  type ArchitectureSourceKind,
  type InitProfile,
  type SkillsPreset,
} from "./init-profile.js";
import { defaultArchitectureLocation } from "./init-compose-arch-pointer.js";

export async function runInitInteractiveWizard(
  repoRoot: string,
  templatesRoot: string,
  partial: Partial<InitProfile>,
): Promise<InitProfile | null> {
  const compat = loadIntegrationCompat(templatesRoot);
  p.intro("gapman init — OpenGantry substrate bootstrap");

  const confirmRoot = await p.confirm({
    message: `Initialize OpenGantry in ${repoRoot}?`,
    initialValue: true,
  });
  if (p.isCancel(confirmRoot) || !confirmRoot) {
    p.cancel("init cancelled");
    return null;
  }

  const ideOptions = INTEGRATION_IDE_KEYS.map((value) => ({
    value,
    label: integrationWizardLabel(compat.integrations[value]),
  }));

  const base = defaultInitProfile();
  const selectedIdes = await p.multiselect({
    message: "Agent / IDE integrations to scaffold",
    options: ideOptions,
    initialValues: partial.ides ?? base.ides,
    required: true,
  });
  if (p.isCancel(selectedIdes)) {
    p.cancel("init cancelled");
    return null;
  }

  const docPath = await p.text({
    message: "Integrations documentation path (repo-relative)",
    initialValue: partial.integrationsDocPath ?? base.integrationsDocPath,
    validate: (v) => {
      if (!v.trim()) return "path required";
      if (v.includes("..")) return "path must not contain ..";
      return undefined;
    },
  });
  if (p.isCancel(docPath)) {
    p.cancel("init cancelled");
    return null;
  }

  const architectureSource = await p.select({
    message: "Code architecture documentation",
    options: [
      {
        value: "unset",
        label: "Not defined yet — agents ask before implementing (recommended)",
      },
      { value: "file", label: "Single markdown file (docs/ARCHITECTURE.md)" },
      { value: "directory", label: "Documentation folder" },
      { value: "external", label: "External wiki / tool (may need auth)" },
    ],
    initialValue: (partial.architectureSource ?? base.architectureSource) as ArchitectureSourceKind,
  });
  if (p.isCancel(architectureSource)) {
    p.cancel("init cancelled");
    return null;
  }

  let architectureLocation: string | undefined;
  let architectureAccessRequired: boolean | undefined;
  if (architectureSource !== "unset") {
    const locAnswer = await p.text({
      message: "Architecture location (repo path or URL)",
      initialValue:
        partial.architectureLocation ??
        defaultArchitectureLocation(architectureSource as ArchitectureSourceKind),
      validate: (v) => {
        if (!v.trim()) return "location required";
        if (architectureSource !== "external" && v.includes("..")) return "path must not contain ..";
        return undefined;
      },
    });
    if (p.isCancel(locAnswer)) {
      p.cancel("init cancelled");
      return null;
    }
    architectureLocation = locAnswer.trim();
  }

  if (architectureSource === "external") {
    const authAnswer = await p.confirm({
      message: "Does this external source require authentication?",
      initialValue: partial.architectureAccessRequired ?? true,
    });
    if (p.isCancel(authAnswer)) {
      p.cancel("init cancelled");
      return null;
    }
    architectureAccessRequired = authAnswer;
  }

  const skills = await p.select({
    message: "Skills preset",
    options: [
      { value: "minimal", label: "minimal (ui + logic)" },
      { value: "specimen", label: "specimen (ui, logic, gapman, substrate)" },
    ],
    initialValue: (partial.skillsPreset ?? base.skillsPreset) as SkillsPreset,
  });
  if (p.isCancel(skills)) {
    p.cancel("init cancelled");
    return null;
  }

  const gitHooks = await p.confirm({
    message: "Install .githooks (pre-push verify, post-checkout WORKER_LOG)?",
    initialValue: partial.gitHooks ?? base.gitHooks,
  });
  if (p.isCancel(gitHooks)) {
    p.cancel("init cancelled");
    return null;
  }

  const ciWorkflow = await p.confirm({
    message: "Install GitHub CI workflow (.github/workflows/gxt-validate.yml)?",
    initialValue: partial.ciWorkflow ?? base.ciWorkflow,
  });
  if (p.isCancel(ciWorkflow)) {
    p.cancel("init cancelled");
    return null;
  }

  const profile = mergeInitProfile(base, {
    ...partial,
    ides: selectedIdes as IntegrationIdeKey[],
    integrationsDocPath: docPath.trim(),
    architectureSource: architectureSource as ArchitectureSourceKind,
    architectureLocation,
    architectureAccessRequired,
    skillsPreset: skills as SkillsPreset,
    gitHooks,
    ciWorkflow,
  });

  p.note(
    [
      `IDEs: ${profile.ides.join(", ")}`,
      `Doc: ${profile.integrationsDocPath}`,
      `Architecture: ${profile.architectureSource}${profile.architectureLocation ? ` → ${profile.architectureLocation}` : ""}`,
      `Skills: ${profile.skillsPreset}`,
      `Hooks: ${profile.gitHooks ? "yes" : "no"}`,
      `CI: ${profile.ciWorkflow ? "yes" : "no"}`,
    ].join("\n"),
    "Plan",
  );

  const go = await p.confirm({ message: "Apply this init plan?", initialValue: true });
  if (p.isCancel(go) || !go) {
    p.cancel("init cancelled");
    return null;
  }

  p.outro("Scaffolding…");
  return profile;
}

export function canPromptInitOverwrite(options: { dryRun?: boolean; force?: boolean }): boolean {
  return (
    options.dryRun !== true &&
    options.force !== true &&
    process.stdout.isTTY === true &&
    process.stdin.isTTY === true
  );
}

export async function promptOverwriteManagedAssets(conflicts: string[]): Promise<boolean | null> {
  p.log.warning("Some managed files already exist and differ from templates:");
  for (const rel of conflicts) {
    p.log.message(`  ${rel}`);
  }
  const answer = await p.confirm({
    message: "Overwrite these files?",
    initialValue: false,
  });
  if (p.isCancel(answer)) {
    p.cancel("init cancelled");
    return null;
  }
  return answer;
}
