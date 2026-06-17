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
import { defaultArchitectureLocation } from "./init-compose.js";

function wizardCancelled<T>(value: T | symbol): value is symbol {
  return p.isCancel(value);
}

async function promptInitIntegrations(
  repoRoot: string,
  partial: Partial<InitProfile>,
  base: InitProfile,
  compat: ReturnType<typeof loadIntegrationCompat>,
): Promise<{ ides: IntegrationIdeKey[]; integrationsDocPath: string } | null> {
  const confirmRoot = await p.confirm({
    message: `Initialize OpenGantry in ${repoRoot}?`,
    initialValue: true,
  });
  if (wizardCancelled(confirmRoot) || !confirmRoot) {
    p.cancel("init cancelled");
    return null;
  }

  const ideOptions = INTEGRATION_IDE_KEYS.map((value) => ({
    value,
    label: integrationWizardLabel(compat.integrations[value]),
  }));
  const selectedIdes = await p.multiselect({
    message: "Agent / IDE integrations to scaffold",
    options: ideOptions,
    initialValues: partial.ides ?? base.ides,
    required: true,
  });
  if (wizardCancelled(selectedIdes)) {
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
  if (wizardCancelled(docPath)) {
    p.cancel("init cancelled");
    return null;
  }

  return { ides: selectedIdes as IntegrationIdeKey[], integrationsDocPath: docPath.trim() };
}

async function promptInitArchitecture(
  partial: Partial<InitProfile>,
  base: InitProfile,
): Promise<{
  architectureSource: ArchitectureSourceKind;
  architectureLocation?: string;
  architectureAccessRequired?: boolean;
} | null> {
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
  if (wizardCancelled(architectureSource)) {
    p.cancel("init cancelled");
    return null;
  }

  let architectureLocation: string | undefined;
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
    if (wizardCancelled(locAnswer)) {
      p.cancel("init cancelled");
      return null;
    }
    architectureLocation = locAnswer.trim();
  }

  let architectureAccessRequired: boolean | undefined;
  if (architectureSource === "external") {
    const authAnswer = await p.confirm({
      message: "Does this external source require authentication?",
      initialValue: partial.architectureAccessRequired ?? true,
    });
    if (wizardCancelled(authAnswer)) {
      p.cancel("init cancelled");
      return null;
    }
    architectureAccessRequired = authAnswer;
  }

  return {
    architectureSource: architectureSource as ArchitectureSourceKind,
    architectureLocation,
    architectureAccessRequired,
  };
}

async function promptInitInfrastructure(
  partial: Partial<InitProfile>,
  base: InitProfile,
): Promise<{ skillsPreset: SkillsPreset; gitHooks: boolean; ciWorkflow: boolean } | null> {
  const skills = await p.select({
    message: "Skills preset",
    options: [
      { value: "minimal", label: "minimal (ui + logic)" },
      { value: "specimen", label: "specimen (ui, logic, gapman, substrate)" },
    ],
    initialValue: (partial.skillsPreset ?? base.skillsPreset) as SkillsPreset,
  });
  if (wizardCancelled(skills)) {
    p.cancel("init cancelled");
    return null;
  }

  const gitHooks = await p.confirm({
    message: "Install .githooks (pre-push verify, post-checkout WORKER_LOG)?",
    initialValue: partial.gitHooks ?? base.gitHooks,
  });
  if (wizardCancelled(gitHooks)) {
    p.cancel("init cancelled");
    return null;
  }

  const ciWorkflow = await p.confirm({
    message: "Install GitHub CI workflow (.github/workflows/gxt-validate.yml)?",
    initialValue: partial.ciWorkflow ?? base.ciWorkflow,
  });
  if (wizardCancelled(ciWorkflow)) {
    p.cancel("init cancelled");
    return null;
  }

  return {
    skillsPreset: skills as SkillsPreset,
    gitHooks,
    ciWorkflow,
  };
}

export async function runInitInteractiveWizard(
  repoRoot: string,
  templatesRoot: string,
  partial: Partial<InitProfile>,
): Promise<InitProfile | null> {
  const compat = loadIntegrationCompat(templatesRoot);
  p.intro("gapman init — OpenGantry substrate bootstrap");

  const base = defaultInitProfile();
  const integrations = await promptInitIntegrations(repoRoot, partial, base, compat);
  if (!integrations) return null;

  const architecture = await promptInitArchitecture(partial, base);
  if (!architecture) return null;

  const infrastructure = await promptInitInfrastructure(partial, base);
  if (!infrastructure) return null;

  const profile = mergeInitProfile(base, {
    ...partial,
    ...integrations,
    ...architecture,
    ...infrastructure,
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
  if (wizardCancelled(go) || !go) {
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
