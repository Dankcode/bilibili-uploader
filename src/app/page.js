'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Clapperboard, Library, Menu, PanelLeftClose, PanelLeftOpen, PlugZap,
  Search, Stethoscope, Upload, Workflow, X, LayoutDashboard, Inbox, Server,
} from 'lucide-react';
import AutomationHub from '@/components/AutomationHub';
import EditorWorkspace from '@/components/EditorWorkspace';
import OperationsOverview from '@/components/OperationsOverview';
import ServiceConnections from '@/components/ServiceConnections';
import Troubleshooter from '@/components/Troubleshooter';
import VideoAnalytics from '@/components/VideoAnalytics';
import VideoLibrary from '@/components/VideoLibrary';
import ProcessDetail from '@/components/process/ProcessDetail';
import MailCenter from '@/components/MailCenter';
import styles from './page.module.css';

const NAV_GROUPS = [
  {
    label: 'Workspace',
    items: [
      ['overview', 'Overview', LayoutDashboard, 'See live pipeline health and edit a queued video process.'],
      ['library', 'Library', Library, 'Browse the SQL video catalog and manage records.'],
      ['automation', 'Automation', Workflow, 'Plan batches and bind each upload to a YouTube channel.'],
      ['editor', 'Editor', Clapperboard, 'Edit timelines, subtitles, and publishing metadata.'],
      ['analytics', 'Analytics', BarChart3, 'Review performance for published videos.'],
      ['mail', 'Mail', Inbox, 'Review Gmail tracking events and unresolved platform notices.'],
    ],
  },
  {
    label: 'System',
    items: [
      ['connections', 'Connections', PlugZap, 'Authorize providers and YouTube channels.'],
      ['runtime', 'Runtime', Server, 'Configure database location, backend API, and worker.'],
      ['diagnostics', 'Diagnostics', Stethoscope, 'Run system checks and inspect configuration.'],
    ],
  },
];

const VIEW_META = {
  overview: ['Operations', 'Live workspace'],
  library: ['Video library', 'SQL catalog'],
  automation: ['Automation', 'Batch control'],
  editor: ['Video editor', 'Timeline and subtitles'],
  analytics: ['Analytics', 'Platform performance'],
  mail: ['Mail', 'Tracking inbox'],
  connections: ['Connections', 'Accounts and provider credentials'],
  runtime: ['Runtime', 'Database, API, and worker topology'],
  diagnostics: ['Diagnostics', 'System checks'],
};

