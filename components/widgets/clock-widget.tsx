"use client";

import type { WidgetInstance } from "../../lib/widget-types";
import { localTime } from "../../lib/participant-config";
import { useDeviceClock } from "./use-device-clock";

export function ClockWidget({ widget }: { widget: WidgetInstance }) {
  const now = useDeviceClock();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return (
    <div className="clock-widget">
      <span className="widget-eyebrow">Clock</span>
      <time className="clock-time" dateTime={now?.toISOString()}>
        {now
          ? localTime(
              now,
              timezone,
              widget.config.hour12,
              widget.config.showSeconds,
            )
          : "--:--"}
      </time>
      <span className="clock-date">
        {now
          ? new Intl.DateTimeFormat("en", {
              weekday: "short",
              month: "short",
              day: "numeric",
            }).format(now)
          : "—"}
      </span>
    </div>
  );
}
