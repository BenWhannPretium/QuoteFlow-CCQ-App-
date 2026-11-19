#!/bin/sh
# FB-28 (BR-18): has this merge reached the Azure test site, healthy?
#
#   scripts/wait-for-deploy.sh <sha> [timeout-minutes] [--dry-run]
#
# 1. Waits (default 40 minutes) for the CI run on <sha> (event push, branch main) to finish.
# 2. Waits for the "Deploy (test)" run that CI's completion started. A workflow_run's head_sha is
#    main's tip when it was triggered, not the commit CI tested (deploy.yml checks out
#    github.event.workflow_run.head_sha for that reason), so the run is matched by time: the first
#    deploy created after CI finished. The health body's version is the proof.
# 3. Polls https://<AZURE_WEBAPP_NAME>.azurewebsites.net/api/v1/health for up to 10 minutes until it
#    reports "status":"ok", "version":"<sha>" and "db":"up".
#
# Exit: 0 healthy on <sha>; 10 CI failed or did not start; 11 deploy failed, was skipped or did not
# start; 12 the site did not report <sha> healthy; 13 superseded (a newer main commit replaced this
# one: run again with the sha it names); 2 usage, or gh not usable.
# One line per state change. Needs gh (authenticated; run inside the repo or set GH_REPO), curl and
# POSIX sh; works in Git Bash on Windows. See docs/build-guide/09-release-guards.md.
#
# Test knobs (seconds): WFD_POLL_SECONDS (20), WFD_CI_START_SECONDS (600),
# WFD_DEPLOY_START_SECONDS (600), WFD_DEPLOY_SECONDS (2400), WFD_HEALTH_SECONDS (600).

set -u

usage() {
  echo "usage: scripts/wait-for-deploy.sh <sha> [timeout-minutes] [--dry-run]" >&2
  exit 2
}

SHA=""
TIMEOUT_MIN=""
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -*) usage ;;
    *)
      if [ -z "$SHA" ]; then
        SHA=$arg
      elif [ -z "$TIMEOUT_MIN" ]; then
        TIMEOUT_MIN=$arg
      else
        usage
      fi
      ;;
  esac
done
TIMEOUT_MIN=${TIMEOUT_MIN:-40}
printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{7,40}$' || usage
printf '%s' "$TIMEOUT_MIN" | grep -Eq '^[1-9][0-9]*$' || usage

POLL=${WFD_POLL_SECONDS:-20}
CI_START=${WFD_CI_START_SECONDS:-600}
DEPLOY_START=${WFD_DEPLOY_START_SECONDS:-600}
DEPLOY_WAIT=${WFD_DEPLOY_SECONDS:-2400}
HEALTH_WAIT=${WFD_HEALTH_SECONDS:-600}

COMPARE='[.status, .ahead_by, .base_commit.sha, .commits[-1].sha // .base_commit.sha] | @tsv'
CI_JQ='.[0] // empty | [.databaseId, .status, .conclusion, .url, .updatedAt] | @tsv'
CI_JOBS_JQ='.jobs[] | select(.conclusion == "failure" or .conclusion == "timed_out") | .name'
DEPLOY_STEPS_JQ='.jobs[].steps[] | select(.conclusion == "failure") | .name'
deploy_jq() {
  echo "[.[] | select((.createdAt | fromdateiso8601) >= (\"$1\" | fromdateiso8601) - 30)] | sort_by(.createdAt) | .[0] // empty | [.databaseId, .status, .conclusion, .url, .headSha] | @tsv"
}

if [ "$DRY_RUN" = 1 ]; then
  cat <<EOF
gh api 'repos/{owner}/{repo}/compare/$SHA...main' --jq '$COMPARE'
gh run list --workflow ci.yml --commit <full-sha> --event push --branch main -L 1 --json databaseId,status,conclusion,url,updatedAt --jq '$CI_JQ'   # every ${POLL}s, up to $TIMEOUT_MIN minutes
gh run view <ci-run-id> --json jobs --jq '$CI_JOBS_JQ'   # only if CI failed
gh run list --workflow deploy.yml --event workflow_run -L 30 --json databaseId,headSha,status,conclusion,url,createdAt --jq '$(deploy_jq '<ci-finished-at>')'   # every ${POLL}s
gh run view <deploy-run-id> --json jobs --jq '$DEPLOY_STEPS_JQ'   # only if the deploy failed
gh variable get AZURE_WEBAPP_NAME
curl -fsS --max-time 10 https://<AZURE_WEBAPP_NAME>.azurewebsites.net/api/v1/health   # every ${POLL}s, up to $((HEALTH_WAIT / 60)) minutes
EOF
  exit 0
