/**
 * Design Gallery Tool
 *
 * Lets agents save, search, inspect, favorite, reuse, and delete saved design
 * components. This wraps the SQLite-backed gallery service so agents can turn
 * generated workspace components into reusable assets without direct DB access.
 */

import { jsonSchema, tool } from "ai";
import { withToolLogging } from "@/lib/ai/tool-registry/logging";
import {
  deleteGalleryComponentForUser,
  getGalleryComponentForUser,
  listGalleryComponents,
  markGalleryComponentUsed,
  saveDesignComponentWithPreview,
  toggleGalleryFavoriteForUser,
  createProject,
  updateProject,
  deleteProject,
  listProjects,
  getProject,
  addComponentToProject,
  removeComponentFromProject,
  archiveProject,
  type DesignGalleryItem,
  type DesignProjectRow,
  type DesignProjectWithComponents,
} from "@/lib/design/gallery";
import { resolveComponentCode } from "@/lib/ai/tools/design-workspace-tool";

interface DesignGalleryToolOptions {
  sessionId?: string;
  userId?: string;
  characterId?: string;
}

type DesignGalleryAction =
  | "save"
  | "search"
  | "get"
  | "favorite"
  | "reuse"
  | "delete"
  | "createProject"
  | "listProjects"
  | "getProject"
  | "updateProject"
  | "deleteProject"
  | "addToProject"
  | "removeFromProject";

interface DesignGalleryInput {
  action: DesignGalleryAction;
  componentId?: string;
  name?: string;
  description?: string;
  prompt?: string;
  code?: string;
  mode?: "tailwind";
  style?: "default" | "apple-glass";
  framework?: string;
  category?: string;
  tags?: string[];
  styleTags?: string[];
  query?: string;
  favoritesOnly?: boolean;
  limit?: number;
  projectId?: string;
  projectName?: string;
  includeArchived?: boolean;
}

interface DesignGalleryToolResult {
  success: boolean;
  action: DesignGalleryAction;
  data?: {
    component?: DesignGalleryItem;
    components?: DesignGalleryItem[];
    project?: DesignProjectRow | DesignProjectWithComponents;
    projects?: DesignProjectRow[];
    count?: number;
    message?: string;
  };
  error?: string;
}

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

function normalizeLimit(value?: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(MAX_LIMIT, Math.max(1, Math.round(value)));
}

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function requireUserId(options: DesignGalleryToolOptions): string {
  const userId = options.userId?.trim();
  if (!userId || userId === "UNSCOPED") {
    throw new Error("Design gallery requires an authenticated user.");
  }

  return userId;
}

function missingField(field: string, action: DesignGalleryAction): DesignGalleryToolResult {
  return {
    success: false,
    action,
    error: `Missing required field "${field}" for ${action} action.`,
  };
}

function buildSavedMessage(component: DesignGalleryItem, previewGenerated: boolean): string {
  return previewGenerated
    ? `Saved "${component.name}" to the design gallery with a preview thumbnail.`
    : `Saved "${component.name}" to the design gallery.`;
}

async function handleSave(
  options: DesignGalleryToolOptions,
  input: DesignGalleryInput
): Promise<DesignGalleryToolResult> {
  if (!input.name?.trim()) return missingField("name", "save");
  if (!input.prompt?.trim()) return missingField("prompt", "save");
  if (!input.code?.trim()) return missingField("code", "save");

  // Resolve `cached:<id>` references to actual component code
  const resolvedCode = options.sessionId
    ? resolveComponentCode(options.sessionId, input.code.trim())
    : input.code.trim();

  if (!resolvedCode) {
    return {
      success: false,
      action: "save",
      error: "Component code cache expired. Please regenerate the component before saving.",
    };
  }

  const userId = requireUserId(options);
  const saved = await saveDesignComponentWithPreview({
    userId,
    characterId: options.characterId,
    sessionId: options.sessionId,
    projectId: input.projectId?.trim() || undefined,
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    prompt: input.prompt.trim(),
    code: resolvedCode,
    framework: input.framework?.trim() || "react-tailwind",
    category: input.category?.trim() || "general",
    tags: normalizeTags(input.tags),
    styleTags: normalizeTags(input.styleTags),
    mode: "tailwind",
    style: input.style || "default",
  });

  return {
    success: true,
    action: "save",
    data: {
      component: saved.component,
      message: buildSavedMessage(saved.component, saved.previewGenerated),
    },
  };
}

