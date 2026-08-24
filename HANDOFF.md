# KEN Traders Master OS — Project Handoff

**Owner:** Raaja — AAC blocks business, Udumalpet, Tamil Nadu
**Current shipped version:** v79
**Last updated:** 24 August 2026

---

## 1. What This Project Is

**KEN Traders Master OS** is a single-page business management application (ERP) built for an AAC blocks trading business. It handles the entire document and inventory lifecycle: quotations, invoices, receipts, credit notes, expense vouchers, stock tracking, client records, outstanding payments, and reporting.

### Technology stack

| Layer | Technology |
|---|---|
| Frontend | Single-page HTML + Vanilla JavaScript (no framework) |
| Backend | Google Apps Script |
| Database | Google Sheets |
| Offline support | Service worker (`sw.js`) with versioned cache |
| PDF generation | `html2pdf.js` |
| Testing | Node + jsdom harness |

The entire application is one HTML file, currently ~1.27 million characters. There is no build step — the file is deployed as-is.

### Business domain model

**Product catalogue**
- AAC Blocks: 4, 6, 8 and 9 inch — brand-distinct SKUs (Meghalite, Birla)
- Jointing Mortar (40 Kg bag) — single SKU, **never** brand-split
- Services: Transport, Loading, Unloading, Loading & Unloading

**Document types**

| Code | Name | Notes |
|---|---|---|
| `QUO` | Quotation | Numbering starts at 200 (sequence jump) |
| `ADV` | Advance Receipt | |
| `RCP` | Payment Receipt | |
| `INV` | Tax Invoice | **The single source of truth for stock sold** |
| `SAL` | Sales Invoice | Informal; re-issued for revisions *without* voiding the old one |
| `CRN` | Credit Note | Reduces sold counts (stock returns) |
| `RCM` | RCM Payment Voucher | |
| `EXP` | General Expense Voucher | |

**Pricing engine.** Block rates are calculated dynamically, not fixed:
- Per-inch base rate varies by **tier** — Customer / Engineer / Builder / Sub-Dealer
- A **retail premium** (+₹10/block) applies unless the order crosses a **wholesale tonnage threshold** (default 12 tonnes), calculated live from cart weight
- Because rates are dynamic, blocks are deliberately excluded from any "last used rate" shortcut

**Stock location.** Only one location ("Stockyard") is used in practice, so stock deduction is silent — no location picker on invoices.

---

## 2. How We Work Together

These conventions were established over multiple sessions and should be carried forward.

### Working principles

1. **Read the actual file before modifying anything.** Never recommend or edit based on assumption. Grep and read the real function first. This has repeatedly caught wrong assumptions.
2. **Test logic before building UI.** Isolated Node fixtures first, UI second.
3. **Extracting real functions from the shipped file and testing those is stronger than testing hand-copies.** Used for the auto-link engine (v78) and the shortfall engine (v79).
4. **Check for dead code before implementing.** The duplicate invoice guard turned out to be already live and fully wired — nearly rebuilt for nothing.
5. **Honest disclosure.** Sandbox losses, wrong first attempts and incorrect diagnoses get stated plainly, not quietly worked around.
6. **Don't build tests against UX that's about to change.** Decide and implement UX first, then test.

### Version bump protocol — one atomic step

All three must move together, then ship:

1. `const APP_VERSION = "vNN";`
2. `<span id="appVersionBadge">vNN</span>`
3. `sw.js` → `const CACHE_NAME = 'ken-traders-vNN';`
4. Copy both files to `/mnt/user-data/outputs/`
5. Call `present_files`

### Environment notes

- `/mnt/user-data/outputs/` **survives sandbox resets** — it is the source of truth for recovery
- `/home/claude/` **does not survive** — working copies must be restored from outputs
- `bash_tool` availability has varied between sessions; `subprocess.run(['bash','-lc', ...])` via `code_execution` is the fallback
- jsdom may need reinstalling after a reset: `npm install jsdom --silent`

### Test harness (`/home/claude/harness.js`)

Boots the real application HTML inside jsdom with stubbed browser APIs.

**API signatures (easy to get wrong):**
```js
const { win, doc, captured, setPromptAnswers, setConfirmAnswers } = await bootApp({
  seed: { kenStockBatches: '...' },   // NOTE: 'seed', not 'preseed'
  fetchResponse: [...]
});

t.check(label, pass, detail)          // label FIRST
t.eq(label, actual, expected)         // label FIRST
captured.errors                       // NOT a bare `errors` variable
```

