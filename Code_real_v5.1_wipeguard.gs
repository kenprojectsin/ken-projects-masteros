/***********************************************************************
 * KEN PROJECTS DATABASE — MASTER OS BACKEND (Google Apps Script)
 * VERSION 5.1 — Clean fresh setup, new dedicated spreadsheet
 *              + wipe guard on genericBulkSync (see WIPE_GUARD_MIN_RECORDS)
 * ----------------------------------------------------------------------
 * This is your real, currently-deployed VERSION 5 script with exactly one
 * change: genericBulkSync() now refuses to blank an already-populated
 * sheet when the incoming array is empty, unless the caller explicitly
 * passes allowEmpty:true. Nothing else was touched — same spreadsheet
 * structure, same Dashboard, same sync-conflict logic, same everything.
 * ----------------------------------------------------------------------
 * This script creates and manages a brand-new Google Spreadsheet named
 * "KEN PROJECTS DATABASE" — entirely separate from any previous sheet.
 * No data migration; clean slate.
 *
 * HOW THIS DIFFERS FROM ALL PREVIOUS VERSIONS:
 *   - setupSpreadsheet() CREATES a new spreadsheet by name rather than
 *     assuming you're running it from inside one. It stores the resulting
 *     spreadsheet ID in PropertiesService so every subsequent call
 *     (doGet, doPost, refreshDashboard) always hits the right sheet,
 *     regardless of which spreadsheet the Apps Script project is opened
 *     from. This prevents the "ran setup from the wrong sheet" class of
 *     mistakes entirely.
 *   - Dashboard is substantially richer — projects P&L, FY comparisons,
 *     live cash position, low-stock flags.
 *   - getAllCashEntries() now reads the projectId column added in v17.
 *
 * TABS (in order, left to right):
 *   📊 Dashboard      Auto-refreshing business summary
 *   📄 SalesDocs      Tax Invoices, Sales Invoices, Quotations, Credit Notes
 *   💰 Advances       Advance Receipts
 *   🧾 Vouchers       Expense + RCM Payment Vouchers
 *   🔍 LineItems      Every cart item, one-per-row (GSTR-1 / audit)
 *   💵 CashBook       Daily cash in/out ledger (with Project tagging)
 *   🏗️ Sites          Site Manager records + timeline JSON
 *   🏷️ Projects       Sub-projects under Sites (expense P&L tracking)
 *   ⚙️ Config         Pricing engine settings
 *   👥 Clients        Client registry
 *   📦 StockItems     Catalogue of tracked stock products
 *   📦 StockBatches   Purchase batches (FIFO cost tracking)
 *   📦 StockMovements Stock in/out movement log
 *   📦 StockLocations Warehouse / godown location list
 *   🔧 ToolItems      Tool catalogue
 *   🔧 ToolMovements  Tool transfer log
 *   📎 AuditDocs      Purchase bill + RCM PDF metadata (files live in Drive)
 *
 * SETUP (one-time):
 *   1. Create a new Apps Script project (script.google.com → New project).
 *      Name it something like "KEN Master OS Backend".
 *   2. Delete any starter code in Code.gs, paste THIS ENTIRE FILE.
 *   3. Save (disk icon or Ctrl+S).
 *   4. Run `setupSpreadsheet` from the function dropdown + Run button.
 *      First run asks for permissions — Advanced → Go to project (unsafe)
 *      → Allow. This is a standard OAuth consent for scripts you author.
 *   5. A dialog will show the new spreadsheet's URL — OPEN IT AND BOOKMARK IT.
 *   6. Deploy → New deployment → Web app
 *        Execute as: Me   |   Who has access: Anyone
 *      Copy the Web App URL.
 *   7. Paste that URL into WEB_APP_URL in v17.html.
 *
 * setupSpreadsheet() is safe to re-run — it never deletes data rows,
 * only repairs headers/formatting on existing tabs.
 ***********************************************************************/

// ======================================================================
// CONFIGURATION
// ======================================================================
const SPREADSHEET_NAME = 'KEN PROJECTS DATABASE';
const SPREADSHEET_ID_KEY = 'KEN_SPREADSHEET_ID'; // PropertiesService key

const SHEET_NAMES = {
  SALES:           'SalesDocs',
  ADV:             'Advances',
  VOUCH:           'Vouchers',
  ITEMS:           'LineItems',
  CASH:            'CashBook',
  SITES:           'Sites',
  PROJECTS:        'Projects',
  CONFIG:          'Config',
  DASH:            'Dashboard',
  CLIENTS:         'Clients',
  STOCK_ITEMS:     'StockItems',
  STOCK_BATCHES:   'StockBatches',
  STOCK_MOVEMENTS: 'StockMovements',
  STOCK_LOCATIONS: 'StockLocations',
  TOOL_ITEMS:      'ToolItems',
  TOOL_MOVEMENTS:  'ToolMovements',
  AUDIT_DOCS:      'AuditDocs',
  LETTERS:         'Letters',
  RECEIPTS:        'Receipts',
  TRIPS:           'Trips',
  TRASH:           'Trash'
};

const AUDIT_DRIVE_ROOT_FOLDER    = 'KEN Projects - Audit Documents';
const SITE_PHOTOS_DRIVE_ROOT_FOLDER = 'KEN Projects - Site Photos';

const SALES_TYPES   = ['INV', 'SAL', 'QUO', 'CRN'];
const ADV_TYPES      = ['ADV'];
const RCP_TYPES      = ['RCP'];
const VOUCHER_TYPES  = ['EXP', 'RCM'];

const MASTER_PASSWORD = '88844';

// ======================================================================
// SPREADSHEET RESOLUTION
// ----------------------------------------------------------------------
// All sheet access goes through getSpreadsheet() → getSheetByName().
// On first run (setupSpreadsheet), the new SS id is stored in
// PropertiesService so every subsequent call — doGet, doPost,
// refreshDashboard, everything — uses the exact same spreadsheet,
// regardless of which file the Apps Script project is attached to.
// ======================================================================

function getSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(SPREADSHEET_ID_KEY);
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch(e) { /* fall through */ }
  }
  // Fallback: during setupSpreadsheet's own initial run, before the id has
  // been stored, we look for a sheet with the right name in Drive.
  const files = DriveApp.getFilesByName(SPREADSHEET_NAME);
  if (files.hasNext()) {
    const ss = SpreadsheetApp.openById(files.next().getId());
    props.setProperty(SPREADSHEET_ID_KEY, ss.getId());
    return ss;
  }
  throw new Error('KEN PROJECTS DATABASE spreadsheet not found. Run setupSpreadsheet() first.');
}

function getOrCreateSheet(name) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}


// ----------------------------------------------------------------------
// COLUMN SCHEMAS
// Each entry: [Header label, field key in the JSON payload, column width]
// ----------------------------------------------------------------------

// SalesDocs: INV, SAL, QUO, CRN — these four share nearly the same shape
// (client, GSTIN, dispatch, payment, advance-linking for the balance owed).
const SALES_COLUMNS = [
  ['Doc No',           'docNo',          140],
  ['Type',             'type',           70],
  ['Date',             'date',           95],
  ['Client',           'clientName',     180],
  ['Title',            'clientTitle',    60],
  ['Client ID',        'clientId',       80],
  ['Phone',            'phone',          110],
  ['Total (₹)',        'total',          100],
  ['Voided',           'voided',         70],
  ['Location',         'location',       120],
  ['GSTIN',            'gstin',          140],
  ['Vehicle',          'vehicle',        100],
  ['E-Way Bill',       'ewayBill',       130],
  ['Custom E-Way',     'customEway',     110],
  ['Freight Terms',    'freight',        160],
  ['Custom Freight',   'customFreight',  120],
  ['Delivery Site',    'deliverySite',   150],
  ['Pay Mode',         'payMode',        100],
  ['Pay Details',      'payDetails',     140],
  ['Inclusive Tax',    'inclusiveTax',   90],
  ['Supersedes Ref',   'supersedesRef',  140],
  ['CRN Against Inv',  'crnOrigRef',     140],
  ['Adv Links (JSON)', 'advLinksJSON',   200],
  ['Item Count',       'itemCount',      80],
  ['Saved At',         'savedAt',        160],
  ['Row ID',           'id',             140]
];

// Advances: ADV only — completely different shape from sales docs, no
// line items, no GSTIN/dispatch fields, just amount + purpose + payment.
const ADV_COLUMNS = [
  ['Doc No',         'docNo',          140],
  ['Date',           'date',           95],
  ['Client',         'clientName',     180],
  ['Title',          'clientTitle',    60],
  ['Client ID',       'clientId',       80],
  ['Phone',          'phone',          110],
  ['Total (₹)',       'total',          100],
  ['Voided',          'voided',         70],
  ['Location',        'location',       120],
  ['Description',     'advDirectDesc',  220],
  ['Linked Quote',    'advQuoRef',      130],
  ['Quote Total (₹)', 'advQuoTotal',    110],
  ['Pay Mode',        'advPayMode',     110],
  ['Pay Ref',         'advPayRef',      120],
  ['Saved At',        'savedAt',        160],
  ['Row ID',          'id',             140]
];

// RCP (Payment Receipt) — its own dedicated sheet, structurally
// identical to ADV's core fields but WITHOUT the quotation-linking
// columns (advQuoRef/advQuoTotal), replaced with a simple free-text
// invoice reference note. Kept separate from Advances specifically to
// avoid the class of bug where readDocsFromSheet() hardcodes a sheet's
// rows to a single doc type — sharing the Advances sheet would have
// meant every RCP came back from the cloud mislabeled as ADV.
const RECEIPTS_COLUMNS = [
  ['Doc No',          'docNo',          140],
  ['Date',            'date',           95],
  ['Client',          'clientName',     180],
  ['Title',           'clientTitle',    60],
  ['Client ID',        'clientId',       80],
  ['Phone',           'phone',          110],
  ['Total (₹)',        'total',          100],
  ['Voided',           'voided',         70],
  ['Location',         'location',       120],
  ['Description',      'advDirectDesc',  220],
  ['Against Invoice',  'rcpInvoiceRef',  140],
  ['Pay Mode',         'advPayMode',     110],
  ['Pay Ref',          'advPayRef',      120],
  ['Saved At',         'savedAt',        160],
  ['Row ID',           'id',             140]
];

// Vouchers: EXP, RCM — internal payment records, no client/GSTIN fields,
// uses Paid-To/PAN/vehicle instead.
const VOUCHER_COLUMNS = [
  ['Doc No',         'docNo',         140],
  ['Type',           'type',          70],
  ['Date',           'date',          95],
  ['Paid To',        'vPaidTo',       180],
  ['Amount (₹)',      'total',         100],
  ['Voided',          'voided',        70],
  ['Towards',         'vDesc',         220],
  ['Vehicle',         'vVeh',          100],
  ['Receiver PAN',    'vPan',          110],
  ['Payment Mode',    'vMode',         160],
  ['Txn Ref',         'vRef',          120],
  ['RCM GST Rate %',  'rcmGstRate',    100],
  ['Supersedes Ref',  'supersedesRef', 140],
  ['Saved At',        'savedAt',       160],
  ['Row ID',          'id',            140]
];

// LineItems tab — every cart item, one row each, linked back by Doc No.
// docType is included so the same Doc No space can never accidentally
// collide across SalesDocs/Advances/Vouchers (Advances and Vouchers don't
// use this tab at all — only SalesDocs items end up here).
const ITEM_COLUMNS = [
  ['Doc No',         'docNo',     140],
  ['Doc Type',       'docType',   70],
  ['Doc Date',       'docDate',   95],
  ['Client',         'client',    160],
  ['Item',           'p',         220],
  ['Qty',            'q',         70],
  ['Unit',           'unit',      70],
  ['Rate (₹)',        'r',         90],
  ['GST %',           'g',         70],
  ['HSN',             'hsn',       80],
  ['Line Total (₹)',  'lineTotal', 110],
  ['Notes',           'notes',     200],
  ['Row ID',          'rowId',     140]
];