export default function Dashboard() {
  const [activeView, setActiveView] = useState('overview');
  const [overviewPayload, setOverviewPayload] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState('');
  const [channels, setChannels] = useState([]);
  const [youtubeAuthorizations, setYoutubeAuthorizations] = useState([]);
  const [globalQuery, setGlobalQuery] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [composerKey, setComposerKey] = useState(0);
  const [proofKey, setProofKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [processVideoId, setProcessVideoId] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('code') && params.get('state')) setActiveView('connections');
    else if (VIEW_META[params.get('view')]) setActiveView(params.get('view'));
  }, []);

  const loadOverview = useCallback(async () => {
    setOverviewError('');
    try {
      const response = await fetch('/api/control/operations/overview', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load operations');
      setOverviewPayload(payload);
    } catch (error) {
      setOverviewError(error.message);
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadYoutubeAuthorizations = useCallback(async () => {
    try {
      const response = await fetch('/api/control/operations/youtube-authorizations', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load YouTube authorizations');
      setYoutubeAuthorizations(payload.authorizations || []);
    } catch {
      setYoutubeAuthorizations([]);
    }
  }, []);

  useEffect(() => {
    fetch('/api/control/operations/channels', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Could not load channels')))
      .then((payload) => setChannels(payload.channels || []))
      .catch(() => setChannels([]));
    loadYoutubeAuthorizations();
    loadOverview();
    const interval = setInterval(loadOverview, 8000);
    return () => clearInterval(interval);
  }, [loadOverview, loadYoutubeAuthorizations]);

  function navigate(view, target = '') {
    if (view === 'automation' && target === 'proof') setProofKey(Date.now());
    if (view === 'editor') loadYoutubeAuthorizations();
    setActiveView(view);
    setMobileNavOpen(false);
  }

  function openImport() {
    setComposerKey(Date.now());
    navigate('automation');
  }

  function refreshWorkspace() {
    setRefreshKey((value) => value + 1);
    loadOverview();
  }

  const activeMeta = VIEW_META[activeView] || VIEW_META.overview;
  const counts = overviewPayload?.overview?.counts || {};
  const passingHealth = useMemo(() => (overviewPayload?.health || []).filter((item) => item.status === 'ok').length, [overviewPayload]);
  const healthTotal = overviewPayload?.health?.length || 0;

  return (
    <div className={`${styles.opsShell} ${sidebarCollapsed ? styles.sidebarCollapsed : ''}`}>
      <aside className={`${styles.opsSidebar} ${mobileNavOpen ? styles.mobileNavOpen : ''}`}>
        <div className={styles.opsBrand}>
          <div className={styles.opsBrandMark}>V</div>
          {!sidebarCollapsed && <div><strong>VIDEOPS</strong><span>Automation console</span></div>}
          <button type="button" className={styles.sidebarToggle} onClick={() => setSidebarCollapsed((value) => !value)} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button>
          <button type="button" className={styles.mobileClose} onClick={() => setMobileNavOpen(false)} title="Close navigation" aria-label="Close navigation"><X size={17} /></button>
        </div>

        <nav className={styles.opsNav} aria-label="Primary navigation">
          {NAV_GROUPS.map((group) => <div className={styles.opsNavGroup} key={group.label}>
            {!sidebarCollapsed && <span>{group.label}</span>}
            {group.items.map(([id, label, Icon, hint]) => <button type="button" key={id} className={activeView === id ? styles.opsNavActive : ''} onClick={() => navigate(id)} aria-label={`${label}: ${hint}`}><Icon size={17} /><span>{label}</span><small className={styles.navHint} role="tooltip">{hint}</small>{id === 'library' && counts.needsReview > 0 && <i>{counts.needsReview}</i>}</button>)}
          </div>)}
        </nav>

        <div className={styles.opsSidebarFooter}>
          <span className={healthTotal && passingHealth === healthTotal ? styles.systemOnline : styles.systemAttention} />
          {!sidebarCollapsed && <div><strong>{healthTotal ? `${passingHealth}/${healthTotal} checks ready` : 'Checks pending'}</strong><small>localhost:4455</small></div>}
        </div>
      </aside>

      {mobileNavOpen && <button className={styles.mobileScrim} type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation overlay" />}

      <div className={styles.opsMain}>
        <header className={styles.opsTopbar}>
          <button type="button" className={styles.mobileMenu} onClick={() => setMobileNavOpen(true)} title="Open navigation" aria-label="Open navigation"><Menu size={18} /></button>
          <div className={styles.viewIdentity}><h1>{activeMeta[0]}</h1><span>{activeMeta[1]}</span></div>
          <label className={styles.globalSearch}>
            <Search size={15} />
            <input value={globalQuery} onFocus={() => activeView !== 'library' && navigate('library')} onChange={(event) => setGlobalQuery(event.target.value)} placeholder="Search videos" aria-label="Search videos" />
          </label>
          <div className={styles.capacityMeter} title="Active jobs out of batch capacity"><span><i style={{ width: `${Math.min(100, ((counts.active || 0) / 100) * 100)}%` }} /></span><small>{counts.active || 0}/100 active</small></div>
          <button type="button" className={styles.importButton} onClick={openImport}><Upload size={15} /><span>Import videos</span></button>
        </header>

        <main className={styles.opsContent}>
          {activeView === 'overview' && <OperationsOverview payload={overviewPayload} loading={overviewLoading} error={overviewError} onRefresh={refreshWorkspace} onNavigate={navigate} onOpenProcess={setProcessVideoId} />}
          {activeView === 'library' && <VideoLibrary externalQuery={globalQuery} refreshKey={refreshKey} />}
          {activeView === 'automation' && <AutomationHub openComposerKey={composerKey} openProofKey={proofKey} onQueued={refreshWorkspace} youtubeAuthorizations={youtubeAuthorizations} />}
          {activeView === 'editor' && <EditorWorkspace channels={channels} youtubeAuthorizations={youtubeAuthorizations} onPublished={() => navigate('analytics')} onJobQueued={() => { refreshWorkspace(); navigate('automation'); }} />}
          {activeView === 'analytics' && <VideoAnalytics refreshKey={refreshKey} />}
          {activeView === 'mail' && <MailCenter />}
          {activeView === 'connections' && <ServiceConnections section="accounts" />}
          {activeView === 'runtime' && <ServiceConnections section="runtime" />}
          {activeView === 'diagnostics' && <Troubleshooter />}
        </main>
        {processVideoId && <div className={styles.modalOverlay} onMouseDown={(event) => event.target === event.currentTarget && setProcessVideoId('')}><div className={styles.dashboardProcessDrawer}><ProcessDetail videoId={processVideoId} embedded onClose={() => setProcessVideoId('')} onChanged={refreshWorkspace} /></div></div>}
      </div>
    </div>
  );
}
