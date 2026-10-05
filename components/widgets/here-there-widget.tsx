"use client";

import Link from "next/link";
import { useState } from "react";
import { useFoundation } from "../foundation-provider";
import { useTheme } from "../theme-provider";
import { FOUNDATION_COPY as C } from "../../lib/foundation-copy";
import { UI_COPY as U } from "../../lib/ui-copy";
import { TIMEZONE_OFFSET_OPTIONS, timezoneLabel } from "../../lib/timezone-label";
import {
  localTime,
  resolveParticipantPlace,
  resolveTimezone,
  type ResolvedPlace,
  type WeatherState,
} from "../../lib/participant-config";
import {
  normalizeWidgetPlace,
  type WidgetConfig,
  type WidgetInstance,
  type WidgetPlace,
} from "../../lib/widget-types";
import { useDeviceClock } from "./use-device-clock";
import { useWeatherState } from "./use-weather";

function Weather({ state }: { state: WeatherState }) {
  switch (state.status) {
    case "ready":
      return (
        <span>
          <span aria-hidden="true">{state.icon}</span> {state.temperatureC}°C ·{" "}
          {state.summary}
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
  name,
  place,
  now,
  widget,
  weather,
}: {
  name: string;
  place: ResolvedPlace;
  now: Date | null;
  widget: WidgetInstance;
  weather: WeatherState;
}) {
  // Resolve the device zone after hydration; server and browser zones can differ.
  const zone = now ? resolveTimezone(place.timezone) : null;
  return (
    <div className="here-there-side">
      <strong>{name}</strong>
      <span className="participant-location">
        {place.label || C.hereThere.noLocation}
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
      <span className="participant-weather">
        <Weather state={weather} />
      </span>
    </div>
  );
}

type SideDraft = {
  label: string;
  latitude: string;
  longitude: string;
  timezone: string;
};

function draftFrom(
  configured: WidgetPlace | null | undefined,
  fallback: ResolvedPlace,
): SideDraft {
  const latitude = configured?.latitude ?? fallback.coordinates?.latitude;
  const longitude = configured?.longitude ?? fallback.coordinates?.longitude;
  return {
    label: configured?.label || fallback.label || "",
    latitude: latitude === undefined ? "" : String(latitude),
    longitude: longitude === undefined ? "" : String(longitude),
    timezone: configured?.timezone || fallback.timezone || "",
  };
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function placeFrom(draft: SideDraft): WidgetPlace | null {
  const latitude = numberOrNull(draft.latitude);
  const longitude = numberOrNull(draft.longitude);
  // Latitude and longitude are only meaningful together.
  const paired = latitude !== null && longitude !== null;
  return normalizeWidgetPlace({
    label: draft.label,
    latitude: paired ? latitude : null,
    longitude: paired ? longitude : null,
    timezone: draft.timezone || null,
  });
}

function SideFields({
  legend,
  draft,
  onChange,
}: {
  legend: string;
  draft: SideDraft;
  onChange: (next: SideDraft) => void;
}) {
  const edit = (patch: Partial<SideDraft>) => onChange({ ...draft, ...patch });
  return (
    <fieldset className="here-there-places-group">
      <legend>{legend}</legend>
      <label>
        {C.fields.location}
        <input
          autoComplete="off"
          maxLength={200}
          value={draft.label}
          onChange={(event) => edit({ label: event.target.value })}
        />
      </label>
      <div className="here-there-places-coordinates">
        <label>
          {C.hereThere.latitude}
          <input
            autoComplete="off"
            inputMode="decimal"
            value={draft.latitude}
            onChange={(event) => edit({ latitude: event.target.value })}
          />
        </label>
        <label>
          {C.hereThere.longitude}
          <input
            autoComplete="off"
            inputMode="decimal"
            value={draft.longitude}
            onChange={(event) => edit({ longitude: event.target.value })}
          />
        </label>
      </div>
      <label>
        {C.fields.timezone}
        <select
          value={draft.timezone}
          onChange={(event) => edit({ timezone: event.target.value })}
        >
          <option value="">{U.useDeviceTimezone}</option>
          {draft.timezone &&
            !TIMEZONE_OFFSET_OPTIONS.some(
              (option) => option.timezone === draft.timezone,
            ) && (
              <option value={draft.timezone}>
                {timezoneLabel(draft.timezone)}
              </option>
            )}
          {TIMEZONE_OFFSET_OPTIONS.map(({ timezone, label }) => (
            <option key={timezone} value={timezone}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

// Home edit mode only: the smallest editor that can persist each side's place.
function PlacesEditor({
  widget,
  hereFallback,
  thereFallback,
  thereVisible,
}: {
  widget: WidgetInstance;
  hereFallback: ResolvedPlace;
  thereFallback: ResolvedPlace;
  thereVisible: boolean;
}) {
  const { commit } = useTheme();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [here, setHere] = useState<SideDraft>(() =>
    draftFrom(widget.config.here, hereFallback),
  );
  const [there, setThere] = useState<SideDraft>(() =>
    draftFrom(widget.config.there, thereFallback),
  );
  function openPanel() {
    setHere(draftFrom(widget.config.here, hereFallback));
    setThere(draftFrom(widget.config.there, thereFallback));
    setError("");
    setOpen(true);
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const config: WidgetConfig = {
        ...widget.config,
        here: placeFrom(here),
        there: thereVisible ? placeFrom(there) : (widget.config.there ?? null),
      };
      await commit((d) => ({
        ...d,
        current: {
          ...d.current,
          widgets: d.current.widgets.map((w) =>
            w.id === widget.id ? { ...w, config } : w,
          ),
        },
      }));
      setOpen(false);
    } catch {
      setError(C.hereThere.placesError);
    } finally {
      setBusy(false);
    }
  }
  if (!open)
    return (
      <button
        type="button"
        className="here-there-places-toggle"
        aria-label={C.hereThere.placesTitle}
        onClick={openPanel}
      >
        {C.hereThere.places}
      </button>
    );
  return (
    <form
      className="here-there-places"
      aria-label={C.hereThere.placesTitle}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="here-there-places-head">
        <strong>{C.hereThere.placesTitle}</strong>
        <button type="button" disabled={busy} onClick={() => setOpen(false)}>
          {C.common.cancel}
        </button>
      </div>
      <SideFields legend={C.hereThere.here} draft={here} onChange={setHere} />
      {thereVisible && (
        <SideFields
          legend={C.hereThere.there}
          draft={there}
          onChange={setThere}
        />
      )}
      <p className="here-there-places-help">{C.hereThere.placeHelp}</p>
      {error && (
        <p className="here-there-places-error" role="alert">
          {error}
        </p>
      )}
      <div className="here-there-places-actions">
        <button type="submit" disabled={busy}>
          {C.common.save}
        </button>
      </div>
    </form>
  );
}

export function HereThereWidget({
  widget,
  editing = false,
}: {
  widget: WidgetInstance;
  editing?: boolean;
}) {
  const now = useDeviceClock();
  const { document } = useFoundation();
  const character = document.characters.find(
    (c) => c.characterId === document.selectedCharacterId,
  );
  // Widget places win; profiles remain the fallback for existing widgets.
  const here = resolveParticipantPlace(widget.config.here, document.user);
  const there = character
    ? resolveParticipantPlace(widget.config.there, character)
    : { label: null, timezone: null, coordinates: null };
  const hereWeather = useWeatherState(
    here.coordinates?.latitude ?? null,
    here.coordinates?.longitude ?? null,
  );
  const thereWeather = useWeatherState(
    there.coordinates?.latitude ?? null,
    there.coordinates?.longitude ?? null,
  );
  return (
    <div className={`here-there-widget size-${widget.size}`}>
      <span className="widget-eyebrow here-there-title">
        {C.hereThere.title}
      </span>
      <div className="here-there-sides">
        <Side
          name={document.user.name}
          place={here}
          now={now}
          widget={widget}
          weather={hereWeather}
        />
        {character ? (
          <Side
            name={character.name}
            place={there}
            now={now}
            widget={widget}
            weather={thereWeather}
          />
        ) : (
          <div className="here-there-side">
            <Link href="/characters">{C.hereThere.chooseCharacter}</Link>
          </div>
        )}
      </div>
      {editing && (
        <PlacesEditor
          widget={widget}
          hereFallback={here}
          thereFallback={there}
          thereVisible={!!character}
        />
      )}
    </div>
  );
}
