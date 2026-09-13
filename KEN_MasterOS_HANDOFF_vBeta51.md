# KEN Traders Master OS — Handoff (as of vBeta51)

Written 13 Sep 2026. Hand this whole file to a new chat as the first message,
then say which page you want to work on next.

---

## 0. What this project is

A single-file HTML/CSS/JS PWA — an ERP for Raaja's AAC block business in
Udumalpet. Used **almost exclusively on an Android phone**, in Chrome.

**Files (only two ship):**

| File | Where it lives in the working session | Where it lives on the PC |
|---|---|---|
| `index.html` (~2.9 MB) | `/tmp/work3/index.html` | `E:\Github\ken-projects-masteros\beta\index.html` |
| `sw.js` (service worker) | `/tmp/work3/sw.js` | `E:\Github\ken-projects-masteros\beta\sw.js` |

Also in `/tmp/work3/`: `KEN_Traders_MasterOS_vBeta51.html` — the frozen
baseline the print-safety harness diffs against. **Keep exactly one baseline**;
delete the previous one when you cut a new release.

---

## 1. Non-negotiable constraints — read these before touching anything

### 1.1 Never break Document Print Preview / A4 PDF export
Every release must be gated. Two commands, both from `/tmp/work3`:

```bash
node pixel_diff_v31.js     # renders .bill-layout for all 8 doc types, old vs new
python3 print_check.py     # byte-compares the PNG pairs
```

`print_check.py` must end with `PRINT SAFETY: PASS ✓` and list all eight as
`identical`. The eight doc types are **SAL, INV, QUO, CRN, ADV, RCP, EXP, RCM**.

`pixel_diff_v31.js` line 32 names the baseline file. **Repoint it every time you
cut a release** (`sed -i "s/vBeta51/vBeta52/" pixel_diff_v31.js`).

The harness suppresses the text caret and blurs focus before capture — an
earlier version intermittently reported a phantom 1px sliver at (612,658) on
CRN/RCP that reproduced when diffing the baseline against *itself*. Do not
"simplify" that away.

### 1.2 Never change the VALUES of two colours
- `#2c3e50` — KEN Logo Navy
- `#21b860` — Grand Total Green

Occurrence **counts** may move as markup changes; the **value** must never be
rewritten to a near-miss. Gate every release with:

```bash
cd /tmp/work3
for f in index.html KEN_Traders_MasterOS_vBeta51.html; do
  echo -n "$f navy: ";  grep -o '#2c3e50' $f | wc -l
  echo -n "$f green: "; grep -o '#21b860' $f | wc -l
done
grep -oiE '#2c3e5[0-9a-f]|#21b86[0-9a-f]' index.html | sort | uniq -c
```

The last line must show **only** `#2c3e50` and `#21b860` — any other variant is
a silently corrupted colour. If the count moved, diff the actual lines and
confirm each add/remove was intended:

```bash
grep -o '.\{0,70\}#2c3e50.\{0,40\}' KEN_Traders_MasterOS_vBeta51.html | sed 's/^[[:space:]]*//' | sort > /tmp/navy_old.txt
grep -o '.\{0,70\}#2c3e50.\{0,40\}' index.html                        | sed 's/^[[:space:]]*//' | sort > /tmp/navy_new.txt
diff /tmp/navy_old.txt /tmp/navy_new.txt
```

vBeta51 baseline counts: **navy 143, green 2.**

