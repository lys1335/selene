/**
 * JSON Schema Sanitizer
 *
 * Shared utilities for normalizing and sanitizing JSON Schema objects.
 * Handles legacy JSON Schema 4 keywords, nullable fields, integer->number
 * coercion, and ensures nested schemas are structurally complete.
 *
 * Used by both the Antigravity provider adapter and the MCP tool adapter.
 */

// ---- Helpers -----------------------------------------------------------------

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeSchemaValue(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  stringKeys: ReadonlySet<string>,
  numberKeys: ReadonlySet<string>,
  booleanKeys: ReadonlySet<string>,
): Record<string, unknown> | boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (!isPlainObject(value)) {
    return undefined;
  }
  return sanitizeSchema(value, allowedKeys, stringKeys, numberKeys, booleanKeys);
}

export function sanitizeSchemaArray(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  stringKeys: ReadonlySet<string>,
  numberKeys: ReadonlySet<string>,
  booleanKeys: ReadonlySet<string>,
): Array<Record<string, unknown> | boolean> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const sanitized = value
    .map((entry) => sanitizeSchemaValue(entry, allowedKeys, stringKeys, numberKeys, booleanKeys))
    .filter((entry): entry is Record<string, unknown> | boolean => entry !== undefined);
  return sanitized.length > 0 ? sanitized : undefined;
}

export function sanitizeSchemaRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  stringKeys: ReadonlySet<string>,
  numberKeys: ReadonlySet<string>,
  booleanKeys: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = sanitizeSchemaValue(entry, allowedKeys, stringKeys, numberKeys, booleanKeys);
    if (normalized !== undefined) {
      sanitized[key] = normalized;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export function ensureSchemaCompleteness(schema: Record<string, unknown>): Record<string, unknown> {
  const type = schema.type;

  if (type === "array" || (Array.isArray(type) && type.includes("array"))) {
    if (!("items" in schema) && !("prefixItems" in schema)) {
      schema.items = { type: "string" };
    }
  }

  if (type === "object" || (Array.isArray(type) && type.includes("object"))) {
    if (!("properties" in schema)) {
      schema.properties = {};
    }
  }

  for (const key of ["properties", "patternProperties", "$defs", "dependentSchemas"]) {
    const val = schema[key];
    if (isPlainObject(val)) {
      for (const [k, v] of Object.entries(val)) {
        if (isPlainObject(v)) {
          (val as Record<string, unknown>)[k] = ensureSchemaCompleteness(v as Record<string, unknown>);
        }
      }
    }
  }

  for (const key of [
    "items",
    "additionalProperties",
    "contains",
    "not",
    "if",
    "then",
    "else",
    "contentSchema",
    "propertyNames",
    "unevaluatedProperties",
    "unevaluatedItems",
  ]) {
    const val = schema[key];
    if (isPlainObject(val)) {
      schema[key] = ensureSchemaCompleteness(val as Record<string, unknown>);
    }
  }

  for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
    const val = schema[key];
    if (Array.isArray(val)) {
      schema[key] = val.map((entry: unknown) =>
        isPlainObject(entry) ? ensureSchemaCompleteness(entry as Record<string, unknown>) : entry
      );
    }
  }

  return schema;
}

/**
 * Sanitize a JSON Schema object, upgrading legacy JSON Schema 4 syntax to
 * draft 2019-09/2020-12 equivalents and stripping unknown keys.
 *
 * The allowed/string/number/boolean key sets are caller-supplied so that each
 * consumer (Antigravity, MCP) can include only the keys their target API
 * accepts (e.g. MCP includes "$schema"; Antigravity does not).
 */
