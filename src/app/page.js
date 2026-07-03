'use client'

import { useState, useEffect } from 'react';
import DouyinImporter from '@/components/DouyinImporter';
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeView, setActiveView] = useState('content');

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
    if (data.length > 0 && !activeChannelId) {
      setActiveChannelId(data[0].id);
    }
  };

  const loadSpaces = async (channelId) => {
    const data = await fetchSpaces(channelId);
    setSpaces(data);
    if (data.length > 0) {
      setActiveSpaceId(data[0].space_id);
    } else {
      setActiveSpaceId(null);
    }
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
    if (res.success) setStatus('Upload Finished');
    else setStatus('Upload Failed');
    setLoading(null);
    loadVideos(activeSpaceId);
  };

  const handleSyncSpace = async () => {
    setLoading(true);
    setStatus('Syncing Space...');
    const res = await triggerWorkflow(activeSpaceId);
    if (res.success) setStatus('Sync Finished');
    else setStatus('Sync Failed');
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

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logoRow}>
          <h1 className={styles.title}>Studio <span>Suite 4.0</span></h1>
          <div className={styles.badge}>Hierarchical Hub</div>
        </div>
        
        {/* YouTube Channel Level Tabs */}
        <div className={styles.ytTabBar}>
          <div className={styles.label}>YouTube Channels</div>
          {channels.map(c => (
            <div 
              key={c.id} 
              className={`${styles.ytTab} ${activeChannelId === c.id ? styles.activeYtTab : ''}`}
              onClick={() => setActiveChannelId(c.id)}
            >
              <span className={styles.ytIcon}>📹</span> {c.name}
              <button onClick={(e) => { e.stopPropagation(); handleDeleteChannel(c.id); }} className={styles.tabDelete}>×</button>
            </div>
          ))}
          <button onClick={() => setShowAddChannel(true)} className={styles.addTabBtn}>+ Channel</button>
        </div>

        {/* Bilibili Space Level Tabs */}
        <div className={styles.tabBar}>
          <div className={styles.label}>Bilibili Sources</div>
          {spaces.map(s => (
            <div 
              key={s.id} 
              className={`${styles.tab} ${activeSpaceId === s.space_id ? styles.activeTab : ''}`}
              onClick={() => setActiveSpaceId(s.space_id)}
            >
              {s.name}
              <button onClick={(e) => { e.stopPropagation(); handleDeleteSpace(s.id); }} className={styles.tabDelete}>×</button>
            </div>
          ))}
          <button 
            onClick={() => setShowAddSpace(true)} 
            className={styles.addTabBtn}
            disabled={!activeChannelId}
          >
            + Bilibili Tab
          </button>
        </div>

        <div className={styles.actionsBar}>
          <div className={styles.infoGroup}>
             <span>YT: <strong>{activeChannel?.channel_id || '--'}</strong></span>
             <span>Space: <strong>{activeSpaceId || '--'}</strong></span>
          </div>
          <div className={styles.viewTabs}>
            {[
              ['content', 'Content'],
              ['douyin', 'Douyin'],
              ['pipeline', 'Pipeline'],
              ['scenes', 'Scenes'],
              ['settings', 'Settings'],
              ['troubleshooter', 'Troubleshooter'],
            ].map(([id, label]) => (
              <button
                key={id}
                className={`${styles.viewTab} ${activeView === id ? styles.activeViewTab : ''}`}
                onClick={() => setActiveView(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button onClick={handleSyncSpace} disabled={loading || !activeSpaceId} className={styles.buttonPrimary}>
            {loading === true ? 'Syncing...' : 'Sync & Scrape'}
          </button>
          <button onClick={() => triggerContinuousWorkflow(activeSpaceId)} disabled={!activeSpaceId} className={styles.buttonSecondary}>
            Continuous Loop
          </button>
          <div className={styles.globalStatus}>Global: <span>{status}</span></div>
        </div>
      </header>

      <main className={styles.mainFull}>
        {/* Modals for Management */}
        {(showAddChannel || showAddSpace) && (
          <div className={styles.modalOverlay}>
            <div className={styles.modal}>
              <h3>Add {showAddChannel ? 'YouTube Channel' : 'Bilibili Space Source'}</h3>
              <p className={styles.modalSub}>Linking to {showAddSpace ? `YouTube Channel: ${activeChannel?.name}` : 'Main Dashboard'}</p>
              <input 
                placeholder={showAddChannel ? "YouTube Channel/User ID" : "Bilibili Space ID (Numbers)"}
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
                <button onClick={showAddChannel ? handleCreateChannel : handleCreateSpace} className={styles.buttonPrimary}>Create Tab</button>
                <button onClick={() => { setShowAddChannel(false); setShowAddSpace(false); setNewItem({id:'', name:''}); }} className={styles.buttonSecondary}>Cancel</button>
              </div>
            </div>
          </div>
        )}

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
                  <th style={{width: '240px'}}>Operations</th>
                </tr>
              </thead>
              <tbody>
                {videos.map(vid => (
                  <tr key={vid.id}>
                    <td>
                      {editingId === vid.id ? (
                        <input name="chinese_name" value={editData.chinese_name} onChange={(e) => setEditData(p => ({...p, chinese_name: e.target.value}))} className={styles.input} />
                      ) : (
                        <div className={styles.titleWrapper}>
                           {vid.auto_upload_time && <span className={styles.iconScheduled} title="Scheduled Upload">⏱</span>}
                           {vid.chinese_name}
                        </div>
                      )}
                    </td>
                    <td>
                      {editingId === vid.id ? (
                        <select value={editData.status} onChange={(e) => setEditData(p => ({...p, status: e.target.value}))} className={styles.select}>
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
                        <input value={editData.edited_video_path || ''} onChange={(e) => setEditData(p => ({...p, edited_video_path: e.target.value}))} placeholder="Absolute Path" className={styles.input} />
                      ) : (
                        <div className={styles.editedPath}>
                          {vid.edited_video_path ? <span title={vid.edited_video_path}>✅ Provided</span> : <span className={styles.muted}>No Edited File</span>}
                        </div>
                      )}
                    </td>
                    <td>
                      {editingId === vid.id ? (
                        <input type="datetime-local" value={editData.auto_upload_time ? editData.auto_upload_time.slice(0, 16) : ''} onChange={(e) => setEditData(p => ({...p, auto_upload_time: e.target.value}))} className={styles.input} />
                      ) : (
                        <span className={styles.timeText}>{vid.auto_upload_time ? new Date(vid.auto_upload_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '--'}</span>
                      )}
                    </td>
                    <td className={styles.operationRow}>
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
                            {loading === vid.id ? 'Uploading...' : 'Upload Now'}
                          </button>
                        </>
                      )}
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
  );
}
