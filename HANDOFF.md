# KEN Traders Master OS — Project Handoff

**Owner:** Raaja — AAC blocks business, Udumalpet, Tamil Nadu
**Current shipped version:** v80
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
| Testing | Node + jsdom harness, plus a mock Apps Script runtime |

The entire application is one HTML file, currently ~1.37 million characters. There is no build step — the file is deployed as-is.

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
3. **Extracting real functions from the shipped file and testing those is stronger than testing hand-copies.** Used for the auto-link engine (v78), the shortfall engine (v79), and every v80 engine.
4. **Check for dead code before implementing.** Caught twice now — the duplicate invoice guard (v79 item 7) and bulk PDF export (v80 item 24) were both already live and fully wired.
5. **Honest disclosure.** Sandbox losses, wrong first attempts and incorrect diagnoses get stated plainly, not quietly worked around.
6. **Don't build tests against UX that's about to change.** Decide and implement UX first, then test.
7. **Extract, never duplicate, a rule that already exists.** Where a second caller needs logic that lives inside a render function, lift it out and have both use it. Two copies of the outstanding-balance rules or the document-list filter would drift within a release.

### Version bump protocol — one atomic step

All three must move together, then ship:

1. `const APP_VERSION = "vNN";`
2. `<span id="appVersionBadge">vNN</span>`
3. `sw.js` → `const CACHE_NAME = 'ken-traders-vNN';`
4. Commit and push both files to `origin/main`

### ⚠️ Environment lesson learned in v80

**The chat sandbox's `/mnt/user-data/outputs/` is NOT durable across sessions.** The v78 and v79 work was delivered as file downloads and never committed — when v80 started, the repository was still at **v77** and the v78/v79 source existed nowhere the new session could reach. Raaja recovered it by pasting v79 in by hand.

**From now on: the git repository is the only source of truth.** Every release gets committed and pushed the same day it ships. Never rely on a sandbox path surviving.

### Test harness

Three suites, all runnable with plain `node`:

| File | Purpose |
|---|---|
| `harness.js` | Boots the real application HTML inside jsdom with stubbed browser APIs |
| `extract.js` | Pulls named functions out of the shipped HTML by brace-matching, so tests exercise shipped code |
| `gas_mock.js` | In-memory Apps Script runtime (SpreadsheetApp / DriveApp / LockService / Utilities) |
| `t.js` | Assertion helper — label FIRST, matching the v79 convention |

**Critical gotchas:**

- Must call `process.exit()` at the end — the app sets intervals that keep Node's event loop alive forever
- **App state is closure-scoped.** `cart`, `savedDocs`, `currentlyLoadedDocId` and `selectedDocIds` are `let` bindings at the top level of a classic script. They live in the global *lexical* environment, so `win.cart` is `undefined` and assigning to it silently does nothing. The harness exposes `app(code)` — an indirect `window.eval` that *can* see them. This is the only way to drive real app state from a test.
- `navigator.serviceWorker` must be stubbed with a real `.register()` returning a promise
- jsdom may need reinstalling: `npm install jsdom --silent`

---

## 3. Journey So Far

### v77 — PDF export fix

CSS specificity fix for A4 PDF export. Shipped.

### v78 — Stock Manager redesign

A substantial rebuild of stock tracking.

**Decisions locked with Raaja:**

- Sold quantities come from **Tax Invoices only**, never Sales Invoices — SAL is re-issued for revisions without voiding the old one, which was causing genuine double-counting
- Credit Notes reduce sold counts
- Landing cost / margin detail stays available but collapsed; the primary view is plain Bought / Sold / Ledger quantity
- All Tax Invoices auto-link to stock on save — no manual linking step
- Mortar is tracked but never brand-split; blocks stay brand-distinct

**Verification:** 8/8 simple stock logic, 11/11 auto-link lifecycle, jsdom structural checks.

### UX audit (between v78 and v79)

A systematic scan of all 226 `<input>` tags, 81 `<select>` tags, 415 onclick handlers, 292 distinct handler functions and 42 modals. Produced the 25-item roadmap.

### v79 — Stock entry simplification + nine UX features

