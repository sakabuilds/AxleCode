// @effect-diagnostics nodeBuiltinImport:off globalDate:off - This host-side fixture creates an isolated local T3 environment.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

export const SHOWCASE_PROJECT_ID = "t3code";
export const SHOWCASE_THREAD_ID = "remote-command-center";
export const SHOWCASE_TERMINAL_ID = "term-1";

export const SHOWCASE_SCENES = ["threads", "thread", "terminal", "review", "environments"] as const;
export type ShowcaseScene = (typeof SHOWCASE_SCENES)[number];

const PROJECTOR_NAMES = [
  "projection.projects",
  "projection.threads",
  "projection.thread-messages",
  "projection.thread-proposed-plans",
  "projection.thread-activities",
  "projection.thread-sessions",
  "projection.thread-turns",
  "projection.checkpoints",
  "projection.pending-approvals",
] as const;

const MODEL_SELECTION = JSON.stringify({ instanceId: "codex", model: "gpt-5.4" });
const PROJECT_SCRIPTS = JSON.stringify([
  {
    id: "dev",
    name: "Dev",
    command: "pnpm dev",
    icon: "play",
    runOnWorktreeCreate: false,
  },
  {
    id: "test",
    name: "Tests",
    command: "pnpm test",
    icon: "test",
    runOnWorktreeCreate: false,
  },
]);

export const SHOWCASE_TERMINAL_BUFFER = [
  "\u001b[38;5;75m~/Code/t3code\u001b[0m \u001b[38;5;212mfeat/remote-command-center\u001b[0m",
  "$ vp test run --changed",
  "",
  "  \u001b[38;5;117mt3code-mobile\u001b[0m       184 passed",
  "  \u001b[38;5;213mclient-runtime\u001b[0m      263 passed",
  "  \u001b[38;5;221mserver\u001b[0m              165 passed",
  "",
  "\u001b[32m✨ 612 tests passed\u001b[0m  ·  3 environments online",
  "",
  "\u001b[38;5;75m~/Code/t3code\u001b[0m \u001b[38;5;212mfeat/remote-command-center\u001b[0m $ ",
].join("\r\n");

const BASE_ENVIRONMENT_PRESENCE = `export function environmentLabel(count: number): string {
  return \`${"${count}"} environments\`;
}
`;

const UPDATED_ENVIRONMENT_PRESENCE = `const PULSE = ["✦", "✧", "·", "✧"] as const;

export function environmentLabel(connected: number, total: number, frame: number): string {
  const pulse = PULSE[frame % PULSE.length];
  return \`${"${pulse} ${connected}/${total}"} ready\`;
}
`;

const REMOTE_HANDOFF_CARD = `import { View, Text } from "react-native";

export function RemoteHandoffCard(props: { machine: string; latencyMs: number }) {
  return (
    <View className="rounded-2xl bg-surface-2 p-4">
      <Text className="font-semibold">Ready on {props.machine}</Text>
      <Text className="text-success">Handoff in {props.latencyMs}ms</Text>
    </View>
  );
}
`;

