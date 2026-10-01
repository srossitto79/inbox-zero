/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

const { mockMutateChat, mockMutateGlobal, mockSetChatId, state } = vi.hoisted(
  () => ({
    mockMutateChat: vi.fn(),
    mockMutateGlobal: vi.fn(),
    mockSetChatId: vi.fn(),
    state: {
      chatId: null as string | null,
      status: "ready",
      messages: [] as unknown[],
      jobs: [] as unknown[],
    },
  }),
);

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    id: "generated-chat",
    status: state.status,
    messages: state.messages,
    setMessages: vi.fn(),
    sendMessage: vi.fn(),
  }),
}));
vi.mock("nuqs", () => ({
  parseAsString: {},
  useQueryState: () => [state.chatId, mockSetChatId],
}));
vi.mock("swr", () => ({
  useSWRConfig: () => ({ mutate: mockMutateGlobal }),
}));
vi.mock("@/hooks/useChatMessages", () => ({
  useChatMessages: () => ({ data: undefined, mutate: mockMutateChat }),
}));
vi.mock("@/hooks/useBackgroundJobs", () => ({
  isActiveBackgroundJob: (job: { status: string }) =>
    job.status === "QUEUED" || job.status === "RUNNING",
  useBackgroundJobs: () => ({ data: { jobs: state.jobs } }),
}));
vi.mock("@/providers/EmailAccountProvider", () => ({
  useAccount: () => ({ emailAccountId: "account-1" }),
}));
vi.mock("@/components/Toast", () => ({ toastError: vi.fn() }));
vi.mock("@/utils/error", () => ({ captureException: vi.fn() }));
vi.mock("@/utils/logger-client", () => ({
  createClientLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { ChatProvider, useChat } from "@/providers/ChatProvider";

function Probe({ onValue }: { onValue: (pending: boolean) => void }) {
  onValue(useChat().isReplyPending);
  return null;
}

function renderProvider() {
  let pending = false;
  const view = render(
    <ChatProvider>
      <Probe onValue={(value) => (pending = value)} />
    </ChatProvider>,
  );
  return { view, isPending: () => pending };
}

function chatJob(status: string, chatId = "chat-9", id = "job-1") {
  return { id, kind: "CHAT_REPLY", status, payload: { chatId, runId: "r" } };
}

describe("ChatProvider chat reply jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.chatId = null;
    state.status = "ready";
    state.messages = [];
    state.jobs = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("reopens the chat being answered when the assistant opens without one", () => {
    state.jobs = [chatJob("RUNNING")];

    renderProvider();

    expect(mockSetChatId).toHaveBeenCalledWith("chat-9");
  });

  it("replaces the blank chat created on open", () => {
    state.chatId = "fresh-blank-chat";
    state.jobs = [chatJob("RUNNING")];

    renderProvider();

    expect(mockSetChatId).toHaveBeenCalledWith("chat-9");
  });

  it("keeps a chat that already has messages", () => {
    state.chatId = "other-chat";
    state.messages = [{ id: "m1" }];
    state.jobs = [chatJob("RUNNING")];

    renderProvider();

    expect(mockSetChatId).not.toHaveBeenCalled();
  });

  it("does nothing without an active chat job", () => {
    state.jobs = [chatJob("SUCCEEDED")];

    renderProvider();

    expect(mockSetChatId).not.toHaveBeenCalled();
  });

  it("reports a pending reply only for the open chat", () => {
    state.chatId = "chat-9";
    state.jobs = [chatJob("RUNNING")];
    const open = renderProvider();
    expect(open.isPending()).toBe(true);
    cleanup();

    state.chatId = "other-chat";
    state.messages = [{ id: "m1" }];
    const other = renderProvider();
    expect(other.isPending()).toBe(false);
  });

  it("reloads the saved reply when the job finishes", () => {
    state.chatId = "chat-9";
    state.jobs = [chatJob("RUNNING")];
    const { view } = renderProvider();
    expect(mockMutateChat).not.toHaveBeenCalled();

    state.jobs = [chatJob("SUCCEEDED")];
    view.rerender(
      <ChatProvider>
        <Probe onValue={() => undefined} />
      </ChatProvider>,
    );

    expect(mockMutateChat).toHaveBeenCalledTimes(1);
  });
});
