// @effect-diagnostics globalDate:off
import { MongoServerError, type ClientSession, type Db, type WithId } from "mongodb";

import type {
  CloudJob,
  CloudJobCreateInput,
  CloudJobEvent,
  CloudJobLease,
  CloudJobLimits,
  CloudJobRuntimeMode,
  CloudJobState,
  CloudSchedule,
  CloudScheduleInput,
} from "@axle/contracts";
import { CloudJobError } from "./cloudErrors.ts";
import { isDuplicateKeyError } from "./mongo.ts";
import type { CloudQuery } from "./cloudStore.ts";

const TERMINAL_STATES: ReadonlyArray<CloudJobState> = [
  "completed",
  "failed",
  "cancelled",
  "interrupted",
];
const RUNNING_STATES: ReadonlyArray<CloudJobState> = [
  "provisioning",
  "running",
  "waiting_for_approval",
  "waiting_for_input",
  "finalizing",
];
const WAITING_STATES = new Set<CloudJobState>(["waiting_for_approval", "waiting_for_input"]);

export interface CloudJobDoc {
  _id: string;
  userId: string;
  commandId: string;
  inputHash: string;
  input: CloudJobCreateInput;
  limits: CloudJobLimits;
  environmentId: string;
  state: CloudJobState;
  runtimeMode: CloudJobRuntimeMode;
  scheduleId: string | null;
  generation: number;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  cancelRequestedAt: Date | null;
  pendingRequest: unknown;
  pendingResponse: unknown;
  result: unknown;
  failureCode: string | null;
  lastSequence: number;
  createdAt: Date;
  updatedAt: Date;
  deadlineAt: Date;
  billing: { creditsPerMinute: number };
  reservedCredits: number;
  settledCredits: number | null;
  startedAt: Date | null;
}

