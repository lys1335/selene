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

export function hasDelegationsForSession(
  characterId: string | null,
  initiatorSessionId: string,
): boolean {
  if (!characterId) {
    return false;
  }

  return getActiveDelegationsForCharacter(characterId, initiatorSessionId).length > 0;
}

export function shouldStopTurn(input: {
  characterId: string | null;
  initiatorSessionId: string;
  stepCount: number;
  maxSteps: number;
}): boolean {
  if (input.stepCount >= input.maxSteps) {
    return true;
  }

  // Never force-stop a turn due to delegation status. Delegations always run
  // in background mode — the model needs follow-up steps to call observe()
  // and collect results. The AI SDK loop ends naturally when the model stops
  // making tool calls (outputs text-only response).
  //
  // Previously, force-stopping when all delegations settled caused a
  // serialization regression: the model couldn't observe results if they
  // settled between steps, and blocking mode inside the tool execute()
  // serialized parallel delegations across multi-step model responses.
  return false;
}
