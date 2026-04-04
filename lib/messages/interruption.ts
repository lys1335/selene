type InterruptionContext =
  | "chat"
  | "deep-research"
  | "web-browse"
  | "agent";

const CONTEXT_LABELS: Record<InterruptionContext, string> = {
  chat: "Chat response",
  "deep-research": "Deep research",
  "web-browse": "Web browsing",
  agent: "Agent operation",
};

export function buildInterruptionMessage(
  context: InterruptionContext,
  timestamp: Date = new Date()
): string {
  const label = CONTEXT_LABELS[context] ?? CONTEXT_LABELS.agent;
  return `Process interrupted by user. Context: ${label}. Time: ${timestamp.toISOString()}.`;
}

export function buildInterruptionMetadata(
  context: InterruptionContext,
  timestamp: Date = new Date()
): { interruption: true; context: InterruptionContext; timestamp: string } {
  return {
    interruption: true,
    context,
    timestamp: timestamp.toISOString(),
  };
}
