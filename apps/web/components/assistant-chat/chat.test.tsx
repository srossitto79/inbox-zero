/** @vitest-environment jsdom */

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatHistoryEntry } from "@/components/assistant-chat/chat-history-types";
import type { Chat as ChatHelpers } from "@/providers/ChatProvider";

(globalThis as { React?: typeof React }).React = React;

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as { ResizeObserver?: typeof MockResizeObserver }).ResizeObserver =
  MockResizeObserver;

const {
  mockCaptureAction,
  mockChatState,
  mockHandleSubmit,
  mockMutate,
  mockRegenerate,
  mockSetAttachments,
  mockSetChatId,
  mockSetContext,
  mockSetInput,
  mockSetLocalStorageInput,
  mockSetMessages,
  mockSetNewChat,
  mockStopReply,
  mockUseChats,
} = vi.hoisted(() => ({
  mockCaptureAction: vi.fn(),
  mockChatState: {
    chatId: null as string | null,
    isReplyPending: false,
    input: "",
  },
  mockHandleSubmit: vi.fn(),
  mockMutate: vi.fn(),
  mockRegenerate: vi.fn(),
  mockSetAttachments: vi.fn(),
  mockSetChatId: vi.fn(),
  mockSetContext: vi.fn(),
  mockSetInput: vi.fn(),
  mockSetLocalStorageInput: vi.fn(),
  mockSetMessages: vi.fn(),
  mockSetNewChat: vi.fn(),
  mockStopReply: vi.fn(),
  mockUseChats: vi.fn(),
}));

vi.mock("@/components/assistant-chat/messages", () => ({
  Messages: ({ footer }: { footer?: React.ReactNode }) => (
    <div data-testid="messages">{footer}</div>
  ),
}));

vi.mock("@/components/assistant-chat/preview-attachment", () => ({
  PreviewAttachment: () => <div data-testid="preview-attachment" />,
}));

vi.mock("@/components/assistant-chat/RenameChatDialog", () => ({
  RenameChatDialog: () => null,
}));

vi.mock("@/components/assistant-chat/DeleteChatDialog", () => ({
  DeleteChatDialog: () => null,
}));

vi.mock("@/components/voice/VoiceInput", () => ({
  VoiceInput: () => null,
}));

vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({
    execute: vi.fn(),
    isExecuting: false,
    result: undefined,
  }),
}));

vi.mock("@/utils/actions/chat", () => ({
  deleteChatAction: vi.fn(),
  renameChatAction: vi.fn(),
}));

vi.mock("@/utils/actions/safe-action", () => {
  function createActionClientMock() {
    const client = {
      bindArgsSchemas: () => client,
      use: () => client,
      metadata: () => client,
      inputSchema: () => client,
      action: vi.fn(),
    };

    return client;
  }

  return {
    actionClient: createActionClientMock(),
    actionClientUser: createActionClientMock(),
    adminActionClient: createActionClientMock(),
  };
});

vi.mock("@/components/ai-elements/prompt-input", () => ({
  PromptInput: ({
    children,
    onSubmit,
  }: {
    children: React.ReactNode;
    onSubmit: React.FormEventHandler<HTMLFormElement>;
  }) => <form onSubmit={onSubmit}>{children}</form>,
  PromptInputTextarea: (
    props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  ) => <textarea {...props} />,
  PromptInputSubmit: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { status: string }) => (
    <button type="submit" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/Tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    signIn: vi.fn(),
    signOut: vi.fn(),
    signUp: vi.fn(),
    useSession: () => ({
      data: { user: { name: "Barbara" } },
    }),
    getSession: vi.fn(),
    sso: {},
  }),
}));

vi.mock("@better-auth/sso/client", () => ({
  ssoClient: () => ({}),
}));

vi.mock("better-auth/client/plugins", () => ({
  genericOAuthClient: () => ({}),
  organizationClient: () => ({}),
}));

vi.mock("@/utils/prisma", () => ({
  default: {},
}));

vi.mock("@/hooks/useChats", () => ({
  useChats: (shouldFetch: boolean) => mockUseChats(shouldFetch),
}));

vi.mock("@/hooks/useProductAnalytics", () => ({
  useProductAnalytics: () => ({
    captureAction: mockCaptureAction,
  }),
}));

vi.mock("@/providers/ChatProvider", () => ({
  useChat: () => ({
    chat: {
      messages: [],
      status: "ready",
      stop: vi.fn(),
      regenerate: mockRegenerate,
      setMessages: mockSetMessages,
      sendMessage: vi.fn(),
    } satisfies Partial<ChatHelpers>,
    chatId: mockChatState.chatId,
    input: mockChatState.input,
    isReplyPending: mockChatState.isReplyPending,
    stopReply: mockStopReply,
    persistedMessageIds: new Set(),
    setInput: mockSetInput,
    handleSubmit: mockHandleSubmit,
    setNewChat: mockSetNewChat,
    context: null,
    setContext: mockSetContext,
    attachments: [],
    setAttachments: mockSetAttachments,
    setChatId: mockSetChatId,
    submitTextMessage: vi.fn(),
  }),
}));

vi.mock("@/utils/auth-client", () => ({
  useSession: () => ({
    data: { user: { name: "Barbara" } },
  }),
}));

vi.mock("usehooks-ts", () => ({
  useLocalStorage: () => ["", mockSetLocalStorageInput] as const,
}));

afterEach(() => {
  cleanup();
});