const PROJECT_FAVICONS = {
  t3code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="10" fill="#000"/>
  <g transform="translate(25.4984 26.5511) scale(0.425358)">
    <path d="M107.5 4.5C114.56 8.5 117.9 15.75 121.54 22.69C122.45 24.41 123.39 26.1 124.34 27.8C127.0 32.73 129.16 37.01 129.2 42.68C127.83 46.25 124.89 48.69 121.65 50.57C119.45 51.65 117.23 52.64 114.98 53.62C114.15 53.99 113.31 54.37 112.45 54.75C109.72 55.97 106.99 57.17 104.25 58.38C101.4 59.64 98.56 60.9 95.71 62.17C93.79 63.02 91.87 63.88 89.94 64.73C83.82 67.45 77.73 70.23 71.66 73.08C70.16 73.78 68.65 74.49 67.15 75.19C65.03 76.18 62.92 77.17 60.81 78.17C47.36 84.59 47.36 84.59 40.5 83.5C38.23 82.09 36.73 80.9 35.5 78.5C34.5 74.41 34.08 71.78 35.85 67.91C36.51 66.64 37.2 65.37 37.9 64.12C38.65 62.7 39.39 61.29 40.14 59.87C40.53 59.15 40.92 58.43 41.33 57.69C42.84 54.87 44.28 52.02 45.73 49.17C47.15 46.36 48.59 43.55 50.04 40.74C50.77 39.32 51.5 37.9 52.22 36.48C66.93 7.7 66.93 7.7 78.61 2.23C88.24 -1.47 98.44 -0.04 107.5 4.5Z" fill="#fff"/>
    <path d="M135.94 59.19C136.51 59.34 137.09 59.48 137.68 59.64C143.73 62.51 145.89 68.87 148.63 74.56C149.61 76.57 150.59 78.57 151.57 80.57C152.07 81.57 152.56 82.57 153.06 83.61C155.12 87.75 157.27 91.85 159.44 95.94C159.84 96.69 160.23 97.45 160.65 98.22C162.44 101.62 164.24 105.01 166.04 108.4C167.66 111.45 169.27 114.51 170.88 117.56C171.38 118.5 171.88 119.44 172.39 120.41C177.64 130.4 181.98 138.98 180.5 150.5C178.52 158.63 174.13 164.98 167.48 170.04C160.73 174.46 154.9 175.72 146.89 175.96C136.77 174.58 127.26 168.47 118.25 163.88C115.6 162.52 112.95 161.18 110.3 159.84C109.7 159.53 109.11 159.23 108.5 158.91C102.71 155.98 97.43 154.19 90.88 154.06C89.77 154.02 88.66 153.98 87.52 153.94C76.73 154.77 65.52 162.39 56.0 167.25C53.35 168.6 50.69 169.95 48.03 171.3C47.43 171.6 46.84 171.91 46.22 172.23C39.31 175.72 33.2 176.17 25.5 175.5C17.38 173.57 11.0 169.1 5.96 162.48C0.89 154.75 -0.39 147.69 0.5 138.5C1.39 134.58 2.81 131.13 4.5 127.5C4.62 127.22 4.62 127.22 5.22 125.79C7.61 120.16 10.23 114.47 15.77 111.41C17.03 110.8 18.29 110.22 19.57 109.65C20.26 109.32 20.96 108.99 21.67 108.65C23.17 107.95 24.67 107.25 26.17 106.57C28.51 105.49 30.85 104.4 33.18 103.29C38.17 100.94 43.18 98.62 48.19 96.31C49.08 95.9 49.98 95.49 50.9 95.06C64.93 88.57 79.01 82.18 93.13 75.9C97.78 73.83 102.42 71.73 107.06 69.63C107.78 69.3 108.5 68.98 109.24 68.65C112.05 67.37 114.87 66.09 117.69 64.81C119.61 63.94 121.53 63.07 123.45 62.2C124.02 61.94 124.59 61.68 125.17 61.42C132.33 58.18 132.33 58.18 135.94 59.19Z" fill="#fff"/>
  </g>
</svg>`,
  react: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#20232a"/>
  <g fill="none" stroke="#61dafb" stroke-width="2.8"><ellipse cx="32" cy="32" rx="25" ry="9"/><ellipse cx="32" cy="32" rx="25" ry="9" transform="rotate(60 32 32)"/><ellipse cx="32" cy="32" rx="25" ry="9" transform="rotate(120 32 32)"/></g>
  <circle cx="32" cy="32" r="4.8" fill="#61dafb"/>
</svg>`,
  linux: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#f7c948"/>
  <ellipse cx="32" cy="35" rx="17" ry="22" fill="#202124"/>
  <ellipse cx="32" cy="40" rx="12" ry="14" fill="#f5f5f2"/>
  <circle cx="27" cy="24" r="5" fill="white"/><circle cx="37" cy="24" r="5" fill="white"/>
  <circle cx="28" cy="25" r="2"/><circle cx="36" cy="25" r="2"/>
  <path d="M27 31l5-4 5 4-5 4z" fill="#f28c28"/><path d="M16 55h14l-7-5zM34 55h14l-7-5z" fill="#f28c28"/>
</svg>`,
} as const;

export const SHOWCASE_PROJECTS = [
  {
    id: "t3code",
    title: "Axle",
    directory: "t3code",
    repositoryUrl: "https://github.com/pingdotgg/t3code.git",
    favicon: PROJECT_FAVICONS.t3code,
  },
  {
    id: "react",
    title: "React",
    directory: "react",
    repositoryUrl: "https://github.com/facebook/react.git",
    favicon: PROJECT_FAVICONS.react,
  },
  {
    id: "linux",
    title: "Linux",
    directory: "linux",
    repositoryUrl: "https://github.com/torvalds/linux.git",
    favicon: PROJECT_FAVICONS.linux,
  },
] as const;

export const SHOWCASE_ENVIRONMENTS = [
  {
    id: "moonbase-terminal",
    label: "Moonbase Terminal",
    projectIds: ["t3code"],
  },
  {
    id: "suspense-station",
    label: "Suspense Station",
    projectIds: ["react"],
  },
  {
    id: "kernel-cabin",
    label: "Kernel Cabin",
    projectIds: ["linux"],
  },
] as const;

export const SHOWCASE_THREADS = [
  {
    id: SHOWCASE_THREAD_ID,
    projectId: "t3code",
    title: "Make remote coding feel local ✦",
    branch: "feat/remote-command-center",
    minutesAgo: 3,
    request:
      "Give Axle a remote-first command center. Make three machines feel one tap away, keep agent work in sync, and make every handoff feel instant.",
    response:
      "Axle now treats every machine like it is right here in the room. ✦\n\n- Moonbase, Suspense Station, and Kernel Cabin stay live together\n- Terminal state follows you without losing a single line\n- Agent work remains perfectly in sync across devices\n- Handoffs land before your train of thought can wander\n\nI also ran the changed workspace: **612 tests passed**.",
  },
  {
    id: "pocket-command-center",
    projectId: "t3code",
    title: "Put the command center in your pocket",
    branch: "feat/pocket-command-center",
    minutesAgo: 21,
    state: "approval" as const,
    request: "Make switching between desktop, phone, and tablet feel like one continuous session.",
    response:
      "The handoff flow preserves the selected thread, terminal buffer, and working diff. The final motion treatment is ready for approval.",
  },
  {
    id: "buttery-suspense",
    projectId: "react",
    title: "Make Suspense transitions buttery",
    branch: "perf/buttery-suspense",
    minutesAgo: 12,
    state: "working" as const,
    request:
      "Trace the last few dropped frames in nested Suspense transitions and make them disappear.",
    response: null,
  },
  {
    id: "hydration-haikus",
    projectId: "react",
    title: "Turn hydration warnings into haikus",
    branch: "dev/hydration-haikus",
    minutesAgo: 44,
    request:
      "Keep hydration errors precise, but make the development copy unexpectedly delightful.",
    response:
      "The diagnostics still lead with the exact mismatch and component stack. A tiny optional haiku now closes the expanded explanation.",
  },
  {
    id: "beautiful-boot",
    projectId: "linux",
    title: "Make boot logs oddly beautiful",
    branch: "feat/beautiful-boot",
    minutesAgo: 34,
    state: "plan" as const,
    request:
      "Design a clearer boot timeline that remains useful over serial and never hides kernel detail.",
    response:
      "The plan groups milestones without changing the underlying log stream, preserves plain-text output, and adds zero work to the hot path.",
  },
  {
    id: "scheduler-breathe",
    projectId: "linux",
    title: "Let the scheduler breathe",
    branch: "perf/scheduler-breathe",
    minutesAgo: 76,
    request:
      "Find a calmer balancing strategy for bursty mixed workloads without hurting tail latency.",
    response:
      "The new heuristic reduces needless migrations during short bursts while preserving the existing latency guardrails.",
  },
] as const;

function minutesBefore(now: number, minutes: number): string {
  return new Date(now - minutes * 60_000).toISOString();
}

async function runGit(workspaceRoot: string, args: ReadonlyArray<string>): Promise<void> {
  await execFile("git", [...args], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Alex Rivera",
      GIT_AUTHOR_EMAIL: "alex@lumen.test",
      GIT_COMMITTER_NAME: "Alex Rivera",
      GIT_COMMITTER_EMAIL: "alex@lumen.test",
    },
  });
}

async function initializeRepository(input: {
  readonly workspaceRoot: string;
  readonly repositoryUrl: string;
  readonly commitMessage: string;
}): Promise<void> {
  await runGit(input.workspaceRoot, ["init", "-b", "main"]);
  await runGit(input.workspaceRoot, ["remote", "add", "origin", input.repositoryUrl]);
  await runGit(input.workspaceRoot, ["add", "."]);
  await runGit(input.workspaceRoot, ["commit", "-m", input.commitMessage]);
}

async function seedT3CodeWorkspace(workspaceRoot: string): Promise<void> {
  await NodeFSP.mkdir(NodePath.join(workspaceRoot, "apps/mobile/src/features/home"), {
    recursive: true,
  });
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "package.json"),
    `${JSON.stringify({ name: "t3code", private: true, scripts: { test: "vp test" } }, null, 2)}\n`,
  );
  await NodeFSP.writeFile(NodePath.join(workspaceRoot, "favicon.svg"), PROJECT_FAVICONS.t3code);
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "apps/mobile/src/features/home/environmentPresence.ts"),
    BASE_ENVIRONMENT_PRESENCE,
  );
  await initializeRepository({
    workspaceRoot,
    repositoryUrl: "https://github.com/pingdotgg/t3code.git",
    commitMessage: "Show connected environments",
  });
  await runGit(workspaceRoot, ["checkout", "-b", "feat/remote-command-center"]);
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "apps/mobile/src/features/home/environmentPresence.ts"),
    UPDATED_ENVIRONMENT_PRESENCE,
  );
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "apps/mobile/src/features/home/RemoteHandoffCard.tsx"),
    REMOTE_HANDOFF_CARD,
  );
}

async function seedCompanionWorkspace(input: {
  readonly workspaceRoot: string;
  readonly title: string;
  readonly repositoryUrl: string;
  readonly favicon: string;
}): Promise<void> {
  await NodeFSP.mkdir(input.workspaceRoot, { recursive: true });
  await NodeFSP.writeFile(NodePath.join(input.workspaceRoot, "favicon.svg"), input.favicon);
  await NodeFSP.writeFile(
    NodePath.join(input.workspaceRoot, "README.md"),
    `# ${input.title}\n\nSeeded by the Axle mobile screenshot harness.\n`,
  );
  await initializeRepository({
    workspaceRoot: input.workspaceRoot,
    repositoryUrl: input.repositoryUrl,
    commitMessage: `Seed ${input.title} workspace`,
  });
}

