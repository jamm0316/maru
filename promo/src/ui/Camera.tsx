import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { easeInOut } from "./theme";

/** Slow push-in 1→1.04 about the centre over the whole scene. */
export const PushIn: React.FC<{ duration: number; children: React.ReactNode }> = ({ duration, children }) => {
  const f = useCurrentFrame();
  const s = interpolate(f, [0, duration], [1, 1.04], { extrapolateRight: "clamp" });
  return <div style={{ position: "absolute", inset: 0, transform: `scale(${s})`, transformOrigin: "50% 50%" }}>{children}</div>;
};

/** Camera that glides from full view to a zoom focused on screen point (cx,cy) landing at (tx,ty). */
export const FocusZoom: React.FC<{ from: number; to: number; scale: number; cx: number; cy: number; tx: number; ty: number; children: React.ReactNode }> = ({ from, to, scale, cx, cy, tx, ty, children }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeInOut });
  const s = 1 + (scale - 1) * p;
  const x = (tx - scale * cx) * p;
  const y = (ty - scale * cy) * p;
  return <div style={{ position: "absolute", inset: 0, transform: `translate(${x}px, ${y}px) scale(${s})`, transformOrigin: "0 0" }}>{children}</div>;
};
