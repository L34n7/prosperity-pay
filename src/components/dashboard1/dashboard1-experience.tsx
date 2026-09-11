"use client";

import { useState } from "react";
import { Dashboard1Nav } from "./dashboard1-nav";
import type { ConceptModule } from "./dashboard1-types";
import { Dashboard1ModuleView } from "./dashboard1-views";
import styles from "./dashboard1.module.css";

export function Dashboard1Experience() {
  const [activeModule, setActiveModule] = useState<ConceptModule>("overview");
  const [menuOpen, setMenuOpen] = useState(false);

  function selectModule(module: ConceptModule) {
    if (module === activeModule) {
      setMenuOpen(false);
      return;
    }

    setActiveModule(module);
    setMenuOpen(false);
  }

  return (
    <div className={styles.page}>
      <div className={styles.ambientLight} aria-hidden="true" />
      <div className={styles.gridTexture} aria-hidden="true" />
      <Dashboard1Nav
        active={activeModule}
        onSelect={selectModule}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((current) => !current)}
      />
      <main key={activeModule} className={styles.viewport}>
        <Dashboard1ModuleView module={activeModule} />
      </main>
      <footer className={styles.footer}>
        <span><i /> Sistema financeiro operacional</span>
        <span>Prosperity Pay · Ambiente administrativo</span>
      </footer>
    </div>
  );
}
