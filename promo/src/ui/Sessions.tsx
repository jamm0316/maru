import React from "react";
import { useCurrentFrame } from "remotion";
import { C } from "./theme";
import { Copy } from "../copy";

export type SessionsState = {
  /** 0..1 — child row appears (and connector draws). 0 = no child (Maru row only). */
  child?: number;
  /** child status: "working" (animated dot) or "ended" */
  status?: "working" | "ended";
  /** 0..1 — "Report 1" badge pops onto the Maru row. */
  badge?: number;
  /** 0..1 — pulse travelling from child row up to Maru. Negative/undefined = none. */
  pulse?: number;
};

// Geometry inside the list (px)
const MARU_H = 60;
const CHILD_TOP = MARU_H + 18;
const CHILD_H = 56;
const CHILD_X = 40;
const LINE_X = 24;
export const LIST_H = CHILD_TOP + CHILD_H;

/** Maru (lead) row with an indented child session row and a thin connector. */
export const SessionsList: React.FC<{ t: Copy } & SessionsState> = ({ t, child = 0, status = "ended", badge = 0, pulse }) => {
  const f = useCurrentFrame();
  const working = status === "working";
  const midY = CHILD_TOP + CHILD_H / 2;
  const connLen = midY - MARU_H + (CHILD_X - LINE_X);
  const draw = Math.min(1, child * 1.4);
  const glow = working ? 0.2 + 0.18 * Math.sin(f / 3.2) : 0;
  const childCol = working ? C.or : C.mute;
  const pathD = `M ${LINE_X} ${MARU_H} V ${midY} H ${CHILD_X}`;
  const pulseOn = pulse !== undefined && pulse > 0 && pulse < 1;
  return (
    <div style={{ position: "relative", height: LIST_H, width: "100%" }}>
      {/* Maru row */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: MARU_H, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 12, padding: "0 14px", borderRadius: 10, border: `1px solid ${C.or}`, background: C.sel, fontSize: 22, color: C.ink, fontWeight: 600 }}>
        <span style={{ width: 12, height: 12, borderRadius: 6, background: C.or, flex: "none" }} />
        <span style={{ whiteSpace: "nowrap" }}>{t.ui.maruRow}</span>
        {badge > 0 && (
          <span style={{ marginLeft: "auto", fontSize: 19, fontWeight: 700, color: C.onOr, background: C.or, borderRadius: 999, padding: "3px 13px", whiteSpace: "nowrap", opacity: Math.min(1, badge * 2), transform: `scale(${0.6 + 0.4 * badge + 0.18 * Math.sin(Math.PI * badge)})`, transformOrigin: "100% 50%" }}>{t.ui.reportBadge}</span>
        )}
      </div>
      {/* connector */}
      {child > 0 && (
        <svg width={CHILD_X + 8} height={LIST_H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <path d={pathD} fill="none" stroke={C.btnLine} strokeWidth={2} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
          {pulseOn && (
            <path d={pathD} fill="none" stroke={C.or} strokeWidth={3} strokeLinecap="round" pathLength={1} strokeDasharray="0.22 2" strokeDashoffset={0.22 - (1 - pulse!) * 1.22 + 0} style={{ opacity: 1 - Math.max(0, pulse! - 0.85) / 0.15 }} />
          )}
        </svg>
      )}
      {/* child row */}
      {child > 0 && (
        <div style={{ position: "absolute", left: CHILD_X, right: 0, top: CHILD_TOP, height: CHILD_H, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 10, padding: "0 12px", borderRadius: 10, border: `1px solid ${working ? C.or : C.line}`, background: working ? C.sel : "transparent", fontSize: 21, color: working ? C.ink : C.soft, opacity: child, transform: `translateX(${(1 - child) * 14}px)` }}>
          <span style={{ width: 12, height: 12, borderRadius: 6, background: childCol, flex: "none", boxShadow: working ? `0 0 0 ${3 + 4 * glow * 3}px rgba(255,138,42,${glow})` : "none" }} />
          <span style={{ whiteSpace: "nowrap" }}>{t.ui.childTitle}</span>
          <span style={{ marginLeft: "auto", fontSize: 19, color: working ? C.or2 : C.mute, whiteSpace: "nowrap" }}>{working ? t.ui.working : t.ui.turnEnded}</span>
        </div>
      )}
    </div>
  );
};

export const SessionsSide: React.FC<{ t: Copy } & SessionsState> = ({ t, ...st }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    <div style={{ height: 30, fontSize: 22, letterSpacing: 1, color: C.mute, fontWeight: 600 }}>{t.ui.sessions}</div>
    <SessionsList t={t} {...st} />
  </div>
);
