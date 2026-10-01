import { describe, expect, it } from "vitest";
import { selectMailEngineRuntimeMode } from "./runtime-mode";

describe("selectMailEngineRuntimeMode", () => {
  it("prefers desktop IPC over the server and OPFS", () => {
    expect(
      selectMailEngineRuntimeMode({
        desktopIpc: true,
        server: true,
        opfs: true,
      }),
    ).toBe("desktop-ipc");
    expect(
      selectMailEngineRuntimeMode({
        desktopIpc: true,
        server: false,
        opfs: false,
      }),
    ).toBe("desktop-ipc");
  });

  it("uses the server mailbox even where the browser has no OPFS", () => {
    expect(
      selectMailEngineRuntimeMode({
        desktopIpc: false,
        server: true,
        opfs: false,
      }),
    ).toBe("server");
    expect(
      selectMailEngineRuntimeMode({
        desktopIpc: false,
        server: true,
        opfs: true,
      }),
    ).toBe("server");
  });

  it("uses the browser engine when OPFS is available", () => {
    expect(
      selectMailEngineRuntimeMode({
        desktopIpc: false,
        server: false,
        opfs: true,
      }),
    ).toBe("browser");
  });

  it("is unavailable without desktop IPC, the server mailbox or OPFS", () => {
    expect(
      selectMailEngineRuntimeMode({
        desktopIpc: false,
        server: false,
        opfs: false,
      }),
    ).toBe("unavailable");
  });
});
