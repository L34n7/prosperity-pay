"use client";

import { Bell, ChevronDown, Menu, Search } from "lucide-react";
import { usePathname } from "next/navigation";

const pageNames: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/pagamentos": "Pagamentos",
  "/afiliados": "Afiliados",
  "/comissoes": "Comissões",
};

export function Topbar({ onMenuOpen }: { onMenuOpen: () => void }) {
  const pathname = usePathname();

  return (
    <header className="topbar">
      <div className="topbar-title">
        <button className="icon-button menu-button" onClick={onMenuOpen} aria-label="Abrir menu">
          <Menu size={21} />
        </button>
        <div>
          <span>Prosperity Pay</span>
          <strong>{pageNames[pathname] ?? "Visão geral"}</strong>
        </div>
      </div>

      <div className="topbar-actions">
        <button className="topbar-search" type="button">
          <Search size={17} />
          <span>Busca rápida</span>
          <kbd>⌘ K</kbd>
        </button>
        <button className="icon-button notification-button" aria-label="Notificações">
          <Bell size={19} />
          <i />
        </button>
        <button className="profile-button" type="button" aria-label="Abrir menu do perfil">
          <span>LN</span>
          <div><strong>Leandro</strong><small>Administrador</small></div>
          <ChevronDown size={15} />
        </button>
      </div>
    </header>
  );
}
