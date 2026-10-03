import { APP_IDS, isAppId, type AppId } from "./app-registry";
import { isWidgetType, WIDGET_REGISTRY } from "./widget-registry";
import {
  WIDGET_SIZES,
  type WidgetInstance,
  type WidgetSize,
} from "./widget-types";

export const GRID_COLS = 4;
export const GRID_ROWS = 6;
export const MAX_PAGES = 8;
export const DOCK_MAX = 4;
export type GridPosition = { page: number; row: number; col: number };
export type AppPosition = GridPosition & { id: AppId };
export type DesktopLayout = {
  iconLayout: AppPosition[];
  widgets: WidgetInstance[];
  pageCount: number;
};
export type DesktopItem =
  { kind: "app"; id: AppId } | { kind: "widget"; id: string };
type Occupancy = Set<string>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function position(value: unknown): GridPosition {
  const raw = record(value);
  return {
    page: integer(raw.page, 1, MAX_PAGES),
    row: integer(raw.row, 1, GRID_ROWS),
    col: integer(raw.col, 1, GRID_COLS),
  };
}
function integer(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= max
    ? value
    : fallback;
}
function key(page: number, row: number, col: number) {
  return `${page}:${row}:${col}`;
}
function footprint(pos: GridPosition, size: WidgetSize | "1x1") {
  const dims = size === "1x1" ? { rows: 1, cols: 1 } : WIDGET_SIZES[size];
  return Array.from({ length: dims.rows }, (_, r) =>
    Array.from({ length: dims.cols }, (_, c) =>
      key(pos.page, pos.row + r, pos.col + c),
    ),
  ).flat();
}
export function canPlace(
  occupied: Occupancy,
  pos: GridPosition,
  size: WidgetSize | "1x1",
): boolean {
  const dims = size === "1x1" ? { rows: 1, cols: 1 } : WIDGET_SIZES[size];
  return (
    Number.isInteger(pos.page) &&
    pos.page >= 1 &&
    pos.page <= MAX_PAGES &&
    Number.isInteger(pos.row) &&
    pos.row >= 1 &&
    pos.row + dims.rows - 1 <= GRID_ROWS &&
    Number.isInteger(pos.col) &&
    pos.col >= 1 &&
    pos.col + dims.cols - 1 <= GRID_COLS &&
    footprint(pos, size).every((cell) => !occupied.has(cell))
  );
}
function reserve(
  occupied: Occupancy,
  pos: GridPosition,
  size: WidgetSize | "1x1",
) {
  footprint(pos, size).forEach((cell) => occupied.add(cell));
}
function firstSpace(
  occupied: Occupancy,
  size: WidgetSize | "1x1",
  preferred: GridPosition,
): GridPosition | null {
  if (canPlace(occupied, preferred, size)) return preferred;
  for (const page of [
    preferred.page,
    ...Array.from({ length: MAX_PAGES }, (_, i) => i + 1).filter(
      (p) => p !== preferred.page,
    ),
  ]) {
    for (let row = 1; row <= GRID_ROWS; row++)
      for (let col = 1; col <= GRID_COLS; col++) {
        const pos = { page, row, col };
        if (canPlace(occupied, pos, size)) return pos;
      }
  }
  return null;
}

export function defaultDesktop(): DesktopLayout {
  return {
    pageCount: 2,
    iconLayout: APP_IDS.map((id, index) => ({
      id,
      page: 1,
      row: 3 + Math.floor(index / 4),
      col: 1 + (index % 4),
    })).filter((app) => app.id !== "messages"),
    widgets: [
      {
        id: "here-there-default",
        type: "here-there",
        size: "4x2",
        page: 1,
        row: 1,
        col: 1,
        config: { hour12: false, showSeconds: false },
      },
    ],
  };
}

