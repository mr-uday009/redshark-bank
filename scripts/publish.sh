#!/bin/sh
# ---------------------------------------------------------------------------
# Publish Redshark Bank to GitHub and open one pull request per feature.
#
# Prerequisite: authenticate once, in your own terminal (needs a browser):
#
#     gh auth login
#
# Then, from the repo root:
#
#     ./scripts/publish.sh                # private repo (default)
#     ./scripts/publish.sh --public       # public repo
#     ./scripts/publish.sh --repo NAME    # repo name, default redshark-bank
#
# What it does:
#   1. creates the GitHub repo
#   2. pushes main and every feature/* branch
#   3. opens a PR per feature branch into main
#   4. merges them in order, so main ends up at the full working state
#
# The PRs are stacked: each branch contains its own commits plus everything
# before it. Merging in order keeps each PR's diff limited to its own feature.
#
# Safe to re-run: branches that already exist are skipped.
# ---------------------------------------------------------------------------
set -e

REPO_NAME="redshark-bank"
VISIBILITY="--private"
DESCRIPTION="Online bank on IBM Db2 for z/OS with ICSF SHA-256 hashing and a PostgreSQL mirror"

while [ $# -gt 0 ]; do
  case "$1" in
    --public)  VISIBILITY="--public" ;;
    --private) VISIBILITY="--private" ;;
    --repo)    shift; REPO_NAME="$1" ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

command -v gh >/dev/null 2>&1 || {
  echo "gh not found. Install it first:  brew install gh" >&2; exit 1
}

if ! gh auth status >/dev/null 2>&1; then
  echo "Not signed in to GitHub. Run this first, in your own terminal:" >&2
  echo >&2
  echo "    gh auth login" >&2
  echo >&2
  echo "Choose GitHub.com, HTTPS, and 'Login with a web browser'." >&2
  exit 1
fi

echo "==> Creating $REPO_NAME"
if gh repo view "$REPO_NAME" >/dev/null 2>&1; then
  echo "    already exists, reusing it"
else
  gh repo create "$REPO_NAME" $VISIBILITY --source=. --description="$DESCRIPTION"
fi

REMOTE="$(gh repo view "$REPO_NAME" --json sshUrl -q .sshUrl 2>/dev/null || true)"
if [ -z "$REMOTE" ]; then
  OWNER="$(gh api user -q .login)"
  REMOTE="https://github.com/$OWNER/$REPO_NAME.git"
fi
git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REMOTE"
echo "    remote: $REMOTE"

echo "==> Pushing main and tags"
git push -u origin main
git push origin --tags

echo "==> Pushing feature branches"
for BRANCH in $(git branch --list 'feature/*' --format='%(refname:short)' | sort); do
  git push -u origin "$BRANCH" >/dev/null 2>&1 && echo "    pushed $BRANCH" || echo "    skipped $BRANCH (already there)"
done

# ---------------------------------------------------------------------------
# One PR per feature. Order matters - each merges into main before the next is
# opened, so the diffs stay readable.
# ---------------------------------------------------------------------------
open_pr() {
  BRANCH="$1"; TITLE="$2"; BODY="$3"
  echo "==> PR: $TITLE"
  if gh pr view "$BRANCH" >/dev/null 2>&1; then
    echo "    PR already exists, skipping"
    return 0
  fi
  gh pr create --base main --head "$BRANCH" --title "$TITLE" --body "$BODY" >/dev/null
  gh pr merge "$BRANCH" --merge --delete-branch >/dev/null 2>&1 \
    && echo "    opened and merged" \
    || echo "    opened (merge it manually)"
}

open_pr feature/01-mainframe-db2 \
  "feat: mainframe Db2 objects, ICSF hashing procedure, and JDBC bridge" \
  "Sets up the mainframe side and the way the web tier reaches it.