export function sanitizeSchema(
  schema: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  stringKeys: ReadonlySet<string>,
  numberKeys: ReadonlySet<string>,
  booleanKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const input = { ...schema };

  // definitions → $defs (JSON Schema draft 4 → modern)
  if (isPlainObject(input.definitions)) {
    const existing = isPlainObject(input.$defs) ? input.$defs : {};
    input.$defs = { ...input.definitions, ...existing };
  }
  delete input.definitions;

  // id → $id (JSON Schema draft 4 → modern)
  if (typeof input.id === "string" && typeof input.$id !== "string") {
    input.$id = input.id;
  }
  delete input.id;

  // nullable → type union (OpenAPI 3.0 → JSON Schema)
  if (typeof input.nullable === "boolean") {
    if (input.nullable) {
      const currentType = input.type;
      if (typeof currentType === "string") {
        input.type = currentType === "null" ? currentType : [currentType, "null"];
      } else if (Array.isArray(currentType)) {
        if (!currentType.includes("null")) {
          input.type = [...currentType, "null"];
        }
      }
    }
    delete input.nullable;
  }

  // exclusiveMinimum: boolean → number (JSON Schema draft 4 → modern)
  if (typeof input.exclusiveMinimum === "boolean") {
    if (input.exclusiveMinimum) {
      if (typeof input.minimum === "number") {
        input.exclusiveMinimum = input.minimum;
        delete input.minimum;
      } else {
        delete input.exclusiveMinimum;
      }
    } else {
      delete input.exclusiveMinimum;
    }
  }

  // exclusiveMaximum: boolean → number (JSON Schema draft 4 → modern)
  if (typeof input.exclusiveMaximum === "boolean") {
    if (input.exclusiveMaximum) {
      if (typeof input.maximum === "number") {
        input.exclusiveMaximum = input.maximum;
        delete input.maximum;
      } else {
        delete input.exclusiveMaximum;
      }
    } else {
      delete input.exclusiveMaximum;
    }
  }

  // items: array → prefixItems (JSON Schema draft 4 tuple syntax → modern)
  if (Array.isArray(input.items)) {
    if (!input.prefixItems) {
      input.prefixItems = input.items;
    }
    delete input.items;
  }

  // additionalItems → items (JSON Schema draft 4 → modern)
  if ("additionalItems" in input) {
    if (
      input.items === undefined &&
      (isPlainObject(input.additionalItems) || typeof input.additionalItems === "boolean")
    ) {
      input.items = input.additionalItems;
    }
    delete input.additionalItems;
  }

  // dependencies → dependentRequired / dependentSchemas (JSON Schema draft 4 → modern)
  if (isPlainObject(input.dependencies)) {
    const dependentRequired: Record<string, string[]> = {};
    const dependentSchemas: Record<string, Record<string, unknown>> = {};

    for (const [key, value] of Object.entries(input.dependencies)) {
      if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
        dependentRequired[key] = value as string[];
      } else if (isPlainObject(value)) {
        dependentSchemas[key] = value as Record<string, unknown>;
      }
    }

    if (Object.keys(dependentRequired).length > 0) {
      const existing = isPlainObject(input.dependentRequired) ? input.dependentRequired : {};
      input.dependentRequired = { ...existing, ...dependentRequired };
    }

    if (Object.keys(dependentSchemas).length > 0) {
      const existing = isPlainObject(input.dependentSchemas) ? input.dependentSchemas : {};
      input.dependentSchemas = { ...existing, ...dependentSchemas };
    }
  }
  delete input.dependencies;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowedKeys.has(key)) {
      continue;
    }

    switch (key) {
      case "$ref":
        if (typeof value === "string") {
          sanitized[key] = value
            .replace(/#\/definitions\//g, "#/$defs/")
            .replace(/#\/definitions$/g, "#/$defs");
        }
        break;
      case "properties":
      case "patternProperties":
      case "$defs":
      case "dependentSchemas": {
        const record = sanitizeSchemaRecord(value, allowedKeys, stringKeys, numberKeys, booleanKeys);
        if (record) {
          sanitized[key] = record;
        }
        break;
      }
      case "dependentRequired": {
        if (isPlainObject(value)) {
          const record: Record<string, string[]> = {};
          for (const [depKey, depValue] of Object.entries(value)) {
            if (
              Array.isArray(depValue) &&
              depValue.every((entry) => typeof entry === "string")
            ) {
              record[depKey] = depValue as string[];
            }
          }
          if (Object.keys(record).length > 0) {
            sanitized[key] = record;
          }
        }
        break;
      }
      case "items":
      case "additionalProperties":
      case "unevaluatedProperties":
      case "unevaluatedItems":
      case "contains":
      case "propertyNames":
      case "not":
      case "if":
      case "then":
      case "else":
      case "contentSchema": {
        const normalized = sanitizeSchemaValue(value, allowedKeys, stringKeys, numberKeys, booleanKeys);
        if (normalized !== undefined) {
          sanitized[key] = normalized;
        }
        break;
      }
      case "allOf":
      case "anyOf":
      case "oneOf":
      case "prefixItems": {
        const array = sanitizeSchemaArray(value, allowedKeys, stringKeys, numberKeys, booleanKeys);
        if (array) {
          sanitized[key] = array;
        }
        break;
      }
      case "required":
        if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
          sanitized[key] = value;
        }
        break;
      case "enum":
        if (Array.isArray(value)) {
          sanitized[key] = value;
        }
        break;
      case "examples":
        if (Array.isArray(value)) {
          sanitized[key] = value;
        }
        break;
      case "type":
        if (
          typeof value === "string" ||
          (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
        ) {
          sanitized[key] = value;
        }
        break;
      default:
        if (stringKeys.has(key)) {
          if (typeof value === "string") {
            sanitized[key] = value;
          }
          break;
        }
        if (numberKeys.has(key)) {
          if (typeof value === "number") {
            sanitized[key] = value;
          }
          break;
        }
        if (booleanKeys.has(key)) {
          if (typeof value === "boolean") {
            sanitized[key] = value;
          }
          break;
        }
        if (key === "const" || key === "default") {
          sanitized[key] = value;
        }
        break;
    }
  }

  return sanitized;
}

