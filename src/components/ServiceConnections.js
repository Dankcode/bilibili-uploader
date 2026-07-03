'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from '../app/page.module.css';

const ROLE_LABELS = {
  source: 'Sources',
  processor: 'Processors',
  uploader: 'Uploaders',
};

export default function ServiceConnections() {
  const [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [status, setStatus] = useState('');

  const loadRows = async () => {
    const response = await fetch('/api/settings/connections', { cache: 'no-store' });
    const data = await response.json();
    if (response.ok) setRows(data.checklist || []);
  };

  useEffect(() => {
    loadRows();
  }, []);

  const grouped = useMemo(() => rows.reduce((acc, row) => {
    const key = row.role || 'other';
    acc[key] = acc[key] || [];
    acc[key].push(row);
    return acc;
  }, {}), [rows]);

  const updateDraft = (serviceId, key, value) => {
    setDrafts((previous) => ({
      ...previous,
      [serviceId]: {
        ...(previous[serviceId] || {}),
        [key]: value,
      },
    }));
  };

  const postAction = async (body) => {
    setStatus('Saving...');
    const response = await fetch('/api/settings/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || 'Connection action failed');
      return;
    }
    setStatus('Updated');
    await loadRows();
  };

  const save = (row) => {
    const credentials = {};
    for (const field of row.credentialFields || []) {
      const value = drafts[row.id]?.[field.key];
      if (field.type === 'secret' && !value) continue;
      if (value !== undefined) credentials[field.key] = value;
    }
    postAction({ action: 'save', serviceId: row.id, credentials });
  };

  return (
    <section className={styles.tableCard}>
      <div className={styles.cardHeader}>
        <h3>Service Connections</h3>
        {status && <span className={styles.globalStatus}>{status}</span>}
      </div>
      <div className={styles.panelBody}>
        {Object.entries(grouped).map(([role, services]) => (
          <div key={role} className={styles.connectionGroup}>
            <h4>{ROLE_LABELS[role] || role}</h4>
            {services.map((row) => (
              <article key={row.id} className={styles.connectionRow}>
                <div className={styles.jobTopLine}>
                  <div>
                    <strong>{row.label}</strong>
                    <span className={styles.connectionMeta}>
                      {row.configured ? 'Configured' : 'Needs config'} / {row.status || 'untested'}
                    </span>
                  </div>
                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={Boolean(row.enabled)}
                      disabled={row.status !== 'ok'}
                      onChange={(event) => postAction({ action: 'enable', serviceId: row.id, enabled: event.target.checked })}
                    />
                    Enabled
                  </label>
                </div>
                {!!row.credentialFields?.length && (
                  <div className={styles.formGrid}>
                    {row.credentialFields.map((field) => (
                      <input
                        key={field.key}
                        className={styles.input}
                        type={field.type === 'secret' ? 'password' : 'text'}
                        placeholder={`${field.label}${field.required === false ? ' (optional)' : ''}`}
                        value={drafts[row.id]?.[field.key] || ''}
                        onChange={(event) => updateDraft(row.id, field.key, event.target.value)}
                      />
                    ))}
                  </div>
                )}
                {row.lastError && <div className={styles.errorText}>{row.lastError}</div>}
                <div className={styles.operationRow}>
                  <button className={styles.saveBtn} onClick={() => save(row)}>Save</button>
                  <button className={styles.editBtn} onClick={() => postAction({ action: 'test', serviceId: row.id })}>Test</button>
                </div>
              </article>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
