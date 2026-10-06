import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";

const { envMock } = vi.hoisted(() => ({
  envMock: {} as Record<string, string | undefined>,
}));

vi.mock("@/env", () => ({ env: envMock }));
vi.mock("@/utils/prisma");

import {
  getAvailableMessagingProviders,
  hasAnyMessagingAppConfig,
  loadAdapterConfigs,
  resolvePrimarySlackSigningSecret,
  resolveSlackAppCredentials,
  resolveTeamsBotCredentials,
  resolveTelegramBotCredentials,
} from "./app-credentials";

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(envMock)) delete envMock[key];
  prisma.member.findFirst.mockResolvedValue(null);
  prisma.messagingAppConfig.findUnique.mockResolvedValue(null);
  prisma.messagingAppConfig.findFirst.mockResolvedValue(null);
  prisma.messagingAppConfig.findMany.mockResolvedValue([]);
});

describe("resolveSlackAppCredentials", () => {
  it("falls back to env when the account has no organization", async () => {
    envMock.SLACK_CLIENT_ID = "env-id";
    envMock.SLACK_CLIENT_SECRET = "env-secret";
    envMock.SLACK_SIGNING_SECRET = "env-signing";

    expect(await resolveSlackAppCredentials("acc-1")).toEqual({
      clientId: "env-id",
      clientSecret: "env-secret",
      signingSecret: "env-signing",
    });
    expect(prisma.messagingAppConfig.findUnique).not.toHaveBeenCalled();
  });

  it("prefers the organization's stored config over env", async () => {
    prisma.member.findFirst.mockResolvedValue({
      organizationId: "org-1",
    } as never);
    prisma.messagingAppConfig.findUnique.mockResolvedValue({
      clientId: "db-id",
      clientSecret: "db-secret",
      signingSecret: "db-signing",
    } as never);
    envMock.SLACK_CLIENT_ID = "env-id";
    envMock.SLACK_CLIENT_SECRET = "env-secret";
    envMock.SLACK_SIGNING_SECRET = "env-signing";

    expect(await resolveSlackAppCredentials("acc-1")).toEqual({
      clientId: "db-id",
      clientSecret: "db-secret",
      signingSecret: "db-signing",
    });
    expect(prisma.messagingAppConfig.findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_provider: {
          organizationId: "org-1",
          provider: "SLACK",
        },
      },
    });
  });

  it("returns null when nothing is configured", async () => {
    expect(await resolveSlackAppCredentials("acc-1")).toBeNull();
  });
});

describe("resolveTeamsBotCredentials", () => {
  it("requires the full env trio", async () => {
    envMock.TEAMS_BOT_APP_ID = "app-id";
    envMock.TEAMS_BOT_APP_PASSWORD = "password";

    expect(await resolveTeamsBotCredentials("acc-1")).toBeNull();

    envMock.TEAMS_BOT_APP_TENANT_ID = "tenant";
    expect(await resolveTeamsBotCredentials("acc-1")).toEqual({
      appId: "app-id",
      appPassword: "password",
      tenantId: "tenant",
    });
  });

  it("prefers the organization's stored config", async () => {
    prisma.member.findFirst.mockResolvedValue({
      organizationId: "org-1",
    } as never);
    prisma.messagingAppConfig.findUnique.mockResolvedValue({
      appId: "db-app",
      appPassword: "db-password",
      tenantId: "db-tenant",
    } as never);

    expect(await resolveTeamsBotCredentials("acc-1")).toEqual({
      appId: "db-app",
      appPassword: "db-password",
      tenantId: "db-tenant",
    });
  });
});

describe("resolveTelegramBotCredentials", () => {
  it("requires both token and secret token in env", async () => {
    envMock.TELEGRAM_BOT_TOKEN = "token";

    expect(await resolveTelegramBotCredentials("acc-1")).toBeNull();

    envMock.TELEGRAM_BOT_SECRET_TOKEN = "secret";
    expect(await resolveTelegramBotCredentials("acc-1")).toEqual({
      botToken: "token",
      botSecretToken: "secret",
    });
  });
});