Quick Stock Entry (brand once, preset sizes, quantity only) plus UX items 1–9. **99/99 tests.** Two real bugs caught by the tests: a temporal-dead-zone crash on boot, and quick-add chips leaking dynamically-priced blocks with stale rates. Also fixed `convertDocument()` silently dropping the client's GSTIN.

### v80 — The remaining 15 roadmap items

See section 4. **387/387 tests.** The roadmap is now complete.

---

## 4. What v80 Delivers

All 15 remaining roadmap items, plus a rebuilt backend.

### Money-saving

| # | Item | What it does |
|---|---|---|
| 16 | **Below-cost sale warning** | *The one that pays for the release.* Live banner while building the cart, plus an overridable pre-save confirmation. Compares the rate **net of GST and discount** (via the shared `computeDocLines` engine, so it can never disagree with the printed invoice) against the weighted-average landing cost. |
| 17 | Slow-moving stock ageing | Per-**batch** ageing on quantity still on hand — valid because consumption is FIFO, so quantity left on an old batch genuinely is old stock. Buckets 0–30 / 31–60 / 61–90 / 90+, with everything over 60 days listed individually. In Stock → Overview. |
| 18 | Freight charged vs paid | Transport lines billed out on INV/SAL against transport recorded on purchase batches, with a recovery percentage and a count of invoices carrying **no** transport line at all. In Stock → Profit. |
| 19 | Breakage costing | The physical-count mismatch valued in rupees at landing cost. In Stock → Overview, directly under the counts. |
| 20 | Credit-period enforcement | Live banner when a past-terms client is named, plus a pre-save confirmation on INV/SAL. |

### UX

