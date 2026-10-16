import { DAILY_FREE_CREDITS } from "./pricing.js";

/**
 * Credits ledger for the hosted provider.
 *
 * The ledger owns two invariants the gateway relies on:
 *  1. Every user receives exactly one daily grant per UTC calendar day,
 *     no matter how many concurrent requests arrive.
 *  2. A balance never goes negative: a charge either fully succeeds or is
 *     rejected with the current balance intact.
 *
 * Both invariants live in the {@link CreditsStore} implementation so they can
 * be enforced with a real transaction (D1) or a simple lock (memory).
 */

/** UTC `YYYY-MM-DD` for a timestamp; the boundary the daily grant rotates on. */
export function utcDate(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * A store must implement:
 *  - `read(userId)` -> `{ balance, grantedOn }`
 *  - `grantDaily(userId, date, amount, at)` -> `{ granted, balance }`
 *  - `charge(userId, amount, at, meta)` -> `{ charged, balance }`
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

  /** Grant today's free credits once, then return the resulting balance. */
  async ensureDailyGrant(userId) {
    const at = this.#now();
    const result = await this.#store.grantDaily(
      userId,
      utcDate(at),
      this.#dailyCredits,
      at,
    );
    return { ...result, balance: round(result.balance) };
  }

  /** Current balance in credits, or 0 for a user who has never been seen. */
  async balance(userId) {
    const record = await this.#store.read(userId);
    return round(record?.balance ?? 0);
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
   * Attempt to charge `amount` credits. Returns `{ charged: false, balance }`
   * when the balance is too low; the caller turns that into a 402.
   */
  async charge(userId, amount, meta = {}) {
    const at = this.#now();
    const requested = round(Math.max(0, Number(amount) || 0));
    const result = await this.#store.charge(userId, requested, at, meta);
    return { ...result, balance: round(result.balance), requested };
  }

  /** Top up a balance after a successful purchase. */
  async credit(userId, amount, meta = {}) {
    const at = this.#now();
    const result = await this.#store.add(userId, round(amount), at, meta);
    return { ...result, balance: round(result.balance) };
  }
}

/** Credits are stored to six decimals; keep every surface consistent. */
export function round(value) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6;
}
