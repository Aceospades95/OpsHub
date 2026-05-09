#!/usr/bin/env bash
# scripts/check-no-pii.sh
#
# Fail the build if any historical real-data string sneaks back into
# the working tree. The R11 PII purge replaced every reference; this
# gate makes sure none of them re-appear in a future commit.
#
# Patterns scanned (case-insensitive):
#   - wynndalco        operator company domain (historic leak)
#   - omnia-house      operator product domain (historic leak)
#   - jakewright95     personal Gmail used in early test seeds
#   - j\.wright@       canonical operator email shape
#
# Excluded:
#   - .git/, node_modules/, .next/, dist/, build/, coverage/
#   - *.lock files (transitive deps may legitimately include strings)
#   - the script itself (the patterns are by definition listed here)
#
# Exits 0 if clean, 1 if any hit is found.

set -euo pipefail

# Build the regex once so a single grep walks the tree.
PATTERN='(wynndalco|omnia-house|jakewright95|j\.wright@)'

# Honor .gitignore via `git ls-files` rather than walking the FS so
# build artifacts don't fight us. If we're not in a git checkout
# (CI cache restore quirk), fall back to a find-based scan.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  HITS=$(
    git grep -InE "${PATTERN}" -- \
      ':!*.lock' \
      ':!scripts/check-no-pii.sh' \
      ':!.git' \
      || true
  )
else
  HITS=$(
    grep -RInE "${PATTERN}" . \
      --exclude-dir=.git \
      --exclude-dir=node_modules \
      --exclude-dir=.next \
      --exclude-dir=dist \
      --exclude-dir=build \
      --exclude-dir=coverage \
      --exclude='*.lock' \
      --exclude='check-no-pii.sh' \
      || true
  )
fi

if [[ -n "${HITS}" ]]; then
  echo "ERROR: real-PII strings found in working tree:" >&2
  echo "${HITS}" >&2
  echo "" >&2
  echo "Replace with neutral fixtures (e.g. @example.com, 'Alex Admin')." >&2
  echo "See scripts/check-no-pii.sh for the configured pattern list." >&2
  exit 1
fi

echo "check-no-pii: OK (no flagged strings in tree)"
