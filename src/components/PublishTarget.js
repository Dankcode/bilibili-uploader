'use client';

import styles from '../app/page.module.css';

function usable(item) {
  return item.enabled && ['configured', 'active'].includes(item.status) && item.credentialConfigured;
}

function availability(item) {
  if (!item.enabled) return 'disabled';
  if (!item.credentialConfigured) return 'local OAuth token missing';
  if (!['configured', 'active'].includes(item.status)) return item.status.replaceAll('_', ' ');
  return item.status === 'active' ? 'verified' : 'authorized';
}

/** The planner selects a durable publishing identity; authorization belongs in Connections. */
export default function PublishTarget({ authorizations = [], value = '', onChange, durationSeconds = 0, disabled = false }) {
  return <div className={styles.formField}>
    <span>Publish to</span>
    <div className={styles.stepChecklist}>
      {authorizations.map((item) => {
        const isUsable = usable(item);
        const isLongBlocked = Number(durationSeconds) > 900 && item.longUploadsStatus !== 'allowed';
        return <label key={item.id} className={!isUsable || isLongBlocked ? styles.stepChecked : ''} style={!isUsable || isLongBlocked ? { opacity: 0.55 } : undefined}>
          <input type="radio" name="youtube-authorization" value={item.id} checked={value === item.id} disabled={disabled || !isUsable || isLongBlocked} onChange={() => onChange?.(item.id)} />
          <span className={styles.checkVisual}>{value === item.id ? '•' : ''}</span>
          <strong>{item.channelTitle || item.channelId}<small>{item.channelId} · {availability(item)} · {item.publicationCount || 0} published</small></strong>
          {item.longUploadsStatus !== 'allowed' && <em>{isLongBlocked ? '15 min limit — this source is too long' : 'not phone-verified · 15 min limit'}</em>}
        </label>;
      })}
      {!authorizations.length && <small className={styles.fieldHint}>No authorized channels. Complete Google OAuth in Connections, then return here to select the channel.</small>}
    </div>
  </div>;
}
