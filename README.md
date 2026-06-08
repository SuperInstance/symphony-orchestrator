# 🎬 Symphony Orchestrator

**One-command master runner for the full SuperInstance cognitive fleet stack**

[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![SuperInstance](https://img.shields.io/badge/SuperInstance-Fleet-purple)](https://github.com/SuperInstance)

---

Orchestrates the entire SuperInstance fleet — starts all services in dependency order, verifies connectivity, prints a live status dashboard, and handles graceful teardown on SIGINT.

---

## Quick Start

```bash
git clone https://github.com/SuperInstance/symphony-orchestrator
cd symphony-orchestrator
npm install
npm start
```

## What It Solves

Running a distributed cognitive fleet means starting multiple services in the right order, waiting for each to be healthy, then validating end-to-end connectivity. The Orchestrator automates this so you don't manually manage a dozen terminal windows.

### Orchestration Sequence

```
1. Start t-minus Dispatcher (port :8765)
   └─ Wait for /health → 200
2. Start Fleet Bridge (port :9876)
   └─ Wait for /health → 200
3. Start I2I Bottle Agent
   └─ Wait for health confirmation
4. Register a master fleet agent
   └─ Verify end-to-end connectivity
5. Print live status dashboard
6. Trap SIGINT → clean cascade shutdown
```

## Commands

| Command | Purpose |
|---------|---------|
| `npm start` | Launch full fleet orchestration |
| `npm run status` | Live dashboard with `--watch` mode |
| `npm run health` | Shell-based health checker, color output |
| `npm run kill` | Full teardown — SIGTERM → SIGKILL cascade |

## Project Structure

| File | Lines | Purpose |
|------|-------|---------|
| `orchestrate.js` | 546 | Master runner: service lifecycle, health checks, reactor pattern |
| `status.js` | ~400 | Live status dashboard with refresh |
| `healthcheck.sh` | ~200 | Shell-based multi-service health checker |
| `kill-all.sh` | ~100 | SIGTERM cascade with SIGKILL fallback |
| `AGENT.md` | — | Agent instructions for running the orchestrator |

## Service Dependencies

```
tminus-dispatcher(:8765)
        │
        ▼
   fleet-bridge(:9876)
        │
        ▼
 i2i-bottle-agent
        │
        ▼
  master-agent (registration)
```

## Related Repos

- [⏱️ tminus-dispatcher](https://github.com/SuperInstance/tminus-dispatcher) — Temporal heartbeat
- [🔌 tminus-client](https://github.com/SuperInstance/tminus-client) — Client SDK + CLI
- [🌉 fleet-bridge](https://github.com/SuperInstance/fleet-bridge) — A2A dual-transport
- [🎼 symphony-runtime](https://github.com/SuperInstance/symphony-runtime) — Formal grammar runtime
- [🧠 composite-headspace](https://github.com/SuperInstance/composite-headspace) — Dual-shell reasoning
- [📡 i2i-bottle-agent](https://github.com/SuperInstance/i2i-bottle-agent) — Bottle protocol
- [🧮 constraint-tminus-bridge](https://github.com/SuperInstance/constraint-tminus-bridge) — Constraint networks

## License

MIT

---

*Part of the [SuperInstance Fleet](https://github.com/SuperInstance) — The crab inherits the shell. The forge shapes the steel.*