async function handleSearch(
  options: DesignGalleryToolOptions,
  input: DesignGalleryInput
): Promise<DesignGalleryToolResult> {
  const userId = requireUserId(options);
  const components = await listGalleryComponents({
    userId,
    query: input.query?.trim() || undefined,
    favoritesOnly: input.favoritesOnly === true,
    limit: normalizeLimit(input.limit),
  });

  return {
    success: true,
    action: "search",
    data: {
      components,
      count: components.length,
      message: components.length === 0
        ? "No saved components matched the gallery search."
        : `Found ${components.length} saved component${components.length === 1 ? "" : "s"} in the design gallery.`,
    },
  };
}

async function handleGet(
  options: DesignGalleryToolOptions,
  input: DesignGalleryInput
): Promise<DesignGalleryToolResult> {
  if (!input.componentId?.trim()) return missingField("componentId", "get");

  const userId = requireUserId(options);
  const component = await getGalleryComponentForUser(userId, input.componentId.trim());
  if (!component) {
    return {
      success: false,
      action: "get",
      error: `Gallery component "${input.componentId}" was not found.`,
    };
  }

  return {
    success: true,
    action: "get",
    data: {
      component,
      message: `Loaded gallery component "${component.name}".`,
    },
  };
}

async function handleFavorite(
  options: DesignGalleryToolOptions,
  input: DesignGalleryInput
): Promise<DesignGalleryToolResult> {
  if (!input.componentId?.trim()) return missingField("componentId", "favorite");

  const userId = requireUserId(options);
  const component = await toggleGalleryFavoriteForUser(userId, input.componentId.trim());
  if (!component) {
    return {
      success: false,
      action: "favorite",
      error: `Gallery component "${input.componentId}" was not found.`,
    };
  }

  return {
    success: true,
    action: "favorite",
    data: {
      component,
      message: component.isFavorite
        ? `Marked "${component.name}" as a favorite.`
        : `Removed "${component.name}" from favorites.`,
    },
  };
}

async function handleReuse(
  options: DesignGalleryToolOptions,
  input: DesignGalleryInput
): Promise<DesignGalleryToolResult> {
  if (!input.componentId?.trim()) return missingField("componentId", "reuse");

  const userId = requireUserId(options);
  const component = await markGalleryComponentUsed(userId, input.componentId.trim());
  if (!component) {
    return {
      success: false,
      action: "reuse",
      error: `Gallery component "${input.componentId}" was not found.`,
    };
  }

  return {
    success: true,
    action: "reuse",
    data: {
      component,
      message: `Loaded "${component.name}" back into the workspace context.`,
    },
  };
}

