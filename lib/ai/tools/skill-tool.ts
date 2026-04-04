import { tool, jsonSchema } from "ai";
import path from "path";
import { db } from "@/lib/db/sqlite-client";
import { scheduledTasks } from "@/lib/db/sqlite-schedule-schema";
import { getScheduler } from "@/lib/scheduler/scheduler-service";
import { renderSkillPrompt } from "@/lib/skills/runtime";
import { trackSkillTelemetryEvent } from "@/lib/skills/telemetry";
import {
  assertCharacterOwnership,
  copySkill,
  createSkill,
  updateSkill,
  updateSkillRunStats,
} from "@/lib/skills/queries";
import { getBundledSkillRootPath } from "@/lib/skills/catalog/bundled-loader";
import {
  listRuntimeSkills,
  resolveRuntimeSkill,
  type RuntimeSkill,
} from "@/lib/skills/runtime-catalog";
import {
  applyFileEdits,
  generateBeforeAfterDiff,
  type FileEdit,
} from "@/lib/ai/filesystem";
import { createPluginSkillRevision } from "@/lib/plugins/skill-revision-queries";
import type {
  SkillInputParameter,
  SkillStatus,
  SkillUpdateResult,
} from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SkillAction =
  | "list"
  | "inspect"
  | "run"
  | "create"
  | "patch"
  | "replace"
  | "metadata"
  | "copy"
  | "archive";

interface SkillInput {
  action?: SkillAction;
  skillId?: string;
  skillName?: string;
  source?: "db" | "plugin";

  // list
  query?: string;
  limit?: number;

  // inspect
  includeContentWithLineNumbers?: boolean;

  // run
  parameters?: Record<string, string | number | boolean | null>;
  schedule?: {
    name: string;
    scheduleType: "cron" | "interval" | "once";
    cronExpression?: string;
    intervalMinutes?: number;
    scheduledAt?: string;
    timezone?: string;
    deliveryMethod?: "session" | "channel" | "email" | "slack" | "webhook";
    deliveryConfig?: Record<string, unknown>;
    createNewSessionPerRun?: boolean;
  };

  // mutation shared
  expectedVersion?: number;
  expectedVersionRef?: number;
  changeReason?: string;
  dryRun?: boolean;
  skipVersionBump?: boolean;

  // create / metadata / replace
  name?: string;
  description?: string | null;
  icon?: string | null;
  promptTemplate?: string;
  content?: string;
  inputParameters?: SkillInputParameter[];
  toolHints?: string[];
  triggerExamples?: string[];
  category?: string;
  status?: SkillStatus;

  // patch
  oldString?: string;
  newString?: string;
  edits?: FileEdit[];

  // copy
  targetCharacterId?: string;
  targetName?: string;
}

interface SkillToolOptions {
  sessionId: string;
  userId: string;
  characterId: string;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const schema = jsonSchema<SkillInput>({
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "list",
        "inspect",
        "run",
        "create",
        "patch",
        "replace",
        "metadata",
        "copy",
        "archive",
      ],
    },
    skillId: { type: "string" },
    skillName: { type: "string" },
    source: { type: "string", enum: ["db", "plugin"] },
    query: { type: "string" },
    limit: { type: "number", minimum: 1, maximum: 200 },
    includeContentWithLineNumbers: { type: "boolean" },
    parameters: { type: "object", additionalProperties: true },
    schedule: { type: "object", additionalProperties: true },
    expectedVersion: { type: "number" },
    expectedVersionRef: { type: "number" },
    changeReason: { type: "string", maxLength: 300 },
    dryRun: { type: "boolean" },
    skipVersionBump: { type: "boolean" },
    name: { type: "string", minLength: 1, maxLength: 120 },
    description: { type: ["string", "null"], maxLength: 1000 },
    icon: { type: ["string", "null"], maxLength: 20 },
    promptTemplate: { type: "string", minLength: 1, maxLength: 400000 },
    content: { type: "string", minLength: 1, maxLength: 400000 },
    inputParameters: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
    toolHints: { type: "array", items: { type: "string" } },
    triggerExamples: { type: "array", items: { type: "string" } },
    category: { type: "string", minLength: 1, maxLength: 80 },
    status: { type: "string", enum: ["draft", "active", "archived"] },
    oldString: { type: "string" },
    newString: { type: "string" },
    edits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          oldString: { type: "string" },
          newString: { type: "string" },
        },
        required: ["oldString", "newString"],
      },
    },
    targetCharacterId: { type: "string" },
    targetName: { type: "string", minLength: 1, maxLength: 120 },
  },
  additionalProperties: false,
});

