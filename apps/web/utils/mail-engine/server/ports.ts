import "server-only";
import type { AssistantStateSource } from "@inboxzero/mail-core/ports/assistant-source";
import type { MailboxSource } from "@inboxzero/mail-core/ports/mailbox-source";
import type { OperationExecutor } from "@inboxzero/mail-core/ports/operation-executor";
import { createEmailProvider } from "@/utils/email/provider";
import { readAssistantStatePage } from "@/utils/mail-api/assistant-state";
import {
  cancelHeldEngineSend,
  createEmailProviderOperationExecutor,
} from "@/utils/mail-api/operations";
import { createEmailProviderMailboxSource } from "@/utils/mail-api/source";
import {
  admitAccountUpload,
  putAccountUploadContent,
  setAccountUploadHold,
} from "@/utils/mail-api/upload-blobs";
import type { Logger } from "@/utils/logger";

type AccountContext = {
  emailAccountId: string;
  provider: string;
  logger: Logger;
};

/**
 * The same provider-backed source the browser reaches over /api/mail/v1, called
 * in process. A provider is created per call so token refresh stays current.
 */
export function createServerMailboxSource(
  account: AccountContext,
): MailboxSource {
  const withSource = async <T>(run: (source: MailboxSource) => Promise<T>) =>
    run(
      createEmailProviderMailboxSource({
        provider: await providerFor(account),
        accountId: account.emailAccountId,
      }),
    );
  return {
    beginBootstrap: (input) =>
      withSource((source) => source.beginBootstrap(input)),
    describe: (input) => withSource((source) => source.describe(input)),
    discoverScopes: (input) =>
      withSource((source) => source.discoverScopes(input)),
    enumerate: (input) => withSource((source) => source.enumerate(input)),
    hydrate: (input) => withSource((source) => source.hydrate(input)),
    readAttachment: (input) =>
      withSource((source) => source.readAttachment(input)),
    readChanges: (input) => withSource((source) => source.readChanges(input)),
    readConversationMembership: (input) =>
      withSource((source) => source.readConversationMembership(input)),
    search: (input) => withSource((source) => source.search(input)),
  };
}

export function createServerOperationExecutor(
  account: AccountContext,
): OperationExecutor {
  const withExecutor = async <T>(
    run: (executor: OperationExecutor) => Promise<T>,
  ) =>
    run(
      createEmailProviderOperationExecutor({
        provider: await providerFor(account),
        accountId: account.emailAccountId,
      }),
    );
  return {
    execute: (input) => withExecutor((executor) => executor.execute(input)),
    inspect: (input) => withExecutor((executor) => executor.inspect(input)),
    async cancel({ operation }) {
      try {
        const status = await cancelHeldEngineSend(
          account.emailAccountId,
          operation.key.operationId,
        );
        return { status };
      } catch {
        return { status: "unavailable" };
      }
    },
    async stageUpload({
      uploadId,
      checksum,
      sizeBytes,
      filename,
      contentType,
      bytes,
    }) {
      const admitted = await admitAccountUpload(account.emailAccountId, {
        uploadId,
        checksum,
        sizeBytes,
        filename,
        contentType,
      });
      if (admitted.status !== "admitted") return { status: "unavailable" };
      const staged = await putAccountUploadContent(
        account.emailAccountId,
        uploadId,
        bytes,
      );
      if (staged.status === "rejected") {
        return { status: "rejected", code: staged.code };
      }
      if (staged.status === "missing") {
        return { status: "rejected", code: "missing" };
      }
      if (staged.status !== "staged") return { status: "unavailable" };
      const held = await setAccountUploadHold(
        account.emailAccountId,
        uploadId,
        true,
      );
      if (held.status !== "held") return { status: "unavailable" };
      return { status: "staged", blobId: held.blobId };
    },
  };
}

export function createServerAssistantSource(
  account: AccountContext,
): AssistantStateSource {
  return {
    async read({ session, cursor }) {
      const page = await readAssistantStatePage({
        emailAccountId: account.emailAccountId,
        cursor,
      });
      return { status: "ok", page: { session, ...page } };
    },
  };
}

function providerFor(account: AccountContext) {
  return createEmailProvider({
    emailAccountId: account.emailAccountId,
    provider: account.provider,
    logger: account.logger,
  });
}
