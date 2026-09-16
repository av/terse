'use strict';

// Reads the usage snapshot Claude Code already keeps for itself.
//
// ~/.claude.json holds `cachedUsageUtilization`, refreshed by the CLI from the
// account usage endpoint. Same numbers `/usage` draws its bars from. We do not
// recount tokens from transcripts: the account is the source of truth, and a
// local recount drifts from it the moment another machine or a subagent spends.
//
//   cachedUsageUtilization: {
//     fetchedAtMs: 1789339683602,
//     utilization: {
//       five_hour: { utilization: 0,  resets_at: "...", limit_dollars: null, ... },
//       seven_day: { utilization: 62, resets_at: "...", ... },
//       seven_day_opus: null, seven_day_sonnet: null, ...
//     }
//   }

const fs = require('fs');
const os = require('os');
const path = require('path');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Window spans, needed to turn `resets_at` into "how far into the window are
// we". A percentage alone cannot say whether 60% is early and alarming or late
// and fine.
const SPANS = {
  five_hour: 5 * HOUR,
  seven_day: 7 * DAY,
  seven_day_opus: 7 * DAY,
  seven_day_sonnet: 7 * DAY,
};

const LABELS = {
  five_hour: '5-hour',
  seven_day: 'weekly',
  seven_day_opus: 'weekly (Opus)',
  seven_day_sonnet: 'weekly (Sonnet)',
};

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// The account file is normally ~/.claude.json, but a CLAUDE_CONFIG_DIR install
// keeps it inside that directory instead. Prefer the scoped one when it
// actually carries a snapshot - some installs leave a stub there.
function accountFiles() {
  return [path.join(configDir(), '.claude.json'), path.join(os.homedir(), '.claude.json')];
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readSnapshot() {
  for (const file of accountFiles()) {
    const data = readJSON(file);
    const cached = data && data.cachedUsageUtilization;
    if (cached && cached.utilization) return { file, cached };
  }
  return null;
}

// One window, normalised: how much is spent, how much of the window has
// elapsed, and whether the first is running ahead of the second.
function readWindow(key, raw, now) {
  if (!raw || typeof raw.utilization !== 'number') return null;
  const span = SPANS[key];
  const resetsAt = raw.resets_at ? Date.parse(raw.resets_at) : NaN;
  const remainingMs = Number.isNaN(resetsAt) ? null : Math.max(0, resetsAt - now);

  // Fraction of the window already gone. A window whose reset has passed reads
  // as fully elapsed; the CLI will refresh it on the next request.
  let elapsedPct = null;
  if (remainingMs !== null && span) {
    elapsedPct = Math.min(100, Math.max(0, ((span - remainingMs) / span) * 100));
  }

  return {
    key,
    label: LABELS[key] || key,
    usedPct: raw.utilization,
    resetsAt: Number.isNaN(resetsAt) ? null : resetsAt,
    remainingMs,
    elapsedPct,
    // Positive means spending faster than the clock: 60% used 30% into the
    // window is +30, and will not last.
    aheadOfPace: elapsedPct === null ? null : raw.utilization - elapsedPct,
    usedDollars: raw.used_dollars,
    remainingDollars: raw.remaining_dollars,
    limitDollars: raw.limit_dollars,
  };
}

function read(now = Date.now()) {
  const snapshot = readSnapshot();
  if (!snapshot) return { ok: false, reason: 'no-snapshot' };

  const { cached, file } = snapshot;
  const windows = Object.keys(SPANS)
    .map((key) => readWindow(key, cached.utilization[key], now))
    .filter(Boolean);

  if (!windows.length) return { ok: false, reason: 'no-windows', file };

  // The binding window is whichever is closest to stopping the work. Nothing
  // else is worth mentioning to the model - it is the one that will bite.
  const binding = windows.reduce((a, b) => (b.usedPct > a.usedPct ? b : a));
  const ageMs = typeof cached.fetchedAtMs === 'number' ? Math.max(0, now - cached.fetchedAtMs) : null;

  return { ok: true, file, ageMs, windows, binding };
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return 'unknown';
  if (ms < MINUTE) return 'under a minute';
  const totalMinutes = Math.round(ms / MINUTE);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

module.exports = { read, formatDuration, LABELS, SPANS, MINUTE, HOUR, DAY };