async function handleDelete(
  options: DesignGalleryToolOptions,
  input: DesignGalleryInput
): Promise<DesignGalleryToolResult> {
  if (!input.componentId?.trim()) return missingField("componentId", "delete");

  const userId = requireUserId(options);
  const component = await getGalleryComponentForUser(userId, input.componentId.trim());
  if (!component) {
    return {
      success: false,
      action: "delete",
      error: `Gallery component "${input.componentId}" was not found.`,
    };
  }

  const deleted = await deleteGalleryComponentForUser(userId, input.componentId.trim());
  if (!deleted) {
    return {
      success: false,
      action: "delete",
      error: `Failed to delete gallery component "${input.componentId}".`,
    };
  }

  return {
    success: true,
    action: "delete",
    data: {
      component,
      message: `Deleted "${component.name}" from the design gallery.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Project handlers
// ---------------------------------------------------------------------------

async function handleCreateProject(
  options: DesignGalleryToolOptions,
  input: DesignGalleryInput
): Promise<DesignGalleryToolResult> {
  if (!input.projectName?.trim()) return missingField("projectName", "createProject");

  const userId = requireUserId(options);
  const project = await createProject(userId, {
    name: input.projectName.trim(),
    description: input.description?.trim() || undefined,
    tags: normalizeTags(input.tags),
  });

  return {
    success: true,
    action: "createProject",
    data: {
      project,
      message: `Created project "${project.name}".`,
    },
  };
}

async function handleListProjects(
  options: DesignGalleryToolOptions,
  input: DesignGalleryInput
): Promise<DesignGalleryToolResult> {
  const userId = requireUserId(options);
  const projects = await listProjects({
    userId,
    search: input.query?.trim() || undefined,
    includeArchived: input.includeArchived === true,
    limit: normalizeLimit(input.limit),
  });

  return {
    success: true,
    action: "listProjects",
    data: {
      projects,
      count: projects.length,
      message: projects.length === 0
        ? "No projects found."
        : `Found ${projects.length} project${projects.length === 1 ? "" : "s"}.`,
    },
  };
}

async function handleGetProject(
  options: DesignGalleryToolOptions,
  input: DesignGalleryInput
): Promise<DesignGalleryToolResult> {
  if (!input.projectId?.trim()) return missingField("projectId", "getProject");

  const userId = requireUserId(options);
  const project = await getProject(userId, input.projectId.trim());
  if (!project) {
    return {
      success: false,
      action: "getProject",
      error: `Project "${input.projectId}" was not found.`,
    };
  }

  return {
    success: true,
    action: "getProject",
    data: {
      project,
      count: project.components.length,
      message: `Loaded project "${project.name}" with ${project.components.length} component${project.components.length === 1 ? "" : "s"}.`,
    },
  };
}

async function handleUpdateProject(
  options: DesignGalleryToolOptions,
  input: DesignGalleryInput
): Promise<DesignGalleryToolResult> {
  if (!input.projectId?.trim()) return missingField("projectId", "updateProject");

  const userId = requireUserId(options);
  const project = await updateProject(userId, input.projectId.trim(), {
    name: input.projectName?.trim() || undefined,
    description: input.description?.trim() || undefined,
    tags: input.tags ? normalizeTags(input.tags) : undefined,
  });

  if (!project) {
    return {
      success: false,
      action: "updateProject",
      error: `Project "${input.projectId}" was not found.`,
    };
  }

  return {
    success: true,
    action: "updateProject",
    data: {
      project,
      message: `Updated project "${project.name}".`,
    },
  };
}

async function handleDeleteProject(
  options: DesignGalleryToolOptions,
  input: DesignGalleryInput
): Promise<DesignGalleryToolResult> {
  if (!input.projectId?.trim()) return missingField("projectId", "deleteProject");

  const userId = requireUserId(options);
  const project = await archiveProject(userId, input.projectId.trim());
  if (!project) {
    return {
      success: false,
      action: "deleteProject",
      error: `Project "${input.projectId}" was not found.`,
    };
  }

  return {
    success: true,
    action: "deleteProject",
    data: {
      project,
      message: `Archived project "${project.name}".`,
    },
  };
}

async function handleAddToProject(
  options: DesignGalleryToolOptions,
  input: DesignGalleryInput
): Promise<DesignGalleryToolResult> {
  if (!input.componentId?.trim()) return missingField("componentId", "addToProject");
  if (!input.projectId?.trim()) return missingField("projectId", "addToProject");

  const userId = requireUserId(options);
  const success = await addComponentToProject(userId, input.componentId.trim(), input.projectId.trim());
  if (!success) {
    return {
      success: false,
      action: "addToProject",
      error: `Could not add component "${input.componentId}" to project "${input.projectId}". Verify both exist and belong to you.`,
    };
  }

  const component = await getGalleryComponentForUser(userId, input.componentId.trim());

  return {
    success: true,
    action: "addToProject",
    data: {
      component: component ?? undefined,
      message: `Added component to project.`,
    },
  };
}

async function handleRemoveFromProject(
  options: DesignGalleryToolOptions,
  input: DesignGalleryInput
): Promise<DesignGalleryToolResult> {
  if (!input.componentId?.trim()) return missingField("componentId", "removeFromProject");

  const userId = requireUserId(options);
  const success = await removeComponentFromProject(userId, input.componentId.trim());
  if (!success) {
    return {
      success: false,
      action: "removeFromProject",
      error: `Could not remove component "${input.componentId}" from its project. Verify it exists and belongs to a project.`,
    };
  }

  const component = await getGalleryComponentForUser(userId, input.componentId.trim());

  return {
    success: true,
    action: "removeFromProject",
    data: {
      component: component ?? undefined,
      message: `Removed component from its project.`,
    },
  };
}

async function executeDesignGallery(
  options: DesignGalleryToolOptions,
  input: DesignGalleryInput
): Promise<DesignGalleryToolResult> {
  switch (input.action) {
    case "save":
      return handleSave(options, input);
    case "search":
      return handleSearch(options, input);
    case "get":
      return handleGet(options, input);
    case "favorite":
      return handleFavorite(options, input);
    case "reuse":
      return handleReuse(options, input);
    case "delete":
      return handleDelete(options, input);
    case "createProject":
      return handleCreateProject(options, input);
    case "listProjects":
      return handleListProjects(options, input);
    case "getProject":
      return handleGetProject(options, input);
    case "updateProject":
      return handleUpdateProject(options, input);
    case "deleteProject":
      return handleDeleteProject(options, input);
    case "addToProject":
      return handleAddToProject(options, input);
    case "removeFromProject":
      return handleRemoveFromProject(options, input);
    default:
      return {
        success: false,
        action: input.action,
        error: `Unknown action: ${input.action}`,
      };
  }
}

export function createDesignGalleryTool(options: DesignGalleryToolOptions = {}) {
  const executeWithLogging = withToolLogging(
    "designGallery",
    options.sessionId,
    async (input: DesignGalleryInput) => executeDesignGallery(options, input)
  );

  return tool({
    description: `Save, search, favorite, reuse, and delete components from the design gallery. Manage design projects to organize components.

Actions:
- "save": Save generated component code to the gallery with an auto-generated preview thumbnail. Optionally assign to a project via projectId.
- "search": List saved components, optionally filtered by query or favorites.
- "get": Fetch one saved component by id.
- "favorite": Toggle a saved component as favorite.
- "reuse": Mark a saved component as reused and return it for the workspace.
- "delete": Delete a saved component from the gallery.
- "createProject": Create a new design project. Requires projectName.
- "listProjects": List the user's projects, optionally filtered by query. Supports includeArchived.
- "getProject": Get a single project with its components by projectId.
- "updateProject": Update a project's name, description, or tags by projectId.
- "deleteProject": Archive a project by projectId.
- "addToProject": Add a component to a project. Requires componentId and projectId.
- "removeFromProject": Remove a component from its project. Requires componentId.`,
    inputSchema: jsonSchema<DesignGalleryInput>({
      type: "object",
      title: "DesignGalleryInput",
      properties: {
        action: {
          type: "string",
          enum: [
            "save",
            "search",
            "get",
            "favorite",
            "reuse",
            "delete",
            "createProject",
            "listProjects",
            "getProject",
            "updateProject",
            "deleteProject",
            "addToProject",
            "removeFromProject",
          ],
        },
        componentId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        prompt: { type: "string" },
        code: { type: "string" },
        mode: { type: "string", enum: ["tailwind"] },
        style: { type: "string", enum: ["default", "apple-glass"] },
        framework: { type: "string" },
        category: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        styleTags: { type: "array", items: { type: "string" } },
        query: { type: "string" },
        favoritesOnly: { type: "boolean" },
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
        projectId: { type: "string" },
        projectName: { type: "string" },
        includeArchived: { type: "boolean" },
      },
      required: ["action"],
      additionalProperties: false,
    }),
    execute: executeWithLogging,
  });
}
