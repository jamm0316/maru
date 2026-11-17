import React from "react";
import { C, FONT, WIN_SHADOW } from "./theme";
import { Logo } from "./Logo";
import { Pill } from "./Panel";

// Window geometry in screen px (1920x1080 canvas).
export const WIN = { x: 40, y: 36, w: 1840, h: 840, top: 68, left: 440, right: 520 };

/** Simplified Maru layout: top bar, left panel, centre terminal, right panel. */
export const AppWindow: React.FC<{
  brandSub: string;
  day: string;
  termName: string;
  termCwd: string;
  termRight?: React.ReactNode;
  left: React.ReactNode;
  centre: React.ReactNode;
  right: React.ReactNode;
}> = ({ brandSub, day, termName, termCwd, termRight, left, centre, right }) => (
  <div
    style={{
      position: "absolute", left: WIN.x, top: WIN.y, width: WIN.w, height: WIN.h, background: C.bg, border: `1px solid ${C.line}`,
      borderRadius: 16, overflow: "hidden", fontFamily: FONT, color: C.ink, boxShadow: WIN_SHADOW, display: "flex", flexDirection: "column",
    }}
  >
    <div style={{ height: WIN.top, flex: "none", display: "flex", alignItems: "center", gap: 16, padding: "0 24px", background: C.topbar, borderBottom: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", gap: 9 }}>
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
          <span key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c, opacity: 0.85 }} />
        ))}
      </div>
      <Logo size={40} animate={false} tile />
      <span style={{ fontWeight: 700, fontSize: 28, letterSpacing: 4, color: C.or }}>MARU</span>
      <span style={{ fontSize: 22, color: C.mute }}>{brandSub}</span>
      <span style={{ marginLeft: "auto" }}>
        <Pill accent>{day}</Pill>
      </span>
    </div>
    <div style={{ flex: 1, display: "flex", gap: 16, padding: 16, minHeight: 0 }}>
      <div style={{ width: WIN.left - 24, display: "flex", flexDirection: "column", gap: 16 }}>{left}</div>
      <div style={{ flex: 1, minWidth: 0, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: `1px solid ${C.line}`, fontFamily: `"SF Mono", Menlo, monospace`, fontSize: 22, color: C.mute }}>
          <span style={{ color: C.or }}>●</span>
          <span>{termName}</span>
          <span>{termCwd}</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>{termRight}<span>claude</span></span>
        </div>
        <div style={{ flex: 1, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>{centre}</div>
      </div>
      <div style={{ width: WIN.right - 24, display: "flex", flexDirection: "column", gap: 16 }}>{right}</div>
    </div>
  </div>
);