// ---------------------------------------------------------------------------
// Resolution & rendering helpers
// ---------------------------------------------------------------------------

function withLineNumbers(text: string): string {
  return text
    .split("\n")
    .map((line, index) => `${index + 1} | ${line}`)
    .join("\n");
}

function renderPluginSkillTemplate(
  content: string,
  parameters: Record<string, string | number | boolean | null>,
): {
  renderedPrompt: string;
  missingParameters: string[];
  resolvedParameters: Record<string, string | number | boolean | null>;
} {
  const resolvedParameters: Record<string, string | number | boolean | null> =
    {};
  const missing = new Set<string>();
  const pattern = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

  let rendered = content.replace(pattern, (_full, key: string) => {
    if (Object.prototype.hasOwnProperty.call(parameters, key)) {
      const value = parameters[key];
      resolvedParameters[key] = value;
      return value === null ? "" : String(value);
    }
    missing.add(key);
    return `{{${key}}}`;
  });

  if (!rendered.endsWith("\n") && content.endsWith("\n")) {
    rendered += "\n";
  }

  return {
    renderedPrompt: rendered,
    missingParameters: Array.from(missing),
    resolvedParameters,
  };
}

function injectPluginRoot(
  renderedPrompt: string,
  pluginCachePath?: string,
): string {
  if (!pluginCachePath) return renderedPrompt;
  const pluginRoot = path.resolve(pluginCachePath);
  return renderedPrompt.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot);
}

function injectSkillRoot(
  renderedPrompt: string,
  catalogId: string | null | undefined,
): string {
  if (!catalogId) return renderedPrompt;
  if (!renderedPrompt.includes("SELENE_SKILL_ROOT")) return renderedPrompt;
  const skillRoot = getBundledSkillRootPath(catalogId);
  return renderedPrompt.replace(/\$\{SELENE_SKILL_ROOT\}/g, skillRoot);
}

function normalizeAction(input: SkillInput): SkillAction {
  if (input.action) return input.action;
  if (!input.skillId && !input.skillName) return "list";
  return "run";
}

function toSkillListItem(skill: RuntimeSkill) {
  return {
    skillId: skill.canonicalId,
    source: skill.source,
    name: skill.name,
    displayName: skill.displayName,
    description: skill.description,
    modelInvocationAllowed: skill.modelInvocationAllowed,
    versionRef: skill.versionRef,
    ...(skill.source === "db"
      ? {
          runCount: skill.dbSkill.runCount,
          successCount: skill.dbSkill.successCount,
          status: skill.dbSkill.status,
        }
      : {
          pluginId: skill.pluginId,
          pluginName: skill.pluginName,
          pluginVersion: skill.pluginVersion,
          namespacedName: skill.namespacedName,
          disableModelInvocation: !skill.modelInvocationAllowed,
        }),
  };
}

function getSkillContent(skill: RuntimeSkill): string {
  return skill.source === "db" ? skill.dbSkill.promptTemplate : skill.content;
}

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

function getEffectiveExpectedVersion(
  input: SkillInput,
): number | undefined {
  return input.expectedVersionRef ?? input.expectedVersion;
}

function checkUpdateResult(
  result: SkillUpdateResult,
  action: SkillAction,
):
  | {
      success: false;
      action: SkillAction;
      error: string;
      stale?: boolean;
      staleVersion?: number;
      warnings?: string[];
    }
  | null {
  if (!result.skill) {
    return { success: false, action, error: "Skill not found." };
  }
  if (result.stale) {
    return {
      success: false,
      action,
      stale: true,
      staleVersion: result.staleVersion,
      error: "Skill was updated elsewhere. Refresh and retry.",
      warnings: result.warnings,
    };
  }
  return null;
}

