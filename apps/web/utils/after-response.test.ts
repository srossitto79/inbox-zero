import { beforeEach, describe, expect, it, vi } from "vitest";

const { afterMock } = vi.hoisted(() => ({ afterMock: vi.fn() }));

vi.mock("next/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/server")>();
  return { ...original, after: afterMock };
});

import { afterResponseOrNow } from "@/utils/after-response";

const outsideRequest = new Error(
  "`after` was called outside a request scope. Read more: https://nextjs.org/docs/messages/next-dynamic-api-wrong-context",
);

describe("afterResponseOrNow", () => {
  beforeEach(() => {
    afterMock.mockReset();
  });

  it("hands the task to after() inside a request", () => {
    const task = vi.fn();
    afterResponseOrNow(task);
    expect(afterMock).toHaveBeenCalledWith(task);
    expect(task).not.toHaveBeenCalled();
  });

  it("runs a function task right away when there is no request", async () => {
    afterMock.mockImplementation(() => {
      throw outsideRequest;
    });
    const task = vi.fn().mockResolvedValue(undefined);
    afterResponseOrNow(task);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
  });

  it("lets a promise task finish when there is no request", async () => {
    afterMock.mockImplementation(() => {
      throw outsideRequest;
    });
    let finished = false;
    afterResponseOrNow(
      new Promise<void>((resolve) =>
        setTimeout(() => {
          finished = true;
          resolve();
        }, 5),
      ),
    );
    await vi.waitFor(() => expect(finished).toBe(true));
  });

  it("does not throw when the task fails without a request", async () => {
    afterMock.mockImplementation(() => {
      throw outsideRequest;
    });
    const task = vi.fn().mockRejectedValue(new Error("boom"));
    expect(() => afterResponseOrNow(task)).not.toThrow();
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
  });

  it("rethrows any other after() error", () => {
    afterMock.mockImplementation(() => {
      throw new Error("something else");
    });
    expect(() => afterResponseOrNow(vi.fn())).toThrow("something else");
  });
});