describe("Chat history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatState.chatId = "current-chat";
    mockChatState.isReplyPending = false;
    mockChatState.input = "";
    mockUseChats.mockImplementation((shouldFetch: boolean) => ({
      data: shouldFetch ? { chats: [chatHistoryEntry] } : undefined,
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    }));
  });

  it("loads previous chats when the history menu is opened without hover", async () => {
    const { Chat } = await import("@/components/assistant-chat/chat");

    render(<Chat open />);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: /chat history/i }),
    );

    expect(await screen.findByText("Project update")).toBeTruthy();

    fireEvent.click(screen.getByText("Project update"));

    await waitFor(() => {
      expect(mockSetChatId).toHaveBeenCalledWith("chat-1");
    });
  });
});

describe("Chat while the server generates a reply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatState.chatId = "current-chat";
    mockChatState.isReplyPending = true;
    mockChatState.input = "Another question";
    mockUseChats.mockReturnValue({ data: undefined, mutate: mockMutate });
  });

  it("shows the waiting state and does not send", async () => {
    const { Chat } = await import("@/components/assistant-chat/chat");

    const { container } = render(<Chat open />);

    expect(screen.getByRole("status").textContent).toBe("Generating reply");
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();

    fireEvent.submit(container.querySelector("form")!);
    expect(mockHandleSubmit).not.toHaveBeenCalled();
  });

  it("shows an enabled Stop button that stops the reply on the server", async () => {
    const { Chat } = await import("@/components/assistant-chat/chat");

    render(<Chat open />);

    const stop = screen.getByRole("button", {
      name: "Stop",
    }) as HTMLButtonElement;
    expect(stop.disabled).toBe(false);

    fireEvent.click(stop);

    expect(mockStopReply).toHaveBeenCalledTimes(1);
    expect(mockHandleSubmit).not.toHaveBeenCalled();
  });

  it("sends normally when no reply is pending", async () => {
    mockChatState.isReplyPending = false;
    const { Chat } = await import("@/components/assistant-chat/chat");

    const { container } = render(<Chat open />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    fireEvent.submit(container.querySelector("form")!);
    expect(mockHandleSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("Chat opened without a selected conversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatState.chatId = null;
    mockChatState.isReplyPending = false;
    mockChatState.input = "";
  });

  it("opens the conversation of the last message sent", async () => {
    mockUseChats.mockReturnValue({
      data: {
        chats: [{ ...chatHistoryEntry, id: "latest" }, chatHistoryEntry],
      },
      error: undefined,
      mutate: mockMutate,
    });
    const { Chat } = await import("@/components/assistant-chat/chat");

    render(<Chat open />);

    await waitFor(() => expect(mockSetChatId).toHaveBeenCalledWith("latest"));
    expect(mockSetNewChat).not.toHaveBeenCalled();
  });

  it("waits for the chat list instead of starting a new conversation", async () => {
    mockUseChats.mockReturnValue({
      data: undefined,
      error: undefined,
      mutate: mockMutate,
    });
    const { Chat } = await import("@/components/assistant-chat/chat");

    render(<Chat open />);

    expect(mockSetChatId).not.toHaveBeenCalled();
    expect(mockSetNewChat).not.toHaveBeenCalled();
  });

  it("starts a new conversation when there are none", async () => {
    mockUseChats.mockReturnValue({
      data: { chats: [] },
      error: undefined,
      mutate: mockMutate,
    });
    const { Chat } = await import("@/components/assistant-chat/chat");

    render(<Chat open />);

    await waitFor(() => expect(mockSetNewChat).toHaveBeenCalledTimes(1));
    expect(mockSetChatId).not.toHaveBeenCalled();
  });

  it("starts a new conversation when the chat list cannot be loaded", async () => {
    mockUseChats.mockReturnValue({
      data: undefined,
      error: new Error("failed"),
      mutate: mockMutate,
    });
    const { Chat } = await import("@/components/assistant-chat/chat");

    render(<Chat open />);

    await waitFor(() => expect(mockSetNewChat).toHaveBeenCalledTimes(1));
  });

  it("keeps the conversation that is already selected", async () => {
    mockChatState.chatId = "current-chat";
    mockUseChats.mockReturnValue({
      data: { chats: [{ ...chatHistoryEntry, id: "latest" }] },
      error: undefined,
      mutate: mockMutate,
    });
    const { Chat } = await import("@/components/assistant-chat/chat");

    render(<Chat open />);

    expect(mockSetChatId).not.toHaveBeenCalled();
    expect(mockSetNewChat).not.toHaveBeenCalled();
  });

  it("does not open any conversation while closed", async () => {
    mockUseChats.mockReturnValue({
      data: { chats: [chatHistoryEntry] },
      error: undefined,
      mutate: mockMutate,
    });
    const { Chat } = await import("@/components/assistant-chat/chat");

    render(<Chat open={false} />);

    expect(mockSetChatId).not.toHaveBeenCalled();
    expect(mockSetNewChat).not.toHaveBeenCalled();
  });
});

const chatHistoryEntry = {
  id: "chat-1",
  name: "Project update",
  createdAt: new Date("2026-05-23T00:00:00.000Z"),
  updatedAt: new Date("2026-05-23T00:00:00.000Z"),
  lastMessageAt: new Date("2026-05-23T00:00:00.000Z"),
  deletedAt: null,
  compactionCount: 0,
  lastSeenRulesRevision: null,
  emailAccountId: "email-account-1",
} satisfies ChatHistoryEntry;
