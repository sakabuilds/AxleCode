/**
 * In-memory {@link CreditsStore} used by the gateway's tests and by `wrangler
 * dev` when no D1 database is bound. Mutations for a single user are
 * serialized through a per-user promise chain so the grant/charge invariants
 * hold under concurrency, mirroring the transactional D1 store.
 */
export class MemoryCreditsStore {
  #users = new Map();
  #locks = new Map();
  #ledger = new Map();
  #references = new Set();

  #withLock(userId, operation) {
    const previous = this.#locks.get(userId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.#locks.set(
      userId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  #recordFor(userId) {
    return (
      this.#users.get(userId) ?? {
        balance: 0,
        planBalance: 0,
        paidBalance: 0,
        grantedOn: null,
        planMonth: null,
      }
    );
  }

  #total(record) {
    return record.balance + record.planBalance + record.paidBalance;
  }

  async read(userId) {
    const record = this.#users.get(userId);
    return {
      balance: record?.balance ?? 0,
      planBalance: record?.planBalance ?? 0,
      paidBalance: record?.paidBalance ?? 0,
      grantedOn: record?.grantedOn ?? null,
    };
  }

  grantDaily(userId, date, amount, at = Date.now()) {
    return this.#withLock(userId, () => {
      const record = this.#recordFor(userId);
      if (record.grantedOn === date) {
        return { granted: false, balance: this.#total(record), ...this.#spread(record) };
      }
      // Renew, not add: a new day resets the free bucket, so unused free
      // credits never roll over.
      record.balance = amount;
      record.grantedOn = date;
      this.#users.set(userId, record);
      this.record(userId, "daily_grant", amount, this.#total(record), at, { date });
      return { granted: true, balance: this.#total(record), ...this.#spread(record) };
    });
  }

  grantPlan(userId, month, amount, at = Date.now(), reference = null) {
    return this.#withLock(userId, () => {
      if (reference !== null) {
        if (this.#references.has(reference)) {
          const record = this.#recordFor(userId);
          return { applied: false, balance: this.#total(record), ...this.#spread(record) };
        }
        this.#references.add(reference);
      }
      const record = this.#recordFor(userId);
      record.planBalance = amount;
      record.planMonth = month;
      this.#users.set(userId, record);
      this.record(userId, "plan_grant", amount, this.#total(record), at, { month, reference });
      return { applied: true, balance: this.#total(record), ...this.#spread(record) };
    });
  }

  charge(userId, amount, at = Date.now(), meta = {}) {
    return this.#withLock(userId, () => {
      const record = this.#recordFor(userId);
      if (this.#total(record) < amount) {
        return { charged: false, balance: this.#total(record), ...this.#spread(record) };
      }
      // Spend order: free first, then plan, then paid credits.
      const fromFree = Math.min(record.balance, amount);
      const fromPlan = Math.min(record.planBalance, amount - fromFree);
      const fromPaid = amount - fromFree - fromPlan;
      record.balance -= fromFree;
      record.planBalance -= fromPlan;
      record.paidBalance -= fromPaid;
      this.#users.set(userId, record);
      this.record(userId, "spend", -amount, this.#total(record), at, meta);
      return { charged: true, balance: this.#total(record), ...this.#spread(record) };
    });
  }

  add(userId, amount, at = Date.now(), meta = {}, reference = null) {
    return this.#withLock(userId, () => {
      if (reference !== null) {
        if (this.#references.has(reference)) {
          const record = this.#recordFor(userId);
          return { applied: false, balance: this.#total(record), ...this.#spread(record) };
        }
        this.#references.add(reference);
      }
      const record = this.#recordFor(userId);
      record.paidBalance += amount;
      this.#users.set(userId, record);
      this.record(userId, "top_up", amount, this.#total(record), at, meta);
      return { applied: true, balance: this.#total(record), ...this.#spread(record) };
    });
  }

  #spread(record) {
    return {
      freeBalance: record.balance,
      planBalance: record.planBalance,
      paidBalance: record.paidBalance,
    };
  }

  /**
   * In-memory stores are used by tests and local `wrangler dev`, where there
   * is no durable ledger to read back. Recording keeps the usage view's shape
   * honest without pretending the history survives a restart.
   */
  record(userId, kind, amount, balanceAfter, at, meta = {}) {
    const entries = this.#ledger.get(userId) ?? [];
    entries.unshift({ kind, amount, balanceAfter, at, meta });
    this.#ledger.set(userId, entries.slice(0, 100));
  }

  async history(userId, limit = 25) {
    return (this.#ledger.get(userId) ?? []).slice(0, limit).map((entry) => ({
      kind: entry.kind,
      amount: entry.amount,
      balanceAfter: entry.balanceAfter,
      meta: entry.meta,
      createdAt: entry.at,
    }));
  }
}
