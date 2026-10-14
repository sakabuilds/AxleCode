// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - System-git operations run as host subprocesses with explicit timeouts.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";

/**
 * System-git operations for one cloud job workspace.
 *
 * Credentials never reach this module: repository URLs are re-validated to be
 * plain credential-free https URLs, `GIT_TERMINAL_PROMPT=0` fails instead of
 * prompting, and `GIT_CONFIG_NOSYSTEM=1` keeps host gitconfig out of the
 * clone so a worker host cannot be tricked into attaching stored credentials.
 */

export class GitError extends Error {
  readonly step: string;
  readonly detail: string;
  constructor(step: string, detail: string) {
    super(`git ${step} failed: ${detail}`);
    this.name = "GitError";
    this.step = step;
    this.detail = detail;
  }
}

const CLONE_TIMEOUT_MS = 10 * 60_000;
const GIT_TIMEOUT_MS = 60_000;
const MAX_DETAIL_CHARS = 2_000;

interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function assertCredentialFreeHttpsUrl(repositoryUrl: string): URL {
  let url: URL;
  try {
    url = new URL(repositoryUrl);
  } catch {
    throw new GitError("validate", "repository URL is not a valid URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.port.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new GitError("validate", "repository URL must be a credential-free https URL");
  }
  return url;
}

/** Resolve `workspacePath` and refuse anything outside `workspaceRoot`. */
export function assertInsideRoot(root: string, target: string): string {
  const resolvedRoot = NodePath.resolve(root);
  const resolvedTarget = NodePath.resolve(target);
  const prefix = resolvedRoot.endsWith(NodePath.sep) ? resolvedRoot : `${resolvedRoot}${NodePath.sep}`;
  if (!resolvedTarget.startsWith(prefix)) {
    throw new GitError("workspace", "path escapes the configured workspace root");
  }
  return resolvedTarget;
}

export interface PrepareWorkspaceArgs {
  readonly workspaceRoot: string;
  readonly workspacePath: string;
  readonly repositoryUrl: string;
  readonly sourceRevision: string;
}

/** Clone and check out exactly `sourceRevision`, preferring a partial clone. */
export async function prepareWorkspace(args: PrepareWorkspaceArgs): Promise<void> {
  assertCredentialFreeHttpsUrl(args.repositoryUrl);
  await checkoutWorkspace(args);
}

/**
 * Clone and check out exactly `sourceRevision` without re-validating the
 * repository URL. Exported for tests that drive local `file://` clones;
 * production callers go through `prepareWorkspace`, which enforces the
 * credential-free https policy before this runs.
 */
export async function checkoutWorkspace(args: PrepareWorkspaceArgs): Promise<void> {
  const workspacePath = assertInsideRoot(args.workspaceRoot, args.workspacePath);
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/u.test(args.sourceRevision)) {
    throw new GitError("validate", "source revision must be a full git object id");
  }
  await NodeFS.mkdir(NodePath.dirname(workspacePath), { recursive: true });
  await NodeFS.rm(workspacePath, { recursive: true, force: true });

  const partial = await attempt(async () => {
    await runGit(["clone", "--filter=blob:none", "--no-checkout", "--quiet", "--", args.repositoryUrl, workspacePath], {
      timeoutMs: CLONE_TIMEOUT_MS,
      step: "clone",
    });
    await runGit(["-C", workspacePath, "fetch", "--quiet", "origin", args.sourceRevision], {
      timeoutMs: CLONE_TIMEOUT_MS,
      step: "fetch",
    });
    await runGit(["-C", workspacePath, "checkout", "--quiet", "--detach", args.sourceRevision], {
      timeoutMs: GIT_TIMEOUT_MS,
      step: "checkout",
    });
  });
  if (!partial.ok) {
    await NodeFS.rm(workspacePath, { recursive: true, force: true });
    await runGit(["clone", "--quiet", "--", args.repositoryUrl, workspacePath], {
      timeoutMs: CLONE_TIMEOUT_MS,
      step: "clone",
    });
    await runGit(["-C", workspacePath, "checkout", "--quiet", "--detach", args.sourceRevision], {
      timeoutMs: GIT_TIMEOUT_MS,
      step: "checkout",
    });
  }

  const head = await currentHead(workspacePath);
  if (head !== args.sourceRevision) {
    throw new GitError("checkout", "workspace HEAD does not match the requested source revision");
  }
}

