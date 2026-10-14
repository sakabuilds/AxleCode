import { useNavigate } from "@tanstack/react-router";
import { PlugIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useAccountState } from "../../account/AccountAuthProvider";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { PluginLogo } from "./PluginLogo";
import { listPluginStatus, loadPluginSessionToken, type PluginStatus } from "./pluginApi";
import { PLUGINS, type PluginId } from "./pluginCatalog";

export function ComposerPluginDock(props: {
  readonly onPluginSelect?: (pluginId: PluginId) => void;
}) {
  const navigate = useNavigate();
  const account = useAccountState();
  const pluginSessionReady =
    loadPluginSessionToken() !== null ||
    ((account.status === "signed-in" || account.status === "signed-out") &&
      account.pluginSessionReady);
  const [statuses, setStatuses] = useState<PluginStatus[]>([]);

  useEffect(() => {
    if (!pluginSessionReady) {
      setStatuses([]);
      return;
    }

    const sessionToken = loadPluginSessionToken();
    if (!sessionToken) {
      setStatuses([]);
      return;
    }

    let cancelled = false;
    void listPluginStatus(sessionToken)
      .then((nextStatuses) => {
        if (!cancelled) setStatuses(nextStatuses);
      })
      .catch(() => {
        if (!cancelled) setStatuses([]);
      });

    return () => {
      cancelled = true;
    };
  }, [pluginSessionReady]);

  const installedPlugins = PLUGINS.filter((plugin) =>
    statuses.some((status) => status.pluginId === plugin.id && status.connected),
  );

  return (
    <div className="flex shrink-0 items-center gap-1" data-composer-plugin-dock="true">
      <div className="flex items-center gap-0.5" aria-label="Connected apps">
        {installedPlugins.map((plugin) => (
          <button
            key={plugin.id}
            type="button"
            className={cn(
              "relative flex size-7 shrink-0 items-center justify-center rounded-md p-1 outline-none",
              "transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
            )}
            title={`Add ${plugin.name} to chat`}
            aria-label={`Add ${plugin.name} to chat`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => props.onPluginSelect?.(plugin.id)}
          >
            <PluginLogo pluginId={plugin.id} className="size-4" />
          </button>
        ))}
      </div>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="h-8 shrink-0 gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground"
        aria-label="Connect apps"
        title="Connect apps"
        onClick={() => void navigate({ to: "/plugins" })}
      >
        <PlugIcon className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Apps</span>
      </Button>
    </div>
  );
}