// CashBook tab columns
// issue 10: TRIPS — EV mini truck trip log (date, route, distance,
// earnings, expenses, net profit).
const TRIPS_COLUMNS = [
  ['Date',        'date',      95],
  ['Route',       'route',     220],
  ['Distance (km)', 'distance', 100],
  ['Earnings (₹)', 'earnings',  100],
  ['Expenses (₹)', 'expenses',  100],
  ['Net (₹)',      'net',       100],
  ['Material',     'material',  180],
  ['Project ID',   'projectId', 100],
  ['Logged At',    'ts',        160],
  ['Row ID',       'id',        140]
];

// Trash — 30-day soft-delete safety net. A trashed item can be any
// document type (INV/QUO/ADV/SAL/etc.), each with different fields
// including nested arrays like cart, so the full item is kept as one
// JSON blob rather than mapping every possible field to its own column.
const TRASH_COLUMNS = [
  ['Doc No',       'docNo',      160],
  ['Type',         'type',       80],
  ['Trashed At',   'trashedAt',  160],
  ['Reason',       'trashReason', 100],
  ['Data (JSON)',  'dataJSON',   300],
  ['Row ID',       'id',         140]
];

const CASH_COLUMNS = [
  ['Date',         'date',       95],
  ['Direction',    'direction',  80],
  ['Amount (₹)',    'amount',    100],
  ['Category',      'category',  140],
  ['Party / Desc',  'party',     220],
  ['Linked Doc',    'linkedDoc', 140],
  ['Logged At',      'ts',        160],
  ['Row ID',         'id',        140],
  // i6: links this entry to a Project (see PROJECTS_COLUMNS) for expense
  // splitting within a Site. Appended at the END of the column list
  // deliberately — existing conditional formatting rules hardcode column
  // letters (e.g. $B2 for Direction), so inserting a column earlier in
  // this list would have silently shifted those letters and broken the
  // IN/OUT row coloring. All such ranges also use CASH_COLUMNS.length,
  // which automatically extends to include this new column.
  ['Project ID',     'projectId', 100]
];

// Sites tab columns
const SITE_COLUMNS = [
  ['Alias',           'alias',          90],
  ['Full Name',       'name',           180],
  ['Client',          'client',         160],
  ['Location',        'location',       160],
  ['Contract (₹)',    'contractValue',  110],
  ['Start Date',      'startDate',      95],
  ['Status',          'status',         80],
  ['Quote Ref',       'quoRef',         140],
  ['Notes',           'notes',          250],
  ['Timeline (JSON)', 'timelineJSON',   200],
  ['Row ID',          'id',             140],
  // Appended AFTER Row ID deliberately — saveSite()/getAllSites() use
  // FIXED positional indices (row[10] = id) rather than column-name
  // lookup, so inserting anywhere before 'id' would silently break
  // matching for every site already saved in the sheet.
  ['Contact Person',  'contact',        140],
  ['Contact Phone',   'phone',          110]
];

// Config tab columns (key-value pairs)
const CONFIG_COLUMNS = [
  ['Setting Key', 'key',       200],
  ['Value',       'value',     250],
  ['Updated At',  'updatedAt', 160]
];

// ----------------------------------------------------------------------
// CLOUD MIGRATION — Clients, Stock, Tools, Audit Docs
// These mirror the exact object shapes the frontend already keeps in
// localStorage (kenClients, kenStockItems, kenStockBatches, etc.) so the
// sync layer can pass objects through with minimal field translation.
// ----------------------------------------------------------------------

const CLIENTS_COLUMNS = [
  ['Client ID',   'id',        80],
  ['Name',        'name',      180],
  ['Phone',       'phone',     110],
  ['GSTIN',       'gstin',     140],
  ['Location',    'location',  140],
  ['Title',       'title',     80],
  ['Created At',  'createdAt', 160],
  ['Updated At',  'updatedAt', 160]
];

const STOCK_ITEMS_COLUMNS = [
  ['Item ID',             'id',                 80],
  ['Name',                'name',               220],
  ['Low Stock Threshold', 'lowStockThreshold',  80],
  ['Created At',          'createdAt',          160]
];

const STOCK_BATCHES_COLUMNS = [
  ['Batch ID',          'id',               140],
  ['Item Name',         'itemName',         220],
  ['Location',          'location',         140],
  ['Qty Original',      'qtyOriginal',      90],
  ['Qty Remaining',     'qtyRemaining',     90],
  ['Base Cost',         'baseCost',         90],
  ['Transport Cost',    'transportCost',    90],
  ['Unloading Cost',    'unloadingCost',    90],
  ['Landing Cost',      'landingCost',      90],
  ['Purchase Date',     'purchaseDate',     95],
  ['Created At',        'createdAt',        160],
  ['Source Transfer ID','sourceTransferId', 140]
];

const STOCK_MOVEMENTS_COLUMNS = [
  ['Movement ID', 'id',       140],
  ['Type',        'type',     120],
  ['Item Name',   'itemName', 220],
  ['Location',    'location', 140],
  ['Qty',         'qty',      80],
  ['Batch ID',    'batchId',  140],
  ['Landing Cost','landingCost', 90],
  ['Sell Price',  'sellPrice', 90],
  ['Profit',      'profit',   90],
  ['Doc No',      'docNo',    140],
  ['Note',        'note',     250],
  ['Timestamp',   'ts',       160]
];

const STOCK_LOCATIONS_COLUMNS = [
  ['Location Name', 'name', 200]
];

const TOOL_ITEMS_COLUMNS = [
  ['Tool ID',          'id',              80],
  ['Name',             'name',            200],
  ['Current Location', 'currentLocation', 140],
  ['Last Moved At',    'lastMovedAt',     160]
];

const TOOL_MOVEMENTS_COLUMNS = [
  ['Movement ID', 'id',           140],
  ['Tool ID',     'toolId',       80],
  ['Tool Name',   'toolName',     200],
  ['From',        'fromLocation', 140],
  ['To',          'toLocation',   140],
  ['Moved By',    'movedBy',      120],
  ['Note',        'note',         200],
  ['Timestamp',   'ts',           160]
];

// AuditDocs — metadata only. Each row is one uploaded PDF (a purchase bill
// or an RCM voucher), filed into a month bucket. The actual PDF lives in
// Drive; this just stores the resulting file URL + which batch/voucher (if
// any) it's attached to, so "Add or edit it anytime" can find and replace it.
const AUDIT_DOCS_COLUMNS = [
  ['Audit Doc ID',  'id',          140],
  ['Month',         'month',       80],   // 'YYYY-MM' — the bundling key
  ['Kind',          'kind',        100],  // 'PURCHASE_BILL' or 'RCM_VOUCHER'
  ['Linked Batch ID','linkedBatchId', 140], // for PURCHASE_BILL, the Stock batch it was attached to (optional)
  ['Linked Doc No',  'linkedDocNo',   140], // for RCM_VOUCHER, the RCM doc it was attached to (optional)
  ['File Name',      'fileName',      200],
  ['Drive File URL', 'driveUrl',      280],
  ['Drive File ID',  'driveFileId',   140], // needed to overwrite/delete on edit
  ['Uploaded At',     'uploadedAt',   160]
];

// i6: Projects — a sub-unit under a Site (e.g. "Parapet Wall" vs "Compound
// Wall" on the same Site), used for expense tracking + rough P&L. Since
// invoices/stock dispatch deliberately stay at the SITE level (not split
// per-project — confirmed scope), allocatedRevenue is a manually-typed
// estimate the person enters themselves; P&L = allocatedRevenue minus the
// sum of cash entries tagged with this project's id.
const PROJECTS_COLUMNS = [
  ['Project ID',        'id',                140],
  ['Site ID',            'siteId',            100],
  ['Project Name',       'name',              200],
  ['Status',             'status',            80],   // 'Active' / 'Completed' / 'On Hold'
  ['Start Date',         'startDate',         95],
  ['Allocated Revenue',  'allocatedRevenue',  100],  // manually entered — see note above
  ['Notes',              'notes',             200],
  ['Created At',         'createdAt',         160],
  // Stored as JSON strings — see SYNC_COLLECTION_MAP.projectsFlat on the
  // frontend, which stringifies before push and parses after pull, same
  // pattern Sites already uses for its own timeline field.
  ['Timeline',           'timeline',          220],
  ['Linked Doc IDs',     'linkedDocIds',      160]
];

// LETTERPAD: saved letters (KT/LET26-27/0001 style). Content is free-form
// rich-text HTML, not a structured cart — a dedicated tab fits this shape
// much better than shoehorning it into SalesDocs alongside invoice items.
const LETTERS_COLUMNS = [
  ['Letter No',    'docNo',        140],
  ['Date',         'date',         95],
  ['Addressed To', 'addressee',    200],
  ['Body HTML',    'bodyHtml',     400],
  // 'TYPED' = written in the app's rich text editor.
  // 'SCAN' = an uploaded photo/PDF of a handwritten or externally-produced
  // letter — bodyHtml stays blank for these, the file lives in Drive.
  ['Kind',         'kind',         80],
  ['File Name',    'fileName',     200],
  ['Drive File URL','driveUrl',    280],
  ['Drive File ID', 'driveFileId', 140],
  ['MIME Type',    'mimeType',     100],
  ['Created At',   'createdAt',    160],
  ['Row ID',       'id',           140]
];

// Color theme per document type — used for row banding across tabs
const TYPE_COLORS = {
  INV: '#d6eaf8',   // light blue
  SAL: '#d1f2eb',   // light teal
  QUO: '#e8daef',   // light purple
  ADV: '#fdebd0',   // light orange
  CRN: '#fadbd8',   // light red
  EXP: '#f2f3f4',   // light grey
  RCM: '#fcf3cf'    // light yellow
};

// ======================================================================
// WEB APP ENTRY POINTS
// ======================================================================

