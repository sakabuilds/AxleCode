import type { StatusTone } from "../../components/StatusPill";
import type { RemoteClientConnectionState } from "../../lib/connection";

export function connectionTone(state: RemoteClientConnectionState): StatusTone {
  switch (state) {
    case "connected":
      return {
        label: "Connected",
        pillClassName: "bg-success/12",
        textClassName: "text-success",
      };
    case "reconnecting":
      return {
        label: "Reconnecting",
        pillClassName: "bg-warning/12",
        textClassName: "text-warning",
      };
    case "connecting":
      return {
        label: "Connecting",
        pillClassName: "bg-info/12",
        textClassName: "text-info",
      };
    case "error":
      return {
        label: "Connection failed",
        pillClassName: "bg-danger",
        textClassName: "text-danger-foreground",
      };
    case "offline":
      return {
        label: "Offline",
        pillClassName: "bg-danger",
        textClassName: "text-danger-foreground",
      };
    case "available":
      return {
        label: "Available",
        pillClassName: "bg-subtle",
        textClassName: "text-foreground-tertiary",
      };
  }
}
