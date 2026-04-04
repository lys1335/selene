/**
 * Antigravity Schema Sanitization
 *
 * Normalizes and coerces JSON Schema objects to be compatible with the
 * Antigravity / Gemini API gateway. Handles legacy JSON Schema 4 keywords,
 * nullable fields, integer->number coercion, and Gemini-specific constraints
 * (e.g. enum only allowed on STRING type fields).
 */

import {
  isPlainObject,
  sanitizeSchema,
  ensureSchemaCompleteness,
  normalizeInputSchema,
  BASE_ALLOWED_SCHEMA_KEYS,
  BASE_STRING_KEYS,
  BASE_NUMBER_KEYS,
  BASE_BOOLEAN_KEYS,
} from "@/lib/ai/json-schema-sanitizer";

// ---- Constants ---------------------------------------------------------------

const DEFAULT_ANTIGRAVITY_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {},
  additionalProperties: true,
};

// Antigravity does not expose "$schema" to the upstream API, so the base sets
// are used as-is (no additions needed).
const ANTIGRAVITY_ALLOWED_SCHEMA_KEYS = BASE_ALLOWED_SCHEMA_KEYS;
const ANTIGRAVITY_STRING_KEYS = BASE_STRING_KEYS;
const ANTIGRAVITY_NUMBER_KEYS = BASE_NUMBER_KEYS;
const ANTIGRAVITY_BOOLEAN_KEYS = BASE_BOOLEAN_KEYS;

// ---- Private helpers ---------------------------------------------------------

function normalizeAntigravityInputSchema(inputSchema: unknown): Record<string, unknown> {
  return normalizeInputSchema(
    inputSchema,
    ANTIGRAVITY_ALLOWED_SCHEMA_KEYS,
    ANTIGRAVITY_STRING_KEYS,
    ANTIGRAVITY_NUMBER_KEYS,
    ANTIGRAVITY_BOOLEAN_KEYS,
    DEFAULT_ANTIGRAVITY_INPUT_SCHEMA,
  );
}

function normalizeAnthropicType(value: unknown): string | undefined {
  const mapType = (type: string): string => (type === "integer" ? "number" : type);

  if (typeof value === "string") {
    return mapType(value);
  }

  if (Array.isArray(value)) {
    const normalized = value
      .filter((entry): entry is string => typeof entry === "string")
      .map(mapType)
      .filter((entry) => entry !== "null");
    const unique = Array.from(new Set(normalized));
    for (const preferred of ["object", "array", "string", "number", "boolean"]) {
      if (unique.includes(preferred)) {
        return preferred;
      }
    }
    return unique[0];
  }

  return undefined;
}

function coerceAnthropicSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const type = normalizeAnthropicType(schema.type);

  if (typeof schema.description === "string") {
    result.description = schema.description;
  }

  if (schema.default !== undefined) {
    result.default = schema.default;
  }

  if (Array.isArray(schema.enum)) {
    // Gemini only supports enum on STRING type — strip for non-string types
    if (type && type !== "string") {
      // Don't include enum for number/boolean/etc types
    } else {
      result.enum = schema.enum.map((value) =>
        typeof value === "string" ? value : String(value)
      );
    }
  }

  if (typeof schema.minimum === "number") result.minimum = schema.minimum;
  if (typeof schema.maximum === "number") result.maximum = schema.maximum;
  if (typeof schema.minLength === "number") result.minLength = schema.minLength;
  if (typeof schema.maxLength === "number") result.maxLength = schema.maxLength;
  if (typeof schema.minItems === "number") result.minItems = schema.minItems;
  if (typeof schema.maxItems === "number") result.maxItems = schema.maxItems;

  if (type === "object") {
    const props: Record<string, unknown> = {};

    if (isPlainObject(schema.properties)) {
      for (const [key, value] of Object.entries(schema.properties)) {
        if (isPlainObject(value)) {
          props[key] = coerceAnthropicSchema(value);
        }
      }
    }

    result.type = "object";
    result.properties = props;

    if (Array.isArray(schema.required)) {
      const required = schema.required.filter(
        (entry): entry is string => typeof entry === "string"
      );
      if (required.length) {
        result.required = required;
      }
    }

    if ("additionalProperties" in schema) {
      if (typeof schema.additionalProperties === "boolean") {
        result.additionalProperties = schema.additionalProperties;
      } else if (isPlainObject(schema.additionalProperties)) {
        result.additionalProperties = coerceAnthropicSchema(schema.additionalProperties);
      }
    } else {
      result.additionalProperties = true;
    }
  } else if (type === "array") {
    result.type = "array";

    let itemsSchema: Record<string, unknown> | undefined;
    if (Array.isArray(schema.items) && schema.items.length > 0) {
      const first = schema.items[0];
      if (isPlainObject(first)) {
        itemsSchema = coerceAnthropicSchema(first);
      }
    } else if (isPlainObject(schema.items)) {
      itemsSchema = coerceAnthropicSchema(schema.items);
    }

    result.items = itemsSchema ?? { type: "string" };
  } else if (type) {
    result.type = type;
  }

  if (!result.type) {
    if (isPlainObject(result.properties)) {
      result.type = "object";
    } else if (result.items) {
      result.type = "array";
    } else {
      result.type = "string";
    }
  }

  if (result.type === "object" && !("properties" in result)) {
    result.properties = {};
  }

  if (result.type === "array" && !("items" in result)) {
    result.items = { type: "string" };
  }

  return result;
}

