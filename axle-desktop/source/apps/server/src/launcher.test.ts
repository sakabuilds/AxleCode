// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFileSystem from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import {
  buildLauncherEnvironment,
  resolveLauncherLayout,
  resolveAxleHome,
  AXLE_DIRECTORIES,
} from "./launcher.ts";

describe("Axle npm launcher", () => {
  it("uses AXLE_HOME before the legacy T3CODE_HOME variable", () => {
    expect(
      resolveAxleHome(
        {
          AXLE_HOME: "C:\\Users\\test\\.Axle",
          T3CODE_HOME: "C:\\Users\\test\\.t3",
        },
        "C:\\Users\\test",
      ),
    ).toBe("C:\\Users\\test\\.Axle");
  });

  it("reads the previous RIVET_HOME override as a bridge when AXLE_HOME is unset", () => {
    expect(
      resolveAxleHome(
        {
          RIVET_HOME: "C:\\Users\\test\\.Rivet",
          T3CODE_HOME: "C:\\Users\\test\\.t3",
        },
        "C:\\Users\\test",
      ),
    ).toBe("C:\\Users\\test\\.Rivet");
    expect(
      resolveAxleHome(
        {
          AXLE_HOME: "C:\\Users\\test\\.Axle",
          RIVET_HOME: "C:\\Users\\test\\.Rivet",
        },
        "C:\\Users\\test",
      ),
    ).toBe("C:\\Users\\test\\.Axle");
  });

  it("defaults new launcher installs to a user .Axle directory", () => {
    expect(resolveAxleHome({}, "C:\\Users\\test")).toBe("C:\\Users\\test\\.Axle");
  });

  it("reuses an existing legacy .t3 home until .Axle has its own state", () => {
    const testRoot = NodeFileSystem.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "axle-launcher-"));
    const legacyStatePath = NodePath.join(testRoot, ".t3", "userdata", "state.sqlite");
    NodeFileSystem.mkdirSync(NodePath.dirname(legacyStatePath), { recursive: true });
    NodeFileSystem.writeFileSync(legacyStatePath, "legacy-state");

    try {
      expect(resolveAxleHome({}, testRoot)).toBe(NodePath.join(testRoot, ".t3"));
    } finally {
      NodeFileSystem.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("reuses an existing pre-rebrand .sparky-desktop home until .Axle has its own state", () => {
    const testRoot = NodeFileSystem.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "axle-launcher-"));
    const legacyStatePath = NodePath.join(testRoot, ".sparky-desktop", "userdata", "state.sqlite");
    NodeFileSystem.mkdirSync(NodePath.dirname(legacyStatePath), { recursive: true });
    NodeFileSystem.writeFileSync(legacyStatePath, "legacy-state");

    try {
      expect(resolveAxleHome({}, testRoot)).toBe(NodePath.join(testRoot, ".sparky-desktop"));
    } finally {
      NodeFileSystem.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("prefers a pre-rebrand .Rivet home over the older .sparky-desktop home", () => {
    const testRoot = NodeFileSystem.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "axle-launcher-"));
    for (const homeName of [".Rivet", ".sparky-desktop"]) {
      const statePath = NodePath.join(testRoot, homeName, "userdata", "state.sqlite");
      NodeFileSystem.mkdirSync(NodePath.dirname(statePath), { recursive: true });
      NodeFileSystem.writeFileSync(statePath, "legacy-state");
    }

    try {
      expect(resolveAxleHome({}, testRoot)).toBe(NodePath.join(testRoot, ".Rivet"));
    } finally {
      NodeFileSystem.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("matches the server's persistent state layout", () => {
    const layout = resolveLauncherLayout("C:\\Users\\test\\.Axle");

    expect(layout.stateDir).toBe("C:\\Users\\test\\.Axle\\userdata");
    expect(layout.databasePath).toBe("C:\\Users\\test\\.Axle\\userdata\\state.sqlite");
    expect(layout.logsDir).toBe("C:\\Users\\test\\.Axle\\userdata\\logs");
    expect(layout.attachmentsDir).toBe("C:\\Users\\test\\.Axle\\userdata\\attachments");
    expect(layout.secretsDir).toBe("C:\\Users\\test\\.Axle\\userdata\\secrets");
    expect(AXLE_DIRECTORIES).toContain("userdata/logs/provider");
    expect(AXLE_DIRECTORIES).toContain("userdata/logs/terminals");
  });

  it("uses the external packaged icon path when the runtime provides one", () => {
    const layout = resolveLauncherLayout("C:\\Users\\test\\.Axle");

    if (process.env.NODE_ENV === "test" && process.platform === "win32") {
      expect(layout.iconPath).not.toContain("app.asar");
    }
  });

  it("sets both new and legacy home variables for provider compatibility", () => {
    const environment = buildLauncherEnvironment("C:\\Users\\test\\.Axle", {
      PATH: "test-path",
    });

    expect(environment.AXLE_HOME).toBe("C:\\Users\\test\\.Axle");
    expect(environment.T3CODE_HOME).toBe("C:\\Users\\test\\.Axle");
    expect(environment.T3CODE_MODE).toBe("desktop");
    expect(environment.T3CODE_NO_BROWSER).toBe("true");
    expect(environment.T3CODE_HOST).toBe("127.0.0.1");
    expect(environment.T3CODE_DESKTOP_BACKEND_ENTRY).toContain("bin.mjs");
    expect(environment.T3CODE_DESKTOP_BACKEND_CWD).toContain("server");
    expect(environment.PATH).toBe("test-path");
  });
});
