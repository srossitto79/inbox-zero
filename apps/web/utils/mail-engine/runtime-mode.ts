export type MailEngineRuntimeMode =
  | "desktop-ipc"
  | "server"
  | "browser"
  | "unavailable";

export function selectMailEngineRuntimeMode(input: {
  desktopIpc: boolean;
  server: boolean;
  opfs: boolean;
}): MailEngineRuntimeMode {
  if (input.desktopIpc) return "desktop-ipc";
  if (input.server) return "server";
  if (input.opfs) return "browser";
  return "unavailable";
}
