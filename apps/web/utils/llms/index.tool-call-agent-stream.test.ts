import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAgentStream, mockGetModelForUseCase } = vi.hoisted(() => ({
  mockAgentStream: vi.fn(),
  mockGetModelForUseCase: vi.fn(),
}));

vi.mock("ai", () => ({
  APICallError: { isInstance: () => false },
  RetryError: { isInstance: () => false },
  NoObjectGeneratedError: { isInstance: () => false },
  TypeValidationError: { isInstance: () => false },
  ToolLoopAgent: class {
    stream(options: unknown) {
      return mockAgentStream(options);
    }
  },
  generateObject: vi.fn(),
  generateText: vi.fn(),
  streamText: vi.fn(),
  smoothStream: vi.fn(),
  stepCountIs: vi.fn(),
  isStepCount: vi.fn(),
}));
vi.mock("@posthog/ai", () => ({ captureAiGeneration: vi.fn() }));
vi.mock("@/env", () => ({
  env: {
    NODE_ENV: "test",
    NANO_LLMS: "",
    NEXT_PUBLIC_POSTHOG_KEY: "",
    EMAIL_ENCRYPT_SALT: "test-salt",
  },
}));
vi.mock("@/utils/usage", () => ({ saveAiUsage: vi.fn() }));
vi.mock("@/utils/sleep", () => ({ sleep: vi.fn() }));
vi.mock("@/utils/error-messages", () => ({
  addUserErrorMessageWithNotification: vi.fn(),
  ErrorType: {},
}));
vi.mock("@/utils/llms/use-cases", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/llms/use-cases")>()),
  getModelForUseCase: mockGetModelForUseCase,
}));
vi.mock("@/utils/llms/model-usage-guard", () => ({
  assertTrialAiUsageAllowed: vi.fn(),
  shouldForceNanoModel: vi.fn().mockResolvedValue({ shouldForce: false }),
}));
vi.mock("@/utils/posthog", () => ({
  getPosthogLlmClient: vi.fn(() => undefined),
  isPosthogLlmEvalApproved: vi.fn(() => false),
}));

describe("toolCallAgentStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetModelForUseCase.mockReturnValue({
      provider: "openai",
      modelName: "gpt-test",
      model: {},
      providerOptions: undefined,
      hasUserApiKey: false,
      fallbackModels: [],
    });
    mockAgentStream.mockResolvedValue({ ok: true });
  });

  it("hands the abort signal to the model call", async () => {
    const { toolCallAgentStream } = await import("./index");
    const controller = new AbortController();

    await toolCallAgentStream({
      userAi: {} as never,
      useCase: "assistant-chat" as never,
      messages: [],
      promptHardening: { trust: "untrusted", level: "full" },
      emailAccountId: "account-1",
      userEmail: "user@example.com",
      usageLabel: "assistant-chat",
      abortSignal: controller.signal,
    });

    expect(mockAgentStream).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: controller.signal }),
    );
  });
});