function doGet(e) {
  const sheetParam = (e && e.parameter && e.parameter.sheet) || 'documents';

  // SYNC FIX: wraps a collection's GET response with the backend's current
  // stamp for that collection. Frontend records this stamp after every pull,
  // so a fresh/reloaded device always has the correct stamp before its first
  // push — eliminating all false conflict detections from null stamps.
  function withStamp(sheetName, data) {
    const raw = PropertiesService.getScriptProperties().getProperty(getSyncStampKey(sheetName));
    let stamp = null;
    try { stamp = raw ? JSON.parse(raw).ts : null; } catch(e) {}
    return { data: data, stamp: stamp };
  }

  let payload;
  if (sheetParam === 'cash') payload = withStamp(SHEET_NAMES.CASH, getAllCashEntries());
  else if (sheetParam === 'sites') payload = withStamp(SHEET_NAMES.SITES, getAllSites());
  else if (sheetParam === 'config') payload = getAllConfig(); // config uses its own format, no stamp needed
  else if (sheetParam === 'clients') payload = withStamp(SHEET_NAMES.CLIENTS, genericGetAll(SHEET_NAMES.CLIENTS, CLIENTS_COLUMNS));
  else if (sheetParam === 'stockItems') payload = withStamp(SHEET_NAMES.STOCK_ITEMS, genericGetAll(SHEET_NAMES.STOCK_ITEMS, STOCK_ITEMS_COLUMNS));
  else if (sheetParam === 'stockBatches') payload = withStamp(SHEET_NAMES.STOCK_BATCHES, genericGetAll(SHEET_NAMES.STOCK_BATCHES, STOCK_BATCHES_COLUMNS));
  else if (sheetParam === 'stockMovements') payload = withStamp(SHEET_NAMES.STOCK_MOVEMENTS, genericGetAll(SHEET_NAMES.STOCK_MOVEMENTS, STOCK_MOVEMENTS_COLUMNS));
  else if (sheetParam === 'stockLocations') payload = withStamp(SHEET_NAMES.STOCK_LOCATIONS, genericGetAll(SHEET_NAMES.STOCK_LOCATIONS, STOCK_LOCATIONS_COLUMNS));
  else if (sheetParam === 'toolItems') payload = withStamp(SHEET_NAMES.TOOL_ITEMS, genericGetAll(SHEET_NAMES.TOOL_ITEMS, TOOL_ITEMS_COLUMNS));
  else if (sheetParam === 'toolMovements') payload = withStamp(SHEET_NAMES.TOOL_MOVEMENTS, genericGetAll(SHEET_NAMES.TOOL_MOVEMENTS, TOOL_MOVEMENTS_COLUMNS));
  else if (sheetParam === 'auditDocs') payload = withStamp(SHEET_NAMES.AUDIT_DOCS, genericGetAll(SHEET_NAMES.AUDIT_DOCS, AUDIT_DOCS_COLUMNS));
  else if (sheetParam === 'projects') payload = withStamp(SHEET_NAMES.PROJECTS, genericGetAll(SHEET_NAMES.PROJECTS, PROJECTS_COLUMNS));
  else if (sheetParam === 'trips') payload = withStamp(SHEET_NAMES.TRIPS, genericGetAll(SHEET_NAMES.TRIPS, TRIPS_COLUMNS));
  else if (sheetParam === 'trash') payload = withStamp(SHEET_NAMES.TRASH, genericGetAll(SHEET_NAMES.TRASH, TRASH_COLUMNS));
  else if (sheetParam === 'letters') payload = withStamp(SHEET_NAMES.LETTERS, genericGetAll(SHEET_NAMES.LETTERS, LETTERS_COLUMNS));
  else if (sheetParam === 'receipts') payload = withStamp(SHEET_NAMES.RECEIPTS, genericGetAll(SHEET_NAMES.RECEIPTS, RECEIPTS_COLUMNS));
  // G4: LineItems was being written by saveLineItemsForDoc() but never
  // actually read back by anything — needed now for an accurate GSTR-1
  // HSN-wise summary, since a single invoice can mix 12% (blocks) and 18%
  // (mortar/services) items, which document-level totals can't separate.
  // NOTE: deliberately NOT using genericGetAll here — ITEM_COLUMNS uses
  // 'rowId' as its identifier, not 'id', and genericGetAll's id-detection
  // would silently return -1 for the column index, which in JS means
  // row[-1] (always undefined) passes the "not blank" filter unconditionally
  // — every blank trailing sheet row would come through as a phantom entry.
  else if (sheetParam === 'lineItems') payload = getAllLineItems();
  else payload = getAllDocumentsCached(); // merges SalesDocs + Advances + Vouchers into one flat array

  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ======================================================================
// DOCUMENTS READ CACHE — the "View List" open is the single most
// frequently-hit read path (fires every time the doc list modal opens),
// and getAllDocuments() is inherently the slowest read (merges 3 separate
// sheets every call). CacheService gives a genuine speedup for repeated
// opens within a short window — e.g. open View List, close it, reopen a
// few seconds later shouldn't re-read all 3 sheets from scratch. Cache is
// invalidated immediately on every save/delete (see invalidateDocsCache
// calls in saveDocument/deleteDocument/bulkSetClientIds), so this never
// risks showing stale data — only skips redundant identical reads.
// ======================================================================
const DOCS_CACHE_KEY = 'allDocumentsPayload';
const DOCS_CACHE_TTL_SECONDS = 30; // short window — long enough to help repeated opens, short enough to never feel stale

function getAllDocumentsCached() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(DOCS_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through and re-read */ }
  }
  const fresh = getAllDocuments();
  try {
    cache.put(DOCS_CACHE_KEY, JSON.stringify(fresh), DOCS_CACHE_TTL_SECONDS);
  } catch (e) {
    // CacheService has a ~100KB per-key limit — a very large document set
    // could exceed it. If so, just skip caching rather than fail the read.
  }
  return fresh;
}

function invalidateDocsCache() {
  try { CacheService.getScriptCache().remove(DOCS_CACHE_KEY); } catch (e) {}
}

// Maps a bulk-sync collection name to its sheet + column schema — used by
// both the 'bulkSync' action and individual save/delete actions below, so
// there's one place that knows the wiring for each of the 7 simple
// collections rather than repeating it in every branch.
const BULK_SYNC_COLLECTIONS = {
  clients:        [SHEET_NAMES.CLIENTS, CLIENTS_COLUMNS],
  stockItems:     [SHEET_NAMES.STOCK_ITEMS, STOCK_ITEMS_COLUMNS],
  stockBatches:   [SHEET_NAMES.STOCK_BATCHES, STOCK_BATCHES_COLUMNS],
  stockMovements: [SHEET_NAMES.STOCK_MOVEMENTS, STOCK_MOVEMENTS_COLUMNS],
  stockLocations: [SHEET_NAMES.STOCK_LOCATIONS, STOCK_LOCATIONS_COLUMNS],
  toolItems:      [SHEET_NAMES.TOOL_ITEMS, TOOL_ITEMS_COLUMNS],
  toolMovements:  [SHEET_NAMES.TOOL_MOVEMENTS, TOOL_MOVEMENTS_COLUMNS],
  // CashBook's local object shape is a clean 1:1 match against CASH_COLUMNS,
  // so generic bulk-sync works directly. The frontend never actually called
  // the existing saveCash cloud action despite it being ready — wired into
  // bulk-sync now instead.
  cashBook:       [SHEET_NAMES.CASH, CASH_COLUMNS],
  // i6: Projects is a flat collection (no nested/stringified fields like
  // Sites' timeline), so it fits generic bulk-sync directly.
  projects:       [SHEET_NAMES.PROJECTS, PROJECTS_COLUMNS],
  // issue 10: Trips — same flat-collection shape as Cash Book, no
  // nested/stringified fields, fits generic bulk-sync directly.
  trips:          [SHEET_NAMES.TRIPS, TRIPS_COLUMNS],
  trash:          [SHEET_NAMES.TRASH, TRASH_COLUMNS]
  // NOTE: Sites is intentionally NOT here. Its local object stores
  // `timeline` as a live array, but SITE_COLUMNS expects a pre-stringified
  // `timelineJSON` field — generic bulk-sync does a direct key lookup per
  // column and would silently write blank timeline data on every sync.
  // Sites instead calls the existing per-entry saveSite/deleteSite actions
  // (see below), which already handle that JSON conversion correctly.
};

function doPost(e) {
  let result;
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'save') result = saveDocument(body.data);
    else if (action === 'delete') result = deleteDocument(body.id);
    else if (action === 'bulkDeleteDocuments') result = bulkDeleteDocuments(body.ids);
    else if (action === 'bulkSetClientIds') result = bulkSetClientIds(body.updates);
    else if (action === 'saveLetter') result = saveLetter(body.data);
    else if (action === 'uploadLetterScan') result = uploadLetterScan(body.data);
    else if (action === 'deleteLetter') result = deleteLetter(body.id);
    else if (action === 'saveCash') result = saveCashEntry(body.data);
    else if (action === 'deleteCash') result = deleteCashEntry(body.id);
    else if (action === 'saveSite') result = saveSite(body.data);
    else if (action === 'deleteSite') result = deleteSite(body.id);
    else if (action === 'saveConfig') result = saveConfig(body.data);
    // Background sync for Clients/Stock/Tools — the frontend pushes its
    // FULL current local array periodically (e.g. after each change, or on
    // an interval) rather than one network call per item. body.collection
    // names which of the 7 simple collections this is; body.data is the
    // full array. Local writes stay instant; this just reconciles the cloud
    // copy in the background per the agreed local-first approach.
    else if (action === 'bulkSync') {
      const target = BULK_SYNC_COLLECTIONS[body.collection];
      if (!target) result = { success: false, error: 'Unknown collection: ' + body.collection };
      else result = genericBulkSync(target[0], target[1], body.data, body.deviceId, body.lastKnownStamp, body.allowEmpty);
    }
    else if (action === 'saveAuditDoc') result = genericSave(SHEET_NAMES.AUDIT_DOCS, AUDIT_DOCS_COLUMNS, body.data);
    else if (action === 'deleteAuditDoc') result = deleteAuditDocument(body.id);
    else if (action === 'uploadAuditPdf') result = uploadAuditPdf(body.data);
    else if (action === 'uploadSitePhoto') result = uploadSitePhoto(body.data);
    else if (action === 'deleteSitePhoto') result = deleteSitePhoto(body.driveFileId);
    else result = { success: false, error: 'Unknown action: ' + action };
  } catch (err) {
    result = { success: false, error: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ======================================================================
// DOCUMENT ROUTING — which tab does a given type belong to?
// ======================================================================

function getTabForType(type) {
  if (SALES_TYPES.includes(type)) return { sheetName: SHEET_NAMES.SALES, columns: SALES_COLUMNS };
  if (ADV_TYPES.includes(type)) return { sheetName: SHEET_NAMES.ADV, columns: ADV_COLUMNS };
  if (RCP_TYPES.includes(type)) return { sheetName: SHEET_NAMES.RECEIPTS, columns: RECEIPTS_COLUMNS };
  if (VOUCHER_TYPES.includes(type)) return { sheetName: SHEET_NAMES.VOUCH, columns: VOUCHER_COLUMNS };
  return null;
}

// ======================================================================
// BULK SET CLIENT IDS — one atomic operation, ONE lock acquisition,
// instead of the frontend firing one fetch per affected document (which
// was the actual root cause of "reset doesn't stick" and "sync is slow").
// Each saveDocument() call takes LockService.getScriptLock() individually
// — firing dozens of those concurrently meant most queued up behind the
// lock, some timing out or failing silently under contention, since the
// frontend never checked individual results. This sets clientId (to
// either '' for clearing, or a specific new id for reconciling) for
// every given {id: newClientId} pair, across all 3 document sheets, in
// a single pass.
// updates: array of [docId, newClientId] pairs
// ======================================================================
function bulkSetClientIds(updates) {
  if (!updates || updates.length === 0) return { success: true, updated: 0 };
  const updateMap = new Map(updates.map(([id, newId]) => [String(id), newId]));
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return { success: false, error: 'Server busy — please try again in a moment.' };
  }

  try {
    let updatedCount = 0;
    [
      [SHEET_NAMES.SALES, SALES_COLUMNS],
      [SHEET_NAMES.ADV, ADV_COLUMNS],
      [SHEET_NAMES.RECEIPTS, RECEIPTS_COLUMNS],
      [SHEET_NAMES.VOUCH, VOUCHER_COLUMNS]
    ].forEach(([sheetName, columns]) => {
      const idCol = columns.findIndex(c => c[1] === 'id');
      const clientIdCol = columns.findIndex(c => c[1] === 'clientId');
      if (idCol === -1 || clientIdCol === -1) return; // this sheet type doesn't have a clientId column (e.g. Vouchers)

      const sheet = getOrCreateSheet(sheetName);
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const rowId = String(data[i][idCol]);
        if (updateMap.has(rowId)) {
          sheet.getRange(i + 1, clientIdCol + 1).setValue(updateMap.get(rowId));
          updatedCount++;
        }
      }
    });
    invalidateDocsCache();
    return { success: true, updated: updatedCount };
  } finally {
    lock.releaseLock();
  }
}

// ======================================================================
// DOCUMENTS — READ (merges all 3 tabs into one flat array for the app)
// ======================================================================

function getAllDocuments() {
  let all = [];
  all = all.concat(readDocsFromSheet(SHEET_NAMES.SALES, SALES_COLUMNS, true));
  all = all.concat(readDocsFromSheet(SHEET_NAMES.ADV, ADV_COLUMNS, false));
  all = all.concat(readDocsFromSheet(SHEET_NAMES.RECEIPTS, RECEIPTS_COLUMNS, false));
  all = all.concat(readDocsFromSheet(SHEET_NAMES.VOUCH, VOUCHER_COLUMNS, false));
  return all;
}

