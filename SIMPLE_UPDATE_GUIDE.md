# Updating your backend without copy-pasting the whole file

Forget the GitHub Action stuff — that's gone. This is the minimal version:
install a tool once, log in once, and after that, updating the live script
is one command instead of select-all-delete-paste.

## One-time setup (do this once, ever)

**1. Install clasp**
Open a terminal (Command Prompt or PowerShell) and run:
```
npm install -g @google/clasp
```

**2. Log in**
```
clasp login
```
A browser tab opens asking you to allow access to your Google account —
click Allow. That's it, this step is done forever (unless you log out).

**3. Pull down your real project**
You need your Script ID first: open your Apps Script project in the
browser → the gear icon (Project Settings) → copy the **Script ID** near
the top.

Then, in a folder where you want to keep this (e.g. Desktop, or inside
this repo as a subfolder called `gas-live`):
```
clasp clone PASTE_YOUR_SCRIPT_ID_HERE
```
This downloads your ACTUAL live code and your ACTUAL live manifest into
that folder — no guessing at settings, no comparing files. You'll see a
`Code.gs` (or similarly named file) and an `appsscript.json` appear.

Setup is done after this. Steps 1–3 never need to be repeated.

## Every time you want to update the backend

**1.** I give you a new `.gs` file (like `Code_real_v5.1_wipeguard.gs`).
Replace the contents of the `Code.gs` file inside your cloned folder with
it — either by literally pasting once into that local file, or by having
me write it there directly if your desktop is connected to this session.

**2.** In that folder, run:
```
clasp push
```
This uploads it to Apps Script for you. No copy-paste into the browser
editor at all.

**3.** One remaining manual click (this part clasp can't safely skip):
in the Apps Script editor in your browser, go to Deploy → Manage
deployments → click the pencil icon on your existing deployment → change
the version dropdown to "New version" → Deploy.

That's the whole loop, forever: I hand you a file → `clasp push` →
one click in the browser to cut a new version. Nothing about your Web
App URL changes, and nothing about your spreadsheet data is touched.

## If something goes wrong

- `clasp push` says "not logged in" → run `clasp login` again.
- `clasp push` overwrites the wrong project → double check the
  `.clasp.json` file it created in step 3 has the right `scriptId`.
- You want to check what's actually live right now → `clasp pull` grabs
  the current live code back down into that same folder, so you can
  compare it against what I've given you before pushing.
