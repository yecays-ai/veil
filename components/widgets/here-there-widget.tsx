"use client";

import { userConfig } from "../../config/user";
import { characterConfig } from "../../config/character";
import {
  localTime,
  resolveTimezone,
  type ParticipantConfig,
  type WeatherState,
} from "../../lib/participant-config";
import type { WidgetInstance } from "../../lib/widget-types";
import { useDeviceClock } from "./use-device-clock";

function Weather({ state }: { state: WeatherState }) {
  switch (state.status) {
    case "ready":
      return (
        <span>
          {state.temperatureC}°C · {state.summary}
        </span>
      );
    case "loading":
      return <span>Weather loading</span>;
    case "error":
      return <span>Weather unavailable</span>;
    default:
      return <span>Weather not connected</span>;
  }
}

function Side({
  title,
  config,
  now,
  widget,
  weather,
}: {
  title: string;
  config: ParticipantConfig;
  now: Date | null;
  widget: WidgetInstance;
  weather: WeatherState;
}) {
  // Resolve the device zone after hydration; server and browser zones can differ.
  const zone = now ? resolveTimezone(config.timezone) : null;
  return (
    <div className="here-there-side">
      <span className="widget-eyebrow">{title}</span>
      <strong>{config.name}</strong>
      <span className="participant-location">
        {config.location?.label || "Location not set"}
      </span>
      <time dateTime={now?.toISOString()}>
        {now && zone
          ? localTime(
              now,
              zone.timezone,
              widget.config.hour12,
              widget.config.showSeconds,
            )
          : "--:--"}
      </time>
      <span className="participant-zone">
        {!zone ? "Timezone loading" : zone.state === "configured"
          ? zone.timezone
          : zone.state === "invalid"
            ? `Invalid timezone · ${zone.timezone}`
            : `Device · ${zone.timezone}`}
      </span>
      <span className="participant-weather">
        <Weather state={weather} />
      </span>
    </div>
  );
}

export function HereThereWidget({ widget }: { widget: WidgetInstance }) {
  const now = useDeviceClock();
  const weather: WeatherState = { status: "not-configured" };
  return (
    <div className={`here-there-widget size-${widget.size}`}>
      <span className="widget-eyebrow here-there-title">Here &amp; There</span>
      <div className="here-there-sides">
        <Side
          title="Here"
          config={userConfig}
          now={now}
          widget={widget}
          weather={weather}
        />
        <Side
          title="There"
          config={characterConfig}
          now={now}
          widget={widget}
          weather={weather}
        />
      </div>
    </div>
  );
}
