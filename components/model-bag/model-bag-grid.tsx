"use client";

import { useEffect, useState } from "react";
import { ModelBagItem } from "./model-bag-item";
import type { ModelItem, ModelRole, LLMProvider } from "./model-bag.types";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface ModelBagGridProps {
  models: ModelItem[];
  roleAssignments: Record<ModelRole, string>;
  onAssign: (modelId: string, role: ModelRole) => void;
  onHover: (modelId: string | null) => void;
  hoveredModel: string | null;
  activeProvider: LLMProvider;
  isSaving: boolean;
}

const MANUAL_MODEL_PROVIDERS: ReadonlySet<LLMProvider> = new Set(["openrouter", "ollama", "blackboxai"]);

function isManualModelProvider(provider: LLMProvider): provider is "openrouter" | "ollama" | "blackboxai" {
  return MANUAL_MODEL_PROVIDERS.has(provider);
}

function getManualModelPlaceholder(provider: LLMProvider): string {
  switch (provider) {
    case "blackboxai":
      return "anthropic/claude-sonnet-4.6";
    case "openrouter":
      return "x-ai/grok-4.1-fast";
    default:
      return "llama3.1:8b";
  }
}

function getManualModelHelper(
  provider: LLMProvider,
  t: ReturnType<typeof useTranslations<"modelBag">>,
): string {
  return provider === "blackboxai" ? t("manualBlackboxHint") : t("enterToAssign");
}

export function ModelBagGrid({
  models,
  roleAssignments: _roleAssignments,
  onAssign,
  onHover,
  hoveredModel,
  activeProvider,
  isSaving,
}: ModelBagGridProps) {
  const t = useTranslations("modelBag");
  const [customModelInput, setCustomModelInput] = useState("");
  const supportsManualInput = isManualModelProvider(activeProvider);

  useEffect(() => {
    setCustomModelInput("");
  }, [activeProvider]);

  if (models.length === 0 && !supportsManualInput) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-terminal-border p-8">
        <p className="font-mono text-sm text-terminal-muted">
          {t("noMatch")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {supportsManualInput && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-terminal-border bg-white/30 p-2">
          <input
            type="text"
            value={customModelInput}
            onChange={(e) => setCustomModelInput(e.target.value)}
            placeholder={getManualModelPlaceholder(activeProvider)}
            className="flex-1 rounded border border-terminal-border bg-white/50 px-2 py-1 font-mono text-xs text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && customModelInput.trim()) {
                onAssign(customModelInput.trim(), "chat");
                setCustomModelInput("");
              }
            }}
          />
          <span className="font-mono text-[9px] text-terminal-muted">
            {getManualModelHelper(activeProvider, t)}
          </span>
        </div>
      )}

      {models.length > 0 && (
        <div
          className={cn(
            "grid gap-2 overflow-y-auto rounded-lg border border-terminal-border/50 p-3",
            "grid-cols-3 sm:grid-cols-4 lg:grid-cols-5",
            "max-h-[360px]",
          )}
        >
          {models.map((model) => (
            <ModelBagItem
              key={model.id}
              model={model}
              isHovered={hoveredModel === model.id}
              isActiveProvider={model.provider === activeProvider}
              onHover={onHover}
              onAssign={onAssign}
              isSaving={isSaving}
            />
          ))}
        </div>
      )}
    </div>
  );
}
