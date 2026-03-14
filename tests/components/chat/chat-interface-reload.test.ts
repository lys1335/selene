/** @vitest-environment jsdom */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { ChatInterfaceProps } from "@/components/chat/chat-interface-types";
import type { SessionInfo } from "@/components/chat/chat-sidebar/types";

const {
  mockUseBackgroundProcessing,
  mockUseSessionManager,
  mockChatSetMessages,
  mockChatProviderProps,
  mockUseThreadState,
  mockResilientFetch,
} = vi.hoisted(() => ({
  mockUseBackgroundProcessing: vi.fn(),
  mockUseSessionManager: vi.fn(),
  mockChatSetMessages: vi.fn(),
  mockChatProviderProps: [] as Array<{ initialMessages?: UIMessage[] }>,
  mockUseThreadState: {
    messages: [] as unknown[],
    isRunning: false,
  },
  mockResilientFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/chat/character-1",
}));

vi.mock("next-intl", () => ({
  useTranslations: () => ((key: string) => key),
}));

vi.mock("@assistant-ui/react", () => ({
  useThread: (selector: (thread: { messages: unknown[]; isRunning: boolean }) => unknown) =>
    selector(mockUseThreadState),
}));

vi.mock("@/components/chat-provider", () => ({
  ChatProvider: ({ children, initialMessages }: { children: React.ReactNode; initialMessages?: UIMessage[] }) => {
    mockChatProviderProps.push({ initialMessages });
    return children;
  },
  useChatSetMessages: () => mockChatSetMessages,
}));

vi.mock("@/components/assistant-ui/thread", () => ({
  Thread: () => null,
}));

vi.mock("@/components/layout/shell", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/assistant-ui/character-context", () => ({
  CharacterProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/theme/theme-provider", () => ({
  useTheme: () => ({
    chatBackground: { type: "none" },
    chatWorkspaceMode: "sidebar",
    setChatWorkspaceMode: vi.fn(),
  }),
}));

vi.mock("@/lib/stores/chat-workspace-store", () => {
  const state = {
    tabs: [],
    activeSessionId: null,
    recentlyClosed: [],
    hydrated: true,
    hydrate: vi.fn(),
    openSession: vi.fn(),
    setActiveSession: vi.fn(),
    syncSessions: vi.fn(),
    closeSession: vi.fn(() => ({ closed: false, nextActiveSessionId: null })),
    reopenLastClosed: vi.fn(() => null),
    removeSession: vi.fn(),
    markUnavailable: vi.fn(),
  };
  const store = ((selector: (value: typeof state) => unknown) => selector(state)) as typeof state & {
    getState: () => typeof state;
  };
  store.getState = () => state;
  return { useChatWorkspaceStore: store };
});

vi.mock("@/lib/stores/unified-tasks-store", () => ({
  useUnifiedTasksStore: (selector: (state: { tasks: unknown[]; completeTask: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ tasks: [], completeTask: vi.fn() }),
}));

vi.mock("@/lib/utils/resilient-fetch", () => ({
  resilientFetch: mockResilientFetch,
  resilientPost: vi.fn(),
}));

vi.mock("@/components/chat/chat-interface-hooks", async () => {
  const actual = await vi.importActual<typeof import("@/components/chat/chat-interface-hooks")>(
    "@/components/chat/chat-interface-hooks",
  );
  return {
    ...actual,
    useBackgroundProcessing: mockUseBackgroundProcessing,
    useSessionManager: mockUseSessionManager,
  };
});

vi.mock("@/components/chat/chat-sidebar", () => ({
  CharacterSidebar: () => null,
}));
vi.mock("@/components/chat/browser-chat-workspace", () => ({
  BrowserChatWorkspace: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/chat/chat-interface-parts", () => ({
  ChatSidebarHeader: () => null,
  ScheduledRunBanner: () => null,
}));
vi.mock("@/components/theme/theme-chooser-modal", () => ({
  ThemeChooserModal: () => null,
}));
vi.mock("@/components/workspace/workspace-indicator", () => ({
  WorkspaceIndicator: () => null,
}));
vi.mock("@/components/workspace/diff-review-panel", () => ({
  DiffReviewPanel: () => null,
}));
vi.mock("@/components/avatar-3d/avatar-pip-widget", () => ({
  AvatarPipWidget: () => null,
}));
vi.mock("@/components/assistant-ui/voice-context", () => ({
  useOptionalVoice: () => null,
}));

import ChatInterface from "@/components/chat/chat-interface";

function makeInitialMessages(): UIMessage[] {
  return [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Original prompt" }],
    } as UIMessage,
  ];
}

function makePersistedUiMessages(): UIMessage[] {
  return [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Original prompt" }],
    },
    {
      id: "assistant-pre",
      role: "assistant",
      parts: [{ type: "text", text: "Working on it" }],
    },
    {
      id: "assistant-final",
      role: "assistant",
      parts: [{ type: "text", text: "Done, including tests" }],
    },
  ] as UIMessage[];
}

function makeSession(): SessionInfo {
  return {
    id: "session-1",
    title: "Regression session",
    characterId: "character-1",
    createdAt: "2026-03-14T18:59:00.000Z",
    updatedAt: "2026-03-14T19:00:00.000Z",
    lastMessageAt: "2026-03-14T19:00:00.000Z",
    messageCount: 1,
    totalTokenCount: 0,
    channelType: null,
    hasActiveRun: false,
    metadata: { characterId: "character-1", characterName: "Selene" },
  };
}