/**
 * Normalize a raw inputSchema value to a structurally complete JSON Schema
 * object suitable for use as a tool's parameter schema.
 *
 * - Forces top-level type to "object"
 * - Ensures "properties" and "additionalProperties" are present
 * - Recursively completes nested array/object schemas
 *
 * Returns a spread of `defaultSchema` when the input is invalid or empty,
 * so callers control what the fallback looks like.
 */
export function normalizeInputSchema(
  inputSchema: unknown,
  allowedKeys: ReadonlySet<string>,
  stringKeys: ReadonlySet<string>,
  numberKeys: ReadonlySet<string>,
  booleanKeys: ReadonlySet<string>,
  defaultSchema: Record<string, unknown>,
  onEmpty?: () => void,
  onInvalid?: () => void,
): Record<string, unknown> {
  if (!isPlainObject(inputSchema)) {
    onInvalid?.();
    return { ...defaultSchema };
  }

  const sanitized = sanitizeSchema(inputSchema, allowedKeys, stringKeys, numberKeys, booleanKeys);
  if (!Object.keys(sanitized).length) {
    onEmpty?.();
    return { ...defaultSchema };
  }

  const normalizedType = sanitized.type;
  if (!normalizedType) {
    sanitized.type = "object";
  } else if (Array.isArray(normalizedType)) {
    if (!normalizedType.includes("object")) {
      sanitized.type = "object";
    }
  } else if (typeof normalizedType === "string" && normalizedType !== "object") {
    sanitized.type = "object";
  }

  if (!("properties" in sanitized)) {
    sanitized.properties = {};
  }

  if (!("additionalProperties" in sanitized)) {
    sanitized.additionalProperties = true;
  }

  return ensureSchemaCompleteness(sanitized);
}
