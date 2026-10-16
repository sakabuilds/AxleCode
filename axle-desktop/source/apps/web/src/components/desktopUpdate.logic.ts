import type { DesktopUpdateActionResult, DesktopUpdateState } from "@axle/contracts";

export type DesktopUpdateButtonAction = "download" | "install" | "manual" | "none";

export function resolveDesktopUpdateButtonAction(
  state: DesktopUpdateState,
): DesktopUpdateButtonAction {
  // Platforms that install updates by hand (macOS) never drive the updater;
  // every action opens the download page from `manualUpdateUrl`.
  if (state.manualUpdateUrl) {
    return "manual";
  }
  if (state.downloadedVersion) {
    return "install";
  }
  if (state.status === "available") {
    return "download";
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return "download";
    }
  }
  return "none";
}

export function shouldShowDesktopUpdateButton(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) {
    return false;
  }
  if (state.manualUpdateUrl) {
    // The manual action is always available from settings, but the transient
    // banners/pills should only appear while an update is worth acting on.
    return (
      state.status === "available" ||
      state.status === "downloading" ||
      state.status === "downloaded"
    );
  }
  if (state.status === "downloading") {
    return true;
  }
  return resolveDesktopUpdateButtonAction(state) !== "none";
}

export function shouldShowArm64IntelBuildWarning(state: DesktopUpdateState | null): boolean {
  return state?.hostArch === "arm64" && state.appArch === "x64";
}

export function isDesktopUpdateButtonDisabled(state: DesktopUpdateState | null): boolean {
  return state?.status === "downloading";
}

export function getArm64IntelBuildWarningDescription(state: DesktopUpdateState): string {
  if (!shouldShowArm64IntelBuildWarning(state)) {
    return "This install is using the correct architecture.";
  }

  const action = resolveDesktopUpdateButtonAction(state);
  if (action === "download") {
    return "This Mac has Apple Silicon, but Axle is still running the Intel build under Rosetta. Download the available update to switch to the native Apple Silicon build.";
  }
  if (action === "install") {
    return "This Mac has Apple Silicon, but Axle is still running the Intel build under Rosetta. Restart to install the downloaded Apple Silicon build.";
  }
  return "This Mac has Apple Silicon, but Axle is still running the Intel build under Rosetta. The next app update will replace it with the native Apple Silicon build.";
}

export function getDesktopUpdateButtonTooltip(state: DesktopUpdateState): string {
  if (state.manualUpdateUrl) {
    return state.availableVersion
      ? `Update ${state.availableVersion} is ready. Download it from axle.llc.`
      : "Get the latest version from axle.llc.";
  }
  if (state.status === "available") {
    return `Update ${state.availableVersion ?? "available"} ready to download`;
  }
  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number" ? ` (${Math.floor(state.downloadPercent)}%)` : "";
    return `Downloading update${progress}`;
  }
  if (state.status === "downloaded") {
    return `Update ${state.downloadedVersion ?? state.availableVersion ?? "ready"} downloaded. Click to restart and install.`;
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return `Download failed for ${state.availableVersion}. Click to retry.`;
    }
    if (state.errorContext === "install" && state.downloadedVersion) {
      return `Install failed for ${state.downloadedVersion}. Click to retry.`;
    }
    return "Axle couldn't check for an update right now.";
  }
  return "Up to date";
}

export function getDesktopUpdateInstallConfirmationMessage(
  state: Pick<DesktopUpdateState, "availableVersion" | "downloadedVersion">,
): string {
  const version = state.downloadedVersion ?? state.availableVersion;
  return `Install update${version ? ` ${version}` : ""} and restart Axle?\n\nAny running tasks will be interrupted. Make sure you're ready before continuing.`;
}

export function getDesktopUpdateActionError(result: DesktopUpdateActionResult): string | null {
  if (!result.accepted || result.completed) return null;
  if (result.state.errorContext === "download") {
    return "Axle couldn't download this update. Try again in a moment.";
  }
  if (result.state.errorContext === "install") {
    return "Axle couldn't install this update. Try again later.";
  }
  return "Axle couldn't complete the update. Try again later.";
}

export function shouldToastDesktopUpdateActionResult(result: DesktopUpdateActionResult): boolean {
  return result.accepted && !result.completed && result.state.message !== null;
}

export function shouldHighlightDesktopUpdateError(state: DesktopUpdateState | null): boolean {
  if (!state || state.status !== "error") return false;
  return state.errorContext === "download" || state.errorContext === "install";
}

export function canCheckForUpdate(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) return false;
  return (
    state.status !== "checking" &&
    state.status !== "downloading" &&
    state.status !== "downloaded" &&
    state.status !== "disabled"
  );
}
