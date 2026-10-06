"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { AppIcon } from "./app-icon";
import { HomeEditShell } from "./home-edit-shell";
import { APP_REGISTRY, type AppId } from "../lib/app-registry";
import { WidgetRenderer } from "./widgets/widget-renderer";
import { useTheme } from "./theme-provider";
import {
  GRID_COLS,
  GRID_ROWS,
  addAppToDesktop,
  moveDesktopItemToCell,
  type DesktopItem,
} from "../lib/desktop-layout";

import { UI_COPY as U } from "../lib/ui-copy";

export function HomeScreen() {
  const { document, ready, commit, resolveImage } = useTheme();
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
  async function move(row: number, col: number) {
    if (!selected || saving) return;
    setSaving(true);
    try {
      await commit((d) => ({
        ...d,
        current: {
          ...d.current,
          ...moveDesktopItemToCell(d.current, selected, {
            page: currentPage, row, col,
          }),
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

  async function removeItem(item: DesktopItem) {
    if (!editing || !ready || saving) return;
    setSaving(true);
    try {
      await commit((d) => ({
        ...d,
        current: {
          ...d.current,
          widgets: item.kind === "widget"
            ? d.current.widgets.filter((w) => w.id !== item.id)
            : d.current.widgets,
          iconLayout: item.kind === "app"
            ? d.current.iconLayout.filter((app) => app.id !== item.id)
            : d.current.iconLayout,
        },
      }));
      if (selected?.kind === item.kind && selected.id === item.id) setSelected(null);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : U.home.removeError);
    } finally {
      setSaving(false);
    }
  }

  async function addApp(appId: AppId): Promise<string | null> {
    if (!editing || !ready || saving) return "Home is busy. Try again.";
    setSaving(true);
    let destination = currentPage;
    try {
      await commit((d) => {
        const next = addAppToDesktop(d.current, appId, currentPage);
        destination = next.iconLayout.find((app) => app.id === appId)!.page;
        return { ...d, current: { ...d.current, ...next } };
      });
      setPage(destination);
      setNotice("");
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : U.home.saveError;
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
      {editing && (
        <HomeEditShell
          disabled={!ready || saving}
          availableApps={APP_REGISTRY.filter((app) =>
            !iconLayout.some((icon) => icon.id === app.id)).map((app) => app.id)}
          onAddApp={addApp}
          onDone={() => {
            setEditing(false);
            setSelected(null);
            setNotice("");
          }}
        />
      )}
      <span className="home-edit-notice" role="status">{notice}</span>
      <div className="desktop-foreground">
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
                          onRemove={() => void removeItem({ kind: "widget", id: widget.id })}
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
                          {editing && (
                            <button
                              className="desktop-app-remove"
                              aria-label={U.home.removeApp(APP_REGISTRY.find((entry) => entry.id === app.id)!.label)}
                              disabled={!ready || saving}
                              onClick={() => void removeItem({ kind: "app", id: app.id })}
                            >
                              <span aria-hidden="true">−</span>
                            </button>
                          )}
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
            backgroundImage: resolveImage(profile.dock.image)
              ? `url(${JSON.stringify(resolveImage(profile.dock.image))})`
              : undefined,
          }}
        >
          {dockLayout.map((id) => (
            <AppIcon key={id} id={id} editing={editing} />
          ))}
        </nav>
      </div>
    </div>
  );
}
