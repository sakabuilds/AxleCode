/**
 * Waits for the session a browser sign-in started for one `state`. The custom
 * scheme deep link is the fast path, but it is not always available (dev builds
 * and fresh Linux installs have no scheme handler), so the app also polls the
 * worker for the same one-time code.
 */
export type DesktopSignInPollOptions<Session> = {
  readonly state: string;
  readonly claim: (state: string) => Promise<Session | null>;
  readonly delay: (milliseconds: number) => Promise<void>;
  readonly now: () => number;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  /** True once the flow was cancelled, superseded, or finished another way. */
  readonly isAbandoned: () => boolean;
};

export type DesktopSignInPollOutcome<Session> =
  | { readonly outcome: "signed-in"; readonly session: Session }
  | { readonly outcome: "abandoned" }
  | { readonly outcome: "timed-out" };

export async function pollDesktopSignIn<Session>(
  options: DesktopSignInPollOptions<Session>,
): Promise<DesktopSignInPollOutcome<Session>> {
  const deadline = options.now() + options.timeoutMs;
  for (;;) {
    await options.delay(options.intervalMs);
    if (options.isAbandoned()) return { outcome: "abandoned" };
    if (options.now() >= deadline) return { outcome: "timed-out" };
    const session = await options.claim(options.state);
    if (session !== null) {
      if (options.isAbandoned()) return { outcome: "abandoned" };
      return { outcome: "signed-in", session };
    }
  }
}
