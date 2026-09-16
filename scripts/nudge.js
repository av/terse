'use strict';

// Turns a usage reading into the line the model sees.
//
// The point is not to report a percentage. The model can do nothing with "62%".
// It can do something with "the window that will stop you resets in 40 minutes
// and you are spending faster than it refills, so land the edit you have".

const { formatDuration } = require('./usage');

const DIRECTIVES = {
  watch: [
    'Read narrowly: target files and symbols you can name, not whole trees.',
    'Answer in conclusions. Skip recaps, option surveys, and restating the request.',
  ],
  tighten: [
    'No exploratory search. If you cannot name the file, ask instead of hunting.',
    'Batch independent tool calls into one message. Do not re-read files already in context.',
    'Smallest correct diff. No opportunistic refactors, renames, or comment passes.',
  ],
  land: [
    'Finish or checkpoint. Land the smallest change that works, then stop.',
    'Do not open new threads of work, spawn subagents, or start anything you cannot close.',
    'If the task cannot finish in the remaining budget, say so now and write down where it stands.',
  ],
};

function tierFor(config, usedPct) {
  let hit = null;
  for (const tier of config.tiers) {
    if (usedPct >= tier.at) hit = tier;
  }
  return hit;
}

// The header is the whole argument in one sentence: what is binding, how much
// is left, and how long until it refills.
function header(binding, ageMs, config) {
  const parts = [`${binding.label} limit ${Math.round(binding.usedPct)}% used`];

  if (binding.remainingMs !== null) {
    parts.push(`resets in ${formatDuration(binding.remainingMs)}`);
  }
  if (binding.aheadOfPace !== null && binding.aheadOfPace > config.paceSlackPoints) {
    parts.push(`burning ahead of the clock by ${Math.round(binding.aheadOfPace)} points`);
  }
  if (typeof binding.remainingDollars === 'number') {
    parts.push(`$${binding.remainingDollars.toFixed(2)} left`);
  }

  const staleAfter = config.staleAfterMinutes * 60 * 1000;
  if (ageMs !== null && ageMs > staleAfter) {
    parts.push(`snapshot ${formatDuration(ageMs)} old`);
  }

  return parts.join(', ') + '.';
}

// Returns the text to inject, or null to stay quiet.
function build(reading, config) {
  if (!reading.ok) return null;

  const silentAfter = config.silentAfterMinutes * 60 * 1000;
  if (reading.ageMs !== null && reading.ageMs > silentAfter) return null;

  const binding = reading.binding;
  const tier = tierFor(config, binding.usedPct);
  if (!tier) return null;

  const lines = ['<budget>', header(binding, reading.ageMs, config), ''];
  for (const directive of DIRECTIVES[tier.level] || []) lines.push(`- ${directive}`);
  lines.push('');
  lines.push('This is a budget constraint, not a change to what was asked. Do the whole task, spend less doing it.');
  lines.push('</budget>');

  return { level: tier.level, text: lines.join('\n') };
}

module.exports = { build, tierFor, DIRECTIVES };
