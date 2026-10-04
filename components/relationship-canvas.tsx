"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "./profile-view";
import { FOUNDATION_COPY as C } from "../lib/foundation-copy";
import { UI_COPY as U } from "../lib/ui-copy";
import type { FoundationDocument, NodePosition } from "../lib/foundation-types";

type View = { x: number; y: number; scale: number };
function fitPositions(
  points: Record<string, NodePosition>,
  width: number,
  height: number,
): View {
  const values = Object.values(points);
  if (!values.length) return { x: 0, y: 0, scale: 1 };
  const minX = Math.min(...values.map((p) => p.x)),
    minY = Math.min(...values.map((p) => p.y));
  const w = Math.max(...values.map((p) => p.x + 168)) - minX,
    h = Math.max(...values.map((p) => p.y + 72)) - minY;
  const scale = Math.max(
    0.05,
    Math.min(1, (width - 40) / w, (height - 60) / h),
  );
  return {
    x: (width - w * scale) / 2 - minX * scale,
    y: (height - h * scale) / 2 - minY * scale,
    scale,
  };
}
export function RelationshipCanvas({
  document,
  move,
  edit,
}: {
  document: FoundationDocument;
  move: (id: string, p: NodePosition) => Promise<void>;
  edit: (id: string) => void;
}) {
  const router = useRouter(),
    viewport = useRef<HTMLDivElement>(null),
    touched = useRef(false);
  const [initialPositions] = useState(document.universe.nodePositions);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 }),
    [preview, setPreview] = useState<Record<string, NodePosition>>({});
  const drag = useRef<{
      pointer: number;
      id: string | null;
      x: number;
      y: number;
      point: NodePosition;
      latest: NodePosition;
      moved: boolean;
    } | null>(null),
    suppress = useRef(false);
  const positions = { ...document.universe.nodePositions, ...preview };
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (!touched.current)
        setView(
          fitPositions(
            initialPositions,
            element.clientWidth,
            element.clientHeight,
          ),
        );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [initialPositions]);
  function fit() {
    if (viewport.current) {
      touched.current = false;
      setView(
        fitPositions(
          positions,
          viewport.current.clientWidth,
          viewport.current.clientHeight,
        ),
      );
    }
  }
  return (
    <div className="canvas-section">
      <div
        ref={viewport}
        className="relationship-viewport"
        aria-label={C.universe.canvas}
        tabIndex={0}
        onPointerDown={(event) => {
          if (
            !event.isPrimary ||
            event.button !== 0 ||
            (event.target as HTMLElement).closest("button")
          )
            return;
          event.currentTarget.setPointerCapture(event.pointerId);
          touched.current = true;
          drag.current = {
            pointer: event.pointerId,
            id: null,
            x: event.clientX,
            y: event.clientY,
            point: { x: view.x, y: view.y },
            latest: { x: view.x, y: view.y },
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          if (!d || d.pointer !== event.pointerId) return;
          const dx = event.clientX - d.x,
            dy = event.clientY - d.y;
          if (Math.hypot(dx, dy) > 5) d.moved = true;
          if (!d.moved) return;
          touched.current = true;
          if (d.id) {
            d.latest = {
              x: Math.max(0, Math.min(5000, d.point.x + dx / view.scale)),
              y: Math.max(0, Math.min(5000, d.point.y + dy / view.scale)),
            };
            setPreview({ [d.id]: d.latest });
          } else setView({ ...view, x: d.point.x + dx, y: d.point.y + dy });
        }}
        onPointerUp={(event) => {
          const d = drag.current;
          if (!d || d.pointer !== event.pointerId) return;
          drag.current = null;
          if (d.id) {
            suppress.current = d.moved;
            if (d.moved)
              void move(d.id, d.latest).finally(() => setPreview({}));
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
          suppress.current = true;
          setPreview({});
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const directions: Record<string, [number, number]> = {
            ArrowLeft: [30, 0],
            ArrowRight: [-30, 0],
            ArrowUp: [0, 30],
            ArrowDown: [0, -30],
          };
          const vector = directions[event.key];
          if (vector) {
            event.preventDefault();
            touched.current = true;
            setView({ ...view, x: view.x + vector[0], y: view.y + vector[1] });
          }
        }}
      >
        <div
          className="relationship-canvas"
          style={{
            transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`,
            width: Math.max(
              640,
              ...Object.values(positions).map((p) => p.x + 200),
            ),
            height: Math.max(
              400,
              ...Object.values(positions).map((p) => p.y + 120),
            ),
          }}
        >
          <svg width="100%" height="100%" aria-hidden="true">
            {document.universe.relations.map((r) => {
              const a = positions[r.characterAId],
                b = positions[r.characterBId];
              return (
                <line
                  key={r.id}
                  x1={a.x + 84}
                  y1={a.y + 36}
                  x2={b.x + 84}
                  y2={b.y + 36}
                />
              );
            })}
          </svg>
          {document.universe.relations.map((r) => {
            const a = positions[r.characterAId],
              b = positions[r.characterBId];
            return (
              <button
                className="relationship-label"
                key={r.id}
                style={{
                  left: (a.x + b.x) / 2 + 84,
                  top: (a.y + b.y) / 2 + 36,
                }}
                onClick={() => edit(r.id)}
              >
                {r.label}
              </button>
            );
          })}
          {document.characters.map((c) => {
            const p = positions[c.characterId];
            return (
              <button
                className="character-node"
                key={c.characterId}
                style={{ left: p.x, top: p.y }}
                onPointerDown={(event) => {
                  if (!event.isPrimary || event.button !== 0) return;
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  suppress.current = false;
                  drag.current = {
                    pointer: event.pointerId,
                    id: c.characterId,
                    x: event.clientX,
                    y: event.clientY,
                    point: p,
                    latest: p,
                    moved: false,
                  };
                }}
                onClick={() => {
                  if (suppress.current) {
                    suppress.current = false;
                    return;
                  }
                  router.push(`/characters/${c.characterId}`);
                }}
                onKeyDown={(event) => {
                  const directions: Record<string, [number, number]> = {
                    ArrowLeft: [-10, 0],
                    ArrowRight: [10, 0],
                    ArrowUp: [0, -10],
                    ArrowDown: [0, 10],
                  };
                  const vector = directions[event.key];
                  if (vector) {
                    event.preventDefault();
                    event.stopPropagation();
                    void move(c.characterId, {
                      x: p.x + vector[0],
                      y: p.y + vector[1],
                    });
                  }
                }}
              >
                <Avatar avatar={c.avatar} name={c.name} />
                <span>{c.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="canvas-footer">
        <button className="text-button" onClick={fit}>
          {U.fit}
        </button>
      </div>
    </div>
  );
}
