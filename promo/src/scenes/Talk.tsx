import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Copy } from "../copy";
import { Caption } from "../ui/Caption";
import { ChatWindow, CHAT } from "../ui/ChatWindow";
import { SessionsSide } from "../ui/Sessions";
import { ChatLine } from "../ui/AppParts";
import { PromptLine } from "../ui/PromptLine";
import { Cursor } from "../ui/Cursor";
import { C, FONT, MONO, PAPER_BG, easeInOut, prog } from "../ui/theme";
import { WIN_POS } from "./Thread";
import { INTRO_WIN } from "./Intro";

// Local beat timings (frames)
const ACK = 108;
const CONSENT_IN = 134;
const CURSOR_SHOW: [number, number] = [158, 232];
const CLICK = 208;
const CONSENT_OUT = 214;
const CHILD_IN = 230;
const WORK_END = 278;
const PULSE = 278;
const BADGE = 292;
const REPORT = 302;

// Consent window geometry, native window px
const CW = { w: 700, h: 430 };
const CL = (CHAT.w - CW.w) / 2;
const CT = (CHAT.h - CW.h) / 2 + 10;
const OPEN_BTN = { x: CL + CW.w - 32 - 55, y: CT + CW.h - 32 - 26 };

const Consent: React.FC<{ t: Copy }> = ({ t }) => {
  const f = useCurrentFrame();
  const inP = prog(f, CONSENT_IN, CONSENT_IN + 18);
  const outP = prog(f, CONSENT_OUT, CONSENT_OUT + 14);
  const a = inP * (1 - outP);
  if (a <= 0) return null;
  const pressed = f >= CLICK && f < CLICK + 5;
  const sc = 0.95 + 0.05 * inP + 0.02 * outP;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: CHAT.w, height: CHAT.h, borderRadius: 16, overflow: "hidden", pointerEvents: "none" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(5,3,1,0.55)", opacity: a }} />
      <div style={{ position: "absolute", left: CL, top: CT, width: CW.w, height: CW.h, boxSizing: "border-box", padding: 32, background: C.panel, border: `1px solid ${C.btnLine}`, borderRadius: 16, boxShadow: "0 30px 80px rgba(0,0,0,0.6)", fontFamily: FONT, color: C.ink, display: "flex", flexDirection: "column", opacity: a, transform: `scale(${sc})` }}>
        <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.2 }}>{t.talk.consentTitle}</div>
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontFamily: MONO, fontSize: 22, color: C.mute, whiteSpace: "nowrap" }}>{t.ui.termCwd}</span>
          <span style={{ fontSize: 21, fontWeight: 600, color: C.soft, border: `1px solid ${C.btnLine}`, borderRadius: 999, padding: "3px 16px", whiteSpace: "nowrap" }}>{t.ui.childTitle}</span>
        </div>
        <div style={{ marginTop: 20, fontSize: 20, letterSpacing: 1, color: C.mute, fontWeight: 600 }}>{t.talk.briefLabel}</div>
        <div style={{ marginTop: 8, border: `1px solid ${C.line}`, background: C.bg, borderRadius: 10, padding: "14px 20px", display: "flex", flexDirection: "column", gap: 6, fontSize: 24, lineHeight: 1.3, color: C.soft }}>
          {t.talk.brief.map((l) => (<div key={l} style={{ whiteSpace: "nowrap" }}>{l}</div>))}
        </div>
        <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end", gap: 14 }}>
          <span style={{ height: 52, boxSizing: "border-box", display: "flex", alignItems: "center", fontSize: 24, color: C.soft, border: `1px solid ${C.btnLine}`, borderRadius: 10, padding: "0 26px", whiteSpace: "nowrap" }}>{t.talk.cancel}</span>
          <span style={{ width: 110, height: 52, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, color: C.onOr, background: C.or, border: `1px solid ${C.or}`, borderRadius: 10, whiteSpace: "nowrap", transform: pressed ? "scale(0.94)" : "none" }}>{t.talk.open}</span>
        </div>
      </div>
    </div>
  );
};

export const TalkScene: React.FC<{ t: Copy }> = ({ t }) => {
  const f = useCurrentFrame();
  const g = prog(f, 0, 40, easeInOut);
  const x = INTRO_WIN.x + (WIN_POS.x - INTRO_WIN.x) * g;
  const y = INTRO_WIN.y + (WIN_POS.y - INTRO_WIN.y) * g;
  const s = INTRO_WIN.s + (1 - INTRO_WIN.s) * g;
  const ack = prog(f, ACK, ACK + 12);
  const report = prog(f, REPORT, REPORT + 22);
  const child = prog(f, CHILD_IN, CHILD_IN + 18);
  const status = f >= WORK_END ? "ended" : "working";
  const pulse = prog(f, PULSE, PULSE + 20, easeInOut);
  const badge = prog(f, BADGE, BADGE + 14);
  return (
    <AbsoluteFill style={{ background: PAPER_BG }}>
      <div style={{ position: "absolute", inset: 0, transform: `translate(${x}px, ${y}px) scale(${s})`, transformOrigin: "0 0" }}>
        <ChatWindow name={t.ui.termName} cwd={t.ui.termCwd} side={<SessionsSide t={t} child={child} status={status} badge={badge} pulse={f >= PULSE ? pulse : undefined} />}>
          <ChatLine user><PromptLine text={t.talk.user} tint={t.talk.tint} start={30} /></ChatLine>
          <div style={{ opacity: ack }}><ChatLine>{t.talk.ack}</ChatLine></div>
          <div style={{ opacity: report, transform: `translateY(${(1 - report) * 14}px)`, marginLeft: 38, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "20px 26px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div><span style={{ fontSize: 22, color: C.or2, border: `1px solid ${C.btnLine}`, background: C.sel, borderRadius: 999, padding: "3px 16px", whiteSpace: "nowrap" }}>{t.talk.reportChip}</span></div>
            <div style={{ fontSize: 30, color: C.ink, fontWeight: 600 }}>{t.talk.reply1}</div>
            <div style={{ fontSize: 28, color: C.or2 }}>{t.talk.reply2}</div>
          </div>
        </ChatWindow>
        <Consent t={t} />
        <Cursor
          keys={[{ f: CURSOR_SHOW[0], x: OPEN_BTN.x + 230, y: OPEN_BTN.y + 120 }, { f: 198, x: OPEN_BTN.x + 34, y: OPEN_BTN.y + 16 }]}
          clicks={[CLICK]}
          show={CURSOR_SHOW}
        />
      </div>
      <Caption text={t.captions.consent} mark={t.marks.consent} from={CONSENT_IN - 6} to={CONSENT_OUT + 12} />
      <Caption text={t.captions.talk} mark={t.marks.talk} from={CONSENT_OUT + 20} to={360} />
    </AbsoluteFill>
  );
};