function readDocsFromSheet(sheetName, columns, attachCart) {
  const sheet = getOrCreateSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const colKeys = columns.map(c => c[1]);
  const rows = data.slice(1).filter(row => row[0] !== '');

  // PERF FIX (v6): this used to call getCartForDoc(docNo) inside the
  // per-row map below — and getCartForDoc did a FULL
  // getDataRange().getValues() on the entire LineItems sheet every single
  // time. With N sales documents that meant N complete reads of the same
  // sheet (300 docs = 300 full reads = ~360,000 redundant cell reads),
  // which is where essentially all of the 10-second "View List" / post-save
  // sync delay came from. Apps Script charges heavy per-call overhead for
  // getValues(), so the call COUNT matters far more than the cell count.
  //
  // Now: read LineItems exactly once, index every row by its docNo, then
  // each document just does an O(1) hash lookup. Same data, same output
  // shape, ~1 read instead of N.
  const cartIndex = attachCart ? buildCartIndex() : null;

  return rows.map(row => {
    const doc = {};
    colKeys.forEach((key, i) => {
      let val = row[i];
      if (key === 'id') doc.id = val;
      else if (key === 'voided') doc.voided = (val === true || val === 'TRUE' || val === 'Yes');
      else if (key === 'inclusiveTax') doc.inclusiveTax = (val === true || val === 'TRUE' || val === 'Yes');
      else if (key === 'date') doc.date = formatDateForFrontend(val);
      else if (key === 'advLinksJSON') {
        try { doc.advLinks = val ? JSON.parse(val) : []; } catch(err) { doc.advLinks = []; }
      }
      else if (key === 'itemCount' || key === 'savedAt') { /* internal only, skip */ }
      else doc[key] = (val === undefined || val === null) ? '' : val;
    });
    // Vouchers/Advances/Receipts don't have a 'type' column in the sheet
    // itself (each sheet only ever holds one type, so it's inferred from
    // which sheet the row came from) — Vouchers is the exception, which
    // DOES have its own type column since it holds both EXP and RCM.
    if (sheetName === SHEET_NAMES.ADV) doc.type = 'ADV';
    if (sheetName === SHEET_NAMES.RECEIPTS) doc.type = 'RCP';
    if (attachCart) doc.cart = (cartIndex && cartIndex[doc.docNo]) || [];
    else doc.cart = [];
    return doc;
  });
}

// PERF FIX (v6): reads the LineItems sheet ONCE and returns a lookup object
// { docNo: [cartItem, ...] }. Row shape and field mapping are copied
// verbatim from the old getCartForDoc() so the cart objects handed to the
// frontend are byte-identical to before — this is purely a change in HOW
// MANY TIMES the sheet is read, never in what comes back.
function buildCartIndex() {
  const sheet = getOrCreateSheet(SHEET_NAMES.ITEMS);
  const data = sheet.getDataRange().getValues();
  const index = {};
  if (data.length < 2) return index;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const docNo = row[0];
    if (docNo === '' || docNo === undefined || docNo === null) continue;
    if (!index[docNo]) index[docNo] = [];
    index[docNo].push({
      p: row[4], q: row[5], unit: row[6], r: row[7], g: row[8], hsn: row[9],
      notes: row[11] || ''
    });
  }
  return index;
}

// Kept for backward compatibility / ad-hoc use. No longer called from the
// bulk read path — readDocsFromSheet() uses buildCartIndex() instead.
// Safe to call for a single document (e.g. from the Apps Script editor).
function getCartForDoc(docNo) {
  const index = buildCartIndex();
  return index[docNo] || [];
}

// ======================================================================
// DOCUMENTS — WRITE
// ======================================================================

function saveDocument(data) {
  if (!data || !data.docNo) return { success: false, error: 'Missing docNo' };
  const tab = getTabForType(data.type);
  if (!tab) return { success: false, error: 'Unknown document type: ' + data.type };

  // Improvement #9: DOCUMENT NUMBERING SAFETY NET
  // The frontend already checks for docNo collisions against its own
  // locally-cached document list, but that cache can be stale — if two
  // devices (or two browser tabs) each compute "the next number" before
  // either one's save has synced back, both could independently arrive at
  // the same docNo and both pass their own local check. For a GST invoice
  // number, an actual duplicate is a compliance problem, not just a UX one.
  // LockService.getScriptLock() makes the "is this docNo already taken by
  // a DIFFERENT id?" check and the row write atomic across all simultaneous
  // calls to this script, closing that race condition server-side.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // up to 10s — generous since this only blocks other concurrent saves, not normal usage
  } catch (e) {
    return { success: false, error: 'Server busy — please try saving again in a moment.' };
  }

  try {
    const sheet = getOrCreateSheet(tab.sheetName);
    const allData = sheet.getDataRange().getValues();
    const idCol = tab.columns.findIndex(c => c[1] === 'id');
    const docNoCol = tab.columns.findIndex(c => c[1] === 'docNo');

    let rowIndex = -1;
    for (let i = 1; i < allData.length; i++) {
      if (String(allData[i][idCol]) === String(data.id)) { rowIndex = i + 1; break; }
    }

    // This is the actual safety net: if some OTHER row (different id) already
    // has this exact docNo, reject the save instead of creating a duplicate.
    // A matching id (rowIndex already found above) is a legitimate update to
    // the SAME document, not a collision, so that case is allowed through.
    if (rowIndex === -1) {
      for (let i = 1; i < allData.length; i++) {
        if (String(allData[i][idCol]) !== String(data.id) && allData[i][docNoCol] === data.docNo) {
          return { success: false, error: 'duplicate_docno', docNo: data.docNo };
        }
      }
    }

    const cart = data.cart || [];
    const rowValues = tab.columns.map(([label, key]) => {
      if (key === 'advLinksJSON') return JSON.stringify(data.advLinks || []);
      if (key === 'itemCount') return cart.length;
      if (key === 'savedAt') return new Date();
      if (key === 'voided') return data.voided ? 'TRUE' : 'FALSE';
      if (key === 'inclusiveTax') return data.inclusiveTax ? 'TRUE' : 'FALSE';
      if (key === 'total') return Number(data.total) || 0;
      let val = data[key];
      return (val === undefined || val === null) ? '' : val;
    });

    if (rowIndex === -1) {
      sheet.appendRow(rowValues);
      rowIndex = sheet.getLastRow();
    } else {
      sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
    }

    // SalesDocs is the only tab with line items — Advances and Vouchers never
    // have a cart, so skip the LineItems write/clear for those entirely.
    if (tab.sheetName === SHEET_NAMES.SALES) {
      saveLineItemsForDoc(data.docNo, data.type, data.date, data.clientName, cart);
    }

    maybeRefreshDashboard(); // PERF v6: throttled — was a full re-read on every write
    invalidateDocsCache();
    return { success: true, id: data.id };
  } finally {
    lock.releaseLock();
  }
}

function deleteDocument(id) {
  // Frontend gates this client-side via a password prompt before calling —
  // no password re-check needed here (avoids double-prompting / silent
  // rejection if the request shape ever changes).
  // We don't know which of the 4 tabs the id is in, so check all four.
  for (const [sheetName, columns] of [
    [SHEET_NAMES.SALES, SALES_COLUMNS],
    [SHEET_NAMES.ADV, ADV_COLUMNS],
    [SHEET_NAMES.RECEIPTS, RECEIPTS_COLUMNS],
    [SHEET_NAMES.VOUCH, VOUCHER_COLUMNS]
  ]) {
    const sheet = getOrCreateSheet(sheetName);
    const allData = sheet.getDataRange().getValues();
    const idCol = columns.findIndex(c => c[1] === 'id');
    const docNoCol = columns.findIndex(c => c[1] === 'docNo');

    for (let i = 1; i < allData.length; i++) {
      if (String(allData[i][idCol]) === String(id)) {
        const docNo = allData[i][docNoCol];
        sheet.deleteRow(i + 1);
        if (sheetName === SHEET_NAMES.SALES) deleteLineItemsForDoc(docNo);
        maybeRefreshDashboard(); // PERF v6: throttled — was a full re-read on every write
        invalidateDocsCache();
        return { success: true };
      }
    }
  }
  return { success: false, error: 'Document not found' };
}

// ======================================================================
// BULK DELETE DOCUMENTS — one atomic operation, ONE lock acquisition,
// instead of the frontend firing one fetch per document with a
// console-only .catch() (invisible failures — a doc could silently fail
// to delete from the cloud, then resurrect on the next sync, even though
// it was already removed from the local view). Deletes rows by id across
// all 3 document sheets in a single pass, working from the bottom up so
// row-index shifts from earlier deletions in the same sheet don't skip
// or misalign later ones.
// ======================================================================
function bulkDeleteDocuments(ids) {
  if (!ids || ids.length === 0) return { success: true, deleted: 0 };
  const idSet = new Set(ids.map(String));
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return { success: false, error: 'Server busy — please try again in a moment.' };
  }

  try {
    let deletedCount = 0;
    [
      [SHEET_NAMES.SALES, SALES_COLUMNS],
      [SHEET_NAMES.ADV, ADV_COLUMNS],
      [SHEET_NAMES.RECEIPTS, RECEIPTS_COLUMNS],
      [SHEET_NAMES.VOUCH, VOUCHER_COLUMNS]
    ].forEach(([sheetName, columns]) => {
      const sheet = getOrCreateSheet(sheetName);
      const data = sheet.getDataRange().getValues();
      const idCol = columns.findIndex(c => c[1] === 'id');
      const docNoCol = columns.findIndex(c => c[1] === 'docNo');

      // Iterate bottom-up: deleteRow shifts every subsequent row's index
      // up by one — going top-down would skip a row right after each
      // delete. Bottom-up means already-processed rows never move.
      for (let i = data.length - 1; i >= 1; i--) {
        if (idSet.has(String(data[i][idCol]))) {
          const docNo = data[i][docNoCol];
          sheet.deleteRow(i + 1);
          if (sheetName === SHEET_NAMES.SALES) deleteLineItemsForDoc(docNo);
          deletedCount++;
        }
      }
    });
    maybeRefreshDashboard(); // PERF v6: throttled — was a full re-read on every write
    invalidateDocsCache();
    return { success: true, deleted: deletedCount };
  } finally {
    lock.releaseLock();
  }
}

// ======================================================================
// LINEITEMS TAB
// ======================================================================

function saveLineItemsForDoc(docNo, docType, docDate, client, cart) {
  deleteLineItemsForDoc(docNo); // clear old rows for this doc, then re-insert fresh
  if (!cart || cart.length === 0) return;

  const sheet = getOrCreateSheet(SHEET_NAMES.ITEMS);
  const rows = cart.map(item => {
    const lineTotal = (Number(item.q) || 0) * (Number(item.r) || 0);
    return [
      docNo, docType, docDate, client,
      item.p || '', item.q || 0, item.unit || 'Nos', item.r || 0, item.g || 0,
      item.hsn || '', lineTotal, item.notes || '',
      docNo + '_' + (item.p || '').replace(/[^a-zA-Z0-9]/g, '').slice(0,20) + '_' + Date.now()
    ];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, ITEM_COLUMNS.length).setValues(rows);

  const startRow = sheet.getLastRow() - rows.length + 1;
  const color = TYPE_COLORS[docType] || '#ffffff';
  sheet.getRange(startRow, 1, rows.length, ITEM_COLUMNS.length).setBackground(color);
}

// PERF FIX (v6): previously fired one deleteRow() API call per matching
// row. A doc with 12 line items meant 12 separate round-trips to the
// Sheets service, each carrying full call overhead. Line items for a
// single document are written together (see saveLineItemsForDoc) so they
// sit in contiguous blocks — this collapses each contiguous run into ONE
// deleteRows(start, count) call. Still iterates bottom-up so earlier
// deletions never shift the indexes of rows not yet processed.
function deleteLineItemsForDoc(docNo) {
  const sheet = getOrCreateSheet(SHEET_NAMES.ITEMS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;

  // Collect matching sheet row numbers (1-based), descending.
  const hits = [];
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === docNo) hits.push(i + 1);
  }
  if (hits.length === 0) return;

  // Collapse descending row numbers into contiguous runs and delete each
  // run in a single call. hits is descending, so a run continues while
  // the next row number is exactly one less than the previous.
  let runEnd = hits[0];    // highest row number in the current run
  let runStart = hits[0];  // lowest row number in the current run
  for (let k = 1; k <= hits.length; k++) {
    if (k < hits.length && hits[k] === runStart - 1) {
      runStart = hits[k];
      continue;
    }
    sheet.deleteRows(runStart, runEnd - runStart + 1);
    if (k < hits.length) { runEnd = hits[k]; runStart = hits[k]; }
  }
}

