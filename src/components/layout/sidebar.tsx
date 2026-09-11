"use client";

import {
  BadgeDollarSign,
  ChartNoAxesCombined,
  ChevronLeft,
  CircleDollarSign,
  CreditCard,
  HandCoins,
  LayoutDashboard,
  Link2,
  PlugZap,
  ReceiptText,
  Settings,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "@/components/ui/brand";

const primaryItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Pagamentos", href: "/pagamentos", icon: CreditCard },
  { label: "Assinaturas", icon: ReceiptText },
  { label: "Afiliados", href: "/afiliados", icon: Users },
  { label: "Comissões", href: "/comissoes", icon: BadgeDollarSign },
  { label: "Repasses", icon: HandCoins },
  { label: "Checkout", href: "/checkout/basico", icon: Link2 },
  { label: "Clientes", icon: CircleDollarSign },
];

const secondaryItems = [
  { label: "Integrações", icon: PlugZap },
  { label: "Configurações", icon: Settings },
];

type SidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onCollapse: () => void;
  onMobileClose: () => void;
};

export function Sidebar({ collapsed, mobileOpen, onCollapse, onMobileClose }: SidebarProps) {
  const pathname = usePathname();

  const renderItem = ({ label, href, icon: Icon }: (typeof primaryItems)[number]) => {
    const active = href ? pathname === href : false;
    const content = (
      <>
        <Icon size={19} strokeWidth={active ? 2.2 : 1.8} />
        {!collapsed && <span>{label}</span>}
        {!href && !collapsed && <small>Em breve</small>}
      </>
    );

    return href ? (
      <Link
        key={label}
        href={href}
        className={`sidebar-link${active ? " active" : ""}`}
        onClick={onMobileClose}
        title={collapsed ? label : undefined}
      >
        {content}
      </Link>
    ) : (
      <span key={label} className="sidebar-link disabled" title={collapsed ? `${label} — em breve` : undefined}>
        {content}
      </span>
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
          </div>
        </nav>

        <div className="sidebar-foot">
          {!collapsed && (
            <div className="provider-status">
              <span className="provider-icon"><ChartNoAxesCombined size={17} /></span>
              <div><strong>Mercado Pago</strong><small><i /> Operacional</small></div>
            </div>
          )}
          <button className="collapse-button" onClick={onCollapse} aria-label={collapsed ? "Expandir menu" : "Recolher menu"}>
            <ChevronLeft size={18} />
            {!collapsed && <span>Recolher menu</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
