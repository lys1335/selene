export const INTERACTIVE_TOOL_NAMES = [
  "ExitPlanMode",
  "AskUserQuestion",
  "AskFollowupQuestion",
  // camelCase variants used by non-SDK providers (OpenAI/Codex)
  "askUserQuestion",
  "askFollowupQuestion",
] as const;

export const INTERACTIVE_TOOL_NAME_SET = new Set<string>(INTERACTIVE_TOOL_NAMES);