**Critical gotchas:**
- Must call `process.exit(0)` at the end — the app sets intervals that keep Node's event loop alive forever
- The harness does **not** export DOM helpers (`byId`, `setValue`) — define them locally in each test
- `navigator.serviceWorker` must be stubbed with a real `.register()` returning a promise
- **App state is closure-scoped.** `cart`, `savedDocs` and `currentlyLoadedDocId` are *not* assignable from outside via `win.` — seed through localStorage, or extract the function and inject dependencies

---

## 3. Journey So Far

### v77 — PDF export fix
CSS specificity fix for A4 PDF export. Shipped.

### v78 — Stock Manager redesign

A substantial rebuild of stock tracking, completed after a mid-session sandbox reset destroyed the in-progress work (disclosed plainly; all changes were reapplied from the documented plan and re-verified from scratch).

**Decisions locked with Raaja:**
- Sold quantities come from **Tax Invoices only**, never Sales Invoices — SAL is re-issued for revisions without voiding the old one, which was causing genuine double-counting
- Credit Notes reduce sold counts
- Landing cost / margin detail stays available but collapsed; the primary view is plain Bought / Sold / Ledger quantity
- All Tax Invoices auto-link to stock on save — no manual linking step
- Mortar is tracked but never brand-split; blocks stay brand-distinct

**What was built:**
- Simple stock data layer: `getSimpleBoughtQty`, `getSimpleSoldQty`, `getSimpleLedgerQty`, physical count storage
- Automatic invoice→stock linking with full idempotency: `reverseStockMovementsForDoc`, `autoLinkInvoiceStock`, `applyCreditNoteReturn`. Handles edit, void, un-void and re-save without double-deducting
- Overview tab: per-item cards showing Bought / Sold / Ledger plus an editable physical count with live mismatch display
- **Bug fixed:** `searchLinkableInvoices()` included `['INV','SAL']`, causing double-counting. Restricted to `INV`
- Link Invoice tab reframed as backfill-only for pre-v78 invoices
- Add Batch simplified — cost no longer required to log a batch

**Verification:** 8/8 simple stock logic, 11/11 auto-link lifecycle (against functions extracted from the shipped file), jsdom structural checks, full-file syntax and duplicate checks.

### UX audit (between v78 and v79)

Rather than immediately writing a test suite, Raaja redirected to fixing UX first. A systematic scan was performed of all 226 `<input>` tags, 81 `<select>` tags, 415 onclick handlers, 292 distinct handler functions and 42 modals.

**Key finding:** three fields required typing a document number from memory (`crnOrigRef`, `rcpInvoiceRef`, `supersedesRef`), while the correct search-and-tap picker pattern already existed elsewhere in the app and simply hadn't been applied consistently.

This audit produced the 25-item roadmap in section 5.

### v79 — Stock entry simplification + nine UX features

Shipped in two stages. See section 4.

---

## 4. What v79 Delivers

### Stage 1 — Quick Stock Entry

**Problem:** logging a delivery required typing the full item name as free text (`AAC Block 8 Inch (Meghalite)`) on every row, plus cost details that Raaja didn't want to deal with.

**Solution:** a Quick Entry panel at the top of Add Batch — pick the brand **once**, then all four block sizes plus mortar are preset with only a quantity box each.

- Composes canonical item names via `composeBlockProductName()` so they match invoice line names character-for-character
- Feeds the existing batch engine — no parallel storage path
- Switching brand and entering again **appends** (second lorry, different brand)
- Boxes clear between entries so stale numbers can't be re-added
- Cost remains entirely optional in a collapsed section

**Tests:** 19/19.

### Stage 2 — UX items 1–9

Detailed in section 5. **Two real bugs were caught by the tests during this work:**

1. **Temporal dead zone crash.** `renderTable()` runs during boot *before* the new `let`/`const` declarations are reached, throwing on every page load. The `typeof fn === 'function'` guard did not catch it, because function declarations hoist but `let`/`const` do not. Fixed by using `var` for boot-reachable bindings and wrapping the boot-time calls in try/catch so a convenience feature can never take the core render down.
2. **Quick-add chips leaked blocks.** `trackItemFrequency` refused to *write* block entries, but `getTopFrequentItems` did not filter on *read* — so legacy or cloud-synced block entries would still surface a chip advertising a stale fixed rate for a dynamically-priced item. Fixed at the read side too.

**Also fixed:** `convertDocument()` was silently dropping the client's GSTIN, so every quotation→invoice conversion produced a Tax Invoice marked URD even for a registered client.

### v79 test results

| Suite | Result |
|---|---|
| `test_quick_stock.js` — Quick Stock Entry | 19/19 |
| `test_v79_ux.js` — UX items 1–9 | 41/41 |
| `test_v79_logic.js` — password tiering | 11/11 |
| `test_v79_shortfall.js` — shortfall engine (real extracted source) | 28/28 |
| **Total** | **99/99** |

