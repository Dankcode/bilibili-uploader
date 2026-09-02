'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Clapperboard, Library, PlugZap, Stethoscope, Workflow, LayoutDashboard, Server } from 'lucide-react';
import styles from '../app/page.module.css';

const NAV = [
  ['overview', 'Overview', LayoutDashboard], ['library', 'Library', Library], ['automation', 'Automation', Workflow],
  ['editor', 'Editor', Clapperboard], ['analytics', 'Analytics', BarChart3], ['connections', 'Connections', PlugZap], ['runtime', 'Runtime', Server], ['diagnostics', 'Diagnostics', Stethoscope],
];

export default function AppShell({ children }) {
  const pathname = usePathname();
  if (!pathname.startsWith('/videos/')) return children;
  return <div className={styles.opsShell}>
    <aside className={styles.opsSidebar}>
      <div className={styles.opsBrand}><div className={styles.opsBrandMark}>V</div><div><strong>VIDEOPS</strong><span>Automation console</span></div></div>
      <nav className={styles.opsNav} aria-label="Primary navigation"><div className={styles.opsNavGroup}><span>Workspace</span>{NAV.slice(0, 5).map(([id, label, Icon]) => <Link href={`/?view=${id}`} key={id} className={id === 'library' ? styles.opsNavActive : ''}><Icon size={17} /><span>{label}</span></Link>)}</div><div className={styles.opsNavGroup}><span>System</span>{NAV.slice(5).map(([id, label, Icon]) => <Link href={`/?view=${id}`} key={id}><Icon size={17} /><span>{label}</span></Link>)}</div></nav>
      <div className={styles.opsSidebarFooter}><span className={styles.systemOnline} /><div><strong>Process detail</strong><small>localhost:4455</small></div></div>
    </aside>
    <div className={styles.opsMain}>{children}</div>
  </div>;
}
