"use client";

import { useMemo, useState } from "react";
import type { SkillFormValues } from "@/components/skills/skill-form-fields";

export { type SkillFormValues };

export function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const DEFAULT_FORM: SkillFormValues = {
  name: "",
  description: "",
  promptTemplate: "",
  category: "general",
  toolHints: "",
  triggerExamples: "",
};

/**
 * Shared form state for skill create and edit pages.
 *
 * Handles:
 * - form values + patch-based onChange helper
 * - saving / error state
 * - canSave validation
 * - runSave: wraps an async operation with saving/error lifecycle
 */
export function useSkillForm(initial?: Partial<SkillFormValues>) {
  const [form, setFormState] = useState<SkillFormValues>({ ...DEFAULT_FORM, ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setForm = (patch: Partial<SkillFormValues>) =>
    setFormState((prev) => ({ ...prev, ...patch }));

  const resetForm = (values: SkillFormValues) => setFormState(values);

  const canSave = useMemo(
    () => form.name.trim().length > 0 && form.promptTemplate.trim().length > 0,
    [form.name, form.promptTemplate],
  );

  /**
   * Wraps an async save/submit operation.
   * Sets saving=true, clears error before calling fn,
   * catches any thrown Error and puts it in error state,
   * then sets saving=false.
   */
  const runSave = async (fn: () => Promise<void>) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  };

  return { form, setForm, resetForm, saving, error, setError, canSave, runSave };
}