function makeProps(initialMessages: UIMessage[]): ChatInterfaceProps {
  return {
    character: {
      id: "character-1",
      name: "Selene",
      status: "active",
      metadata: {},
      images: [],
    },
    initialSessionId: "session-1",
    initialSessions: [makeSession()],
    initialNextCursor: null,
    initialTotalSessionCount: 1,
    initialMessages,
    characterDisplay: {
      id: "character-1",
      name: "Selene",
      avatarUrl: null,
      primaryImageUrl: null,
    },
  };
}

function buildSessionManagerMock(payload: {
  uiMessages: UIMessage[];
  conversationalMessageCount: number;
  hasInjectedMessages: boolean;
}) {
  return {
    sessions: [makeSession()],
    isLoading: false,
    loadingSessions: false,
    hasMoreSessions: false,
    totalSessionCount: 1,
    searchQuery: "",
    channelFilter: "all",
    dateRange: "all",
    userLoadedMoreRef: { current: false },
    fetchSessionMessages: vi.fn().mockResolvedValue(payload),
    notifySessionUpdate: vi.fn(),
    refreshSessionTimestamp: vi.fn(),
    loadSessions: vi.fn().mockResolvedValue(true),
    setSessions: vi.fn(),
    setSearchQuery: vi.fn(),
    setChannelFilter: vi.fn(),
    setDateRange: vi.fn(),
    loadMoreSessions: vi.fn(),
    createNewSession: vi.fn(),
    switchSession: vi.fn(),
    deleteSession: vi.fn(),
    resetChannelSession: vi.fn(),
    renameSession: vi.fn(),
    exportSession: vi.fn(),
    pinSession: vi.fn(),
    archiveSession: vi.fn(),
    restoreSession: vi.fn(),
  };
}

describe("ChatInterface reloadSessionMessages reconciliation", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockChatSetMessages.mockReset();
    mockChatProviderProps.length = 0;
    mockUseThreadState.isRunning = false;
    mockResilientFetch.mockImplementation(async (url: string) => {
      if (url.includes("/active-run")) {
        return { data: { hasActiveRun: false }, error: null, status: 200 };
      }
      if (url.includes("/workspace?detect=true")) {
        return { data: { gitFolders: [] }, error: null, status: 200 };
      }
      return { data: null, error: null, status: 200 };
    });
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/settings")) {
        return {
          ok: true,
          json: async () => ({ onboardingComplete: false, hasSeenThemeChooser: true }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it("applies pathname-triggered reloads when persisted injected history is ahead of the live thread", async () => {
    const persistedUiMessages = makePersistedUiMessages();
    const backgroundState = {
      isRunActiveRef: { current: true },
      isProcessingInBackground: false,
      processingRunId: null,
      isZombieRun: false,
      isCancellingBackgroundRun: false,
      isChatFading: false,
      pollingIntervalRef: { current: null },
      resetBackgroundState: vi.fn(),
      clearTrackedRunState: vi.fn(),
      setIsProcessingInBackground: vi.fn(),
      setProcessingRunId: vi.fn(),
      setIsZombieRun: vi.fn(),
      startPollingForCompletion: vi.fn(),
      handleCancelBackgroundRun: vi.fn(),
      refreshMessages: vi.fn(),
    };
    const sessionManager = buildSessionManagerMock({
      uiMessages: persistedUiMessages,
      conversationalMessageCount: 3,
      hasInjectedMessages: true,
    });
    mockUseBackgroundProcessing.mockReturnValue(backgroundState);
    mockUseSessionManager.mockReturnValue(sessionManager);
    mockUseThreadState.messages = makeInitialMessages() as unknown[];

    await act(async () => {
      root.render(createElement(ChatInterface, makeProps(makeInitialMessages())));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(sessionManager.fetchSessionMessages).toHaveBeenCalledWith("session-1");
    expect(sessionManager.notifySessionUpdate).toHaveBeenCalledWith("session-1", { messageCount: 3 });
    expect(mockChatSetMessages).toHaveBeenCalledWith(persistedUiMessages);
    expect(mockChatProviderProps.at(-1)?.initialMessages).toEqual(persistedUiMessages);
  });

  it("keeps pathname-triggered reloads deferred while injected persisted history matches the live thread", async () => {
    const persistedUiMessages = makePersistedUiMessages();
    const backgroundState = {
      isRunActiveRef: { current: true },
      isProcessingInBackground: false,
      processingRunId: null,
      isZombieRun: false,
      isCancellingBackgroundRun: false,
      isChatFading: false,
      pollingIntervalRef: { current: null },
      resetBackgroundState: vi.fn(),
      clearTrackedRunState: vi.fn(),
      setIsProcessingInBackground: vi.fn(),
      setProcessingRunId: vi.fn(),
      setIsZombieRun: vi.fn(),
      startPollingForCompletion: vi.fn(),
      handleCancelBackgroundRun: vi.fn(),
      refreshMessages: vi.fn(),
    };
    const sessionManager = buildSessionManagerMock({
      uiMessages: persistedUiMessages,
      conversationalMessageCount: 3,
      hasInjectedMessages: true,
    });
    mockUseBackgroundProcessing.mockReturnValue(backgroundState);
    mockUseSessionManager.mockReturnValue(sessionManager);
    mockUseThreadState.messages = persistedUiMessages as unknown[];

    await act(async () => {
      root.render(createElement(ChatInterface, makeProps(persistedUiMessages)));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(sessionManager.fetchSessionMessages).toHaveBeenCalledWith("session-1");
    expect(sessionManager.notifySessionUpdate).toHaveBeenCalledWith("session-1", { messageCount: 3 });
    expect(mockChatSetMessages).not.toHaveBeenCalled();
    expect(mockChatProviderProps.at(-1)?.initialMessages).toEqual(persistedUiMessages);
  });
});
