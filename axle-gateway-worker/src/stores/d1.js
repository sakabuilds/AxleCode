/**
 * D1-backed {@link CreditsStore}. Every mutation is a single statement that
 * encodes the invariant in its `WHERE`/`ON CONFLICT` clause, so a charge can
 * never overdraw and each grant lands at most once even when requests race.
 *
 * `balance` is the free bucket (renewed, not added, each UTC day),
 * `plan_balance` the plan allowance, and `paid_balance` purchased credits.
 * A charge spends free first, then plan, then paid — all references on the
 * right side of a `SET` see the pre-update row, so the split is exact.
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
      .prepare(
        "SELECT balance, plan_balance, paid_balance, granted_on FROM axle_credits WHERE user_id = ?1",
      )
      .bind(userId)
      .first();
    return {
      balance: Number(row?.balance ?? 0),
      planBalance: Number(row?.plan_balance ?? 0),
      paidBalance: Number(row?.paid_balance ?? 0),
      grantedOn: row?.granted_on ?? null,
    };
  }

  async grantDaily(userId, date, amount, at) {
    const result = await this.#db
      .prepare(
        `INSERT INTO axle_credits (user_id, balance, granted_on, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(user_id) DO UPDATE SET
           balance = excluded.balance,
           granted_on = excluded.granted_on,
           updated_at = excluded.updated_at
         WHERE axle_credits.granted_on IS NOT excluded.granted_on`,
      )
      .bind(userId, amount, date, at)
      .run();
    const granted = changedRows(result) > 0;
    const balances = await this.read(userId);
    if (granted) await this.#record(userId, "daily_grant", amount, total(balances), at, { date });
    return { granted, balance: total(balances), ...spread(balances) };
  }

  async grantPlan(userId, month, amount, at, reference = null) {
    if (reference !== null && (await this.#seen(reference))) {
      const balances = await this.read(userId);
      return { applied: false, balance: total(balances), ...spread(balances) };
    }
    await this.#db
      .prepare(
        `INSERT INTO axle_credits (user_id, balance, plan_balance, plan_month, updated_at)
         VALUES (?1, 0, ?2, ?3, ?4)
         ON CONFLICT(user_id) DO UPDATE SET
           plan_balance = excluded.plan_balance,
           plan_month = excluded.plan_month,
           updated_at = excluded.updated_at`,
      )
      .bind(userId, amount, month, at)
      .run();
    const balances = await this.read(userId);
    await this.#record(
      userId,
      "plan_grant",
      amount,
      total(balances),
      at,
      { month, reference },
      reference,
    );
    return { applied: true, balance: total(balances), ...spread(balances) };
  }

  async charge(userId, amount, at, meta = {}) {
    const result = await this.#db
      .prepare(
        `UPDATE axle_credits
         SET balance = balance - MIN(balance, ?2),
             plan_balance = plan_balance - MIN(plan_balance, MAX(0, ?2 - balance)),
             paid_balance = paid_balance - MAX(0, ?2 - balance - plan_balance),
             updated_at = ?3
         WHERE user_id = ?1 AND (balance + plan_balance + paid_balance) >= ?2`,
      )
      .bind(userId, amount, at)
      .run();
    const charged = changedRows(result) > 0;
    const balances = await this.read(userId);
    if (charged) await this.#record(userId, "spend", -amount, total(balances), at, meta);
    return { charged, balance: total(balances), ...spread(balances) };
  }

  async add(userId, amount, at, meta = {}, reference = null) {
    if (reference !== null && (await this.#seen(reference))) {
      const balances = await this.read(userId);
      return { applied: false, balance: total(balances), ...spread(balances) };
    }
    await this.#db
      .prepare(
        `INSERT INTO axle_credits (user_id, balance, paid_balance, updated_at)
         VALUES (?1, 0, ?2, ?3)
         ON CONFLICT(user_id) DO UPDATE SET
           paid_balance = axle_credits.paid_balance + excluded.paid_balance,
           updated_at = excluded.updated_at`,
      )
      .bind(userId, amount, at)
      .run();
    const balances = await this.read(userId);
    await this.#record(userId, "top_up", amount, total(balances), at, meta, reference);
    return { applied: true, balance: total(balances), ...spread(balances) };
  }

  #seen(reference) {
    return this.#db
      .prepare("SELECT 1 AS seen FROM axle_credit_ledger WHERE reference = ?1")
      .bind(reference)
      .first()
      .then((row) => row?.seen === 1);
  }

  #record(userId, kind, amount, balanceAfter, at, meta = {}, reference = null) {
    return this.#db
      .prepare(
        `INSERT INTO axle_credit_ledger
           (user_id, kind, amount, balance_after, meta, created_at, reference)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(userId, kind, amount, balanceAfter, JSON.stringify(meta ?? {}), at, reference)
      .run();
  }

  /** Most recent ledger entries, newest first, for the account's usage view. */
  async history(userId, limit = 25) {
    const result = await this.#db
      .prepare(
        `SELECT kind, amount, balance_after, meta, created_at
           FROM axle_credit_ledger
          WHERE user_id = ?1
          ORDER BY created_at DESC, id DESC
          LIMIT ?2`,
      )
      .bind(userId, limit)
      .all();
    return (result.results ?? []).map((row) => ({
      kind: row.kind,
      amount: Number(row.amount ?? 0),
      balanceAfter: Number(row.balance_after ?? 0),
      meta: parseMeta(row.meta),
      createdAt: Number(row.created_at ?? 0),
    }));
  }
}

function parseMeta(value) {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function changedRows(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function total(balances) {
  return balances.balance + balances.planBalance + balances.paidBalance;
}

function spread(balances) {
  return {
    freeBalance: balances.balance,
    planBalance: balances.planBalance,
    paidBalance: balances.paidBalance,
  };
}
