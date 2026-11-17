import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Copy } from "../copy";
import { Logo } from "../ui/Logo";
import { ChatWindow, CHAT } from "../ui/ChatWindow";
import { SessionsSide } from "../ui/Sessions";
import { MarkText } from "../ui/Serif";
import { C, P, PAPER_BG, SERIF, easeInOut, prog } from "../ui/theme";

export const INTRO_WIN = { x: 660, y: 140, s: 0.4 };
const TARGET = { x: 960, y: INTRO_WIN.y + (CHAT.h * INTRO_WIN.s) / 2 };

const WINS = [
  { x: 60, y: 60, w: 400, h: 250, r: -6, o: 0.26 },
  { x: 1430, y: 40, w: 380, h: 240, r: 5, o: 0.2 },
  { x: -40, y: 400, w: 360, h: 230, r: 4, o: 0.22 },
  { x: 1570, y: 340, w: 400, h: 250, r: -4, o: 0.26 },
  { x: 120, y: 770, w: 420, h: 260, r: -3, o: 0.2 },
  { x: 1390, y: 760, w: 400, h: 250, r: 6, o: 0.24 },
  { x: 560, y: -110, w: 380, h: 240, r: -3, o: 0.16 },
  { x: 880, y: 920, w: 420, h: 240, r: 3, o: 0.16 },
];
const GATHER = 150;

const Scatter: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <>
      {WINS.map((w, i) => {
        const appear = prog(f, 6 + i * 3, 50 + i * 3);
        const g = prog(f, GATHER + i * 4, GATHER + i * 4 + 46, easeInOut);
        const fade = 1 - prog(f, 206, 240);
        const drift = 1 - g;
        const dx = Math.sin(f / 70 + i * 1.7) * 7 * drift;
        const dy = Math.cos(f / 85 + i) * 6 * drift;
        const rot = (w.r + Math.sin(f / 120 + i) * 0.6) * (1 - g);
        const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
        const tx = (TARGET.x + (i - 4) * 4 - cx) * g;
        const ty = (TARGET.y + (i - 4) * 3 - cy) * g;
        const sc = 1 - g * 0.25;
        const op = (w.o + g * (0.5 - w.o)) * appear * fade;
        return (
          <div
            key={i}
            style={{
              position: "absolute", left: w.x, top: w.y, width: w.w, height: w.h, borderRadius: 14, background: C.bg, border: `1px solid ${C.line}`,
              opacity: op, filter: `blur(${2 * (1 - g)}px) saturate(0.4)`, transform: `translate(${dx + tx}px, ${dy + ty}px) rotate(${rot}deg) scale(${sc})`,
              boxShadow: "0 30px 60px rgba(60,40,15,0.25)", overflow: "hidden",
            }}
          >
            <div style={{ height: 38, background: C.topbar, display: "flex", alignItems: "center", gap: 8, padding: "0 14px" }}>
              {[0, 1, 2].map((k) => (<span key={k} style={{ width: 10, height: 10, borderRadius: 5, background: C.mute }} />))}
            </div>
            <div style={{ padding: "22px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
              {[0.8, 0.55, 0.7, 0.4].map((p, k) => (<div key={k} style={{ height: 10, borderRadius: 5, background: C.btnLine, width: `${p * 100}%` }} />))}
            </div>
          </div>
        );
      })}
    </>
  );
};

const Line: React.FC<{ text: string; from: number; y: number; fadeOutAt?: number }> = ({ text, from, y, fadeOutAt }) => {
  const f = useCurrentFrame();
  const a = prog(f, from, from + 26) * (fadeOutAt ? 1 - prog(f, fadeOutAt, fadeOutAt + 22) : 1);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: y, textAlign: "center", fontFamily: SERIF, fontSize: 68, letterSpacing: -1.2, color: P.ink, opacity: a, transform: `translateY(${(1 - prog(f, from, from + 34)) * 14}px)` }}>{text}</div>
  );
};

export const IntroScene: React.FC<{ t: Copy }> = ({ t }) => {
  const f = useCurrentFrame();
  const win = prog(f, 196, 238);
  const head = prog(f, 214, 246);
  const logo = prog(f, 240, 268);
  return (
    <AbsoluteFill style={{ background: PAPER_BG }}>
      <Scatter />
      <Line text={t.intro.q1} from={20} y={380} fadeOutAt={138} />
      <Line text={t.intro.q2} from={62} y={490} fadeOutAt={138} />
      <Line text={t.intro.q3} from={104} y={600} fadeOutAt={138} />
      <div style={{ position: "absolute", inset: 0, opacity: win, transform: `translate(${INTRO_WIN.x}px, ${INTRO_WIN.y}px) scale(${INTRO_WIN.s})`, transformOrigin: "0 0" }}>
        <ChatWindow name={t.ui.termName} cwd={t.ui.termCwd} side={<SessionsSide t={t} />} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 500, opacity: head, transform: `translateY(${(1 - head) * 14}px)` }}>
        <MarkText text={t.intro.gather} mark={t.intro.gatherMark} size={76} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 680, display: "flex", justifyContent: "center", alignItems: "center", gap: 20, opacity: logo }}>
        <Logo size={72} animate={false} />
        <span style={{ fontFamily: SERIF, fontSize: 64, color: P.ink, letterSpacing: -1.2 }}>{t.title.name}</span>
      </div>
    </AbsoluteFill>
  );
};
