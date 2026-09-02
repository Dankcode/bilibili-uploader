import db from '../db/sqlite.js';
import { claimMailOutbox, getMailAccount, markMailOutbox, recordMailMessage, recoverStaleMailOutbox, upsertMailThread } from './store.js';
import * as gmail from '../pipeline/notifiers/gmail.js';

function payload(value) { try { return value ? JSON.parse(value) : {}; } catch { return {}; } }
function retryable(error) { return /429|rate.?limit|timeout|network|ECONN|5\d\d/i.test(String(error?.message || error)); }
function subject(event, videoTitle) { return `[Studio] ${videoTitle || 'Video'} — ${event}`; }

export async function drainMailOutbox(workerId, limit = 2) {
  let processed = 0;
  for (let index = 0; index < limit; index += 1) {
    const row = claimMailOutbox(workerId);
    if (!row) break;
    try {
      const data = payload(row.payload_json);
      const account = getMailAccount(row.account_id);
      const existing = row.video_id ? db.prepare('SELECT * FROM video_mail_threads WHERE video_id=? AND account_id=?').get(row.video_id, row.account_id) : null;
      const sent = await gmail.send(row.account_id, {
        subject: subject(row.event_kind, data.videoTitle),
        text: `${row.event_kind}\n\n${data.detail || data.error || 'Video pipeline update'}\n\nVideo: ${data.videoTitle || row.video_id}\nJob: ${row.job_id || ''}`,
        gmailThreadId: existing?.gmail_thread_id || '', inReplyTo: existing?.rfc822_root_id || '', rfc822Id: existing?.rfc822_root_id || '',
        labelPath: `${account.labelPrefix}/${data.channelTitle || 'Tracking'}/${row.event_kind.includes('failed') ? 'Failed' : 'Updates'}`,
      });
      const thread = row.video_id ? upsertMailThread({ videoId: row.video_id, accountId: row.account_id, gmailThreadId: sent.gmailThreadId, rfc822RootId: existing?.rfc822_root_id || sent.rfc822Id, subject: sent.subject, labelPath: sent.labelPath, status: row.event_kind }) : null;
      recordMailMessage({ accountId: row.account_id, threadRowId: thread?.id, videoId: row.video_id, direction: 'outbound', gmailMessageId: sent.gmailMessageId, gmailThreadId: sent.gmailThreadId, rfc822Id: sent.rfc822Id, fromAddress: account.emailAddress, subject: sent.subject, eventKind: row.event_kind, sentAt: new Date().toISOString() });
      markMailOutbox(row.id); processed += 1;
    } catch (error) { markMailOutbox(row.id, { error: error.message, retry: retryable(error) }); }
  }
  return processed;
}

function linkedVideo(remoteVideoId) { if (!remoteVideoId) return null; return db.prepare("SELECT video_id, id FROM video_publications WHERE platform_id='youtube' AND remote_id=? ORDER BY id DESC LIMIT 1").get(remoteVideoId) || null; }
export async function syncMailAccount(account) {
  const synced = await gmail.sync(account.id);
  for (const item of synced.messages) {
    const link = linkedVideo(item.remoteVideoId);
    const messageId = recordMailMessage({ accountId: account.id, videoId: link?.video_id || '', direction: 'inbound', gmailMessageId: item.id, gmailThreadId: item.threadId, fromAddress: item.from, subject: item.subject, snippet: item.detail, bodyText: item.body, labels: item.labels, receivedAt: item.receivedAt, rawHeaders: { from: item.from } });
    if (!messageId) continue;
    db.prepare(`INSERT INTO mail_ingest_events (message_row_id,account_id,video_id,publication_id,parser_id,parser_version,category,severity,title,detail,remote_video_id,payload_json,acknowledged_at,occurred_at,created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, '', ?, ?)`)
      .run(messageId, account.id, link?.video_id || '', link?.id || null, item.parserId, item.category, item.severity, item.title, item.detail, item.remoteVideoId, JSON.stringify(item), item.receivedAt, new Date().toISOString());
  }
  return synced.messages.length;
}
export { recoverStaleMailOutbox };
