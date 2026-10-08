#!/usr/bin/env bash
set -euo pipefail

corepack enable
corepack prepare pnpm@12.3.4 --activate
pnpm install --frozen-lockfile

case "${VISUAL_MODE:-check}" in
  check)
    PLAYWRIGHT_ARTIFACT_SET=visual pnpm --filter fullstack-admin-frontend exec playwright test --project visual-linux
    ;;
  candidate)
    set +e
    VISUAL_STRICT_PIXEL_COMPARE=1 PLAYWRIGHT_ARTIFACT_SET=visual pnpm --filter fullstack-admin-frontend exec playwright test --project visual-linux
    baseline_check_status=$?
    set -e
    mkdir -p visual/.runs/initial
    cp -R frontend/test-results/visual/. visual/.runs/initial/ 2>/dev/null || true
    cp -R frontend/playwright-report/visual visual/.runs/initial-report 2>/dev/null || true
    PLAYWRIGHT_ARTIFACT_SET=visual pnpm --filter fullstack-admin-frontend exec playwright test --project visual-linux --update-snapshots
    PLAYWRIGHT_ARTIFACT_SET=visual pnpm --filter fullstack-admin-frontend exec playwright test --project visual-linux
    printf 'Initial comparison exit code: %s\n' "$baseline_check_status"
    ;;
  *)
    printf 'VISUAL_MODE must be check or candidate\n' >&2
    exit 2
    ;;
esac