function insertThread(
  database: NodeSqlite.DatabaseSync,
  now: number,
  input: {
    readonly id: string;
    readonly projectId: string;
    readonly title: string;
    readonly branch: string;
    readonly minutesAgo: number;
    readonly state?: "working" | "approval" | "plan";
    readonly workspaceRoot: string;
  },
): void {
  const turnId = `${input.id}-turn`;
  const updatedAt = minutesBefore(now, input.minutesAgo);
  const isWorking = input.state === "working";
  database
    .prepare(
      `INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
        branch, worktree_path, latest_turn_id, latest_user_message_at, pending_approval_count,
        pending_user_input_count, has_actionable_proposed_plan, created_at, updated_at,
        archived_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, NULL)`,
    )
    .run(
      input.id,
      input.projectId,
      input.title,
      MODEL_SELECTION,
      "full-access",
      input.state === "plan" ? "plan" : "default",
      input.branch,
      input.workspaceRoot,
      turnId,
      minutesBefore(now, input.minutesAgo + 1),
      input.state === "approval" ? 1 : 0,
      input.state === "plan" ? 1 : 0,
      minutesBefore(now, input.minutesAgo + 120),
      updatedAt,
    );
  database
    .prepare(
      `INSERT INTO projection_turns (
        thread_id, turn_id, pending_message_id, assistant_message_id, state, requested_at,
        started_at, completed_at, checkpoint_turn_count, checkpoint_ref, checkpoint_status,
        checkpoint_files_json, source_proposed_plan_thread_id, source_proposed_plan_id
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, NULL, '[]', NULL, NULL)`,
    )
    .run(
      input.id,
      turnId,
      isWorking ? null : `${input.id}-answer`,
      isWorking ? "running" : "completed",
      minutesBefore(now, input.minutesAgo + 2),
      minutesBefore(now, input.minutesAgo + 2),
      isWorking ? null : updatedAt,
    );
  database
    .prepare(
      `INSERT INTO projection_thread_sessions (
        thread_id, status, provider_name, provider_instance_id, provider_session_id,
        provider_thread_id, runtime_mode, active_turn_id, last_error, updated_at
      ) VALUES (?, ?, 'Codex', 'codex', NULL, NULL, 'full-access', ?, NULL, ?)`,
    )
    .run(input.id, isWorking ? "running" : "ready", isWorking ? turnId : null, updatedAt);
}

