import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { C, easeOut } from "./theme";

// Shapes from app/lib.js LOGO (135 tile): ring r40 w6, dashed ring r24 w2 (4 5), dot r10.
export const Logo: React.FC<{ size: number; start?: number; animate?: boolean; tile?: boolean }> = ({
  tile: showTile = false,
  size,
  start = 0,
  animate = true,
}) => {
  const f = useCurrentFrame() - start;
  const p = (a: number, b: number) =>
    animate
      ? interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut })
      : 1;
  const ringLen = 2 * Math.PI * 40;
  const tile = p(0, 14);
  const ring = p(4, 34);
  const dash = p(22, 44);
  const dot = p(34, 54);
  const rot = animate ? f * 0.6 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 135 135" style={{ opacity: tile, transform: `scale(${0.9 + 0.1 * tile})` }}>
      {showTile && <rect width="135" height="135" rx="30.1" fill="#17110B" />}
      <circle
        cx="67.5" cy="67.5" r="40" fill="none" stroke={C.or} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={ringLen} strokeDashoffset={ringLen * (1 - ring)}
        transform="rotate(-90 67.5 67.5)"
      />
      <g opacity={dash} transform={`rotate(${rot} 67.5 67.5)`}>
        <circle cx="67.5" cy="67.5" r="24" fill="none" stroke={C.or} strokeWidth="2" strokeDasharray="4 5" />
      </g>
      <circle cx="67.5" cy="67.5" r={10 * dot} fill={C.or} />
    </svg>
  );
};
