import {
  BadgeDollarSign,
  Bell,
  CreditCard,
  LayoutDashboard,
  Menu,
  RefreshCcw,
  Users,
} from "lucide-react";
import { Brand } from "@/components/ui/brand";
import type { ConceptModule } from "./dashboard1-types";
import styles from "./dashboard1.module.css";

const navigation: Array<{ id: ConceptModule; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "payments", label: "Pagamentos", icon: CreditCard },
  { id: "subscriptions", label: "Assinaturas", icon: RefreshCcw },
  { id: "affiliates", label: "Afiliados", icon: Users },
  { id: "commissions", label: "Comissões", icon: BadgeDollarSign },
];

type Dashboard1NavProps = {
  active: ConceptModule;
  onSelect: (module: ConceptModule) => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
};

export function Dashboard1Nav({ active, onSelect, menuOpen, onToggleMenu }: Dashboard1NavProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Brand href="/dashboard1" />

        <nav className={`${styles.navigation} ${menuOpen ? styles.navigationOpen : ""}`} aria-label="Módulos do Prosperity Pay">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`${styles.navItem} ${active === id ? styles.navItemActive : ""}`}
              onClick={() => onSelect(id)}
              aria-current={active === id ? "page" : undefined}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className={styles.headerActions}>
          <button className={styles.iconButton} type="button" aria-label="Notificações">
            <Bell size={18} />
            <i />
          </button>
          <button className={styles.profile} type="button" aria-label="Abrir perfil">
            <span>LN</span>
            <div><strong>Leandro</strong><small>Administrador</small></div>
          </button>
          <button className={`${styles.iconButton} ${styles.menuButton}`} type="button" onClick={onToggleMenu} aria-label="Abrir módulos" aria-expanded={menuOpen}>
            <Menu size={20} />
          </button>
        </div>
      </div>
    </header>
  );
}
