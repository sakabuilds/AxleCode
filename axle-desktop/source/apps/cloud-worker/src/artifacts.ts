// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

import type { CloudJobResult } from "@axle/contracts";

/**
 * Local artifact store.
 *
 * The control plane only persists a manifest (kind, storageKey, sha256,
 * sizeBytes); artifact bytes stay on worker storage and are fetched out of
 * band. Storage keys always live under `jobs/{jobId}/...`, matching the
 * control plane's validation, so a compromised runner cannot address another
 * job's namespace.
 */

export type CloudArtifact = CloudJobResult["artifacts"][number];

export class ArtifactStoreError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`artifact store rejected the write (${reason})`);
    this.name = "ArtifactStoreError";
    this.reason = reason;
  }
}

const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

export interface FileArtifactStoreOptions {
  readonly root: string;
  readonly maxBytes?: number;
}

export class FileArtifactStore {
  private readonly root: string;
  private readonly maxBytes: number;

  constructor(options: FileArtifactStoreOptions) {
    this.root = NodePath.resolve(options.root);
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  /** Scratch directory outside any workspace: approval files and transcripts. */
  stagingDir(jobId: string): string {
    return this.resolveSegmentPath(["staging", jobId]);
  }

  storageKey(jobId: string, kind: CloudArtifact["kind"], name: string): string {
    if (!SEGMENT_PATTERN.test(jobId)) throw new ArtifactStoreError("invalid_job_id");
    if (!SEGMENT_PATTERN.test(name)) throw new ArtifactStoreError("invalid_name");
    return `jobs/${jobId}/${kind}/${name}`;
  }

  /** Absolute path for a storage key; refuses traversal and odd segments. */
  resolveStoragePath(storageKey: string): string {
    const segments = storageKey.split("/");
    if (segments.length < 3 || segments[0] !== "jobs" || !segments.every((part) => SEGMENT_PATTERN.test(part))) {
      throw new ArtifactStoreError("invalid_storage_key");
    }
    return this.resolveSegmentPath(segments);
  }

  /** Copy `sourcePath` into the store, returning the manifest entry. */
  async writeFromFile(args: {
    readonly jobId: string;
    readonly kind: CloudArtifact["kind"];
    readonly name: string;
    readonly sourcePath: string;
  }): Promise<CloudArtifact> {
    const storageKey = this.storageKey(args.jobId, args.kind, args.name);
    const destination = this.resolveStoragePath(storageKey);
    const stats = await NodeFS.promises.stat(args.sourcePath).catch(() => null);
    if (!stats || !stats.isFile()) throw new ArtifactStoreError("missing_source");
    if (stats.size > this.maxBytes) throw new ArtifactStoreError("too_large");
    await NodeFS.promises.mkdir(NodePath.dirname(destination), { recursive: true });
    const hash = NodeCrypto.createHash("sha256");
    const hasher = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(NodeFS.createReadStream(args.sourcePath), hasher, NodeFS.createWriteStream(destination));
    return {
      kind: args.kind,
      storageKey,
      sha256: hash.digest("hex"),
      sizeBytes: stats.size,
    };
  }

  /** Write a string artifact (text is hashed and measured as UTF-8 bytes). */
  async writeText(args: {
    readonly jobId: string;
    readonly kind: CloudArtifact["kind"];
    readonly name: string;
    readonly contents: string;
  }): Promise<CloudArtifact> {
    const storageKey = this.storageKey(args.jobId, args.kind, args.name);
    const destination = this.resolveStoragePath(storageKey);
    const buffer = Buffer.from(args.contents, "utf8");
    if (buffer.byteLength > this.maxBytes) throw new ArtifactStoreError("too_large");
    await NodeFS.promises.mkdir(NodePath.dirname(destination), { recursive: true });
    await NodeFS.promises.writeFile(destination, buffer);
    return {
      kind: args.kind,
      storageKey,
      sha256: NodeCrypto.createHash("sha256").update(buffer).digest("hex"),
      sizeBytes: buffer.byteLength,
    };
  }

  private resolveSegmentPath(segments: ReadonlyArray<string>): string {
    if (!segments.every((part) => SEGMENT_PATTERN.test(part))) {
      throw new ArtifactStoreError("invalid_segment");
    }
    const resolved = NodePath.resolve(this.root, ...segments);
    const prefix = this.root.endsWith(NodePath.sep) ? this.root : `${this.root}${NodePath.sep}`;
    if (!resolved.startsWith(prefix)) throw new ArtifactStoreError("path_escape");
    return resolved;
  }
}
