import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every Gmail API call has to go through the EmailProvider made by
// createEmailProvider, so that store-first reads, rate-limit recording and the
// sync budget apply. This scans the source for code that would bypass it.

const repoRoot = path.resolve(__dirname, "../../../..");
const scannedRoots = ["apps", "packages"];
const skippedDirectories = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "generated",
  "__tests__",
  "__mocks__",
]);

// The only places allowed to hold a Gmail client or call users.*.
const gatewayFiles = [
  "apps/web/utils/gmail/", // Gmail API wrappers, called only by GmailProvider
  "apps/web/utils/email/google.ts", // GmailProvider
  "apps/web/utils/email/provider.ts", // createEmailProvider builds the Gmail client
  "apps/web/utils/email-account-client.ts", // client factory
];

// Symbols other code may import from the gateway modules: constants, pure
// helpers and OAuth-only functions that never call the Gmail API.
const allowedGatewayImports: Record<string, string[]> = {
  constants: ["*"],
  decode: ["*"],
  forward: ["*"],
  "label-colors": ["*"],
  "label-validation": ["*"],
  reply: ["*"],
  scopes: ["*"],
  snippet: ["*"],
  client: ["getLinkingOAuth2Client"],
  label: ["GmailLabel", "GMAIL_SYSTEM_LABELS"],
  permissions: ["handleGmailPermissionsCheck"],
  retry: ["extractErrorInfo", "isRetryableError", "calculateRetryDelay"],
  thread: ["queryIncludesSpamOrTrash"],
};

const gmailClientAccessors =
  /\b(getGmailClient\w*|getGmailAccessToken\w*|getGmailAndAccessToken\w*|getContactsClient)\b/;
const gmailApiCall =
  /\.users\.(messages|threads|labels|history|drafts|settings|getProfile|watch|stop)\b/;
const googleApisValueImport =
  /import\s+(?!type\b)[^;]*?from\s+["'](?:@googleapis\/gmail|googleapis)["']/;
const importStatement =
  /(?:import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']@\/utils\/gmail\/([\w-]+)["']/g;

describe("Gmail gateway", () => {
  const files = listSourceFiles(repoRoot).filter(
    (file) => !gatewayFiles.some((gateway) => file.startsWith(gateway)),
  );

  it("scans the application source", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("keeps Gmail clients and users.* calls inside the gateway", () => {
    const violations = files.flatMap((file) => {
      const source = stripComments(
        readFileSync(path.join(repoRoot, file), "utf8"),
      );
      return [
        gmailClientAccessors.test(source) && "obtains a raw Gmail client",
        gmailApiCall.test(source) && "calls the Gmail API (users.*)",
        googleApisValueImport.test(source) && "imports the googleapis runtime",
        ...findDisallowedGatewayImports(source),
      ]
        .filter((reason): reason is string => Boolean(reason))
        .map((reason) => `${file}: ${reason}`);
    });

    expect(violations).toEqual([]);
  });
});

function findDisallowedGatewayImports(source: string) {
  const reasons: string[] = [];
  for (const [, typeOnly, clause, moduleName] of source.matchAll(
    importStatement,
  )) {
    if (typeOnly) continue;
    const allowed = allowedGatewayImports[moduleName];
    const symbols = parseImportedSymbols(clause);
    const disallowed = symbols.filter(
      (symbol) => !allowed || (allowed[0] !== "*" && !allowed.includes(symbol)),
    );
    if (disallowed.length > 0 || (!allowed && symbols.length === 0))
      reasons.push(
        `imports ${disallowed.join(", ") || "*"} from utils/gmail/${moduleName}; use the EmailProvider`,
      );
  }
  return reasons;
}

function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function parseImportedSymbols(clause: string) {
  return clause
    .replace(/[{}]/g, "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("type "))
    .map((part) => part.split(/\s+as\s+/)[0].trim());
}

function listSourceFiles(root: string) {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name))
          walk(path.join(directory, entry.name));
      } else if (
        /\.(ts|tsx|mts|js|mjs|cjs)$/.test(entry.name) &&
        !/\.(test|spec)\.\w+$/.test(entry.name)
      ) {
        files.push(
          path
            .relative(root, path.join(directory, entry.name))
            .replaceAll("\\", "/"),
        );
      }
    }
  };
  for (const scannedRoot of scannedRoots) walk(path.join(root, scannedRoot));
  return files;
}
