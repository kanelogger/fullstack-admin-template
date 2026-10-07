#!/usr/bin/env bash
set -euo pipefail

corepack enable
corepack prepare pnpm@12.3.4 --activate
pnpm install --frozen-lockfile

case "${VISUAL_MODE:-check}" in
  check)
    PLAYWRIGHT_ARTIFACT_SET=visual pnpm --filter fullstack-admin-frontend exec playwright test --project visual-linux
    ;;
  update)
    PLAYWRIGHT_ARTIFACT_SET=visual pnpm --filter fullstack-admin-frontend exec playwright test --project visual-linux --update-snapshots
    ;;
  *)
    printf 'VISUAL_MODE must be check or update\n' >&2
    exit 2
    ;;
esac
