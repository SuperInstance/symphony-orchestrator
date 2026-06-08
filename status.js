#!/usr/bin/env node

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  Symphony Status Dashboard                                  ║
 * ║  Polls all components, prints live agent/cue/phase stats    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   node status.js            — One-shot status
 *   node status.js --watch    — Live-updating every 2s
 *   node status.js --help     — Show usage
 */

'use strict';

const http = require('http');
const { execSync } = require('child_process');

// ── ANSI ──────────────────────────────────────────────────────────────
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const ITALIC = '\x1b[3m';
const CLS = '\x1b[2J\x1b[0;0H';

function c(code, text) { return `${code}${text}${RESET}`; }

// ── HTTP Helpers ──────────────────────────────────────────────────────

function fetchJSON(url, timeout = 3000) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ statusCode: res.statusCode, data: null });
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function processAlive(pattern) {
  try {
    const out = execSync(`pgrep -f "${pattern}" 2>/dev/null`, { encoding: 'utf8', timeout: 2000 }).trim();
    return out.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function processPids(pattern) {
  try {
    const out = execSync(`pgrep -f "${pattern}" 2>/dev/null`, { encoding: 'utf8', timeout: 2000 }).trim();
    return out.split('\n').filter(Boolean).map(p => parseInt(p, 10));
  } catch {
    return [];
  }
}

// ── Poll Functions ────────────────────────────────────────────────────

async function pollTminusDispatcher() {
  const resp = await fetchJSON('http://127.0.0.1:8765/health');
  if (!resp || resp.statusCode !== 200) {
    return { status: 'down', error: 'No response on :8765/health' };
  }
  const d = resp.data;
  return {
    status: 'running',
    uptime: d.uptime_ms || 0,
    beats: d.beats || {},
    agents: d.agents || {},
    cues: d.cues || {},
    phase_groups: d.phase_groups || 0,
  };
}

async function pollAgents() {
  const resp = await fetchJSON('http://127.0.0.1:8765/agents');
  if (!resp || resp.statusCode !== 200) {
    return { status: 'down', count: 0, agents: [] };
  }
  return {
    status: 'ok',
    count: resp.data.count || 0,
    agents: resp.data.agents || [],
  };
}

async function pollCues() {
  const resp = await fetchJSON('http://127.0.0.1:8765/cues');
  if (!resp || resp.statusCode !== 200) {
    return { status: 'down', count: 0, cues: [] };
  }
  return {
    status: 'ok',
    count: resp.data.count || 0,
    cues: resp.data.cues || [],
  };
}

async function pollPhaseGroups() {
  const resp = await fetchJSON('http://127.0.0.1:8765/phase-groups');
  if (!resp || resp.statusCode !== 200) {
    return { status: 'down', count: 0, groups: [] };
  }
  return {
    status: 'ok',
    count: resp.data.count || 0,
    groups: resp.data.phase_groups || [],
  };
}

function pollFleetBridge() {
  const pids = processPids('fleet-bridge-cli.js');
  return {
    status: pids.length > 0 ? 'running' : 'down',
    pids,
    count: pids.length,
  };
}

function pollI2IBottleAgent() {
  const pids = processPids('bottle-agent');
  return {
    status: pids.length > 0 ? 'running' : 'down',
    pids,
    count: pids.length,
  };
}

function pollHeddleSnailShell() {
  const pids = processPids('snail-shell');
  return {
    status: pids.length > 0 ? 'running' : 'staged',
    pids,
    count: pids.length,
  };
}

function pollCompositeHeadspace() {
  const pids = processPids('composite-headspace');
  return {
    status: pids.length > 0 ? 'running' : 'completed',
    pids,
    count: pids.length,
  };
}

function pollSymphonyRuntime() {
  // Check if module can be imported
  try {
    const path = require('path');
    const workspace = path.resolve(__dirname, '..');
    const runtime = require(path.join(workspace, 'symphony-runtime', 'src', 'index.js'));
    const { SymphonyRuntime } = runtime;
    const sr = new SymphonyRuntime({});
    const status = sr.status();
    return {
      status: 'available',
      uptimeBeats: status.uptimeBeats,
      aBoxCount: status.aBoxCount,
      laLinkCount: status.laLinkCount,
      headspaceCount: status.headspaceCount,
    };
  } catch {
    return { status: 'unavailable', error: 'Cannot import module' };
  }
}

// ── Formatting ────────────────────────────────────────────────────────

function fmtMs(ms) {
  if (!ms) return '0s';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function badge(status) {
  switch (status) {
    case 'running':
    case 'ok':
    case 'available':
    case 'initialized':
    case 'registered':
    case 'completed':
      return c(GREEN, '●');
    case 'down':
    case 'unavailable':
    case 'error':
      return c(RED, '●');
    default:
      return c(YELLOW, '●');
  }
}

function statusText(status) {
  switch (status) {
    case 'running': return c(GREEN, 'RUNNING');
    case 'ok': return c(GREEN, 'OK');
    case 'available': return c(GREEN, 'AVAILABLE');
    case 'initialized': return c(GREEN, 'INITIALIZED');
    case 'registered': return c(GREEN, 'REGISTERED');
    case 'completed': return c(GREEN, 'COMPLETED');
    case 'staged': return c(YELLOW, 'STAGED');
    case 'down': return c(RED, 'DOWN');
    case 'unavailable': return c(RED, 'UNAVAILABLE');
    case 'error': return c(RED, 'ERROR');
    default: return c(YELLOW, status);
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────

async function collectStatus() {
  const [
    tminus,
    agentsResp,
    cuesResp,
    phasesResp,
    fleet,
    i2i,
    snail,
    headspace,
    runtime,
  ] = await Promise.all([
    pollTminusDispatcher(),
    pollAgents(),
    pollCues(),
    pollPhaseGroups(),
    pollFleetBridge(),
    pollI2IBottleAgent(),
    pollHeddleSnailShell(),
    pollCompositeHeadspace(),
    pollSymphonyRuntime(),
  ]);

  return { tminus, agentsResp, cuesResp, phasesResp, fleet, i2i, snail, headspace, runtime };
}

function printStatus({ tminus, agentsResp, cuesResp, phasesResp, fleet, i2i, snail, headspace, runtime }) {
  // ── Header ───────────────────────────────────────────────────────
  console.log(`${c(BOLD + CYAN, '╔══════════════════════════════════════════════════════════════╗')}`);
  console.log(`${c(BOLD + CYAN, '║')}  ${c(BOLD + WHITE, '🎻  SYMPHONY ORCHESTRA STATUS')}               ${c(CYAN, '║')}`);
  console.log(`${c(BOLD + CYAN, '║')}  ${c(ITALIC + DIM, new Date().toISOString())}                  ${c(CYAN, '║')}`);
  console.log(`${c(BOLD + CYAN, '╠══════════════════════════════════════════════════════════════╣')}`);

  // ── Component Status ─────────────────────────────────────────────
  console.log(`${c(BOLD + CYAN, '║')}  ${c(WHITE, 'COMPONENTS')}                                          ${c(CYAN, '║')}`);

  const tStat = tminus.status;
  const tBadge = badge(tStat);
  const tText = statusText(tStat);
  const tUptime = tStat === 'running' ? fmtMs(tminus.uptime) : '';
  const tExtra = tUptime ? ` (uptime: ${tUptime})` : tminus.error ? ` (${tminus.error})` : '';
  console.log(`${c(BOLD + CYAN, '║')}  ${tBadge} ${c(WHITE, '🎵 t-minus Dispatcher'.padEnd(30))} ${tText}${c(DIM, tExtra)}`);

  const fStat = fleet.status;
  console.log(`${c(BOLD + CYAN, '║')}  ${badge(fStat)} ${c(WHITE, '🌉 Fleet Bridge'.padEnd(30))} ${statusText(fStat)}${fStat === 'running' ? c(DIM, ` (PID ${fleet.pids[0]})`) : ''}`);

  const iStat = i2i.status;
  console.log(`${c(BOLD + CYAN, '║')}  ${badge(iStat)} ${c(WHITE, '🍾 I2I Bottle Agent'.padEnd(30))} ${statusText(iStat)}${iStat === 'running' ? c(DIM, ` (PID ${i2i.pids[0]})`) : ''}`);

  const sStat = snail.status;
  console.log(`${c(BOLD + CYAN, '║')}  ${badge(sStat)} ${c(WHITE, '🐚 Heddle Snail Shell'.padEnd(30))} ${statusText(sStat)}`);

  const hStat = headspace.status;
  console.log(`${c(BOLD + CYAN, '║')}  ${badge(hStat)} ${c(WHITE, '🧠 Composite Headspace'.padEnd(30))} ${statusText(hStat)}`);

  const rStat = runtime.status;
  console.log(`${c(BOLD + CYAN, '║')}  ${badge(rStat)} ${c(WHITE, '🎼 Symphony Runtime'.padEnd(30))} ${statusText(rStat)}${rStat === 'available' ? c(DIM, ` (${runtime.uptimeBeats || 0} beats)`) : ''}`);

  console.log(`${c(BOLD + CYAN, '╠══════════════════════════════════════════════════════════════╣')}`);

  // ── Dispatcher Stats ─────────────────────────────────────────────
  if (tminus.status === 'running') {
    console.log(`${c(BOLD + CYAN, '║')}  ${c(WHITE, 'DISPATCHER STATS')}                                     ${c(CYAN, '║')}`);

    // Agent counts by state
    const byState = tminus.agents.by_state || {};
    const agentStates = Object.entries(byState)
      .filter(([, count]) => count > 0)
      .map(([state, count]) => `${state}: ${c(BOLD, count)}`)
      .join('  ');
    console.log(`${c(BOLD + CYAN, '║')}  ${c(CYAN, '🤖 Agents')}    total=${c(BOLD, tminus.agents.total)}${agentStates ? '  ' + agentStates : ''}`);

    // Cue stats
    const cues = tminus.cues || {};
    console.log(`${c(BOLD + CYAN, '║')}  ${c(CYAN, '📋 Cues')}      total=${c(BOLD, cues.total || 0)}  active=${c(BOLD, cues.active || 0)}  pending=${c(BOLD, cues.pending || 0)}`);

    // Phase groups
    console.log(`${c(BOLD + CYAN, '║')}  ${c(CYAN, '🎯 Phase Groups')}  ${c(BOLD, tminus.phase_groups || 0)}  groups`);

    // Beat engine
    const beats = tminus.beats || {};
    console.log(`${c(BOLD + CYAN, '║')}  ${c(CYAN, '💓 Beats')}     count=${c(BOLD, beats.count || 0)}  rate=${c(BOLD, (beats.rate || '?') + ' Hz')}`);
  }

  console.log(`${c(BOLD + CYAN, '╠══════════════════════════════════════════════════════════════╣')}`);

  // ── Agent Details ────────────────────────────────────────────────
  if (agentsResp.status === 'ok' && agentsResp.count > 0) {
    console.log(`${c(BOLD + CYAN, '║')}  ${c(WHITE, 'REGISTERED AGENTS')}                                   ${c(CYAN, '║')}`);
    for (const agent of agentsResp.agents) {
      const connIcon = agent.connected ? c(GREEN, '●') : c(YELLOW, '○');
      const stateIcon = agent.state === 'LISTENING' ? c(DIM, '🎧') :
                        agent.state === 'CUED' ? c(BLUE, '⏰') :
                        agent.state === 'PRIMED' ? c(YELLOW, '⚡') :
                        agent.state === 'ACTIVE' ? c(GREEN, '▶') :
                        agent.state === 'COMPLETE' ? c(DIM, '✓') : '?';
      console.log(`${c(BOLD + CYAN, '║')}  ${connIcon} ${stateIcon} ${c(WHITE, agent.name || agent.id)}${c(DIM, '  freq=' + (agent.frequency || '?'))}${c(DIM, '  lat=' + agent.latency_ms + 'ms')}${c(DIM, agent.phase_groups ? '  groups=[' + agent.phase_groups.join(',') + ']' : '')}`);
    }
  } else {
    console.log(`${c(BOLD + CYAN, '║')}  ${c(DIM, 'No agents registered')}                                ${c(CYAN, '║')}`);
  }

  // ── Active Cues ──────────────────────────────────────────────────
  if (cuesResp.status === 'ok' && cuesResp.count > 0) {
    console.log(`${c(BOLD + CYAN, '╠══════════════════════════════════════════════════════════════╣')}`);
    console.log(`${c(BOLD + CYAN, '║')}  ${c(WHITE, 'ACTIVE CUES')}                                       ${c(CYAN, '║')}`);
    for (const cue of cuesResp.cues.slice(0, 10)) {
      const remaining = cue.offset_beats || cue.countdown || 0;
      console.log(`${c(BOLD + CYAN, '║')}  ${c(DIM, '⏰')} ${cue.id}  ${c(DIM, cue.source_id + ' → ' + cue.target_id)}  ${c(DIM, 'remaining: ' + remaining + ' beats')}`);
    }
    if (cuesResp.count > 10) {
      console.log(`${c(BOLD + CYAN, '║')}  ${c(DIM, `... and ${cuesResp.count - 10} more`)}`);
    }
  }

  // ── Phase Groups ─────────────────────────────────────────────────
  if (phasesResp.status === 'ok' && phasesResp.count > 0) {
    console.log(`${c(BOLD + CYAN, '╠══════════════════════════════════════════════════════════════╣')}`);
    console.log(`${c(BOLD + CYAN, '║')}  ${c(WHITE, 'PHASE GROUPS')}                                      ${c(CYAN, '║')}`);
    for (const g of phasesResp.groups) {
      const stateIcon = g.state === 'aligned' ? c(GREEN, '✓') :
                        g.state === 'aligning' ? c(YELLOW, '⟳') :
                        g.state === 'dispersed' ? c(RED, '✗') : c(DIM, '·');
      console.log(`${c(BOLD + CYAN, '║')}  ${stateIcon} ${c(WHITE, g.name)}${c(DIM, '  agents=' + g.agent_count)}${c(DIM, '  state=' + g.state)}${c(DIM, '  seq=' + g.sequence)}`);
    }
  }

  // ── Footer ───────────────────────────────────────────────────────
  console.log(`${c(BOLD + CYAN, '╚══════════════════════════════════════════════════════════════╝')}`);
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const isWatch = args.includes('--watch') || args.includes('-w');

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node status.js [options]

Options:
  --watch, -w    Live-updating status (every 2 seconds)
  --help, -h     Show this help message

Examples:
  node status.js        One-shot status dashboard
  node status.js -w     Live dashboard
`);
    return;
  }

  if (isWatch) {
    // Watch mode — clear and redraw every 2s
    while (true) {
      const data = await collectStatus();
      process.stdout.write(CLS);
      printStatus(data);
      await new Promise(r => setTimeout(r, 2000));
    }
  } else {
    const data = await collectStatus();
    printStatus(data);
  }
}

main().catch(err => {
  console.error(`${c(RED, 'Fatal:')} ${err.message}`);
  process.exit(1);
});
