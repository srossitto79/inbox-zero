import type { GetMailboxSizeResponse } from "@/app/api/user/mailbox-size/route";
import { fetchWithAccount } from "@/utils/fetch";

export async function fetchMailboxSize(
  emailAccountId: string,
): Promise<GetMailboxSizeResponse> {
  const response = await fetchWithAccount({
    url: "/api/user/mailbox-size",
    emailAccountId,
  });
  // A rejected request must not be cached as if it were the mailbox size.
  if (!response.ok) {
    throw new Error(`Mailbox size request failed: ${response.status}`);
  }
  return response.json();
}