// Used at the storage/import boundary. Repair collisions deterministically, filter
// unknown registry IDs, and preserve explicitly saved shortcut removals.
export function normalizeDesktop(value: unknown): DesktopLayout {
  const raw = record(value),
    defaults = defaultDesktop();
  const occupied: Occupancy = new Set();
  const widgets: WidgetInstance[] = [];
  const ids = new Set<string>();
  const candidates = Array.isArray(raw.widgets)
    ? raw.widgets.slice(0, 32)
    : defaults.widgets;
  for (const value of candidates) {
    const candidate = record(value);
    if (
      !isWidgetType(candidate.type) ||
      typeof candidate.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(candidate.id) ||
      ids.has(candidate.id)
    )
      continue;
    const definition = WIDGET_REGISTRY[candidate.type];
    const size = definition.sizes.includes(candidate.size as WidgetSize)
      ? (candidate.size as WidgetSize)
      : definition.defaultSize;
    const area = WIDGET_SIZES[size].rows * WIDGET_SIZES[size].cols;
    // Even a full imported desktop must leave space for registered Apps.
    if (
      occupied.size + area >
      MAX_PAGES * GRID_ROWS * GRID_COLS - APP_IDS.length
    )
      continue;
    const pos = firstSpace(occupied, size, position(candidate));
    if (!pos) continue;
    reserve(occupied, pos, size);
    ids.add(candidate.id);
    widgets.push({
      id: candidate.id,
      type: candidate.type,
      size,
      ...pos,
      config: definition.normalizeConfig(candidate.config),
    });
  }
  const iconLayout: AppPosition[] = [];
  const seen = new Set<AppId>();
  const icons = Array.isArray(raw.iconLayout)
    ? raw.iconLayout
    : defaults.iconLayout;
  for (const value of icons) {
    const candidate = record(value),
      id = typeof value === "string" ? value : candidate.id;
    if (!isAppId(id) || seen.has(id)) continue;
    const preferred =
      typeof value === "string"
        ? { page: 1, row: 1, col: 3 }
        : position(candidate);
    const pos = firstSpace(occupied, "1x1", preferred);
    if (!pos) continue;
    reserve(occupied, pos, "1x1");
    seen.add(id);
    iconLayout.push({ id, ...pos });
  }
  const lastPage = Math.max(
    2,
    ...iconLayout.map((i) => i.page),
    ...widgets.map((w) => w.page),
  );
  return {
    iconLayout,
    widgets,
    pageCount: Math.max(lastPage, integer(raw.pageCount, 2, MAX_PAGES)),
  };
}

export function buildOccupancy(
  layout: DesktopLayout,
  except?: DesktopItem,
): Occupancy {
  const occupied: Occupancy = new Set();
  for (const app of layout.iconLayout)
    if (except?.kind !== "app" || except.id !== app.id)
      reserve(occupied, app, "1x1");
  for (const widget of layout.widgets)
    if (except?.kind !== "widget" || except.id !== widget.id)
      reserve(occupied, widget, widget.size);
  return occupied;
}

// A destination cell is a pointer target, not necessarily a multi-cell item's
// top-left corner. Anchor at the nearest in-bounds rectangle, then use the same
// footprint/collision validation as resizing. Never search for another free area.
export function moveDesktopItemToCell(
  layout: DesktopLayout,
  item: DesktopItem,
  cell: GridPosition,
): DesktopLayout {
  if (!canPlace(new Set(), cell, "1x1"))
    throw new Error("That space is occupied or outside the grid.");
  const widget = item.kind === "widget"
    ? layout.widgets.find((w) => w.id === item.id)
    : null;
  if (item.kind === "widget" && !widget)
    throw new Error("Desktop item not found.");
  const dims = widget ? WIDGET_SIZES[widget.size] : { rows: 1, cols: 1 };
  return moveDesktopItem(layout, item, {
    ...cell,
    row: Math.min(cell.row, GRID_ROWS - dims.rows + 1),
    col: Math.min(cell.col, GRID_COLS - dims.cols + 1),
  });
}

// Interactive moves never silently displace another item or overflow the grid.
export function moveDesktopItem(
  layout: DesktopLayout,
  item: DesktopItem,
  target: GridPosition,
  size?: WidgetSize,
): DesktopLayout {
  const existing =
    item.kind === "app"
      ? layout.iconLayout.find((a) => a.id === item.id)
      : layout.widgets.find((w) => w.id === item.id);
  if (!existing) throw new Error("Desktop item not found.");
  const nextSize =
    item.kind === "app" ? "1x1" : (size ?? (existing as WidgetInstance).size);
  if (
    item.kind === "widget" &&
    !WIDGET_REGISTRY[(existing as WidgetInstance).type].sizes.includes(
      nextSize as WidgetSize,
    )
  )
    throw new Error("Unsupported widget size.");
  if (
    target.page > layout.pageCount ||
    !canPlace(buildOccupancy(layout, item), target, nextSize)
  )
    throw new Error("That space is occupied or outside the grid.");
  return {
    ...layout,
    iconLayout: layout.iconLayout.map((a) =>
      item.kind === "app" && a.id === item.id ? { ...a, ...target } : a,
    ),
    widgets: layout.widgets.map((w) =>
      item.kind === "widget" && w.id === item.id
        ? { ...w, ...target, size: nextSize as WidgetSize }
        : w,
    ),
  };
}

export function reverseAppPositions(layout: DesktopLayout): AppPosition[] {
  const slots = layout.iconLayout
    .map(({ page, row, col }) => ({ page, row, col }))
    .reverse();
  return layout.iconLayout.map((app, i) => ({ ...app, ...slots[i] }));
}
