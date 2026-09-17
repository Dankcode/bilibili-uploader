/**
 * RELEASE GOVERNOR — the budget half of the release layer.
 *
 * Before this existed a job claimed itself, ran every step and called YouTube;
 * nothing checked whether the day's API quota could pay for the upload. The 7th
 * upload of the day failed with quotaExceeded, burned an attempt, and needed a
 * human to retry it after midnight Pacific.
 *
 * The governor keeps a per-destination, per-account, per-day unit ledger in
 * `destination_budgets`. A reservation that does not fit is refused with the
 * instant the budget resets, and the pipeline DEFERS the step to that instant
 * instead of failing it.
 *
 * YouTube quota belongs to the Google Cloud project, so the YouTube account ref
 * is the OAuth client ref — two channels sharing one client share one budget.
 */
import db from '../db/sqlite';

export const DEFERRED_CODE = 'RELEASE_DEFERRED';

function envInt(name, fallback) {
  const value = Number.parseInt(globalThis.process?.env?.[name] ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Unit accounting per destination. Costs are the YouTube Data API v3 list
 * prices: videos.insert = 1,600; channels.list and playlistItems.list = 1.
 * The API uploader verifies the channel (1) before inserting (1,600).
 */
const DESTINATIONS = {
  youtube: {
    label: 'YouTube Data API',
    timeZone: 'America/Los_Angeles',
    resetLabel: '00:00 PT',
    dailyUnits: () => envInt('YOUTUBE_DAILY_QUOTA_UNITS', 10_000),
    uploadUnits: () => envInt('YOUTUBE_UPLOAD_UNITS', 1_601),
    reconcileUnits: () => envInt('YOUTUBE_RECONCILE_UNITS', 2),
    // Only the Data API spends quota. Per-job methods are decided by the
    // adapter (releaseUpload's `budgeted`); this is the display default.
    budgeted: () => ['', 'api'].includes(String(globalThis.process?.env?.YOUTUBE_UPLOAD_METHOD || '').trim().toLowerCase()),
  },
};

export function getDestinationPolicy(destinationId) {
  return DESTINATIONS[destinationId] || null;
}

export function isBudgeted(destinationId) {
  const policy = getDestinationPolicy(destinationId);
  return Boolean(policy && policy.budgeted());
}

function nowIso() {
  return new Date().toISOString();
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  const offset = get('timeZoneName').match(/GMT([+-])(\d{2}):?(\d{2})?/);
  const offsetMinutes = offset
    ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3] || 0))
    : 0;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, offsetMinutes };
}

/** The destination's quota day (e.g. the Pacific calendar date for YouTube). */
export function budgetDay(destinationId, at = new Date()) {
  const policy = getDestinationPolicy(destinationId);
  return zonedParts(at, policy?.timeZone || 'UTC').day;
}

/** The UTC instant the destination's current quota day ends. DST-safe. */
export function nextResetAt(destinationId, at = new Date()) {
  const timeZone = getDestinationPolicy(destinationId)?.timeZone || 'UTC';
  const { day } = zonedParts(at, timeZone);
  const [year, month, date] = day.split('-').map(Number);
  const midnightUtc = Date.UTC(year, month - 1, date + 1, 0, 0, 0);
  // Guess with today's offset, then correct with the offset in force at the guess.
  let candidate = midnightUtc - zonedParts(at, timeZone).offsetMinutes * 60_000;
  candidate = midnightUtc - zonedParts(new Date(candidate), timeZone).offsetMinutes * 60_000;
  return new Date(candidate).toISOString();
}

function readRow(destinationId, accountRef, day) {
  return db.prepare(`
    SELECT * FROM destination_budgets WHERE destination_id = ? AND account_ref = ? AND day = ?
  `).get(destinationId, accountRef, day);
}

function publicBudget(destinationId, accountRef, row, at = new Date()) {
  const policy = getDestinationPolicy(destinationId);
  const dailyUnits = policy ? policy.dailyUnits() : 0;
  const unitCost = policy ? policy.uploadUnits() : 0;
  const usedUnits = Number(row?.used_units) || 0;
  const remainingUnits = Math.max(0, dailyUnits - usedUnits);
  return {
    destinationId,
    label: policy?.label || destinationId,
    accountRef,
    day: budgetDay(destinationId, at),
    dailyUnits,
    usedUnits,
    remainingUnits,
    unitCost,
    uploadsRemaining: unitCost > 0 ? Math.floor(remainingUnits / unitCost) : null,
    resetAt: nextResetAt(destinationId, at),
    resetLabel: policy?.resetLabel || '00:00 UTC',
    updatedAt: row?.updated_at || '',
  };
}

export function getBudget(destinationId, accountRef, at = new Date()) {
  const ref = String(accountRef || 'default');
  return publicBudget(destinationId, ref, readRow(destinationId, ref, budgetDay(destinationId, at)), at);
}

