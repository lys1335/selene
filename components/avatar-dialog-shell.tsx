"use client";

import { type RefObject } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Upload } from "lucide-react";

/**
 * Upload button shared between avatar dialogs. Triggers the hidden file input
 * and shows a spinner while uploading is in progress.
 */
export function AvatarUploadButton({
  fileInputRef,
  uploading,
  disabled,
  uploadLabel,
  uploadingLabel,
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  uploading: boolean;
  disabled?: boolean;
  uploadLabel: string;
  uploadingLabel: string;
}) {
  return (
    <Button
      onClick={() => fileInputRef.current?.click()}
      disabled={disabled ?? uploading}
      variant="outline"
      className="w-full font-mono border-terminal-border hover:bg-terminal-dark/5"
    >
      {uploading ? (
        <>
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          {uploadingLabel}
        </>
      ) : (
        <>
          <Upload className="w-4 h-4 mr-2" />
          {uploadLabel}
        </>
      )}
    </Button>
  );
}

interface AvatarDialogShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle: string;
  /** Hidden file input props */
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  accept: string;
  error: string | null;
  children: React.ReactNode;
}

/**
 * Shared shell for avatar selection/upload dialogs.
 * Renders the Dialog wrapper, header (title + subtitle), hidden file input, and error banner.
 * Dialog-specific content goes in `children`.
 */
export function AvatarDialogShell({
  open,
  onOpenChange,
  title,
  subtitle,
  fileInputRef,
  onFileChange,
  accept,
  error,
  children,
}: AvatarDialogShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-terminal-cream border-terminal-border">
        <DialogHeader>
          <DialogTitle className="font-mono text-terminal-dark">
            {title}
          </DialogTitle>
          <DialogDescription className="font-mono text-terminal-muted">
            {subtitle}
          </DialogDescription>
        </DialogHeader>

        <input
          type="file"
          ref={fileInputRef}
          onChange={onFileChange}
          accept={accept}
          className="hidden"
        />

        {error && (
          <div className="p-3 bg-red-100 rounded-lg">
            <p className="text-sm font-mono text-red-700">{error}</p>
          </div>
        )}

        {children}
      </DialogContent>
    </Dialog>
  );
}
