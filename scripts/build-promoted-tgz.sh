#!/usr/bin/env bash
# build-promoted-tgz.sh — Build a promoted release tgz artifact.
#
# Usage:
#   scripts/build-promoted-tgz.sh <tag> [--bundle]
#
# Modes:
#   Default (pack):   dist/ + package.json + pnpm-lock.yaml (no node_modules)
#   --bundle:         adds node_modules/ for self-contained deploy
#
# Outputs:
#   openclaw-pack-<tag>.tgz   (pack mode)
#   openclaw-dist-<tag>.tgz   (bundle mode)
#
# Expects a clean build (pnpm build) to have been run already.

set -euo pipefail

TAG="${1:-}"
MODE="pack"

if [[ -z "$TAG" ]]; then
  echo "Usage: $0 <tag> [--bundle]" >&2
  exit 1
fi

shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle) MODE="bundle" ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

# Verify dist/ exists
if [[ ! -d dist ]]; then
  echo "Error: dist/ not found. Run 'pnpm build' first." >&2
  exit 1
fi

# Write VERSION.json
mkdir -p _promoted_release
SHA="$(git rev-parse HEAD)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > _promoted_release/VERSION.json <<EOF
{
  "tag": "$TAG",
  "sha": "$SHA",
  "builtAt": "$BUILT_AT",
  "includesNodeModules": $([ "$MODE" = "bundle" ] && echo "true" || echo "false")
}
EOF

echo "VERSION.json:"
cat _promoted_release/VERSION.json

# Build tarball
CONTENTS=(
  dist/
  extensions/
  docs/
  package.json
  pnpm-lock.yaml
  _promoted_release/VERSION.json
)

if [[ "$MODE" == "bundle" ]]; then
  if [[ ! -d node_modules ]]; then
    echo "Error: node_modules/ not found. Run 'pnpm install' first." >&2
    exit 1
  fi
  CONTENTS+=(node_modules/)
  OUTFILE="openclaw-dist-${TAG}.tgz"
else
  OUTFILE="openclaw-pack-${TAG}.tgz"
fi

echo ""
echo "Packing $MODE artifact: $OUTFILE"
tar czf "$OUTFILE" "${CONTENTS[@]}"

SIZE="$(du -h "$OUTFILE" | cut -f1)"
echo "Done: $OUTFILE ($SIZE)"