function writeUnits(destinationId, accountRef, day, units, at) {
  const policy = getDestinationPolicy(destinationId);
  db.prepare(`
    INSERT INTO destination_budgets (destination_id, account_ref, day, unit_cost, daily_units, used_units, reset_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(destination_id, account_ref, day) DO UPDATE SET
      used_units = destination_budgets.used_units + excluded.used_units,
      unit_cost = excluded.unit_cost,
      daily_units = excluded.daily_units,
      reset_at = excluded.reset_at,
      updated_at = excluded.updated_at
  `).run(
    destinationId, accountRef, day, policy.uploadUnits(), policy.dailyUnits(),
    units, nextResetAt(destinationId, at), nowIso(),
  );
}

/**
 * Reserve units for one upload. Must be called inside the caller's transaction
 * when paired with a receipt claim, so a refused reservation leaves no receipt.
 *
 * @returns {{ok: true, budget} | {ok: false, budget, reason, nextEligibleAt}}
 */
export function reserve(destinationId, accountRef, units = null, at = new Date()) {
  const policy = getDestinationPolicy(destinationId);
  const ref = String(accountRef || 'default');
  // Whether THIS upload is budgeted is the caller's call (per-job method);
  // the governor only keeps the ledger.
  if (!policy) return { ok: true, budget: null, units: 0 };
  const cost = units === null ? policy.uploadUnits() : Math.max(0, Number(units) || 0);
  const day = budgetDay(destinationId, at);
  const current = publicBudget(destinationId, ref, readRow(destinationId, ref, day), at);
  if (current.usedUnits + cost > current.dailyUnits) {
    return {
      ok: false,
      budget: current,
      units: cost,
      nextEligibleAt: current.resetAt,
      reason: `${policy.label} budget spent (${current.usedUnits.toLocaleString('en-US')} / ${current.dailyUnits.toLocaleString('en-US')} units, `
        + `upload needs ${cost.toLocaleString('en-US')}). Resets ${current.resetLabel}.`,
    };
  }
  writeUnits(destinationId, ref, day, cost, at);
  return { ok: true, units: cost, budget: getBudget(destinationId, ref, at) };
}

/**
 * Record units that were spent regardless of the ceiling (a reconcile lookup is
 * a few units and must not be refused — it is what prevents a 1,600-unit
 * duplicate).
 */
export function charge(destinationId, accountRef, units, at = new Date()) {
  const policy = getDestinationPolicy(destinationId);
  if (!policy) return null;
  const cost = Math.max(0, Number(units) || 0);
  if (!cost) return getBudget(destinationId, accountRef, at);
  const ref = String(accountRef || 'default');
  writeUnits(destinationId, ref, budgetDay(destinationId, at), cost, at);
  return getBudget(destinationId, ref, at);
}

/**
 * The destination itself said the budget is gone (e.g. YouTube quotaExceeded).
 * Trust the platform over the ledger: saturate today's row so every other job
 * defers instead of spending an attempt to learn the same thing.
 */
export function markExhausted(destinationId, accountRef, at = new Date()) {
  const policy = getDestinationPolicy(destinationId);
  if (!policy) return null;
  const ref = String(accountRef || 'default');
  const day = budgetDay(destinationId, at);
  const current = publicBudget(destinationId, ref, readRow(destinationId, ref, day), at);
  const missing = Math.max(0, current.dailyUnits - current.usedUnits);
  if (missing) writeUnits(destinationId, ref, day, missing, at);
  return getBudget(destinationId, ref, at);
}

export function isQuotaExhaustedError(error) {
  return /quotaExceeded|dailyLimitExceeded|exceeded your quota|uploadLimitExceeded/i.test(String(error?.message || error || ''));
}

export class DeferredError extends Error {
  constructor(message, { nextEligibleAt, reason = message } = {}) {
    super(message);
    this.name = 'DeferredError';
    this.code = DEFERRED_CODE;
    this.nextEligibleAt = nextEligibleAt;
    this.reason = reason;
  }
}

/** Every budget row for today (per destination day) plus configured accounts. */
export function listBudgets(accountRefsByDestination = {}, at = new Date()) {
  const rows = [];
  for (const destinationId of Object.keys(DESTINATIONS)) {
    if (!isBudgeted(destinationId)) continue;
    const day = budgetDay(destinationId, at);
    const stored = db.prepare('SELECT account_ref FROM destination_budgets WHERE destination_id = ? AND day = ?').all(destinationId, day)
      .map((row) => row.account_ref);
    const refs = new Set([...(accountRefsByDestination[destinationId] || []), ...stored].filter(Boolean));
    for (const ref of refs) rows.push(getBudget(destinationId, ref, at));
  }
  return rows;
}
