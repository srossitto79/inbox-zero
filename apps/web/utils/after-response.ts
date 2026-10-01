import { after } from "next/server";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("after-response");

type AfterTask = Promise<unknown> | (() => unknown);

/**
 * Runs follow-up work after the response when called inside a request, and
 * right away otherwise. Next's `after` throws outside a request, which is where
 * background jobs run.
 */
export function afterResponseOrNow(task: AfterTask) {
  try {
    after(task);
  } catch (error) {
    if (!isOutsideRequestScope(error)) throw error;
    Promise.resolve(typeof task === "function" ? task() : task).catch(
      (taskError) => {
        logger.warn("Deferred task failed outside a request", {
          error: taskError,
        });
      },
    );
  }
}

function isOutsideRequestScope(error: unknown) {
  return (
    error instanceof Error && error.message.includes("outside a request scope")
  );
}