fi

for tool in gh curl; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "$tool is not installed or not on PATH" >&2
    exit 2
  }
done

# gh's errors go to a file, so the main shell (not a $(...) subshell) decides whether to give up.
ERR=$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/wait-for-deploy.$$")
trap 'rm -f "$ERR"' EXIT

# Polling: a network blip during a 40-minute wait is not a failure; three in a row are.
GH_FAILS=0
gh_polled() {
  if [ "$1" = 0 ]; then
    GH_FAILS=0
    return 0
  fi
  GH_FAILS=$((GH_FAILS + 1))
  if [ "$GH_FAILS" -ge 3 ]; then
    echo "gh failed three times running: $(cat "$ERR")" >&2
    exit 2
  fi
  return 1
}
gh_die() {
  echo "gh $1 failed: $(cat "$ERR")" >&2
  exit 2
}

LAST_STATE=""
state() {
  if [ "$1" != "$LAST_STATE" ]; then
    echo "$1"
    LAST_STATE=$1
  fi
}
now() { date +%s; }
pause() {
  if [ "$POLL" -gt 0 ]; then sleep "$POLL"; fi
}
field() { printf '%s\n' "$1" | cut -f "$2"; }
joined() { tr '\n' ';' | sed 's/;$//; s/;/, /g'; }

# $1 = exit code if main has not moved on, $2 = what was cancelled.
superseded_or() {
  c=$(gh api "repos/{owner}/{repo}/compare/$SHA...main" --jq "$COMPARE" 2>"$ERR") || gh_die "api compare"
  if [ "$(field "$c" 1)" = "ahead" ]; then
    tip=$(field "$c" 4)
    echo "superseded: $2 was cancelled; main has moved on to $tip, which includes $SHA: run scripts/wait-for-deploy.sh $tip"
    exit 13
  fi
  echo "$2 was cancelled and main has no newer commit: re-run it from the Actions tab"
  exit "$1"
}

c=$(gh api "repos/{owner}/{repo}/compare/$SHA...main" --jq "$COMPARE" 2>"$ERR") || gh_die "api compare"
case "$(field "$c" 1)" in
  ahead | identical) SHA=$(field "$c" 3) ;;
  *)
    echo "CI: $SHA is not on main (compare says $(field "$c" 1)); nothing will deploy it"
    exit 10
    ;;
esac

# 1. CI on the push to main.
start=$(now)
deadline=$((start + TIMEOUT_MIN * 60))
CI_URL=""
CI_DONE=""
while :; do
  row=$(gh run list --workflow ci.yml --commit "$SHA" --event push --branch main -L 1 \
    --json databaseId,status,conclusion,url,updatedAt --jq "$CI_JQ" 2>"$ERR")
  if gh_polled $?; then
    if [ -z "$row" ]; then
      state "CI: waiting for the push run on $SHA to start"
      if [ "$(now)" -ge $((start + CI_START)) ]; then
        echo "CI: no push run on $SHA started within $((CI_START / 60)) minutes"
        exit 10
      fi
    else
      CI_URL=$(field "$row" 4)
      status=$(field "$row" 2)
      if [ "$status" = "completed" ]; then
        conclusion=$(field "$row" 3)
        case "$conclusion" in
          success)
            CI_DONE=$(field "$row" 5)
            state "CI: success $CI_URL"
            break
            ;;
          cancelled) superseded_or 10 "CI on $SHA ($CI_URL)" ;;
          *)
            jobs=$(gh run view "$(field "$row" 1)" --json jobs --jq "$CI_JOBS_JQ" 2>"$ERR" | joined)
            echo "CI: $conclusion${jobs:+ in job \"$jobs\"} $CI_URL"
            exit 10
            ;;
        esac
      fi
      state "CI: $status $CI_URL"
    fi
  fi
  if [ "$(now)" -ge "$deadline" ]; then
    echo "CI: not finished after $TIMEOUT_MIN minutes $CI_URL"
    exit 10
  fi
  pause