| # | Item | What it does |
|---|---|---|
| 11 | Site suggestions | `<datalist>` on the delivery-site field, fed from the Sites registry **and** from sites actually typed on past documents. |
| 12 | Vehicle number chips | Recent lorries derived from saved documents (`vehicle` and `vVeh`) — no new storage to drift. Recency first, frequency as tiebreak. Tapping the active chip clears it. |
| 13 | Sticky mobile grand total | Fixed bottom bar under 700px. Injected outside `#billPage` and marked `no-print`, and hidden during PDF capture. |
| 14 | Cloud sync status | Per-document badge in the list plus a headline count. The existing indicator was a transient global toast — it answered "is a sync running", not "is this invoice safe". |
| 15 | Large-document confirmation | Two independent tests: **relative** (>3× the median of the last 20 same-type documents — median, so one past fat-finger can't desensitise it) and **absolute** (a configurable ceiling, set in Outstanding). |

### Time-saving

| # | Item | What it does |
|---|---|---|
| 21 | Repeat last invoice | Uses this client's last invoice when a name is typed, else the most recent. Reuses `loadDocument()` for full field restoration. Block rates **recalculated** at current tier and tonnage; vehicle and e-way deliberately cleared. |
| 22 | Saved item bundles | Named cart combinations. Quantities saved; **block rates deliberately not saved** and recomputed on apply, same distinction the v79 chips draw. |
| 23 | Bulk WhatsApp statements | One statement per client covering every overdue invoice. A **checklist**, not a `window.open()` loop — mobile browsers block all but the first popup, so a loop would send one message while looking like it sent twenty. |
| 24 | Bulk PDF export | **Was already implemented and wired** — `exportSelectedToPDF()`, found during the audit. Nothing was rebuilt. What was genuinely missing: "select all" only saw the current page of 50, so month-end meant paging through. Added **Select All Matching** across every page. |
| 25 | Auto-advance qty → rate | Enter in Qty → Rate; Enter in Rate → adds the line and returns to the product picker. Only advances if the line was actually accepted, so a rejection alert stays visible. |

### Two refactors (extractions, not rewrites)

Both were done because a second caller needed logic buried inside a render function, and a second copy would have drifted:

- **`computeOutstandingRows()`** lifted out of `renderOutstanding()`. Carries the advance double-counting fix (D2), the RCP pool, payMode-implies-paid (D1), write-offs, the IST ageing skew (A6) and due-date ageing (D4). Item 20 now shares the exact numbers the report shows.
- **`getFilteredDocsForList()`** lifted out of `renderDocList()`, so "select all matching" asks the same question the list does.

### Bugs the v80 tests caught before shipping

1. **Floating-point false alarm in the below-cost warning.** `56 / 1.12` evaluates to `49.999999999999993`, so a rate sitting *exactly* at cost triggered "below cost". Selling at cost is the normal end of a negotiation — this would have fired constantly, and a warning that cries wolf gets ignored and then trusted by nobody. Fixed by rounding to paise before comparing and requiring at least a full paisa of shortfall.
2. **Quotations escaped the below-cost check entirely.** `computeDocLines` treats every non-INV type as billing gross, which is right for what a quotation *prints* — but a quoted ₹50 against a ₹50 cost becomes ₹44.64 net the moment it converts to a Tax Invoice. Since a quotation is exactly where a bad rate gets committed to, it is now evaluated under Tax Invoice rules. The `inclusiveTax` toggle still governs, and nothing about what the quotation prints changed.

### v80 test results

| Suite | Result |
|---|---|
| `test_v80_logic.js` — engines, extracted from the shipped file | 151/151 |
| `test_v80_ui.js` — jsdom boot + structural + regression | 133/133 |
| `test_backend.js` — Code_v6.gs in a mock Apps Script runtime | 103/103 |
| **Total** | **387/387** |

Full-file checks: JS syntax valid, JS braces balanced (5137/5137), CSS braces balanced (741/741), no duplicate IDs, no duplicate function names (740 functions), every new function defined exactly once and referenced.

---

## 5. The Backend — `Code_v6.gs`

**⚠️ This file is a reconstruction. Back up the spreadsheet before deploying it.**

The original was not in the repository and did not survive the sandbox. It was rebuilt from the only authoritative source left: every call the frontend actually makes. The request and response contracts are exact and each handler cites its call site.

**What could not be recovered:** the sheet column layout. The wire format is JSON and says nothing about storage. So the backend is **header-driven** — it reads row 1 of each sheet and maps columns by header name, appends columns for fields it hasn't seen, and never moves or renames an existing one. Point it at the existing spreadsheet and it adapts rather than imposing a schema.

**Contract implemented:**

- **GET** `?sheet=<key>` for every collection; bare GET returns the documents array; `?sheet=config` returns a flat key/value object; `?sheet=lineItems` is **derived** from the Documents sheet (so the GSTR-1 HSN summary can never drift from the invoices it reports on)
- **POST** actions: `save`, `delete`, `bulkSync`, `bulkDeleteDocuments`, `bulkSetClientIds`, `saveConfig`, `saveSite`, `deleteSite`, `saveLetter`, `deleteLetter`, `uploadAuditPdf`, `uploadLetterScan`, `deleteAuditDoc`

**Three things worth knowing:**

1. **Config values must come back as strings** (except `pricingConfig`, which must be an object). `index.html` guards `auditLockDate`, `auditLockTypes`, `addressOptions`, `termsTemplates` and every `CONFIG_SYNC_KEYS` entry with `typeof === 'string'`. Parsing them server-side makes every one of those guards fail and the setting is silently discarded.
2. **`bulkSync` implements the concurrency stamp.** The frontend's whole conflict-recovery path (re-pull → adopt cloud → retry) is dead code unless the server issues and checks stamps.
3. **An unknown `?sheet=` key returns an error, never a fallback.** The old backend silently returned every document for an unknown key, which is recorded in `index.html` as having poisoned the projects cache on fresh devices.

**Deploy:** paste into the Apps Script editor → run `setupSheets()` → run `healthCheck()` to confirm it sees the right spreadsheet → Deploy → New deployment → Web app, *Execute as: Me*, *Who has access: Anyone* → confirm the `/exec` URL matches `WEB_APP_URL` in `index.html`. If it doesn't match, the app keeps working offline and silently never syncs.

`resetSyncStamps()` exists to break a genuine sync deadlock. It disables conflict protection until the next push, so use it only when actually stuck.

---

## 6. Open Decisions

### Brand-mandatory on Tax Invoices — **still awaiting decision**

- **Tax Invoice** = the strict, auditable document. Brand **always** named on blocks, removing the unbranded-block ambiguity and making stock tracking exact
- **Sales Invoice** = the flexible one

**Recorded pushback:** blocking transport/loading charges from Tax Invoices entirely is risky — those are legitimately invoiceable, and a customer may need freight on the tax invoice for their own records. Stock tracking does not require that restriction, since non-block lines are ignored for stock purposes. Recommendation: make brand mandatory, leave charges allowed.

**Still to resolve:**

1. Does brand-mandatory apply to mortar, or blocks only?
2. Roughly 30 existing invoices have unbranded blocks. Leave, flag, or bulk-correct?
3. Hard block or overridable warning?

### GST rate verification — **action for Raaja's CA**

The 12% rate on AAC blocks under HSN 6815 applies to blocks with **more than 50% fly ash content**. The app hardcodes 12% for every block. Get written confirmation of fly ash content from Meghalite and Birla — if any product doesn't qualify, there is an 18% liability being carried silently.

### Other pending items

- **Backend redeploy.** `Code_v6.gs` is rebuilt but has never run against the live spreadsheet. Back up the sheet, deploy, run `healthCheck()`.
- **Historical stock backfill.** Pre-v78 Tax Invoices were never auto-linked. The Link Invoice tab can backfill them — not yet discussed whether Raaja wants this done.
- **Landing costs are optional, and several v80 features need them.** Below-cost warnings, breakage costing, ageing values and the freight comparison are all silent for items with no costed batch — deliberately, since a false "below ₹0" alarm is worse than none. The more batches get cost details, the more these earn their keep.

---

## 7. Business Advisory (non-app)

### Cost-saving opportunities

1. **Verify the fly ash / GST position** — potentially the largest single exposure
2. **Input tax credit discipline** — every purchase bill, freight voucher and expense captured
3. **Freight recovery** — now measurable (item 18); the "invoices with no transport line" count is the place to start
4. **Cost the breakage** — now in rupees (item 19), which is what a supplier damage claim needs
5. **Enforce credit periods** before dispatch — now enforced at save time (item 20)

### Lead generation

1. **Mine your own database** — every quotation that never became an invoice is a warm lead with a name, phone number and known requirement. Nobody follows these up systematically. Highest-value, zero-cost option, and still not built.
2. **Masons and site contractors** specify materials before the owner sees a quote
3. **Google Business listing** — someone searching "AAC blocks Udumalpet" is ready to buy today
4. **Architects and structural engineers** across the Pollachi / Palani corridor write the specifications
5. **Small hardware shops as sub-dealers** — sub-dealer pricing already exists in the app

---

## 8. Key Files

| File | Purpose |
|---|---|
| `index.html` | Frontend — v80, the whole application |
| `sw.js` | Service worker, `CACHE_NAME = 'ken-traders-v80'` |
| `Code_v6.gs` | Backend Apps Script — rebuilt, **not yet deployed** |
| `manifest.json` | PWA manifest |
| `tests/` | `harness.js`, `extract.js`, `gas_mock.js`, `t.js`, and the three suites |

---

## 9. Quick Start for a New Session

```bash
# The repo is the source of truth. Nothing else survives.
cd ken-projects-masteros
npm install jsdom --silent

# Verify the file is healthy before touching anything
python3 -c "
import re, collections
html=open('index.html',encoding='utf-8').read()
s=re.findall(r'<script>(.*?)</script>',html,re.S)
open('_c.js','w',encoding='utf-8').write(max(s,key=len))
print('js braces', html.count('{'), html.count('}'))
ids=re.findall(r'id=\"([^\"]+)\"',html)
print('dup ids:', {k:v for k,v in collections.Counter(ids).items() if v>1})
"
node --check _c.js && echo SYNTAX_OK

# Run the suites
node tests/test_v80_logic.js
node tests/test_v80_ui.js
node tests/test_backend.js
```

**Then, before any edit:** grep and read the actual function. Never modify on assumption.

**And before adding any new module-level state:** use `var`, or read it lazily from localStorage inside a function. A top-level `let` or `const` that a render path can reach during boot is the exact shape of the crash v79 shipped.
