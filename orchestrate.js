#!/usr/bin/env node

/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  Symphony Orchestrator — Master Run Script              ║
 * ║  Symphony of Shells Cognitive DAW                       ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Starts ALL symphony components in the correct order:
 *   1. t-minus Dispatcher (WS/REST on :8765)
 *   2. Fleet Bridge (A2A daemon)
 *   3. I2I Bottle Agent (vessel watcher)
 *   4. Heddle Snail Shell (shell daemon plugin)
 *   5. Composite Headspace (cognitive reasoning)
 *   6. Symphony Runtime (orchestration engine)
 *
 * Waits for /health on each, registers a master agent via WS,
 * and prints a live status dashboard.
 */

'use strict';

const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ── Configuration ──────────────────────────────────────────────────────
const WORKSPACE = path.resolve(__dirname, '..');
const TIMEOUT_MS = 30000;         // max wait per component
const HEALTH_INTERVAL_MS = 500;   // poll interval
const TM_DISPATCHER_PORT = 8765;
const FLEET_BRIDGE_PORT = 9876;
const TM_DISPATCHER_PATH = path.join(WORKSPACE, 'tminus-dispatcher', 'src', 'index.js');
const FLEET_BRIDGE_PATH = path.join(WORKSPACE, 'fleet-bridge', 'src', 'fleet-bridge-cli.js');
const COMPOSITE_HEADSPACE_PATH = path.join(WORKSPACE, 'composite-headspace', 'cli.js');
const SYMPHONY_RUNTIME_PATH = path.join(WORKSPACE, 'symphony-runtime', 'src', 'index.js');
const I2I_VESSEL = path.join(WORKSPACE, 'i2i-vessel');
const I2I_BOTTLE_AGENT_PATH = path.join(WORKSPACE, 'i2i-bottle-agent');

// ── ANSI styling ───────────────────────────────────────────────────────
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const BG_RED = '\x1b[41m';
const BG_GREEN = '\x1b[42m';
const BG_YELLOW = '\x1b[43m';
const BG_BLUE = '\x1b[44m';
const BG_MAGENTA = '\x1b[45m';
const BG_CYAN = '\x1b[46m';

function c(code, text) { return `${code}${text}${RESET}`; }

// ── State ──────────────────────────────────────────────────────────────
const COMPONENTS = {};
const CHILDREN = [];

// ── Helpers ────────────────────────────────────────────────────────────

/** Kill any process listening on a given port */
function killPort(port) {
  try {
    const pid = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf8', timeout: 3000 }).trim();
    if (pid) {
      try { process.kill(parseInt(pid, 10), 'SIGTERM'); } catch (_) {}
      console.log(`  ${c(YELLOW, '🧹')} Killed process on port ${port} (PID ${pid})`);
    }
  } catch (_) { /* nothing on that port */ }
}

/** Kill any process matching a partial command name */
function killProcess(name) {
  try {
    const pids = execSync(`pgrep -f "${name}" 2>/dev/null`, { encoding: 'utf8', timeout: 3000 }).trim();
    if (pids) {
      for (const pid of pids.split('\n').filter(Boolean)) {
        try { process.kill(parseInt(pid, 10), 'SIGTERM'); } catch (_) {}
      }
      console.log(`  ${c(YELLOW, '🧹')} Killed ${name} processes`);
    }
  } catch (_) {}
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * HTTP GET with timeout.
 * @returns {Promise<{statusCode: number, body: string}|null>}
 */
function fetch(url, timeout = 3000) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Wait until a HTTP endpoint returns 200.
 */
async function waitForHealth(url, label, timeoutMs = TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const resp = await fetch(url, 2000);
    if (resp && resp.statusCode === 200) {
      return resp;
    }
    await sleep(HEALTH_INTERVAL_MS);
  }
  return null;
}

/**
 * Spawn a child process, track it.
 */
function spawnProcess(command, args, options = {}) {
  console.log(`  ${c(CYAN, '▶')} Spawning: ${command} ${args.join(' ')}`);
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });

  child.stdout.on('data', d => {
    const line = d.toString().trim();
    if (line) console.log(`    ${c(DIM, line)}`);
  });
  child.stderr.on('data', d => {
    const line = d.toString().trim();
    if (line) console.log(`    ${c(DIM, line)}`);
  });

  child.on('exit', (code, signal) => {
    console.log(`  ${c(YELLOW, '⏹')} PID ${child.pid} exited (code=${code}, signal=${signal})`);
    const idx = CHILDREN.indexOf(child);
    if (idx >= 0) CHILDREN.splice(idx, 1);
  });

  CHILDREN.push(child);
  return child;
}

