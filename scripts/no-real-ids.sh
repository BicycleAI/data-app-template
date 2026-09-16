#!/usr/bin/env bash
# Guards against real tenant/customer model ids or metric/dimension names
# leaking into this public kit. See AGENTS.md invariants.
#
# Usage:
#   scripts/no-real-ids.sh
#   KIT_FORBIDDEN_IDS='rnAXPGFf|RGfoyOBb' scripts/no-real-ids.sh
#
# KIT_FORBIDDEN_IDS is a pipe-separated extended-regex of names that must not
# appear anywhere in the repo (excluding template/, the hand-build starter,
# and node_modules/). It defaults to empty, which skips that check. Whatever
# KIT_FORBIDDEN_IDS is set to, this script always also fails if any
# spec/examples or profiles/examples fixture declares a "model" id that does
# not start with "m_" — real model ids from the service never look like that.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

status=0

if [ -n "${KIT_FORBIDDEN_IDS:-}" ]; then
  hits="$(git grep -iEn "${KIT_FORBIDDEN_IDS}" -- . ':!template' ':!node_modules' || true)"
  if [ -n "$hits" ]; then
    echo "no-real-ids: forbidden pattern matched (KIT_FORBIDDEN_IDS='${KIT_FORBIDDEN_IDS}'):"
    echo "$hits"
    status=1
  fi
fi

bad_models="$(
  grep -rhoE '"model"[[:space:]]*:[[:space:]]*"[^"]*"' spec/examples profiles/examples 2>/dev/null \
    | sed -E 's/.*"model"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/' \
    | grep -vE '^m_' || true
)"
if [ -n "$bad_models" ]; then
  echo "no-real-ids: model id(s) under spec/examples or profiles/examples do not start with m_:"
  echo "$bad_models"
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "no-real-ids: ok"
fi

exit "$status"
