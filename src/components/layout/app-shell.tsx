"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export type ShellProfile = { name: string; email: string; admin: boolean };
export function AppShell({ children, profile }: { children: React.ReactNode; profile: ShellProfile }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  function toggleCollapsed() {
    setCollapsed((current) => !current);
  }

  return (
    <div className={`app-shell${collapsed ? " is-collapsed" : ""}`}>
      <Sidebar
        admin={profile.admin}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCollapse={toggleCollapsed}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="app-frame">
        <Topbar profile={profile} onMenuOpen={() => setMobileOpen(true)} />
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
