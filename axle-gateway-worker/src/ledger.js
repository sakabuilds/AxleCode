import { DAILY_FREE_CREDITS } from "./pricing.js";

/**
 * Credits ledger for the hosted provider.
 *
 * A balance is split into three buckets, spent in this order:
 *
 *  1. `free` — the daily grant. It RENEWS: on a new UTC day the bucket is set
 *     back to {@link DAILY_FREE_CREDITS}, so unused free credits never
 *     accumulate.
 *  2. `plan` — the monthly allowance an active paid plan grants (set, not
 *     added, whenever the plan grants or changes it).
 *  3. `paid` — credits the user bought. They persist until spent.
 *
 * The ledger owns these invariants the gateway relies on:
 *  1. Every user receives exactly one daily grant per UTC calendar day, no
 *     matter how many concurrent requests arrive, and it replaces rather
 *     than adds to the free bucket.
 *  2. A total balance never goes negative: a charge either fully succeeds or
 *     is rejected with the current balances intact.
 *  3. Purchases and plan grants apply at most once per provider reference,
 *     so a redelivered webhook event can never double-credit an account.
 *
 * The invariants live in the {@link CreditsStore} implementation so they can
 * be enforced with a real transaction (D1) or a simple lock (memory).
 */

/** UTC `YYYY-MM-DD` for a timestamp; the boundary the daily grant rotates on. */
export function utcDate(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/** UTC `YYYY-MM` for a timestamp; the label recorded with plan grants. */
export function utcMonth(now) {
  return new Date(now).toISOString().slice(0, 7);
}

/**
 * A store must implement:
 *  - `read(userId)` -> `{ balance, planBalance, paidBalance, grantedOn }`
 *  - `grantDaily(userId, date, amount, at)` -> `{ granted, ...balances }`
 *  - `grantPlan(userId, month, amount, at, reference)` -> `{ applied, ...balances }`
 *  - `charge(userId, amount, at, meta)` -> `{ charged, ...balances }`
 *  - `add(userId, amount, at, meta, reference)` -> `{ applied, ...balances }`
 */
export class CreditsLedger {
  #store;
  #dailyCredits;
  #now;

  constructor(store, options = {}) {
    if (!store) throw new Error("CreditsLedger requires a store");
    this.#store = store;
    this.#dailyCredits = options.dailyCredits ?? DAILY_FREE_CREDITS;
    this.#now = options.now ?? (() => Date.now());
  }

  /** Renew today's free credits once, then return the resulting balances. */
  async ensureDailyGrant(userId) {
    const at = this.#now();
    const result = await this.#store.grantDaily(userId, utcDate(at), this.#dailyCredits, at);
    return { ...result, balance: round(result.balance) };
  }

  /**
   * Current total balance in credits, or 0 for a user who has never been
   * seen. The spendable number every surface shows.
   */
  async balance(userId) {
    const record = await this.#store.read(userId);
    return round(
      (record?.balance ?? 0) + (record?.planBalance ?? 0) + (record?.paidBalance ?? 0),
    );
  }

  /** The three buckets separately, for the account and billing pages. */
  async buckets(userId) {
    const record = await this.#store.read(userId);
    return {
      free: round(record?.balance ?? 0),
      plan: round(record?.planBalance ?? 0),
      paid: round(record?.paidBalance ?? 0),
    };
  }

  /**
   * Recent ledger entries for the account's usage view. Stores without a
   * durable history return an empty list rather than failing the page.
   */
  async history(userId, limit = 25) {
    if (typeof this.#store.history !== "function") return [];
    const bounded = Math.min(Math.max(Math.trunc(Number(limit) || 25), 1), 100);
    return this.#store.history(userId, bounded);
  }

  /**
   * Attempt to charge `amount` credits, spending the free bucket first, then
   * the plan bucket, then paid credits. Returns `{ charged: false, balance }`
   * when the total is too low; the caller turns that into a 402.
   */
  async charge(userId, amount, meta = {}) {
    const at = this.#now();
    const requested = round(Math.max(0, Number(amount) || 0));
    const result = await this.#store.charge(userId, requested, at, meta);
    return { ...result, balance: round(result.balance), requested };
  }

  /**
   * Apply a purchased-credit top-up after a successful payment. Adds to the
   * paid bucket; `reference` (the payment event id) makes retries no-ops.
   */
  async credit(userId, amount, meta = {}, reference = null) {
    const at = this.#now();
    const result = await this.#store.add(userId, round(amount), at, meta, reference);
    return { ...result, balance: round(result.balance) };
  }

  /**
   * Set the plan bucket to the plan's monthly allowance. Setting (not
   * adding) means a re-delivered or early grant never accumulates: the
   * bucket always equals what the active plan provides. `reference` (the
   * payment event id) makes retries no-ops.
   */
  async planCredit(userId, amount, reference = null) {
    const at = this.#now();
    const result = await this.#store.grantPlan(userId, utcMonth(at), round(amount), at, reference);
    return { ...result, balance: round(result.balance) };
  }
}

/** Credits are stored to six decimals; keep every surface consistent. */
export function round(value) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6;
}
