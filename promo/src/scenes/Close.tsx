import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Copy } from "../copy";
import { Logo } from "../ui/Logo";
import { MarkText } from "../ui/Serif";
import { PromptLine } from "../ui/PromptLine";
import { C, FONT, MONO, P, PAPER_BG, SERIF, WIN_SHADOW, prog } from "../ui/theme";

export const CloseScene: React.FC<{ t: Copy }> = ({ t }) => {
  const f = useCurrentFrame();
  const a = prog(f, 4, 34);
  const b = prog(f, 30, 64);
  const bar = prog(f, 86, 106);
  const sub = prog(f, 66, 90);
  return (
    <AbsoluteFill style={{ background: PAPER_BG, alignItems: "center", flexDirection: "column", justifyContent: "flex-start", paddingTop: 150 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24, opacity: a, transform: `translateY(${(1 - a) * 10}px)` }}>
        <Logo size={92} animate={false} />
        <span style={{ fontFamily: SERIF, fontSize: 80, color: P.ink, letterSpacing: -1.6 }}>{t.title.name}</span>
      </div>
      <div style={{ marginTop: 56, opacity: b, transform: `translateY(${(1 - b) * 14}px)` }}>
        <MarkText text={t.close.line} mark={t.close.mark} size={100} />
      </div>
      <div style={{ marginTop: 70, opacity: bar, transform: `translateY(${(1 - bar) * 10}px)`, width: 860, height: 104, boxSizing: "border-box", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 16, boxShadow: WIN_SHADOW, display: "flex", alignItems: "center", padding: "0 36px", fontFamily: MONO, fontSize: 46, color: C.ink }}>
        <span style={{ color: C.or, marginRight: 22 }}>❯</span>
        <PromptLine text={t.close.prompt} tint={t.close.tint} start={108} cpf={0.3} caretAlways />
      </div>
      <div style={{ position: "absolute", bottom: 70, left: 0, right: 0, textAlign: "center", fontFamily: FONT, fontSize: 32, color: P.mute, opacity: sub }}>{t.close.sub}</div>
    </AbsoluteFill>
  );
};
