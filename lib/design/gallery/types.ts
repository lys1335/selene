export interface NewDesignComponent {
  userId: string;
  characterId?: string;
  sessionId?: string;
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
  limit?: number;
  offset?: number;
}
