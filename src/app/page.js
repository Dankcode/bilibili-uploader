'use client'

import { useState, useEffect } from 'react';
import { 
  triggerWorkflow, triggerContinuousWorkflow, fetchVideos, updateVideo, 
  fetchSpaces, createSpace, modifySpace, removeSpace, startupCheck 
} from './actions';
import styles from './page.module.css';

export default function Dashboard() {
  const [spaces, setSpaces] = useState([]);
  const [activeSpaceId, setActiveSpaceId] = useState(null);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Idle');
  
  // Modal/Editing State
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [showAddSpace, setShowAddSpace] = useState(false);
  const [newSpace, setNewSpace] = useState({ id: '', name: '' });

  useEffect(() => {
    // Initial startup check for due uploads
    startupCheck();
    loadSpaces();
    
    const interval = setInterval(() => {
      loadVideos(activeSpaceId);
    }, 5000);
    return () => clearInterval(interval);
  }, [activeSpaceId]);

  const loadSpaces = async () => {
    const data = await fetchSpaces();
    setSpaces(data);
    if (data.length > 0 && !activeSpaceId) {
      setActiveSpaceId(data[0].space_id);
    }
  };

  const loadVideos = async (spaceId) => {
    if (!spaceId) return;
    const data = await fetchVideos(spaceId);
    setVideos(data);
  };

  const handleAddSpace = async () => {
    if (!newSpace.id) return;
    const res = await createSpace(newSpace.id, newSpace.name || `Space ${newSpace.id}`);
    if (res.success) {
      setShowAddSpace(false);
      setNewSpace({ id: '', name: '' });
      loadSpaces();
    }
  };

  const handleDeleteSpace = async (id) => {
    if (window.confirm('WARNING: Are you sure you want to delete this tab and all its video records?')) {
      const res = await removeSpace(id);
      if (res.success) {
        setActiveSpaceId(null);
        loadSpaces();
      }
    }
  };

  const handleRunWorkflow = async () => {
    setLoading(true);
    setStatus('Processing...');
    const res = await triggerWorkflow(activeSpaceId);
    if (res.success) setStatus('Success');
    else setStatus('Error');
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

  const handleChange = (e) => {
    const { name, value } = e.target;
    setEditData(prev => ({ ...prev, [name]: value }));
  };

  const activeSpace = spaces.find(s => s.space_id === activeSpaceId);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logoRow}>
          <h1 className={styles.title}>Bilibili <span>Studio Suite 3.0</span></h1>
          <div className={styles.badge}>Multi-Space Engine</div>
        </div>
        
        {/* Tab Bar */}
        <div className={styles.tabBar}>
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
          <button onClick={() => setShowAddSpace(true)} className={styles.addTabBtn}>+ New Tab</button>
        </div>

        <div className={styles.actionsBar}>
          <div className={styles.currentSpaceInfo}>
            Channel ID: <span>{activeSpaceId || '--'}</span>
          </div>
          <button onClick={handleRunWorkflow} disabled={loading || !activeSpaceId} className={styles.buttonPrimary}>
            {loading ? 'Processing...' : 'Sync & Upload'}
          </button>
          <button onClick={() => triggerContinuousWorkflow(activeSpaceId)} disabled={!activeSpaceId} className={styles.buttonSecondary}>
            Start Auto Loop
          </button>
          <div className={styles.globalStatus}>Global Status: <span>{status}</span></div>
        </div>
      </header>

      <main className={styles.mainFull}>
        {showAddSpace && (
          <div className={styles.modalOverlay}>
            <div className={styles.modal}>
              <h3>Add New Bilibili Space</h3>
              <input 
                placeholder="Bilibili Space ID (Numbers)" 
                value={newSpace.id} 
                onChange={(e) => setNewSpace(p => ({ ...p, id: e.target.value }))}
                className={styles.modalInput}
              />
              <input 
                placeholder="Tab Name (e.g. ASMR Artist)" 
                value={newSpace.name} 
                onChange={(e) => setNewSpace(p => ({ ...p, name: e.target.value }))}
                className={styles.modalInput}
              />
              <div className={styles.modalButtons}>
                <button onClick={handleAddSpace} className={styles.buttonPrimary}>Add Tab</button>
                <button onClick={() => setShowAddSpace(false)} className={styles.buttonSecondary}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        <section className={styles.tableCard}>
          <div className={styles.cardHeader}>
            <h3>{activeSpace?.name || 'Video Queue'}</h3>
            <div className={styles.legend}>
              <span className={styles.dotScheduled}></span> Scheduled
              <span className={styles.dotEdited}></span> Local File Provided
            </div>
          </div>
          
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Title (Chinese)</th>
                  <th>Status</th>
                  <th>Edited File Path</th>
                  <th>Auto Upload Time</th>
                  <th>YouTube URL</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {videos.map(vid => (
                  <tr key={vid.id}>
                    <td className={styles.titleColumn}>
                      {editingId === vid.id ? (
                        <input name="chinese_name" value={editData.chinese_name} onChange={handleChange} className={styles.input} />
                      ) : (
                        <div className={styles.titleWrapper}>
                          {vid.auto_upload_time && <span className={styles.scheduledInd}>⏱</span>}
                          {vid.edited_video_path && <span className={styles.editedInd}>📁</span>}
                          {vid.chinese_name}
                        </div>
                      )}
                    </td>
                    <td>
                      {editingId === vid.id ? (
                        <select name="status" value={editData.status} onChange={handleChange} className={styles.select}>
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
                    <td>
                      {editingId === vid.id ? (
                        <input name="edited_video_path" value={editData.edited_video_path || ''} onChange={handleChange} placeholder="Absolute path to file" className={styles.input} />
                      ) : (
                        <span className={styles.pathText}>{vid.edited_video_path ? 'Custom Path Set' : '--'}</span>
                      )}
                    </td>
                    <td>
                      {editingId === vid.id ? (
                        <input type="datetime-local" name="auto_upload_time" value={editData.auto_upload_time ? editData.auto_upload_time.slice(0, 16) : ''} onChange={handleChange} className={styles.input} />
                      ) : (
                        <span className={styles.timeText}>{vid.auto_upload_time ? new Date(vid.auto_upload_time).toLocaleString() : '--'}</span>
                      )}
                    </td>
                    <td className={styles.ytUrl}>
                      {vid.youtube_url ? <a href={vid.youtube_url} target="_blank">YouTube</a> : '--'}
                    </td>
                    <td>
                      {editingId === vid.id ? (
                        <button onClick={handleSave} className={styles.saveBtn}>Submit</button>
                      ) : (
                        <button onClick={() => handleEdit(vid)} className={styles.editBtn}>Edit</button>
                      )}
                    </td>
                  </tr>
                ))}
                {videos.length === 0 && (
                  <tr><td colSpan="6" className={styles.emptyRow}>No videos found for this space. Run Sync to fetch new content.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <p>Bilibili Studio Suite 3.0 - Managed Multi-Channel Hub</p>
      </footer>
    </div>
  );
}
