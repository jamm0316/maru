import React from "react";
import { useCurrentFrame } from "remotion";
import { C } from "./theme";

/** Typed user prompt. Name part (`tint`) is accent-coloured; brief pause after the first comma. */
export const PromptLine: React.FC<{ text: string; tint: string; start: number; cpf?: number; pause?: number; caretAlways?: boolean; style?: React.CSSProperties }> = ({
  text, tint, start, cpf = 0.7, pause = 9, caretAlways, style,
}) => {
  const f = useCurrentFrame();
  const el = Math.max(0, f - start);
  const commaEnd = text.indexOf(",") + 1;
  let chars = el * cpf;
  if (commaEnd > 0 && chars > commaEnd) chars = commaEnd + Math.max(0, el - commaEnd / cpf - pause) * cpf;
  const n = Math.max(0, Math.min(text.length, Math.floor(chars)));
  const i0 = tint ? text.indexOf(tint) : -1;
  const a = i0 >= 0 ? Math.min(n, i0) : n;
  const b = i0 >= 0 ? Math.min(n, i0 + tint.length) : n;
  const typing = f >= start && n < text.length;
  const caret = f >= start && (caretAlways || typing);
  const blink = typing ? 1 : Math.floor(f / 8) % 2 === 0 ? 1 : 0.15;
  return (
    <span style={style}>
      {text.slice(0, a)}
      <span style={{ color: C.or, fontWeight: 600 }}>{text.slice(a, b)}</span>
      {text.slice(b, n)}
      {caret && <span style={{ display: "inline-block", width: "0.5em", height: "1em", marginLeft: 3, verticalAlign: "-0.12em", background: C.or, opacity: blink }} />}
    </span>
  );
};