### 1.3 The device bridge
The PC folder is `E:\Github\ken-projects-masteros` (connected root); the app
lives in its `beta\` subfolder. **Never claim the PC is connected without a
successful tool call, and never claim it's unreachable without trying.** It has
been off for long stretches — when it is, deliver via `SendUserFile` only and
say plainly that the folder write did not happen. When it is on, do both:
SendUserFile, then `device_commit_files` into `beta\`.

### 1.4 Version bump — three places, always together
1. `index.html` line ~4454: `<span id="appVersionBadge">vBeta51</span>`
2. `index.html` line ~8848: `const APP_VERSION = "vBeta51";`
3. `sw.js` line 21: `const CACHE_NAME = 'ken-traders-beta-vbeta51';`

A stale `CACHE_NAME` means the phone keeps serving the old app. Bumping it is
what forces the update.

---

## 2. The working process Raaja set

- Go through the **18 Reports & Tools pages in reverse order**, one at a time.
- He lists sub-items as letters; refer to them as **18a, 16b, 15f** etc.
- **Design first, code later.** Mock things up, get his call on each item, and
  only write code once several pages are settled. (He originally said six
  pages; for vBeta51 he chose to code after four.)
- He judges everything **on the real device**. Headless screenshots can be
  confidently wrong — three times now a "fix" I proposed from a screenshot was
  rejected because on the phone it already looked right. When he says "no, you
  are wrong", withdraw the item publicly and do not re-litigate it.
- Do not invent problems. Two items in this run (15d, part of 15e) were
  withdrawn entirely because they were misreadings of deliberate global rules.

### The 18 pages, in his numbering

| # | Page | Opens via | Status |
|---|---|---|---|
| 18 | Letterpad | `openContracts()` | ✅ done, vBeta51 |
| 17 | Tonnage | `openTonnageCalc()` | ✅ done, vBeta51 |
| 16 | All Projects | `openAllProjectsOverview()` | ✅ done, vBeta51 |
| 15 | Pricing | `openPricingEngine()` | ✅ done, vBeta51 |
| 14 | Vault | `openVault()` | ⬜ next |
| 13 | Dummy (placeholder tile) | toast only | ⬜ |
| 12 | Brand Assets | `openBrandAssets()` | ⬜ |
| 11 | Sites | `openSitesManager()` | ⬜ |
| 10 | Clients | `openClientList()` | ⬜ |
| 9 | Trips | `openTrips()` | ⬜ |
| 8 | Advance Pool | `openUnregisteredAdvancePoolSearch()` | ⬜ |
| 7 | Data & Sync | `openSyncHealth()` | ⬜ |
| 6 | Stock | `openStockManager()` | ⬜ |
| 5 | Cash Book | `openCashBook()` | ⬜ |
| 4 | Audit | `openAuditorExport()` | ⬜ **has a carry-over checklist, see §5** |
| 3 | Summary | `openMonthlySummary()` | ⬜ |
| 2 | Outstanding | `openOutstanding()` | ⬜ |
| 1 | Ledger | `openLedger()` | ⬜ |

(The grid shows 15 tiles because "Search Everything" is commented out, not
deleted — it sat between Brand Assets and Tonnage.)

---

## 3. Architecture notes you will need

### 3.1 Design tokens
Vista token system. `--vista-*` declared at `:root`, then **aliased** per
surface: `--hp-*` inside `.editor-box`, `--tng-*` inside `#tonnageModal`,
`--pm-*` inside Pricing. When you add a colour to one of those surfaces, use
that surface's alias with the literal as fallback:
`color: var(--pm-ink, #2c3e50)`.

Core neutrals: ink `#1C1C27`, muted ink `#5F5D70`, border `#E1E1E6`, surface-alt
`#EDEDF1`, page `#F4F4F7`.
Tint/ink pairs: mint `#EBFCEC`/`#1C7A3E`, amber `#FEF3E0`/`#92400E`, danger
`#FDECEC`/`#A32A2E`, blue `#E8F5FF`/`#0B5A94`, purple `#6B3FA0`.

### 3.2 The legacy solid-fill remapper — a real trap
There are CSS rules of the form:

```css
.modal-content button[style*="#1C7A3E" i] { ... }
```

for `#1C7A3E`, `#A32A2E`, `#92400E`, `#0B5A94`, `#6B3FA0` and `#2c3e50`. They
rewrite **any** `<button>` inside a modal whose inline style contains one of
those hexes into a pale tint. This bit me building the Letterpad colour
swatches — they rendered as pastels instead of the real ink colours.

**Rule: when an inline hex must render literally, do not use `<button>`.** Use
`<span role="button" tabindex="0">`.