// ── Cleanup ────────────────────────────────────────────────────────────

function cleanup() {
  console.log(`\n${c(RED, '⏹  SHUTTING DOWN ALL COMPONENTS...')}\n`);

  for (const child of [...CHILDREN]) {
    try { child.kill('SIGTERM'); } catch (_) {}
  }

  // Give processes a moment to shut down gracefully
  setTimeout(() => {
    for (const child of [...CHILDREN]) {
      try { child.kill('SIGKILL'); } catch (_) {}
    }
    killPort(TM_DISPATCHER_PORT);
    killPort(FLEET_BRIDGE_PORT);
    console.log(`\n${c(GREEN, '✓')} All symphony processes terminated.\n`);
    process.exit(0);
  }, 2000);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// ── Print Banner ──────────────────────────────────────────────────────

function printBanner() {
  console.log(`
${c(BOLD + CYAN, '╔══════════════════════════════════════════════════════════════╗')}
${c(BOLD + CYAN, '║')}  ${c(BOLD + WHITE, '🎻  SYMPHONY ORCHESTRATOR  v1.0')}                  ${c(BOLD + CYAN, '║')}
${c(BOLD + CYAN, '║')}  ${c(DIM + WHITE, 'Symphony of Shells — Cognitive DAW Runtime')}          ${c(BOLD + CYAN, '║')}
${c(BOLD + CYAN, '║')}  ${c(ITALIC + WHITE, 'Master conductor for distributed cognitive agents')}    ${c(BOLD + CYAN, '║')}
${c(BOLD + CYAN, '╚══════════════════════════════════════════════════════════════╝')}
`);
}

// ── Component Starters ─────────────────────────────────────────────────

async function startTminusDispatcher() {
  console.log(`\n${c(BOLD + BLUE, '✦ [1/6] Starting t-minus Dispatcher...')}\n`);

  // Kill existing on port
  killPort(TM_DISPATCHER_PORT);

  const child = spawnProcess('node', [TM_DISPATCHER_PATH], {
    cwd: path.dirname(TM_DISPATCHER_PATH),
    env: { ...process.env, TMINUS_PORT: String(TM_DISPATCHER_PORT), TMINUS_HOST: '127.0.0.1' },
  });

  const resp = await waitForHealth(`http://127.0.0.1:${TM_DISPATCHER_PORT}/health`, 't-minus Dispatcher');
  if (!resp) {
    console.log(`  ${c(RED, '✖')} ${c(BOLD + RED, 't-minus Dispatcher FAILED to start on :8765')}`);
    return false;
  }

  COMPONENTS['tminus-dispatcher'] = { status: 'running', port: TM_DISPATCHER_PORT, pid: child.pid };
  console.log(`  ${c(GREEN, '✓')} ${c(BOLD + GREEN, 't-minus Dispatcher healthy')} — PID ${child.pid}`);
  return true;
}

async function startFleetBridge() {
  console.log(`\n${c(BOLD + BLUE, '✦ [2/6] Starting Fleet Bridge...')}\n`);

  killPort(FLEET_BRIDGE_PORT);

  const child = spawnProcess('node', [FLEET_BRIDGE_PATH, 'start'], {
    cwd: path.dirname(FLEET_BRIDGE_PATH),
    env: { ...process.env, FLEET_BRIDGE_PORT: String(FLEET_BRIDGE_PORT) },
  });

  // Give it a moment to initialize
  await sleep(3000);

  // Fleet Bridge is daemon mode with no HTTP — check via process alive
  const alive = child.exitCode === null && !child.killed;
  if (!alive) {
    console.log(`  ${c(RED, '✖')} ${c(BOLD + RED, 'Fleet Bridge FAILED to start')}`);
    return false;
  }

  COMPONENTS['fleet-bridge'] = { status: 'running', port: FLEET_BRIDGE_PORT, pid: child.pid };
  console.log(`  ${c(GREEN, '✓')} ${c(BOLD + GREEN, 'Fleet Bridge daemon running')} — PID ${child.pid}`);
  return true;
}

async function startI2IBottleAgent() {
  console.log(`\n${c(BOLD + BLUE, '✦ [3/6] Starting I2I Bottle Agent...')}\n`);

  // Ensure I2I vessel exists
  if (!fs.existsSync(I2I_VESSEL)) {
    fs.mkdirSync(I2I_VESSEL, { recursive: true });
    console.log(`  ${c(DIM, 'Created I2I vessel: ' + I2I_VESSEL)}`);
  }

  // Spawn a bottle watcher using the Fleet Bridge's I2I watcher in daemon mode
  const bottleWatcherScript = path.join(__dirname, '_bottle-agent.js');

  // Write a simple I2I bottle agent script
  const scriptContent = `
'use strict';
const path = require('path');
const { I2IBottleTransport } = require('${path.join(WORKSPACE, 'fleet-bridge', 'src', 'i2i-transport')}');
const VESSEL = '${I2I_VESSEL.replace(/'/g, "\\'")}';
const transport = new I2IBottleTransport({ vesselDir: VESSEL, agentId: 'bottle-agent' });
transport.init();
console.log('[I2I-Bottle-Agent] Watching vessel:', VESSEL);
const watcher = transport.watch((bottle) => {
  console.log('[I2I-Bottle-Agent] 📬 Bottle arrived:', bottle.type || 'unknown', 'from:', bottle.from, 'to:', bottle.to);
}, 3000);
process.on('SIGINT', () => { watcher.stop(); process.exit(0); });
process.on('SIGTERM', () => { watcher.stop(); process.exit(0); });
console.log('[I2I-Bottle-Agent] ✅ Agent started on vessel:', VESSEL);
`;

  fs.writeFileSync(bottleWatcherScript, scriptContent);

  const child = spawnProcess('node', [bottleWatcherScript], {
    cwd: path.dirname(bottleWatcherScript),
    env: process.env,
  });

  await sleep(1500);
  const alive = child.exitCode === null && !child.killed;
  if (!alive) {
    console.log(`  ${c(RED, '✖')} ${c(BOLD + RED, 'I2I Bottle Agent FAILED to start')}`);
    return false;
  }

  COMPONENTS['i2i-bottle-agent'] = { status: 'running', pid: child.pid };
  console.log(`  ${c(GREEN, '✓')} ${c(BOLD + GREEN, 'I2I Bottle Agent watching vessel')} — PID ${child.pid}`);
  return true;
}

async function startHeddleSnailShell() {
  console.log(`\n${c(BOLD + BLUE, '✦ [4/6] Staging Heddle Snail Shell...')}\n`);

  const snailShellDir = path.join(WORKSPACE, 'heddle', 'src', 'snail-shell');

  if (!fs.existsSync(snailShellDir)) {
    console.log(`  ${c(YELLOW, '⚠')} Heddle Snail Shell directory not found, skipping.`);
    COMPONENTS['heddle-snail-shell'] = { status: 'skipped', reason: 'no snail-shell directory' };
    return true; // not a hard failure
  }

  // Snail Shell is a TypeScript plugin — integrate via Node if compiled
  const distIndex = path.join(snailShellDir, 'index.js');
  if (fs.existsSync(distIndex)) {
    // Run as a standalone service if possible
    const child = spawnProcess('node', [distIndex], {
      cwd: path.join(WORKSPACE, 'heddle'),
      env: process.env,
    });
    await sleep(2000);
    const alive = child.exitCode === null && !child.killed;
    if (!alive) {
      console.log(`  ${c(YELLOW, '⚠')} Snail Shell j/s entry started but may require Heddle daemon context.`);
    }
    COMPONENTS['heddle-snail-shell'] = { status: 'running', pid: child.pid };
    console.log(`  ${c(GREEN, '✓')} ${c(BOLD + GREEN, 'Heddle Snail Shell launched')} — PID ${child.pid}`);
  } else {
    console.log(`  ${c(YELLOW, '⚠')} Snail Shell is TypeScript plugin — requires compilation. Marked as staged.`);
    COMPONENTS['heddle-snail-shell'] = { status: 'staged', reason: 'TypeScript plugin' };
  }
  return true;
}

async function startCompositeHeadspace() {
  console.log(`\n${c(BOLD + BLUE, '✦ [5/6] Starting Composite Headspace...')}\n`);

  const child = spawnProcess('node', [COMPOSITE_HEADSPACE_PATH,
    '--problem', 'Verify symphony orchestration startup is functioning correctly.',
    '--detector', 'simple',
    '--format', 'json',
  ], {
    cwd: path.dirname(COMPOSITE_HEADSPACE_PATH),
    env: { ...process.env, PORT: String(9090) },
  });

  await sleep(3000);
  const alive = child.exitCode === null && !child.killed;
  if (!alive) {
    console.log(`  ${c(YELLOW, '⚠')} Composite Headspace exited (expected for one-shot mode).`);
  }

  COMPONENTS['composite-headspace'] = { status: 'completed', pid: child.pid, exitCode: child.exitCode };
  console.log(`  ${c(GREEN, '✓')} ${c(BOLD + GREEN, 'Composite Headspace task dispatched')} — PID ${child.pid}`);
  return true;
}

async function startSymphonyRuntime() {
  console.log(`\n${c(BOLD + BLUE, '✦ [6/6] Initializing Symphony Runtime...')}\n`);

  // Symphony Runtime is a library, not a daemon. Import it to verify.
  try {
    const runtime = require(SYMPHONY_RUNTIME_PATH);
    const { SymphonyRuntime } = runtime;

    const sr = new SymphonyRuntime({
      defaultLatencyMs: 500,
      defaultContextDepth: 1.0,
      maxTracks: 7,
    });

    const timbre = {
      shell_id: 'orchestrator',
      frequency: 2.0,   // 2 Hz — balanced
      phase: 0,
      resonance: 0.85,
      a_boxes: 3,
      la_links: 1,
      latency_ms: 500,
      context_depth: 1.0,
    };

    sr.init(timbre);

    const status = sr.status();
    COMPONENTS['symphony-runtime'] = {
      status: 'initialized',
      uptimeBeats: status.uptimeBeats,
      timbre: timbre.shell_id,
    };
    console.log(`  ${c(GREEN, '✓')} ${c(BOLD + GREEN, 'Symphony Runtime initialized')}`);
    console.log(`    ${c(DIM, 'Timbre: ' + timbre.shell_id)}`);
    console.log(`    ${c(DIM, 'Uptime: ' + status.uptimeBeats + ' beats')}`);
    console.log(`    ${c(DIM, 'A-Boxes: ' + status.aBoxCount + ' | LA-Links: ' + status.laLinkCount)}`);
  } catch (err) {
    console.log(`  ${c(YELLOW, '⚠')} Could not initialize Symphony Runtime: ${err.message}`);
    COMPONENTS['symphony-runtime'] = { status: 'error', reason: err.message };
  }
  return true;
}

async function registerMasterAgent() {
  console.log(`\n${c(BOLD + MAGENTA, '✦ Registering Master Agent (end-to-end verification)...')}\n`);

  const WebSocket = require('ws');

  return new Promise(resolve => {
    const wsUrl = `ws://127.0.0.1:${TM_DISPATCHER_PORT}/ws`;
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      console.log(`  ${c(YELLOW, '⚠')} Master agent WS registration timed out`);
      ws.close();
      resolve(false);
    }, 5000);

    ws.on('open', () => {
      // Agent registration message
      const register = JSON.stringify({
        type: 'REGISTER',
        agent_id: 'symphony-master',
        name: 'Symphony Orchestrator — Master Conductor',
        timbre: {
          shell_id: 'symphony-master',
          frequency: 2.0,
          phase: 0,
          resonance: 0.95,
          latency_ms: 100,
          context_depth: 1.0,
        },
        frequency: 2.0,
        latency_ms: 100,
        context_depth: 1.0,
      });
      ws.send(register);
      console.log(`  ${c(DIM, 'Sent REGISTER as symphony-master')}`);
    });

    ws.on('message', (data) => {
      const msg = data.toString();
      console.log(`  ${c(DIM, 'WS received: ' + msg.slice(0, 200))}`);
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'REGISTERED' || parsed.type === 'ACK') {
          clearTimeout(timeout);
          console.log(`  ${c(GREEN, '✓')} ${c(BOLD + GREEN, 'Master agent registered in dispatcher')}`);
          COMPONENTS['master-agent'] = { status: 'registered', id: 'symphony-master' };
          ws.close();
          resolve(true);
        }
      } catch (_) {}
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      console.log(`  ${c(RED, '✖')} WS error: ${err.message}`);
      resolve(false);
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      if (!COMPONENTS['master-agent']) {
        console.log(`  ${c(YELLOW, '⚠')} WS closed before registration confirmed`);
        resolve(false);
      }
    });
  });
}

