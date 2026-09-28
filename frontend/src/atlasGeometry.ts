import { useLayoutEffect, useRef, useState } from 'react';

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

const overlaps = (a: Box, b: Box, pad = 4) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

/** Ubica etiquetas sin chocar entre sí ni con obstáculos; prueba derecha, izquierda, arriba y abajo. */
export function placeLabels(items: { id: string; x: number; y: number; w: number; h: number; force?: boolean }[], bounds: Box, obstacles: Box[]) {
  const placed = new Map<string, Box>();
  const taken: Box[] = [...obstacles];
  for (const it of items) {
    const tries: Box[] = [
      { x: it.x + 14, y: it.y - it.h / 2, w: it.w, h: it.h },
      { x: it.x - 14 - it.w, y: it.y - it.h / 2, w: it.w, h: it.h },
      { x: it.x - it.w / 2, y: it.y - it.h - 14, w: it.w, h: it.h },
      { x: it.x - it.w / 2, y: it.y + 14, w: it.w, h: it.h },
      { x: it.x + 20, y: it.y - it.h - 8, w: it.w, h: it.h },
      { x: it.x - it.w - 20, y: it.y + 8, w: it.w, h: it.h },
    ];
    const inside = (b: Box) => b.x >= bounds.x && b.y >= bounds.y && b.x + b.w <= bounds.x + bounds.w && b.y + b.h <= bounds.y + bounds.h;
    const fit = tries.find((b) => inside(b) && !taken.some((t) => overlaps(b, t)));
    const chosen = fit || (it.force ? tries.find(inside) : undefined);
    if (chosen) { placed.set(it.id, chosen); taken.push(chosen); }
  }
  return placed;
}

