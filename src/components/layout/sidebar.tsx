"use client";

import {
  BadgeDollarSign,
  ChevronLeft,
  CreditCard,
  HandCoins,
  LayoutDashboard,
  Landmark,
  Package,
  PlugZap,
  ServerCog,
  Settings,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "@/components/ui/brand";

const primaryItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Produtos", href: "/produtos", icon: Package },
  { label: "Pagamentos", href: "/pagamentos", icon: CreditCard },
  { label: "Afiliados", href: "/afiliados", icon: Users },
  { label: "Coproduções", href: "/coproducoes", icon: UserRound },
  { label: "Comissões", href: "/comissoes", icon: BadgeDollarSign },
  { label: "Saldo", href: "/saldo", icon: Wallet },
  { label: "Saques", href: "/saques", icon: HandCoins },
];

const secondaryItems = [
  { label: "Integrações", href: "/integracoes", icon: PlugZap },
  { label: "Configurações", href: "/conta", icon: Settings },
];

type SidebarItem = { label: string; href: string; icon: typeof LayoutDashboard };
type SidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onCollapse: () => void;
  onMobileClose: () => void;
  admin: boolean;
  platformAdmin: boolean;
};

export function Sidebar({ collapsed, mobileOpen, onCollapse, onMobileClose, admin, platformAdmin }: SidebarProps) {
  const pathname = usePathname();

  const renderItem = ({ label, href, icon: Icon }: SidebarItem) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        key={label}
        href={href}
        className={`sidebar-link${active ? " active" : ""}`}
        onClick={onMobileClose}
        title={collapsed ? label : undefined}
      >
        <Icon size={19} strokeWidth={active ? 2.2 : 1.8} />
        {!collapsed && <span>{label}</span>}
      </Link>
    );
  };

  return (
    <>
      {mobileOpen && <button className="sidebar-backdrop" aria-label="Fechar menu" onClick={onMobileClose} />}
      <aside className={`sidebar${collapsed ? " collapsed" : ""}${mobileOpen ? " mobile-open" : ""}`}>
        <div className="sidebar-head">
          <Brand compact={collapsed} />
          <button className="icon-button mobile-close" onClick={onMobileClose} aria-label="Fechar menu">
            <X size={20} />
          </button>
        </div>

        <nav aria-label="Navegação principal">
          <div className="nav-group">
            {!collapsed && <p>Visão financeira</p>}
            {primaryItems.map(renderItem)}
          </div>
          <div className="nav-group nav-secondary">
            {!collapsed && <p>Conta</p>}
            {secondaryItems.map(renderItem)}
            {admin && renderItem({ label: "Admin", href: "/admin", icon: Landmark })}
            {platformAdmin && renderItem({ label: "Plataforma", href: "/admin/plataforma", icon: ServerCog })}
          </div>
        </nav>

        <div className="sidebar-foot">
          <button className="collapse-button" onClick={onCollapse} aria-label={collapsed ? "Expandir menu" : "Recolher menu"}>
            <ChevronLeft size={18} />
            {!collapsed && <span>Recolher menu</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
