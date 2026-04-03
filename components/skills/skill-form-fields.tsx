"use client";

import { useTranslations } from "next-intl";

export type SkillStatus = "draft" | "active" | "archived";

export interface SkillFormValues {
  name: string;
  description: string;
  promptTemplate: string;
  category: string;
  toolHints: string;
  triggerExamples: string;
}

export interface SkillFormFieldsProps {
  values: SkillFormValues;
  onChange: (patch: Partial<SkillFormValues>) => void;
  /** When provided, renders the status selector with this value. */
  status?: SkillStatus;
  onStatusChange?: (status: SkillStatus) => void;
}

/**
 * Shared form fields for both the new-skill and edit-skill pages.
 * Renders name, category, description, promptTemplate, toolHints,
 * triggerExamples, and an optional status selector.
 */
export function SkillFormFields({ values, onChange, status, onStatusChange }: SkillFormFieldsProps) {
  const t = useTranslations("skills.new");
  const tStatus = useTranslations("skills.status");
  const tDetail = useTranslations("skills.detail");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-mono text-terminal-dark">
          {t("nameLabel")}
          <input
            value={values.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="mt-1 w-full rounded border border-terminal-border bg-white px-3 py-2 font-mono text-sm"
          />
        </label>
        <label className="text-sm font-mono text-terminal-dark">
          {t("categoryLabel")}
          <input
            value={values.category}
            onChange={(e) => onChange({ category: e.target.value })}
            className="mt-1 w-full rounded border border-terminal-border bg-white px-3 py-2 font-mono text-sm"
          />
        </label>
      </div>

      <label className="block text-sm font-mono text-terminal-dark">
        {t("descriptionLabel")}
        <textarea
          value={values.description}
          onChange={(e) => onChange({ description: e.target.value })}
          className="mt-1 min-h-[80px] w-full rounded border border-terminal-border bg-white px-3 py-2 font-mono text-sm"
        />
      </label>

      <label className="block text-sm font-mono text-terminal-dark">
        {t("promptLabel")}
        <textarea
          value={values.promptTemplate}
          onChange={(e) => onChange({ promptTemplate: e.target.value })}
          className="mt-1 min-h-[180px] w-full rounded border border-terminal-border bg-white px-3 py-2 font-mono text-sm"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-mono text-terminal-dark">
          {t("toolHintsLabel")}
          <textarea
            value={values.toolHints}
            onChange={(e) => onChange({ toolHints: e.target.value })}
            className="mt-1 min-h-[110px] w-full rounded border border-terminal-border bg-white px-3 py-2 font-mono text-sm"
          />
        </label>
        <label className="block text-sm font-mono text-terminal-dark">
          {t("triggerLabel")}
          <textarea
            value={values.triggerExamples}
            onChange={(e) => onChange({ triggerExamples: e.target.value })}
            className="mt-1 min-h-[110px] w-full rounded border border-terminal-border bg-white px-3 py-2 font-mono text-sm"
          />
        </label>
      </div>

      {status !== undefined && onStatusChange ? (
        <label className="block text-sm font-mono text-terminal-dark">
          {tDetail("statusLabel")}
          <select
            value={status}
            onChange={(e) => onStatusChange(e.target.value as SkillStatus)}
            className="mt-1 w-full rounded border border-terminal-border bg-white px-3 py-2 font-mono text-sm"
          >
            <option value="active">{tStatus("active")}</option>
            <option value="draft">{tStatus("draft")}</option>
            <option value="archived">{tStatus("archived")}</option>
          </select>
        </label>
      ) : null}
    </div>
  );
}
