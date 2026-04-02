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
  type DesignGalleryItem,
} from "@/lib/design/gallery";

interface DesignGalleryToolOptions {
  sessionId?: string;
  userId?: string;
  characterId?: string;
}

type DesignGalleryAction = "save" | "search" | "get" | "favorite" | "reuse" | "delete";

interface DesignGalleryInput {
  action: DesignGalleryAction;
  componentId?: string;
  name?: string;
  description?: string;
  prompt?: string;
  code?: string;
  mode?: "html" | "tailwind";
  style?: "default" | "apple-glass";
  framework?: string;
  category?: string;
  tags?: string[];
  styleTags?: string[];
  query?: string;
  favoritesOnly?: boolean;
  limit?: number;
}

interface DesignGalleryToolResult {
  success: boolean;
  action: DesignGalleryAction;
  data?: {
    component?: DesignGalleryItem;
    components?: DesignGalleryItem[];
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

  const userId = requireUserId(options);
  const saved = await saveDesignComponentWithPreview({
    userId,
    characterId: options.characterId,
    sessionId: options.sessionId,
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    prompt: input.prompt.trim(),
    code: input.code.trim(),
    framework: input.framework?.trim() || (input.mode === "tailwind" ? "react-tailwind" : "html-css"),
    category: input.category?.trim() || "general",
    tags: normalizeTags(input.tags),
    styleTags: normalizeTags(input.styleTags),
    mode: input.mode || "html",
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
    description: `Save, search, favorite, reuse, and delete components from the design gallery.

Actions:
- "save": Save generated component code to the gallery with an auto-generated preview thumbnail.
- "search": List saved components, optionally filtered by query or favorites.
- "get": Fetch one saved component by id.
- "favorite": Toggle a saved component as favorite.
- "reuse": Mark a saved component as reused and return it for the workspace.
- "delete": Delete a saved component from the gallery.`,
    inputSchema: jsonSchema<DesignGalleryInput>({
      type: "object",
      title: "DesignGalleryInput",
      properties: {
        action: {
          type: "string",
          enum: ["save", "search", "get", "favorite", "reuse", "delete"],
        },
        componentId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        prompt: { type: "string" },
        code: { type: "string" },
        mode: { type: "string", enum: ["html", "tailwind"] },
        style: { type: "string", enum: ["default", "apple-glass"] },
        framework: { type: "string" },
        category: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        styleTags: { type: "array", items: { type: "string" } },
        query: { type: "string" },
        favoritesOnly: { type: "boolean" },
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["action"],
      additionalProperties: false,
    }),
    execute: executeWithLogging,
  });
}
