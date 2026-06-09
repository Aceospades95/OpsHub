#!/usr/bin/env bash
# scripts/smoke.sh
#
# Synthetic smoke check for the RSC 503 storm.
#
# Hits a handful of RSC-rendered routes in parallel, 50 times each,
# and fails if ANY response is a 5xx. The original 503 storm
# (docs/rsc-503-diagnosis.md, R10-5) showed up only under burst
# concurrent navigation, so the synthetic mimics that pattern.
#
# Use:
#   BASE_URL=https://your-deploy.example.com bash scripts/smoke.sh
#
# Defaults to http://localhost:3000 for local dev. NOT wired into
# the default `npm run ci` — it requires a running server, which CI
# doesn't have. Run manually after a deploy. If a 5xx surfaces,
# instrumentation.ts (R11-G) emits a structured log record with the
# routePath / routeType so you can correlate.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
ROUTES=(
  "/dashboard"
  "/projects"
  "/tasks"
)
HITS_PER_ROUTE="${HITS_PER_ROUTE:-50}"

OUT_DIR="$(mktemp -d)"
trap 'rm -rf "${OUT_DIR}"' EXIT

echo "smoke: hitting ${#ROUTES[@]} routes × ${HITS_PER_ROUTE} reqs against ${BASE_URL}"

# Fan out: each (route, request#) is its own background curl.
pids=()
for route in "${ROUTES[@]}"; do
  for i in $(seq 1 "${HITS_PER_ROUTE}"); do
    out="${OUT_DIR}/$(echo "${route}" | tr '/' '_')_${i}.code"
    (curl -s -o /dev/null -w "%{http_code}" \
      "${BASE_URL}${route}" > "${out}" || echo "000" > "${out}") &
    pids+=("$!")
  done
done

# Wait for everything to come back.
for pid in "${pids[@]}"; do
  wait "${pid}" || true
done

# Tally.
total=0
fivexx=0
for f in "${OUT_DIR}"/*.code; do
  code=$(cat "${f}")
  total=$((total + 1))
  if [[ "${code}" =~ ^5[0-9][0-9]$ ]]; then
    fivexx=$((fivexx + 1))
    echo "  5xx: ${f##*/}: ${code}" >&2
  fi
done

echo "smoke: ${total} requests, ${fivexx} 5xx responses"

if [[ "${fivexx}" -gt 0 ]]; then
  echo "smoke: FAIL — see above for the failing requests" >&2
  exit 1
fi

echo "smoke: OK"
