import { format } from "date-fns";
import { sanitizeEmailHtml } from "@/utils/email/prepare-html.client";
import type { ParsedMessage } from "@/utils/types";

/** Prints in a hidden frame so the app shell never ends up on the page. */
export function printMessages(messages: ParsedMessage[], subject: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  frame.srcdoc = buildPrintDocument(messages, subject);
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return;
    win.addEventListener("afterprint", () => frame.remove());
    win.focus();
    win.print();
  };
  document.body.appendChild(frame);
}

export function buildPrintDocument(messages: ParsedMessage[], subject: string) {
  const sections = messages.map(renderMessage).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title><style>
body{font:14px/1.5 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#111;margin:24px}
h1{font-size:20px;margin:0 0 16px}
section{border-top:1px solid #ccc;padding:12px 0;break-inside:auto}
section:first-of-type{border-top:0}
dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:0 0 12px;font-size:12px;color:#444}
dt{font-weight:600}dd{margin:0;word-break:break-word}
pre{white-space:pre-wrap;font:inherit;margin:0}
img{max-width:100%;height:auto}
</style></head><body><h1>${escapeHtml(subject)}</h1>${sections}</body></html>`;
}

function renderMessage(message: ParsedMessage) {
  const { headers } = message;
  const rows: [string, string | undefined][] = [
    ["From", headers.from],
    ["To", headers.to],
    ["Cc", headers.cc],
    ["Date", formatDate(headers.date || message.internalDate || message.date)],
  ];
  const meta = rows
    .filter(([, value]) => value)
    .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value!)}</dd>`)
    .join("");
  const body = message.textHtml
    ? sanitizeEmailHtml(message.textHtml)
    : `<pre>${escapeHtml(message.textPlain ?? message.snippet ?? "")}</pre>`;
  return `<section><dl>${meta}</dl><div>${body}</div></section>`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : format(date, "PPpp");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
