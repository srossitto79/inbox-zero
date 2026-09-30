import { describe, expect, it } from "vitest";
import { normalizeEndpointUrl } from "@/utils/llms/endpoint-url";

describe("normalizeEndpointUrl", () => {
  it("accepts http and https endpoints and strips trailing slashes", () => {
    expect(normalizeEndpointUrl("http://192.168.0.210:9292/v1")).toBe(
      "http://192.168.0.210:9292/v1",
    );
    expect(normalizeEndpointUrl("  https://llm.example.com/v1//  ")).toBe(
      "https://llm.example.com/v1",
    );
  });

  it.each([
    "",
    "not a url",
    "192.168.0.210:9292/v1",
    "ftp://host/v1",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://user:secret@host/v1",
    "http://user@host/v1",
  ])("rejects %s", (value) => {
    expect(normalizeEndpointUrl(value)).toBeNull();
  });
});
