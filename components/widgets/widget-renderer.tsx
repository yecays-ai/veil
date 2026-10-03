"use client";

import type { ComponentType } from "react";
import { WIDGET_REGISTRY } from "../../lib/widget-registry";
import {
  WIDGET_SIZES,
  type WidgetInstance,
  type WidgetType,
} from "../../lib/widget-types";
import { ClockWidget } from "./clock-widget";
import { HereThereWidget } from "./here-there-widget";

const WIDGET_VIEWS: Record<
  WidgetType,
  ComponentType<{ widget: WidgetInstance }>
> = {
  clock: ClockWidget,
  "here-there": HereThereWidget,
};

export function WidgetRenderer({
  widget,
  editing,
  selected,
  onSelect,
}: {
  widget: WidgetInstance;
  editing: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const View = WIDGET_VIEWS[widget.type];
  const dimensions = WIDGET_SIZES[widget.size];
  return (
    <section
      className={`desktop-widget${selected ? " is-selected" : ""}`}
      aria-label={WIDGET_REGISTRY[widget.type].label}
      data-widget-id={widget.id}
      data-size={widget.size}
      style={{
        gridRow: `${widget.row} / span ${dimensions.rows}`,
        gridColumn: `${widget.col} / span ${dimensions.cols}`,
      }}
    >
      <View widget={widget} />
      {editing && (
        <button
          className="widget-select"
          aria-label={`Move ${WIDGET_REGISTRY[widget.type].label}`}
          aria-pressed={selected}
          onClick={onSelect}
        />
      )}
    </section>
  );
}
