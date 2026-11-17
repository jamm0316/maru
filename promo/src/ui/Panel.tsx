import React from "react";
import { C } from "./theme";

export const Card: React.FC<{ title?: string; right?: React.ReactNode; children?: React.ReactNode; style?: React.CSSProperties }> = ({ title, right, children, style }) => (
  <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, ...style }}>
    {title && (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 22, letterSpacing: 1, color: C.mute, fontWeight: 600 }}>{title}</span>
        {right}
      </div>
    )}
    {children}
  </div>
);

export const Row: React.FC<{ children: React.ReactNode; active?: boolean; style?: React.CSSProperties }> = ({ children, active, style }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 50, padding: "8px 14px", borderRadius: 10, border: `1px solid ${active ? C.or : C.line}`, background: active ? C.sel : "transparent", fontSize: 22, color: C.ink, ...style }}>
    {children}
  </div>
);

export const Dot: React.FC<{ color?: string; glow?: boolean }> = ({ color = C.mute, glow }) => (
  <span style={{ width: 12, height: 12, borderRadius: 6, background: color, flex: "none", boxShadow: glow ? `0 0 0 5px rgba(255,138,42,.25)` : undefined }} />
);

export const Pill: React.FC<{ children: React.ReactNode; ok?: boolean; accent?: boolean; style?: React.CSSProperties }> = ({ children, ok, accent, style }) => (
  <span
    style={{
      fontSize: 22, fontWeight: 600, borderRadius: 999, padding: "3px 16px", whiteSpace: "nowrap", border: `1px solid ${ok ? C.okLine : accent ? C.or : C.line}`,
      color: ok ? C.ok : accent ? C.or2 : C.mute, background: ok ? C.okBg : accent ? C.sel : "transparent", ...style,
    }}
  >
    {children}
  </span>
);