function normalizeAntigravityCustomSchema(inputSchema: unknown): Record<string, unknown> {
  const normalized = normalizeAntigravityInputSchema(inputSchema);
  const coerced = coerceAnthropicSchema(normalized);
  return Object.keys(coerced).length > 0 ? coerced : { ...DEFAULT_ANTIGRAVITY_INPUT_SCHEMA };
}

/**
 * Normalize tool schemas in a request body to be compatible with the Antigravity
 * (Gemini) API. Ensures all function declarations have a parameters schema and
 * that enum values are strings on STRING-typed properties.
 */
export function normalizeAntigravityToolSchemas(tools: unknown): void {
  if (!Array.isArray(tools)) {
    return;
  }

  const normalizeEnumValues = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach((item) => normalizeEnumValues(item));
      return;
    }

    if (!node || typeof node !== "object") {
      return;
    }

    const schema = node as Record<string, unknown>;
    const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;

    if (enumValues) {
      // Gemini API only supports enum on STRING type properties.
      const schemaType = typeof schema.type === "string" ? schema.type : undefined;
      if (schemaType && schemaType !== "string" && schemaType !== "STRING") {
        delete schema.enum;
      } else {
        schema.enum = enumValues.map((value) =>
          typeof value === "string" ? value : String(value)
        );
      }
    }

    for (const value of Object.values(schema)) {
      normalizeEnumValues(value);
    }
  };

  for (const [index, toolEntry] of tools.entries()) {
    if (!toolEntry || typeof toolEntry !== "object") {
      continue;
    }

    const entry = toolEntry as Record<string, unknown>;

    if (entry.custom && typeof entry.custom === "object") {
      const custom = entry.custom as Record<string, unknown>;
      if (!("input_schema" in custom) || !custom.input_schema) {
        custom.input_schema = { type: "object", properties: {} };
        const name = typeof custom.name === "string" ? custom.name : `#${index}`;
        console.warn(`[Antigravity] Tool "${name}" missing input_schema; injecting empty schema`);
      }
      custom.input_schema = normalizeAntigravityCustomSchema(custom.input_schema);
      normalizeEnumValues(custom.input_schema);
    }

    if (Array.isArray(entry.functionDeclarations)) {
      for (const [fnIndex, fnEntry] of entry.functionDeclarations.entries()) {
        if (!fnEntry || typeof fnEntry !== "object") {
          continue;
        }

        const fn = fnEntry as Record<string, unknown>;
        if (!("parameters" in fn) || !fn.parameters) {
          fn.parameters = { type: "object", properties: {} };
          const name = typeof fn.name === "string" ? fn.name : `#${index}.${fnIndex}`;
          console.warn(`[Antigravity] Function "${name}" missing parameters; injecting empty schema`);
        }
        fn.parameters = normalizeAntigravityCustomSchema(fn.parameters);
        normalizeEnumValues(fn.parameters);
      }
    }

    if (Array.isArray(entry.function_declarations)) {
      for (const [fnIndex, fnEntry] of entry.function_declarations.entries()) {
        if (!fnEntry || typeof fnEntry !== "object") {
          continue;
        }

        const fn = fnEntry as Record<string, unknown>;
        if (!("parameters" in fn) || !fn.parameters) {
          fn.parameters = { type: "object", properties: {} };
          const name = typeof fn.name === "string" ? fn.name : `#${index}.${fnIndex}`;
          console.warn(`[Antigravity] Function "${name}" missing parameters; injecting empty schema`);
        }
        fn.parameters = normalizeAntigravityCustomSchema(fn.parameters);
        normalizeEnumValues(fn.parameters);
      }
    }
  }
}
