"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { ComputerGraphic } from "../computer-graphic";
import { TypewriterText } from "@/components/ui/typewriter-text";
import { TerminalPrompt } from "@/components/ui/terminal-prompt";
import { useReducedMotion } from "../hooks/use-reduced-motion";
import { useTranslations } from "next-intl";
import { resilientFetch } from "@/lib/utils/resilient-fetch";
import {
    CloudIcon,
    HardDriveIcon,
    CheckCircleIcon,
    AlertCircleIcon,
    Loader2Icon,
} from "lucide-react";
import {
    OPENROUTER_EMBEDDING_MODELS,
    LOCAL_EMBEDDING_MODELS,
    type EmbeddingModelInfo,
} from "@/lib/config/embedding-models";

/** Type-safe accessor for the Electron model API surface used on this page. */
interface ElectronModelAPI {
    checkExists: (id: string) => Promise<boolean>;
    download: (id: string) => Promise<{ success: boolean; error?: string } | undefined>;
    cancelDownload: (id: string) => Promise<void>;
    getDownloadState: (id: string) => Promise<{
        status: "downloading" | "error" | "idle";
        progress: number;
        downloadedBytes: number;
        totalBytes: number;
        currentFile: string;
        error?: string;
    } | null>;
    onProgress: (cb: (data: DownloadProgressEvent) => void) => void;
    removeProgressListener?: () => void;
}

interface DownloadProgressEvent {
    modelId: string;
    progress?: number;
    downloadedBytes?: number;
    totalBytes?: number;
    speed?: number;
    file?: string;
    status?: "downloading" | "completed" | "error";
    error?: string;
}

function getElectronModelAPI(): ElectronModelAPI | null {
    if (typeof window === "undefined" || !("electronAPI" in window)) return null;
    const api = (window as unknown as { electronAPI?: { model?: ElectronModelAPI } }).electronAPI;
    return api?.model ?? null;
}

// Derive UI models from shared registry (single source of truth)
const OPENROUTER_MODELS = OPENROUTER_EMBEDDING_MODELS.map((m: EmbeddingModelInfo) => ({
    id: m.id,
    name: m.name,
    description: `${m.description || ""}, ${m.dimensions} dimensions`.replace(/^, /, ""),
    recommended: m.recommended ?? false,
}));

const LOCAL_MODELS = LOCAL_EMBEDDING_MODELS.map((m: EmbeddingModelInfo) => ({
    id: m.id,
    name: m.name,
    description: `${m.dimensions} dimensions${m.size ? `, ~${m.size} download` : ""}`,
    recommended: m.recommended ?? false,
}));

interface EmbeddingSetupPageProps {
    agentName: string;
    onSubmit: (config: { provider: string; model: string; apiKey?: string }) => void;
    onBack: () => void;
    onSkip: () => void;
}

