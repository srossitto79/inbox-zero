import { runBackgroundJobTick } from "@/utils/background-jobs/executor";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("background-jobs");

const POLL_INTERVAL_MS = 5000;

const globalForWorker = globalThis as unknown as {
  backgroundJobWorkerStarted?: boolean;
};

/**
 * Polls the job table from the server process, so queued jobs start and
 * jobs left running by a previous process resume without any page open.
 */
export function startBackgroundJobWorker() {
  // Dev reloads re-run instrumentation in the same process.
  if (globalForWorker.backgroundJobWorkerStarted) return;
  globalForWorker.backgroundJobWorkerStarted = true;

  let ticking = false;
  const timer = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      await runBackgroundJobTick();
    } catch (error) {
      logger.error("Background job tick failed", { error });
    } finally {
      ticking = false;
    }
  }, POLL_INTERVAL_MS);
  timer.unref();
}
