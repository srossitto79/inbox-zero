import { env } from "@/env";
import { Provider } from "@/utils/llms/config";
import { getResolvedDeploymentRolePrimaryModelEntry } from "@/utils/llms/model";
import { hasUserCustomEndpoint } from "@/utils/llms/endpoint-url";

const PROBE_TIMEOUT_MS = 2500;
const PROBE_CACHE_TTL_MS = 30_000;
const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "http://localhost:1234/v1";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

export type LlmStatus =
  | "online"
  | "unreachable"
  | "configured"
  | "not_configured";

export type LlmStatusResult = {
  status: LlmStatus;
  provider: string | null;
  model: string | null;
  source: "user" | "deployment" | null;
  latencyMs: number | null;
};

type UserAi = {
  aiProvider: string | null;
  aiModel: string | null;
  aiApiKey: string | null;
  aiBaseUrl: string | null;
};

type ProbeResult = { reachable: boolean; latencyMs: number };

// Keyed by URL so a status poll from every client shares one outbound request.
const probeCache = new Map<string, { at: number; result: ProbeResult }>();

export async function getLlmStatus(userAi: UserAi): Promise<LlmStatusResult> {
  const deployment = getResolvedDeploymentRolePrimaryModelEntry("default");
  const usesUserKey = !!userAi.aiApiKey || hasUserCustomEndpoint(userAi);

  const provider = usesUserKey
    ? userAi.aiProvider || deployment?.provider || null
    : deployment?.provider || null;
  if (!provider) return notConfigured();

  const model = usesUserKey
    ? userAi.aiProvider
      ? userAi.aiModel
      : deployment?.modelName
    : deployment?.modelName;

  const base = {
    provider,
    model: model || getFallbackModelName(provider),
    source: usesUserKey ? ("user" as const) : ("deployment" as const),
  };

  const probeUrl = getProbeUrl(provider, usesUserKey ? userAi.aiBaseUrl : null);
  if (!probeUrl) return { ...base, status: "configured", latencyMs: null };

  const probe = await probeEndpoint(probeUrl);
  return {
    ...base,
    status: probe.reachable ? "online" : "unreachable",
    latencyMs: probe.reachable ? probe.latencyMs : null,
  };
}

export function getProbeUrl(
  provider: string,
  userBaseUrl?: string | null,
): string | null {
  if (provider === Provider.OPENAI_COMPATIBLE) {
    const baseUrl =
      userBaseUrl?.trim() ||
      env.OPENAI_COMPATIBLE_BASE_URL ||
      process.env.OPENAI_COMPATIBLE_BASE_URL ||
      DEFAULT_OPENAI_COMPATIBLE_BASE_URL;
    return `${baseUrl.replace(/\/+$/, "")}/models`;
  }

  if (provider === Provider.OLLAMA) {
    const baseUrl = (env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL)
      .replace(/\/+$/, "")
      .replace(/\/api$/, "");
    return `${baseUrl}/api/tags`;
  }

  return null;
}

export function resetProbeCache() {
  probeCache.clear();
}

async function probeEndpoint(url: string): Promise<ProbeResult> {
  const cached = probeCache.get(url);
  if (cached && Date.now() - cached.at < PROBE_CACHE_TTL_MS) {
    return cached.result;
  }

  const startedAt = Date.now();
  let result: ProbeResult;
  try {
    // No credentials or user data are sent; any HTTP answer below 500 means
    // the server is up, even if it wants a key.
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    result = {
      reachable: response.status < 500,
      latencyMs: Date.now() - startedAt,
    };
  } catch {
    result = { reachable: false, latencyMs: Date.now() - startedAt };
  }

  probeCache.set(url, { at: Date.now(), result });
  return result;
}

function getFallbackModelName(provider: string): string | null {
  if (provider === Provider.OLLAMA) return env.OLLAMA_MODEL || null;
  if (provider === Provider.OPENAI_COMPATIBLE) {
    return env.OPENAI_COMPATIBLE_MODEL || null;
  }
  return null;
}

function notConfigured(): LlmStatusResult {
  return {
    status: "not_configured",
    provider: null,
    model: null,
    source: null,
    latencyMs: null,
  };
}
