"use client";
import { ChevronDown, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ShellProfile } from "./app-shell";

export function Topbar({ onMenuOpen, profile }: { onMenuOpen: () => void; profile: ShellProfile }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const title = pathname.split("/")[1] || "Dashboard";
  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  return <header className="topbar">
    <div className="topbar-title"><button className="icon-button menu-button" onClick={onMenuOpen} aria-label="Abrir menu"><Menu size={21}/></button>
      <div><span>Prosperity Pay</span><strong>{title.charAt(0).toUpperCase() + title.slice(1)}</strong></div>
    </div>
    <div className="topbar-actions profile-menu">
      <button className="profile-button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Abrir menu do perfil">
        <span>{profile.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
        <div><strong>{profile.name}</strong><small>{profile.email}</small></div><ChevronDown size={15}/>
      </button>
      {open && <nav className="profile-dropdown" aria-label="Perfil">
        <Link href="/conta" onClick={() => setOpen(false)}>Minha conta e dados financeiros</Link>
        <Link href="/integracoes" onClick={() => setOpen(false)}>Integrações</Link>
        <button type="button" onClick={signOut}>Sair</button>
      </nav>}
    </div>
  </header>;
}
