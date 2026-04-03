/**
 * Shared helper: POST tool answers to /api/chat/tool-result.
 * Returns true if the server confirmed the result was resolved.
 */
export async function submitToolAnswersToServer(
  sessionId: string,
  toolCallId: string,
  answers: Record<string, string>,
): Promise<boolean> {
  try {
    const res = await fetch("/api/chat/tool-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, toolUseId: toolCallId, answers }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.resolved === true;
  } catch {
    return false;
  }
}