export function EmbeddingSetupPage({
    agentName,
    onSubmit,
    onBack,
    onSkip,
}: EmbeddingSetupPageProps) {
    const t = useTranslations("characterCreation.embeddingSetup");
    const [provider, setProvider] = useState<"openrouter" | "local">("openrouter");
    const [selectedModel, setSelectedModel] = useState(OPENROUTER_MODELS[0].id);
    const [hasOpenRouterKey, setHasOpenRouterKey] = useState<boolean | null>(null);
    const [apiKey, setApiKey] = useState("");
    const [editingApiKey, setEditingApiKey] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [modelStatus, setModelStatus] = useState<Record<string, boolean>>({});
    const [downloadError, setDownloadError] = useState<string | null>(null);
    const [downloadSpeed, setDownloadSpeed] = useState(0);
    const [downloadedBytes, setDownloadedBytes] = useState(0);
    const [totalBytes, setTotalBytes] = useState(0);
    const [currentFile, setCurrentFile] = useState("");
    const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
    const prefersReducedMotion = useReducedMotion();
    const hasAnimated = useRef(false);

    // Check if OpenRouter API key is configured
    useEffect(() => {
        resilientFetch<{ openrouterApiKey?: string }>("/api/settings")
            .then(({ data }) => {
                setHasOpenRouterKey(!!data?.openrouterApiKey);
                // If no OpenRouter key, default to local
                if (!data?.openrouterApiKey) {
                    setProvider("local");
                    setSelectedModel(LOCAL_MODELS[0].id);
                }
            });
    }, []);

    // Check local model status in Electron
    useEffect(() => {
        const checkModels = async () => {
            const modelAPI = getElectronModelAPI();
            if (!modelAPI) return;

            const status: Record<string, boolean> = {};
            for (const model of LOCAL_MODELS) {
                try {
                    status[model.id] = await modelAPI.checkExists(model.id);
                } catch {
                    status[model.id] = false;
                }
            }
            setModelStatus(status);
        };
        checkModels();
    }, []);

    const attachProgressListener = useCallback((modelId: string) => {
        const modelAPI = getElectronModelAPI();
        if (!modelAPI?.onProgress) return;

        // Remove any existing listener before attaching a new one
        modelAPI.removeProgressListener?.();

        modelAPI.onProgress((data: DownloadProgressEvent) => {
            if (data.modelId !== modelId) return;
            if (data.progress !== undefined) setDownloadProgress(data.progress);
            if (data.downloadedBytes !== undefined) setDownloadedBytes(data.downloadedBytes);
            if (data.totalBytes !== undefined) setTotalBytes(data.totalBytes);
            if (data.speed !== undefined) setDownloadSpeed(data.speed);
            if (data.file) setCurrentFile(data.file);
            if (data.status === "completed") {
                setIsDownloading(false);
                setDownloadingModelId(null);
                setDownloadError(null);
                setModelStatus((prev) => ({ ...prev, [modelId]: true }));
                modelAPI.removeProgressListener?.();
            }
            if (data.status === "error") {
                setIsDownloading(false);
                setDownloadingModelId(null);
                setDownloadError(data.error || "Download failed");
                modelAPI.removeProgressListener?.();
            }
        });
    }, []);

    // Check for active downloads on mount (survives navigation)
    useEffect(() => {
        const checkActiveDownloads = async () => {
            const modelAPI = getElectronModelAPI();
            if (!modelAPI?.getDownloadState) return;

            for (const model of LOCAL_MODELS) {
                try {
                    const state = await modelAPI.getDownloadState(model.id);
                    if (state && state.status === "downloading") {
                        setIsDownloading(true);
                        setDownloadingModelId(model.id);
                        setSelectedModel(model.id);
                        setProvider("local");
                        setDownloadProgress(state.progress);
                        setDownloadedBytes(state.downloadedBytes);
                        setTotalBytes(state.totalBytes);
                        setCurrentFile(state.currentFile);
                        attachProgressListener(model.id);
                        break;
                    }
                    if (state && state.status === "error") {
                        setDownloadError(state.error || "Download failed");
                    }
                } catch { /* ignore */ }
            }
        };
        checkActiveDownloads();
    }, [attachProgressListener]);

    const handleProviderChange = (newProvider: "openrouter" | "local") => {
        if (isDownloading) return; // Prevent switching providers during download
        setProvider(newProvider);
        setSelectedModel(
            newProvider === "openrouter" ? OPENROUTER_MODELS[0].id : LOCAL_MODELS[0].id
        );
    };

    const handleDownload = async (modelId: string) => {
        const modelAPI = getElectronModelAPI();
        if (!modelAPI?.download) return;

        setIsDownloading(true);
        setDownloadingModelId(modelId);
        setDownloadProgress(0);
        setDownloadError(null);
        setDownloadedBytes(0);
        setTotalBytes(0);
        setCurrentFile("Preparing...");
        setDownloadSpeed(0);

        attachProgressListener(modelId);

        try {
            const result = await modelAPI.download(modelId);
            if (result && !result.success && result.error) {
                setDownloadError(result.error);
                setIsDownloading(false);
                setDownloadingModelId(null);
            }
        } catch (err) {
            setDownloadError(err instanceof Error ? err.message : "Download failed");
            setIsDownloading(false);
            setDownloadingModelId(null);
        }
    };

    const handleCancelDownload = async () => {
        const modelAPI = getElectronModelAPI();
        if (!modelAPI?.cancelDownload || !downloadingModelId) return;

        modelAPI.removeProgressListener?.();
        await modelAPI.cancelDownload(downloadingModelId);
        setIsDownloading(false);
        setDownloadingModelId(null);
        setDownloadProgress(0);
        setDownloadError("Download cancelled");
    };

    const formatBytes = (bytes: number): string => {
        if (bytes <= 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB", "TB"];
        const i = Math.min(
            Math.floor(Math.log(bytes) / Math.log(k)),
            sizes.length - 1
        );
        return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
    };

    const handleSubmit = () => {
        if (provider === "openrouter" && !hasOpenRouterKey && !apiKey) {
            return;
        }
        onSubmit({ provider, model: selectedModel, apiKey: apiKey || undefined });
    };

    const models = provider === "openrouter" ? OPENROUTER_MODELS : LOCAL_MODELS;
    const isElectron = typeof window !== "undefined" && "electronAPI" in window;
    const needsDownload =
        provider === "local" && isElectron && !modelStatus[selectedModel];

    return (
        <div className="flex h-full min-h-full flex-col items-center bg-terminal-cream px-4 py-6 sm:px-8">
            <div className="flex w-full max-w-4xl flex-1 flex-col gap-6 min-h-0">
                {/* Header */}
                <div className="flex items-start gap-8">
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: prefersReducedMotion ? 0 : 0.5 }}
                    >
                        <ComputerGraphic size="sm" />
                    </motion.div>

                    <div className="flex-1 space-y-4">
                        <TerminalPrompt
                            prefix="step-3"
                            symbol="$"
                            animate={!prefersReducedMotion}
                        >
                            <span className="text-terminal-amber">
                                agent.configureEmbeddings(&quot;{agentName}&quot;)
                            </span>
                        </TerminalPrompt>

                        <div className="font-mono text-lg text-terminal-dark">
                            {!hasAnimated.current ? (
                                <TypewriterText
                                    text={t("question")}
                                    delay={prefersReducedMotion ? 0 : 200}
                                    speed={prefersReducedMotion ? 0 : 25}
                                    onComplete={() => {
                                        hasAnimated.current = true;
                                    }}
                                    showCursor={false}
                                />
                            ) : (
                                <span>{t("question")}</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Explanation */}
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: prefersReducedMotion ? 0 : 0.4, delay: prefersReducedMotion ? 0 : 0.2 }}
                    className="font-mono text-sm text-terminal-dark/60 -mt-2"
                >
                    {t("explanation")}
                </motion.p>

                {/* Provider Selection */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: prefersReducedMotion ? 0 : 0.4, delay: prefersReducedMotion ? 0 : 0.3 }}
                    className="flex min-h-0 flex-1 flex-col rounded-lg border border-terminal-border bg-terminal-bg/30"
                >
                        <div className="flex-1 min-h-0 overflow-y-auto p-5">
                            {/* Provider Toggle */}
                            <div className="flex gap-4 mb-6">
                                <ProviderCard
                                    icon={<CloudIcon className="w-5 h-5" />}
                                    title={t("providers.openrouter.title")}
                                    description={t("providers.openrouter.description")}
                                    selected={provider === "openrouter"}
                                    disabled={isDownloading}
                                    onClick={() => handleProviderChange("openrouter")}
                                />
                                <ProviderCard
                                    icon={<HardDriveIcon className="w-5 h-5" />}
                                    title={t("providers.local.title")}
                                    description={t("providers.local.description")}
                                    selected={provider === "local"}
                                    disabled={isDownloading}
                                    onClick={() => handleProviderChange("local")}
                                />
                            </div>



                            {/* API Key Input for OpenRouter */}
                            {provider === "openrouter" && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    className="mb-6"
                                >
                                    <label className="block text-sm font-mono text-terminal-dark mb-2">
                                        {t("apiKeyLabel")}
                                    </label>
                                    {hasOpenRouterKey && !editingApiKey ? (
                                        <div className="flex items-center gap-2 rounded border border-terminal-green/40 bg-terminal-green/5 px-3 py-2">
                                            <CheckCircleIcon className="w-4 h-4 text-terminal-green" />
                                            <span className="font-mono text-sm text-terminal-green">{t("apiKeyConfigured")}</span>
                                            <button
                                                type="button"
                                                onClick={() => setEditingApiKey(true)}
                                                className="ml-auto text-xs font-mono text-terminal-dark/50 hover:text-terminal-dark transition-colors"
                                            >
                                                {t("change")}
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex gap-2">
                                                <input
                                                    type="password"
                                                    value={apiKey}
                                                    onChange={(e) => setApiKey(e.target.value)}
                                                    placeholder="sk-or-..."
                                                    className="flex-1 rounded border border-terminal-border bg-terminal-cream px-3 py-2 font-mono text-sm focus:border-terminal-amber focus:outline-none"
                                                />
                                            </div>
                                            {!hasOpenRouterKey && !apiKey && (
                                                <p className="mt-1 text-xs font-mono text-terminal-amber flex items-center gap-1">
                                                    <AlertCircleIcon className="w-3 h-3" />
                                                    {t("apiKeyRequired")}
                                                </p>
                                            )}
                                        </>
                                    )}
                                </motion.div>
                            )}

                            {/* Model Selection */}
                            <div className="space-y-3">
                                <h3 className="text-sm font-mono font-semibold text-terminal-amber">
                                    {t("selectModel")}
                                </h3>
                                <div className="grid gap-2" role="radiogroup" aria-label={t("selectModel")}>
                                    {models.map((model) => (
                                        <ModelCard
                                            key={model.id}
                                            model={model}
                                            selected={selectedModel === model.id}
                                            downloaded={modelStatus[model.id]}
                                            disabled={isDownloading}
                                            onClick={() => {
                                                if (!isDownloading) setSelectedModel(model.id);
                                            }}
                                            recommendedLabel={t("models.recommended")}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Download Progress Bar (shown during/after download) */}
                        {(isDownloading || downloadError) && provider === "local" && (
                            <div className="border-t border-terminal-border/50 bg-terminal-bg/20 px-5 py-3">
                                {isDownloading && (
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-xs font-mono text-terminal-dark/70">
                                            <span className="truncate max-w-[60%]">{currentFile}</span>
                                            <span>
                                                {formatBytes(downloadedBytes)} / {formatBytes(totalBytes)}
                                                {downloadSpeed > 0 && ` · ${formatBytes(downloadSpeed)}/s`}
                                            </span>
                                        </div>
                                        <div
                                            className="h-2 w-full rounded-full bg-terminal-border/30 overflow-hidden"
                                            role="progressbar"
                                            aria-valuenow={Math.round(downloadProgress)}
                                            aria-valuemin={0}
                                            aria-valuemax={100}
                                            aria-label={`Download progress: ${Math.round(downloadProgress)}%`}
                                        >
                                            <div
                                                className="h-full rounded-full bg-terminal-amber transition-all duration-300 ease-out"
                                                style={{ width: `${downloadProgress}%` }}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-mono text-terminal-dark/50">
                                                {Math.round(downloadProgress)}% complete
                                            </span>
                                            <button
                                                onClick={handleCancelDownload}
                                                aria-label="Cancel download"
                                                className="text-xs font-mono text-red-500/70 hover:text-red-500 transition-colors"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}
                                {downloadError && !isDownloading && (
                                    <div className="flex items-center gap-2 rounded border border-red-300/50 bg-red-50/50 px-3 py-2">
                                        <AlertCircleIcon className="w-4 h-4 text-red-500 flex-shrink-0" />
                                        <span className="text-xs font-mono text-red-600 flex-1">{downloadError}</span>
                                        <button
                                            onClick={() => {
                                                setDownloadError(null);
                                                handleDownload(selectedModel);
                                            }}
                                            aria-label="Retry download"
                                            className="text-xs font-mono text-terminal-amber hover:text-terminal-amber/80 font-semibold flex-shrink-0"
                                        >
                                            Retry
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Navigation */}
                        <div className="flex flex-col gap-3 border-t border-terminal-border/50 bg-terminal-cream/90 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                            <button
                                onClick={onBack}
                                disabled={isDownloading}
                                className={`order-2 text-sm font-mono transition-colors sm:order-1 ${
                                    isDownloading
                                        ? "text-terminal-dark/30 cursor-not-allowed"
                                        : "text-terminal-dark/60 hover:text-terminal-dark"
                                }`}
                            >
                                {t("back")}
                            </button>
                            <div className="flex gap-3 order-1 sm:order-2">
                                <button
                                    onClick={onSkip}
                                    disabled={isDownloading}
                                    className={`text-sm font-mono transition-colors ${
                                        isDownloading
                                            ? "text-terminal-dark/30 cursor-not-allowed"
                                            : "text-terminal-dark/60 hover:text-terminal-dark"
                                    }`}
                                >
                                    {t("skip")}
                                </button>
                                {needsDownload ? (
                                    <button
                                        onClick={() => handleDownload(selectedModel)}
                                        disabled={isDownloading}
                                        className="w-full rounded bg-terminal-amber px-4 py-2 text-sm font-mono text-white transition-colors hover:bg-terminal-amber/90 disabled:opacity-70 sm:w-auto flex items-center justify-center gap-2"
                                    >
                                        {isDownloading ? (
                                            <>
                                                <Loader2Icon className="w-4 h-4 animate-spin" />
                                                Downloading...
                                            </>
                                        ) : downloadError ? (
                                            "Retry Download"
                                        ) : (
                                            t("downloading").replace("...", "")
                                        )}
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleSubmit}
                                        className="w-full rounded bg-terminal-dark px-4 py-2 text-sm font-mono text-terminal-cream transition-colors hover:bg-terminal-dark/90 sm:w-auto"
                                    >
                                        {t("continue")}
                                    </button>
                                )}
                            </div>
                        </div>
                    </motion.div>
            </div>
        </div >
    );
}

// Helper Components
function ProviderCard({
    icon,
    title,
    description,
    selected,
    disabled,
    warning,
    onClick,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
    selected: boolean;
    disabled?: boolean;
    warning?: string;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            aria-pressed={selected}
            aria-label={title}
            className={`flex-1 p-4 rounded-lg border-2 transition-all text-left ${selected
                ? "border-terminal-amber bg-terminal-amber/10"
                : disabled
                    ? "border-terminal-border/50 bg-terminal-bg/20 opacity-60 cursor-not-allowed"
                    : "border-terminal-border hover:border-terminal-amber/50"
                }`}
        >
            <div className="flex items-center gap-3 mb-2">
                <div className={selected ? "text-terminal-amber" : "text-terminal-dark/60"}>
                    {icon}
                </div>
                <span className="font-mono font-semibold text-terminal-dark">{title}</span>
                {selected && (
                    <CheckCircleIcon className="w-4 h-4 text-terminal-green ml-auto" />
                )}
            </div>
            <p className="text-sm text-terminal-dark/70">{description}</p>
            {warning && (
                <div className="flex items-center gap-2 mt-2 text-xs text-terminal-amber">
                    <AlertCircleIcon className="w-3 h-3" />
                    <span>{warning}</span>
                </div>
            )}
        </button>
    );
}

function ModelCard({
    model,
    selected,
    downloaded,
    disabled,
    onClick,
    recommendedLabel,
}: {
    model: { id: string; name: string; description: string; recommended: boolean };
    selected: boolean;
    downloaded?: boolean;
    disabled?: boolean;
    onClick: () => void;
    recommendedLabel: string;
}) {
    return (
        <button
            role="radio"
            aria-checked={selected}
            aria-label={`${model.name}${model.recommended ? ` (${recommendedLabel})` : ""}${downloaded ? " (downloaded)" : ""}`}
            onClick={onClick}
            disabled={disabled}
            className={`flex items-center justify-between p-3 rounded border transition-all ${selected
                ? "border-terminal-amber bg-terminal-amber/5"
                : disabled
                    ? "border-terminal-border/50 opacity-60 cursor-not-allowed"
                    : "border-terminal-border/50 hover:border-terminal-amber/30"
                }`}
        >
            <div className="flex items-center gap-3">
                <div
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${selected ? "border-terminal-amber" : "border-terminal-border"
                        }`}
                >
                    {selected && <div className="w-2 h-2 rounded-full bg-terminal-amber" />}
                </div>
                <div className="text-left">
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-terminal-dark">{model.name}</span>
                        {model.recommended && (
                            <span className="px-1.5 py-0.5 text-xs font-mono bg-terminal-green/20 text-terminal-green rounded">
                                {recommendedLabel}
                            </span>
                        )}
                        {downloaded && (
                            <CheckCircleIcon className="w-3.5 h-3.5 text-terminal-green" />
                        )}
                    </div>
                    <span className="text-xs text-terminal-dark/60">{model.description}</span>
                </div>
            </div>
        </button>
    );
}
