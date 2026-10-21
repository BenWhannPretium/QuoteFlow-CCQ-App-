#!/usr/bin/env bash
# B-20: assemble the App Service package from a finished `pnpm build`.
#
#   scripts/package-azure.sh [out-dir]      (default: .azure-deploy, git-ignored)
#
# Layout (App Service runs `node apps/api/dist/azureStart.js` from the package root):
#   apps/api/dist/        the API bundle, its migrations and analytics SQL
#   apps/api/dist/GIT_SHA the commit being packaged, when $GIT_SHA is set (reported by /health)
#   apps/api/package.json "type": "module" for the bundle
#   apps/web/dist/        the SPA, served by the API in production
#   node_modules/         the API's production dependencies as real folders (no pnpm symlinks,
#                         which zip deployment does not keep)
set -euo pipefail

cd "$(dirname "$0")/.."
out="${1:-.azure-deploy}"

for built in apps/api/dist/azureStart.js apps/api/dist/server.js apps/web/dist/index.html; do
  [[ -f "$built" ]] || { echo "missing $built: run pnpm build first" >&2; exit 1; }
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
pnpm --filter @ccq/api --prod --config.node-linker=hoisted deploy "$tmp/api" > /dev/null

rm -rf "$out"
mkdir -p "$out/apps/api" "$out/apps/web"
cp -R "$tmp/api/node_modules" "$out/node_modules"
rm -rf "$out/node_modules/.bin"
cp -R apps/api/dist "$out/apps/api/dist"
cp apps/api/package.json "$out/apps/api/package.json"
cp -R apps/web/dist "$out/apps/web/dist"
if [[ -n "${GIT_SHA:-}" ]]; then
  printf '%s\n' "$GIT_SHA" > "$out/apps/api/dist/GIT_SHA"
fi

echo "packaged $(du -sh "$out" | cut -f1) in $out"
