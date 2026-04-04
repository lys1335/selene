/**
 * LanceDB Vector Database Integration
 *
 * This module provides embedded vector search capabilities using LanceDB,
 * an embedded vector database that runs locally without requiring an external server.
 *
 * @module lib/vectordb
 */

export {
  getAgentTableStats
} from "./collections";
export {
  type VectorSearchHit,
} from "./search";
export {
  searchWithRouter,
} from "./search-router";
export {
  getSyncFolders,
} from "./sync-service";
