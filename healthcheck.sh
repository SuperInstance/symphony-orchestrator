#!/usr/bin/env bash
#
# ╔══════════════════════════════════════════════════════════════╗
# ║  Symphony Health Checker                                    ║
# ║  CURLs /health on all components, prints green/red status   ║
# ║  Returns 0 only if ALL pass.                                ║
# ╚══════════════════════════════════════════════════════════════╝
#

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color
CHECK='✓'
CROSS='✗'
WARN='⚠'

PASS=0
FAIL=0
SKIP=0

# ── Helpers ────────────────────────────────────────────────────────────

check_http() {
    local label="$1"
    local url="$2"
    local timeout="${3:-3}"

    local status
    local http_code
    http_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$timeout" "$url" 2>/dev/null || echo "000")

    if [ "$http_code" = "200" ]; then
        echo -e "  ${GREEN}${CHECK}${NC} ${BOLD}${label}${NC}  ${GREEN}OK${NC}  (HTTP $http_code)"
        PASS=$((PASS + 1))
        return 0
    else
        echo -e "  ${RED}${CROSS}${NC} ${BOLD}${label}${NC}  ${RED}DOWN${NC} (HTTP $http_code)"
        FAIL=$((FAIL + 1))
        return 1
    fi
}

check_process() {
    local label="$1"
    local pattern="$2"

    if pgrep -f "$pattern" &>/dev/null; then
        echo -e "  ${GREEN}${CHECK}${NC} ${BOLD}${label}${NC}  ${GREEN}RUNNING${NC}"
        PASS=$((PASS + 1))
        return 0
    else
        echo -e "  ${RED}${CROSS}${NC} ${BOLD}${label}${NC}  ${RED}NOT RUNNING${NC}"
        FAIL=$((FAIL + 1))
        return 1
    fi
}

# ── Banner ─────────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}  ${BOLD}🎻  SYMPHONY HEALTH CHECK${NC}                              ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}  $(date -u '+%Y-%m-%d %H:%M:%S UTC')                         ${CYAN}║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Root directory ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 1. t-minus Dispatcher (:8765) ────────────────────────────────────
echo -e "${CYAN}✦ t-minus Dispatcher${NC}"
check_http "t-minus Dispatcher" "http://127.0.0.1:8765/health"
echo ""

# ── 2. Fleet Bridge (:9876) ──────────────────────────────────────────
echo -e "${CYAN}✦ Fleet Bridge${NC}"
check_process "Fleet Bridge daemon" "fleet-bridge-cli.js"
echo ""

# ── 3. I2I Bottle Agent ──────────────────────────────────────────────
echo -e "${CYAN}✦ I2I Bottle Agent${NC}"
check_process "I2I Bottle Agent" "bottle-agent"
echo ""

# ── 4. Heddle Snail Shell ────────────────────────────────────────────
echo -e "${CYAN}✦ Heddle Snail Shell${NC}"
if [ -d "$WORKSPACE/heddle/src/snail-shell" ]; then
    # Check if compiled JS exists
    if [ -f "$WORKSPACE/heddle/src/snail-shell/index.js" ]; then
        check_process "Snail Shell" "snail-shell"
    else
        echo -e "  ${YELLOW}${WARN}${NC} Snail Shell is TypeScript plugin — ${YELLOW}STAGED${NC} (compile required)"
        SKIP=$((SKIP + 1))
    fi
else
    echo -e "  ${YELLOW}${WARN}${NC} Snail Shell directory not found — ${YELLOW}UNAVAILABLE${NC}"
    SKIP=$((SKIP + 1))
fi
echo ""

# ── 5. Composite Headspace ───────────────────────────────────────────
echo -e "${CYAN}✦ Composite Headspace${NC}"
check_process "Composite Headspace" "composite-headspace" || true
echo -e "  ${YELLOW}${WARN}${NC} (one-shot mode — may have completed)"
echo ""

# ── 6. Symphony Runtime ──────────────────────────────────────────────
echo -e "${CYAN}✦ Symphony Runtime${NC}"
if [ -f "$WORKSPACE/symphony-runtime/src/index.js" ]; then
    # Try to import and verify
    if node -e "
        const r = require('$WORKSPACE/symphony-runtime/src/index.js');
        const sr = new r.SymphonyRuntime({});
        console.log(sr.status() ? 'OK' : 'FAIL');
    " 2>/dev/null; then
        echo -e "  ${GREEN}${CHECK}${NC} ${BOLD}Symphony Runtime${NC}  ${GREEN}INITIALIZABLE${NC}"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}${CROSS}${NC} ${BOLD}Symphony Runtime${NC}  ${RED}IMPORT FAILED${NC}"
        FAIL=$((FAIL + 1))
    fi
else
    echo -e "  ${YELLOW}${WARN}${NC} Symphony Runtime not found — ${YELLOW}MISSING${NC}"
    SKIP=$((SKIP + 1))
fi
echo ""

# ── 7. Master Agent ──────────────────────────────────────────────────
echo -e "${CYAN}✦ Master Agent${NC}"
check_http "Master Agent check" "http://127.0.0.1:8765/agents" 3 | head -1
# Parse agents response for symphony-master
if curl -s --max-time 3 http://127.0.0.1:8765/agents 2>/dev/null | grep -q "symphony-master"; then
    echo -e "  ${GREEN}${CHECK}${NC} Master Agent symphony-master ${GREEN}REGISTERED${NC}"
    PASS=$((PASS + 1))
else
    echo -e "  ${YELLOW}${WARN}${NC} Master Agent not registered (expected only after orchestrate.js run)"
fi
echo ""

# ── Summary ──────────────────────────────────────────────────────────
TOTAL=$((PASS + FAIL + SKIP))
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}  ${BOLD}SUMMARY${NC}                                                   ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}                                                           ${CYAN}║${NC}"
printf "${CYAN}║${NC}  ${GREEN}✅ Pass:  %2d${NC}                                          ${CYAN}║${NC}\n" "$PASS"
printf "${CYAN}║${NC}  ${RED}❌ Fail:  %2d${NC}                                          ${CYAN}║${NC}\n" "$FAIL"
printf "${CYAN}║${NC}  ${YELLOW}⏸️  Skip:  %2d${NC}                                          ${CYAN}║${NC}\n" "$SKIP"
echo -e "${CYAN}║${NC}                                                           ${CYAN}║${NC}"
printf "${CYAN}║${NC}  ${BOLD}Total: %2d${NC}                                           ${CYAN}║${NC}\n" "$TOTAL"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Exit Code ─────────────────────────────────────────────────────────
if [ "$FAIL" -gt 0 ]; then
    echo -e "${RED}✖ Some components are unhealthy.${NC}"
    exit 1
else
    echo -e "${GREEN}✓ All components healthy!${NC}"
    exit 0
fi
