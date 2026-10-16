import { describe, expect, it } from "vite-plus/test";

import { describeSessionMethod, epochToIso, formatTimestamp, providerLabel } from "./accountFormat";

describe("provider labels", () => {
  it("names the providers Axle ships", () => {
    expect(providerLabel("github")).toBe("GitHub");
    expect(providerLabel("google")).toBe("Google");
  });

  it("title-cases an unlabelled provider instead of showing its raw id", () => {
    expect(providerLabel("mistral")).toBe("Mistral");
    expect(providerLabel("agentrouter")).toBe("Agentrouter");
  });
});

describe("timestamp formatting", () => {
  it("reports Unknown for a missing or unparseable value", () => {
    expect(formatTimestamp(null)).toBe("Unknown");
    expect(formatTimestamp("")).toBe("Unknown");
    expect(formatTimestamp("not a date")).toBe("Unknown");
  });

  it("formats a real ISO timestamp", () => {
    expect(formatTimestamp("2026-10-16T06:30:36.757Z")).not.toBe("Unknown");
  });
});

describe("epoch milliseconds", () => {
  it("treats zero and negatives as no timestamp rather than 1970", () => {
    expect(epochToIso(0)).toBeNull();
    expect(epochToIso(-1)).toBeNull();
    expect(epochToIso(Number.NaN)).toBeNull();
  });

  it("converts a real ledger time", () => {
    expect(epochToIso(1_792_132_236_968)).toBe("2026-10-16T06:30:36.968Z");
  });
});

describe("session method descriptions", () => {
  it("reads the provider out of an oauth method", () => {
    expect(describeSessionMethod("oauth:github")).toBe("Signed in with GitHub");
  });

  it("passes through anything it does not recognise", () => {
    expect(describeSessionMethod("installation")).toBe("installation");
  });
});
