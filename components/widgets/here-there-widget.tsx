"use client";

import Link from "next/link";
import { useFoundation } from "../foundation-provider";
import { FOUNDATION_COPY as C } from "../../lib/foundation-copy";
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
      return <span>{C.hereThere.weatherLoading}</span>;
    case "error":
      return <span>{C.hereThere.weatherError}</span>;
    default:
      return <span>{C.hereThere.weatherNone}</span>;
  }
}

function Side({
  config,
  now,
  widget,
  weather,
}: {
  config: ParticipantConfig;
  now: Date | null;
  widget: WidgetInstance;
  weather: WeatherState;
}) {
  // Resolve the device zone after hydration; server and browser zones can differ.
  const zone = now ? resolveTimezone(config.timezone) : null;
  return (
    <div className="here-there-side">
      <strong>{config.name}</strong>
      <span className="participant-location">
        {config.location?.label || C.hereThere.noLocation}
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
        {!zone
          ? C.hereThere.loadingZone
          : zone.state === "configured"
            ? zone.timezone
            : zone.state === "invalid"
              ? `${C.hereThere.invalidZone} · ${zone.timezone}`
              : `${C.hereThere.device} · ${zone.timezone}`}
      </span>
      <span className="participant-weather">
        <Weather state={weather} />
      </span>
    </div>
  );
}

export function HereThereWidget({ widget }: { widget: WidgetInstance }) {
  const now = useDeviceClock();
  const { document } = useFoundation();
  const character = document.characters.find(
    (c) => c.characterId === document.selectedCharacterId,
  );
  const weather: WeatherState = { status: "not-configured" };
  return (
    <div className={`here-there-widget size-${widget.size}`}>
      <span className="widget-eyebrow here-there-title">
        {C.hereThere.title}
      </span>
      <div className="here-there-sides">
        <Side
          config={document.user}
          now={now}
          widget={widget}
          weather={weather}
        />
        {character ? (
          <Side
            config={character}
            now={now}
            widget={widget}
            weather={weather}
          />
        ) : (
          <div className="here-there-side">
            <Link href="/characters">{C.hereThere.chooseCharacter}</Link>
          </div>
        )}
      </div>
    </div>
  );
}
