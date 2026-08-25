# Auto-deploying the backend from this repo (clasp)

Google's own CLI, `clasp`, can push `.gs` files straight from a repo into
an Apps Script project — no copy-paste. Wired into a GitHub Action, every
push to `main` that touches `gas/` will update your Apps Script project
and cut a new version on your existing Web App deployment automatically.

This needs a **one-time setup**, done once on your own machine (the OAuth
step has to happen in your own browser, logged into the Google account
that owns the Apps Script project — this can't be done from here).

## 1. One-time local setup

```
npm install -g @google/clasp
clasp login
```

This opens a browser, you approve access, and it writes `~/.clasprc.json`
on your machine. That file is your Google credential for clasp — never
commit it.

## 2. Point clasp at your existing Apps Script project

You do NOT want `clasp create` (that makes a new project). You want to
attach clasp to the script you already have deployed:

- Open your Apps Script project in the browser.
- Project Settings (gear icon) → copy the **Script ID**.
- In this repo:
  ```
  cd gas
  cp .clasp.json.example .clasp.json
  ```
  Paste the Script ID into `.clasp.json`. This file is machine-specific
  (has your project's ID) — add `gas/.clasp.json` to `.gitignore` so it's
  never committed; the GitHub Action recreates it from a secret instead.

- Also grab your **Deployment ID**: in the Apps Script editor,
  Deploy → Manage deployments → click your existing Web App deployment →
  the ID is in the URL/detail panel. This is what lets the Action update
  the SAME deployment (same Web App URL) instead of creating a new one.

## 3. Verify the manifest before the first push

`gas/appsscript.json` in this repo is a best-guess manifest (timezone,
V8 runtime, web app access = anyone/anonymous, executes as the deploying
user). **Before your first `clasp push`, open your real project's
Project Settings → "Show appsscript.json manifest file" and compare** —
if your actual `access`/`executeAs` settings differ, clasp will silently
overwrite them on push. Match `gas/appsscript.json` to what's really
there, then commit it.

## 4. Test it manually once

```
cd gas
clasp push --force
clasp deploy --deploymentId <your deployment ID> --description "manual test"
```

Confirm the app still works exactly as before. If so, you're ready to
automate.

## 5. Wire up the GitHub Action (auto-deploy on push)

The workflow file `deploy-gas.yml` (included alongside this doc) should
be committed to `.github/workflows/deploy-gas.yml`. It needs two repo
secrets (Settings → Secrets and variables → Actions):

- `CLASPRC_JSON` — the full contents of your local `~/.clasprc.json`
  (paste it in as-is; GitHub encrypts it).
- `GAS_SCRIPT_ID` — same Script ID from step 2.
- `GAS_DEPLOYMENT_ID` — same Deployment ID from step 2.

Once those are set, every push to `main` that changes anything under
`gas/` will: install clasp → push the code → cut a new version on your
existing deployment. Your Web App URL never changes, so `WEB_APP_URL` in
`index.html` doesn't need touching.

## Notes / gotchas

- `clasp push --force` overwrites whatever is currently in the Apps
  Script editor with what's in `gas/` — so `gas/` in this repo must
  always be treated as the real source of truth once you turn this on.
  Don't hand-edit code in the Apps Script web editor anymore, or your
  next auto-push will silently discard those edits.
- Only files inside `gas/` are pushed (that's what `rootDir` in
  `.clasp.json` controls) — `Code_v6.gs` at the repo root is explicitly
  excluded, so it stays as a reference file and never gets pushed.
- `~/.clasprc.json` access tokens expire periodically; if the Action
  starts failing with an auth error, re-run `clasp login` locally and
  update the `CLASPRC_JSON` secret.
- This only changes *code*. It never touches your spreadsheet data —
  same as manual redeploys.
