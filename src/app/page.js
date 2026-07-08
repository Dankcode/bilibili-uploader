'use client'

import { useState, useEffect } from 'react';
import DouyinImporter from '@/components/DouyinImporter';
import GenerateStudio from '@/components/GenerateStudio';
import PipelineDashboard from '@/components/PipelineDashboard';
import SceneRepository from '@/components/SceneRepository';
import ServiceConnections from '@/components/ServiceConnections';
import Troubleshooter from '@/components/Troubleshooter';
import {
  triggerWorkflow, triggerContinuousWorkflow, fetchVideos, updateVideo,
  fetchYouTubeChannels, createYouTubeChannel, removeYouTubeChannel,
  fetchSpaces, createSpace, removeSpace, startupCheck, triggerSpecificVideo
} from './actions';
import styles from './page.module.css';

// --- Minimal inline icon set (keeps the shell dependency-free) ---
const Icon = ({ path, viewBox = '0 0 24 24' }) => (
  <svg width="16" height="16" viewBox={viewBox} fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);
const ICONS = {
  generate: <Icon path={<><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></>} />,
  content: <Icon path={<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v16" /></>} />,
  douyin: <Icon path={<><path d="M9 18V6l9 5-9 5" /><circle cx="6" cy="18" r="2" /></>} />,
  pipeline: <Icon path={<><circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M6 8v6a4 4 0 0 0 4 4h6" /></>} />,
  scenes: <Icon path={<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3z" /></>} />,
  settings: <Icon path={<><circle cx="12" cy="12" r="3" /><path d="M19.4 13a7.9 7.9 0 0 0 0-2l2-1.5-2-3.4-2.4 1a7.9 7.9 0 0 0-1.7-1L14.9 3H9.1l-.4 2.6a7.9 7.9 0 0 0-1.7 1l-2.4-1-2 3.4L2.6 11a7.9 7.9 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7.9 7.9 0 0 0 1.7 1l.4 2.6h5.8l.4-2.6a7.9 7.9 0 0 0 1.7-1l2.4 1 2-3.4Z" /></>} />,
  troubleshooter: <Icon path={<><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>} />,
};

const NAV_ITEMS = [
  ['generate', 'Generate'],
  ['content', 'Content Queue'],
  ['douyin', 'Douyin Import'],
  ['pipeline', 'Pipeline'],
  ['scenes', 'Scene Intel'],
  ['settings', 'Connections'],
  ['troubleshooter', 'Diagnostics'],
];

export default function Dashboard() {
  // Navigation State
  const [channels, setChannels] = useState([]);
  const [activeChannelId, setActiveChannelId] = useState(null);
  const [spaces, setSpaces] = useState([]);
  const [activeSpaceId, setActiveSpaceId] = useState(null);
  const [videos, setVideos] = useState([]);

  // UI State
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [activeView, setActiveView] = useState('generate');

  // Management Modals
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [showAddSpace, setShowAddSpace] = useState(false);
  const [newItem, setNewItem] = useState({ id: '', name: '' });

  useEffect(() => {
    startupCheck();
    loadChannels();
  }, []);

  useEffect(() => {
    if (activeChannelId) {
      loadSpaces(activeChannelId);
    } else {
      setSpaces([]);
      setActiveSpaceId(null);
    }
  }, [activeChannelId]);

  useEffect(() => {
    if (activeSpaceId) {
      loadVideos(activeSpaceId);
    } else {
      setVideos([]);
    }
    const interval = setInterval(() => {
      if (activeSpaceId) loadVideos(activeSpaceId);
    }, 5000);
    return () => clearInterval(interval);
  }, [activeSpaceId]);

  // --- Data Loading ---
  const loadChannels = async () => {
    const data = await fetchYouTubeChannels();
    setChannels(data);
    if (data.length > 0 && !activeChannelId) setActiveChannelId(data[0].id);
  };

  const loadSpaces = async (channelId) => {
    const data = await fetchSpaces(channelId);
    setSpaces(data);
    setActiveSpaceId(data.length > 0 ? data[0].space_id : null);
  };

  const loadVideos = async (spaceId) => {
    const data = await fetchVideos(spaceId);
    setVideos(data);
  };

  // --- Management Actions ---
  const handleCreateChannel = async () => {
    if (!newItem.id) return;
    const res = await createYouTubeChannel(newItem.id, newItem.name || `Channel ${newItem.id}`);
    if (res.success) {
      setShowAddChannel(false);
      setNewItem({ id: '', name: '' });
      loadChannels();
    }
  };

  const handleDeleteChannel = async (id) => {
    if (window.confirm('WARNING: Deleting this channel will remove all its Bilibili Spaces and video records. Proceed?')) {
      const res = await removeYouTubeChannel(id);
      if (res.success) {
        setActiveChannelId(null);
        loadChannels();
      }
    }
  };

  const handleCreateSpace = async () => {
    if (!newItem.id || !activeChannelId) return;
    const res = await createSpace(activeChannelId, newItem.id, newItem.name || `Space ${newItem.id}`);
    if (res.success) {
      setShowAddSpace(false);
      setNewItem({ id: '', name: '' });
      loadSpaces(activeChannelId);
    }
  };

  const handleDeleteSpace = async (id) => {
    if (window.confirm('Are you sure you want to delete this Bilibili tab and its records?')) {
      const res = await removeSpace(id);
      if (res.success) {
        setActiveSpaceId(null);
        loadSpaces(activeChannelId);
      }
    }
  };

  // --- Workflow Actions ---
  const handleManualUpload = async (videoId) => {
    setLoading(videoId);
    setStatus('Force Uploading...');
    const res = await triggerSpecificVideo(videoId);
    setStatus(res.success ? 'Upload Finished' : 'Upload Failed');
    setLoading(null);
    loadVideos(activeSpaceId);
  };

  const handleSyncSpace = async () => {
    setLoading(true);
    setStatus('Syncing Space...');
    const res = await triggerWorkflow(activeSpaceId);
    setStatus(res.success ? 'Sync Finished' : 'Sync Failed');
    setLoading(false);
    loadVideos(activeSpaceId);
  };

  const handleEdit = (vid) => {
    setEditingId(vid.id);
    setEditData({ ...vid });
  };

  const handleSave = async () => {
    const res = await updateVideo(editingId, editData);
    if (res.success) {
      setEditingId(null);
      loadVideos(activeSpaceId);
    }
  };

  const activeChannel = channels.find(c => c.id === activeChannelId);
  const activeSpace = spaces.find(s => s.space_id === activeSpaceId);
  const activeNavLabel = NAV_ITEMS.find(([id]) => id === activeView)?.[1] || 'Studio';

  return (
    <div className={styles.container}>
      {/* ===== Sidebar ===== */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>
          <div className={styles.brandMark}>S</div>
          <div>
            <div className={styles.brandName}>Studio Suite</div>
            <div className={styles.brandTag}>v4 · Hierarchical Hub</div>
          </div>
        </div>

        <nav className={styles.nav}>
          <div className={styles.navLabel}>Workspace</div>
          {NAV_ITEMS.map(([id, label]) => (
            <div
              key={id}
              className={`${styles.navItem} ${activeView === id ? styles.activeNavItem : ''}`}
              onClick={() => setActiveView(id)}
            >
              <span className={styles.navIcon}>{ICONS[id]}</span>
              {label}
            </div>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <span>LAN · :4455</span>
          <span>Global: {status}</span>
        </div>
      </aside>

      {/* ===== Main column ===== */}
      <div className={styles.main}>
        {/* Top bar: context + primary actions */}
        <header className={styles.topbar}>
          <div className={styles.logoRow}>
            <h1 className={styles.title}>{activeNavLabel}</h1>
            <span className={styles.badge}>{activeSpace?.name || 'No source'}</span>
          </div>

          <div className={styles.actionsBar}>
            <div className={styles.contextGroup}>
              <span className={styles.ctxLabel}>Channel</span>
              <select
                className={styles.select}
                value={activeChannelId || ''}
                onChange={(e) => setActiveChannelId(Number(e.target.value) || e.target.value)}
                style={{ width: 'auto' }}
              >
                {channels.length === 0 && <option value="">— none —</option>}
                {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button className={styles.addTabBtn} onClick={() => setShowAddChannel(true)}>+</button>
              {activeChannel && (
                <button className={styles.tabDelete} title="Delete channel"
                  onClick={() => handleDeleteChannel(activeChannel.id)}>×</button>
              )}
            </div>

            <div className={styles.contextGroup}>
              <span className={styles.ctxLabel}>Source</span>
              <select
                className={styles.select}
                value={activeSpaceId || ''}
                onChange={(e) => setActiveSpaceId(e.target.value)}
                style={{ width: 'auto' }}
                disabled={!activeChannelId}
              >
                {spaces.length === 0 && <option value="">— none —</option>}
                {spaces.map(s => <option key={s.id} value={s.space_id}>{s.name}</option>)}
              </select>
              <button className={styles.addTabBtn} disabled={!activeChannelId}
                onClick={() => setShowAddSpace(true)}>+</button>
              {activeSpace && (
                <button className={styles.tabDelete} title="Delete source"
                  onClick={() => handleDeleteSpace(activeSpace.id)}>×</button>
              )}
            </div>

            <button onClick={handleSyncSpace} disabled={loading || !activeSpaceId} className={styles.buttonPrimary}>
              {loading === true ? 'Syncing…' : 'Sync & Scrape'}
            </button>
            <button onClick={() => triggerContinuousWorkflow(activeSpaceId)} disabled={!activeSpaceId} className={styles.buttonSecondary}>
              Continuous Loop
            </button>
          </div>
        </header>

        <main className={styles.mainFull}>
          {/* Management modals */}
          {(showAddChannel || showAddSpace) && (
            <div className={styles.modalOverlay}>
              <div className={styles.modal}>
                <h3>Add {showAddChannel ? 'YouTube Channel' : 'Bilibili Space Source'}</h3>
                <p className={styles.modalSub}>Linking to {showAddSpace ? `YouTube Channel: ${activeChannel?.name}` : 'Main Dashboard'}</p>
                <input
                  placeholder={showAddChannel ? 'YouTube Channel/User ID' : 'Bilibili Space ID (Numbers)'}
                  value={newItem.id}
                  onChange={(e) => setNewItem(p => ({ ...p, id: e.target.value }))}
                  className={styles.modalInput}
                />
                <input
                  placeholder="Custom Display Name"
                  value={newItem.name}
                  onChange={(e) => setNewItem(p => ({ ...p, name: e.target.value }))}
                  className={styles.modalInput}
                />
                <div className={styles.modalButtons}>
                  <button onClick={showAddChannel ? handleCreateChannel : handleCreateSpace} className={styles.buttonPrimary}>Create</button>
                  <button onClick={() => { setShowAddChannel(false); setShowAddSpace(false); setNewItem({ id: '', name: '' }); }} className={styles.buttonSecondary}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {activeView === 'generate' && <GenerateStudio defaultSourceInput={activeSpaceId || ''} />}
          {activeView === 'douyin' && <DouyinImporter onCreated={() => setActiveView('pipeline')} />}
          {activeView === 'pipeline' && <PipelineDashboard />}
          {activeView === 'scenes' && <SceneRepository />}
          {activeView === 'settings' && <ServiceConnections />}
          {activeView === 'troubleshooter' && <Troubleshooter />}
          {activeView === 'content' && (
            <section className={styles.tableCard}>
              <div className={styles.cardHeader}>
                <h3>{activeSpace?.name || 'Content Queue'}</h3>
                <div className={styles.legend}>
                  <span className={styles.legendItem}><i className={styles.dotScheduled}></i> Scheduled</span>
                  <span className={styles.legendItem}><i className={styles.dotEdited}></i> Edited File</span>
                </div>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Status</th>
                      <th>Edited File</th>
                      <th>Scheduled Upload</th>
                      <th style={{ width: '220px' }}>Operations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {videos.map(vid => (
                      <tr key={vid.id}>
                        <td>
                          {editingId === vid.id ? (
                            <input name="chinese_name" value={editData.chinese_name} onChange={(e) => setEditData(p => ({ ...p, chinese_name: e.target.value }))} className={styles.input} />
                          ) : (
                            <div className={styles.titleWrapper}>
                              {vid.auto_upload_time && <span className={styles.iconScheduled} title="Scheduled Upload">⏱</span>}
                              {vid.chinese_name}
                            </div>
                          )}
                        </td>
                        <td>
                          {editingId === vid.id ? (
                            <select value={editData.status} onChange={(e) => setEditData(p => ({ ...p, status: e.target.value }))} className={styles.select}>
                              <option value="Not started">Not started</option>
                              <option value="In progress">In progress</option>
                              <option value="Done">Done</option>
                            </select>
                          ) : (
                            <span className={`${styles.statusLabel} ${styles[vid.status.toLowerCase().replace(' ', '')]}`}>
                              {vid.status}
                            </span>
                          )}
                        </td>
                        <td className={styles.pathColumn}>
                          {editingId === vid.id ? (
                            <input value={editData.edited_video_path || ''} onChange={(e) => setEditData(p => ({ ...p, edited_video_path: e.target.value }))} placeholder="Absolute Path" className={styles.input} />
                          ) : (
                            <div className={styles.editedPath}>
                              {vid.edited_video_path ? <span title={vid.edited_video_path}>✅ Provided</span> : <span className={styles.muted}>No Edited File</span>}
                            </div>
                          )}
                        </td>
                        <td>
                          {editingId === vid.id ? (
                            <input type="datetime-local" value={editData.auto_upload_time ? editData.auto_upload_time.slice(0, 16) : ''} onChange={(e) => setEditData(p => ({ ...p, auto_upload_time: e.target.value }))} className={styles.input} />
                          ) : (
                            <span className={styles.timeText}>{vid.auto_upload_time ? new Date(vid.auto_upload_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '--'}</span>
                          )}
                        </td>
                        <td>
                          <div className={styles.operationRow}>
                            {editingId === vid.id ? (
                              <button onClick={handleSave} className={styles.saveBtn}>Save</button>
                            ) : (
                              <>
                                <button onClick={() => handleEdit(vid)} className={styles.editBtn}>Edit</button>
                                <button
                                  onClick={() => handleManualUpload(vid.id)}
                                  disabled={loading === vid.id}
                                  className={styles.uploadNowBtn}
                                >
                                  {loading === vid.id ? 'Uploading…' : 'Upload Now'}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