done

printf '%s' "$CI_DONE" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' || {
  echo "CI: unexpected completion time '$CI_DONE' from gh" >&2
  exit 2
}

# 2. The Deploy (test) run CI's completion started.
start=$(now)
DEPLOY_URL=""
DEPLOY_JQ=$(deploy_jq "$CI_DONE")
while :; do
  row=$(gh run list --workflow deploy.yml --event workflow_run -L 30 \
    --json databaseId,headSha,status,conclusion,url,createdAt --jq "$DEPLOY_JQ" 2>"$ERR")
  if gh_polled $?; then
    if [ -z "$row" ]; then
      state "deploy: waiting for Deploy (test) to start after CI finished at $CI_DONE"
      if [ "$(now)" -ge $((start + DEPLOY_START)) ]; then
        echo "deploy: no Deploy (test) run started within $((DEPLOY_START / 60)) minutes of CI finishing"
        exit 11
      fi
    else
      DEPLOY_URL=$(field "$row" 4)
      status=$(field "$row" 2)
      if [ "$status" = "completed" ]; then
        conclusion=$(field "$row" 3)
        case "$conclusion" in
          success)
            state "deploy: success $DEPLOY_URL"
            break
            ;;
          cancelled) superseded_or 11 "Deploy (test) for $SHA ($DEPLOY_URL)" ;;
          skipped)
            echo "deploy: skipped $DEPLOY_URL (AZURE_WEBAPP_NAME unset, or the CI run did not succeed)"
            exit 11
            ;;
          *)
            steps=$(gh run view "$(field "$row" 1)" --json jobs --jq "$DEPLOY_STEPS_JQ" 2>"$ERR" | joined)
            echo "deploy: $conclusion${steps:+ at step \"$steps\"} $DEPLOY_URL"
            exit 11
            ;;
        esac
      fi
      state "deploy: $status $DEPLOY_URL"
    fi
  fi
  if [ "$(now)" -ge $((start + DEPLOY_WAIT)) ]; then
    echo "deploy: not finished after $((DEPLOY_WAIT / 60)) minutes $DEPLOY_URL"
    exit 11
  fi
  pause
done

# 3. The site itself.
APP=$(gh variable get AZURE_WEBAPP_NAME 2>"$ERR") || gh_die "variable get AZURE_WEBAPP_NAME"
if [ -z "$APP" ]; then
  echo "health: the repository variable AZURE_WEBAPP_NAME is empty" >&2
  exit 2
fi
URL="https://$APP.azurewebsites.net/api/v1/health"
start=$(now)
body=""
while :; do
  body=$(curl -fsS --max-time 10 "$URL" 2>/dev/null || true)
  if printf '%s' "$body" | grep -q '"status":"ok"' &&
    printf '%s' "$body" | grep -q "\"version\":\"$SHA\"" &&
    printf '%s' "$body" | grep -q '"db":"up"'; then
    echo "healthy: $URL reports $SHA with the database up"
    exit 0
  fi
  version=$(printf '%s' "$body" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
  state "health: waiting for $SHA (site reports ${version:-no answer})"
  if [ "$(now)" -ge $((start + HEALTH_WAIT)) ]; then
    if [ -n "$version" ] && [ "$version" != "$SHA" ]; then
      c=$(gh api "repos/{owner}/{repo}/compare/$SHA...$version" --jq "$COMPARE" 2>"$ERR" || true)
      if [ "$(field "$c" 1)" = "ahead" ]; then
        echo "superseded: the site runs $version, a later main commit that includes $SHA: run scripts/wait-for-deploy.sh $version"
        exit 13
      fi
    fi
    echo "health: $URL did not report $SHA healthy in $((HEALTH_WAIT / 60)) minutes; last answer: ${body:-none}"
    exit 12
  fi
  pause
done
