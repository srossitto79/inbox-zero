import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchEndpointModels,
  parseModelIds,
} from "@/utils/llms/endpoint-models";

describe("parseModelIds", () => {
  it("reads the OpenAI shape, deduplicated and sorted", () => {
    expect(
      parseModelIds({ data: [{ id: "b" }, { id: "a" }, { id: "b" }, {}] }),
    ).toEqual(["a", "b"]);
  });

  it("reads the Ollama tags shape", () => {
    expect(
      parseModelIds({ models: [{ name: "llama3:8b" }, { model: "qwen3" }] }),
    ).toEqual(["llama3:8b", "qwen3"]);
  });

  it("returns an empty list for unknown shapes", () => {
    expect(parseModelIds(null)).toEqual([]);
    expect(parseModelIds("text")).toEqual([]);
    expect(parseModelIds({ data: "nope" })).toEqual([]);
  });
});

describe("fetchEndpointModels", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests /models without an Authorization header when no key is given", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ data: [{ id: "m1" }] }));

    const result = await fetchEndpointModels({
      baseUrl: "http://192.168.0.210:9292/v1/",
    });

    expect(result).toEqual({ status: "ok", models: ["m1"] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://192.168.0.210:9292/v1/models");
    expect(init?.headers).not.toHaveProperty("Authorization");
  });

  it("sends a bearer token when a key is given", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ data: [] }));

    await fetchEndpointModels({ baseUrl: "https://host/v1", apiKey: "sk-1" });

    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer sk-1",
    });
  });

  it("reports unreachable on network errors, timeouts and bad statuses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const unreachable = { status: "unreachable", models: [] };

    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await fetchEndpointModels({ baseUrl: "http://h/v1" })).toEqual(
      unreachable,
    );

    fetchMock.mockRejectedValueOnce(
      new DOMException("timeout", "TimeoutError"),
    );
    expect(await fetchEndpointModels({ baseUrl: "http://h/v1" })).toEqual(
      unreachable,
    );

    fetchMock.mockResolvedValueOnce(new Response("no", { status: 401 }));
    expect(await fetchEndpointModels({ baseUrl: "http://h/v1" })).toEqual(
      unreachable,
    );
  });

  it("reports unreachable for invalid JSON and oversized bodies", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const unreachable = { status: "unreachable", models: [] };

    fetchMock.mockResolvedValueOnce(new Response("<html>"));
    expect(await fetchEndpointModels({ baseUrl: "http://h/v1" })).toEqual(
      unreachable,
    );

    fetchMock.mockResolvedValueOnce(new Response("x".repeat(2 * 1024 * 1024)));
    expect(await fetchEndpointModels({ baseUrl: "http://h/v1" })).toEqual(
      unreachable,
    );
  });
});
