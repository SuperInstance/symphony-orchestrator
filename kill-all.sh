#!/usr/bin/env bash
#
# ╔══════════════════════════════════════════════════════════════╗
# ║  Symphony Kill All — terminate every symphony process       ║
# ╚══════════════════════════════════════════════════════════════╝
#
# Gracefully terminates all symphony components by:
#   - Sending SIGTERM to matching processes
#   - Killing processes on known ports
#   - Fallback to SIGKILL after grace period
#

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}  ${BOLD}⏹  SYMPHONY SHUTDOWN SEQUENCE${NC}                      ${CYAN}║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Port-based kills ──────────────────────────────────────────────────
echo -e "${YELLOW}→ Killing processes on known ports...${NC}"

for port in 8765 9876 9090; do
    pid=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo -e "  Port ${CYAN}:${port}${NC} → PID ${YELLOW}${pid}${NC}"
        kill -TERM "$pid" 2>/dev/null || true
    else
        echo -e "  Port ${CYAN}:${port}${NC} → ${DIM}(nothing)${NC}"
    fi
done

# ── Pattern-based kills ───────────────────────────────────────────────
echo ""
echo -e "${YELLOW}→ Killing processes by component name...${NC}"

PATTERNS=(
    "tminus-dispatcher"
    "fleet-bridge-cli.js"
    "bottle-agent"
    "snail-shell"
    "composite-headspace"
    "symphony-runtime"
    "symphony-master"
    "orchestrate.js"
    "kimi"
)

for pattern in "${PATTERNS[@]}"; do
    pids=$(pgrep -f "$pattern" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        count=$(echo "$pids" | wc -l)
        echo -e "  ${CYAN}${pattern}${NC} → ${count} process(es)"
        for pid in $pids; do
            echo -e "    Killing PID ${YELLOW}${pid}${NC}..."
            kill -TERM "$pid" 2>/dev/null || true
        done
    else
        echo -e "  ${CYAN}${pattern}${NC} → ${DIM}(not found)${NC}"
    fi
done

# ── Grace period ──────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}→ Waiting 2s for graceful shutdown...${NC}"
sleep 2

# ── Force kill survivors ──────────────────────────────────────────────
echo ""
echo -e "${RED}→ Force-killing survivors...${NC}"

for pattern in "${PATTERNS[@]}"; do
    pids=$(pgrep -f "$pattern" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        for pid in $pids; do
            echo -e "  ${RED}Force-killing PID ${pid}${NC}"
            kill -KILL "$pid" 2>/dev/null || true
        done
    fi
done

# Also force-kill anything left on the ports
for port in 8765 9876 9090; do
    pid=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$pid" ]; then
        kill -KILL "$pid" 2>/dev/null || true
    fi
done

# ── Clean up bottle agent temp file ───────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOTTLE_AGENT_SCRIPT="${SCRIPT_DIR}/_bottle-agent.js"
if [ -f "$BOTTLE_AGENT_SCRIPT" ]; then
    rm -f "$BOTTLE_AGENT_SCRIPT"
    echo -e "  ${DIM}Cleaned up: _bottle-agent.js${NC}"
fi

echo ""
echo -e "${GREEN}✓ All symphony processes terminated.${NC}"
echo ""
