import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  __resetArchivedProjectsForTests,
  archiveProject,
  archiveProjectFromRemovalMessage,
  isProjectRemovalMessage,
  isWorkspaceRootArchived,
  parseProjectRemovalMessage,
  restoreArchivedProject,
} from "./archivedProjectsState";

function installLocalStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
}

describe("archivedProjectsState", () => {
  beforeEach(() => {
    installLocalStorage();
    __resetArchivedProjectsForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses the existing sidebar project-removal confirmation format", () => {
    const message = [
      'Remove project "agent" and delete its 3 threads?',
      "Path: C:\\Users\\Lenovo\\downloads\\AI and Machine Learning\\agent",
      "Environment: DESKTOP-V4HRJ58",
      "This removes only this project entry.",
    ].join("\n");

    expect(isProjectRemovalMessage(message)).toBe(true);
    expect(parseProjectRemovalMessage(message)).toEqual({
      title: "agent",
      workspaceRoot: "C:\\Users\\Lenovo\\downloads\\AI and Machine Learning\\agent",
      environmentLabel: "DESKTOP-V4HRJ58",
    });
  });

  it("archives directly by workspace root and restores without touching the folder", () => {
    const archived = archiveProject({
      title: "agent",
      workspaceRoot: "C:\\Users\\Lenovo\\downloads\\agent",
      environmentLabel: "DESKTOP-V4HRJ58",
    });

    expect(isWorkspaceRootArchived("C:/Users/Lenovo/downloads/agent/")).toBe(true);

    restoreArchivedProject(archived.key);
    expect(isWorkspaceRootArchived("C:\\Users\\Lenovo\\downloads\\agent")).toBe(false);
  });

  it("keeps the legacy removal-message archive adapter working", () => {
    const message = [
      'Remove project "agent"?',
      "Path: C:\\Users\\Lenovo\\downloads\\agent",
      "This removes only this project entry.",
    ].join("\n");

    const archived = archiveProjectFromRemovalMessage(message);
    expect(archived).not.toBeNull();
    expect(isWorkspaceRootArchived("C:/Users/Lenovo/downloads/agent/")).toBe(true);
  });

  it("reads pre-rebrand storage and moves it to the current key on the next write", () => {
    const legacyEntry = {
      key: "desktop-v4hrj58:c:/users/lenovo/downloads/agent",
      title: "agent",
      workspaceRoot: "C:\\Users\\Lenovo\\downloads\\agent",
      environmentLabel: "DESKTOP-V4HRJ58",
      archivedAt: "2026-01-01T00:00:00.000Z",
    };
    window.localStorage.setItem("sparky:archived-projects:v1", JSON.stringify([legacyEntry]));

    expect(isWorkspaceRootArchived("C:\\Users\\Lenovo\\downloads\\agent")).toBe(true);

    archiveProject({ title: "other", workspaceRoot: "C:\\Users\\Lenovo\\downloads\\other" });
    expect(window.localStorage.getItem("sparky:archived-projects:v1")).toBeNull();
    expect(window.localStorage.getItem("axle:archived-projects:v1")).not.toBeNull();
    expect(isWorkspaceRootArchived("C:\\Users\\Lenovo\\downloads\\agent")).toBe(true);
  });

  it("prefers the newer rivet key over the older sparky key when both exist", () => {
    const rivetEntry = {
      key: "desktop-v4hrj58:c:/users/lenovo/downloads/agent",
      title: "agent",
      workspaceRoot: "C:\\Users\\Lenovo\\downloads\\agent",
      environmentLabel: "DESKTOP-V4HRJ58",
      archivedAt: "2026-01-01T00:00:00.000Z",
    };
    const sparkyEntry = {
      ...rivetEntry,
      key: "desktop-v4hrj58:c:/users/lenovo/downloads/other",
      title: "other",
      workspaceRoot: "C:\\Users\\Lenovo\\downloads\\other",
    };
    window.localStorage.setItem("rivet:archived-projects:v1", JSON.stringify([rivetEntry]));
    window.localStorage.setItem("sparky:archived-projects:v1", JSON.stringify([sparkyEntry]));

    expect(isWorkspaceRootArchived("C:\\Users\\Lenovo\\downloads\\agent")).toBe(true);
    expect(isWorkspaceRootArchived("C:\\Users\\Lenovo\\downloads\\other")).toBe(false);

    archiveProject({ title: "third", workspaceRoot: "C:\\Users\\Lenovo\\downloads\\third" });

    expect(window.localStorage.getItem("rivet:archived-projects:v1")).toBeNull();
    expect(window.localStorage.getItem("sparky:archived-projects:v1")).toBeNull();
    expect(window.localStorage.getItem("axle:archived-projects:v1")).not.toBeNull();
    expect(isWorkspaceRootArchived("C:\\Users\\Lenovo\\downloads\\agent")).toBe(true);
  });
});
