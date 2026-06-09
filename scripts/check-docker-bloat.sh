#!/usr/bin/env bash
# scripts/check-docker-bloat.sh
#
# Asserts that the production Docker image at $IMAGE only contains
# the files needed to run the server. Specifically:
#
#   - /app/scripts/ contains validate-env.mjs and nothing else.
#   - /app/prisma/ contains schema.prisma + migrations/ and no other
#     *.ts (no seed, cleanup, merge, backfill, dedupe, promote-admin
#     scripts).
#   - No /app/tests, /app/__tests__, /app/.github, /app/docs, or
#     loose *.test.ts files anywhere under /app.
#
# Usage:
#   IMAGE=opshub:r11 bash scripts/check-docker-bloat.sh
#
# Exits 0 if the image is clean, 1 with a diff-style report otherwise.

set -euo pipefail

IMAGE="${IMAGE:-opshub:r11}"

run() {
  docker run --rm --entrypoint sh "${IMAGE}" -c "$1"
}

fail=0
report() {
  echo "FAIL: $1" >&2
  fail=1
}

# 1. /app/scripts must be { validate-env.mjs } only.
scripts_listing=$(run 'ls -1 /app/scripts 2>/dev/null || true')
if [[ "${scripts_listing}" != "validate-env.mjs" ]]; then
  report "/app/scripts contains unexpected entries:"
  echo "${scripts_listing}" >&2
fi

# 2. /app/prisma must NOT contain *.ts outside migrations/.
stray_ts=$(run 'find /app/prisma -name "*.ts" -not -path "*/migrations/*" 2>/dev/null || true')
if [[ -n "${stray_ts}" ]]; then
  report "/app/prisma has stray .ts files outside migrations/:"
  echo "${stray_ts}" >&2
fi

# 3. /app/prisma must contain schema.prisma + migrations/ at minimum.
schema_present=$(run '[ -f /app/prisma/schema.prisma ] && echo yes || echo no')
if [[ "${schema_present}" != "yes" ]]; then
  report "/app/prisma/schema.prisma is missing"
fi
migrations_present=$(run '[ -d /app/prisma/migrations ] && echo yes || echo no')
if [[ "${migrations_present}" != "yes" ]]; then
  report "/app/prisma/migrations/ is missing"
fi

# 4. Test / docs / CI directories must not exist.
for dir in tests __tests__ .github docs; do
  exists=$(run "[ -d /app/${dir} ] && echo yes || echo no")
  if [[ "${exists}" == "yes" ]]; then
    report "/app/${dir} should not be in the runtime image"
  fi
done

# 5. No loose *.test.ts under /app (allow node_modules — vendored
# packages legitimately ship test files).
test_files=$(run 'find /app -path /app/node_modules -prune -o -type f \( -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.spec.ts" \) -print 2>/dev/null || true')
if [[ -n "${test_files}" ]]; then
  report "test files leaked into the runtime image:"
  echo "${test_files}" >&2
fi

# 6. No README / docs (allow the top-level README only — optional).
md_files=$(run 'find /app -path /app/node_modules -prune -o -type f -name "*.md" -not -name README.md -print 2>/dev/null || true')
if [[ -n "${md_files}" ]]; then
  report "non-README markdown files leaked into the runtime image:"
  echo "${md_files}" >&2
fi

if [[ "${fail}" -eq 1 ]]; then
  echo "" >&2
  echo "check-docker-bloat: FAILED. Image ${IMAGE} contains files that should not ship." >&2
  exit 1
fi

echo "check-docker-bloat: OK (image ${IMAGE} is clean)"
