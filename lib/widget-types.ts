export const WIDGET_SIZES = {
  "2x2": { cols: 2, rows: 2 },
  "4x2": { cols: 4, rows: 2 },
} as const;

export type WidgetSize = keyof typeof WIDGET_SIZES;
export type WidgetType = "clock" | "here-there";
export type WidgetComment = { characterId: string; text: string; generatedAt: string };
export type WidgetConfig = { hour12: boolean; showSeconds: boolean; characterId?: string; comment?: WidgetComment };
export type WidgetInstance = {
  id: string;
  type: WidgetType;
  size: WidgetSize;
  page: number;
  row: number;
  col: number;
  config: WidgetConfig;
};
