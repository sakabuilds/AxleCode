import { ArrowUpRightIcon, CheckIcon, LoaderCircleIcon, PlugIcon, UnplugIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAccountState } from "../../account/AccountAuthProvider";
import { PluginLogo } from "../plugins/PluginLogo";
import {
  disconnectPlugin,
  listPluginStatus,
  loadPluginSessionToken,
  type PluginStatus,
} from "../plugins/pluginApi";
import { getPluginById, type PluginId } from "../plugins/pluginCatalog";
import { Button } from "../ui/button";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

type GitHubDisconnectBridge = {
  readonly disconnectGitHub?: () => Promise<unknown>;
};

function metadataSummary(status: PluginStatus): string | null {
  const metadata = status.metadata;
  if (!metadata) return null;
  for (const key of ["login", "teamName", "workspaceName", "siteName"] as const) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function PluginsSettingsPanel() {
  const account = useAccountState();
  const hasPluginSession =
    loadPluginSessionToken() !== null ||
    ((account.status === "signed-in" || account.status === "signed-out") &&
      account.pluginSessionReady);
  const pluginError =
    account.status === "signed-in" || account.status === "signed-out"
      ? account.pluginError
      : account.status === "error"
        ? account.error
        : null;
  const [statuses, setStatuses] = useState<PluginStatus[]>([]);
  const [busyPluginId, setBusyPluginId] = useState<PluginId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async (options: { readonly forceRefresh?: boolean } = {}) => {
    const sessionToken = loadPluginSessionToken();
    if (!sessionToken) {
      setStatuses([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setStatuses(await listPluginStatus(sessionToken, options));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Installed plugins could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [hasPluginSession, refresh]);

  const installed = useMemo(
    () =>
      statuses
        .filter((status) => status.connected)
        .flatMap((status) => {
          const plugin = getPluginById(status.pluginId);
          return plugin ? [{ plugin, status }] : [];
        }),
    [statuses],
  );

  const remove = useCallback(
    async (pluginId: PluginId) => {
      const sessionToken = loadPluginSessionToken();
      if (!sessionToken || busyPluginId) return;
      setBusyPluginId(pluginId);
      setError(null);
      try {
        await disconnectPlugin(sessionToken, pluginId);
        if (pluginId === "github") {
          const bridge = window.desktopBridge as unknown as GitHubDisconnectBridge | undefined;
          await bridge?.disconnectGitHub?.();
        }
        await refresh({ forceRefresh: true });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Plugin could not be deleted.");
      } finally {
        setBusyPluginId(null);
      }
    },
    [busyPluginId, refresh],
  );

  return (
    <SettingsPageContainer
      title="Plugins"
      description="Manage the tools and services connected to your workspace."
    >
      {!hasPluginSession ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3"
        >
          {!pluginError ? (
            <LoaderCircleIcon
              className="size-3.5 shrink-0 animate-spin text-muted-foreground"
              aria-hidden
            />
          ) : null}
          <p className="text-xs text-muted-foreground">
            {pluginError ?? "Preparing your plugin session…"}
          </p>
        </div>
      ) : null}

      <SettingsSection
        title="Connected plugins"
        headerAction={
          <Button size="xs" variant="outline" render={<Link to="/plugins" />}>
            Browse plugins
            <ArrowUpRightIcon className="size-3.5" />
          </Button>
        }
      >
        {isLoading && installed.length === 0 ? (
          <div
            role="status"
            className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted-foreground"
          >
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
            Loading connected plugins…
          </div>
        ) : installed.length === 0 && !error ? (
          <div className="flex flex-col items-center px-5 py-9 text-center">
            <div className="mb-3 grid size-10 place-items-center rounded-xl border border-border bg-muted/40">
              <PlugIcon className="size-5 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-sm font-medium text-foreground">Your tools, connected</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
              Connect a plugin to bring its capabilities into Axle. Your connected services will
              appear here.
            </p>
          </div>
        ) : (
          installed.map(({ plugin, status }, index) => {
            const summary = metadataSummary(status);
            const busy = busyPluginId === plugin.id;
            return (
              <div
                key={plugin.id}
                className={
                  index === 0
                    ? "flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5"
                    : "flex flex-wrap items-center gap-3 border-t border-border/70 px-4 py-4 sm:px-5"
                }
              >
                <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-border/70 bg-background/65">
                  <PluginLogo pluginId={plugin.id} className="size-5 grayscale" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{plugin.name}</p>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] text-foreground">
                      <CheckIcon className="size-3" aria-hidden />
                      Connected
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {summary ?? plugin.description}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busyPluginId !== null}
                  className="shrink-0"
                  aria-label={`Disconnect ${plugin.name}`}
                  onClick={() => void remove(plugin.id)}
                >
                  {busy ? (
                    <LoaderCircleIcon className="size-3.5 animate-spin" />
                  ) : (
                    <UnplugIcon className="size-3.5" />
                  )}
                  {busy ? "Disconnecting…" : "Disconnect"}
                </Button>
              </div>
            );
          })
        )}
        {error ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm text-foreground"
          >
            <p className="min-w-0 flex-1 text-xs leading-5">{error}</p>
            <Button
              size="xs"
              variant="outline"
              disabled={isLoading}
              onClick={() => void refresh({ forceRefresh: true })}
            >
              Retry
            </Button>
          </div>
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
