export {
  listGalleryComponents,
  listWorkspaceDesigns,
  listWorkspaceDesignSummaries,
  findWorkspaceDesign,
  getGalleryComponentForUser,
  toggleGalleryFavoriteForUser,
  deleteGalleryComponentForUser,
  markGalleryComponentUsed,
  saveDesignComponentRecord,
} from "./service";
export type { DesignGalleryItem, DesignGallerySummaryItem } from "./service";

export {
  createProject,
  updateProject,
  deleteProject,
  listProjects,
  getProject,
  addComponentToProject,
  removeComponentFromProject,
  archiveProject,
} from "./project-queries";

export type {
  NewDesignProject,
  DesignProjectRow,
  DesignProjectWithComponents,
  ProjectSearchOpts,
} from "./types";