**Db2 for z/OS**
- \`BANKAPP.USERS\` / \`BANKAPP.ACCOUNTS\` DDL
- \`BANKAPP.HASHUD\` - a COBOL stored procedure that hashes with ICSF's \`CSNBOWH\`
- JCL to build it, and the WLM application environment

**JDBC bridge**
The Node CLI/ODBC driver needs a paid Db2 Connect licence to reach z/OS and fails with \`SQL1598N\` even with correct credentials, so the app talks to Db2 through a small local HTTP bridge using \`db2jcc4.jar\` plus the freely redistributable licence jar. It exposes fixed, parameterised operations only - there is deliberately no generic SQL endpoint.

**Three errors blocked the procedure**, each masking the next: \`-471\` WLM environment inactive, \`-444\` library not APF-authorized, and \`-4220\` missing \`PARAMETER CCSID EBCDIC\`. All three are documented in \`db2/README.md\`.

\`HASHUD.cbl\` converts EBCDIC to ASCII before calling \`CSNBOWH\` because ICSF hashes the bytes it is given - without that the digest would not match what Node and PostgreSQL produce, and every existing password would break."

open_pr feature/02-postgres-mirror \
  "feat: PostgreSQL mirror schema and Drizzle setup" \
  "A drop-in local mirror of the mainframe tables so the site runs whether or not the mainframe is reachable.

Worth knowing: \`src/db/index.ts\` throws at import time if \`DATABASE_URL\` is missing, **even in mainframe mode where Drizzle is never used**. Keep it set."

open_pr feature/03-auth \
  "feat: registration, login, sessions, and dual-database routing" \
  "\`auth-service.ts\` holds the two independent switches that decide where data lives and where hashing happens.

1. **Which database** - \`isDb2Configured()\` is literally \"is \`DB2_HOST\` set\". Every read and write branches on it.
2. **Which engine hashes the password** - nested inside the first. On the mainframe it calls \`BANKAPP.HASHUD\` (ICSF); if that throws it falls back to Node's SHA-256 **and reports it**, because a silent fallback would let a security regression hide.

Both engines produce a byte-identical digest, so the same credentials work either way. \`GET /api/db2/status\` reports which engine actually ran."

open_pr feature/04-ui-redesign \
  "feat: Redshark Bank rebrand and minimalist design system" \
  "Rebrands from Sentinel Trust Bank to Redshark Bank and introduces a white/black design system.

- Design tokens in \`globals.css\` via Tailwind v4 \`@theme\`, using shadcn's naming (\`bg-background\`, \`bg-primary\`, \`border-border\`) so utilities read the way shadcn users expect. Primary is \`#0a0a0a\`.
- Primitives are hand-rolled rather than pulled from the shadcn CLI - the project has no Radix or clsx dependency and adding one for five components was not worth it.
- Logo assets derived from the supplied shark artwork: white flood-filled to transparent **from the edges**, so interior whites survive, then trimmed to content.
- Login and register become centred cards."

open_pr feature/05-rate-limiting \
  "feat: token-bucket rate limiting on auth endpoints" \
  "Login is limited on **two independent dimensions** - per IP and per account. The per-account bucket is the one that actually protects a password, since a distributed attack on one username never trips the IP bucket. Register is per-IP only.

A token bucket rather than a fixed window: a fixed window lets a caller spend the whole quota at 10:59:59 and again at 11:00:00 - double the intended rate across the boundary.

**Two caveats:**
- State is an in-process \`Map\`. Fine for one server, wrong the moment the app is scaled horizontally - each instance would enforce its own quota.
- A successful login clears the per-account bucket but *not* the per-IP one, so one person's success cannot refill the shared quota behind a NAT.

Limits are env-tunable via \`RATE_LIMIT_*\`."

open_pr feature/06-transfers \
  "feat: send and receive money with transaction history and notifications" \
  "End-to-end money movement between Redshark accounts, working on both databases.

**Data model.** One row per *side* of a transfer - SENT for the payer, RECEIVED for the payee, sharing a \`reference\`. History is then a plain indexed lookup on \`USER_ID\`, with no self-join and no way for one side to go missing.

**The balance can never go negative.** The debit is a conditional UPDATE guarded by \`BALANCE >= amount\`, and exactly one row must be updated. Two transfers racing for the last of the balance are serialised by row locks; the loser updates zero rows and is told there are insufficient funds. No \`SELECT ... FOR UPDATE\`, so no z/OS \`WITH RS\` syntax to get wrong. Both balances, both ledger rows and both notifications commit together.

**Validation order is deliberate:** cheap checks, then balance, then password, then database - so a wrong password never reveals whether the amount was affordable, and an unaffordable amount never costs a hashing round-trip.

**UI.** Amount validated against the balance as you type; Send is disabled and an alert names the available figure when it is exceeded. Three-step dialog (recipient, amount, password), processing alert, and a success animation.

Real-time is 5-second polling, paused while the tab is hidden - SSE or WebSockets would need a long-lived connection this deployment has nowhere to keep.

**Verified on both databases:** lookup by username/email/account number, over-balance rejected with 402, wrong password 400, self-send 400, zero amount 400, and a successful transfer updating both balances, both ledger rows and both notifications."

open_pr feature/07-docs \
  "docs: README, plus removing credentials and machine-specific paths" \
  "Preparing the repository to be shareable.

- Root README covering architecture, how to run against either database, and the gotchas that cost the most time
- \`db2/README.md\` and \`db2/jdbc-bridge/README.md\` no longer show a real password in their examples
- \`run-bridge.sh\` no longer hardcodes one machine's \`JAVA_HOME\` - it now tries \`JAVA_HOME\`, then a bundled JDK, then \`java\` on PATH, so a fresh clone works

**Note for the reviewer:** \`Db2Bridge.java\` and \`run-bridge.sh\` still keep \`SYS1\` as a *default* for \`DB2_PASSWORD\`. Those are the published ADCD sample credentials for a throwaway lab LPAR, and removing the default would change runtime behaviour - but it is worth revisiting before this points at anything real."

echo
echo "==> Done."
echo "    main is now at: $(git rev-parse --short main 2>/dev/null || echo '?')"
echo "    Repo: $(gh repo view "$REPO_NAME" --json url -q .url 2>/dev/null || echo "$REMOTE")"