// G4: reads every line item across all documents — used by the frontend's
// GSTR-1 HSN-wise summary export. Filters blank/trailing sheet rows by
// docNo (column 0), which deleteLineItemsForDoc() above already relies on
// as always-populated for any real line item row.
function getAllLineItems() {
  const sheet = getOrCreateSheet(SHEET_NAMES.ITEMS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  return data.slice(1)
    .filter(row => row[0] !== '') // docNo column — blank means a trailing empty sheet row
    .map(row => {
      const obj = {};
      ITEM_COLUMNS.forEach(([label, key], i) => { obj[key] = row[i]; });
      return obj;
    });
}

// ======================================================================
// CASH BOOK TAB
// ======================================================================

function getAllCashEntries() {
  const sheet = getOrCreateSheet(SHEET_NAMES.CASH);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  return data.slice(1)
    .filter(row => row[0] !== '')
    .map(row => ({
      date:      formatDateForFrontend(row[0]),
      direction: row[1],
      amount:    Number(row[2]) || 0,
      category:  row[3],
      party:     row[4],
      linkedDoc: row[5],
      ts:        row[6],
      id:        row[7],
      projectId: row[8] !== '' && row[8] != null ? row[8] : null
    }));
}

function saveCashEntry(data) {
  if (!data || !data.id) return { success: false, error: 'Missing id' };
  const sheet = getOrCreateSheet(SHEET_NAMES.CASH);
  const allData = sheet.getDataRange().getValues();

  let rowIndex = -1;
  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][7]) === String(data.id)) { rowIndex = i + 1; break; }
  }

  const rowValues = [
    data.date, data.direction, Number(data.amount) || 0, data.category,
    data.party, data.linkedDoc || '', data.ts || new Date().toISOString(), data.id
  ];

  if (rowIndex === -1) {
    sheet.appendRow(rowValues);
    rowIndex = sheet.getLastRow();
  } else {
    sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  }

  const color = data.direction === 'IN' ? '#d5f5e3' : '#fadbd8';
  sheet.getRange(rowIndex, 1, 1, CASH_COLUMNS.length).setBackground(color);

  maybeRefreshDashboard(); // PERF v6: throttled — was a full re-read on every write
  return { success: true, id: data.id };
}

function deleteCashEntry(id) {
  const sheet = getOrCreateSheet(SHEET_NAMES.CASH);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][7]) === String(id)) {
      sheet.deleteRow(i + 1);
      maybeRefreshDashboard(); // PERF v6: throttled — was a full re-read on every write
      return { success: true };
    }
  }
  return { success: false, error: 'Entry not found' };
}

// ======================================================================
// SITES TAB
// ======================================================================

function getAllSites() {
  const sheet = getOrCreateSheet(SHEET_NAMES.SITES);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  return data.slice(1)
    .filter(row => row[0] !== '')
    .map(row => {
      let timeline = [];
      try { timeline = row[9] ? JSON.parse(row[9]) : []; } catch(e) {}
      return {
        alias: row[0], name: row[1], client: row[2], location: row[3],
        contractValue: Number(row[4]) || 0, startDate: formatDateForFrontend(row[5]),
        status: row[6], quoRef: row[7], notes: row[8], timeline: timeline,
        id: row[10], contact: row[11] || '', phone: row[12] || '', linkedDocs: [], expenses: []
      };
    });
}

function saveSite(data) {
  if (!data || !data.id) return { success: false, error: 'Missing id' };
  const sheet = getOrCreateSheet(SHEET_NAMES.SITES);
  const allData = sheet.getDataRange().getValues();

  let rowIndex = -1;
  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][10]) === String(data.id)) { rowIndex = i + 1; break; }
  }

  const rowValues = [
    data.alias, data.name, data.client, data.location || '',
    Number(data.contractValue) || 0, data.startDate || '', data.status || 'Active',
    data.quoRef || '', data.notes || '', JSON.stringify(data.timeline || []), data.id,
    data.contact || '', data.phone || ''
  ];

  if (rowIndex === -1) {
    sheet.appendRow(rowValues);
    rowIndex = sheet.getLastRow();
  } else {
    sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  }

  const statusColors = { Active: '#d5f5e3', Hold: '#fdebd0', Done: '#eaecee' };
  sheet.getRange(rowIndex, 1, 1, SITE_COLUMNS.length).setBackground(statusColors[data.status] || '#ffffff');

  return { success: true, id: data.id };
}

function deleteSite(id) {
  const sheet = getOrCreateSheet(SHEET_NAMES.SITES);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][10]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Site not found' };
}

// ======================================================================
// LETTERPAD — saved letters (KT/LET26-27/0001 style)
// ======================================================================
function saveLetter(data) {
  if (!data || !data.id) return { success: false, error: 'Missing id' };
  const sheet = getOrCreateSheet(SHEET_NAMES.LETTERS);
  const allData = sheet.getDataRange().getValues();
  const idCol = LETTERS_COLUMNS.findIndex(c => c[1] === 'id');

  let rowIndex = -1;
  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][idCol]) === String(data.id)) { rowIndex = i + 1; break; }
  }

  // BUG FIX: previously hardcoded column positions in a fixed array —
  // broke the moment new columns (kind/fileName/driveUrl/etc, added for
  // the scan-upload feature) were inserted into LETTERS_COLUMNS. Now maps
  // by column key instead, so schema changes never silently misalign data.
  const rowValues = LETTERS_COLUMNS.map(([label, key]) => {
    if (key === 'createdAt') return data.createdAt || new Date().toISOString();
    if (key === 'kind') return data.kind || 'TYPED';
    return data[key] !== undefined ? data[key] : '';
  });

  if (rowIndex === -1) {
    sheet.appendRow(rowValues);
  } else {
    sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  }
  return { success: true, id: data.id };
}

function deleteLetter(id) {
  const sheet = getOrCreateSheet(SHEET_NAMES.LETTERS);
  const data = sheet.getDataRange().getValues();
  const idCol = LETTERS_COLUMNS.findIndex(c => c[1] === 'id');
  const driveIdCol = LETTERS_COLUMNS.findIndex(c => c[1] === 'driveFileId');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      // Scanned letters have a Drive file attached — clean it up so
      // deleting the row doesn't leave an orphaned file in Drive.
      const driveFileId = data[i][driveIdCol];
      if (driveFileId) {
        try { DriveApp.getFileById(driveFileId).setTrashed(true); } catch (e) { /* already gone, ignore */ }
      }
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Letter not found' };
}

// Uploads a scanned/photographed letter (image or PDF) to Drive, in a
// dedicated "KEN Projects - Letters" folder, then saves the resulting
// metadata as a letter record — same LET numbering pool as typed letters.
function uploadLetterScan(data) {
  if (!data || !data.base64File || !data.docNo) {
    return { success: false, error: 'Missing file data or letter number' };
  }
  try {
    const folder = getOrCreateLettersFolder();
    const bytes = Utilities.base64Decode(data.base64File);
    const mimeType = data.mimeType || 'application/octet-stream';
    const blob = Utilities.newBlob(bytes, mimeType, data.fileName || 'letter-scan');
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const letterRecord = {
      id: data.id,
      docNo: data.docNo,
      date: data.date || '',
      addressee: data.addressee || '',
      bodyHtml: '', // scans have no editable text content
      kind: 'SCAN',
      fileName: data.fileName || file.getName(),
      driveUrl: file.getUrl(),
      driveFileId: file.getId(),
      mimeType: mimeType,
      createdAt: new Date().toISOString()
    };
    genericSave(SHEET_NAMES.LETTERS, LETTERS_COLUMNS, letterRecord);

    return { success: true, id: letterRecord.id, driveUrl: letterRecord.driveUrl, driveFileId: letterRecord.driveFileId };
  } catch (err) {
    return { success: false, error: 'Drive upload failed: ' + err.message };
  }
}

function getOrCreateLettersFolder() {
  const folders = DriveApp.getFoldersByName('KEN Projects - Letters');
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder('KEN Projects - Letters');
}

// ======================================================================
// AUDIT DOCUMENTS — purchase bill / RCM voucher PDF storage
// ----------------------------------------------------------------------
// The PDF itself is uploaded to Google Drive (not stored as base64 in a
// Sheet cell — binary data doesn't belong in spreadsheet cells and scales
// poorly past a handful of files). Only metadata + the resulting Drive
// file link lives in the AuditDocs sheet. Files are organized into one
// subfolder per month under a root "KEN Traders - Audit Documents" folder,
// auto-created on first use, so handing everything to the auditor each
// month is "open the month's folder" rather than hunting through chat
// history or email attachments.
// ======================================================================

function getOrCreateAuditRootFolder() {
  const folders = DriveApp.getFoldersByName(AUDIT_DRIVE_ROOT_FOLDER);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(AUDIT_DRIVE_ROOT_FOLDER);
}

// monthKey is 'YYYY-MM' — converted to a human folder name like "June 2026"
function getOrCreateMonthFolder(monthKey) {
  const root = getOrCreateAuditRootFolder();
  const [year, month] = monthKey.split('-');
  const monthName = Utilities.formatDate(new Date(Number(year), Number(month) - 1, 1), Session.getScriptTimeZone(), 'MMMM yyyy');
  const existing = root.getFoldersByName(monthName);
  if (existing.hasNext()) return existing.next();
  return root.createFolder(monthName);
}

// data: { id, month, kind, linkedBatchId, linkedDocNo, fileName, base64Pdf,
//         existingDriveFileId (optional — present when EDITING/replacing an
//         already-uploaded PDF, so the old Drive file gets removed instead
//         of leaving an orphaned duplicate behind) }
function uploadAuditPdf(data) {
  if (!data || !data.base64Pdf || !data.month) {
    return { success: false, error: 'Missing PDF data or month' };
  }

  try {
    const folder = getOrCreateMonthFolder(data.month);

    // Editing an existing upload — remove the old file first so re-uploading
    // a corrected bill doesn't leave the original sitting in Drive forever.
    if (data.existingDriveFileId) {
      try { DriveApp.getFileById(data.existingDriveFileId).setTrashed(true); } catch (e) { /* already gone, ignore */ }
    }

    const bytes = Utilities.base64Decode(data.base64Pdf);
    const blob = Utilities.newBlob(bytes, 'application/pdf', data.fileName || 'document.pdf');
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const docRecord = {
      id: data.id,
      month: data.month,
      kind: data.kind || 'PURCHASE_BILL',
      linkedBatchId: data.linkedBatchId || '',
      linkedDocNo: data.linkedDocNo || '',
      fileName: data.fileName || file.getName(),
      driveUrl: file.getUrl(),
      driveFileId: file.getId(),
      uploadedAt: new Date().toISOString()
    };
    genericSave(SHEET_NAMES.AUDIT_DOCS, AUDIT_DOCS_COLUMNS, docRecord);

    return { success: true, id: docRecord.id, driveUrl: docRecord.driveUrl, driveFileId: docRecord.driveFileId };
  } catch (err) {
    return { success: false, error: 'Drive upload failed: ' + err.message };
  }
}

function deleteAuditDocument(id) {
  const sheet = getOrCreateSheet(SHEET_NAMES.AUDIT_DOCS);
  const data = sheet.getDataRange().getValues();
  const idCol = AUDIT_DOCS_COLUMNS.findIndex(c => c[1] === 'id');
  const driveIdCol = AUDIT_DOCS_COLUMNS.findIndex(c => c[1] === 'driveFileId');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      const driveFileId = data[i][driveIdCol];
      if (driveFileId) {
        try { DriveApp.getFileById(driveFileId).setTrashed(true); } catch (e) { /* already gone, ignore */ }
      }
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Audit document not found' };
}

