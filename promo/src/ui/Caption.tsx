import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { P, SERIF, easeOut } from "./theme";

/** Editorial serif line set on the paper. `mark` (a substring) gets a short orange hairline. */
export const Caption: React.FC<{ text: string; from: number; to: number; mark?: string; bottom?: number }> = ({ text, from, to, mark, bottom = 110 }) => {
  const f = useCurrentFrame();
  const a = interpolate(f, [from, from + 22, to - 18, to], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(f, [from, from + 26], [14, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut });
  const i = mark ? text.indexOf(mark) : -1;
  const parts = i >= 0 && mark ? [text.slice(0, i), mark, text.slice(i + mark.length)] : [text];
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom, display: "flex", justifyContent: "center", opacity: a, transform: `translateY(${y}px)`, pointerEvents: "none" }}>
      <div style={{ fontFamily: SERIF, fontSize: 60, fontWeight: 400, color: P.ink, letterSpacing: -1, lineHeight: 1.2, maxWidth: 1760, textAlign: "center" }}>
        {parts.length === 3 ? (
          <>
            {parts[0]}
            <span style={{ borderBottom: `4px solid ${P.or}`, paddingBottom: 2 }}>{parts[1]}</span>
            {parts[2]}
          </>
        ) : text}
      </div>
    </div>
  );
};
