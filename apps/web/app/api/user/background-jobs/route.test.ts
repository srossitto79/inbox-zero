import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
vi.mock("@/utils/middleware", async () => {
  const { createWithEmailAccountTestMiddleware } = await vi.importActual<
    typeof import("@/__tests__/helpers")
  >("@/__tests__/helpers");

  return createWithEmailAccountTestMiddleware({
    auth: {
      userId: "user-1",
      emailAccountId: "account-1",
      email: "user@example.com",
    },
  });
});

import { GET as listJobs } from "./route";
import { GET as getJob } from "./[jobId]/route";

describe("user/background-jobs routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists active, recent and unseen jobs of the account, newest first", async () => {
    prisma.backgroundJob.findMany.mockResolvedValue([
      { id: "job-2", status: "RUNNING" },
    ] as never);

    const response = await listJobs(
      new NextRequest("http://localhost/api/user/background-jobs"),
      { params: Promise.resolve({}) },
    );

    expect(await response.json()).toEqual({
      jobs: [{ id: "job-2", status: "RUNNING" }],
    });
    const query = prisma.backgroundJob.findMany.mock.calls[0][0]!;
    expect(query.where).toMatchObject({ emailAccountId: "account-1" });
    expect(query.orderBy).toEqual({ createdAt: "desc" });
  });

  it("returns one job scoped to the account", async () => {
    prisma.backgroundJob.findFirst.mockResolvedValue({
      id: "job-1",
      status: "SUCCEEDED",
    } as never);

    const response = await getJob(
      new NextRequest("http://localhost/api/user/background-jobs/job-1"),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );

    expect(await response.json()).toEqual({
      job: { id: "job-1", status: "SUCCEEDED" },
    });
    expect(prisma.backgroundJob.findFirst.mock.calls[0][0]!.where).toEqual({
      id: "job-1",
      emailAccountId: "account-1",
    });
  });

  it("answers 404 for a job of another account", async () => {
    prisma.backgroundJob.findFirst.mockResolvedValue(null);

    const response = await getJob(
      new NextRequest("http://localhost/api/user/background-jobs/job-9"),
      { params: Promise.resolve({ jobId: "job-9" }) },
    );

    expect(response.status).toBe(404);
  });
});
