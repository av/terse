#!/usr/bin/env node
'use strict';

// What the hook would say, on demand. Useful for checking thresholds without
// waiting to hit one, and for seeing the numbers the model is being given.

const usage = require('./usage');
const config = require('./config');
const nudge = require('./nudge');

function pad(value, width) {
  const text = String(value);
  return text + ' '.repeat(Math.max(0, width - text.length));
}

function status(cfg, asJson) {
  const reading = usage.read();

  if (asJson) {
    const built = nudge.build(reading, cfg);
    process.stdout.write(JSON.stringify({ reading, nudge: built }, null, 2) + '\n');
    return reading.ok ? 0 : 1;
  }

  if (!reading.ok) {
    process.stdout.write(
      `No usage snapshot found (${reading.reason}).\n` +
        'Claude Code writes one to ~/.claude.json after a request. Run a prompt and try again.\n'
    );
    return 1;
  }

  const lines = [''];
  lines.push(`  ${pad('Window', 16)}${pad('Used', 8)}${pad('Elapsed', 10)}${pad('Resets in', 12)}`);
  for (const window of reading.windows) {
    const elapsed = window.elapsedPct === null ? '-' : `${Math.round(window.elapsedPct)}%`;
    lines.push(
      `  ${pad(window.label, 16)}${pad(`${Math.round(window.usedPct)}%`, 8)}${pad(elapsed, 10)}` +
        pad(usage.formatDuration(window.remainingMs), 12) +
        (window === reading.binding ? '  <- binding' : '')
    );
  }

  lines.push('');
  lines.push(`  Snapshot  ${usage.formatDuration(reading.ageMs)} old, from ${reading.file}`);
  lines.push(`  Config    ${config.configFile()}`);
  lines.push('');

  const built = nudge.build(reading, cfg);
  if (built) {
    lines.push(`  Injecting (${built.level}):`);
    lines.push('');
    for (const line of built.text.split('\n')) lines.push(`    ${line}`);
  } else {
    const next = cfg.tiers[0];
    lines.push(`  Injecting nothing. First tier is ${next.at}%.`);
  }
  lines.push('');

  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  const command = args.find((a) => !a.startsWith('-')) || 'status';
  const cfg = config.load();

  if (command === 'status') return status(cfg, args.includes('--json'));

  process.stdout.write('usage: terse status [--json]\n');
  return 1;
}

process.exit(main());
