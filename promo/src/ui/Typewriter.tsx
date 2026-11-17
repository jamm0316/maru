import React from "react";
import { useCurrentFrame } from "remotion";
import { C } from "./theme";

/** Types `text` starting at local frame `start`, `cpf` characters per frame. */
export const Typewriter: React.FC<{
  text: string;
  start: number;
  cpf?: number;
  caret?: boolean;
  style?: React.CSSProperties;
}> = ({ text, start, cpf = 0.8, caret = true, style }) => {
  const f = useCurrentFrame();
  const n = Math.max(0, Math.min(text.length, Math.floor((f - start) * cpf)));
  const typing = f >= start && n < text.length;
  const blink = Math.floor(f / 8) % 2 === 0;
  return (
    <span style={style}>
      {text.slice(0, n)}
      {caret && (typing || (n === 0 && f >= start)) && (
        <span style={{ display: "inline-block", width: "0.5em", height: "1em", marginLeft: 2, verticalAlign: "-0.12em", background: C.or, opacity: blink ? 1 : 0.2 }} />
      )}
    </span>
  );
};

export const typedDone = (text: string, start: number, cpf = 0.8) => start + Math.ceil(text.length / cpf);
