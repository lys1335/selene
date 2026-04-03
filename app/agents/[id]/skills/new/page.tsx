"use client";

import { useMemo, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { SkillFormFields } from "@/components/skills/skill-form-fields";
import type { SkillFormValues } from "@/components/skills/skill-form-fields";

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export default function NewSkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: characterId } = use(params);
  const router = useRouter();
  const t = useTranslations("skills.new");

  const [form, setForm] = useState<SkillFormValues>({
    name: "",
    description: "",
    promptTemplate: "",
    category: "general",
    toolHints: "",
    triggerExamples: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => form.name.trim().length > 0 && form.promptTemplate.trim().length > 0,
    [form.name, form.promptTemplate],
  );

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId,
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          promptTemplate: form.promptTemplate.trim(),
          category: form.category.trim() || "general",
          toolHints: splitLines(form.toolHints),
          triggerExamples: splitLines(form.triggerExamples),
          status: "active",
          sourceType: "manual",
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t("createFailed"));
      }

      const skillId = payload?.skill?.id;
      if (typeof skillId === "string" && skillId.length > 0) {
        router.push(`/agents/${characterId}/skills/${skillId}`);
      } else {
        router.push(`/agents/${characterId}/skills`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell>
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <Button asChild variant="ghost" className="mb-4 font-mono">
          <Link href={`/agents/${characterId}/skills`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("backToSkills")}
          </Link>
        </Button>

        <Card className="border-terminal-border">
          <CardHeader>
            <CardTitle className="font-mono text-terminal-dark">{t("title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <SkillFormFields
              values={form}
              onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            />

            {error ? <p className="text-sm font-mono text-red-600">{error}</p> : null}

            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" className="font-mono" asChild>
                <Link href={`/agents/${characterId}/skills`}>{t("cancel")}</Link>
              </Button>
              <Button onClick={handleSubmit} className="font-mono" disabled={!canSubmit || saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t("create")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
