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

  async read(userId) {
    const record = this.#users.get(userId);
    return { balance: record?.balance ?? 0, grantedOn: record?.grantedOn ?? null };
  }

  grantDaily(userId, date, amount, at = Date.now()) {
    return this.#withLock(userId, () => {
      const record = this.#users.get(userId) ?? { balance: 0, grantedOn: null };
      if (record.grantedOn === date) {
        return { granted: false, balance: record.balance };
      }
      record.balance += amount;
      record.grantedOn = date;
      this.#users.set(userId, record);
      this.record(userId, "daily_grant", amount, record.balance, at, { date });
      return { granted: true, balance: record.balance };
    });
  }

  charge(userId, amount, at = Date.now(), meta = {}) {
    return this.#withLock(userId, () => {
      const record = this.#users.get(userId) ?? { balance: 0, grantedOn: null };
      if (record.balance < amount) {
        return { charged: false, balance: record.balance };
      }
      record.balance -= amount;
      this.#users.set(userId, record);
      this.record(userId, "spend", -amount, record.balance, at, meta);
      return { charged: true, balance: record.balance };
    });
  }

  add(userId, amount, at = Date.now(), meta = {}) {
    return this.#withLock(userId, () => {
      const record = this.#users.get(userId) ?? { balance: 0, grantedOn: null };
      record.balance += amount;
      this.#users.set(userId, record);
      this.record(userId, "top_up", amount, record.balance, at, meta);
      return { balance: record.balance };
    });
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
