import React from "react";
import { P, SERIF } from "./theme";

/** Serif text on paper; `mark` substring gets a short orange hairline. */
export const MarkText: React.FC<{ text: string; mark?: string; size: number; style?: React.CSSProperties }> = ({ text, mark, size, style }) => {
  const i = mark ? text.indexOf(mark) : -1;
  return (
    <div style={{ fontFamily: SERIF, fontSize: size, color: P.ink, letterSpacing: -size * 0.02, lineHeight: 1.15, textAlign: "center", ...style }}>
      {i >= 0 && mark ? (
        <>
          {text.slice(0, i)}
          <span style={{ borderBottom: `${Math.max(3, size / 22)}px solid ${P.or}`, paddingBottom: 3 }}>{mark}</span>
          {text.slice(i + mark.length)}
        </>
      ) : text}
    </div>
  );
};
