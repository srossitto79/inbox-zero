import { env } from "@/env";

/** Anything but "server" keeps the mailbox copy in each browser. */
export function isServerMailStore() {
  return env.NEXT_PUBLIC_MAIL_STORE === "server";
}