describe("getAvailableMessagingProviders", () => {
  it("matches the previous env-only behavior", async () => {
    envMock.SLACK_CLIENT_ID = "id";
    envMock.SLACK_CLIENT_SECRET = "secret";
    envMock.TELEGRAM_BOT_TOKEN = "token";
    envMock.TELEGRAM_BOT_SECRET_TOKEN = "secret";

    expect(await getAvailableMessagingProviders("acc-1")).toEqual([
      "SLACK",
      "TELEGRAM",
    ]);
  });

  it("includes providers configured in the organization's stored config", async () => {
    prisma.member.findFirst.mockResolvedValue({
      organizationId: "org-1",
    } as never);
    prisma.messagingAppConfig.findMany.mockResolvedValue([
      {
        provider: "TEAMS",
        appId: "app",
        appPassword: "password",
        tenantId: "tenant",
      },
    ] as never);

    expect(await getAvailableMessagingProviders("acc-1")).toEqual(["TEAMS"]);
    expect(prisma.messagingAppConfig.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
    });
  });

  it("returns nothing when neither env nor config is set", async () => {
    expect(await getAvailableMessagingProviders("acc-1")).toEqual([]);
  });
});

describe("hasAnyMessagingAppConfig", () => {
  it("reports whether any organization stored a config for the provider", async () => {
    prisma.messagingAppConfig.findFirst.mockResolvedValue({
      id: "config-1",
    } as never);

    expect(await hasAnyMessagingAppConfig("TELEGRAM")).toBe(true);
    expect(prisma.messagingAppConfig.findFirst).toHaveBeenCalledWith({
      where: { provider: "TELEGRAM" },
    });

    prisma.messagingAppConfig.findFirst.mockResolvedValue(null);
    expect(await hasAnyMessagingAppConfig("TELEGRAM")).toBe(false);
  });
});

describe("resolvePrimarySlackSigningSecret", () => {
  it("prefers the env secret without querying the database", async () => {
    envMock.SLACK_SIGNING_SECRET = "env-signing";

    expect(await resolvePrimarySlackSigningSecret()).toBe("env-signing");
    expect(prisma.messagingAppConfig.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to the oldest stored signing secret", async () => {
    prisma.messagingAppConfig.findFirst.mockResolvedValue({
      signingSecret: "db-signing",
    } as never);

    expect(await resolvePrimarySlackSigningSecret()).toBe("db-signing");
    expect(prisma.messagingAppConfig.findFirst).toHaveBeenCalledWith({
      where: { provider: "SLACK", signingSecret: { not: null } },
      orderBy: { createdAt: "asc" },
    });
  });

  it("returns null when nothing is configured", async () => {
    expect(await resolvePrimarySlackSigningSecret()).toBeNull();
  });
});

describe("loadAdapterConfigs", () => {
  it("loads stored configs only for platforms env does not cover", async () => {
    envMock.TELEGRAM_BOT_TOKEN = "env-token";
    envMock.TELEGRAM_BOT_SECRET_TOKEN = "env-secret";
    prisma.messagingAppConfig.findMany.mockResolvedValue([
      {
        provider: "TELEGRAM",
        botToken: "db-token",
        botSecretToken: "db-secret",
      },
      { provider: "SLACK", signingSecret: "db-signing" },
      {
        provider: "TEAMS",
        appId: "app",
        appPassword: "password",
        tenantId: "tenant",
      },
    ] as never);

    expect(await loadAdapterConfigs()).toEqual({
      slack: { signingSecret: "db-signing" },
      teams: { appId: "app", appPassword: "password", tenantId: "tenant" },
    });
    expect(prisma.messagingAppConfig.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "asc" },
    });
  });

  it("skips the database entirely when env covers every platform", async () => {
    envMock.SLACK_SIGNING_SECRET = "signing";
    envMock.TEAMS_BOT_APP_ID = "app";
    envMock.TEAMS_BOT_APP_PASSWORD = "password";
    envMock.TEAMS_BOT_APP_TENANT_ID = "tenant";
    envMock.TELEGRAM_BOT_TOKEN = "token";
    envMock.TELEGRAM_BOT_SECRET_TOKEN = "secret";

    expect(await loadAdapterConfigs()).toEqual({});
    expect(prisma.messagingAppConfig.findMany).not.toHaveBeenCalled();
  });

  it("ignores stored configs missing required fields", async () => {
    prisma.messagingAppConfig.findMany.mockResolvedValue([
      { provider: "TEAMS", appId: "app", appPassword: null, tenantId: "t" },
      { provider: "TELEGRAM", botToken: null, botSecretToken: "secret" },
    ] as never);

    expect(await loadAdapterConfigs()).toEqual({});
  });
});