interface CreditAccountDoc {
  _id: string;
  planId: string;
  balance: number;
  grantMonth: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CreditLedgerDoc {
  _id?: unknown;
  entryId: number;
  userId: string;
  kind: "monthly_grant" | "reservation" | "settlement" | "adjustment";
  amount: number;
  jobId: string | null;
  idempotencyKey: string;
  note: unknown;
  createdAt: Date;
}

interface CounterDoc {
  _id: string;
  value: number;
}

interface BillingSubscriptionDoc {
  _id: string;
  planId: string;
  status: string;
  provider: string;
  providerReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface BillingEventDoc {
  _id: string;
  eventType: string;
  receivedAt: Date;
}

interface CreateArgs {
  userId: string;
  jobId: string;
  input: CloudJobCreateInput;
  inputHash: string;
  limits: CloudJobLimits;
  maxActiveJobsPerUser: number;
  planId: string;
  monthlyCredits: number;
  creditsPerMinute: number;
  runtimeMode?: CloudJobRuntimeMode;
  scheduleId?: string | null;
}

export interface CloudScheduleDoc {
  _id: string;
  userId: string;
  title: string;
  prompt: string;
  environmentId: string;
  repositoryUrl: string;
  sourceRef: string;
  providerInstanceId: CloudSchedule["providerInstanceId"];
  model: string;
  frequency: CloudSchedule["frequency"];
  intervalHours: number;
  time: string;
  dayOfWeek: CloudSchedule["dayOfWeek"];
  date: string;
  timeZone: string;
  active: boolean;
  sourceRevision: string | null;
  nextRunAt: Date | null;
  lastJobId: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ScheduleSaveArgs {
  userId: string;
  schedule: CloudScheduleInput;
  maxSchedules: number | null;
  nextRunAt: Date | null;
}

interface ScheduleOwnerArgs {
  userId: string;
  scheduleId: string;
}

interface ScheduleAdvanceArgs {
  scheduleId: string;
  expectedNextRunAt: Date;
  nextRunAt: Date | null;
}

interface ScheduleResultArgs {
  scheduleId: string;
  jobId: string | null;
  sourceRevision: string | null;
  error: string | null;
}

interface ClaimArgs {
  workerId: string;
  environmentId: string;
  leaseToken: string;
  leaseSeconds: number;
  maxConcurrentJobs: number;
}

interface OwnerArgs {
  userId: string;
  jobId: string;
}

interface EventsArgs extends OwnerArgs {
  after: number;
  limit: number;
}

interface RespondArgs extends OwnerArgs {
  requestId: string;
  payload: unknown;
  commandId: string;
  inputHash: string;
}

interface LeaseArgs {
  jobId: string;
  environmentId: string;
  workerId: string;
  leaseToken: string;
  generation: number;
  leaseSeconds: number;
}

interface UpdateArgs extends LeaseArgs {
  commandId: string;
  inputHash: string;
  state?: CloudJobState;
  event?: unknown;
  pendingRequest?: { requestId: string; kind: string; payload: unknown };
  result?: unknown;
  failureCode?: string;
}

interface BillingArgs {
  userId: string;
  planId: string;
  monthlyCredits: number;
}

interface GrantArgs extends BillingArgs {
  entryId: string;
  amount: number;
  note?: unknown;
}

interface WebhookArgs {
  eventId: string;
  eventType: string;
  userId: string | null;
  planId: string | null;
  providerReference: string | null;
}

/**
 * Mongo binding for the cloud control plane. The SQL original ran every
 * command as one PostgreSQL statement; here each command is one transaction
 * (Atlas replica set), with retries that make the command idempotent under
 * duplicate-key and write-conflict races.
 */
export function createCloudQuery(db: Db): CloudQuery {
  const jobs = db.collection<CloudJobDoc>("axle_cloud_jobs");
  const schedules = db.collection<CloudScheduleDoc>("axle_cloud_schedules");
  const events = db.collection("axle_cloud_job_events");
  const commands = db.collection("axle_cloud_job_commands");
  const accounts = db.collection<CreditAccountDoc>("axle_credit_accounts");
  const ledger = db.collection<CreditLedgerDoc>("axle_credit_ledger");
  const subscriptions = db.collection<BillingSubscriptionDoc>("axle_billing_subscriptions");
  const billingEvents = db.collection<BillingEventDoc>("axle_billing_events");

  /** Serializes operations on one owner or environment, like pg_advisory_xact_lock. */
  const lock = async (session: ClientSession, key: string): Promise<void> => {
    await db
      .collection<{ _id: string; revision: number }>("axle_cloud_locks")
      .updateOne({ _id: key }, { $inc: { revision: 1 } }, { upsert: true, session });
  };

  const emitEvent = async (
    session: ClientSession,
    job: Pick<CloudJobDoc, "_id" | "limits">,
    lastSequence: number,
    kind: "state" | "runtime" | "request" | "response" | "cancellation",
    payload: unknown,
  ): Promise<number> => {
    const maxEvents = job.limits.maxEvents;
    const terminalState =
      kind === "state" && payload !== null && typeof payload === "object"
        ? (payload as { state?: CloudJobState }).state
        : undefined;
    // Terminal cleanup always gets room even at the limit; SQL reserved three
    // extra sequences for cancellation plus the final state transitions.
    const reserved =
      kind === "cancellation" ||
      (terminalState !== undefined && ["finalizing", ...TERMINAL_STATES].includes(terminalState));
    if (!(lastSequence < maxEvents || (lastSequence < maxEvents + 3 && reserved))) {
      throw new CloudJobError("event_limit_exceeded");
    }
    const nextSequence = lastSequence + 1;
    const updated = await jobs.updateOne(
      { _id: job._id, lastSequence },
      { $set: { lastSequence: nextSequence, updatedAt: new Date() } },
      { session },
    );
    if (updated.matchedCount === 0) throw new Error("Cloud job was modified concurrently.");
    await events.insertOne(
      { jobId: job._id, sequence: nextSequence, kind, payload, createdAt: new Date() },
      { session },
    );
    return nextSequence;
  };

  const creditApply = async (
    session: ClientSession,
    userId: string,
    amount: number,
    kind: CreditLedgerDoc["kind"],
    jobId: string | null,
    idempotencyKey: string,
    note: unknown,
  ): Promise<boolean> => {
    if (amount === 0) return false;
    const existing = await ledger.findOne({ userId, idempotencyKey }, { session });
    if (existing) return false;
    const updated = await accounts.findOneAndUpdate(
      { _id: userId, balance: { $gte: -amount } },
      { $inc: { balance: amount }, $set: { updatedAt: new Date() } },
      { session, returnDocument: "after" },
    );
    if (!updated) {
      const exists = await accounts.findOne({ _id: userId }, { session });
      throw new CloudJobError(exists ? "insufficient_credits" : "credit_account_missing");
    }
    const counter = await db
      .collection<CounterDoc>("axle_credit_counters")
      .findOneAndUpdate(
        { _id: "ledger-entry" },
        { $inc: { value: 1 } },
        { upsert: true, session, returnDocument: "after" },
      );
    const entryId = Number(counter?.value ?? 0);
    await ledger.insertOne(
      {
        entryId,
        userId,
        kind,
        amount,
        jobId,
        idempotencyKey,
        note: note ?? null,
        createdAt: new Date(),
      },
      { session },
    );
    return true;
  };

  const creditEnsure = async (
    session: ClientSession,
    userId: string,
    planId: string,
    monthlyCredits: number,
    month: string,
  ): Promise<WithId<CreditAccountDoc>> => {
    let account = await accounts.findOneAndUpdate(
      { _id: userId },
      {
        $set: { planId, updatedAt: new Date() },
        $setOnInsert: { balance: 0, grantMonth: null, createdAt: new Date() },
      },
      { upsert: true, session, returnDocument: "after" },
    );
    if (!account) throw new Error("Credit account upsert failed.");
    if (monthlyCredits > 0 && account.grantMonth !== month) {
      const granted = await creditApply(
        session,
        userId,
        monthlyCredits,
        "monthly_grant",
        null,
        `grant:${month}`,
        { month, amount: monthlyCredits },
      );
      if (granted) {
        account = await accounts.findOneAndUpdate(
          { _id: userId },
          { $set: { grantMonth: month, updatedAt: new Date() } },
          { session, returnDocument: "after" },
        );
      }
    }
    return account as WithId<CreditAccountDoc>;
  };

  const creditSettle = async (
    session: ClientSession,
    job: WithId<CloudJobDoc>,
    at: Date,
  ): Promise<number | null> => {
    if (job.settledCredits !== null || job.reservedCredits <= 0) return job.settledCredits;
    const rate = Number(job.billing?.creditsPerMinute ?? 0);
    let charge = 0;
    if (job.startedAt !== null && rate > 0) {
      const end = Math.min(at.getTime(), job.deadlineAt.getTime());
      const minutes = Math.ceil(Math.max(0, end - job.startedAt.getTime()) / 60_000);
      charge = Math.min(job.reservedCredits, minutes * rate);
    }
    await creditApply(
      session,
      job.userId,
      job.reservedCredits - charge,
      "settlement",
      job._id,
      `job:${job._id}:settle`,
      { reservedCredits: job.reservedCredits, chargedCredits: charge },
    );
    await jobs.updateOne({ _id: job._id }, { $set: { settledCredits: charge } }, { session });
    return charge;
  };

  const settleTerminalJob = async (session: ClientSession, jobId: string): Promise<void> => {
    const job = await jobs.findOne(
      {
        _id: jobId,
        state: { $in: TERMINAL_STATES },
        reservedCredits: { $gt: 0 },
        settledCredits: null,
      },
      { session },
    );
    if (job) await creditSettle(session, job, new Date());
  };

  /** Expires stale leases for one environment; mirrors the SQL recover loop in claim/recover. */
  const expireStaleJobs = async (
    session: ClientSession,
    environmentId: string,
    now: Date,
  ): Promise<void> => {
    const stale = await jobs
      .find(
        {
          environmentId,
          state: { $nin: TERMINAL_STATES },
          $or: [{ deadlineAt: { $lte: now } }, { leaseExpiresAt: { $lte: now } }],
        },
        { session },
      )
      .sort({ createdAt: 1, _id: 1 })
      .limit(100)
      .toArray();
    for (const job of stale) {
      const deadlineExceeded = job.deadlineAt.getTime() <= now.getTime();
      const next: CloudJobState =
        job.cancelRequestedAt !== null ? "cancelled" : deadlineExceeded ? "failed" : "interrupted";
      const reason = deadlineExceeded ? "deadline_exceeded" : "lease_expired";
      await jobs.updateOne(
        { _id: job._id },
        {
          $set: {
            state: next,
            leaseToken: null,
            leaseExpiresAt: null,
            failureCode: next === "cancelled" ? null : reason,
          },
        },
        { session },
      );
      await emitEvent(session, job, job.lastSequence, "state", { state: next, reason });
    }
  };

  const jobView = (job: WithId<CloudJobDoc>): CloudJob => ({
    jobId: job._id,
    state: job.state,
    runtimeMode: job.runtimeMode === "full-access" ? "full-access" : "approval-required",
    scheduleId: job.scheduleId ?? null,
    input: job.input,
    limits: job.limits,
    generation: job.generation,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    deadlineAt: job.deadlineAt.toISOString(),
    cancelRequestedAt: job.cancelRequestedAt?.toISOString() ?? null,
    pendingRequest: (job.pendingRequest ?? null) as CloudJob["pendingRequest"],
    result: (job.result ?? null) as CloudJob["result"],
    failureCode: job.failureCode ?? null,
    lastSequence: job.lastSequence,
  });

  const leaseView = (job: WithId<CloudJobDoc>): CloudJobLease => ({
    job: jobView(job),
    leaseToken: job.leaseToken ?? "",
    leaseExpiresAt: (job.leaseExpiresAt ?? job.deadlineAt).toISOString(),
    response: (job.pendingResponse ?? null) as CloudJobLease["response"],
  });

  const scheduleView = (schedule: CloudScheduleDoc): CloudSchedule => ({
    scheduleId: schedule._id,
    title: schedule.title,
    prompt: schedule.prompt,
    environmentId: schedule.environmentId,
    repositoryUrl: schedule.repositoryUrl,
    sourceRef: schedule.sourceRef,
    providerInstanceId: schedule.providerInstanceId,
    model: schedule.model,
    frequency: schedule.frequency,
    intervalHours: schedule.intervalHours,
    time: schedule.time,
    dayOfWeek: schedule.dayOfWeek,
    date: schedule.date,
    timeZone: schedule.timeZone,
    active: schedule.active,
    sourceRevision: schedule.sourceRevision ?? null,
    nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
    lastJobId: schedule.lastJobId ?? null,
    lastError: schedule.lastError ?? null,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  });

  return async (operation, args) => {
    if (operation === "create") {
      const a = args as unknown as CreateArgs;
      const rate = Math.max(0, Math.trunc(a.creditsPerMinute || 0));
      const reserve = rate > 0 ? Math.ceil(a.limits.maxDurationSeconds / 60) * rate : 0;
      return runTransaction(db, async (session) => {
        await lock(session, `owner:${a.userId}`);
        const now = new Date();
        if (reserve > 0) {
          // SQL only touched the credit account when a reservation was priced.
          const account = await creditEnsure(
            session,
            a.userId,
            a.planId || "operator",
            Math.max(0, Math.trunc(a.monthlyCredits || 0)),
            monthKey(now),
          );
          if (account.balance < reserve) throw new CloudJobError("insufficient_credits");
        }
        const existing = await jobs.findOne(
          { userId: a.userId, commandId: a.input.commandId },
          { session },
        );
        if (existing) {
          if (existing.inputHash !== a.inputHash) throw new CloudJobError("idempotency_conflict");
          return { job: jobView(existing), created: false };
        }
        const active = await jobs.countDocuments(
          { userId: a.userId, state: { $nin: TERMINAL_STATES } },
          { session },
        );
        if (active >= a.maxActiveJobsPerUser) throw new CloudJobError("capacity_exceeded");
        const doc: CloudJobDoc = {
          _id: a.jobId,
          userId: a.userId,
          commandId: a.input.commandId,
          inputHash: a.inputHash,
          input: a.input,
          limits: a.limits,
          environmentId: a.input.environmentId,
          state: "queued",
          runtimeMode: a.runtimeMode ?? "approval-required",
          scheduleId: a.scheduleId ?? null,
          generation: 0,
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          cancelRequestedAt: null,
          pendingRequest: null,
          pendingResponse: null,
          result: null,
          failureCode: null,
          lastSequence: 0,
          createdAt: now,
          updatedAt: now,
          deadlineAt: new Date(now.getTime() + a.limits.maxDurationSeconds * 1000),
          billing: { creditsPerMinute: rate },
          reservedCredits: reserve,
          settledCredits: null,
          startedAt: null,
        };
        await jobs.insertOne(doc, { session });
        await emitEvent(session, doc, 0, "state", { state: "queued" });
        if (reserve > 0) {
          await creditApply(
            session,
            a.userId,
            -reserve,
            "reservation",
            doc._id,
            `job:${doc._id}:reserve`,
            { creditsPerMinute: rate },
          );
        }
        const created = await jobs.findOne({ _id: doc._id }, { session });
        return { job: jobView(created!), created: true };
      });
    }

    if (operation === "claim") {
      const a = args as unknown as ClaimArgs;
      return runTransaction(db, async (session) => {
        await lock(session, `environment:${a.environmentId}`);
        const now = new Date();
        await expireStaleJobs(session, a.environmentId, now);
        const running = await jobs.countDocuments(
          { environmentId: a.environmentId, state: { $in: RUNNING_STATES } },
          { session },
        );
        if (running >= a.maxConcurrentJobs) return null;
        const claimNow = new Date();
        const leaseExpiry = new Date(claimNow.getTime() + a.leaseSeconds * 1000);
        const claimed = await jobs.findOneAndUpdate(
          {
            environmentId: a.environmentId,
            state: "queued",
            deadlineAt: { $gt: claimNow },
          },
          [
            {
              $set: {
                state: "provisioning" as CloudJobState,
                generation: { $add: ["$generation", 1] },
                leaseOwner: a.workerId,
                leaseToken: a.leaseToken,
                leaseExpiresAt: { $min: ["$deadlineAt", leaseExpiry] },
                startedAt: { $ifNull: ["$startedAt", claimNow] },
              },
            },
          ],
          { session, sort: { createdAt: 1, _id: 1 }, returnDocument: "after" },
        );
        if (!claimed) return null;
        await emitEvent(session, claimed, claimed.lastSequence, "state", {
          state: "provisioning",
          generation: claimed.generation,
        });
        const reloaded = await jobs.findOne({ _id: claimed._id }, { session });
        return leaseView(reloaded!);
      });
    }

    if (operation === "recover") {
      const a = args as unknown as { environmentId: string };
      return runTransaction(db, async (session) => {
        await lock(session, `environment:${a.environmentId}`);
        await expireStaleJobs(session, a.environmentId, new Date());
        const unsettled = await jobs
          .find(
            {
              environmentId: a.environmentId,
              state: { $in: TERMINAL_STATES },
              reservedCredits: { $gt: 0 },
              settledCredits: null,
            },
            { session },
          )
          .toArray();
        for (const job of unsettled) await creditSettle(session, job, new Date());
        return { recovered: true };
      });
    }

    if (operation === "list") {
      const a = args as unknown as { userId: string };
      const list = await jobs
        .find({ userId: a.userId })
        .sort({ createdAt: -1, _id: 1 })
        .limit(100)
        .toArray();
      return { jobs: list.map(jobView) };
    }

    if (operation === "get") {
      const a = args as unknown as OwnerArgs;
      const job = await jobs.findOne({ _id: a.jobId });
      if (!job || job.userId !== a.userId) throw new CloudJobError("not_found");
      return jobView(job);
    }

    if (operation === "list-by-schedule") {
      const a = args as unknown as { userId: string; scheduleId: string };
      const list = await jobs
        .find({ userId: a.userId, scheduleId: a.scheduleId })
        .sort({ createdAt: -1, _id: 1 })
        .limit(50)
        .toArray();
      return { jobs: list.map(jobView) };
    }

    if (operation === "schedule-list") {
      const a = args as unknown as { userId: string };
      const list = await schedules
        .find({ userId: a.userId })
        .sort({ createdAt: -1, _id: 1 })
        .limit(100)
        .toArray();
      return { schedules: list.map(scheduleView) };
    }

    if (operation === "schedule-get") {
      const a = args as unknown as ScheduleOwnerArgs;
      const schedule = await schedules.findOne({ _id: a.scheduleId });
      if (!schedule || schedule.userId !== a.userId) throw new CloudJobError("not_found");
      return scheduleView(schedule);
    }

    if (operation === "schedule-save") {
      const a = args as unknown as ScheduleSaveArgs;
      return runTransaction(db, async (session) => {
        await lock(session, `owner:${a.userId}`);
        const existing = await schedules.findOne({ _id: a.schedule.scheduleId }, { session });
        if (existing && existing.userId !== a.userId) throw new CloudJobError("not_found");
        if (!existing && a.maxSchedules !== null) {
          const count = await schedules.countDocuments({ userId: a.userId }, { session });
          if (count >= a.maxSchedules) throw new CloudJobError("schedule_limit_reached");
        }
        const now = new Date();
        const doc: CloudScheduleDoc = {
          ...a.schedule,
          _id: a.schedule.scheduleId,
          userId: a.userId,
          sourceRevision: existing?.sourceRevision ?? null,
          nextRunAt: a.nextRunAt,
          lastJobId: existing?.lastJobId ?? null,
          lastError: null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        await schedules.replaceOne({ _id: doc._id }, doc, { upsert: true, session });
        return scheduleView(doc);
      });
    }

    if (operation === "schedule-remove") {
      const a = args as unknown as ScheduleOwnerArgs;
      const result = await schedules.deleteOne({ _id: a.scheduleId, userId: a.userId });
      return { deleted: result.deletedCount === 1 };
    }

    if (operation === "schedule-due") {
      const a = args as unknown as { now: Date; limit: number };
      const list = await schedules
        .find({ active: true, nextRunAt: { $ne: null, $lte: a.now } })
        .sort({ nextRunAt: 1, _id: 1 })
        .limit(a.limit)
        .toArray();
      return {
        schedules: list.map((schedule) => ({ ...scheduleView(schedule), userId: schedule.userId })),
      };
    }

    if (operation === "schedule-advance") {
      const a = args as unknown as ScheduleAdvanceArgs;
      const result = await schedules.updateOne(
        { _id: a.scheduleId, active: true, nextRunAt: a.expectedNextRunAt },
        { $set: { nextRunAt: a.nextRunAt, updatedAt: new Date() } },
      );
      return { advanced: result.modifiedCount === 1 };
    }

    if (operation === "schedule-result") {
      const a = args as unknown as ScheduleResultArgs;
      await schedules.updateOne(
        { _id: a.scheduleId },
        {
          $set: {
            lastJobId: a.jobId,
            sourceRevision: a.sourceRevision,
            lastError: a.error,
            updatedAt: new Date(),
          },
        },
      );
      return { recorded: true };
    }

    if (operation === "events") {
      const a = args as unknown as EventsArgs;
      const job = await jobs.findOne({ _id: a.jobId });
      if (!job || job.userId !== a.userId) throw new CloudJobError("not_found");
      const rows = await events
        .find({ jobId: a.jobId, sequence: { $gt: a.after } })
        .sort({ sequence: 1 })
        .limit(a.limit)
        .toArray();
      const view: ReadonlyArray<CloudJobEvent> = rows.map((row) => ({
        sequence: Number(row.sequence),
        kind: row.kind as CloudJobEvent["kind"],
        payload: row.payload,
        createdAt: (row.createdAt as Date).toISOString(),
      }));
      return { events: view, lastSequence: job.lastSequence };
    }

    if (operation === "cancel") {
      const a = args as unknown as OwnerArgs;
      return runTransaction(db, async (session) => {
        const job = await jobs.findOne({ _id: a.jobId }, { session });
        if (!job || job.userId !== a.userId) throw new CloudJobError("not_found");
        if (!TERMINAL_STATES.includes(job.state) && job.cancelRequestedAt === null) {
          const now = new Date();
          await jobs.updateOne(
            { _id: job._id },
            {
              $set: {
                cancelRequestedAt: now,
                ...(job.state === "queued" ? { state: "cancelled" as CloudJobState } : {}),
              },
            },
            { session },
          );
          let sequence = await emitEvent(session, job, job.lastSequence, "cancellation", {
            requested: true,
          });
          if (job.state === "queued") {
            sequence = await emitEvent(session, job, sequence, "state", { state: "cancelled" });
          }
        }
        await settleTerminalJob(session, job._id);
        const reloaded = await jobs.findOne({ _id: job._id }, { session });
        return jobView(reloaded!);
      });
    }

    if (operation === "respond") {
      const a = args as unknown as RespondArgs;
      return runTransaction(db, async (session) => {
        const job = await jobs.findOne({ _id: a.jobId }, { session });
        if (!job || job.userId !== a.userId) throw new CloudJobError("not_found");
        const replay = await commands.findOne(
          { jobId: a.jobId, commandId: a.commandId },
          { session },
        );
        if (replay) {
          if (replay.inputHash !== a.inputHash) throw new CloudJobError("idempotency_conflict");
          return jobView(job);
        }
        const now = new Date();
        const pending = (job.pendingRequest ?? null) as { requestId?: unknown } | null;
        if (
          job.cancelRequestedAt !== null ||
          job.deadlineAt.getTime() <= now.getTime() ||
          job.leaseExpiresAt === null ||
          job.leaseExpiresAt.getTime() <= now.getTime() ||
          !WAITING_STATES.has(job.state) ||
          pending === null ||
          pending.requestId !== a.requestId ||
          job.pendingResponse !== null
        ) {
          throw new CloudJobError("request_not_pending");
        }
        await jobs.updateOne(
          { _id: job._id },
          { $set: { pendingResponse: { requestId: a.requestId, payload: a.payload } } },
          { session },
        );
        await emitEvent(session, job, job.lastSequence, "response", { requestId: a.requestId });
        await commands.insertOne(
          { jobId: a.jobId, commandId: a.commandId, inputHash: a.inputHash },
          { session },
        );
        const reloaded = await jobs.findOne({ _id: job._id }, { session });
        return jobView(reloaded!);
      });
    }

    if (operation === "heartbeat") {
      const a = args as unknown as LeaseArgs;
      const job = await jobs.findOne({ _id: a.jobId });
      if (!job) throw new CloudJobError("not_found");
      assertLease(job, a);
      const now = new Date();
      if (
        job.leaseExpiresAt === null ||
        job.leaseExpiresAt.getTime() <= now.getTime() ||
        job.deadlineAt.getTime() <= now.getTime()
      ) {
        throw new CloudJobError("lease_lost");
      }
      // The guarded update keeps a concurrent expiry from being resurrected.
      const updated = await jobs.findOneAndUpdate(
        {
          _id: job._id,
          environmentId: a.environmentId,
          leaseOwner: a.workerId,
          leaseToken: a.leaseToken,
          generation: a.generation,
          leaseExpiresAt: { $gt: now },
          deadlineAt: { $gt: now },
        },
        {
          $set: {
            leaseExpiresAt: new Date(
              Math.min(job.deadlineAt.getTime(), now.getTime() + a.leaseSeconds * 1000),
            ),
          },
        },
        { returnDocument: "after" },
      );
      if (!updated) throw new CloudJobError("lease_lost");
      return leaseView(updated);
    }

    if (operation === "update") {
      const a = args as unknown as UpdateArgs;
      return runTransaction(db, async (session) => {
        const job = await jobs.findOne({ _id: a.jobId }, { session });
        if (!job) throw new CloudJobError("not_found");
        assertLease(job, a);
        const replay = await commands.findOne(
          { jobId: a.jobId, commandId: a.commandId },
          { session },
        );
        if (replay) {
          if (replay.inputHash !== a.inputHash) throw new CloudJobError("idempotency_conflict");
          return jobView(job);
        }
        const now = new Date();
        if (
          job.leaseExpiresAt === null ||
          job.leaseExpiresAt.getTime() <= now.getTime() ||
          job.deadlineAt.getTime() <= now.getTime()
        ) {
          throw new CloudJobError("lease_lost");
        }

        const hasEvent = a.event !== undefined;
        const hasPendingRequest = a.pendingRequest !== undefined;
        const hasResult = a.result !== undefined;
        const hasFailure = a.failureCode !== undefined;
        const previous = job.state;
        const next: CloudJobState = a.state ?? job.state;

        if (
          (next === job.state && !hasEvent) ||
          (next === job.state && WAITING_STATES.has(job.state))
        ) {
          throw new CloudJobError("invalid_transition");
        }
        if (
          TERMINAL_STATES.includes(job.state) ||
          (job.cancelRequestedAt !== null && next !== "cancelled")
        ) {
          throw new CloudJobError("invalid_transition");
        }
        if (next !== job.state && !allowedTransition(job.state, next)) {
          throw new CloudJobError("invalid_transition");
        }
        if (next === "running" && WAITING_STATES.has(job.state) && job.pendingResponse === null) {
          throw new CloudJobError("request_not_answered");
        }
        if (WAITING_STATES.has(next) && next !== job.state) {
          // Reserve one response and one resume event before exposing an approval.
          const reservedNeeded = job.lastSequence + 4 + (hasEvent ? 1 : 0);
          if (reservedNeeded > job.limits.maxEvents) {
            throw new CloudJobError("event_limit_exceeded");
          }
          const expectedKind = next === "waiting_for_approval" ? "approval" : "input";
          if (a.pendingRequest === undefined || a.pendingRequest.kind !== expectedKind) {
            throw new CloudJobError("invalid_request");
          }
        } else if (hasPendingRequest) {
          throw new CloudJobError("invalid_request");
        }
        if (
          next === "completed" &&
          (a.result === undefined ||
            (a.result as { sourceRevision?: unknown }).sourceRevision !== job.input.sourceRevision)
        ) {
          throw new CloudJobError("invalid_result");
        }
        if (hasResult && next !== "completed") throw new CloudJobError("invalid_result");
        if (next === "failed" && !hasFailure) throw new CloudJobError("invalid_failure");
        if (hasFailure && next !== "failed") throw new CloudJobError("invalid_failure");

        const changes: Record<string, unknown> = {
          state: next,
          failureCode: a.failureCode ?? null,
        };
        if (hasPendingRequest) changes.pendingRequest = a.pendingRequest;
        else if (next !== job.state) changes.pendingRequest = null;
        if (next !== job.state) changes.pendingResponse = null;
        if (hasResult) changes.result = a.result;
        if (TERMINAL_STATES.includes(next)) changes.leaseExpiresAt = null;
        await jobs.updateOne({ _id: job._id }, { $set: changes }, { session });

        let sequence = job.lastSequence;
        if (next !== previous) {
          sequence = await emitEvent(session, job, sequence, "state", { state: next });
        }
        if (hasEvent) sequence = await emitEvent(session, job, sequence, "runtime", a.event);
        if (hasPendingRequest) {
          await emitEvent(session, job, sequence, "request", a.pendingRequest);
        }
        await commands.insertOne(
          { jobId: a.jobId, commandId: a.commandId, inputHash: a.inputHash },
          { session },
        );
        await settleTerminalJob(session, job._id);
        const reloaded = await jobs.findOne({ _id: job._id }, { session });
        return jobView(reloaded!);
      });
    }

    if (operation === "subscription-get") {
      const a = args as unknown as { userId: string };
      const subscription = await subscriptions.findOne({ _id: a.userId });
      if (!subscription) return null;
      return {
        planId: subscription.planId,
        status: subscription.status,
        updatedAt: (subscription.updatedAt as Date).toISOString(),
      };
    }

    if (operation === "webhook-apply") {
      const a = args as unknown as WebhookArgs;
      return runTransaction(db, async (session) => {
        const inserted = await billingEvents.updateOne(
          { _id: a.eventId },
          { $setOnInsert: { eventType: a.eventType, receivedAt: new Date() } },
          { upsert: true, session },
        );
        if ((inserted.upsertedCount ?? 0) === 0) return { applied: false, granted: false };
        if (a.eventType === "collection.succeeded" && a.userId !== null && a.planId !== null) {
          const now = new Date();
          await subscriptions.updateOne(
            { _id: a.userId },
            {
              $set: {
                planId: a.planId,
                status: "active",
                provider: "bachs",
                providerReference: a.providerReference,
                updatedAt: now,
              },
              $setOnInsert: { createdAt: now },
            },
            { upsert: true, session },
          );
          return { applied: true, granted: true };
        }
        return { applied: true, granted: false };
      });
    }

    if (operation === "billing") {
      const a = args as unknown as BillingArgs;
      return runTransaction(db, async (session) => {
        const account = await creditEnsure(
          session,
          a.userId,
          a.planId || "operator",
          Math.max(0, Math.trunc(a.monthlyCredits || 0)),
          monthKey(new Date()),
        );
        const rows = await ledger
          .find({ userId: a.userId }, { session })
          .sort({ entryId: -1 })
          .limit(50)
          .toArray();
        return {
          account: {
            planId: account.planId,
            balance: account.balance,
            updatedAt: account.updatedAt.toISOString(),
          },
          entries: rows.map((entry) => ({
            entryId: entry.entryId,
            kind: entry.kind,
            amount: entry.amount,
            jobId: entry.jobId ?? null,
            note: entry.note ?? null,
            createdAt: entry.createdAt.toISOString(),
          })),
        };
      });
    }

    if (operation === "grant") {
      const a = args as unknown as GrantArgs;
      if (!Number.isSafeInteger(a.amount) || a.amount <= 0) {
        throw new CloudJobError("invalid_amount");
      }
      return runTransaction(db, async (session) => {
        await creditEnsure(
          session,
          a.userId,
          a.planId || "operator",
          Math.max(0, Math.trunc(a.monthlyCredits || 0)),
          monthKey(new Date()),
        );
        await creditApply(
          session,
          a.userId,
          a.amount,
          "adjustment",
          null,
          `grant:${a.entryId}`,
          a.note ?? {},
        );
        const account = await accounts.findOne({ _id: a.userId }, { session });
        return { planId: account!.planId, balance: account!.balance };
      });
    }

    throw new CloudJobError("invalid_operation");
  };
}

function assertLease(job: WithId<CloudJobDoc>, a: LeaseArgs): void {
  if (
    job.environmentId !== a.environmentId ||
    job.leaseOwner !== a.workerId ||
    job.leaseToken === null ||
    job.leaseToken !== a.leaseToken ||
    job.generation !== a.generation
  ) {
    throw new CloudJobError("lease_lost");
  }
}

function allowedTransition(previous: CloudJobState, next: CloudJobState): boolean {
  if (previous === "provisioning") return ["running", "failed", "cancelled"].includes(next);
  if (previous === "running") {
    return [
      "waiting_for_approval",
      "waiting_for_input",
      "finalizing",
      "failed",
      "cancelled",
    ].includes(next);
  }
  if (WAITING_STATES.has(previous)) return ["running", "failed", "cancelled"].includes(next);
  if (previous === "finalizing") return ["completed", "failed", "cancelled"].includes(next);
  return false;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * One transaction per command. Duplicate-key errors surface when two attempts
 * race to create the same lock/account/job/event row; every command in this
 * module is safe to re-run, so retrying resolves the race to its idempotent
 * outcome. Transient write conflicts retry inside `withTransaction`.
 */
async function runTransaction<T>(db: Db, work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = db.client.startSession();
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        return await session.withTransaction(async () => await work(session));
      } catch (error) {
        const retriable =
          isDuplicateKeyError(error) ||
          (error instanceof MongoServerError && error.hasErrorLabel("TransientTransactionError"));
        if (!retriable || attempt >= 4) throw error;
      }
    }
  } finally {
    await session.endSession();
  }
}
