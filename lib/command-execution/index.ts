/**
 * Command Execution Module
 * 
 * Sandboxed command execution for Selene.
 * Allows AI tools to run shell commands safely within synced directories.
 */

// Export types
export type {
    ExecuteOptions,
    ExecuteResult,
    ValidationResult,
    ExecuteCommandToolOptions,
    ExecuteCommandInput,
    ExecuteCommandToolResult,
    CommandLogEntry,
    BackgroundProcessInfo,
} from "./types";

// Export executor functions
export {
    executeCommandWithValidation,
    startBackgroundProcess,
    getBackgroundProcess,
    killBackgroundProcess,
    listBackgroundProcesses,
    cleanupBackgroundProcesses,
} from "./executor";
