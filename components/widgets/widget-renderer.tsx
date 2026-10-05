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
import { UI_COPY as U } from "../../lib/ui-copy";

const WIDGET_VIEWS: Record<
  WidgetType,
  ComponentType<{ widget: WidgetInstance; editing: boolean }>
> = {
  clock: ClockWidget,
  "here-there": HereThereWidget,
};

export function WidgetRenderer({
  widget,
  editing,
  selected,
  onSelect,
  onRemove,
  disabled,
}: {
  widget: WidgetInstance;
  editing: boolean;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  disabled: boolean;
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
      <View widget={widget} editing={editing} />
      {editing && (
        <>
          <button
            className="widget-select"
            aria-label={`Move ${WIDGET_REGISTRY[widget.type].label}`}
            aria-pressed={selected}
            onClick={onSelect}
            disabled={disabled}
          />
          <button
            className="widget-remove"
            aria-label={U.home.removeWidget(WIDGET_REGISTRY[widget.type].label)}
            disabled={disabled}
            onClick={onRemove}
          >
            <span aria-hidden="true">−</span>
          </button>
        </>
      )}
    </section>
  );
}