### 3.3 The `keep-grid` escape hatch
Both the `@media (max-width:480px)` block and the force-mobile block contain:

```css
[style*="grid-template-columns"]:not(.keep-grid) { grid-template-columns: 1fr !important; }
```

So any inline multi-column grid inside a modal collapses to one column on a
phone. If you genuinely want two columns there, add `class="keep-grid"` — do
**not** fight it with your own `!important`.

### 3.4 The mobile branch
`isMobileDocView()` returns `window.innerWidth <= 700 || document.body.classList.contains('force-mobile-main')`.
This is the app's established pattern for a separate mobile rendering path.
`renderAllProjectsOverview()` is the reference implementation added in vBeta51:
an `if (isMobileDocView()) { …cards…; return; }` before the desktop table.

Important: mobile CSS lives in **three** places that must be kept in sync —
`@media (max-width:700px)`, `@media (max-width:480px)`, and one or two
`body.force-mobile-main` copies. Grep for the selector before assuming one edit
is enough.

### 3.5 `enhanceReportTables()`
A rAF-coalesced MutationObserver (childList only) that walks every
`.analytics-table`, reads its own `<th>` text, stamps `data-label` on each
`<td>`, and adds `.rpt-cards` so the table reflows into cards on a phone.
It **skips** tables with no `<thead>` and tables whose header is a colspan
banner. As of vBeta51 it also marks the first cell of each row
`.rpt-card-title`, which suppresses that cell's `::before` label and renders it
as the card's heading.

This is the system-wide fix for the horizontal-scrolling tables Raaja called
"the last thing stopping this app from looking like a native app". If a table
still scrolls sideways on the phone, check first whether it has a proper
`<thead>` — that's usually why the observer skipped it.

### 3.6 The split-table bug (do not reintroduce)
Setting `display:block` on a `<table>` **and** `thead, tbody { display:table }`
creates two independent tables with separate column models — headers stop
lining up with rows. With `display:block` alone the browser wraps the row groups
in one anonymous table and columns stay aligned. Caveat: a narrow 2-column table
then shrink-to-fits and no longer fills its container.

### 3.7 Native date/colour inputs on Android
Chrome's "Auto Dark Mode for Web Contents" recolours text **inside** native
widgets no matter what the page CSS says; `color-scheme: light` does not win.
The app's fix is an app-drawn `<span>` with the value, plus the real input
overlaid at `opacity: 0` — see `.dfilter-field` / `.dfilter-text`, and
`renderLetDateDisplay()` in Letterpad. Reuse that pattern; don't try to style
the native widget.

### 3.8 Touch `:hover` latching
On touch, a tapped element keeps `:hover` until you tap elsewhere. Neutralise
hover styling under `@media (hover: none)`.

### 3.9 Letterpad scaling
`updateLetterheadScale()` is now view-aware:

```js
let scale = (typeof letterpadView !== 'undefined' && letterpadView === 'read')
  ? Math.max(availableWidth / trueWidth, 1)                                  // read: zoom in, scroll
  : Math.min(availableWidth / trueWidth, availableHeight / trueHeight, 1);   // fit: whole page
```

and the wrapper's `overflow` follows (`auto` in read, `hidden` in fit).
`#letBody` is a child of `#letterheadPage` inside `#letterheadScaleContainer`.
All three print/export entry points (`printLetterheadContent()`,
`exportLetterheadToPDF()`, `printLetterheadBlank()`) call
`switchLetterpadTab('write')` first — the preview must be in the DOM and laid
out before capture.

---

## 4. What shipped in vBeta51 (four pages)

### 18 · Letterpad — full restructure
Replaced the 4-pill `tool-jumpnav` + one long controls column with **three real
tabs**: `#letSecDetails`, `#letSecWrite`, `#letSecActions`, driven by
`switchLetterpadTab(tab)`. `#letterheadPreviewWrapper` moved **inside**
`#letSecWrite` so the toolbar sits directly above the text.