export async function currentHead(workspacePath: string): Promise<string> {
  const result = await runGit(["-C", workspacePath, "rev-parse", "HEAD"], { timeoutMs: GIT_TIMEOUT_MS, step: "rev-parse" });
  const head = result.stdout.trim();
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/u.test(head)) {
    throw new GitError("rev-parse", "git returned a malformed revision id");
  }
  return head;
}

export interface WorkspaceSnapshot {
  readonly headRevision: string;
  readonly diffPath: string | null;
  readonly bundlePath: string | null;
}

export interface SnapshotWorkspaceArgs {
  readonly workspacePath: string;
  readonly sourceRevision: string;
  readonly stagingDir: string;
}

/**
 * Capture the agent's changes as replayable artifacts.
 *
 * Sequence: stage everything (so new and deleted files are included), snapshot
 * the staged tree into a local-only commit when anything changed, then export
 * the source...HEAD patch and a git bundle. The snapshot commit is never
 * pushed; it exists so the bundle and `headRevision` describe the exact tree
 * the run ended with, and so an operator can replay interrupted work.
 */
export async function snapshotWorkspace(args: SnapshotWorkspaceArgs): Promise<WorkspaceSnapshot> {
  await NodeFS.mkdir(args.stagingDir, { recursive: true });
  await runGit(["-C", args.workspacePath, "-c", "core.safecrlf=false", "add", "-A"], {
    timeoutMs: GIT_TIMEOUT_MS,
    step: "add",
  });

  const staged = await runGitAllowFailure(["-C", args.workspacePath, "diff", "--cached", "--quiet"], {
    timeoutMs: GIT_TIMEOUT_MS,
    step: "diff",
  });
  if (staged.code !== 0 && staged.code !== 1) {
    throw new GitError("diff", "unable to inspect the staged tree");
  }
  const hasChanges = staged.code === 1;

  if (hasChanges) {
    await runGit(
      [
        "-C", args.workspacePath,
        "-c", "user.name=axle-cloud",
        "-c", "user.email=cloud@axle.invalid",
        "commit", "--quiet", "--no-gpg-sign", "-m", "axle: cloud run snapshot",
      ],
      { timeoutMs: GIT_TIMEOUT_MS, step: "commit" },
    );
  }

  const headRevision = await currentHead(args.workspacePath);
  if (!hasChanges && headRevision === args.sourceRevision) {
    return { headRevision, diffPath: null, bundlePath: null };
  }

  const diffPath = NodePath.join(args.stagingDir, "changes.diff");
  const diffResult = await runGit(
    ["-C", args.workspacePath, "diff", "--cached", "--binary", "--no-color", "--no-ext-diff", args.sourceRevision],
    { timeoutMs: GIT_TIMEOUT_MS, step: "diff-export" },
  );
  await NodeFS.writeFile(diffPath, diffResult.stdout, "utf8");

  let bundlePath: string | null = null;
  if (headRevision !== args.sourceRevision) {
    bundlePath = NodePath.join(args.stagingDir, "changes.bundle");
    const bundle = await runGitAllowFailure(
      ["-C", args.workspacePath, "bundle", "create", bundlePath, `${args.sourceRevision}..HEAD`],
      { timeoutMs: GIT_TIMEOUT_MS, step: "bundle" },
    );
    if (bundle.code !== 0) bundlePath = null;
  }

  return { headRevision, diffPath, bundlePath };
}

/** Never let stderr (which may quote file contents) exceed a bounded payload. */
function bounded(stderr: string): string {
  return stderr.trim().slice(0, MAX_DETAIL_CHARS);
}

async function attempt(operation: () => Promise<void>): Promise<{ ok: boolean }> {
  try {
    await operation();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

async function runGit(args: ReadonlyArray<string>, options: { timeoutMs: number; step: string }): Promise<GitResult> {
  const result = await runGitAllowFailure(args, options);
  if (result.code !== 0) {
    throw new GitError(options.step, bounded(result.stderr) || `exit code ${result.code}`);
  }
  return result;
}

function runGitAllowFailure(
  args: ReadonlyArray<string>,
  options: { timeoutMs: number; step: string },
): Promise<GitResult> {
  return new Promise<GitResult>((resolve, reject) => {
    const child = NodeChildProcess.spawn("git", [...args], {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error: Error) => {
      clearTimeout(timer);
      reject(new GitError(options.step, error.message));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new GitError(options.step, `timed out after ${options.timeoutMs}ms`));
        return;
      }
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