// ======================================================================
// i9: SITE TIMELINE PHOTOS
// ----------------------------------------------------------------------
// Uploaded to Drive, one folder per SITE (not per month — browsing "all
// photos at Site X" is the natural use case here, e.g. checking progress
// or proving a delivery happened). No separate metadata sheet: the
// resulting URL + Drive file ID are stored directly inside the relevant
// site's timeline entry (in the Sites sheet's timelineJSON column), since
// a photo always belongs to exactly one timeline entry and doesn't need
// independent querying the way audit documents do.
// The frontend compresses photos client-side before sending (resized,
// JPEG ~75% quality) — this function just stores whatever bytes it's
// given, it doesn't re-compress server-side.
// ======================================================================

function getOrCreateSitePhotosRootFolder() {
  const folders = DriveApp.getFoldersByName(SITE_PHOTOS_DRIVE_ROOT_FOLDER);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(SITE_PHOTOS_DRIVE_ROOT_FOLDER);
}

function getOrCreateSiteFolder(siteName) {
  const root = getOrCreateSitePhotosRootFolder();
  const existing = root.getFoldersByName(siteName);
  if (existing.hasNext()) return existing.next();
  return root.createFolder(siteName);
}

// data: { siteName, fileName, base64Image }
function uploadSitePhoto(data) {
  if (!data || !data.base64Image || !data.siteName) {
    return { success: false, error: 'Missing photo data or site name' };
  }
  try {
    const folder = getOrCreateSiteFolder(data.siteName);
    const bytes = Utilities.base64Decode(data.base64Image);
    const blob = Utilities.newBlob(bytes, 'image/jpeg', data.fileName || 'photo.jpg');
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    // BUG FIX (caught via research before shipping): file.getUrl() returns a
    // Drive "view page" URL (drive.google.com/file/d/.../view) — this does
    // NOT work directly in an <img src> tag, it would render as a broken
    // image icon. The uc?export=view&id=... format is what's actually
    // embeddable. Returning both: thumbUrl for <img> tags, driveUrl (the
    // normal view page) for the "open full size" click-through link.
    const fileId = file.getId();
    return {
      success: true,
      driveUrl: file.getUrl(),
      thumbUrl: `https://drive.google.com/uc?export=view&id=${fileId}`,
      driveFileId: fileId
    };
  } catch (err) {
    return { success: false, error: 'Drive upload failed: ' + err.message };
  }
}

// Called when a timeline entry (and its attached photo) is deleted — keeps
// Drive from accumulating orphaned files for notes that no longer exist.
function deleteSitePhoto(driveFileId) {
  if (!driveFileId) return { success: true }; // nothing to delete
  try {
    DriveApp.getFileById(driveFileId).setTrashed(true);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message }; // already gone or inaccessible — not fatal
  }
}

// ======================================================================
// CONFIG TAB (pricing engine settings)
// ======================================================================

function getAllConfig() {
  const sheet = getOrCreateSheet(SHEET_NAMES.CONFIG);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};
  const config = {};
  data.slice(1).forEach(row => {
    if (row[0]) {
      try { config[row[0]] = JSON.parse(row[1]); } catch(e) { config[row[0]] = row[1]; }
    }
  });
  return config;
}

function saveConfig(data) {
  if (!data || !data.key) return { success: false, error: 'Missing key' };
  const sheet = getOrCreateSheet(SHEET_NAMES.CONFIG);
  const allData = sheet.getDataRange().getValues();

  let rowIndex = -1;
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][0] === data.key) { rowIndex = i + 1; break; }
  }

  const valueStr = typeof data.value === 'object' ? JSON.stringify(data.value) : String(data.value);
  const rowValues = [data.key, valueStr, new Date()];

  if (rowIndex === -1) sheet.appendRow(rowValues);
  else sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return { success: true };
}

// ======================================================================
// SETUP / FORMATTING ENGINE
// ======================================================================

// ======================================================================
// SETUP — creates "KEN PROJECTS DATABASE" as a new named spreadsheet,
// stores its ID, formats every tab, and shows the URL so you can
// bookmark it immediately.
// ======================================================================

function setupSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  let ss;
  let isNew = false;

  // Check if we already have an ID stored (re-run scenario)
  const existingId = props.getProperty(SPREADSHEET_ID_KEY);
  if (existingId) {
    try {
      ss = SpreadsheetApp.openById(existingId);
      Logger.log('Re-running setup on existing spreadsheet: ' + ss.getUrl());
    } catch(e) { existingId && Logger.log('Stored ID invalid, creating fresh sheet.'); }
  }

  if (!ss) {
    // Check if a sheet with this name already exists in Drive
    const files = DriveApp.getFilesByName(SPREADSHEET_NAME);
    if (files.hasNext()) {
      ss = SpreadsheetApp.openById(files.next().getId());
      Logger.log('Found existing sheet by name: ' + ss.getUrl());
    } else {
      ss = SpreadsheetApp.create(SPREADSHEET_NAME);
      isNew = true;
      Logger.log('Created new spreadsheet: ' + ss.getUrl());
    }
    props.setProperty(SPREADSHEET_ID_KEY, ss.getId());
  }

  // ── Build / repair every tab ───────────────────────────────────────
  setupTabWithSchema(SHEET_NAMES.SALES, SALES_COLUMNS, '#1a5276', 'type');
  setupTabWithSchema(SHEET_NAMES.ADV, ADV_COLUMNS, '#784212', null);
  setupTabWithSchema(SHEET_NAMES.VOUCH, VOUCHER_COLUMNS, '#4a235a', 'type');
  setupLineItemsTab();
  setupCashBookTab();
  setupSitesTab();
  setupProjectsTab();
  setupConfigTab();

  applyHeaderFormatting(getOrCreateSheet(SHEET_NAMES.CLIENTS),        CLIENTS_COLUMNS,        '#512e5f');
  applyHeaderFormatting(getOrCreateSheet(SHEET_NAMES.STOCK_ITEMS),    STOCK_ITEMS_COLUMNS,    '#0b5345');
  applyHeaderFormatting(getOrCreateSheet(SHEET_NAMES.STOCK_BATCHES),  STOCK_BATCHES_COLUMNS,  '#0b5345');
  applyHeaderFormatting(getOrCreateSheet(SHEET_NAMES.STOCK_MOVEMENTS),STOCK_MOVEMENTS_COLUMNS,'#0b5345');
  applyHeaderFormatting(getOrCreateSheet(SHEET_NAMES.STOCK_LOCATIONS),STOCK_LOCATIONS_COLUMNS,'#0b5345');
  applyHeaderFormatting(getOrCreateSheet(SHEET_NAMES.TOOL_ITEMS),     TOOL_ITEMS_COLUMNS,     '#0e6655');
  applyHeaderFormatting(getOrCreateSheet(SHEET_NAMES.TOOL_MOVEMENTS), TOOL_MOVEMENTS_COLUMNS, '#0e6655');
  applyHeaderFormatting(getOrCreateSheet(SHEET_NAMES.AUDIT_DOCS),     AUDIT_DOCS_COLUMNS,     '#78281f');
  applyHeaderFormatting(getOrCreateSheet(SHEET_NAMES.LETTERS),        LETTERS_COLUMNS,        '#5b2c6f');
  applyHeaderFormatting(getOrCreateSheet(SHEET_NAMES.RECEIPTS),       RECEIPTS_COLUMNS,       '#1a5276');
  applyHeaderFormatting(getOrCreateSheet(SHEET_NAMES.TRIPS),          TRIPS_COLUMNS,          '#117a65');
  applyHeaderFormatting(getOrCreateSheet(SHEET_NAMES.TRASH),          TRASH_COLUMNS,          '#7b7d7d');

  setupDashboardTab();

  // ── Tab ordering ───────────────────────────────────────────────────
  const order = [
    SHEET_NAMES.DASH,
    SHEET_NAMES.SALES, SHEET_NAMES.ADV, SHEET_NAMES.RECEIPTS, SHEET_NAMES.VOUCH, SHEET_NAMES.ITEMS, SHEET_NAMES.LETTERS,
    SHEET_NAMES.CASH, SHEET_NAMES.TRIPS,
    SHEET_NAMES.SITES, SHEET_NAMES.PROJECTS,
    SHEET_NAMES.CONFIG,
    SHEET_NAMES.CLIENTS,
    SHEET_NAMES.STOCK_ITEMS, SHEET_NAMES.STOCK_BATCHES,
    SHEET_NAMES.STOCK_MOVEMENTS, SHEET_NAMES.STOCK_LOCATIONS,
    SHEET_NAMES.TOOL_ITEMS, SHEET_NAMES.TOOL_MOVEMENTS,
    SHEET_NAMES.AUDIT_DOCS, SHEET_NAMES.TRASH
  ];
  order.forEach((name, i) => {
    const sheet = ss.getSheetByName(name);
    if (sheet) { ss.setActiveSheet(sheet); ss.moveActiveSheet(i + 1); }
  });

  // Remove the default blank Sheet1 if it's sitting around unused
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    const isEmpty = defaultSheet.getDataRange().getValues().flat().every(c => c === '');
    if (isEmpty) ss.deleteSheet(defaultSheet);
  }

  // ── Rename Apps Script project to match (cosmetic, optional) ───────
  try { ScriptApp.getProjectId(); } catch(e) {}  // no-op ping to confirm auth

  const url = ss.getUrl();
  const msg = isNew
    ? `✅ New spreadsheet created!\n\nName: ${SPREADSHEET_NAME}\nURL: ${url}\n\nBookmark this URL now, then deploy this script as a Web App.`
    : `✅ Setup complete. Existing spreadsheet repaired/updated.\n\nURL: ${url}`;

  // Logger.log always works regardless of context — check the Logs panel
  // (View → Logs, or Ctrl+Enter) after this function runs to see the URL.
  Logger.log('=== KEN PROJECTS DATABASE SETUP COMPLETE ===');
  Logger.log(msg);
  Logger.log('Spreadsheet URL: ' + url);
  Logger.log('Spreadsheet ID:  ' + ss.getId());
  Logger.log('=============================================');

  // Browser.msgBox works in the standalone script editor (unlike getUi())
  try {
    Browser.msgBox('KEN Projects Database — Setup Complete', url, Browser.Buttons.OK);
  } catch(e) {
    // If even that fails (e.g. headless execution), the URL is still in Logs
    Logger.log('(Could not show dialog — see URL above in Logs)');
  }
}


// ======================================================================
// GENERIC CRUD ENGINE — for simple flat-object-array collections that all
// follow the same shape: one row per object, matched by an 'id' field,
// no special per-tab logic (unlike Sites, which has status-color banding
// and a nested timeline). Used for Clients, the 5 Stock tabs, and the 2
// Tool tabs — saves duplicating near-identical save/get/delete logic
// seven times over.
// ======================================================================

function genericGetAll(sheetName, columns) {
  const sheet = getOrCreateSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const idCol = columns.findIndex(c => c[1] === 'id');
  return data.slice(1)
    .filter(row => row[idCol] !== '')
    .map(row => {
      const obj = {};
      columns.forEach(([label, key], i) => {
        let val = row[i];
        if (key.toLowerCase().includes('date') || key === 'ts' || key === 'createdAt' || key === 'updatedAt' || key === 'uploadedAt' || key === 'lastMovedAt') {
          obj[key] = formatDateForFrontend(val) || val; // keep timestamps as-is if not a Date
        } else {
          obj[key] = (val === undefined || val === null) ? '' : val;
        }
      });
      return obj;
    });
}

function genericSave(sheetName, columns, data) {
  if (!data || !data.id) return { success: false, error: 'Missing id' };
  const sheet = getOrCreateSheet(sheetName);
  const allData = sheet.getDataRange().getValues();
  const idCol = columns.findIndex(c => c[1] === 'id');

  let rowIndex = -1;
  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][idCol]) === String(data.id)) { rowIndex = i + 1; break; }
  }

  const rowValues = columns.map(([label, key]) => {
    let val = data[key];
    if (typeof val === 'number') return val;
    return (val === undefined || val === null) ? '' : val;
  });

  if (rowIndex === -1) {
    sheet.appendRow(rowValues);
  } else {
    sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  }
  return { success: true, id: data.id };
}