Full-file checks: JS syntax valid, JS braces balanced (4814/4814), CSS braces balanced (740/740), no duplicate IDs, no duplicate function names, every new function defined exactly once and referenced.

---

## 5. The 25-Item Roadmap

**Status: 10 accomplished, 15 remaining.**

### ✅ Accomplished

| # | Item | Notes |
|---|---|---|
| — | **Stock entry simplification** | Quick Entry: brand once + preset sizes, quantity only. *(v79)* |
| 1 | **Pickers for the three type-by-memory reference fields** | `crnOrigRef`, `rcpInvoiceRef`, `supersedesRef` now search-and-tap. Matches on doc number **or** client name; digit-only input works ("42" finds INV/0042); voided docs excluded. *(v79)* |
| 2 | **Autosave in-progress invoice** | Debounced snapshot of fields + cart to localStorage, restore banner on reload, cleared on save or New Doc. Local-only, never cloud-synced. *(v79)* |
| 3 | **Quick-add chips for frequent items** | New general frequency tracker (the pre-existing one only counted free-text custom items). Top 5 non-block items as one-tap chips. *(v79)* |
| 4 | **Tier password prompts by risk** | Six routine admin gates unlock once for a 15-minute in-memory window; destructive actions (deletes, audit lock, factory reset, number overwrite) always re-prompt. *(v79)* |
| 5 | **Mobile card layouts for wide tables** | Document Manager and Outstanding become readable cards below 700px. **Scoped deliberately** to `.cloud-doc-table` / `.outstanding-flat-table`, never the shared `.doc-list-table` / `.analytics-table` classes. *(v79)* |
| 6 | **Stock shortfall before save, not after** | Live cart-wide warning plus a pre-save confirmation. Correctly credits back an invoice's own quantities when editing, so an unchanged re-save doesn't false-alarm. *(v79)* |
| 7 | **Duplicate-invoice guard (same client + date)** | **Was already implemented and wired** before v79 — found during audit. Initially misdiagnosed as dead code because the grep included parentheses and missed the `addEventListener` wiring. |
| 8 | **One-tap quotation → invoice** | ⚡INV button directly on quotation rows in the document list. Reuses `loadDocument()` for full field restoration rather than hand-copying fields. Also fixed the GSTIN-drop bug. *(v79)* |
| 9 | **Unmissable voided docs** | Struck-through number with a red VOID badge in the list. *(v79)* |

### ⬜ Remaining — UX (5)

| # | Item | Why it matters |
|---|---|---|
| 11 | Site field suggestions from the sites registry | Delivery site is plain free text despite a sites registry existing |
| 12 | Vehicle number history chips | No history at all; the same lorries get retyped daily |
| 13 | Sticky grand total on mobile | Figure scrolls out of view while building an invoice |
| 14 | Cloud sync status indicator | No visibility into which documents haven't reached the cloud |
| 15 | Confirmation on unusually large invoices | A slipped digit currently goes out as a real bill |

### ⬜ Remaining — Money-saving (5)

| # | Item | Why it matters |
|---|---|---|
| 16 | **Below-cost sale warning** | **Highest priority.** The app calculates landing cost but never warns when a rate falls below it — bad rates go out silently. Cheap to build, protects margin on every sale |
| 17 | Slow-moving stock ageing | No tracking; capital sits in the yard unnoticed |
| 18 | Freight charged vs. paid comparison | Transport paid per batch is recorded but never compared against freight billed out — leakage is invisible |
| 19 | Breakage costing from physical counts | Count mismatch is currently a block count, not a rupee figure |
| 20 | Credit-period enforcement | Ageing exists, but nothing stops the next load going to a client already past terms |

### ⬜ Remaining — Time-saving (5)

| # | Item | Why it matters |
|---|---|---|
| 21 | Repeat last invoice as template | Every invoice starts from scratch |
| 22 | Saved item bundles | Blocks + mortar + transport as a single tap |
| 23 | Bulk WhatsApp statements to overdue clients | Currently one client at a time |
| 24 | Bulk PDF export | Needed for month-end |
| 25 | Auto-advance between qty/rate fields | Removes a tap on every single line |

---

## 6. Open Decisions

### Brand-mandatory on Tax Invoices — **awaiting decision**

Raaja's proposal, discussed but not yet implemented:

- **Tax Invoice** = the strict, auditable document. Brand **always** named on blocks. This removes the unbranded-block ambiguity entirely, making stock tracking exact rather than best-guess
- **Sales Invoice** = the flexible one. Unbranded lines, transport, loading, unloading all fine

