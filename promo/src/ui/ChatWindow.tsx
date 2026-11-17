import React from "react";
import { C, FONT, MONO, WIN_SHADOW } from "./theme";
import { Logo } from "./Logo";

export const CHAT = { w: 1500, h: 640, side: 400 };

/** Maru window at native size, top-left at (0,0). Position/scale it with a parent transform. */
export const ChatWindow: React.FC<{ name: string; cwd: string; badge?: string; side?: React.ReactNode; children?: React.ReactNode }> = ({ name, cwd, badge, side, children }) => (
  <div style={{ width: CHAT.w, height: CHAT.h, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden", boxShadow: WIN_SHADOW, fontFamily: FONT, color: C.ink, display: "flex", flexDirection: "column", position: "relative" }}>
    <div style={{ height: 64, flex: "none", display: "flex", alignItems: "center", gap: 16, padding: "0 24px", background: C.topbar, borderBottom: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", gap: 9 }}>
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (<span key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c, opacity: 0.85 }} />))}
      </div>
      <Logo size={36} animate={false} tile />
      <span style={{ fontWeight: 700, fontSize: 26, letterSpacing: 4, color: C.or }}>MARU</span>
      {badge && <span style={{ fontSize: 22, fontWeight: 600, color: C.or2, border: `1px solid ${C.or}`, background: C.sel, borderRadius: 999, padding: "2px 16px" }}>{badge}</span>}
      <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 22, color: C.mute }}>{name} {cwd}</span>
    </div>
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <div style={{ flex: 1, padding: "32px 40px", display: "flex", flexDirection: "column", gap: 22 }}>{children}</div>
      {side && <div style={{ width: CHAT.side, flex: "none", borderLeft: `1px solid ${C.line}`, padding: 24, boxSizing: "border-box" }}>{side}</div>}
    </div>
  </div>
);

