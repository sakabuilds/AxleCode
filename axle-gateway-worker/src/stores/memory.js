/**
 * In-memory {@link CreditsStore} used by the gateway's tests and by `wrangler
 * dev` when no D1 database is bound. Mutations for a single user are
 * serialized through a per-user promise chain so the grant/charge invariants
 * hold under concurrency, mirroring the transactional D1 store.
 */
export class MemoryCreditsStore {
  #users = new Map();
  #locks = new Map();

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

  grantDaily(userId, date, amount) {
    return this.#withLock(userId, () => {
      const record = this.#users.get(userId) ?? { balance: 0, grantedOn: null };
      if (record.grantedOn === date) {
        return { granted: false, balance: record.balance };
      }
      record.balance += amount;
      record.grantedOn = date;
      this.#users.set(userId, record);
      return { granted: true, balance: record.balance };
    });
  }

  charge(userId, amount) {
    return this.#withLock(userId, () => {
      const record = this.#users.get(userId) ?? { balance: 0, grantedOn: null };
      if (record.balance < amount) {
        return { charged: false, balance: record.balance };
      }
      record.balance -= amount;
      this.#users.set(userId, record);
      return { charged: true, balance: record.balance };
    });
  }

  add(userId, amount) {
    return this.#withLock(userId, () => {
      const record = this.#users.get(userId) ?? { balance: 0, grantedOn: null };
      record.balance += amount;
      this.#users.set(userId, record);
      return { balance: record.balance };
    });
  }
}
