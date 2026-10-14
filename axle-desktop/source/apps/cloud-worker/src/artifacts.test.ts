// @effect-diagnostics nodeBuiltinImport:off - Tests exercise host filesystem paths directly.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ArtifactStoreError, FileArtifactStore } from "./artifacts.ts";

async function tempStore(options: { maxBytes?: number } = {}): Promise<{ store: FileArtifactStore; root: string }> {
  const root = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "axle-artifacts-"));
  return { store: new FileArtifactStore({ root, ...options }), root };
}

describe("artifact store", () => {
  it("writes text artifacts under the job namespace with sha256 and size", async () => {
    const { store, root } = await tempStore();
    const artifact = await store.writeText({
      jobId: "job-1",
      kind: "log",
      name: "session.ndjson",
      contents: "{\"type\":\"result\"}\n",
    });
    expect(artifact.storageKey).toBe("jobs/job-1/log/session.ndjson");
    expect(artifact.sizeBytes).toBe(Buffer.byteLength("{\"type\":\"result\"}\n"));
    expect(artifact.sha256).toBe(
      NodeCrypto.createHash("sha256").update(Buffer.from("{\"type\":\"result\"}\n")).digest("hex"),
    );
    const written = await NodeFS.readFile(NodePath.join(root, "jobs", "job-1", "log", "session.ndjson"), "utf8");
    expect(written).toBe("{\"type\":\"result\"}\n");
  });

  it("streams file artifacts and hashes the copied bytes", async () => {
    const { store, root } = await tempStore();
    const source = NodePath.join(root, "source.diff");
    const payload = "diff --git a/file b/file\n+hello\n";
    await NodeFS.writeFile(source, payload, "utf8");
    const artifact = await store.writeFromFile({ jobId: "job-2", kind: "diff", name: "changes.diff", sourcePath: source });
    expect(artifact.kind).toBe("diff");
    expect(artifact.sha256).toBe(NodeCrypto.createHash("sha256").update(Buffer.from(payload)).digest("hex"));
    await expect(NodeFS.readFile(store.resolveStoragePath(artifact.storageKey), "utf8")).resolves.toBe(payload);
  });

  it("refuses traversal, bad segment characters, and oversized artifacts", async () => {
    const { store, root } = await tempStore({ maxBytes: 4 });
    expect(() => store.storageKey("../evil", "log", "x")).toThrow(ArtifactStoreError);
    expect(() => store.storageKey("job-1", "log", "..")).toThrow(ArtifactStoreError);
    expect(() => store.resolveStoragePath("jobs/../../etc/passwd")).toThrow(ArtifactStoreError);
    expect(() => store.resolveStoragePath("other/job-1/log/x")).toThrow(ArtifactStoreError);
    const tooBig = await store
      .writeText({ jobId: "job-1", kind: "log", name: "big.log", contents: "12345" })
      .catch((error: unknown) => error);
    expect(tooBig).toBeInstanceOf(ArtifactStoreError);
    await expect(NodeFS.stat(NodePath.join(root, "jobs", "job-1", "log"))).rejects.toThrow();
  });

  it("ships a staging directory outside every workspace", async () => {
    const { store } = await tempStore();
    const staging = store.stagingDir("job-9");
    expect(staging.endsWith(NodePath.join("staging", "job-9"))).toBe(true);
    await NodeFS.mkdir(staging, { recursive: true });
    await expect(NodeFS.stat(staging)).resolves.toBeTruthy();
  });
});
