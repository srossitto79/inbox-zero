const REQUEST_TIMEOUT_MS = 4000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export type EndpointModelsResult =
  | { status: "ok"; models: string[] }
  | { status: "unreachable"; models: [] };

// The instance is single-user and intentionally reaches LAN hosts (a local
// llama.cpp, Ollama or LM Studio box), so private addresses are not blocked.
export async function fetchEndpointModels({
  baseUrl,
  apiKey,
}: {
  baseUrl: string;
  apiKey?: string;
}): Promise<EndpointModelsResult> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return { status: "unreachable", models: [] };

    const body = await readCappedJson(response);
    return { status: "ok", models: parseModelIds(body) };
  } catch {
    return { status: "unreachable", models: [] };
  }
}

// Accepts the OpenAI shape ({ data: [{ id }] }) and the Ollama tags shape
// ({ models: [{ name }] }).
export function parseModelIds(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];

  const { data, models } = body as { data?: unknown; models?: unknown };
  const entries = Array.isArray(data)
    ? data
    : Array.isArray(models)
      ? models
      : [];

  const ids = entries.map((entry) => {
    if (typeof entry === "string") return entry;
    if (!entry || typeof entry !== "object") return null;
    const { id, name, model } = entry as Record<string, unknown>;
    return [id, name, model].find((value) => typeof value === "string");
  });

  const unique = new Set(
    ids
      .filter((id): id is string => typeof id === "string")
      .map((id) => id.trim())
      .filter(Boolean),
  );

  return [...unique].sort((a, b) => a.localeCompare(b));
}

async function readCappedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");

  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Response too large");
    }
    chunks.push(value);
  }

  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
}
