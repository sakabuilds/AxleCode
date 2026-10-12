import { describe, expect, it } from "vite-plus/test";

import { isModelInAxleCatalog } from "./axleModelCatalog";

describe("isModelInAxleCatalog", () => {
  it("shows both OpenAI API and ChatGPT subscription models in the OpenAI catalog", () => {
    expect(isModelInAxleCatalog("catalog:OpenAI", "OpenAI")).toBe(true);
    expect(isModelInAxleCatalog("catalog:OpenAI", "OpenAI Codex")).toBe(true);
  });

  it("keeps other providers out of the OpenAI catalog", () => {
    expect(isModelInAxleCatalog("catalog:OpenAI", "Claude")).toBe(false);
    expect(isModelInAxleCatalog("catalog:OpenAI", "Google")).toBe(false);
  });
});
