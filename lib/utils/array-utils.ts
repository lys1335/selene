/**
 * Shared array utility functions.
 */

/**
 * Safely coerce an unknown value to a string array.
 * Returns an empty array for any non-array input.
 */
export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