function genericDelete(sheetName, columns, id) {
  const sheet = getOrCreateSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  const idCol = columns.findIndex(c => c[1] === 'id');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Not found' };
}

// ----------------------------------------------------------------------
// Improvement #2: SYNC CONFLICT DETECTION
// ----------------------------------------------------------------------
// Risk: two devices (e.g. phone on-site + desktop in the shop) both running
// background sync on the same collection. Since genericBulkSync replaces
// the ENTIRE sheet contents with whatever array it receives, if device A
// and device B both sync around the same time, whichever call lands second
// silently wins and erases the first device's changes — with no warning.
//
// Fix: PropertiesService stores a per-collection "last write" stamp
// (timestamp + a random per-tab-load deviceId). Every sync call includes
// the deviceId + the lastKnownStamp this device saw on its last successful
// sync. If the cloud's current stamp is newer AND from a different device
// than what this device last knew about, that means someone else wrote in
// between — the write is rejected with conflict:true instead of proceeding,
// and the frontend surfaces this rather than silently losing data.
// ----------------------------------------------------------------------
function getSyncStampKey(sheetName) { return 'syncstamp_' + sheetName; }

function checkSyncConflict(sheetName, deviceId, lastKnownStamp) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(getSyncStampKey(sheetName));
  if (!raw) return { conflict: false }; // no prior write recorded — nothing to conflict with

  let stamp;
  try { stamp = JSON.parse(raw); } catch (e) { return { conflict: false }; }

  // No conflict if: this device wrote it last time itself, OR this device's
  // last-known stamp matches what's actually there (meaning no one else
  // wrote in between since this device last synced).
  if (stamp.deviceId === deviceId) return { conflict: false };
  if (lastKnownStamp && stamp.ts === lastKnownStamp) return { conflict: false };

  // A different device wrote, and this device's lastKnownStamp doesn't
  // match — genuine conflict.
  return { conflict: true, lastWrittenBy: stamp.deviceId, lastWrittenAt: stamp.ts };
}

function recordSyncStamp(sheetName, deviceId) {
  const props = PropertiesService.getScriptProperties();
  const stamp = { deviceId, ts: new Date().toISOString() };
  props.setProperty(getSyncStampKey(sheetName), JSON.stringify(stamp));
  return stamp.ts;
}

// Bulk sync — accepts the full current array from the frontend's local
// state and reconciles it against the sheet: updates/inserts everything
// present, removes any sheet row whose id no longer exists locally (i.e.
// it was deleted on the device since the last sync). Used for the
// background sync layer rather than calling genericSave/Delete once per
// item, which would be far more round-trips for things like the full
// Stock Locations list.
//
// deviceId/lastKnownStamp (optional, from the frontend) enable conflict
// detection above. If omitted, the write proceeds unconditionally (keeps
// this function backward-compatible / safe to call without conflict info).
// Below this many existing rows, an incoming empty bulk-sync push is
// assumed to be a genuine "I deleted everything" sync rather than a bug
// (e.g. a client just wiping their last couple of test rows) — so the
// guard below only kicks in once a collection actually holds real data.
const WIPE_GUARD_MIN_RECORDS = 3;

function genericBulkSync(sheetName, columns, fullArray, deviceId, lastKnownStamp, allowEmpty) {
  if (deviceId) {
    const check = checkSyncConflict(sheetName, deviceId, lastKnownStamp);
    if (check.conflict) {
      return { success: false, conflict: true, lastWrittenBy: check.lastWrittenBy, lastWrittenAt: check.lastWrittenAt };
    }
  }

  const sheet = getOrCreateSheet(sheetName);

  // Wipe guard: refuse to clear an already-populated sheet with an empty
  // (or missing) array unless the caller explicitly confirms that's
  // intended via allowEmpty. Without this, a frontend bug, a dropped
  // localStorage collection, or a bad payload can silently blank out real
  // clients/stock/cash/projects data on the next background sync — the
  // clearContents() below used to run unconditionally regardless of what
  // was already on the sheet.
  const incomingIsEmpty = !fullArray || fullArray.length === 0;
  if (incomingIsEmpty && !allowEmpty) {
    const existingRows = Math.max(0, sheet.getLastRow() - 1); // minus header row
    if (existingRows >= WIPE_GUARD_MIN_RECORDS) {
      return {
        success: false,
        error: 'Refused empty bulkSync over ' + existingRows + ' existing row(s) in "' + sheetName +
          '". Pass allowEmpty:true if this is intentional.',
        wipeGuard: true,
        existingRows: existingRows
      };
    }
  }

  sheet.clearContents();
  const headers = columns.map(c => c[0]);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  let newStamp = deviceId ? recordSyncStamp(sheetName, deviceId) : null;

  if (incomingIsEmpty) return { success: true, count: 0, stamp: newStamp };

  const rows = fullArray.map(data => columns.map(([label, key]) => {
    let val = data[key];
    if (typeof val === 'number') return val;
    return (val === undefined || val === null) ? '' : val;
  }));
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  return { success: true, count: rows.length, stamp: newStamp };
}

// Generic tab setup for SalesDocs / Advances / Vouchers — header formatting,
// optional Type-column color banding + dropdown (Advances has no Type column
// since that tab only ever holds ADV rows), number/date formats, filter.
function setupTabWithSchema(sheetName, columns, headerColor, typeColumnKey) {
  const sheet = getOrCreateSheet(sheetName);
  applyHeaderFormatting(sheet, columns, headerColor);

  if (typeColumnKey) {
    const typeColIndex = columns.findIndex(c => c[1] === typeColumnKey) + 1;
    setupTypeColorRules(sheet, typeColIndex, columns.length);
    const typesForThisTab = sheetName === SHEET_NAMES.SALES ? SALES_TYPES : VOUCHER_TYPES;
    setColumnDropdown(sheet, typeColIndex, typesForThisTab);
  } else {
    // Advances tab has no Type column — band every row in the ADV color instead
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=TRUE')
      .setBackground(TYPE_COLORS.ADV)
      .setRanges([sheet.getRange(2, 1, sheet.getMaxRows() - 1, columns.length)])
      .build();
    sheet.setConditionalFormatRules([rule]);
  }

  // Voided rows always show red regardless of type — applied as an additional
  // rule on top of (and evaluated before, since rules are prioritized in
  // array order with earlier rules winning) the type color rules above.
  const voidCol = columns.findIndex(c => c[1] === 'voided');
  if (voidCol !== -1) {
    const voidColLetter = columnIndexToLetter(voidCol + 1);
    const existing = sheet.getConditionalFormatRules();
    const voidRule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$${voidColLetter}2="TRUE"`)
      .setBackground('#f1948a')
      .setFontColor('#922b21')
      .setRanges([sheet.getRange(2, 1, sheet.getMaxRows() - 1, columns.length)])
      .build();
    sheet.setConditionalFormatRules([voidRule, ...existing]);
  }

  const totalCol = columns.findIndex(c => c[1] === 'total');
  if (totalCol !== -1) sheet.getRange(2, totalCol + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('₹#,##0.00');

  const dateCol = columns.findIndex(c => c[1] === 'date');
  if (dateCol !== -1) sheet.getRange(2, dateCol + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('dd/mm/yyyy');
}

function setupLineItemsTab() {
  const sheet = getOrCreateSheet(SHEET_NAMES.ITEMS);
  applyHeaderFormatting(sheet, ITEM_COLUMNS, '#34495e');

  const rateCol = ITEM_COLUMNS.findIndex(c => c[1] === 'r') + 1;
  const totalCol = ITEM_COLUMNS.findIndex(c => c[1] === 'lineTotal') + 1;
  sheet.getRange(2, rateCol, sheet.getMaxRows() - 1, 1).setNumberFormat('₹#,##0.00');
  sheet.getRange(2, totalCol, sheet.getMaxRows() - 1, 1).setNumberFormat('₹#,##0.00');
}

function setupCashBookTab() {
  const sheet = getOrCreateSheet(SHEET_NAMES.CASH);
  applyHeaderFormatting(sheet, CASH_COLUMNS, '#117a65');

  const dirCol = CASH_COLUMNS.findIndex(c => c[1] === 'direction') + 1;
  setColumnDropdown(sheet, dirCol, ['IN', 'OUT']);

  const catCol = CASH_COLUMNS.findIndex(c => c[1] === 'category') + 1;
  setColumnDropdown(sheet, catCol, [
    'Sale', 'Advance', 'Labour Income', 'Other Income', 'Rent',
    'JCB / Equipment', 'Mason / Labour', 'Material Purchase', 'Transport',
    'Drawing', 'Shed / Capital', 'Other Expense'
  ]);

  const amtCol = CASH_COLUMNS.findIndex(c => c[1] === 'amount') + 1;
  sheet.getRange(2, amtCol, sheet.getMaxRows() - 1, 1).setNumberFormat('₹#,##0.00');

  const dateCol = CASH_COLUMNS.findIndex(c => c[1] === 'date') + 1;
  sheet.getRange(2, dateCol, sheet.getMaxRows() - 1, 1).setNumberFormat('dd/mm/yyyy');

  const rule1 = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$B2="IN"')
    .setBackground('#d5f5e3')
    .setRanges([sheet.getRange(2, 1, sheet.getMaxRows() - 1, CASH_COLUMNS.length)])
    .build();
  const rule2 = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$B2="OUT"')
    .setBackground('#fadbd8')
    .setRanges([sheet.getRange(2, 1, sheet.getMaxRows() - 1, CASH_COLUMNS.length)])
    .build();
  sheet.setConditionalFormatRules([rule1, rule2]);
}

function setupSitesTab() {
  const sheet = getOrCreateSheet(SHEET_NAMES.SITES);
  applyHeaderFormatting(sheet, SITE_COLUMNS, '#1a3c5e');

  const statusCol = SITE_COLUMNS.findIndex(c => c[1] === 'status') + 1;
  setColumnDropdown(sheet, statusCol, ['Active', 'Hold', 'Done']);

  const contractCol = SITE_COLUMNS.findIndex(c => c[1] === 'contractValue') + 1;
  sheet.getRange(2, contractCol, sheet.getMaxRows() - 1, 1).setNumberFormat('₹#,##0.00');

  const dateCol = SITE_COLUMNS.findIndex(c => c[1] === 'startDate') + 1;
  sheet.getRange(2, dateCol, sheet.getMaxRows() - 1, 1).setNumberFormat('dd/mm/yyyy');

  const rules = [
    ['Active', '#d5f5e3'], ['Hold', '#fdebd0'], ['Done', '#eaecee']
  ].map(([status, color]) =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$G2="${status}"`)
      .setBackground(color)
      .setRanges([sheet.getRange(2, 1, sheet.getMaxRows() - 1, SITE_COLUMNS.length)])
      .build()
  );
  sheet.setConditionalFormatRules(rules);
}

function setupConfigTab() {
  const sheet = getOrCreateSheet(SHEET_NAMES.CONFIG);
  applyHeaderFormatting(sheet, CONFIG_COLUMNS, '#4d5656');
}

