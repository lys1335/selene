/**
 * Ghost OS Type Definitions
 *
 * Types for Ghost OS integration with Selene — macOS computer-use
 * via accessibility tree, vision fallback, and self-learning recipes.
 */

/**
 * Ghost OS installation and permission status
 */
export interface GhostOsStatus {
  /** Whether the `ghost` binary is found in PATH */
  installed: boolean;
  /** Ghost OS version string (e.g., "2.2.1") */
  version?: string;
  /** Whether the ShowUI-2B vision model is downloaded */
  visionModelInstalled: boolean;
  /** macOS system permission status */
  permissions: {
    accessibility: boolean;
    screenRecording: boolean;
    inputMonitoring: boolean;
  };
  /** Binary path resolved from PATH */
  binaryPath?: string;
}

/**
 * Ghost OS MCP server configuration
 */
export interface GhostOsMCPConfig {
  mcpServers: {
    ghostos: {
      type: "stdio";
      command: string;
      args: string[];
      enabled: boolean;
    };
  };
}

/**
 * Active Ghost OS operation — used for multi-agent conflict detection
 */
export interface GhostOsActiveOperation {
  /** Unique ID for this specific invocation (prevents concurrent clear races) */
  opId: string;
  /** Character/agent ID that initiated the operation */
  characterId: string;
  /** Human-readable agent name */
  characterName: string;
  /** Ghost OS tool being executed (e.g., "ghost_click") */
  toolName: string;
  /** Root session ID for delegation chain grouping */
  rootSessionId: string;
  /** Timestamp when the operation started */
  startedAt: number;
}

/**
 * Result from `ghost doctor` command
 */
export interface GhostDoctorResult {
  /** Raw stdout from ghost doctor */
  raw: string;
  /** Whether all checks passed */
  healthy: boolean;
  /** Individual check results parsed from output */
  checks: {
    name: string;
    passed: boolean;
    detail?: string;
  }[];
}