**Assistant's recorded pushback:** blocking transport/loading charges from Tax Invoices entirely is risky — those are legitimately invoiceable, and a customer may need freight on the tax invoice for their own records. Stock tracking does **not** require that restriction, since non-block lines are simply ignored for stock purposes. Recommendation: make brand mandatory, but leave charges allowed.

**Still to resolve:**
1. Does brand-mandatory apply to mortar, or blocks only? (Mortar is currently never brand-split, and tracking it without brand works fine.)
2. Roughly 30 existing invoices have unbranded blocks. Raaja has confirmed he can correct these by hand — nothing has been officially filed yet. Decide whether to leave them, flag them, or bulk-correct.
3. Hard block or overridable warning?

### GST rate verification — **action for Raaja's CA**

The 12% rate on AAC blocks under HSN 6815 applies to blocks with **more than 50% fly ash content**. The app currently hardcodes 12% for every block. Written confirmation of fly ash content should be obtained from Meghalite and Birla — if any product doesn't qualify, there is an 18% liability being carried silently.

### Other pending items

- **Historical stock backfill.** Pre-v78 Tax Invoices were never auto-linked. The reframed Link Invoice tab can backfill them — not yet discussed whether Raaja wants this done.
- **Backend redeploy.** `Code_v6.gs` still needs a manual redeploy in the Apps Script editor; deployment status unconfirmed.
- **Comprehensive test suite.** Deliberately deferred. Once the UX roadmap settles, build it split by area (documents / stock / reports & tools) rather than one monolithic file, using `harness.js` as the foundation.

---

## 7. Business Advisory (non-app)

Captured from a strategy discussion; no code implications.

### Cost-saving opportunities
1. **Verify the fly ash / GST position** (see above) — potentially the largest single exposure
2. **Input tax credit discipline** — every purchase bill, freight voucher and expense captured; unclaimed credit is cash already paid out
3. **Freight recovery** — compare transport paid against freight charged (roadmap item 18)
4. **Cost the breakage** — value count mismatches in rupees to support supplier damage claims (roadmap item 19)
5. **Enforce credit periods** before dispatch, not after (roadmap item 20)

### Lead generation
1. **Mine your own database** — every quotation that never became an invoice is a warm lead with a name, phone number and known requirement. Nobody is following these up systematically. This is the highest-value, zero-cost option
2. **Masons and site contractors** specify materials before the owner sees a quote — a per-load referral arrangement reaches buyers earlier than advertising
3. **Google Business listing** — someone searching "AAC blocks Udumalpet" is ready to buy today
4. **Architects and structural engineers** across the Pollachi / Palani corridor write the specifications; one relationship wins many jobs
5. **Small hardware shops as sub-dealers** — sub-dealer pricing already exists in the app

---

## 8. Key Files

### Shipped
| File | Purpose |
|---|---|
| `/mnt/user-data/outputs/v79.html` | Frontend — current version |
| `/mnt/user-data/outputs/sw.js` | Service worker, `CACHE_NAME = 'ken-traders-v79'` |
| `/mnt/user-data/outputs/Code_v6.gs` | Backend Apps Script (needs redeploy) |

### Prior versions (in outputs)
`v75a.html` (trusted mobile baseline), `v76a/b/c.html`, `v77.html`, `v78.html`

### Test files (in `/home/claude/` — lost on sandbox reset, recreate as needed)
| File | Covers |
|---|---|
| `harness.js` | jsdom app-boot harness — foundation for everything |
| `test_quick_stock.js` | Quick Stock Entry (19 checks) |
| `test_v79_ux.js` | UX items 1–9 (41 checks) |
| `test_v79_logic.js` | Password tiering (11 checks) |
| `test_v79_shortfall.js` | Shortfall engine via real extracted source (28 checks) |

---

## 9. Quick Start for a New Session

```bash
# 1. Restore the working copy (outputs survives resets, /home/claude does not)
cp /mnt/user-data/outputs/v79.html /home/claude/v79.html
cp /mnt/user-data/outputs/sw.js /home/claude/sw.js

# 2. Reinstall jsdom if the sandbox was reset
cd /home/claude && npm install jsdom --silent

# 3. Verify the file is healthy before touching anything
python3 -c "
import re, collections
html=open('/home/claude/v79.html').read()
s=re.findall(r'<script>(.*?)</script>',html,re.S)
open('/home/claude/_c.js','w').write(max(s,key=len))
print('js braces', html.count('{'), html.count('}'))
ids=re.findall(r'id=\"([^\"]+)\"',html)
print('dup ids:', {k:v for k,v in collections.Counter(ids).items() if v>1})
"
node --check /home/claude/_c.js && echo SYNTAX_OK
```

**Then, before any edit:** grep and read the actual function. Never modify on assumption.
