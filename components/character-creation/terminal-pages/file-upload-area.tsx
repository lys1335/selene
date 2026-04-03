"use client";

import { useRef, useState, type RefObject } from "react";
import { DOCUMENT_UPLOAD_ACCEPT, DOCUMENT_SUPPORT_LABELS } from "@/lib/documents/file-types";
import { useTranslations } from "next-intl";
import type { UploadedDocument } from "./knowledge-base-page";

interface FileUploadAreaProps {
  fileInputRef: RefObject<HTMLInputElement | null>;
  uploading: boolean;
  uploadProgress: { current: number; total: number; filename: string } | null;
  error: string | null;
  documents: UploadedDocument[];
  onFileSelect: (files: FileList | null) => void;
  onDelete: (docId: string) => void;
}

export function FileUploadArea({
  fileInputRef,
  uploading,
  uploadProgress,
  error,
  documents,
  onFileSelect,
  onDelete,
}: FileUploadAreaProps) {
  const t = useTranslations("characterCreation.knowledgeBase");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const confirmDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDeleteClick = (docId: string) => {
    if (confirmingDeleteId === docId) {
      if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
      setConfirmingDeleteId(null);
      onDelete(docId);
    } else {
      setConfirmingDeleteId(docId);
      if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
      confirmDeleteTimerRef.current = setTimeout(() => setConfirmingDeleteId(null), 3000);
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <>
      {/* Upload Area */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className="border-2 border-dashed border-terminal-border/50 rounded-lg p-8 text-center cursor-pointer hover:border-terminal-amber focus:border-terminal-amber focus:outline-none focus:ring-1 focus:ring-terminal-amber transition-colors"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={DOCUMENT_UPLOAD_ACCEPT}
          onChange={(e) => onFileSelect(e.target.files)}
          className="hidden"
        />
        <div className="font-mono text-terminal-dark/70">
          {uploading && uploadProgress ? (
            <span className="text-terminal-amber">
              {uploadProgress.total > 1
                ? `${t("uploading")} ${uploadProgress.current}/${uploadProgress.total}: ${uploadProgress.filename}`
                : `${t("uploading")} ${uploadProgress.filename}`}
            </span>
          ) : uploading ? (
            <span className="text-terminal-amber">{t("uploading")}</span>
          ) : (
            <span className="text-terminal-amber">{t("clickToUpload")}</span>
          )}
        </div>
        <div className="text-xs font-mono text-terminal-dark/50 mt-2">
          {t("supportedFormats", { formats: DOCUMENT_SUPPORT_LABELS.join(", ") })}
        </div>
      </div>

      {error && (
        <div className="text-red-500 text-sm font-mono">! {error}</div>
      )}

      {/* Document List */}
      {documents.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-mono text-terminal-amber">{t("uploadedDocuments")}</h3>
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between p-3 bg-terminal-bg/20 rounded border border-terminal-border/30"
            >
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm text-terminal-dark truncate">
                  {doc.title || doc.originalFilename}
                </div>
                <div className="font-mono text-xs text-terminal-dark/50">
                  {formatSize(doc.sizeBytes)} • {doc.status}
                </div>
              </div>
              <button
                onClick={() => handleDeleteClick(doc.id)}
                className={`ml-2 text-sm font-mono transition-colors ${
                  confirmingDeleteId === doc.id
                    ? "text-red-600 font-semibold"
                    : "text-red-500/70 hover:text-red-500"
                }`}
              >
                {confirmingDeleteId === doc.id ? t("confirmDelete") : "✕"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Skip hint */}
      <div className="text-xs font-mono text-terminal-dark/50 text-center">
        {t("skipHint")}
      </div>
    </>
  );
}
