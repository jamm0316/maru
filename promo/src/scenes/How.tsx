import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { Copy } from "../copy";
import { Caption } from "../ui/Caption";
import { CHAT } from "../ui/ChatWindow";
import { ThreadConversation, WIN_POS } from "./Thread";
import { C, FONT, MONO, P, PAPER_BG, SERIF, easeInOut, prog } from "../ui/theme";

const X0 = 800, LW = 760, LH = 124;
const YS = [150, 336, 522];
const DOT_X = X0 + 44;
const cy = (i: number) => YS[i] + LH / 2;

const Moon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill={P.or} /></svg>
);

export const HowScene: React.FC<{ t: Copy }> = ({ t }) => {
  const f = useCurrentFrame();
  // window: centred full-size -> left, small
  const m = prog(f, 0, 36, easeInOut);
  const FS = 0.43;
  const s = 1 - (1 - FS) * m;
  const wx = WIN_POS.x + (60 - WIN_POS.x) * m;
  const wy = WIN_POS.y + (260 - WIN_POS.y) * m;
  const layerP = [prog(f, 30, 52), prog(f, 56, 78), prog(f, 82, 104)];
  const lineP = [prog(f, 44, 66), prog(f, 70, 92)];
  // travelling dot
  const d1 = prog(f, 92, 112, easeInOut);
  const d2 = prog(f, 130, 150, easeInOut);
  const dotY = f < 130 ? cy(0) + (cy(1) - cy(0)) * d1 : cy(1) + (cy(2) - cy(1)) * d2;
  const dotO = prog(f, 84, 96) ;
  const moonP = prog(f, 112, 126);
  const chipsP = prog(f, 118, 132);
  const merge = prog(f, 136, 154, easeInOut);
  const glow = f >= 150 ? Math.max(0, 1 - (f - 150) / 14) : 0;
  const chip = (dy: number, fade: number) => (
    <div style={{ position: "absolute", right: 24, top: LH / 2 - 22 + dy, height: 44, padding: "0 20px", display: "flex", alignItems: "center", borderRadius: 10, background: P.chip, border: `1px solid ${P.line}`, fontFamily: FONT, fontSize: 24, color: P.ink, opacity: chipsP * fade, boxShadow: glow > 0 ? `0 0 ${34 * glow}px rgba(255,138,42,${0.8 * glow})` : "none" }}>{t.how.chip}</div>
  );
  return (
    <AbsoluteFill style={{ background: PAPER_BG }}>
      <div style={{ position: "absolute", inset: 0, transform: `translate(${wx}px, ${wy}px) scale(${s})`, transformOrigin: "0 0" }}>
        <Sequence from={-400}><ThreadConversation t={t} /></Sequence>
      </div>
      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
        {[0, 1].map((i) => (
          <line key={i} x1={DOT_X} y1={YS[i] + LH} x2={DOT_X} y2={YS[i] + LH + (YS[i + 1] - YS[i] - LH) * lineP[i]} stroke={P.mute} strokeOpacity={0.55} strokeWidth={2} />
        ))}
      </svg>
      {t.how.layers.map((l, i) => (
        <div
          key={i}
          style={{
            position: "absolute", left: X0, top: YS[i], width: LW, height: LH, boxSizing: "border-box", background: P.card, border: `1px solid ${P.line}`, borderRadius: 16, boxShadow: "0 18px 40px rgba(60,40,15,0.10)",
            display: "flex", alignItems: "center", paddingLeft: 88, gap: 14, clipPath: `inset(0 ${(1 - layerP[i]) * 100}% 0 0)`, opacity: layerP[i] > 0 ? 1 : 0,
          }}
        >
          <span style={{ position: "absolute", left: 37, top: LH / 2 - 7, width: 14, height: 14, borderRadius: 7, background: P.or }} />
          <span style={{ fontFamily: SERIF, fontSize: 44, color: P.ink, letterSpacing: -0.8 }}>{l.k}</span>
          <span style={{ fontFamily: FONT, fontSize: 30, color: P.mute }}>— {l.v}</span>
          {i === 2 && (
            <>
              {chip(-26, 1)}
              {chip(26 - 26 * merge * 2, 1 - merge)}
            </>
          )}
        </div>
      ))}
      <div style={{ position: "absolute", left: DOT_X - 14, top: dotY - 14, width: 28, height: 28, borderRadius: 14, background: P.or, opacity: dotO, boxShadow: "0 0 24px rgba(255,138,42,.55)" }} />
      <div style={{ position: "absolute", left: 1620, top: 408, width: 260, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, opacity: moonP, transform: `translateY(${(1 - moonP) * 10}px)` }}>
        <Moon size={64} />
        <span style={{ fontFamily: MONO, fontSize: 46, color: P.ink }}>03:30</span>
      </div>
      <Caption text={t.captions.how} mark={t.marks.how} from={24} to={190} />
    </AbsoluteFill>
  );
};
export { C };
