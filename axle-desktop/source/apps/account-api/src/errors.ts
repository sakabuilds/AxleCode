/** The device identifier is already registered and cannot be claimed here. */
export class AccountDeviceConflictError extends Error {
  constructor() {
    super("This device cannot be registered. Generate a new device identifier and try again.");
    this.name = "AccountDeviceConflictError";
  }
}

/** A valid identity token does not override a revoked or differently owned session. */
export class AccountSessionAccessError extends Error {
  constructor() {
    super("The account session is no longer authorized.");
    this.name = "AccountSessionAccessError";
  }
}
