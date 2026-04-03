"use client";

import { type RefObject } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

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
