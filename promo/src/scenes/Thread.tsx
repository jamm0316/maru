import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Copy } from "../copy";
import { Caption } from "../ui/Caption";
import { ChatWindow, CHAT } from "../ui/ChatWindow";
import { SessionsSide } from "../ui/Sessions";
import { ChatLine } from "../ui/AppParts";
import { PromptLine } from "../ui/PromptLine";
import { C, PAPER_BG, prog } from "../ui/theme";

export const WIN_POS = { x: (1920 - CHAT.w) / 2, y: 100 };

export const ThreadConversation: React.FC<{ t: Copy }> = ({ t }) => {
  const f = useCurrentFrame();
  const card = prog(f, 106, 128);
  return (
    <ChatWindow name={t.ui.termName} cwd={t.ui.termCwd} badge={t.ui.nextDay} side={<SessionsSide t={t} child={1} status="ended" />}>
      <ChatLine user><PromptLine text={t.thread.user} tint={t.thread.tint} start={20} /></ChatLine>
      <div style={{ opacity: card, transform: `translateY(${(1 - card) * 16}px)`, marginLeft: 38, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "22px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div><span style={{ fontSize: 24, color: C.or2, border: `1px solid ${C.btnLine}`, background: C.sel, borderRadius: 999, padding: "4px 18px" }}>{t.thread.chip}</span></div>
        <div style={{ fontSize: 36, color: C.ink, fontWeight: 600, opacity: prog(f, 120, 142) }}>{t.thread.line1}</div>
        <div style={{ fontSize: 28, color: C.mute, opacity: prog(f, 144, 166) }}>{t.thread.line2}</div>
      </div>
    </ChatWindow>
  );
};

export const ThreadScene: React.FC<{ t: Copy }> = ({ t }) => (
  <AbsoluteFill style={{ background: PAPER_BG }}>
    <div style={{ position: "absolute", inset: 0, transform: `translate(${WIN_POS.x}px, ${WIN_POS.y}px)`, transformOrigin: "0 0" }}>
      <ThreadConversation t={t} />
    </div>
    <Caption text={t.captions.thread} mark={t.marks.thread} from={70} to={190} />
  </AbsoluteFill>
);
export { prog };
