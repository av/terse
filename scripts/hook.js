#!/usr/bin/env node
'use strict';

// Hook entrypoint. Reads the hook payload on stdin, writes at most a few lines
// on stdout. Every failure path here is silent: a usage nudge is never worth
// breaking a prompt over, so anything unexpected exits 0 with no output.

const usage = require('./usage');
const config = require('./config');
const nudge = require('./nudge');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve(data);
      }
    };
    // If nothing is piped in, do not hang the prompt waiting for it.
    const timer = setTimeout(finish, 2000);
    timer.unref?.();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      finish();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      finish();
    });
  });
}

function eventName(payload, argv) {
  const flag = argv.indexOf('--event');
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1];
  return payload.hook_event_name || 'UserPromptSubmit';
}

// UserPromptSubmit: stdout is appended to the model's context for this turn.
function onPrompt(cfg) {
  const result = nudge.build(usage.read(), cfg);
  if (result) process.stdout.write(result.text + '\n');
}

// PreToolUse: the hard edge, opt-in. Denies tools whose cost is unbounded once
// the binding window is nearly gone, and tells the model why so it can adapt
// rather than retry.
function onPreTool(cfg, payload) {
  if (!cfg.ceiling.enabled) return;

  const tool = payload.tool_name;
  if (!tool || !cfg.ceiling.tools.includes(tool)) return;

  const reading = usage.read();
  if (!reading.ok) return;

  const silentAfter = cfg.silentAfterMinutes * 60 * 1000;
  if (reading.ageMs !== null && reading.ageMs > silentAfter) return;

  const binding = reading.binding;
  if (binding.usedPct < cfg.ceiling.at) return;

  const reason =
    `${binding.label} limit is ${Math.round(binding.usedPct)}% used` +
    (binding.remainingMs !== null ? `, resets in ${usage.formatDuration(binding.remainingMs)}` : '') +
    `. ${tool} is blocked past ${cfg.ceiling.at}%. Finish with what you already have, ` +
    'or tell the user what is left and stop.';

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }) + '\n'
  );
}

async function main() {
  if (config.disabled()) return;

  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }

  const cfg = config.load();
  const event = eventName(payload, process.argv);

  if (event === 'PreToolUse') onPreTool(cfg, payload);
  else onPrompt(cfg);
}

main().catch(() => {
  // Silent by design. See the note at the top of the file.
  process.exit(0);
});
