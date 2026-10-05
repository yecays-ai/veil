"use client";

import { useEffect, useRef, useState } from "react";
import { useFoundation } from "../foundation-provider";
import { useTheme } from "../theme-provider";
import { bindHereThereCharacter, resolveHereThereCharacter } from "../../lib/here-there-binding";
import { FOUNDATION_COPY as C } from "../../lib/foundation-copy";
import {
  localTime,
  resolveTimezone,
  type ParticipantConfig,
  type WeatherState,
} from "../../lib/participant-config";
import type { WidgetInstance } from "../../lib/widget-types";
import { useDeviceClock } from "./use-device-clock";
import { useWeatherState } from "./use-weather";
import { ensureHereThereComment } from "../../lib/here-there-comment";

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
  config,
  now,
  widget,
  weather,
  onChooseCharacter,
}: {
  config: ParticipantConfig;
  now: Date | null;
  widget: WidgetInstance;
  weather: WeatherState;
  onChooseCharacter?: () => void;
}) {
  // Resolve the device zone after hydration; server and browser zones can differ.
  const zone = now ? resolveTimezone(config.timezone) : null;
  return (
    <div className="here-there-side">
      <strong>{onChooseCharacter ? <button type="button" className="here-there-character-name"
        aria-label={`Choose THERE Character, currently ${config.name}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onChooseCharacter(); }}>{config.name}</button> : config.name}</strong>
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
      <span className="participant-weather">
        <Weather state={weather} />
      </span>
    </div>
  );
}

export function HereThereWidget({ widget }: { widget: WidgetInstance }) {
  const now = useDeviceClock();
  const { document, ready: foundationReady } = useFoundation();
  const { commit, ready: themeReady } = useTheme();
  const character = resolveHereThereCharacter(widget.config, document);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const commentAttempt = useRef<string | null>(null);
  useEffect(() => {
    if (pickerOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [pickerOpen]);
  async function chooseCharacter(characterId: string) {
    if (saving || !document.characters.some((item) => item.characterId === characterId)) return;
    setSaving(true); setError("");
    try {
      await commit((theme) => bindHereThereCharacter(theme, widget.id, characterId));
      setPickerOpen(false);
    } catch {
      setError("Character binding could not be saved.");
    } finally { setSaving(false); }
  }
  const hereWeather = useWeatherState(
    document.user.location?.label ?? null,
    document.user.location?.coordinates?.latitude ?? null,
    document.user.location?.coordinates?.longitude ?? null,
  );
  const thereWeather = useWeatherState(
    character?.location?.label ?? null,
    character?.location?.coordinates?.latitude ?? null,
    character?.location?.coordinates?.longitude ?? null,
  );
  useEffect(() => {
    const key = `${widget.id}:${widget.config.characterId}`;
    if (!foundationReady || !themeReady || !now || !character || widget.config.comment
      || hereWeather.status === "loading" || thereWeather.status === "loading" || commentAttempt.current === key) return;
    commentAttempt.current = key;
    void ensureHereThereComment(widget.id, { foundation: document, characterId: character.characterId,
      now, hereWeather, thereWeather }, commit);
  }, [foundationReady, themeReady, now, character, widget.id, widget.config.characterId,
    widget.config.comment, document, hereWeather, thereWeather, commit]);
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
          weather={hereWeather}
        />
        {character ? (
          <Side
            config={character}
            now={now}
            widget={widget}
            weather={thereWeather}
            onChooseCharacter={() => setPickerOpen(true)}
          />
        ) : (
          <div className="here-there-side">
            <button type="button" className="here-there-character-name"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); setPickerOpen(true); }}>
              {C.hereThere.chooseCharacter}
            </button>
          </div>
        )}
      </div>
      {character && widget.config.comment?.status === "complete"
        && widget.config.comment.characterId === character.characterId &&
        <p className="here-there-comment">{widget.config.comment.text}</p>}
      {error && !pickerOpen && <span role="alert" className="participant-weather">{error}</span>}
      <dialog ref={dialog} className="here-there-character-picker" aria-label="Choose THERE Character"
        onClose={() => setPickerOpen(false)} onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) setPickerOpen(false); }}>
        <div className="here-there-picker-header"><strong>Character</strong>
          <button type="button" onClick={() => setPickerOpen(false)} aria-label="Close Character picker">×</button></div>
        <div className="here-there-picker-options">
          {document.characters.map((item) => <button type="button" key={item.characterId} disabled={saving}
            aria-pressed={character?.characterId === item.characterId}
            onClick={() => void chooseCharacter(item.characterId)}>
            {item.name}{character?.characterId === item.characterId && <span aria-hidden="true">✓</span>}
          </button>)}
          {document.characters.length === 0 && <p>No Characters yet.</p>}
        </div>
        {error && <p role="alert">{error}</p>}
      </dialog>
    </div>
  );
}