function toEdits(input: SkillInput): FileEdit[] {
  if (Array.isArray(input.edits) && input.edits.length > 0) {
    return input.edits;
  }
  if (input.oldString !== undefined && input.newString !== undefined) {
    return [{ oldString: input.oldString, newString: input.newString }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleList(input: SkillInput, options: SkillToolOptions) {
  const skills = await listRuntimeSkills({
    userId: options.userId,
    characterId: options.characterId,
    source: input.source,
    query: input.query,
    limit: input.limit ?? 100,
  });

  return {
    success: true,
    action: "list" as const,
    count: skills.length,
    skills: skills.map(toSkillListItem),
    message:
      "Use skill action='inspect' with skillId to view full skill content, or action='run' to render runnable instructions.",
  };
}

async function handleInspect(input: SkillInput, options: SkillToolOptions) {
  const resolution = await resolveRuntimeSkill({
    userId: options.userId,
    characterId: options.characterId,
    skillId: input.skillId,
    skillName: input.skillName,
    source: input.source,
  });

  if (!resolution.skill) {
    return {
      success: false,
      action: "inspect" as const,
      error: resolution.error || "Skill not found.",
      matches: resolution.matches,
    };
  }

  const content = getSkillContent(resolution.skill);
  return {
    success: true,
    action: "inspect" as const,
    skill: toSkillListItem(resolution.skill),
    content,
    ...(input.includeContentWithLineNumbers !== false
      ? { contentWithLineNumbers: withLineNumbers(content) }
      : {}),
  };
}

async function handleRun(input: SkillInput, options: SkillToolOptions) {
  const action = "run" as const;
  const resolution = await resolveRuntimeSkill({
    userId: options.userId,
    characterId: options.characterId,
    skillId: input.skillId,
    skillName: input.skillName,
    source: input.source,
  });

  if (!resolution.skill) {
    return {
      success: false,
      action,
      error: resolution.error || "Skill not found.",
      matches: resolution.matches,
    };
  }

  const runtimeSkill = resolution.skill;

  if (!runtimeSkill.modelInvocationAllowed) {
    return {
      success: false,
      action,
      error:
        "This plugin skill has disable-model-invocation enabled and cannot be executed by the model.",
      skill: toSkillListItem(runtimeSkill),
    };
  }

  const parameters = input.parameters || {};
  const renderResult =
    runtimeSkill.source === "db"
      ? (() => {
          const dbRender = renderSkillPrompt(runtimeSkill.dbSkill, parameters);
          return {
            renderedPrompt: injectSkillRoot(
              dbRender.prompt,
              runtimeSkill.dbSkill.catalogId,
            ),
            missingParameters: dbRender.missingParameters,
            resolvedParameters: dbRender.resolvedParameters,
          };
        })()
      : (() => {
          const pluginRender = renderPluginSkillTemplate(
            runtimeSkill.content,
            parameters,
          );
          return {
            ...pluginRender,
            renderedPrompt: injectPluginRoot(
              pluginRender.renderedPrompt,
              runtimeSkill.pluginCachePath,
            ),
          };
        })();

  if (renderResult.missingParameters.length > 0) {
    return {
      success: false,
      action,
      error: "Missing required parameters",
      missingParameters: renderResult.missingParameters,
      skill: toSkillListItem(runtimeSkill),
    };
  }

  await Promise.all([
    runtimeSkill.source === "db"
      ? updateSkillRunStats(runtimeSkill.dbSkill.id, options.userId, true)
      : Promise.resolve(),
    trackSkillTelemetryEvent({
      userId: options.userId,
      eventType: "skill_manual_run",
      skillId:
        runtimeSkill.source === "db" ? runtimeSkill.dbSkill.id : undefined,
      characterId: options.characterId,
      metadata: {
        via: "skillTool",
        source: runtimeSkill.source,
        canonicalId: runtimeSkill.canonicalId,
      },
    }),
  ]);

  const toolHints =
    runtimeSkill.source === "db" ? runtimeSkill.dbSkill.toolHints : [];

  let schedule = null;
  if (input.schedule) {
    try {
      const [created] = await db
        .insert(scheduledTasks)
        .values({
          userId: options.userId,
          characterId: options.characterId,
          skillId:
            runtimeSkill.source === "db" ? runtimeSkill.dbSkill.id : null,
          name: input.schedule.name,
          scheduleType: input.schedule.scheduleType,
          cronExpression: input.schedule.cronExpression || null,
          intervalMinutes: input.schedule.intervalMinutes || null,
          scheduledAt: input.schedule.scheduledAt || null,
          timezone: input.schedule.timezone || "UTC",
          initialPrompt: renderResult.renderedPrompt,
          promptVariables: renderResult.resolvedParameters,
          enabled: true,
          status: "active",
          resultSessionId: options.sessionId,
          deliveryMethod: input.schedule.deliveryMethod || "session",
          deliveryConfig: input.schedule.deliveryConfig || {},
          createNewSessionPerRun: input.schedule.createNewSessionPerRun ?? false,
        })
        .returning();
      await getScheduler().reloadSchedule(created.id);
      schedule = created;
    } catch (error) {
      return {
        success: true,
        action,
        skill: toSkillListItem(runtimeSkill),
        renderedPrompt: renderResult.renderedPrompt,
        resolvedParameters: renderResult.resolvedParameters,
        toolHints,
        scheduleError: `Failed to create schedule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return {
    success: true,
    action,
    skill: toSkillListItem(runtimeSkill),
    renderedPrompt: renderResult.renderedPrompt,
    resolvedParameters: renderResult.resolvedParameters,
    toolHints,
    schedule,
  };
}

async function handleCreate(input: SkillInput, options: SkillToolOptions) {
  const action = "create" as const;

  if (!input.name || !(input.promptTemplate || input.content)) {
    return {
      success: false,
      action,
      error: "create requires name and promptTemplate (or content).",
    };
  }

  const ownsCharacter = await assertCharacterOwnership(
    options.characterId,
    options.userId,
  );
  if (!ownsCharacter) {
    return {
      success: false,
      action,
      error: "Character not found or not owned by user.",
    };
  }

  const skill = await createSkill({
    userId: options.userId,
    characterId: options.characterId,
    name: input.name,
    description: input.description,
    icon: input.icon,
    promptTemplate: input.promptTemplate || input.content || "",
    inputParameters: input.inputParameters || [],
    toolHints: input.toolHints || [],
    triggerExamples: input.triggerExamples || [],
    category: input.category || "general",
    sourceType: "manual",
    sourceSessionId: null,
    status: input.status || "active",
  });

  return {
    success: true,
    action,
    skill,
    message: `Created skill "${skill.name}".`,
  };
}

async function handleCopy(input: SkillInput, options: SkillToolOptions) {
  const action = "copy" as const;

  if (!input.targetCharacterId) {
    return { success: false, action, error: "copy requires targetCharacterId." };
  }
  if (!input.skillId && !input.skillName) {
    return { success: false, action, error: "copy requires skillId or skillName." };
  }

  const resolution = await resolveRuntimeSkill({
    userId: options.userId,
    characterId: options.characterId,
    skillId: input.skillId,
    skillName: input.skillName,
    source: "db",
  });
  if (!resolution.skill || resolution.skill.source !== "db") {
    return {
      success: false,
      action,
      error: resolution.error || "DB skill not found for copy.",
      matches: resolution.matches,
    };
  }

  const skill = await copySkill(
    {
      skillId: resolution.skill.dbSkill.id,
      targetCharacterId: input.targetCharacterId,
      targetName: input.targetName,
    },
    options.userId,
  );

  if (!skill) {
    return {
      success: false,
      action,
      error: "Copy failed. Skill not found or target agent not owned.",
    };
  }

  return {
    success: true,
    action,
    skill,
    message: `Copied skill to target agent as "${skill.name}".`,
  };
}

async function handleArchive(
  input: SkillInput,
  options: SkillToolOptions,
  skill: RuntimeSkill,
) {
  const action = "archive" as const;
  const expectedVersion = getEffectiveExpectedVersion(input);

  if (skill.source !== "db") {
    return {
      success: false,
      action,
      error: "archive is currently supported for DB skills only.",
    };
  }

  const archived = await updateSkill(skill.dbSkill.id, options.userId, {
    status: "archived",
    expectedVersion,
    changeReason: input.changeReason || "archived via skill tool",
  });

  const archiveError = checkUpdateResult(archived, action);
  if (archiveError) return archiveError;

  return {
    success: true,
    action,
    skill: archived.skill,
    changedFields: archived.changedFields,
    warnings: archived.warnings,
    message: `Archived skill "${archived.skill!.name}".`,
  };
}

async function handleMetadata(
  input: SkillInput,
  options: SkillToolOptions,
  skill: RuntimeSkill,
) {
  const action = "metadata" as const;
  const expectedVersion = getEffectiveExpectedVersion(input);

  if (skill.source !== "db") {
    return {
      success: false,
      action,
      error:
        "metadata updates are currently supported for DB skills only. Use patch/replace for plugin skill content.",
    };
  }

  const updated = await updateSkill(skill.dbSkill.id, options.userId, {
    name: input.name,
    description: input.description,
    icon: input.icon,
    inputParameters: input.inputParameters,
    toolHints: input.toolHints,
    triggerExamples: input.triggerExamples,
    category: input.category,
    status: input.status,
    expectedVersion,
    changeReason: input.changeReason,
    skipVersionBump: input.skipVersionBump,
  });

  const metadataError = checkUpdateResult(updated, action);
  if (metadataError) return metadataError;

  return {
    success: true,
    action,
    skill: updated.skill,
    changedFields: updated.changedFields,
    warnings: updated.warnings,
    noChanges: updated.noChanges,
  };
}

async function handleReplace(
  input: SkillInput,
  options: SkillToolOptions,
  skill: RuntimeSkill,
) {
  const action = "replace" as const;
  const expectedVersion = getEffectiveExpectedVersion(input);
  const replacement = input.content ?? input.promptTemplate;

  if (!replacement) {
    return {
      success: false,
      action,
      error: "replace requires content or promptTemplate.",
    };
  }

  if (input.dryRun) {
    const before =
      skill.source === "db" ? skill.dbSkill.promptTemplate : skill.content;
    const diff = generateBeforeAfterDiff(
      `${skill.displayName}.skill.md`,
      before,
      replacement,
    );
    return {
      success: true,
      action,
      dryRun: true,
      skillId: skill.canonicalId,
      diff,
      linesChanged: Math.max(
        before.split("\n").length,
        replacement.split("\n").length,
      ),
      message: "[Dry Run] Replace preview generated.",
    };
  }

  if (skill.source === "db") {
    const updated = await updateSkill(skill.dbSkill.id, options.userId, {
      promptTemplate: replacement,
      expectedVersion,
      changeReason: input.changeReason || "replace via skill tool",
      skipVersionBump: input.skipVersionBump,
    });

    const replaceError = checkUpdateResult(updated, action);
    if (replaceError) return replaceError;

    const diff = generateBeforeAfterDiff(
      `${skill.displayName}.skill.md`,
      skill.dbSkill.promptTemplate,
      replacement,
    );

    return {
      success: true,
      action,
      skill: updated.skill,
      changedFields: updated.changedFields,
      warnings: updated.warnings,
      diff,
      message: `Replaced content for "${updated.skill!.name}".`,
    };
  }

  const revision = await createPluginSkillRevision({
    userId: options.userId,
    pluginId: skill.pluginId,
    namespacedName: skill.namespacedName,
    content: replacement,
    expectedVersion,
    changeReason: input.changeReason || "replace via skill tool",
  });

  if (!revision.success) {
    return {
      success: false,
      action,
      stale: revision.stale,
      staleVersion: revision.staleVersion,
      error: revision.error || "Failed to replace plugin skill content.",
    };
  }

  const diff = generateBeforeAfterDiff(
    `${skill.displayName}.skill.md`,
    skill.content,
    replacement,
  );

  return {
    success: true,
    action,
    source: "plugin",
    skillId: skill.canonicalId,
    revision: revision.revision,
    diff,
    message: `Replaced plugin skill content for "${skill.displayName}".`,
  };
}

async function handlePatch(
  input: SkillInput,
  options: SkillToolOptions,
  skill: RuntimeSkill,
) {
  const action = "patch" as const;
  const expectedVersion = getEffectiveExpectedVersion(input);
  const edits = toEdits(input);

  if (edits.length === 0) {
    return {
      success: false,
      action,
      error: "patch requires edits or oldString/newString.",
    };
  }

  const before =
    skill.source === "db" ? skill.dbSkill.promptTemplate : skill.content;
  const patchResult = applyFileEdits(before, edits);
  if (!patchResult.success) {
    return {
      success: false,
      action,
      error: patchResult.error || "Failed to apply patch.",
    };
  }

  const diff = generateBeforeAfterDiff(
    `${skill.displayName}.skill.md`,
    before,
    patchResult.newContent,
  );

  if (input.dryRun) {
    return {
      success: true,
      action,
      dryRun: true,
      skillId: skill.canonicalId,
      diff,
      linesChanged: patchResult.linesChanged,
      message: "[Dry Run] Patch preview generated.",
    };
  }

  if (skill.source === "db") {
    const updated = await updateSkill(skill.dbSkill.id, options.userId, {
      promptTemplate: patchResult.newContent,
      expectedVersion,
      changeReason: input.changeReason || "patch via skill tool",
      skipVersionBump: input.skipVersionBump,
    });

    const patchError = checkUpdateResult(updated, action);
    if (patchError) return patchError;

    return {
      success: true,
      action,
      skill: updated.skill,
      changedFields: updated.changedFields,
      warnings: updated.warnings,
      diff,
      linesChanged: patchResult.linesChanged,
      message: `Patched "${updated.skill!.name}".`,
    };
  }

  const revision = await createPluginSkillRevision({
    userId: options.userId,
    pluginId: skill.pluginId,
    namespacedName: skill.namespacedName,
    content: patchResult.newContent,
    expectedVersion,
    changeReason: input.changeReason || "patch via skill tool",
  });

  if (!revision.success) {
    return {
      success: false,
      action,
      stale: revision.stale,
      staleVersion: revision.staleVersion,
      error: revision.error || "Failed to patch plugin skill content.",
    };
  }

  return {
    success: true,
    action,
    source: "plugin",
    skillId: skill.canonicalId,
    revision: revision.revision,
    diff,
    linesChanged: patchResult.linesChanged,
    message: `Patched plugin skill "${skill.displayName}".`,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSkillTool(options: SkillToolOptions) {
  return tool({
    description:
      "Unified skill tool. list/inspect/run for discovery and execution; create/patch/replace/metadata/copy/archive for mutations.",
    inputSchema: schema,
    execute: async (input: SkillInput) => {
      if (!options.characterId) {
        return {
          success: false,
          error: "No active character selected for skill operations.",
        };
      }

      const action = normalizeAction(input);

      // --- Read actions ---
      if (action === "list") return handleList(input, options);
      if (action === "inspect") return handleInspect(input, options);
      if (action === "run") return handleRun(input, options);

      // --- Create / Copy (don't need pre-resolved skill) ---
      if (action === "create") return handleCreate(input, options);
      if (action === "copy") return handleCopy(input, options);

      // --- Mutation actions that require resolving the skill first ---
      if (!input.skillId && !input.skillName) {
        return { success: false, action, error: "Provide skillId or skillName." };
      }

      const resolved = await resolveRuntimeSkill({
        userId: options.userId,
        characterId: options.characterId,
        skillId: input.skillId,
        skillName: input.skillName,
        source: input.source,
      });

      if (!resolved.skill) {
        return {
          success: false,
          action,
          error: resolved.error || "Skill not found.",
          matches: resolved.matches,
        };
      }

      const skill = resolved.skill;

      if (action === "archive") return handleArchive(input, options, skill);
      if (action === "metadata") return handleMetadata(input, options, skill);
      if (action === "replace") return handleReplace(input, options, skill);
      if (action === "patch") return handlePatch(input, options, skill);

      return { success: false, action, error: `Unsupported action: ${action}` };
    },
  });
}
