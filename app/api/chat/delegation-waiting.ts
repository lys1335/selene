import { getActiveDelegationsForCharacter } from "@/lib/ai/tools/delegate-to-subagent-tool";

export function hasRunningDelegationsForSession(
  characterId: string | null,
  initiatorSessionId: string,
): boolean {
  if (!characterId) {
    return false;
  }

  return getActiveDelegationsForCharacter(characterId, initiatorSessionId).some(
    (delegation) => delegation.running,
  );
}

export function shouldStopClaudeCodeTurn(input: {
  characterId: string | null;
  initiatorSessionId: string;
  stepCount: number;
  maxSteps: number;
}): boolean {
  if (input.stepCount >= input.maxSteps) {
    return true;
  }

  if (input.stepCount <= 0) {
    return false;
  }

  return !hasRunningDelegationsForSession(input.characterId, input.initiatorSessionId);
}
