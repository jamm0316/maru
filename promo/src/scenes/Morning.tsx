import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Copy } from "../copy";
import { Caption } from "../ui/Caption";
import { AppWindow } from "../ui/Window";
import { Card, Dot, Row } from "../ui/Panel";
import { InboxCard } from "../ui/AppParts";
import { SessionsList } from "../ui/Sessions";
import { C, PAPER_BG, prog } from "../ui/theme";

const Fade: React.FC<{ at: number; children: React.ReactNode }> = ({ at, children }) => {
  const f = useCurrentFrame();
  const p = prog(f, at, at + 16);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 10}px)` }}>{children}</div>;
};

export const MorningWindow: React.FC<{ t: Copy }> = ({ t }) => {
  const f = useCurrentFrame();
  return (
    <AppWindow
      brandSub={t.ui.brandSub} day={t.ui.dayLabel(2)} termName={t.ui.termName} termCwd={t.ui.termCwd}
      left={
        <>
          <Card title={t.ui.todayTodos}>
            <Fade at={14}><Row active style={{ alignItems: "flex-start" }}><span style={{ marginTop: 7 }}><Dot color={C.or} /></span><span style={{ lineHeight: 1.25 }}>{t.ui.todo1}</span></Row></Fade>
            <Fade at={26}><Row><Dot />{t.ui.todo2}</Row></Fade>
          </Card>
          <Card title={t.ui.projects}>
            <Fade at={38}><Row active><Dot color={C.or} />{t.ui.proj1}</Row></Fade>
            <Fade at={50}><Row><Dot />{t.ui.proj2}</Row></Fade>
          </Card>
        </>
      }
      centre={
        <Card title={t.morning.journal} right={<span style={{ fontSize: 22, color: C.or2, opacity: prog(f, 84, 100) }}>{t.morning.written}</span>} style={{ margin: "4px 0" }}>
          <Fade at={62}><div style={{ fontSize: 28, color: C.ink, lineHeight: 1.35 }}>{t.morning.j1}</div></Fade>
          <Fade at={74}><div style={{ fontSize: 28, color: C.soft, lineHeight: 1.35 }}>{t.morning.j2}</div></Fade>
        </Card>
      }
      right={
        <>
          <Card title={t.ui.sessions}>
            <Fade at={90}><SessionsList t={t} child={1} status="ended" /></Fade>
          </Card>
          <InboxCard t={t} itemP={prog(f, 106, 126)} />
        </>
      }
    />
  );
};

export const MorningScene: React.FC<{ t: Copy }> = ({ t }) => (
  <AbsoluteFill style={{ background: PAPER_BG }}>
    <div style={{ position: "absolute", inset: 0, transform: "translate(115px, 6px) scale(0.88)", transformOrigin: "0 0" }}>
      <MorningWindow t={t} />
    </div>
    <Caption text={t.captions.morning} mark={t.marks.morning} from={18} to={160} />
  </AbsoluteFill>
);
