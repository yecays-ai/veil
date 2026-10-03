"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { AppIcon } from "./app-icon";
import { WidgetRenderer } from "./widgets/widget-renderer";
import { useTheme } from "./theme-provider";
import {
  GRID_COLS,
  GRID_ROWS,
  MAX_PAGES,
  moveDesktopItem,
  moveDesktopItemToCell,
  type DesktopItem,
} from "../lib/desktop-layout";
import { WIDGET_REGISTRY } from "../lib/widget-registry";
import type { WidgetSize } from "../lib/widget-types";

import { UI_COPY as U } from "../lib/ui-copy";

export function HomeScreen() {
  const { document, ready, commit } = useTheme();
  const layout = document.current;
  const { profile, iconLayout, dockLayout, widgets, pageCount } = layout;
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<DesktopItem | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const currentPage = Math.min(page, pageCount);
  const swipe = useRef<{
    id: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelHold() {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
  }
  useEffect(
    () => () => {
      if (hold.current) clearTimeout(hold.current);
    },
    [],
  );
  const wallpaper = profile.wallpaper;
  const selectedWidget =
    selected?.kind === "widget"
      ? widgets.find((w) => w.id === selected.id)
      : null;

  async function move(row: number, col: number, size?: WidgetSize) {
    if (!selected || saving) return;
    setSaving(true);
    try {
      await commit((d) => ({
        ...d,
        current: {
          ...d.current,
          ...(size === undefined
            ? moveDesktopItemToCell(
                d.current,
                selected,
                { page: currentPage, row, col },
              )
            : moveDesktopItem(
                d.current,
                selected,
                { page: currentPage, row, col },
                size,
              )),
        },
      }));
      setNotice(U.home.saved);
      setSelected(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : U.home.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function removeWidget(id: string) {
    if (!editing || !ready || saving) return;
    setSaving(true);
    try {
      await commit((d) => ({
        ...d,
        current: {
          ...d.current,
          widgets: d.current.widgets.filter((w) => w.id !== id),
        },
      }));
      if (selected?.kind === "widget" && selected.id === id) setSelected(null);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : U.home.removeError);
    } finally {
      setSaving(false);
    }
  }

  function swipeStart(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    cancelHold();
    if (!editing && ready)
      hold.current = setTimeout(() => {
        setEditing(true);
        setSelected(null);
        setNotice("");
        suppressClick.current = true;
        hold.current = null;
      }, 550);
    suppressClick.current = false;
    swipe.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dx: 0,
      dy: 0,
    };
  }
  function swipeMove(event: PointerEvent<HTMLDivElement>) {
    const gesture = swipe.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    gesture.dx = event.clientX - gesture.x;
    gesture.dy = event.clientY - gesture.y;
    if (Math.hypot(gesture.dx, gesture.dy) > 8) cancelHold();
    if (
      Math.abs(gesture.dx) > 12 &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.3
    ) {
      event.currentTarget.setPointerCapture(event.pointerId);
      suppressClick.current = true;
    }
  }
  function swipeEnd(event: PointerEvent<HTMLDivElement>) {
    cancelHold();
    const gesture = swipe.current;
    swipe.current = null;
    if (!gesture || gesture.id !== event.pointerId) return;
    const threshold = Math.max(40, event.currentTarget.clientWidth * 0.16);
    if (
      Math.abs(gesture.dx) > threshold &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.3
    ) {
      setPage(
        Math.max(
          1,
          Math.min(pageCount, currentPage + (gesture.dx < 0 ? 1 : -1)),
        ),
      );
    }
  }

  return (
    <div className={`home-screen desktop-home ${editing ? "is-editing" : ""}`}>
      {wallpaper.source && (
        <div
          className="home-wallpaper"
          data-testid="home-wallpaper"
          style={{
            backgroundImage: `url(${JSON.stringify(wallpaper.source)})`,
            backgroundSize: wallpaper.fit,
            backgroundPosition: `${wallpaper.x}% ${wallpaper.y}%`,
            opacity: wallpaper.opacity,
            filter: `blur(${wallpaper.blur}px)`,
            transform: `scale(${wallpaper.scale / 100})`,
          }}
        />
      )}
      <div className="desktop-foreground">
        {editing && (
          <div className="desktop-toolbar">
            <span role="status" className="desktop-notice">
              {notice ||
                (editing
                  ? selected
                    ? U.home.chooseCell
                    : U.home.selectItem
                  : "")}
            </span>
            <button
              className="desktop-edit"
              disabled={!ready || saving}
              onClick={() => {
                setEditing(!editing);
                setSelected(null);
                setNotice("");
              }}
            >
              {U.home.done}
            </button>
          </div>
        )}
        {editing && (
          <div className="desktop-edit-tools">
            {selectedWidget && (
              <label>
                {U.home.size}
                <select
                  aria-label={U.home.widgetSize}
                  value={selectedWidget.size}
                  disabled={saving}
                  onChange={(e) =>
                    void move(
                      selectedWidget.row,
                      selectedWidget.col,
                      e.target.value as WidgetSize,
                    )
                  }
                >
                  {WIDGET_REGISTRY[selectedWidget.type].sizes.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              disabled={pageCount >= MAX_PAGES || saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await commit((d) => ({
                    ...d,
                    current: {
                      ...d.current,
                      pageCount: Math.min(MAX_PAGES, d.current.pageCount + 1),
                    },
                  }));
                  setPage(pageCount + 1);
                  setNotice(U.home.pageAdded);
                } catch (error) {
                  setNotice(
                    error instanceof Error ? error.message : U.home.pageError,
                  );
                } finally {
                  setSaving(false);
                }
              }}
            >
              {U.home.addPage}
            </button>
          </div>
        )}
        <div
          className="desktop-pages"
          aria-label={U.home.title}
          tabIndex={0}
          onKeyDown={(event) => {
            if (
              event.key === "ContextMenu" ||
              (event.shiftKey && event.key === "F10")
            ) {
              event.preventDefault();
              setEditing(true);
            }
            if (event.key === "Escape") {
              setEditing(false);
              setSelected(null);
              setNotice("");
            }
          }}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={swipeStart}
          onPointerMove={swipeMove}
          onPointerUp={swipeEnd}
          onPointerCancel={() => {
            cancelHold();
            swipe.current = null;
          }}
          onClickCapture={(event) => {
            if (suppressClick.current) {
              event.preventDefault();
              event.stopPropagation();
              suppressClick.current = false;
            }
          }}
        >
          <div
            className="desktop-track"
            style={{ transform: `translateX(-${(currentPage - 1) * 100}%)` }}
          >
            {Array.from({ length: pageCount }, (_, index) => index + 1).map(
              (number) => (
                <div
                  className="desktop-page"
                  key={number}
                  inert={number !== currentPage}
                  aria-hidden={number !== currentPage}
                >
                  <div
                    className="desktop-grid"
                    role="group"
                    aria-label={U.home.page(number)}
                    data-page={number}
                  >
                    {editing &&
                      Array.from(
                        { length: GRID_ROWS * GRID_COLS },
                        (_, index) => {
                          const row = Math.floor(index / GRID_COLS) + 1,
                            col = (index % GRID_COLS) + 1;
                          return (
                            <button
                              className="desktop-cell"
                              key={`cell-${index}`}
                              disabled={!selected || saving}
                              aria-label={U.home.place(row, col)}
                              style={{ gridRow: row, gridColumn: col }}
                              onClick={() => void move(row, col)}
                            />
                          );
                        },
                      )}
                    {widgets
                      .filter((widget) => widget.page === number)
                      .map((widget) => (
                        <WidgetRenderer
                          key={widget.id}
                          widget={widget}
                          editing={editing}
                          selected={
                            selected?.kind === "widget" &&
                            selected.id === widget.id
                          }
                          onSelect={() => {
                            setSelected({ kind: "widget", id: widget.id });
                            setNotice("");
                          }}
                          disabled={saving}
                          onRemove={() => void removeWidget(widget.id)}
                        />
                      ))}
                    {iconLayout
                      .filter((app) => app.page === number)
                      .map((app) => (
                        <div
                          className="desktop-app"
                          key={app.id}
                          data-app-id={app.id}
                          style={{ gridRow: app.row, gridColumn: app.col }}
                        >
                          <AppIcon
                            id={app.id}
                            editing={editing}
                            selected={
                              selected?.kind === "app" && selected.id === app.id
                            }
                            onSelect={() => {
                              setSelected({ kind: "app", id: app.id });
                              setNotice("");
                            }}
                          />
                        </div>
                      ))}
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
        <nav className="desktop-indicator" aria-label={U.home.pagination}>
          {Array.from({ length: pageCount }, (_, index) => index + 1).map(
            (number) => (
              <button
                key={number}
                aria-label={U.home.goPage(number)}
                aria-current={number === currentPage ? "page" : undefined}
                onClick={() => setPage(number)}
              >
                <span />
              </button>
            ),
          )}
        </nav>
        <nav
          className="home-dock desktop-dock"
          aria-label={U.home.dock}
          style={{
            borderRadius: profile.dock.radius,
            backgroundImage: profile.dock.image
              ? `url(${JSON.stringify(profile.dock.image)})`
              : undefined,
          }}
        >
          {dockLayout.map((id) => (
            <AppIcon key={id} id={id} />
          ))}
        </nav>
      </div>
    </div>
  );
}