New functions: `setLetterpadView(mode)` (read/fit), `LET_DEFAULT_INKS` (8 CMYK-
safe inks), `getLetInks()` / `saveLetInks()` / `renderLetColourGrid()` /
`pickLetColour()` / `applyLetColour()` / `toggleLetColourPanel()` /
`toggleLetColourEdit()`, `setLetterpadFontSize(size)`, `renderLetDateDisplay()`,
and a staged scan flow: `_letStagedFile`, `letNextScanDocNo()` (uses `#letDate`,
not `todayISO()`), `stageLetterScan()` / `cancelLetterScan()` /
`confirmLetterScanUpload()`. `handleLetterScanUpload()` was deleted — uploading
no longer instantly burns a serial; it previews first.

`openContracts()` now calls `switchLetterpadTab('details')`,
`renderLetDateDisplay()`, `setLetterpadView(letterpadView)`,
`renderLetColourGrid()` and no longer calls `initToolSectionScrollspy('letJumpNav')`.

Gotcha fixed: the Letterpad sub-tabs wrapped 2+1 because 15e made
`.engine-tab-bar` a 2-column grid. `.let-tab-bar { grid-template-columns: repeat(3,1fr) !important; }`.

### 17 · Tonnage — one fix only
17c: `#tonnageModal .tng-grid-header` lacked the rows' 12px horizontal padding.
Now `padding: 0 12px 8px`. Column offsets measured `[0,0,0]`.

Raaja **rejected** 17a, 17b, 17d, 17e, 17f. Notably 17d (auto-distribute
tweak) — he always leaves one quantity row on Auto, which pins the total to the
target, so the proposed change was pointless. Don't revisit these.

### 16 · All Projects
- 16a-1: overview totals are a 2×2 grid — `#allProjectsOverviewTotals` with
  `class="keep-grid"` and a `totalTile(bg, ink, label, value)` helper using
  `white-space:nowrap; font-variant-numeric:tabular-nums`.
- 16b-1: real mobile cards via `isMobileDocView()`, `.proj-card*` CSS, and
  `toggleProjectCard(id)` flipping `det.hidden` and the `Details ▾ / ▴` label.
- 16c: the system-wide `.rpt-card-title` heading (see §3.5).
- 16e: "no target set" was `#E1E1E6` (read as disabled) → now `#5F5D70`.

### 15 · Pricing
- 15a-1: `renderBrandTierGrid()` no longer emits a `<table>` — it emits
  `.btg-list` / `.btg-head` / `.btg-row` divs with flex cells (rate input
  `width:120px`). Dead space 96px → 0.
- 15b: the permanent red auto-update warning became a neutral `#EDEDF1`
  `#cfgAutoUpdateRow` plus a collapsible `#cfgAutoUpdateWhy`; new
  `toggleAutoUpdateWarning()` repaints it red **only when the box is checked**.
- 15c: save button is now `var(--vista-mint-text, #1C7A3E)` on white, labelled
  "💾 Save pricing".
- 15e: `.engine-tab-bar` → `display:grid; grid-template-columns:1fr 1fr; gap:6px`
  (3+1 tabs were orphaning the fourth). Note "+ Add New Product" **is a real
  tab** (`switchEngineTab('new')`), not an action — I got this wrong once.
- 15f: the duplicate Audit Lock block was deleted from Pricing entirely —
  `#cfgAuditLockDate`, the `lockType_*` checkboxes, `#auditLockStatus`, the dead
  `updateAuditLockDate()` / `clearAuditLockDate()`, the two null-throwing lines
  in `renderAuditLockStatus()`, and the never-unchecking sync-back in
  `setAuditLockFromModal()`. See §5.

**Withdrawn, do not resurrect:** 15d (I claimed uppercase labels were a bug —
`label { text-transform: uppercase }` is a deliberate global rule).

---

## 5. Carry-over checklist for page 4 · Audit

15f deleted the Pricing copy of Audit Lock. Before that deletion, the two boxes
were **not** identical. What was already ported into the Audit tab in vBeta51:

- ✅ **QUO added.** `<input type="checkbox" id="alm_QUO"> Quotation`, and
  `setAuditLockFromModal()` now filters over all eight:
  `['INV','RCM','SAL','ADV','RCP','CRN','QUO','EXP']`.
- ✅ **Longer labels** — "Advance Receipt", "Payment Receipt", "Expense Voucher"
  (a bare "Receipt" was ambiguous next to "Advance Receipt").
- ✅ **`kenAuditLockSetAt` kept** — the Audit tab records when the lock was set;
  Pricing never did. Do not lose this.
- ✅ **The never-unchecks sync-back bug is gone** with the Pricing copy.

**Still to verify when you reach page 4:** that the Audit tab's lock UI is
complete on its own — date field, all eight type checkboxes, status line, master
password prompt, and the set-at timestamp displayed somewhere. Both boxes always
wrote the same saved setting through `saveAuditLockDate()`, so there is nothing
else to port; this is a read-through, not a rebuild.

---

## 6. Open design question

**The purple token.** Tonnage (`#6B3FA0`, `--tng-*`) is the only screen using
purple. Raaja asked whether it could spread to other screens or should stay
unique to Tonnage. Decision deferred; I am keeping a **running tally** of pages
that would want it. So far: **16 · All Projects — no. 15 · Pricing — no.**
Keep adding to this tally as you go, and put the question to him at the end of
the pass rather than deciding for him.

---

## 7. Design canvas

Mockups live at
`https://claude.ai/code/artifact/ceccb6cf-0cf0-487d-a7db-9f2fb7a55e3c`
(version 15 at handoff), pages 1–7: Reports & Tools Menu, Blocks Calculator
Cohesion, Finalists, 18 · Letterpad, 17 · Tonnage, 16 · All Projects,
15 · Pricing.

Generator scripts are in the session scratchpad under `reports-menu/`
(`gen18.js`, `gen18f.js`, `gen17.js`, `gen17c.js`, `genPurple.js`, `gen16.js`,
`gen15.js`, `gen15f.js`), seeded with `seed-canvas.mjs` into `.dc.html`
artboards + `canvas.json`, published with `contract: "0.1.31"` and
`capabilities { self:{}, downloads:{} }`.

**These scratchpad files do not survive into a new session.** If you need to
regenerate a mockup, copy the pattern from `gen15f.js` (quoted in the old
transcript) — a plain Node script that writes a `.dc.html` artboard with inline
styles and a `<x-dc>` wrapper.

---

## 8. Release checklist (copy this into the new chat)

```
[ ] Make the code changes
[ ] Functional verification in Playwright — no page errors
[ ] node pixel_diff_v31.js && python3 print_check.py   → PRINT SAFETY: PASS ✓
[ ] navy/green counts + near-miss grep; diff the lines if a count moved
[ ] Bump all three: appVersionBadge, APP_VERSION, sw.js CACHE_NAME
[ ] cp index.html KEN_Traders_MasterOS_vBetaNN.html ; rm the previous baseline
[ ] sed -i "s/vBetaNN-1/vBetaNN/" pixel_diff_v31.js
[ ] get_device_info → if E:\Github\ken-projects-masteros is connected,
    SendUserFile then device_commit_files into beta\ ; if not, SendUserFile
    only and say plainly the folder write did not happen
[ ] Update memory (ways-of-working.md, overview.md)
```

---

## 9. Release history (recent)

| Version | What |
|---|---|
| vBeta47 | Close buttons at the bottom of Reports & Tools / Blocks Calculator |
| vBeta48 | Blocks Calculator "I+M" scheme — red dotted deduct-opening border, half/half add-row + clear, close button |
| vBeta49 | Report-table root cause (`enhanceReportTables()`), date-filter visibility, tonnage clear-button red, Documents → Vault (Google Drive link) |
| vBeta50 | "Option D" Reports & Tools menu — boxless grid, larger icons and labels, original (non-inverted) icon colours |
| vBeta51 | Pages 18 · Letterpad, 17 · Tonnage, 16 · All Projects, 15 · Pricing |
