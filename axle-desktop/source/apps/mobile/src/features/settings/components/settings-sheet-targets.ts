export type SettingsSheetTarget =
  | "SettingsEnvironments"
  | "SettingsArchive"
  | "SettingsAppearance"
  | "SettingsClientStorage";

export type SettingsLegalDocumentTarget = "SettingsLegal";

/** Root-level routes reachable from settings rows (not inside the sheet stack). */
export type SettingsFullScreenTarget = SettingsLegalDocumentTarget | "CloudJobs";
