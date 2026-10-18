/** Domain errors shared by the cloud control-plane store and its Mongo binding. */
export class CloudJobError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "CloudJobError";
    this.code = code;
  }
}
