"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { AlertTriangle, Info } from "lucide-react";
import { settingsSectionShellClassName } from "@/components/settings/settings-form-layout";
import type { FormState } from "./settings-types";
import { ClaudeCodeAuthFlow } from "./claude-code-auth-flow";

type OllamaTestStatus = "untested" | "loading" | "success" | "error";

interface OllamaTestResult {
  status: OllamaTestStatus;
  modelCount?: number;
  error?: string;
}

interface ApiKeysSectionProps {
  formState: FormState;
  updateField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  antigravityAuth: { isAuthenticated: boolean; email?: string; expiresAt?: number } | null;
  antigravityLoading: boolean;
  onAntigravityLogin: () => void;
  onAntigravityLogout: () => void;
  codexAuth: { isAuthenticated: boolean; email?: string; accountId?: string; expiresAt?: number } | null;
  codexLoading: boolean;
  onCodexLogin: () => void;
  onCodexLogout: () => void;
  claudecodeAuth: { isAuthenticated: boolean; email?: string; expiresAt?: number } | null;
  claudecodeLoading: boolean;
  onClaudeCodeLogin: () => void;
  onClaudeCodeLogout: () => void;
  claudeCodePasteMode: boolean;
  claudeCodeAuthSuccess: boolean;
  claudeCodeBrowserOpened: boolean;
  claudeCodeDiagnosticOutput: string[];
  onClaudeCodePasteSubmit: (code: string) => void;
  onClaudeCodePasteCancel: () => void;
  onClaudeCodeAuthComplete: () => void;
}