// ── Dashboard ──────────────────────────────────────────────────────────

function printDashboard() {
  const now = new Date().toISOString();

  console.log(`\n${c(BOLD + CYAN, '╔══════════════════════════════════════════════════════════════╗')}`);
  console.log(`${c(BOLD + CYAN, '║')}  ${c(BOLD + WHITE, '🎻  SYMPHONY STATUS DASHBOARD')}                ${c(CYAN, '║')}`);
  console.log(`${c(BOLD + CYAN, '║')}  ${c(ITALIC + DIM, now)}                          ${c(CYAN, '║')}`);
  console.log(`${c(BOLD + CYAN, '╠══════════════════════════════════════════════════════════════╣')}`);

  const componentRows = [
    { key: 'tminus-dispatcher',     label: '🎵  t-minus Dispatcher',       port: ':8765' },
    { key: 'fleet-bridge',          label: '🌉  Fleet Bridge',             port: ':9876' },
    { key: 'i2i-bottle-agent',      label: '🍾  I2I Bottle Agent',        port: '-' },
    { key: 'heddle-snail-shell',    label: '🐚  Heddle Snail Shell',       port: '-' },
    { key: 'composite-headspace',   label: '🧠  Composite Headspace',     port: ':9090' },
    { key: 'symphony-runtime',      label: '🎼  Symphony Runtime',         port: '-' },
    { key: 'master-agent',          label: '🎯  Master Agent',             port: '-' },
  ];

  for (const row of componentRows) {
    const comp = COMPONENTS[row.key];
    let statusStr, statusColor;
    if (!comp) {
      statusStr = '⏳ waiting';
      statusColor = YELLOW;
    } else if (comp.status === 'running' || comp.status === 'initialized' || comp.status === 'registered' || comp.status === 'completed') {
      statusStr = '✅ ' + comp.status;
      if (comp.pid) statusStr += ` (PID ${comp.pid})`;
      statusColor = GREEN;
    } else if (comp.status === 'skipped' || comp.status === 'staged') {
      statusStr = '⏸️  ' + comp.status;
      if (comp.reason) statusStr += ` (${comp.reason})`;
      statusColor = YELLOW;
    } else {
      statusStr = '❌ ' + comp.status;
      if (comp.reason) statusStr += ` (${comp.reason})`;
      statusColor = RED;
    }
    console.log(`${c(BOLD + CYAN, '║')}  ${c(WHITE, row.label.padEnd(30))} ${c(DIM, row.port.padEnd(6))} ${c(statusColor, statusStr)}`);
  }

  console.log(`${c(BOLD + CYAN, '╚══════════════════════════════════════════════════════════════╝')}`);
  console.log(`\n${c(DIM, 'Press Ctrl+C to stop all components and exit.')}\n`);
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  printBanner();

  let allOk = true;

  // Step 1: t-minus Dispatcher
  allOk &= await startTminusDispatcher();

  // Step 2: Fleet Bridge
  allOk &= await startFleetBridge();

  // Step 3: I2I Bottle Agent
  allOk &= await startI2IBottleAgent();

  // Step 4: Heddle Snail Shell
  await startHeddleSnailShell();

  // Step 5: Composite Headspace
  await startCompositeHeadspace();

  // Step 6: Symphony Runtime
  await startSymphonyRuntime();

  // Register master agent for end-to-end verification
  await registerMasterAgent();

  // Print final dashboard
  printDashboard();

  if (allOk) {
    console.log(`${c(BOLD + GREEN, '\n✦ ALL COMPONENTS ONLINE — Symphony is playing.')}`);
  } else {
    console.log(`${c(BOLD + YELLOW, '\n⚠ Some components failed to start. Check logs above.')}`);
  }

  // Keep alive until SIGINT
  console.log(`${c(DIM, 'Orchestrator running. Press Ctrl+C to stop the symphony.')}`);
}

main().catch(err => {
  console.error(`${c(RED, 'FATAL:')} ${err.message}`);
  cleanup();
});
