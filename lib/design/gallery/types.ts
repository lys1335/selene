export interface NewDesignComponent {
  /** Optional pre-assigned ID. A random UUID is generated if omitted. */
  id?: string;
  userId: string;
  characterId?: string;
  sessionId?: string;
  projectId?: string;
  name: string;
  description?: string;
  prompt: string;
  code: string;
  framework?: string;
  category?: string;
  tags?: string[];
  styleTags?: string[];
  previewPath?: string;
  mode?: string;
  style?: string;
}

export interface DesignComponentRow {
  id: string;
  userId: string;
  characterId: string | null;
  sessionId: string | null;
  projectId: string | null;
  name: string;
  description: string | null;
  prompt: string;
  code: string;
  framework: string;
  category: string;
  tags: string[];
  styleTags: string[];
  previewPath: string | null;
  mode: string;
  style: string;
  useCount: number;
  lastUsedAt: string | null;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GallerySearchOpts {
  userId: string;
  query?: string;
  category?: string;
  framework?: string;
  tags?: string[];
  favoritesOnly?: boolean;
  projectId?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Project types
// ---------------------------------------------------------------------------

export interface NewDesignProject {
  name: string;
  description?: string;
  tags?: string[];
}

export interface DesignProjectRow {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  tags: string[];
  isArchived: boolean;
  componentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSearchOpts {
  userId: string;
  search?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export interface DesignProjectWithComponents extends DesignProjectRow {
  components: DesignComponentRow[];
}
