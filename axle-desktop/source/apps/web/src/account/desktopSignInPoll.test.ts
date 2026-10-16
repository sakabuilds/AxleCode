import { describe, expect, it, vi } from "vite-plus/test";

import { pollDesktopSignIn, type DesktopSignInPollOptions } from "./desktopSignInPoll";

type Session = { readonly token: string };

function makeOptions(
  overrides: Partial<DesktopSignInPollOptions<Session>> = {},
): DesktopSignInPollOptions<Session> {
  let clock = 0;
  return {
    state: "state_1234567890123456",
    claim: async () => ({ token: "session-token" }),
    delay: async (milliseconds) => {
      clock += milliseconds;
    },
    now: () => clock,
    intervalMs: 1_000,
    timeoutMs: 5_000,
    isAbandoned: () => false,
    ...overrides,
  };
}

describe("desktop sign-in poll", () => {
  it("keeps waiting while the browser sign-in is still pending", async () => {
    const claim = vi
      .fn<() => Promise<Session | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ token: "session-token" });
    const result = await pollDesktopSignIn(makeOptions({ claim }));
    expect(result).toEqual({ outcome: "signed-in", session: { token: "session-token" } });
    expect(claim).toHaveBeenCalledTimes(3);
  });

  it("claims the sign-in state on every attempt", async () => {
    const claim = vi.fn(async () => null);
    await pollDesktopSignIn(makeOptions({ claim }));
    expect(claim).toHaveBeenCalledWith("state_1234567890123456");
  });

  it("stops as soon as the sign-in lands", async () => {
    const claim = vi.fn(async () => ({ token: "session-token" }));
    const result = await pollDesktopSignIn(makeOptions({ claim }));
    expect(result).toEqual({ outcome: "signed-in", session: { token: "session-token" } });
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("gives up once the timeout passes", async () => {
    const claim = vi.fn(async () => null);
    const result = await pollDesktopSignIn(makeOptions({ claim, timeoutMs: 2_500 }));
    expect(result).toEqual({ outcome: "timed-out" });
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it("stops polling when the flow was superseded", async () => {
    const claim = vi.fn(async () => null);
    let abandoned = false;
    const result = await pollDesktopSignIn(
      makeOptions({
        claim,
        isAbandoned: () => abandoned,
        delay: async () => {
          abandoned = true;
        },
      }),
    );
    expect(result).toEqual({ outcome: "abandoned" });
    expect(claim).not.toHaveBeenCalled();
  });

  it("ignores a session that arrives after the flow was cancelled", async () => {
    let abandoned = false;
    const result = await pollDesktopSignIn(
      makeOptions({
        claim: async () => {
          abandoned = true;
          return { token: "stale-token" };
        },
        isAbandoned: () => abandoned,
      }),
    );
    expect(result).toEqual({ outcome: "abandoned" });
  });
});
