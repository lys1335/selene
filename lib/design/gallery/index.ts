export {
  listGalleryComponents,
  listWorkspaceDesigns,
  findWorkspaceDesign,
  getGalleryComponentForUser,
  toggleGalleryFavoriteForUser,
  deleteGalleryComponentForUser,
  markGalleryComponentUsed,
  saveDesignComponentRecord,
} from "./service";
export type { DesignGalleryItem } from "./service";

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
