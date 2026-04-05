#!/usr/bin/env bash
set -euo pipefail

echo "=== Distribution Validation ==="
echo ""

# Part 1: Static pack check
echo "[1/2] Checking npm pack --dry-run for WASM files..."
npm run build

PACK_OUTPUT=$(npm pack --dry-run 2>&1)

REQUIRED_FILES=(
  "dist/wasm/tree-sitter.wasm"
  "dist/wasm/tree-sitter-typescript.wasm"
  "dist/wasm/tree-sitter-tsx.wasm"
  "dist/wasm/tree-sitter-python.wasm"
  "dist/wasm/tree-sitter-go.wasm"
  "dist/wasm/tree-sitter-rust.wasm"
)

MISSING=0
for f in "${REQUIRED_FILES[@]}"; do
  if echo "$PACK_OUTPUT" | grep -q "$f"; then
    echo "  OK: $f"
  else
    echo "  MISSING: $f"
    MISSING=$((MISSING + 1))
  fi
done

if [ "$MISSING" -gt 0 ]; then
  echo ""
  echo "FAIL: $MISSING WASM file(s) missing from npm pack output"
  exit 1
fi
echo "  All 6 WASM files present in pack output."
echo ""

# Part 2: Simulated install (runtime without node_modules/tree-sitter-wasms/)
echo "[2/2] Simulated install test (shadowing node_modules/tree-sitter-wasms/)..."

# Only run if node_modules/tree-sitter-wasms exists (Phase 40 installed it)
if [ ! -d "node_modules/tree-sitter-wasms" ]; then
  echo "  SKIP: node_modules/tree-sitter-wasms/ not found (Phase 40 not complete?)"
  exit 1
fi

mv node_modules/tree-sitter-wasms node_modules/_tree-sitter-wasms-hidden
RESTORE_CMD="mv node_modules/_tree-sitter-wasms-hidden node_modules/tree-sitter-wasms"
trap "$RESTORE_CMD" EXIT

# Run brain-cache index against a small fixture directory using built CLI
# Use positional path argument with a small directory to keep it fast
# We just need to confirm it starts without WASM resolution errors.
# Note: "No profile found" is an acceptable CLI error — it means WASM loaded OK
# and the CLI reached application logic. Only WASM/path resolution errors are failures.
set +e
node dist/cli.js index ./src/lib > /tmp/brain-cache-index-out.txt 2>&1
STATUS=$?
RUNTIME_OUTPUT=$(head -20 /tmp/brain-cache-index-out.txt)
set -e
echo "$RUNTIME_OUTPUT"

# Check for WASM resolution errors specifically
if echo "$RUNTIME_OUTPUT" | grep -qiE '(expected magic word|CompileError|instantiate|wasm.*not found|cannot find.*wasm|failed to load.*wasm)'; then
  echo ""
  echo "FAIL: brain-cache index encountered WASM resolution error without node_modules/tree-sitter-wasms/"
  exit 1
fi

# "No profile found" means we passed WASM init — CLI reached application logic
if echo "$RUNTIME_OUTPUT" | grep -q "No profile found"; then
  echo "  OK: WASM loaded from dist/wasm/ (CLI reached application logic)"
elif [ "$STATUS" -eq 0 ]; then
  echo "  OK: brain-cache index succeeded"
else
  echo ""
  echo "FAIL: brain-cache index failed with unexpected error without node_modules/tree-sitter-wasms/"
  exit 1
fi

echo ""
echo "=== All distribution checks passed ==="
