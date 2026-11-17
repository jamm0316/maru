import React from "react";
import { C } from "./theme";
import { Card, Pill } from "./Panel";
import { Copy } from "../copy";

export const InboxCard: React.FC<{ t: Copy; itemP: number; installed?: boolean; installedP?: number; approvePressed?: boolean }> = ({ t, itemP, installed, installedP = 0, approvePressed }) => (
  <Card title={t.ui.inbox} right={<span style={{ fontSize: 22, color: C.mute }}>{installed ? "" : itemP > 0 ? t.ui.pendingApproval : ""}</span>} style={{ flex: 1 }}>
    {itemP === 0 ? (
      <span style={{ fontSize: 22, color: C.mute }}>{t.ui.inboxEmpty}</span>
    ) : (
      <div
        style={{
          opacity: itemP, transform: `translateX(${(1 - itemP) * 60}px)`, border: `1px solid ${installed ? C.okLine : C.or}`, background: installed ? C.okBg : C.sel,
          borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12,
        }}
      >
        <div><Pill accent={!installed} ok={installed}>{installed ? t.ui.installed : t.inbox.kind}</Pill></div>
        <div style={{ fontSize: 30, fontWeight: 700, color: installed ? C.ok : C.or }}>{t.inbox.title}</div>
        <div style={{ fontSize: 24, color: C.soft }}>{t.inbox.reason}</div>
        {installed ? (
          <div style={{ fontSize: 24, color: C.ok, opacity: installedP, minHeight: 50, display: "flex", alignItems: "center" }}>{t.ui.availableNext}</div>
        ) : (
          <div style={{ display: "flex", gap: 14, justifyContent: "flex-end" }}>
            <span style={{ fontSize: 24, color: C.soft, border: `1px solid ${C.btnLine}`, borderRadius: 10, padding: "8px 22px" }}>{t.ui.dismiss}</span>
            <span style={{ fontSize: 24, fontWeight: 700, color: C.onOr, background: C.or, border: `1px solid ${C.or}`, borderRadius: 10, padding: "8px 26px", transform: approvePressed ? "scale(0.95)" : "none" }}>{t.ui.approve}</span>
          </div>
        )}
      </div>
    )}
  </Card>
);

export const ChatLine: React.FC<{ children: React.ReactNode; user?: boolean; style?: React.CSSProperties }> = ({ children, user, style }) => (
  <div style={{ display: "flex", gap: 14, fontSize: 30, lineHeight: 1.35, color: user ? C.ink : C.soft, ...style }}>
    <span style={{ color: user ? C.or : C.mute, flex: "none", width: 24 }}>{user ? "❯" : "●"}</span>
    <span>{children}</span>
  </div>
);
