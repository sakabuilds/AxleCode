// @effect-diagnostics nodeBuiltinImport:off - Tests exercise git subprocesses directly.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  GitError,
  assertCredentialFreeHttpsUrl,
  assertInsideRoot,
  checkoutWorkspace,
  currentHead,
  prepareWorkspace,
  snapshotWorkspace,
} from "./git.ts";

function hasGit(): boolean {
  try {
    NodeChildProcess.execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const gitAvailable = hasGit();
const temporaries: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), prefix));
  temporaries.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of temporaries) {
    await NodeFS.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

function git(args: string[], cwd: string): void {
  NodeChildProcess.execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
}

describe("git URL policy", () => {
  it("accepts credential-free https and rejects everything else", () => {
    expect(assertCredentialFreeHttpsUrl("https://github.com/example/project.git").host).toBe("github.com");
    for (const url of [
      "http://github.com/example/project.git",
      "ssh://git@github.com/example/project.git",
      "git@github.com:example/project.git",
      "https://user:token@github.com/example/project.git",
      "https://github.com:8443/example/project.git",
      "https://github.com/example/project.git?ref=main",
      "not a url",
    ]) {
      expect(() => assertCredentialFreeHttpsUrl(url)).toThrow(GitError);
    }
  });

  it("keeps workspace paths inside the configured root", () => {
    const root = NodePath.join(NodeOS.tmpdir(), "axle-root");
    expect(assertInsideRoot(root, NodePath.join(root, "job-1"))).toBe(NodePath.join(root, "job-1"));
    expect(() => assertInsideRoot(root, NodePath.join(root, "..", "escape"))).toThrow(GitError);
  });
});

describe.skipIf(!gitAvailable)("git workspace operations", () => {
  it("clones, snapshots the agent changes, and exports patch + bundle", async () => {
    const origin = await tempDir("axle-origin-");
    git(["init", "--quiet", "-b", "main"], origin);
    await NodeFS.writeFile(NodePath.join(origin, "README.md"), "hello\n", "utf8");
    git(["add", "-A"], origin);
    git(["-c", "user.name=test", "-c", "user.email=test@test.invalid", "commit", "--quiet", "-m", "init"], origin);
    const sourceRevision = NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: origin }).toString().trim();

    const root = await tempDir("axle-work-");
    const workspacePath = NodePath.join(root, "job-1");
    await NodeFS.writeFile(NodePath.join(origin, "README.md"), "hello\nworld\n", "utf8");
    git(["add", "-A"], origin);
    git(["-c", "user.name=test", "-c", "user.email=test@test.invalid", "commit", "--quiet", "-m", "second"], origin);
    const secondRevision = NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: origin }).toString().trim();

    await checkoutWorkspace({ workspaceRoot: root, workspacePath, repositoryUrl: `file:///${origin.replace(/\\/gu, "/")}`, sourceRevision });
    await expect(
      prepareWorkspace({ workspaceRoot: root, workspacePath, repositoryUrl: "ssh://git@github.com/x/y.git", sourceRevision }),
    ).rejects.toThrow(GitError);

    const head = await currentHead(workspacePath);
    expect(head).toBe(sourceRevision);

    await NodeFS.writeFile(NodePath.join(workspacePath, "README.md"), "hello\nworld\nagent\n", "utf8");
    await NodeFS.writeFile(NodePath.join(workspacePath, "new-file.txt"), "created by agent\n", "utf8");
    const staging = await tempDir("axle-staging-");
    const snapshot = await snapshotWorkspace({ workspacePath, sourceRevision, stagingDir: staging });
    expect(snapshot.headRevision).not.toBe(sourceRevision);
    expect(snapshot.diffPath).not.toBeNull();
    const patch = await NodeFS.readFile(snapshot.diffPath!, "utf8");
    expect(patch).toContain("new-file.txt");
    expect(patch).toContain("agent");
    // The bundle records the local snapshot commit so the tree can be replayed.
    expect(snapshot.bundlePath).not.toBeNull();
    const bundleHeads = NodeChildProcess.execFileSync("git", ["bundle", "list-heads", snapshot.bundlePath!], { cwd: workspacePath }).toString();
    expect(bundleHeads).toContain(snapshot.headRevision);

    // Nothing was pushed anywhere; the origin still points at its own work.
    const originHead = NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: origin }).toString().trim();
    expect(originHead).toBe(secondRevision);
  });

  it("returns no snapshot artifacts when the workspace is untouched", async () => {
    const origin = await tempDir("axle-clean-");
    git(["init", "--quiet", "-b", "main"], origin);
    await NodeFS.writeFile(NodePath.join(origin, "a.txt"), "a\n", "utf8");
    git(["add", "-A"], origin);
    git(["-c", "user.name=test", "-c", "user.email=test@test.invalid", "commit", "--quiet", "-m", "init"], origin);
    const sourceRevision = NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: origin }).toString().trim();

    const root = await tempDir("axle-clean-work-");
    const workspacePath = NodePath.join(root, "job-2");
    await checkoutWorkspace({ workspaceRoot: root, workspacePath, repositoryUrl: `file:///${origin.replace(/\\/gu, "/")}`, sourceRevision });
    const staging = await tempDir("axle-clean-staging-");
    const snapshot = await snapshotWorkspace({ workspacePath, sourceRevision, stagingDir: staging });
    expect(snapshot.headRevision).toBe(sourceRevision);
    expect(snapshot.diffPath).toBeNull();
    expect(snapshot.bundlePath).toBeNull();
  });
});
