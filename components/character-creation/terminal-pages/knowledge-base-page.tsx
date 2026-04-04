"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { useReducedMotion } from "../hooks/use-reduced-motion";
import { useTranslations } from "next-intl";
import { resilientFetch, resilientDelete } from "@/lib/utils/resilient-fetch";
import { TerminalPageHeader } from "./terminal-page-header";
import { FileUploadArea, type UploadedDocument } from "./file-upload-area";

interface KnowledgeBasePageProps {
  agentId: string;
  agentName: string;
  initialDocuments?: UploadedDocument[];
  onSubmit: (documents: UploadedDocument[]) => void;
  onBack: () => void;
}

export function KnowledgeBasePage({
  agentId,
  agentName,
  initialDocuments = [],
  onSubmit,
  onBack,
}: KnowledgeBasePageProps) {
  const t = useTranslations("characterCreation.knowledgeBase");
  const [documents, setDocuments] = useState<UploadedDocument[]>(initialDocuments);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; filename: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const hasAnimated = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !uploading) onBack();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack, uploading]);

  // Fetch existing documents on mount
  useEffect(() => {
    if (!agentId) return;
    resilientFetch<{ documents?: UploadedDocument[] }>(`/api/characters/${agentId}/documents`)
      .then(({ data }) => {
        if (data?.documents) {
          setDocuments(data.documents);
        }
      })
      .catch((err) => console.error("Failed to load documents:", err));
  }, [agentId]);

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);

    const fileArray = Array.from(files);
    const total = fileArray.length;

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      setUploadProgress({ current: i + 1, total, filename: file.name });

      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", file.name);

      const { data, error: uploadError } = await resilientFetch<{ document: UploadedDocument; error?: string }>(
        `/api/characters/${agentId}/documents`,
        { method: "POST", body: formData, timeout: 30_000 },
      );
      if (uploadError || !data) {
        setError(data?.error || uploadError || "Upload failed");
        continue;
      }
      setDocuments((prev) => [...prev, data.document]);
    }
    setUploading(false);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [agentId]);

  const handleDelete = useCallback(async (docId: string) => {
    const { error } = await resilientDelete(`/api/characters/${agentId}/documents?documentId=${docId}`);
    if (!error) {
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } else {
      console.error("Delete failed:", error);
    }
  }, [agentId]);

  const handleSubmit = () => {
    onSubmit(documents);
  };

  return (
    <div className="flex h-full min-h-full flex-col items-center bg-terminal-cream px-4 py-6 sm:px-8">
      <div className="flex w-full max-w-2xl flex-1 flex-col gap-6 min-h-0">
        {/* Header */}
        <TerminalPageHeader
          step="step-3"
          command={<span className="text-terminal-amber">agent.knowledge({agentName})</span>}
          question={t("question")}
          prefersReducedMotion={prefersReducedMotion}
          hasAnimated={hasAnimated}
          onAnimationComplete={() => setShowForm(true)}
        />

        {/* Upload Section - Scrollable Container */}
        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.3 }}
            className="flex min-h-0 flex-1 flex-col rounded-lg border border-terminal-border bg-terminal-bg/30"
          >
            {/* Scrollable content area */}
            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
              <FileUploadArea
                fileInputRef={fileInputRef}
                uploading={uploading}
                uploadProgress={uploadProgress}
                error={error}
                documents={documents}
                onFileSelect={handleFileSelect}
                onDelete={handleDelete}
              />
            </div>

            {/* Navigation - Fixed at bottom */}
            <div className="flex flex-col gap-3 border-t border-terminal-border/50 bg-terminal-cream/90 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
              <button
                onClick={onBack}
                className="order-2 text-sm font-mono text-terminal-dark/60 transition-colors hover:text-terminal-dark sm:order-1"
              >
                ← {t("back")}
              </button>
              <button
                onClick={handleSubmit}
                disabled={uploading}
                className="order-1 w-full rounded bg-terminal-dark px-4 py-2 text-sm font-mono text-terminal-cream transition-colors hover:bg-terminal-dark/90 disabled:opacity-50 sm:order-2 sm:w-auto"
              >
                {documents.length > 0 ? t("continue") : t("skip")}
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