function seedDatabase(
  dbPath: string,
  workspaceRoots: ReadonlyMap<string, string>,
  projects: ReadonlyArray<(typeof SHOWCASE_PROJECTS)[number]>,
  threads: ReadonlyArray<(typeof SHOWCASE_THREADS)[number]>,
  now: number,
): void {
  const database = new NodeSqlite.DatabaseSync(dbPath);
  try {
    database.exec("BEGIN IMMEDIATE");
    for (const table of [
      "projection_pending_approvals",
      "projection_thread_proposed_plans",
      "projection_thread_activities",
      "projection_thread_messages",
      "projection_thread_sessions",
      "projection_turns",
      "projection_threads",
      "projection_projects",
      "projection_state",
    ]) {
      database.exec(`DELETE FROM ${table}`);
    }
    const insertProject = database.prepare(
      `INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    for (const [index, project] of projects.entries()) {
      const workspaceRoot = workspaceRoots.get(project.id);
      if (!workspaceRoot) throw new Error(`Missing workspace root for ${project.id}.`);
      const latestThreadMinutes = Math.min(
        ...threads
          .filter((thread) => thread.projectId === project.id)
          .map((thread) => thread.minutesAgo),
      );
      insertProject.run(
        project.id,
        project.title,
        workspaceRoot,
        MODEL_SELECTION,
        PROJECT_SCRIPTS,
        minutesBefore(now, 60 * 24 * (90 - index * 12)),
        minutesBefore(now, latestThreadMinutes),
      );
    }

    for (const thread of threads) {
      const workspaceRoot = workspaceRoots.get(thread.projectId);
      if (!workspaceRoot) throw new Error(`Missing workspace root for ${thread.projectId}.`);
      insertThread(database, now, {
        ...thread,
        ...("state" in thread ? { state: thread.state } : {}),
        workspaceRoot,
      });
    }

    const insertMessage = database.prepare(
      `INSERT INTO projection_thread_messages (
        message_id, thread_id, turn_id, role, text, is_streaming, attachments_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    );
    for (const thread of threads) {
      const turnId = `${thread.id}-turn`;
      const requestTime = minutesBefore(now, thread.minutesAgo + 5);
      insertMessage.run(
        `${thread.id}-request`,
        thread.id,
        turnId,
        "user",
        thread.request,
        requestTime,
        requestTime,
      );
      if (thread.response !== null) {
        const responseTime = minutesBefore(now, thread.minutesAgo);
        insertMessage.run(
          `${thread.id}-answer`,
          thread.id,
          turnId,
          "assistant",
          thread.response,
          responseTime,
          responseTime,
        );
      }
    }

    const turnId = `${SHOWCASE_THREAD_ID}-turn`;
    const insertActivity = database.prepare(
      `INSERT INTO projection_thread_activities (
        activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
      ) VALUES (?, ?, ?, 'tool', 'tool.completed', ?, ?, ?, ?)`,
    );
    insertActivity.run(
      "trace-remote-handoff",
      SHOWCASE_THREAD_ID,
      turnId,
      "Traced the remote handoff path",
      JSON.stringify({
        itemType: "command_execution",
        title: "Traced the remote handoff path",
        detail: "Three environments, one continuous workspace",
        status: "completed",
      }),
      1,
      minutesBefore(now, 8),
    );
    insertActivity.run(
      "sync-command-center",
      SHOWCASE_THREAD_ID,
      turnId,
      "Synced the command center",
      JSON.stringify({
        itemType: "file_change",
        title: "Synced the command center",
        detail: "2 files changed · instant handoffs · calm reconnects",
        status: "completed",
      }),
      2,
      minutesBefore(now, 6),
    );
    insertActivity.run(
      "run-changed-suite",
      SHOWCASE_THREAD_ID,
      turnId,
      "Ran the changed workspace",
      JSON.stringify({
        itemType: "command_execution",
        title: "Ran the changed workspace",
        detail: "612 tests passed · 3 environments online",
        status: "completed",
      }),
      3,
      minutesBefore(now, 4),
    );

    for (const [index, projector] of PROJECTOR_NAMES.entries()) {
      database
        .prepare(
          "INSERT INTO projection_state (projector, last_applied_sequence, updated_at) VALUES (?, ?, ?)",
        )
        .run(projector, index + 1, minutesBefore(now, 1));
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}

export async function seedShowcaseEnvironment(input: {
  readonly baseDir: string;
  readonly projectIds?: ReadonlyArray<string>;
  readonly now?: number;
}): Promise<{ readonly dbPath: string; readonly workspaceRoot: string }> {
  const now = input.now ?? Date.now();
  const selectedProjectIds = new Set(
    input.projectIds ?? SHOWCASE_PROJECTS.map((project) => project.id),
  );
  const projects = SHOWCASE_PROJECTS.filter((project) => selectedProjectIds.has(project.id));
  if (projects.length === 0) throw new Error("At least one showcase project must be selected.");
  const threads = SHOWCASE_THREADS.filter((thread) => selectedProjectIds.has(thread.projectId));
  const workspaceBase = NodePath.join(input.baseDir, "workspace");
  const workspaceRoots = new Map(
    projects.map(
      (project) => [project.id, NodePath.join(workspaceBase, project.directory)] as const,
    ),
  );
  const primaryProject =
    projects.find((project) => project.id === SHOWCASE_PROJECT_ID) ?? projects[0];
  if (!primaryProject) throw new Error("The primary showcase workspace is not configured.");
  const workspaceRoot = workspaceRoots.get(primaryProject.id);
  if (!workspaceRoot) throw new Error("The primary showcase workspace is not configured.");
  const dbPath = NodePath.join(input.baseDir, "userdata", "state.sqlite");
  if (primaryProject.id === SHOWCASE_PROJECT_ID) {
    await seedT3CodeWorkspace(workspaceRoot);
  }
  await Promise.all(
    projects
      .filter((project) => project.id !== SHOWCASE_PROJECT_ID)
      .map(async (project) => {
        const projectWorkspaceRoot = workspaceRoots.get(project.id);
        if (!projectWorkspaceRoot) throw new Error(`Missing workspace root for ${project.id}.`);
        await seedCompanionWorkspace({
          workspaceRoot: projectWorkspaceRoot,
          title: project.title,
          repositoryUrl: project.repositoryUrl,
          favicon: project.favicon,
        });
      }),
  );
  seedDatabase(dbPath, workspaceRoots, projects, threads, now);

  const terminalDirectory = NodePath.join(input.baseDir, "userdata", "logs", "terminals");
  if (selectedProjectIds.has(SHOWCASE_PROJECT_ID)) {
    const safeThreadId = Buffer.from(SHOWCASE_THREAD_ID).toString("base64url");
    await NodeFSP.mkdir(terminalDirectory, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(terminalDirectory, `terminal_${safeThreadId}.log`),
      SHOWCASE_TERMINAL_BUFFER,
    );
  }
  return { dbPath, workspaceRoot };
}
