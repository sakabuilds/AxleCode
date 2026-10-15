/**
 * D1-backed {@link CreditsStore}. Every mutation is a single statement that
 * encodes the invariant in its `WHERE`/`ON CONFLICT` clause, so a charge can
 * never overdraw and the daily grant is applied at most once per UTC day even
 * when requests race.
 */
export class D1CreditsStore {
  #db;

  constructor(db) {
    if (!db || typeof db.prepare !== "function") {
      throw new Error("D1CreditsStore requires a D1 database binding");
    }
    this.#db = db;
  }

  async read(userId) {
    const row = await this.#db
      .prepare("SELECT balance, granted_on FROM axle_credits WHERE user_id = ?1")
      .bind(userId)
      .first();
    return { balance: Number(row?.balance ?? 0), grantedOn: row?.granted_on ?? null };
  }

  async grantDaily(userId, date, amount, at) {
    const result = await this.#db
      .prepare(
        `INSERT INTO axle_credits (user_id, balance, granted_on, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(user_id) DO UPDATE SET
           balance = axle_credits.balance + excluded.balance,
           granted_on = excluded.granted_on,
           updated_at = excluded.updated_at
         WHERE axle_credits.granted_on IS NOT excluded.granted_on`,
      )
      .bind(userId, amount, date, at)
      .run();
    const granted = changedRows(result) > 0;
    const { balance } = await this.read(userId);
    if (granted) await this.#record(userId, "daily_grant", amount, balance, at, { date });
    return { granted, balance };
  }

  async charge(userId, amount, at, meta = {}) {
    const result = await this.#db
      .prepare(
        `UPDATE axle_credits
         SET balance = balance - ?2, updated_at = ?3
         WHERE user_id = ?1 AND balance >= ?2`,
      )
      .bind(userId, amount, at)
      .run();
    const charged = changedRows(result) > 0;
    const { balance } = await this.read(userId);
    if (charged) await this.#record(userId, "spend", -amount, balance, at, meta);
    return { charged, balance };
  }

  async add(userId, amount, at, meta = {}) {
    await this.#db
      .prepare(
        `INSERT INTO axle_credits (user_id, balance, granted_on, updated_at)
         VALUES (?1, ?2, NULL, ?3)
         ON CONFLICT(user_id) DO UPDATE SET
           balance = axle_credits.balance + excluded.balance,
           updated_at = excluded.updated_at`,
      )
      .bind(userId, amount, at)
      .run();
    const { balance } = await this.read(userId);
    await this.#record(userId, "top_up", amount, balance, at, meta);
    return { balance };
  }

  #record(userId, kind, amount, balanceAfter, at, meta) {
    return this.#db
      .prepare(
        `INSERT INTO axle_credit_ledger
           (user_id, kind, amount, balance_after, meta, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(userId, kind, amount, balanceAfter, JSON.stringify(meta ?? {}), at)
      .run();
  }
}

function changedRows(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}
