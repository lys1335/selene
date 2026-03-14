import { describe, expect, it } from "vitest";
import { shouldDeferLivePromptForegroundReconciliation } from "@/components/chat/chat-interface-utils";

describe("live prompt reconciliation guard", () => {
  it("blocks mid-run injected snapshots until persisted history overtakes the live thread", () => {
    expect(
      shouldDeferLivePromptForegroundReconciliation({
        hasInjectedMessages: true,
        persistedConversationMessageCount: 3,
        liveThreadMessageCount: 3,
      }),
    ).toBe(true);

    expect(
      shouldDeferLivePromptForegroundReconciliation({
        hasInjectedMessages: true,
        persistedConversationMessageCount: 3,
        liveThreadMessageCount: 4,
      }),
    ).toBe(true);

    expect(
      shouldDeferLivePromptForegroundReconciliation({
        hasInjectedMessages: true,
        persistedConversationMessageCount: 4,
        liveThreadMessageCount: 3,
      }),
    ).toBe(false);
  });

  it("never blocks ordinary snapshots without injected messages", () => {
    expect(
      shouldDeferLivePromptForegroundReconciliation({
        hasInjectedMessages: false,
        persistedConversationMessageCount: 3,
        liveThreadMessageCount: 99,
      }),
    ).toBe(false);
  });
});
