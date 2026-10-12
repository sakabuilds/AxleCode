import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function createStorage(overrides: Partial<Storage> = {}): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
    ...overrides,
  };
}

async function loadWithStorage(storage: Storage) {
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("localStorage", storage);
  return import("./useLocalStorage");
}

afterEach(() => {
  vi.doUnmock("react");
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("local storage errors", () => {
  it("preserves read failure context", async () => {
    const cause = new Error("storage unavailable");
    const { getLocalStorageItem, LocalStorageOperationError } = await loadWithStorage(
      createStorage({
        getItem: () => {
          throw cause;
        },
      }),
    );

    try {
      getLocalStorageItem("read-key", Schema.String);
      expect.unreachable("expected the read to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalStorageOperationError);
      expect(error).toMatchObject({
        operation: "read",
        storageKey: "read-key",
        cause,
      });
    }
  });

  it("preserves decode failure context", async () => {
    const { getLocalStorageItem, LocalStorageOperationError } = await loadWithStorage(
      createStorage({ getItem: () => "not-json" }),
    );

    try {
      getLocalStorageItem("decode-key", Schema.String);
      expect.unreachable("expected decoding to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalStorageOperationError);
      expect(error).toMatchObject({
        operation: "decode",
        storageKey: "decode-key",
        cause: expect.anything(),
      });
    }
  });

  it("preserves write failure context", async () => {
    const cause = new Error("storage quota exceeded");
    const { LocalStorageOperationError, setLocalStorageItem } = await loadWithStorage(
      createStorage({
        setItem: () => {
          throw cause;
        },
      }),
    );

    try {
      setLocalStorageItem("write-key", "value", Schema.String);
      expect.unreachable("expected the write to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalStorageOperationError);
      expect(error).toMatchObject({
        operation: "write",
        storageKey: "write-key",
        cause,
      });
    }
  });

  it("preserves removal failure context", async () => {
    const cause = new Error("storage unavailable");
    const { LocalStorageOperationError, removeLocalStorageItem } = await loadWithStorage(
      createStorage({
        removeItem: () => {
          throw cause;
        },
      }),
    );

    try {
      removeLocalStorageItem("remove-key");
      expect.unreachable("expected the removal to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalStorageOperationError);
      expect(error).toMatchObject({
        operation: "remove",
        storageKey: "remove-key",
        cause,
      });
    }
  });
});

describe("pre-rebrand key fallback", () => {
  it("reads a legacy value and promotes it on the next write", async () => {
    const storage = createStorage();
    storage.setItem("sparky.scheduled-tasks", JSON.stringify(["oldest-task"]));
    storage.setItem("rivet.scheduled-tasks", JSON.stringify(["legacy-task"]));
    vi.doMock("react", () => ({
      useCallback: <A>(callback: A) => callback,
      useMemo: <A>(factory: () => A) => factory(),
      useSyncExternalStore: (
        _subscribe: unknown,
        getSnapshot: () => unknown,
        _getServerSnapshot: unknown,
      ) => getSnapshot(),
    }));
    vi.stubGlobal("window", {
      localStorage: storage,
      dispatchEvent: () => true,
    });

    const { useLocalStorage } = await import("./useLocalStorage");
    const [value, setValue] = useLocalStorage(
      "axle.scheduled-tasks",
      [] as string[],
      Schema.Array(Schema.String),
      { legacyKeys: ["rivet.scheduled-tasks", "sparky.scheduled-tasks"] },
    );

    // The newest pre-rebrand key (rivet) wins when both are present.
    expect(value).toEqual(["legacy-task"]);

    setValue(["fresh-task"]);
    expect(storage.getItem("axle.scheduled-tasks")).toBe(JSON.stringify(["fresh-task"]));
    expect(storage.getItem("rivet.scheduled-tasks")).toBeNull();
    expect(storage.getItem("sparky.scheduled-tasks")).toBeNull();
  });

  it("falls back to the older sparky key when the rivet key is absent", async () => {
    const storage = createStorage();
    storage.setItem("sparky.scheduled-tasks", JSON.stringify(["sparky-task"]));
    vi.doMock("react", () => ({
      useCallback: <A>(callback: A) => callback,
      useMemo: <A>(factory: () => A) => factory(),
      useSyncExternalStore: (
        _subscribe: unknown,
        getSnapshot: () => unknown,
        _getServerSnapshot: unknown,
      ) => getSnapshot(),
    }));
    vi.stubGlobal("window", {
      localStorage: storage,
      dispatchEvent: () => true,
    });

    const { useLocalStorage } = await import("./useLocalStorage");
    const [value] = useLocalStorage(
      "axle.scheduled-tasks",
      [] as string[],
      Schema.Array(Schema.String),
      { legacyKeys: ["rivet.scheduled-tasks", "sparky.scheduled-tasks"] },
    );

    expect(value).toEqual(["sparky-task"]);
  });
});
