'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Config lives outside the plugin so a plugin update never overwrites it.
//   ~/.config/terse/config.json
const DEFAULTS = {
  // Below the first threshold nothing is injected. Silence is the default
  // because a budget line on every prompt is itself a cost.
  tiers: [
    { at: 50, level: 'watch' },
    { at: 75, level: 'tighten' },
    { at: 90, level: 'land' },
  ],
  // A snapshot older than this is reported with its age attached.
  staleAfterMinutes: 45,
  // Older than this and we say nothing: acting on a stale number is worse than
  // acting on none. The CLI refreshes the snapshot on its own as you work.
  silentAfterMinutes: 360,
  // Spending this many points faster than the clock counts as ahead of pace.
  paceSlackPoints: 10,
  // Deny expensive tool calls past this percentage. Off by default - a hook
  // that blocks work is a bigger promise than a hook that talks.
  ceiling: { enabled: false, at: 95, tools: ['WebSearch', 'WebFetch', 'Task'] },
};

function configFile() {
  if (process.env.TERSE_CONFIG) return process.env.TERSE_CONFIG;
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'terse', 'config.json');
}

function load() {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    user = {};
  }
  return {
    ...DEFAULTS,
    ...user,
    tiers: user.tiers || DEFAULTS.tiers,
    ceiling: { ...DEFAULTS.ceiling, ...(user.ceiling || {}) },
  };
}

// One switch that turns the whole thing off without editing config, for the
// sessions where the budget is not the point.
function disabled() {
  const off = process.env.TERSE_OFF;
  return off === '1' || off === 'true';
}

module.exports = { load, configFile, disabled, DEFAULTS };
