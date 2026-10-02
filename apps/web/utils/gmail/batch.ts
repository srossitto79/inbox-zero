import { isDefined } from "@/utils/types";
import { getGoogleGmailBatchUrl } from "@/utils/google/oauth";
import { createScopedLogger } from "@/utils/logger";
import {
  chargeGmailBatch,
  recordGmailQuotaResponse,
} from "@/utils/gmail/quota-meter";

const logger = createScopedLogger("gmail/batch");

const BATCH_LIMIT = 100;

// Uses Gmail batch API to get multiple responses in one request
// https://developers.google.com/gmail/api/guides/batch
export async function getBatch(
  ids: string[],
  endpoint: string, // e.g. /gmail/v1/users/me/messages
  accessToken: string,
  queryString?: string,
) {
  if (!ids.length) return [];
  if (ids.length > BATCH_LIMIT) {
    throw new Error(
      `Request count exceeds the limit. Received: ${ids.length}, Limit: ${BATCH_LIMIT}`,
    );
  }

  const meter = await chargeGmailBatch({
    accessToken,
    endpoint,
    count: ids.length,
  });

  let batchRequestBody = "";
  const query = queryString ? `?${queryString}` : "";
  for (const id of ids) {
    batchRequestBody += `--batch_boundary\nContent-Type: application/http\n\nGET ${endpoint}/${encodeURIComponent(id)}${query}\n\n`;
  }
  batchRequestBody += "--batch_boundary--";

  const res = await fetch(getGoogleGmailBatchUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "multipart/mixed; boundary=batch_boundary",
      "Accept-Encoding": "gzip",
      "User-Agent": "Inbox-Zero (gzip)",
    },
    body: batchRequestBody,
  });

  const textRes = await res.text();

  const batch = parseBatchResponse(textRes, res.headers.get("Content-Type"));

  if (meter) {
    const rateLimited =
      res.status === 429
        ? { status: 429 }
        : batch.find((item) => item?.error?.code === 429 || isQuota403(item));
    if (rateLimited) {
      await recordGmailQuotaResponse({
        error: {
          response: {
            status: res.status === 429 ? 429 : rateLimited.error.code,
            data: { error: rateLimited.error },
            headers: { "retry-after": res.headers.get("Retry-After") },
          },
        },
        emailAccountId: meter.emailAccountId,
        logger: meter.logger,
      });
    }
  }

  return batch;
}

function parseBatchResponse(batchResponse: string, contentType: string | null) {
  checkBatchResponseForError(batchResponse);

  // Extracting boundary from the Content-Type header
  const boundaryRegex = /boundary=(.*?)(;|$)/;
  const boundaryMatch = contentType?.match(boundaryRegex);
  const boundary = boundaryMatch ? boundaryMatch[1] : null;

  if (!boundary) {
    logger.error("No boundary found in response", { batchResponse });
    throw new Error("parseBatchResponse: No boundary found in response");
  }

  const parts = batchResponse.split(`--${boundary}`);

  // Process each part
  const decodedParts = parts.map((part) => {
    // Skip empty parts
    if (!part.trim()) return;

    // Find where the JSON part of the response starts
    const jsonStartIndex = part.indexOf("{");
    if (jsonStartIndex === -1) return; // Skip if no JSON data found

    // Extract the JSON string
    const jsonResponse = part.slice(jsonStartIndex);

    // Parse the JSON string
    try {
      const data = JSON.parse(jsonResponse);

      return data;
    } catch (error) {
      logger.error("Error parsing JSON", { error });
    }
  });

  return decodedParts.filter(isDefined);
}

function checkBatchResponseForError(batchResponse: string) {
  try {
    const jsonResponse = JSON.parse(batchResponse);

    if (jsonResponse.error) {
      throw new Error(
        "parseBatchResponse: Error in batch response",
        jsonResponse.error,
      );
    }
  } catch {
    // not json. skipping
  }
}

function isQuota403(item: {
  error?: { code?: number; errors?: { reason?: string }[] };
}) {
  return (
    item?.error?.code === 403 &&
    ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"].includes(
      String(item.error.errors?.[0]?.reason),
    )
  );
}
