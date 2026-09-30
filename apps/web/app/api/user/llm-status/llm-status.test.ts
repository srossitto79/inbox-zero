import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { envMock, resolvedDefaultMock } = vi.hoisted(() => ({
  envMock: {} as Record<string, string | undefined>,
  resolvedDefaultMock: vi.fn(),
}));

vi.mock("@/env", () => ({ env: envMock }));
vi.mock("@/utils/llms/model", () => ({
  getResolvedDeploymentRolePrimaryModelEntry: resolvedDefaultMock,
}));

import { getLlmStatus, getProbeUrl, resetProbeCache } from "./llm-status";

const noUserKey = {
  aiProvider: null,
  aiModel: null,
  aiApiKey: null,
  aiBaseUrl: null,
};

describe("getLlmStatus", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetProbeCache();
    for (const key of Object.keys(envMock)) delete envMock[key];
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports not configured when nothing resolves", async () => {
    resolvedDefaultMock.mockReturnValue(null);
    const result = await getLlmStatus(noUserKey);
    expect(result.status).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not probe hosted providers", async () => {
    resolvedDefaultMock.mockReturnValue({
      provider: "anthropic",
      modelName: "claude-sonnet-5",
    });
    const result = await getLlmStatus(noUserKey);
    expect(result).toMatchObject({
      status: "configured",
      provider: "anthropic",
      model: "claude-sonnet-5",
      source: "deployment",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("probes an OpenAI-compatible endpoint and reports online", async () => {
    envMock.OPENAI_COMPATIBLE_BASE_URL = "http://llm.local:8080/v1/";
    resolvedDefaultMock.mockReturnValue({
      provider: "openai-compatible",
      modelName: "qwen",
    });
    fetchMock.mockResolvedValue({ status: 200 });

    const result = await getLlmStatus(noUserKey);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://llm.local:8080/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.status).toBe("online");
    expect(result.latencyMs).toEqual(expect.any(Number));
  });

  it("reports unreachable when the probe fails", async () => {
    resolvedDefaultMock.mockReturnValue({
      provider: "openai-compatible",
      modelName: "qwen",
    });
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await getLlmStatus(noUserKey);
    expect(result.status).toBe("unreachable");
    expect(result.latencyMs).toBeNull();
  });

  it("caches the probe result", async () => {
    resolvedDefaultMock.mockReturnValue({
      provider: "ollama",
      modelName: "llama3",
    });
    fetchMock.mockResolvedValue({ status: 200 });

    await getLlmStatus(noUserKey);
    await getLlmStatus(noUserKey);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the user provider and model when a user key is set", async () => {
    resolvedDefaultMock.mockReturnValue({
      provider: "openai-compatible",
      modelName: "qwen",
    });
    const result = await getLlmStatus({
      aiProvider: "openai",
      aiModel: "gpt-x",
      aiApiKey: "key",
      aiBaseUrl: null,
    });
    expect(result).toMatchObject({
      status: "configured",
      provider: "openai",
      model: "gpt-x",
      source: "user",
    });
  });
});

describe("getLlmStatus with a user endpoint", () => {
  it("probes the user endpoint even without an API key", async () => {
    resetProbeCache();
    envMock.OPENAI_COMPATIBLE_BASE_URL = "http://deployment:1234/v1";
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLlmStatus({
      aiProvider: "openai-compatible",
      aiModel: "qwen3",
      aiApiKey: null,
      aiBaseUrl: "http://192.168.0.210:9292/v1",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://192.168.0.210:9292/v1/models",
    );
    expect(result).toMatchObject({ status: "online", source: "user" });
    vi.unstubAllGlobals();
  });
});

describe("getProbeUrl", () => {
  beforeEach(() => {
    for (const key of Object.keys(envMock)) delete envMock[key];
  });

  it("defaults the OpenAI-compatible base URL", () => {
    expect(getProbeUrl("openai-compatible")).toBe(
      "http://localhost:1234/v1/models",
    );
  });

  it("prefers the user base URL over the deployment one", () => {
    envMock.OPENAI_COMPATIBLE_BASE_URL = "http://deployment:1234/v1";
    expect(getProbeUrl("openai-compatible", "http://lan:9292/v1/")).toBe(
      "http://lan:9292/v1/models",
    );
  });

  it("maps the Ollama base URL to the tags endpoint", () => {
    envMock.OLLAMA_BASE_URL = "http://ollama:11434/api";
    expect(getProbeUrl("ollama")).toBe("http://ollama:11434/api/tags");
  });

  it("returns null for hosted providers", () => {
    expect(getProbeUrl("openai")).toBeNull();
  });
});
