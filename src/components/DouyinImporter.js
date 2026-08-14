'use client';

import { useState } from 'react';
import styles from '../app/page.module.css';

export default function DouyinImporter({ onCreated }) {
  const [links, setLinks] = useState('');
  const [voiceover, setVoiceover] = useState(false);
  const [aiEditor, setAiEditor] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [uploaderId, setUploaderId] = useState('');
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const createJobs = async () => {
    const urls = links.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!urls.length) return;
    setSubmitting(true);
    setStatus('Creating jobs...');
    try {
      const processorIds = [
        ...(voiceover ? ['voiceover'] : []),
        ...(aiEditor ? ['aiEditor'] : []),
      ];
      const created = [];
      for (const url of urls) {
        const response = await fetch('/api/control/pipeline/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create',
            sourceId: 'douyin',
            sourceInput: url,
            processorIds,
            uploaderId,
            options: {
              aiEditor: { prompt },
              youtube: { privacyStatus: 'private' },
            },
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Failed to create job for ${url}`);
        created.push(data.job.id);
      }
      setLinks('');
      setStatus(`Created jobs: ${created.join(', ')}`);
      onCreated?.();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className={styles.tableCard}>
      <div className={styles.cardHeader}>
        <h3>Douyin Import</h3>
        <span className={styles.muted}>Sidecar-backed pipeline source</span>
      </div>
      <div className={styles.panelBody}>
        <textarea
          className={styles.textarea}
          value={links}
          onChange={(event) => setLinks(event.target.value)}
          placeholder="Paste one Douyin link per line"
          rows={7}
        />
        <div className={styles.formGrid}>
          <label className={styles.checkRow}>
            <input type="checkbox" checked={voiceover} onChange={(event) => setVoiceover(event.target.checked)} />
            English voiceover
          </label>
          <label className={styles.checkRow}>
            <input type="checkbox" checked={aiEditor} onChange={(event) => setAiEditor(event.target.checked)} />
            AI video editor
          </label>
          <select className={styles.select} value={uploaderId} onChange={(event) => setUploaderId(event.target.value)}>
            <option value="">Download only</option>
            <option value="youtube">YouTube private upload</option>
          </select>
        </div>
        {aiEditor && (
          <input
            className={styles.input}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="AI editor prompt"
          />
        )}
        <div className={styles.operationRow}>
          <button className={styles.buttonPrimary} onClick={createJobs} disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Jobs'}
          </button>
          {status && <span className={styles.globalStatus}>{status}</span>}
        </div>
      </div>
    </section>
  );
}
