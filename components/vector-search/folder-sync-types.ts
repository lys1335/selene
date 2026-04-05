export type IndexingMode = "auto" | "full" | "files-only";
import type { SyncMode, ChunkPreset, ReindexPolicy } from "@/lib/vectordb/sync-mode-resolver";

export interface SyncFolder {
  id: string;
  folderPath: string;
  displayName: string | null;
  recursive: boolean;
  includeExtensions: string | string[];
  excludePatterns: string | string[];
  fileTypeFilters?: string | string[];
  status: "pending" | "syncing" | "synced" | "error" | "paused";
  lastSyncedAt: string | null;
  lastError: string | null;
  fileCount: number | null;
  chunkCount: number | null;
  skippedCount?: number | null;
  skipReasons?: Record<string, number> | string | null;
  lastRunMetadata?: Record<string, unknown> | string | null;
  lastRunTrigger?: "manual" | "scheduled" | "triggered" | "auto" | null;
  embeddingModel: string | null;
  indexingMode: "files-only" | "full" | "auto";
  syncMode?: SyncMode;
  syncCadenceMinutes?: number;
  maxFileSizeBytes?: number;
  chunkPreset?: ChunkPreset;
  chunkSizeOverride?: number | null;
  chunkOverlapOverride?: number | null;
  reindexPolicy?: ReindexPolicy;
  isPrimary: boolean;
  inheritedFromWorkflowId?: string | null;
  inheritedFromAgentId?: string | null;
  inheritedFromFolderId?: string | null;
  // Annotated by the GET endpoint — true when the path exists on disk at fetch time.
  pathExists?: boolean;
}

export interface FolderAnalysis {
  folderPath: string;
  folderName: string;
  detectedPatterns: string[];
  mergedPatterns: string[];
  fileCountPreview: number;
  fileCountLimited: boolean;
  maxFileLines?: number;
  largeFileCount?: number;
  largeFileExamples?: string[];
  exists: boolean;
}

export interface FolderSyncManagerProps {
  characterId: string;
  className?: string;
  compact?: boolean;
}

import type { SyncMode as _SyncMode, ChunkPreset as _ChunkPreset, ReindexPolicy as _ReindexPolicy } from "@/lib/vectordb/sync-mode-resolver";

/**
 * All mutable form state for the add-folder form.
 * Passed as a single `formState` prop to FolderSyncAddForm to avoid
 * duplicating the 30+ individual state+setter pairs at every usage site.
 */
export interface FolderFormState {
  newFolderPath: string;
  newDisplayName: string;
  newRecursive: boolean;
  newExtensions: string;
  newExcludePatterns: string;
  newFolderMode: "simple" | "advanced";
  newIndexingMode: IndexingMode;
  newSyncMode: _SyncMode;
  newSyncCadenceMinutes: string;
  newFileTypeFilters: string;
  newMaxFileSizeMB: string;
  newChunkPreset: _ChunkPreset;
  newChunkSizeOverride: string;
  newChunkOverlapOverride: string;
  newReindexPolicy: _ReindexPolicy;
  useRecommendedExcludes: boolean;
  showAdvancedOptions: boolean;
  isAdding: boolean;
  isAnalyzing: boolean;
  folderAnalysis: FolderAnalysis | null;
  analysisError: string | null;
}

/**
 * Setters and action callbacks for the add-folder form.
 */
export interface FolderFormActions {
  setNewFolderPath: (v: string) => void;
  setNewDisplayName: (v: string) => void;
  setNewRecursive: (v: boolean) => void;
  setNewExtensions: (v: string) => void;
  setNewExcludePatterns: (v: string) => void;
  setNewFolderMode: (v: "simple" | "advanced") => void;
  setNewIndexingMode: (v: IndexingMode) => void;
  setNewSyncMode: (v: _SyncMode) => void;
  setNewSyncCadenceMinutes: (v: string) => void;
  setNewFileTypeFilters: (v: string) => void;
  setNewMaxFileSizeMB: (v: string) => void;
  setNewChunkPreset: (v: _ChunkPreset) => void;
  setNewChunkSizeOverride: (v: string) => void;
  setNewChunkOverlapOverride: (v: string) => void;
  setNewReindexPolicy: (v: _ReindexPolicy) => void;
  onToggleRecommendedExcludes: (checked: boolean) => void;
  setShowAdvancedOptions: (v: boolean) => void;
  onAddFolder: () => void;
  onCancel: () => void;
  onOpenFolderPicker: () => void;
}

export const RECOMMENDED_EXCLUDES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  "site-packages",
  "coverage",
  ".local-data",
  "dist-electron",
  ".vscode",
  ".idea",
  "tmp",
  "temp",
  ".DS_Store",
  "Thumbs.db",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "*.tsbuildinfo",
  "*.log",
  "*.lock",
  "*.pyc",
  // Package manager vendor directories for non-JS ecosystems
  "vendor",        // PHP Composer / Go
  ".bundle",       // Ruby Bundler
  "Pods",          // iOS CocoaPods
  ".dart_tool",    // Dart/Flutter
  "**/node_modules/**",
  "**/.git/**",
  "**/.next/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.venv/**",
  "**/venv/**",
  "**/env/**",
  "**/__pycache__/**",
  "**/site-packages/**",
  "**/.local-data/**",
  "**/dist-electron/**",
  "**/.vscode/**",
  "**/.idea/**",
  "**/tmp/**",
  "**/temp/**",
  "**/vendor/**",
  "**/.bundle/**",
  "**/Pods/**",
  "**/.dart_tool/**",
];

export const DEFAULT_EXTENSIONS = [
  // Documents
  ".pdf", ".doc", ".docx", ".odt", ".rtf",
  // Spreadsheets
  ".xls", ".xlsx", ".ods", ".csv",
  // Presentations
  ".ppt", ".pptx", ".odp",
  // Text/Markup
  ".txt", ".md", ".markdown", ".rst", ".tex",
  // Code
  ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".cpp", ".c", ".h", ".go", ".rs", ".rb", ".php",
  ".swift", ".kt", ".kts", ".dart", ".scala", ".lua", ".r", ".R",
  // Web
  ".html", ".htm", ".css", ".xml", ".json", ".yaml", ".yml",
  // Other
  ".log", ".sql", ".sh", ".bat",
].join(",");

export const DEFAULT_EXCLUDE_PATTERNS =
  "node_modules,.git,dist,build,.next,__pycache__,.venv,venv,env,site-packages,*.pyc,package-lock.json,pnpm-lock.yaml,yarn.lock,vendor,.bundle,Pods,.dart_tool";