function setupProjectsTab() {
  const sheet = getOrCreateSheet(SHEET_NAMES.PROJECTS);
  applyHeaderFormatting(sheet, PROJECTS_COLUMNS, '#1b2631');
  const statusCol = PROJECTS_COLUMNS.findIndex(c => c[1] === 'status') + 1;
  setColumnDropdown(sheet, statusCol, ['Active', 'On Hold', 'Completed']);
  const revenueCol = PROJECTS_COLUMNS.findIndex(c => c[1] === 'allocatedRevenue') + 1;
  sheet.getRange(2, revenueCol, sheet.getMaxRows() - 1, 1).setNumberFormat('₹#,##0.00');
  const rules = [
    ['Active',    '#d5f5e3'],
    ['On Hold',   '#fdebd0'],
    ['Completed', '#eaecee']
  ].map(([status, color]) =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$C2="${status}"`)
      .setBackground(color)
      .setRanges([sheet.getRange(2, 1, sheet.getMaxRows() - 1, PROJECTS_COLUMNS.length)])
      .build()
  );
  sheet.setConditionalFormatRules(rules);
}

function setupDashboardTab() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.DASH);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAMES.DASH);
  sheet.clear();
  sheet.clearConditionalFormatRules();

  // Title block
  sheet.getRange('A1:E1').merge()
    .setValue('🏗️  KEN PROJECTS DATABASE — LIVE DASHBOARD')
    .setFontSize(22).setFontWeight('bold').setFontColor('#ffffff')
    .setBackground('#1b2631').setHorizontalAlignment('center');
  sheet.getRange('A2:E2').merge()
    .setValue('Auto-refreshes on every document save.  Manual refresh: Extensions → Apps Script → run refreshDashboard')
    .setFontSize(10).setFontColor('#7f8c8d').setFontStyle('italic').setHorizontalAlignment('center');
  sheet.setRowHeight(1, 50);
  sheet.setRowHeight(2, 22);
  sheet.getRange('A3:E3').merge().setBackground('#1b2631');
  sheet.setRowHeight(3, 8);

  // Column widths
  [240, 180, 30, 240, 180].forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  sheet.setFrozenRows(3);
  refreshDashboard();
}

// ======================================================================
// PERF FIX (v6): THROTTLED DASHBOARD REFRESH
//
// refreshDashboard() calls getAllDocuments() — a full read of all 4
// document sheets plus every line item — and it was being called
// synchronously on EVERY save and EVERY delete. That single call was the
// bulk of the post-save delay: the user's document was already written,
// but the request couldn't return until an entire dashboard rebuild had
// also finished.
//
// The Dashboard is a passive summary sheet nobody reads mid-transaction,
// so it does not need to be perfectly current the instant a save lands.
// This wrapper rebuilds it at most once per THROTTLE window; saves inside
// that window skip the rebuild and return immediately. The dashboard is
// therefore at most ~1 minute stale, and any later save refreshes it.
//
// Call refreshDashboard() directly (not this) when an immediate, guaranteed
// rebuild is required — e.g. from setupDashboard() or manually from the
// Apps Script editor.
// ======================================================================
const DASH_THROTTLE_KEY = 'lastDashboardRefreshMs';
const DASH_THROTTLE_MS = 60 * 1000; // 60 seconds

function maybeRefreshDashboard() {
  try {
    const props = PropertiesService.getScriptProperties();
    const last = Number(props.getProperty(DASH_THROTTLE_KEY) || 0);
    const now = Date.now();
    if (now - last < DASH_THROTTLE_MS) return; // refreshed recently — skip
    props.setProperty(DASH_THROTTLE_KEY, String(now));
  } catch (e) {
    // If Properties is unavailable for any reason, fall through and just
    // refresh — correctness over speed.
  }
  refreshDashboard();
}

function refreshDashboard() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.DASH);
  if (!sheet) return;

  const docs     = getAllDocuments();
  const cash     = getAllCashEntries();
  const sites    = getAllSites();
  const projects = genericGetAll(SHEET_NAMES.PROJECTS, PROJECTS_COLUMNS);

  const active   = docs.filter(d => !d.voided);
  const invoices = active.filter(d => ['INV','SAL'].includes(d.type));
  const advances = active.filter(d => d.type === 'ADV');
  const quotes   = active.filter(d => d.type === 'QUO');
  const credits  = active.filter(d => d.type === 'CRN');

  const sum = arr => arr.reduce((s,d) => s + (Number(d.total)||0), 0);

  // FY range — April-to-March
  const now = new Date();
  const fy  = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart = new Date(fy, 3, 1);   // April 1
  const fyEnd   = new Date(fy+1, 2, 31); // March 31 next year
  const inFY    = arr => arr.filter(d => { const dt = new Date(d.date); return dt >= fyStart && dt <= fyEnd; });

  const fyInvoices = inFY(invoices);
  const fyRevenue  = sum(fyInvoices);
  const fyAdvances = sum(inFY(advances));

  const thisMonthKey = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM');
  const monthRevenue = sum(invoices.filter(d => d.date && d.date.startsWith(thisMonthKey)));
  const monthDocs    = active.filter(d => d.date && d.date.startsWith(thisMonthKey)).length;

  const cashIn      = cash.filter(c => c.direction === 'IN').reduce((s,c)=>s+c.amount,0);
  const cashOut     = cash.filter(c => c.direction === 'OUT').reduce((s,c)=>s+c.amount,0);
  const cashBalance = cashIn - cashOut;

  const activeSites = sites.filter(s => s.status === 'Active').length;
  const activeProj  = projects.filter(p => p.status === 'Active').length;

  // Outstanding — all unpaid invoices, net of advance adjustments
  let outstanding = 0;
  invoices.filter(d => !d.payMode).forEach(d => {
    const linked = (d.advLinks||[]).reduce((s,l)=>s+(Number(l.amt)||0),0);
    const bal = (Number(d.total)||0) - linked;
    if (bal > 0) outstanding += bal;
  });

  // Projects total expense (from cash entries tagged with a projectId)
  const projectExpenses = cash.filter(c => c.direction === 'OUT' && c.projectId).reduce((s,c)=>s+c.amount,0);
  const projectAllocated = projects.reduce((s,p)=>s+(Number(p.allocatedRevenue)||0),0);
  const projectPnl = projectAllocated - projectExpenses;

  const fy_label = `${fy}-${String(fy+1).slice(-2)}`;

  // ── Write data (starting at row 4, below the frozen title rows) ────
  const clr = (txt,col,bold=false) => [`${txt}`, col, bold];

  const sections = [
    // Section headers and data pairs [label, value, col_A_bold]
    ['📄 SALES DOCUMENTS', null],
    [`FY ${fy_label} Revenue (INV+SAL)`, fyRevenue],
    [`FY ${fy_label} Advances`, fyAdvances],
    [`This Month (${thisMonthKey})`, monthRevenue],
    ['Outstanding Dues', outstanding],
    ['Open Quotations', quotes.length],
    ['Credit Notes Issued', credits.length],
    ['Total Documents (all time)', active.length],
    [null, null],
    ['💵 CASH POSITION', null],
    ['Total Cash In', cashIn],
    ['Total Cash Out', cashOut],
    ['Cash in Hand / Balance', cashBalance],
    ['Project-tagged Expenses', projectExpenses],
    [null, null],
    ['🏷️ PROJECTS P&L', null],
    ['Allocated Revenue (manual)', projectAllocated],
    ['Actual Expenses (tagged)', projectExpenses],
    ['Estimated P&L', projectPnl],
    ['Active Projects', activeProj],
    ['Total Projects', projects.length],
    [null, null],
    ['🏗️ SITES & OPERATIONS', null],
    ['Active Sites', activeSites],
    ['Total Sites', sites.length],
    ['Documents This Month', monthDocs],
    [null, null],
    ['🔄 META', null],
    ['Last Refreshed', Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss')]
  ];

  // Clear old data
  const dataStart = 4;
  sheet.getRange(dataStart, 1, 60, 5).clearContent().clearFormat();

  let row = dataStart;
  const sectionHeaderStyle = { bg: '#1b2631', fc: '#f0f3f4', bold: true, size: 11 };
  const subLabelStyle      = { bg: null,      fc: '#2c3e50', bold: false, size: 10 };
  const valueStyle         = { bg: null,      fc: '#1b2631', bold: true,  size: 10 };

  sections.forEach(([label, value]) => {
    if (label === null) { row++; return; }
    const isHeader = value === null;

    if (isHeader) {
      sheet.getRange(row, 1, 1, 2).merge()
        .setValue(label)
        .setBackground(sectionHeaderStyle.bg)
        .setFontColor(sectionHeaderStyle.fc)
        .setFontWeight('bold')
        .setFontSize(sectionHeaderStyle.size)
        .setVerticalAlignment('middle');
      sheet.setRowHeight(row, 28);
    } else {
      const labelCell = sheet.getRange(row, 1);
      labelCell.setValue(label)
        .setFontColor(subLabelStyle.fc)
        .setFontSize(subLabelStyle.size)
        .setFontStyle('normal');

      const valCell = sheet.getRange(row, 2);
      if (typeof value === 'number') {
        const isCurrency = ['Revenue','Advances','Month','Outstanding','Cash','Expenses','Allocated','Actual','P&L','Balance'].some(k => label.includes(k));
        valCell.setValue(value)
          .setNumberFormat(isCurrency ? '₹#,##0.00' : '0')
          .setFontWeight('bold')
          .setFontSize(valueStyle.size)
          .setHorizontalAlignment('right');
        // Color outstanding + P&L by sign
        if (label.includes('Outstanding') || label.includes('P&L') || label.includes('Balance')) {
          valCell.setFontColor(value >= 0 ? '#1e8449' : '#c0392b');
        } else {
          valCell.setFontColor(valueStyle.fc);
        }
      } else {
        valCell.setValue(value).setFontSize(valueStyle.size).setFontColor('#7f8c8d');
      }
      sheet.setRowHeight(row, 22);
    }
    row++;
  });

  // Right column: mini quick-look
  const quickRows = [
    ['FY', fy_label],
    ['Invoices issued', fyInvoices.length],
    ['Avg invoice value', fyInvoices.length ? Math.round(fyRevenue / fyInvoices.length) : 0]
  ];
  sheet.getRange(dataStart, 4, 1, 2).merge()
    .setValue('⚡ QUICK STATS')
    .setBackground('#1b2631').setFontColor('#f0f3f4').setFontWeight('bold').setFontSize(11);
  quickRows.forEach(([lbl, val], i) => {
    sheet.getRange(dataStart + 1 + i, 4).setValue(lbl).setFontColor('#2c3e50').setFontSize(10);
    const vc = sheet.getRange(dataStart + 1 + i, 5);
    if (typeof val === 'number') vc.setValue(val).setFontWeight('bold').setHorizontalAlignment('right').setFontSize(10);
    else vc.setValue(val).setFontSize(10).setHorizontalAlignment('right');
  });
}


// ======================================================================
// FORMATTING HELPERS
// ======================================================================

function applyHeaderFormatting(sheet, columns, headerColor) {
  const headers = columns.map(c => c[0]);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground(headerColor)
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(11)
    .setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 32);

  columns.forEach((col, i) => sheet.setColumnWidth(i + 1, col[2] || 120));

  const maxRows = Math.max(sheet.getMaxRows(), 200);
  try {
    sheet.getRange(2, 1, maxRows - 1, headers.length).applyRowBanding(
      SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false
    );
  } catch (e) { /* banding already exists, ignore */ }

  if (sheet.getDataRange().getNumRows() > 0) {
    try { sheet.getFilter() && sheet.getFilter().remove(); } catch(e) {}
    sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), headers.length).createFilter();
  }
}

function setupTypeColorRules(sheet, typeColIndex, totalCols) {
  const colLetter = columnIndexToLetter(typeColIndex);
  const rules = Object.entries(TYPE_COLORS).map(([type, color]) =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$${colLetter}2="${type}"`)
      .setBackground(color)
      .setRanges([sheet.getRange(2, 1, sheet.getMaxRows() - 1, totalCols)])
      .build()
  );
  sheet.setConditionalFormatRules(rules);
}

function setColumnDropdown(sheet, colIndex, options) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(options, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(2, colIndex, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
}

// Converts a 1-based column index to its spreadsheet letter (1→A, 27→AA, etc.)
// — needed now that columns can exceed 26 in the wider tabs, where the old
// String.fromCharCode(64+n) approach would silently break.
function columnIndexToLetter(index) {
  let letter = '';
  while (index > 0) {
    let rem = (index - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    index = Math.floor((index - 1) / 26);
  }
  return letter;
}

function formatDateForFrontend(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(val);
}