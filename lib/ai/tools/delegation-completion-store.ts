interface DelegationCompletion {
  delegationId: string;
  delegateName: string;
  sessionId: string;
  initiatorSessionId: string;
  characterId: string;
  completedAt: number;
  error?: string;
}

type DelegationCompletionStore = Map<string, DelegationCompletion[]>;

const globalForDelegationCompletions = globalThis as typeof globalThis & {
  delegationCompletions?: DelegationCompletionStore;
};

function getStore(): DelegationCompletionStore {
  if (!globalForDelegationCompletions.delegationCompletions) {
    globalForDelegationCompletions.delegationCompletions = new Map();
  }
  return globalForDelegationCompletions.delegationCompletions;
}

export type { DelegationCompletion };

export function addDelegationCompletion(completion: DelegationCompletion): void {
  const store = getStore();
  const existing = store.get(completion.initiatorSessionId) ?? [];
  store.set(completion.initiatorSessionId, [...existing, completion]);
}

export function drainDelegationCompletions(initiatorSessionId: string): DelegationCompletion[] {
  const store = getStore();
  const completions = store.get(initiatorSessionId) ?? [];
  store.delete(initiatorSessionId);
  return completions;
}

export function hasPendingDelegationCompletions(initiatorSessionId: string): boolean {
  return (getStore().get(initiatorSessionId) ?? []).length > 0;
}
