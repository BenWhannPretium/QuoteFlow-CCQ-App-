#!/usr/bin/env bash
# B-27 (L-8): keep the Fabric mirror of the CCQ database alive through deploys.
#
# Fabric mirroring doesn't support DDL on a mirrored table: a migration that alters one needs
# mirroring stopped first and started again after (a start reseeds every table). The API applies
# migrations when it starts (apps/api/src/azureStart.ts), so the deploy job stops mirroring before
# `az webapp deploy` and starts it after the smoke test. Runbook: docs/build-guide/06 and B-27.
#
#   scripts/fabric-mirroring.sh migrations-changed <deployed-sha> <new-sha>
#       exit 0 if packages/db/migrations differs between the two commits (or the deployed sha is
#       unknown / not in this clone), 1 if not. Needs the full history (fetch-depth: 0).
#   scripts/fabric-mirroring.sh stop | start | status | tables
#   scripts/fabric-mirroring.sh wait [timeout-seconds]
#       poll until mirroring is Running and no table is Failed or Stopped (default 900 s).
#
# Env: FABRIC_WORKSPACE_ID, FABRIC_MIRRORED_DB_ID. Auth: the signed-in az CLI (the OIDC deploy
# identity, which must be a Contributor on the Fabric workspace). Prints statuses and table names
# only, never data.
set -euo pipefail

FABRIC_API="https://api.fabric.microsoft.com/v1"

fabric() {
  local action="$1"
  : "${FABRIC_WORKSPACE_ID:?FABRIC_WORKSPACE_ID is not set}"
  : "${FABRIC_MIRRORED_DB_ID:?FABRIC_MIRRORED_DB_ID is not set}"
  az rest --method post --resource "https://api.fabric.microsoft.com" \
    --url "$FABRIC_API/workspaces/$FABRIC_WORKSPACE_ID/mirroredDatabases/$FABRIC_MIRRORED_DB_ID/$action" \
    --only-show-errors "${@:2}"
}

mirror_status() { fabric getMirroringStatus --query status --output tsv; }

# "<table> <status>" for every table not Replicating/Snapshotting/Reseeding/Initialized (first page;
# CCQ has ~40 tables, well under one page).
bad_tables() {
  fabric getTablesMirroringStatus \
    --query "data[?!contains(['Replicating','Snapshotting','Reseeding','Initialized'], status)].[sourceTableName, status]" \
    --output tsv
}

case "${1:-}" in
  migrations-changed)
    deployed="${2:-}"
    new="${3:?usage: migrations-changed <deployed-sha> <new-sha>}"
    if [[ -z "$deployed" || "$deployed" == "dev" ]] || ! git cat-file -e "$deployed^{commit}" 2>/dev/null; then
      echo "deployed commit unknown (${deployed:-none}): treating migrations as changed"
      exit 0
    fi
    if git diff --quiet "$deployed" "$new" -- packages/db/migrations; then
      echo "no migration changes between $deployed and $new"
      exit 1
    fi
    echo "migrations changed between $deployed and $new:"
    git diff --name-only "$deployed" "$new" -- packages/db/migrations
    ;;
  stop)
    fabric stopMirroring
    echo "stop requested; status: $(mirror_status)"
    ;;
  start)
    fabric startMirroring
    echo "start requested; status: $(mirror_status)"
    ;;
  status) mirror_status ;;
  tables) fabric getTablesMirroringStatus --query "data[].[sourceTableName, status]" --output tsv ;;
  wait)
    timeout="${2:-900}"
    deadline=$((SECONDS + timeout))
    while :; do
      status="$(mirror_status || echo Unknown)"
      bad="$( [[ "$status" == Running ]] && bad_tables || true)"
      if [[ "$status" == Running && -z "$bad" ]]; then
        echo "mirroring Running; every table replicating or snapshotting"
        exit 0
      fi
      if [[ -n "$bad" ]] && grep -q $'\tFailed$' <<<"$bad"; then
        echo "tables failed to mirror:" >&2
        echo "$bad" >&2
        exit 1
      fi
      if ((SECONDS >= deadline)); then
        echo "mirroring not healthy after ${timeout}s (status $status)" >&2
        [[ -n "$bad" ]] && echo "$bad" >&2
        exit 1
      fi
      echo "waiting: mirroring $status${bad:+; not yet replicating: $(tr '\n' ' ' <<<"$bad")}"
      sleep 15
    done
    ;;
  *)
    sed -n '2,19p' "$0" >&2
    exit 2
    ;;
esac
