export const INTERACTIVE_TOOL_NAMES = [
  "ExitPlanMode",
  "AskUserQuestion",
  "AskFollowupQuestion",
] as const;

export const INTERACTIVE_TOOL_NAME_SET = new Set<string>(INTERACTIVE_TOOL_NAMES);