export function ApiKeysSection({
  formState,
  updateField,
  antigravityAuth,
  antigravityLoading,
  onAntigravityLogin,
  onAntigravityLogout,
  codexAuth,
  codexLoading,
  onCodexLogin,
  onCodexLogout,
  claudecodeAuth,
  claudecodeLoading,
  onClaudeCodeLogin,
  onClaudeCodeLogout,
  claudeCodePasteMode,
  claudeCodeAuthSuccess,
  claudeCodeBrowserOpened,
  claudeCodeDiagnosticOutput,
  onClaudeCodePasteSubmit,
  onClaudeCodePasteCancel,
  onClaudeCodeAuthComplete,
}: ApiKeysSectionProps) {
  const t = useTranslations("settings");

  const [ollamaTest, setOllamaTest] = useState<OllamaTestResult>({ status: "untested" });

  const testOllamaConnection = useCallback(async (baseUrl: string) => {
    setOllamaTest({ status: "loading" });
    try {
      const res = await fetch("/api/ollama/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl }),
      });
      const data = await res.json();
      if (data.ok) {
        setOllamaTest({ status: "success", modelCount: data.models?.length ?? 0 });
      } else {
        setOllamaTest({ status: "error", error: data.error || "Cannot reach Ollama" });
      }
    } catch {
      setOllamaTest({ status: "error", error: "Cannot reach Ollama" });
    }
  }, []);

  // Auto-test on mount when Ollama is the selected provider
  useEffect(() => {
    if (formState.llmProvider === "ollama" && ollamaTest.status === "untested") {
      testOllamaConnection(formState.ollamaBaseUrl);
    }
  }, [formState.llmProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={settingsSectionShellClassName}>
      <div>
        <h2 className="mb-1 font-mono text-lg font-semibold text-terminal-dark">{t("api.title")}</h2>
        <p className="mb-4 font-mono text-sm text-terminal-muted">
          {t("api.description")}
        </p>
        <div className="space-y-3">
          <label className="flex items-center gap-3">
            <input
              type="radio"
              name="llmProvider"
              value="anthropic"
              checked={formState.llmProvider === "anthropic"}
              onChange={(e) => {
                updateField("llmProvider", e.target.value as FormState["llmProvider"]);
                updateField("chatModel", "");
                updateField("researchModel", "");
                updateField("visionModel", "");
                updateField("utilityModel", "");
              }}
              className="size-4 accent-terminal-green"
            />
            <span className="font-mono text-terminal-dark">{t("api.anthropic")}</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="radio"
              name="llmProvider"
              value="openrouter"
              checked={formState.llmProvider === "openrouter"}
              onChange={(e) => {
                updateField("llmProvider", e.target.value as FormState["llmProvider"]);
                updateField("chatModel", "");
                updateField("researchModel", "");
                updateField("visionModel", "");
                updateField("utilityModel", "");
              }}
              className="size-4 accent-terminal-green"
            />
            <span className="font-mono text-terminal-dark">{t("api.openrouter")}</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="radio"
              name="llmProvider"
              value="ollama"
              checked={formState.llmProvider === "ollama"}
              onChange={(e) => {
                updateField("llmProvider", e.target.value as FormState["llmProvider"]);
                updateField("chatModel", "");
                updateField("researchModel", "");
                updateField("visionModel", "");
                updateField("utilityModel", "");
              }}
              className="size-4 accent-terminal-green"
            />
            <span className="font-mono text-terminal-dark">
              {t("api.ollama")}
              <span
                className={cn(
                  "ml-2 inline-block size-2 rounded-full",
                  ollamaTest.status === "success" && "bg-green-500",
                  ollamaTest.status === "error" && "bg-red-500",
                  ollamaTest.status === "loading" && "bg-gray-400 animate-pulse",
                  ollamaTest.status === "untested" && "bg-gray-400",
                )}
                title={
                  ollamaTest.status === "success"
                    ? `Connected (${ollamaTest.modelCount} models)`
                    : ollamaTest.status === "error"
                      ? ollamaTest.error
                      : ollamaTest.status === "loading"
                        ? "Testing..."
                        : "Not tested"
                }
              />
            </span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="radio"
              name="llmProvider"
              value="vllm"
              checked={formState.llmProvider === "vllm"}
              onChange={(e) => {
                updateField("llmProvider", e.target.value as FormState["llmProvider"]);
                updateField("chatModel", "");
                updateField("researchModel", "");
                updateField("visionModel", "");
                updateField("utilityModel", "");
              }}
              className="size-4 accent-terminal-green"
            />
            <span className="font-mono text-terminal-dark">{t("api.vllm")}</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="radio"
              name="llmProvider"
              value="kimi"
              checked={formState.llmProvider === "kimi"}
              onChange={(e) => {
                updateField("llmProvider", e.target.value as FormState["llmProvider"]);
                updateField("chatModel", "");
                updateField("researchModel", "");
                updateField("visionModel", "");
                updateField("utilityModel", "");
              }}
              className="size-4 accent-terminal-green"
            />
            <span className="font-mono text-terminal-dark">{t("api.kimi")}</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="radio"
              name="llmProvider"
              value="minimax"
              checked={formState.llmProvider === "minimax"}
              onChange={(e) => {
                updateField("llmProvider", e.target.value as FormState["llmProvider"]);
                updateField("chatModel", "");
                updateField("researchModel", "");
                updateField("visionModel", "");
                updateField("utilityModel", "");
              }}
              className="size-4 accent-terminal-green"
            />
            <span className="font-mono text-terminal-dark">{t("api.minimax")}</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="radio"
              name="llmProvider"
              value="blackboxai"
              checked={formState.llmProvider === "blackboxai"}
              onChange={(e) => {
                updateField("llmProvider", e.target.value as FormState["llmProvider"]);
                updateField("chatModel", "");
                updateField("researchModel", "");
                updateField("visionModel", "");
                updateField("utilityModel", "");
              }}
              className="size-4 accent-terminal-green"
            />
            <span className="font-mono text-terminal-dark">{t("api.blackboxai")}</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="radio"
              name="llmProvider"
              value="codex"
              checked={formState.llmProvider === "codex"}
              onChange={(e) => {
                updateField("llmProvider", e.target.value as FormState["llmProvider"]);
                updateField("chatModel", "");
                updateField("researchModel", "");
                updateField("visionModel", "");
                updateField("utilityModel", "");
              }}
              disabled={!codexAuth?.isAuthenticated}
              className="size-4 accent-terminal-green disabled:opacity-50"
            />
            <span className={cn(
              "font-mono",
              codexAuth?.isAuthenticated ? "text-terminal-dark" : "text-terminal-muted"
            )}>
              Codex
              {codexAuth?.isAuthenticated && (
                <span className="ml-2 text-xs text-terminal-green">{t("api.readyStatus")}</span>
              )}
            </span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="radio"
              name="llmProvider"
              value="claudecode"
              checked={formState.llmProvider === "claudecode"}
              onChange={(e) => {
                updateField("llmProvider", e.target.value as FormState["llmProvider"]);
                updateField("chatModel", "");
                updateField("researchModel", "");
                updateField("visionModel", "");
                updateField("utilityModel", "");
              }}
              disabled={!claudecodeAuth?.isAuthenticated}
              className="size-4 accent-terminal-green disabled:opacity-50"
            />
            <span className={cn(
              "font-mono",
              claudecodeAuth?.isAuthenticated ? "text-terminal-dark" : "text-terminal-muted"
            )}>
              Claude Code
              {claudecodeAuth?.isAuthenticated && (
                <span className="ml-2 text-xs text-terminal-green">{t("api.readyStatus")}</span>
              )}
            </span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="radio"
              name="llmProvider"
              value="antigravity"
              checked={formState.llmProvider === "antigravity"}
              onChange={(e) => {
                updateField("llmProvider", e.target.value as FormState["llmProvider"]);
                updateField("chatModel", "");
                updateField("researchModel", "");
                updateField("visionModel", "");
                updateField("utilityModel", "");
              }}
              disabled={!antigravityAuth?.isAuthenticated}
              className="size-4 accent-terminal-green disabled:opacity-50"
            />
            <span className={cn(
              "font-mono",
              antigravityAuth?.isAuthenticated ? "text-terminal-dark" : "text-terminal-muted"
            )}>
              Antigravity
              {antigravityAuth?.isAuthenticated && (
                <span className="ml-2 text-xs text-terminal-green">{t("api.readyStatus")}</span>
              )}
            </span>
          </label>
        </div>
      </div>

      {/* Antigravity OAuth Section */}
      <div className="rounded-lg border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-mono text-sm font-semibold text-terminal-dark">
              {t("api.auth.antigravityTitle")}
            </h3>
            <p className="mt-1 font-mono text-xs text-terminal-muted">
              {t("api.auth.antigravityDesc")}
            </p>
            <p className="mt-1 font-mono text-xs text-terminal-amber inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {t("api.auth.antigravityWarning")}
            </p>
            {antigravityAuth?.isAuthenticated && antigravityAuth.email && (
              <p className="mt-1 font-mono text-xs text-terminal-green">
                {t("api.auth.signedIn", { email: antigravityAuth.email })}
              </p>
            )}
          </div>
          <div>
            {antigravityAuth?.isAuthenticated ? (
              <button
                onClick={onAntigravityLogout}
                disabled={antigravityLoading}
                className="rounded border border-red-300 bg-red-50 px-3 py-1.5 font-mono text-xs text-red-600 hover:bg-red-100 disabled:opacity-50"
              >
                {antigravityLoading ? "..." : t("api.auth.signOut")}
              </button>
            ) : (
              <button
                onClick={onAntigravityLogin}
                disabled={antigravityLoading}
                className="rounded border border-terminal-green bg-terminal-green/10 px-3 py-1.5 font-mono text-xs text-terminal-green hover:bg-terminal-green/20 disabled:opacity-50"
              >
                {antigravityLoading ? t("api.auth.connecting") : t("api.auth.signInGoogle")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Codex OAuth Section */}
      <div className="rounded-lg border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-mono text-sm font-semibold text-terminal-dark">
              {t("api.auth.codexTitle")}
            </h3>
            <p className="mt-1 font-mono text-xs text-terminal-muted">
              {t("api.auth.codexDesc")}
            </p>
            {codexAuth?.isAuthenticated && (codexAuth.email || codexAuth.accountId) && (
              <p className="mt-1 font-mono text-xs text-terminal-green">
                {t("api.auth.signedIn", { email: codexAuth.email || codexAuth.accountId || "" })}
              </p>
            )}
          </div>
          <div>
            {codexAuth?.isAuthenticated ? (
              <button
                onClick={onCodexLogout}
                disabled={codexLoading}
                className="rounded border border-red-300 bg-red-50 px-3 py-1.5 font-mono text-xs text-red-600 hover:bg-red-100 disabled:opacity-50"
              >
                {codexLoading ? "..." : t("api.auth.signOut")}
              </button>
            ) : (
              <button
                onClick={onCodexLogin}
                disabled={codexLoading}
                className="rounded border border-terminal-green bg-terminal-green/10 px-3 py-1.5 font-mono text-xs text-terminal-green hover:bg-terminal-green/20 disabled:opacity-50"
              >
                {codexLoading ? t("api.auth.connecting") : t("api.auth.signInOpenAI")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Claude Code OAuth Section */}
      <div className="rounded-lg border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-mono text-sm font-semibold text-terminal-dark">
              {t("api.auth.claudecodeTitle")}
            </h3>
            <p className="mt-1 font-mono text-xs text-terminal-muted">
              {t("api.auth.claudecodeDesc")}
            </p>
            <p className="mt-1 font-mono text-xs text-terminal-blue inline-flex items-center gap-1">
              <Info className="w-3 h-3" />
              {t("api.auth.claudecodeWarning")}
            </p>
            <p className="mt-1 font-mono text-xs text-amber-600">
              {t("api.auth.claudecodeLoginHint")}
            </p>
            {claudecodeAuth?.isAuthenticated && claudecodeAuth.email && (
              <p className="mt-1 font-mono text-xs text-terminal-green">
                {t("api.auth.signedIn", { email: claudecodeAuth.email })}
              </p>
            )}
          </div>
          <div>
            {claudecodeAuth?.isAuthenticated ? (
              <button
                onClick={onClaudeCodeLogout}
                disabled={claudecodeLoading}
                className="rounded border border-red-300 bg-red-50 px-3 py-1.5 font-mono text-xs text-red-600 hover:bg-red-100 disabled:opacity-50"
              >
                {claudecodeLoading ? "..." : t("api.auth.signOut")}
              </button>
            ) : !claudeCodePasteMode ? (
              <button
                onClick={onClaudeCodeLogin}
                disabled={claudecodeLoading}
                className="rounded border border-terminal-green bg-terminal-green/10 px-3 py-1.5 font-mono text-xs text-terminal-green hover:bg-terminal-green/20 disabled:opacity-50"
              >
                {claudecodeLoading ? t("api.auth.connecting") : t("api.auth.signInAnthropic")}
              </button>
            ) : null}
          </div>
        </div>
        {claudeCodePasteMode && !claudecodeAuth?.isAuthenticated && (
          <ClaudeCodeAuthFlow
            loading={claudecodeLoading}
            success={claudeCodeAuthSuccess}
            browserOpened={claudeCodeBrowserOpened}
            diagnosticOutput={claudeCodeDiagnosticOutput}
            onSubmit={onClaudeCodePasteSubmit}
            onCancel={onClaudeCodePasteCancel}
            onComplete={onClaudeCodeAuthComplete}
          />
        )}
      </div>

      <div className="space-y-4">
        <h2 className="font-mono text-lg font-semibold text-terminal-dark">{t("api.keysTitle")}</h2>

        {formState.llmProvider === "ollama" && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.ollama.label")}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formState.ollamaBaseUrl}
                  onChange={(e) => updateField("ollamaBaseUrl", e.target.value)}
                  placeholder={t("api.fields.ollama.placeholder")}
                  className="flex-1 rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
                />
                <button
                  type="button"
                  onClick={() => testOllamaConnection(formState.ollamaBaseUrl)}
                  disabled={ollamaTest.status === "loading"}
                  className="shrink-0 rounded border border-terminal-green bg-terminal-green/10 px-3 py-2 font-mono text-xs text-terminal-green hover:bg-terminal-green/20 disabled:opacity-50"
                >
                  {ollamaTest.status === "loading" ? "Testing..." : "Test Connection"}
                </button>
              </div>
              {ollamaTest.status === "success" && (
                <p className="mt-1 font-mono text-xs text-green-600">
                  &#10003; Connected ({ollamaTest.modelCount} model{ollamaTest.modelCount !== 1 ? "s" : ""})
                </p>
              )}
              {ollamaTest.status === "error" && (
                <p className="mt-1 font-mono text-xs text-red-600">
                  &#10007; {ollamaTest.error || "Cannot reach Ollama"}
                </p>
              )}
              <p className="mt-1 font-mono text-xs text-terminal-muted">
                {t("api.fields.ollama.helper")}
              </p>
            </div>
            <div>
              <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.ollamaContextWindow.label")}</label>
              <input
                type="text"
                value={formState.ollamaContextWindow}
                onChange={(e) => updateField("ollamaContextWindow", e.target.value)}
                placeholder={t("api.fields.ollamaContextWindow.placeholder")}
                className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
              />
              <p className="mt-1 font-mono text-xs text-terminal-muted">
                {t("api.fields.ollamaContextWindow.helper")}
              </p>
            </div>
          </div>
        )}

        {formState.llmProvider === "vllm" && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.vllm.label")}</label>
              <input
                type="text"
                value={formState.vllmBaseUrl}
                onChange={(e) => updateField("vllmBaseUrl", e.target.value)}
                placeholder={t("api.fields.vllm.placeholder")}
                className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
              />
              <p className="mt-1 font-mono text-xs text-terminal-muted">
                {t("api.fields.vllm.helper")}
              </p>
            </div>
            <div>
              <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.vllmApiKey.label")}</label>
              <input
                type="password"
                value={formState.vllmApiKey}
                onChange={(e) => updateField("vllmApiKey", e.target.value)}
                placeholder={t("api.fields.vllmApiKey.placeholder")}
                className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
              />
              <p className="mt-1 font-mono text-xs text-terminal-muted">
                {t("api.fields.vllmApiKey.helper")}
              </p>
            </div>
            <div>
              <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.vllmContextWindow.label")}</label>
              <input
                type="text"
                value={formState.vllmContextWindow}
                onChange={(e) => updateField("vllmContextWindow", e.target.value)}
                placeholder={t("api.fields.vllmContextWindow.placeholder")}
                className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
              />
              <p className="mt-1 font-mono text-xs text-terminal-muted">
                {t("api.fields.vllmContextWindow.helper")}
              </p>
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.anthropic.label")}</label>
          <input
            type="password"
            value={formState.anthropicApiKey}
            onChange={(e) => updateField("anthropicApiKey", e.target.value)}
            placeholder={t("api.fields.anthropic.placeholder")}
            className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
          />
          <p className="mt-1 font-mono text-xs text-terminal-muted">{t("api.fields.anthropic.helper")}</p>
        </div>

        <div>
          <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.openrouter.label")}</label>
          <input
            type="password"
            value={formState.openrouterApiKey}
            onChange={(e) => updateField("openrouterApiKey", e.target.value)}
            placeholder={t("api.fields.openrouter.placeholder")}
            className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
          />
          <p className="mt-1 font-mono text-xs text-terminal-muted">{t("api.fields.openrouter.helper")}</p>
        </div>

        <div>
          <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.kimi.label")}</label>
          <input
            type="password"
            value={formState.kimiApiKey}
            onChange={(e) => updateField("kimiApiKey", e.target.value)}
            placeholder={t("api.fields.kimi.placeholder")}
            className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
          />
          <p className="mt-1 font-mono text-xs text-terminal-muted">{t("api.fields.kimi.helper")}</p>
        </div>

        <div>
          <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.minimax.label")}</label>
          <input
            type="password"
            value={formState.minimaxApiKey}
            onChange={(e) => updateField("minimaxApiKey", e.target.value)}
            placeholder={t("api.fields.minimax.placeholder")}
            className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
          />
          <p className="mt-1 font-mono text-xs text-terminal-muted">{t("api.fields.minimax.helper")}</p>
        </div>

        <div>
          <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.blackboxai.label")}</label>
          <input
            type="password"
            value={formState.blackboxaiApiKey}
            onChange={(e) => updateField("blackboxaiApiKey", e.target.value)}
            placeholder={t("api.fields.blackboxai.placeholder")}
            className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
          />
          <p className="mt-1 font-mono text-xs text-terminal-muted">{t("api.fields.blackboxai.helper")}</p>
        </div>

        <div>
          <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.openai.label")}</label>
          <input
            type="password"
            value={formState.openaiApiKey}
            onChange={(e) => updateField("openaiApiKey", e.target.value)}
            placeholder={t("api.fields.openai.placeholder")}
            className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
          />
          <p className="mt-1 font-mono text-xs text-terminal-muted">
            {t("api.fields.openai.helper")}{" "}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-terminal-green underline hover:text-terminal-green/80">
              platform.openai.com
            </a>
          </p>
        </div>

        <div>
          <label className="mb-1 block font-mono text-sm text-terminal-muted">
            {t("api.fields.webSearchProvider.label")}
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-3">
              <input
                type="radio"
                name="webSearchProvider"
                value="auto"
                checked={formState.webSearchProvider === "auto"}
                onChange={(e) => updateField("webSearchProvider", e.target.value as FormState["webSearchProvider"])}
                className="size-4 accent-terminal-green"
              />
              <span className="font-mono text-terminal-dark">
                {t("api.fields.webSearchProvider.options.auto")}
              </span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="radio"
                name="webSearchProvider"
                value="tavily"
                checked={formState.webSearchProvider === "tavily"}
                onChange={(e) => updateField("webSearchProvider", e.target.value as FormState["webSearchProvider"])}
                className="size-4 accent-terminal-green"
              />
              <span className="font-mono text-terminal-dark">
                {t("api.fields.webSearchProvider.options.tavily")}
              </span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="radio"
                name="webSearchProvider"
                value="duckduckgo"
                checked={formState.webSearchProvider === "duckduckgo"}
                onChange={(e) => updateField("webSearchProvider", e.target.value as FormState["webSearchProvider"])}
                className="size-4 accent-terminal-green"
              />
              <span className="font-mono text-terminal-dark">
                {t("api.fields.webSearchProvider.options.duckduckgo")}
              </span>
            </label>
          </div>
          <p className="mt-1 font-mono text-xs text-terminal-muted">
            {t("api.fields.webSearchProvider.helper")}
          </p>
        </div>

        <div>
          <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.tavily.label")}</label>
          <input
            type="password"
            value={formState.tavilyApiKey}
            onChange={(e) => updateField("tavilyApiKey", e.target.value)}
            placeholder={t("api.fields.tavily.placeholder")}
            className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
          />
          <p className="mt-1 font-mono text-xs text-terminal-muted">{t("api.fields.tavily.helper")}</p>
        </div>

        <div>
          <label className="mb-1 block font-mono text-sm text-terminal-muted">
            {t("api.fields.webScraperProvider.label")}
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-3">
              <input
                type="radio"
                name="webScraperProvider"
                value="firecrawl"
                checked={formState.webScraperProvider === "firecrawl"}
                onChange={(e) => updateField("webScraperProvider", e.target.value as FormState["webScraperProvider"])}
                className="size-4 accent-terminal-green"
              />
              <span className="font-mono text-terminal-dark">
                {t("api.fields.webScraperProvider.options.firecrawl")}
              </span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="radio"
                name="webScraperProvider"
                value="local"
                checked={formState.webScraperProvider === "local"}
                onChange={(e) => updateField("webScraperProvider", e.target.value as FormState["webScraperProvider"])}
                className="size-4 accent-terminal-green"
              />
              <span className="font-mono text-terminal-dark">
                {t("api.fields.webScraperProvider.options.local")}
              </span>
            </label>
          </div>
          <p className="mt-1 font-mono text-xs text-terminal-muted">
            {t("api.fields.webScraperProvider.helper")}
          </p>
        </div>

        <div>
          <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.firecrawl.label")}</label>
          <input
            type="password"
            value={formState.firecrawlApiKey}
            onChange={(e) => updateField("firecrawlApiKey", e.target.value)}
            placeholder={t("api.fields.firecrawl.placeholder")}
            className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
          />
          <p className="mt-1 font-mono text-xs text-terminal-muted">{t("api.fields.firecrawl.helper")}</p>
        </div>

        <div>
          <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.selene.label")}</label>
          <input
            type="password"
            value={formState.stylyAiApiKey}
            onChange={(e) => updateField("stylyAiApiKey", e.target.value)}
            placeholder={t("api.fields.selene.placeholder")}
            className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
          />
          <p className="mt-1 font-mono text-xs text-terminal-muted">{t("api.fields.selene.helper")}</p>
        </div>
      </div>

      {/* Video Generation */}
      <div className="space-y-2">
        <h2 className="font-mono text-lg font-semibold text-terminal-dark">{t("api.videoTitle")}</h2>
        <p className="font-mono text-xs text-terminal-muted">{t("api.videoDescription")}</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.runway.label")}</label>
          <input
            type="password"
            value={formState.runwayApiSecret}
            onChange={(e) => updateField("runwayApiSecret", e.target.value)}
            placeholder={t("api.fields.runway.placeholder")}
            className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
          />
          <p className="mt-1 font-mono text-xs text-terminal-muted">
            {t("api.fields.runway.helper")}{" "}
            <a href="https://app.runwayml.com/settings/api-keys" target="_blank" rel="noopener noreferrer" className="text-terminal-green underline hover:text-terminal-green/80">
              runwayml.com
            </a>
          </p>
        </div>

        <div>
          <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.vertexProjectId.label")}</label>
          <input
            type="text"
            value={formState.vertexAIProjectId}
            onChange={(e) => updateField("vertexAIProjectId", e.target.value)}
            placeholder={t("api.fields.vertexProjectId.placeholder")}
            className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
          />
          <p className="mt-1 font-mono text-xs text-terminal-muted">{t("api.fields.vertexProjectId.helper")}</p>
        </div>

        <div>
          <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.vertexLocation.label")}</label>
          <input
            type="text"
            value={formState.vertexAILocation}
            onChange={(e) => updateField("vertexAILocation", e.target.value)}
            placeholder="us-central1"
            className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
          />
          <p className="mt-1 font-mono text-xs text-terminal-muted">{t("api.fields.vertexLocation.helper")}</p>
        </div>

        <div>
          <label className="mb-1 block font-mono text-sm text-terminal-muted">{t("api.fields.googleCredentials.label")}</label>
          <input
            type="text"
            value={formState.vertexAICredentialsPath}
            onChange={(e) => updateField("vertexAICredentialsPath", e.target.value)}
            placeholder={t("api.fields.googleCredentials.placeholder")}
            className="w-full rounded border border-terminal-border bg-terminal-cream/95 dark:bg-terminal-cream-dark/50 px-3 py-2 font-mono text-sm text-terminal-dark placeholder:text-terminal-muted/50 focus:border-terminal-green focus:outline-none focus:ring-1 focus:ring-terminal-green"
          />
          <p className="mt-1 font-mono text-xs text-terminal-muted">{t("api.fields.googleCredentials.helper")}</p>
        </div>
      </div>
    </div>
  );
}
