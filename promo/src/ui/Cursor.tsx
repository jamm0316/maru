import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { C, easeInOut } from "./theme";

export type CursorKey = { f: number; x: number; y: number };

/** Moves through keyframes with ease-in-out; `clicks` = local frames where a ripple plays. */
export const Cursor: React.FC<{ keys: CursorKey[]; clicks?: number[]; show?: [number, number] }> = ({ keys, clicks = [], show }) => {
  const f = useCurrentFrame();
  let x = keys[0].x, y = keys[0].y;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (f >= a.f && f <= b.f) {
      const t = interpolate(f, [a.f, b.f], [0, 1], { easing: easeInOut });
      x = a.x + (b.x - a.x) * t;
      y = a.y + (b.y - a.y) * t;
    } else if (f > b.f) {
      x = b.x; y = b.y;
    }
  }
  const vis = show ? interpolate(f, [show[0], show[0] + 8, show[1] - 8, show[1]], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const press = clicks.some((c) => f >= c && f < c + 5) ? 0.88 : 1;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", opacity: vis }}>
      {clicks.map((c, i) => {
        const t = (f - c) / 22;
        if (t < 0 || t > 1) return null;
        const ck = keys.filter((k) => k.f <= c).pop()!;
        return (
          <div key={i} style={{ position: "absolute", left: ck.x - 40, top: ck.y - 40, width: 80, height: 80, borderRadius: 40, border: `4px solid ${C.or2}`, opacity: 1 - t, transform: `scale(${0.3 + t * 1.1})` }} />
        );
      })}
      <svg width="44" height="52" viewBox="0 0 22 26" style={{ position: "absolute", left: x - 3, top: y - 2, transform: `scale(${press})`, transformOrigin: "3px 2px", filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.6))" }}>
        <path d="M3 2 L3 20 L8 15.5 L11.5 23 L14.5 21.7 L11 14.5 L18 14.5 Z" fill="#fff" stroke="#111" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </div>
  );
};
