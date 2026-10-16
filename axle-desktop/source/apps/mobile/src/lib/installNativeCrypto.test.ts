import * as NodeChildProcess from "node:child_process";
import * as NodeModule from "node:module";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const nativeCrypto = vi.hoisted(() => ({
  getRandomValues: vi.fn((values: Uint8Array) => {
    values.fill(0xa5);
    return values;
  }),
  randomUUID: vi.fn(() => "823cfcec-ed21-4338-ac06-5d136c7669df"),
}));

vi.mock("expo-crypto", () => nativeCrypto);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("native startup crypto", () => {
  it("lets the actual Neon SDK load and initialize when Hermes has no crypto global", async () => {
    const require = NodeModule.createRequire(import.meta.url);
    const authEntry = NodeURL.pathToFileURL(require.resolve("@neondatabase/auth")).href;
    // A fresh process avoids an already evaluated SDK hiding its import-time failure.
    const withoutBridge = NodeChildProcess.spawnSync(
      NodeProcess.execPath,
      [
        "--input-type=module",
        "--eval",
        `delete globalThis.crypto; await import(${JSON.stringify(authEntry)});`,
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    expect(withoutBridge.error).toBeUndefined();
    expect(withoutBridge.status).toBe(1);
    expect(withoutBridge.stderr).toContain("ReferenceError: crypto is not defined");

    vi.stubGlobal("crypto", undefined);
    await import("./installNativeCrypto");
    const { createInternalNeonAuth } = await import("@neondatabase/auth");
    const { BetterAuthVanillaAdapter } = await import("@neondatabase/auth/vanilla/adapters");
    const auth = createInternalNeonAuth("https://auth.example.com/", {
      adapter: BetterAuthVanillaAdapter(),
    });

    expect(nativeCrypto.randomUUID).toHaveBeenCalled();
    expect(auth.adapter.getSession).toBeTypeOf("function");
    expect(auth.getJWTToken).toBeTypeOf("function");
    const bytes = new Uint8Array(4);
    expect(globalThis.crypto.getRandomValues(bytes)).toBe(bytes);
    expect([...bytes]).toEqual([0xa5, 0xa5, 0xa5, 0xa5]);
    expect(nativeCrypto.getRandomValues).toHaveBeenCalledWith(bytes);
    expect(globalThis.crypto.subtle).toBeUndefined();
  });

  it("preserves existing random values and other crypto APIs while adding UUID support", async () => {
    const getRandomValues = vi.fn((values: Uint8Array) => values);
    const subtle = { digest: vi.fn() };
    const existingCrypto = { getRandomValues, subtle };
    vi.stubGlobal("crypto", existingCrypto);

    await import("./installNativeCrypto");

    expect(globalThis.crypto).toBe(existingCrypto);
    expect(globalThis.crypto.getRandomValues).toBe(getRandomValues);
    expect(globalThis.crypto.subtle).toBe(subtle);
    expect(globalThis.crypto.randomUUID()).toBe("823cfcec-ed21-4338-ac06-5d136c7669df");
  });

  it("preserves an existing UUID implementation while adding native random values", async () => {
    const randomUUID = vi.fn(() => "a567060e-4b74-4d7f-a1c1-2031372f20b8");
    const existingCrypto = { randomUUID };
    vi.stubGlobal("crypto", existingCrypto);

    await import("./installNativeCrypto");

    expect(globalThis.crypto).toBe(existingCrypto);
    expect(globalThis.crypto.randomUUID).toBe(randomUUID);
    expect(globalThis.crypto.getRandomValues).toBe(nativeCrypto.getRandomValues);
  });

  it("leaves a complete runtime crypto implementation untouched", async () => {
    const existingCrypto = Object.freeze({
      randomUUID: vi.fn(),
      getRandomValues: vi.fn(),
      subtle: Object.freeze({ digest: vi.fn() }),
    });
    vi.stubGlobal("crypto", existingCrypto);

    await import("./installNativeCrypto");

    expect(globalThis.crypto).toBe(existingCrypto);
    expect(nativeCrypto.randomUUID).not.toHaveBeenCalled();
    expect(nativeCrypto.getRandomValues).not.toHaveBeenCalled();
  });
});
