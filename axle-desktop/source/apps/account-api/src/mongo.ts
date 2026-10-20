// @effect-diagnostics nodeBuiltinImport:off
import { MongoClient, MongoServerError, type Db } from "mongodb";

const clients = new Map<string, MongoClient>();

/** One lazily-connected client per connection string; isolates are long-lived. */
export function mongoClient(uri: string): MongoClient {
  let client = clients.get(uri);
  if (!client) {
    client = new MongoClient(uri, {
      maxPoolSize: 10,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 10_000,
    });
    clients.set(uri, client);
  }
  return client;
}

export function mongoDatabase(uri: string): Db {
  return mongoClient(uri).db(databaseNameFromUri(uri));
}

export function databaseNameFromUri(uri: string): string {
  try {
    const name = new URL(uri).pathname.replace(/^\//u, "").trim();
    return name || "axle";
  } catch {
    return "axle";
  }
}

export function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}

/**
 * Idempotent bootstrap: everything the API needs is collections plus indexes.
 * Index specs must stay in sync with the queries in database.ts/cloudMongo.ts.
 */
export async function ensureMongoIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection("axle_account_devices").createIndex({ userId: 1, lastSeenAt: -1 }),
    db.collection("axle_account_sessions").createIndex({ userId: 1, lastSeenAt: -1 }),
    db
      .collection("axle_account_usage_events")
      .createIndex({ userId: 1, eventId: 1 }, { unique: true }),
    db.collection("axle_account_usage_events").createIndex({ userId: 1, occurredAt: -1 }),
    db
      .collection("axle_account_usage_daily")
      .createIndex({ userId: 1, usageDate: 1 }, { unique: true }),
    db
      .collection("axle_account_usage_models")
      .createIndex({ userId: 1, provider: 1, model: 1 }, { unique: true }),
    db.collection("axle_cloud_jobs").createIndex({ userId: 1, commandId: 1 }, { unique: true }),
    db.collection("axle_cloud_jobs").createIndex({ userId: 1, createdAt: -1 }),
    db
      .collection("axle_cloud_jobs")
      .createIndex(
        { environmentId: 1, createdAt: 1 },
        { partialFilterExpression: { state: "queued" } },
      ),
    db.collection("axle_cloud_jobs").createIndex(
      { environmentId: 1, leaseExpiresAt: 1 },
      {
        partialFilterExpression: {
          state: {
            $in: [
              "provisioning",
              "running",
              "waiting_for_approval",
              "waiting_for_input",
              "finalizing",
            ],
          },
        },
      },
    ),
    db.collection("axle_cloud_jobs").createIndex({ environmentId: 1, state: 1 }),
    db.collection("axle_cloud_jobs").createIndex({ userId: 1, scheduleId: 1, createdAt: -1 }),
    db.collection("axle_cloud_schedules").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("axle_cloud_schedules").createIndex({ active: 1, nextRunAt: 1 }),
    db.collection("axle_cloud_job_events").createIndex({ jobId: 1, sequence: 1 }, { unique: true }),
    db
      .collection("axle_cloud_job_commands")
      .createIndex({ jobId: 1, commandId: 1 }, { unique: true }),
    db
      .collection("axle_credit_ledger")
      .createIndex({ userId: 1, idempotencyKey: 1 }, { unique: true }),
    db.collection("axle_credit_ledger").createIndex({ userId: 1, entryId: -1 }),
  ]);
}
