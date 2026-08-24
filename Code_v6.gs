/**
 * ============================================================================
 * KEN TRADERS MASTER OS — GOOGLE APPS SCRIPT BACKEND
 * Code_v6.gs  ·  rebuilt for v80  ·  August 2026
 * ============================================================================
 *
 * ⚠️ READ THIS BEFORE DEPLOYING — THIS FILE IS A RECONSTRUCTION
 *
 * The original Code_v6.gs was not in the repository. This file was rebuilt
 * from the ONLY authoritative source still available: every call the v80
 * frontend actually makes. Each GET parameter, each POST action, each
 * response shape below is taken from a real call site in index.html, and
 * those are noted per handler so any future change can be traced back.
 *
 * What that means in practice:
 *
 *   • The REQUEST and RESPONSE contracts are exact. The frontend will talk
 *     to this correctly.
 *   • The SHEET COLUMN LAYOUT is not knowable from the frontend, because
 *     the wire format is JSON and says nothing about how it was stored.
 *
 * So this backend does NOT assume a layout. It is header-driven: it reads
 * row 1 of each sheet and maps columns by header name, adding new columns
 * for fields it has not seen before and leaving existing ones exactly where
 * they are. Point it at your existing spreadsheet and it adapts to whatever
 * is already there rather than imposing a schema on it.
 *
 * ▸ BEFORE YOU DEPLOY: File → Make a copy of the spreadsheet. This is a
 *   rebuilt backend touching live business data; a five-second copy is the
 *   difference between a bad afternoon and a lost year of invoices.
 *
 * ▸ AFTER DEPLOYING: Deploy → New deployment → Web app, "Execute as: Me",
 *   "Who has access: Anyone". Then confirm the /exec URL matches
 *   WEB_APP_URL in index.html. If it does not, the frontend keeps working
 *   offline and silently never syncs.
 *
 * ---------------------------------------------------------------------------
 * DESIGN NOTES
 *
 * Local-first. The frontend treats localStorage as primary and this as a
 * mirror, so every handler here is written to fail loudly in its response
 * but never to destroy data on an ambiguous input. Specifically:
 *
 *   - bulkSync replaces a whole collection, so it is guarded by an
 *     optimistic-concurrency stamp AND refuses a write that would empty a
 *     populated collection unless it is explicitly told to.
 *   - Every write takes a document lock. Two phones saving at once is the
 *     normal case here, not an edge case.
 *   - Reads never mutate. A GET can be fired at this from anywhere without
 *     consequence.
 * ---------------------------------------------------------------------------
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * The spreadsheet this backend reads and writes.
 * Taken from SPREADSHEET_URL in index.html. If the script is bound to the
 * sheet (Extensions → Apps Script from inside it), getActive() is used and
 * this is ignored.
 */
var SPREADSHEET_ID = '16wrBGgN0Kz23sCdusI_KgZL27v0_ZrDBda_LSuKUsPQ';

/** Drive folder for uploaded purchase bills and letter scans. Created on
 *  first use if it does not exist. */
var DRIVE_FOLDER_NAME = 'KEN Traders — Uploads';

/**
 * remoteKey (what the frontend asks for) → sheet tab name.
 *
 * The keys are exactly the strings the frontend sends as `?sheet=` and as
 * bulkSync's `collection`. The values are the tab names, matching the
 * display names already used in index.html's data-loss guard so the two
 * agree about what a collection is called.
 */
var SHEETS = {
  documents:      'Documents',
  clients:        'Clients',
  sites:          'Sites',
  projects:       'Projects',
  stockItems:     'Stock Items',
  stockBatches:   'Stock Batches',
  stockMovements: 'Stock Movements',
  stockLocations: 'Stock Locations',
  toolItems:      'Tools',
  toolMovements:  'Tool Movements',
  cashBook:       'Cash Book',
  trips:          'Trips',
  trash:          'Trash',
  letters:        'Letters',
  auditDocs:      'Audit Docs',
  config:         'Config',
  meta:           '_SyncMeta'
};

/**
 * Collections the frontend pushes with bulkSync (whole-collection replace).
 * These are the ones that get a concurrency stamp; everything else is
 * written per-record and does not need one.
 */
var BULK_SYNC_COLLECTIONS = [
  'clients', 'stockItems', 'stockBatches', 'stockMovements', 'stockLocations',
  'toolItems', 'toolMovements', 'cashBook', 'projects', 'trips', 'trash'
];

/**
 * Refuse a bulkSync that would wipe a collection holding more than this many
 * records. The frontend has its own guard against adopting an empty cloud
 * response; this is the same protection from the other side, for the case
 * where a bug or a half-initialised device pushes [] over real data.
 * A deliberate clear can still be done by sending `allowEmpty: true`.
 */
var WIPE_GUARD_MIN_RECORDS = 3;

/**
 * The same collection is fetched under more than one name by different
 * parts of the frontend, and both names have to resolve to the same data
 * or the two halves of a sync disagree about what exists.
 *
 *   cash → cashBook
 *     needsAnyPull uses ['cash', 'kenCashBook', ...] so the PULL is
 *     '?sheet=cash', while SYNC_COLLECTION_MAP.cashBook carries
 *     remoteKey 'cashBook' so the PUSH and the conflict re-pull use
 *     'cashBook'. index.html reconciles them with
 *     PULL_TO_PUSH_KEY = { cash: 'cashBook', ... }; this is that same
 *     mapping on the server side.
 *
 *   projectsFlat → projects
 *     SYNC_COLLECTION_MAP.projectsFlat pushes under remoteKey 'projects',
 *     but some pull paths still ask for 'projectsFlat'.
 */
var SHEET_ALIASES = {
  cash: 'cashBook',
  projectsFlat: 'projects'
};

function resolveSheetAlias(key) {
  return SHEET_ALIASES[key] || key;
}

var LOCK_TIMEOUT_MS = 25000;


// ============================================================================
// ENTRY POINTS
// ============================================================================

/**
 * GET — reads.
 *
 * Call sites in index.html:
 *   fetch(WEB_APP_URL)                       → syncWithCloud(), all documents
 *   fetch(WEB_APP_URL + '?sheet=' + key)     → pullCloudCollectionsOnLoad()
 *   fetch(WEB_APP_URL + '?sheet=config')     → pricing config, audit lock
 *   fetch(WEB_APP_URL + '?sheet=sites')      → sites pull
 *   fetch(WEB_APP_URL + '?sheet=letters')    → letterheads
 *   fetch(WEB_APP_URL + '?sheet=lineItems')  → fetchLineItemsForGstr()
 */
function doGet(e) {
  try {
    var sheetKey = (e && e.parameter && e.parameter.sheet) ? String(e.parameter.sheet) : '';

    // No ?sheet at all means the documents list. syncWithCloud() does
    // `savedDocs = (data || []).map(...)` on the result, so this MUST be a
    // bare array — an envelope object would be mapped over as if it were
    // one and produce garbage.
    if (!sheetKey) return jsonOut(readDocuments());

    if (sheetKey === 'config')    return jsonOut(readConfig());
    if (sheetKey === 'lineItems') return jsonOut(readLineItems());
    if (sheetKey === 'documents') return jsonOut(readDocuments());

    sheetKey = resolveSheetAlias(sheetKey);

    if (BULK_SYNC_COLLECTIONS.indexOf(sheetKey) !== -1) {
      // parseCollectionResponse() in index.html accepts either a bare array
      // (legacy) or { data, stamp }. The envelope is used here because the
      // stamp is what makes conflict detection work at all — without it
      // every push sends lastKnownStamp: null and can never be validated.
      return jsonOut({ data: readCollection(sheetKey), stamp: getStamp(sheetKey) });
    }

    if (SHEETS[sheetKey]) return jsonOut(readCollection(sheetKey));

    // An unknown key is an explicit error, NOT a fallback.
    //
    // This matters more than it looks. index.html carries a long comment on
    // the needsAnyPull table recording that '?sheet=projectsFlat' hit a
    // route that never existed and the old backend "silently fell through
    // to returning EVERY DOCUMENT in the account instead of project data" —
    // which then got written into the projects cache on any device with an
    // empty local copy. A typo in a sheet name must fail visibly here, not
    // hand back a plausible-looking pile of the wrong records.
    return jsonOut({ error: 'Unknown sheet: ' + sheetKey });
  } catch (err) {
    return jsonOut({ error: String(err && err.message ? err.message : err) });
  }
}

/**
 * POST — writes. The frontend always sends Content-Type text/plain so the
 * browser does not fire a CORS preflight (Apps Script web apps cannot
 * answer one), which is why the body is parsed by hand here rather than
 * read from e.parameter.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
      return jsonOut({ success: false, error: 'Server busy — another device is writing. Retry.' });
    }

    var body = {};
    try {
      body = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonOut({ success: false, error: 'Malformed request body' });
    }

    var action = body.action;
    switch (action) {
      case 'save':                 return jsonOut(handleSaveDocument(body));
      case 'delete':               return jsonOut(handleDeleteDocument(body));
      case 'bulkSync':             return jsonOut(handleBulkSync(body));
      case 'bulkDeleteDocuments':  return jsonOut(handleBulkDeleteDocuments(body));
      case 'bulkSetClientIds':     return jsonOut(handleBulkSetClientIds(body));
      case 'saveConfig':           return jsonOut(handleSaveConfig(body));
      case 'saveSite':             return jsonOut(handleSaveSite(body));
      case 'deleteSite':           return jsonOut(handleDeleteSite(body));
      case 'saveLetter':           return jsonOut(handleSaveLetter(body));
      case 'deleteLetter':         return jsonOut(handleDeleteLetter(body));
      case 'uploadAuditPdf':       return jsonOut(handleUploadAuditPdf(body));
      case 'uploadLetterScan':     return jsonOut(handleUploadLetterScan(body));
      case 'deleteAuditDoc':       return jsonOut(handleDeleteAuditDoc(body));
      default:
        return jsonOut({ success: false, error: 'Unknown action: ' + String(action) });
    }
  } catch (err) {
    return jsonOut({ success: false, error: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}


// ============================================================================
// SPREADSHEET PRIMITIVES — header-driven, layout-agnostic
// ----------------------------------------------------------------------------
// Everything below maps columns by their header TEXT, never by index. That
// is what lets this file be dropped onto the existing spreadsheet without
// knowing how its columns are currently ordered: whatever headers are there
// keep their positions, and any field the frontend sends that has no column
// yet gets one appended.
// ============================================================================

function ss() {
  var active = null;
  try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (ignored) {}
  return active || SpreadsheetApp.openById(SPREADSHEET_ID);
}

function sheetFor(key) {
  var name = SHEETS[key];
  if (!name) throw new Error('No sheet mapped for key: ' + key);
  var book = ss();
  var sh = book.getSheetByName(name);
  if (!sh) {
    sh = book.insertSheet(name);
    sh.appendRow(['id']); // minimal header; real columns are added on first write
  }
  return sh;
}

function getHeaders(sh) {
  if (sh.getLastColumn() === 0) return [];
  var row = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return row.map(function (h) { return String(h == null ? '' : h).trim(); });
}

/**
 * Ensures every key in `keys` has a column, appending any that are missing.
 * Existing columns are never moved or renamed — reordering them would break
 * anyone reading the sheet by eye, and there is no reason to.
 */
function ensureHeaders(sh, keys) {
  var headers = getHeaders(sh);
  var missing = [];
  keys.forEach(function (k) {
    if (headers.indexOf(k) === -1 && missing.indexOf(k) === -1) missing.push(k);
  });
  if (!missing.length) return headers;

  var startCol = headers.length + 1;
  sh.getRange(1, startCol, 1, missing.length).setValues([missing]);
  sh.getRange(1, 1, 1, headers.length + missing.length)
    .setFontWeight('bold')
    .setBackground('#2c3e50')
    .setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return headers.concat(missing);
}

/**
 * A cell holds a string, but the frontend expects real arrays and objects
 * back (doc.cart is iterated directly, project.timeline is an array, and
 * so on). Anything that round-trips as JSON is restored; anything else is
 * returned as-is.
 *
 * Deliberately conservative: a value is only parsed when it clearly starts
 * as a JSON array or object. Parsing bare numbers would turn a doc number
 * like "0042" into 42, and parsing bare words would turn "null" into null.
 */
function decodeCell(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v !== 'string') {
    // Dates come back as Date objects; the app works in ISO strings.
    if (Object.prototype.toString.call(v) === '[object Date]') {
      return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    return v;
  }
  var s = v.trim();
  if ((s.charAt(0) === '[' && s.charAt(s.length - 1) === ']') ||
      (s.charAt(0) === '{' && s.charAt(s.length - 1) === '}')) {
    try { return JSON.parse(s); } catch (ignored) { return v; }
  }
  return v;
}

function encodeCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

/** Reads a whole sheet as an array of plain objects, keyed by header. */
function readSheetObjects(sh) {
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol === 0) return [];

  var headers = getHeaders(sh);
  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  return values.map(function (row) {
    var obj = {};
    var empty = true;
    for (var i = 0; i < headers.length; i++) {
      if (!headers[i]) continue;
      var val = decodeCell(row[i]);
      obj[headers[i]] = val;
      if (val !== '' && val !== null) empty = false;
    }
    return empty ? null : obj;
  }).filter(function (o) { return o !== null; });
}

/** Replaces a sheet's data rows wholesale, preserving the header row. */
function writeSheetObjects(sh, objects) {
  // Union of every key across every record: a collection is not guaranteed
  // to be homogeneous (an older stock batch has no isDraft field, a newer
  // one does), so taking the first record's keys would silently drop data.
  var keys = [];
  objects.forEach(function (o) {
    Object.keys(o || {}).forEach(function (k) {
      if (keys.indexOf(k) === -1) keys.push(k);
    });
  });

  var headers = ensureHeaders(sh, keys.length ? keys : ['id']);

  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  }
  if (!objects.length) return;

  var rows = objects.map(function (o) {
    return headers.map(function (h) { return h ? encodeCell(o[h]) : ''; });
  });
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

/** Finds the 1-based sheet row for a record id, or -1. */
function findRowById(sh, id) {
  var headers = getHeaders(sh);
  var idCol = headers.indexOf('id');
  if (idCol === -1) return -1;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;

  var ids = sh.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  var target = String(id);
  for (var i = 0; i < ids.length; i++) {
    // Compared as strings on purpose: Sheets round-trips a numeric id as a
    // number, the frontend sends Date.now() ints, and an id that came back
    // through JSON may be either. index.html hit exactly this bug (the I3
    // fix in loadDocument) and settled on string comparison.
    if (String(ids[i][0]) === target) return i + 2;
  }
  return -1;
}

/** Inserts or updates one record by id. */
function upsertRecord(sh, record) {
  var headers = ensureHeaders(sh, Object.keys(record));
  var row = headers.map(function (h) { return h ? encodeCell(record[h]) : ''; });
  var existing = findRowById(sh, record.id);
  if (existing > 0) {
    sh.getRange(existing, 1, 1, headers.length).setValues([row]);
    return 'updated';
  }
  sh.appendRow(row);
  return 'created';
}

function deleteRecordById(sh, id) {
  var row = findRowById(sh, id);
  if (row < 0) return false;
  sh.deleteRow(row);
  return true;
}

function jsonOut(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================================
// SYNC STAMPS — optimistic concurrency for bulkSync
// ----------------------------------------------------------------------------
// index.html sends `lastKnownStamp` with every bulkSync and handles a
// `{ conflict: true }` reply by re-pulling, adopting cloud, and retrying.
// That whole recovery path is dead code unless this side actually issues
// and checks stamps — so it does.
// ============================================================================

function metaSheet() {
  var book = ss();
  var sh = book.getSheetByName(SHEETS.meta);
  if (!sh) {
    sh = book.insertSheet(SHEETS.meta);
    sh.appendRow(['collection', 'stamp', 'deviceId', 'updatedAt']);
    sh.hideSheet(); // bookkeeping, not business data
  }
  return sh;
}

function getStamp(collection) {
  var sh = metaSheet();
  var row = findRowByFirstCol(sh, collection);
  return row > 0 ? String(sh.getRange(row, 2).getValue() || '') : '';
}

function setStamp(collection, deviceId) {
  var sh = metaSheet();
  var stamp = String(new Date().getTime()) + '-' + Math.floor(Math.random() * 100000);
  var row = findRowByFirstCol(sh, collection);
  var values = [collection, stamp, deviceId || '', new Date().toISOString()];
  if (row > 0) sh.getRange(row, 1, 1, 4).setValues([values]);
  else sh.appendRow(values);
  return stamp;
}

function findRowByFirstCol(sh, value) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  var col = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0]) === String(value)) return i + 2;
  }
  return -1;
}


// ============================================================================
// READ HANDLERS
// ============================================================================

/**
 * All documents, as a bare array.
 * Consumed by syncWithCloud(): `savedDocs = (data || []).map(d => ({...d, id: Number(d.id)}))`.
 * doc.cart must arrive as a real array — decodeCell() restores it from the
 * JSON stored in the cell.
 */
function readDocuments() {
  var docs = readSheetObjects(sheetFor('documents'));
  return docs.map(function (d) {
    // cart is the one field the whole app assumes is always iterable.
    // A document row that somehow lost it should render as an empty
    // document, not throw inside every report that touches it.
    if (!d.cart || !(d.cart instanceof Array)) d.cart = [];
    if (d.advLinks && !(d.advLinks instanceof Array)) d.advLinks = [];
    return d;
  });
}

function readCollection(key) {
  return readSheetObjects(sheetFor(key));
}

/**
 * Config is a key/value sheet returned as ONE FLAT OBJECT, not an array.
 *
 * Value encoding matters here and is easy to get subtly wrong. index.html
 * reads config three different ways:
 *
 *   data.pricingConfig   → passed straight to migratePricingConfigBrands(),
 *                          so it must arrive as a real OBJECT.
 *   data.auditLockDate   → guarded by `typeof === 'string'`
 *   data.auditLockTypes  → guarded by `typeof === 'string'`, then JSON.parsed
 *   data.addressOptions  → guarded by `typeof === 'string'`, then JSON.parsed
 *   data.termsTemplates  → guarded by `typeof === 'string'`, then JSON.parsed
 *   CONFIG_SYNC_KEYS     → `typeof === 'string'` ? JSON.parse : use raw
 *
 * So everything except pricingConfig must stay a STRING. Parsing them here
 * would make every one of those `typeof === 'string'` guards fail and the
 * setting would be silently ignored — the value would arrive and be dropped
 * on the floor, with nothing anywhere reporting a problem.
 */
function readConfig() {
  var sh = sheetFor('config');
  var lastRow = sh.getLastRow();
  var out = {};
  if (lastRow < 2) return out;

  var rows = sh.getRange(2, 1, lastRow - 1, 2).getValues();
  rows.forEach(function (r) {
    var key = String(r[0] || '').trim();
    if (!key) return;
    var raw = r[1];
    var val = (raw === null || raw === undefined) ? '' : String(raw);

    if (key === 'pricingConfig') {
      try { out[key] = JSON.parse(val); } catch (ignored) { out[key] = val; }
    } else {
      out[key] = val; // MUST remain a string — see the note above
    }
  });
  return out;
}

/**
 * GSTR-1 line items: one row per cart line of every Tax Invoice.
 *
 * DERIVED from the Documents sheet rather than stored separately. Storing
 * it would mean a second copy of every invoice line that has to be kept in
 * step with the first, and fetchLineItemsForGstr() feeds the HSN summary
 * that is actually filed — a stale line-item table there would misreport
 * tax. Deriving it makes drift impossible by construction.
 *
 * Shape consumed by the GSTR report: { docNo, docDate, p, q, r, g, hsn }.
 * The report applies GST-inclusive back-out and the document-level discount
 * factor itself, so raw q/r/g are exactly what it wants.
 */
function readLineItems() {
  var out = [];
  readDocuments().forEach(function (d) {
    if (d.type !== 'INV') return;
    if (String(d.docNo || '').indexOf('VOID') !== -1) return;
    (d.cart || []).forEach(function (item) {
      out.push({
        docNo:   d.docNo,
        docDate: d.date,
        p:       item.p,
        q:       item.q,
        r:       item.r,
        g:       item.g,
        hsn:     item.hsn
      });
    });
  });
  return out;
}


// ============================================================================
// WRITE HANDLERS — documents
// ============================================================================

/**
 * action: 'save'  ·  { action, data }
 * Call sites: saveDocument(), the offline-queue flush, and the void path.
 * Upsert by id — the frontend owns id assignment (Date.now()) and re-sends
 * the same id when editing.
 */
function handleSaveDocument(body) {
  var doc = body.data;
  if (!doc || doc.id === undefined || doc.id === null || doc.id === '') {
    return { success: false, error: 'Document has no id' };
  }
  var sh = sheetFor('documents');
  var result = upsertRecord(sh, doc);
  setStamp('documents', body.deviceId);
  return { success: true, action: result, id: doc.id };
}

/**
 * action: 'delete'  ·  { action, id }
 */
function handleDeleteDocument(body) {
  if (body.id === undefined || body.id === null) {
    return { success: false, error: 'No id supplied' };
  }
  var removed = deleteRecordById(sheetFor('documents'), body.id);
  setStamp('documents', body.deviceId);
  // Not found is reported as success: the caller's intent (this id should
  // not exist) is satisfied, and treating it as an error would make the
  // frontend retry a delete forever against a row that is already gone.
  return { success: true, deleted: removed };
}

/**
 * action: 'bulkDeleteDocuments'  ·  { action, ids: [...] }
 * One call for the whole selection — the comment at that call site notes it
 * replaced a per-document fetch loop.
 */
function handleBulkDeleteDocuments(body) {
  var ids = body.ids || [];
  if (!ids.length) return { success: true, deleted: 0 };

  var sh = sheetFor('documents');
  var headers = getHeaders(sh);
  var idCol = headers.indexOf('id');
  if (idCol === -1) return { success: false, error: 'Documents sheet has no id column' };

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { success: true, deleted: 0 };

  var wanted = {};
  ids.forEach(function (i) { wanted[String(i)] = true; });

  var col = sh.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  var rowsToDelete = [];
  for (var i = 0; i < col.length; i++) {
    if (wanted[String(col[i][0])]) rowsToDelete.push(i + 2);
  }
  // Bottom-up, or each deletion shifts the rows still to be removed.
  rowsToDelete.sort(function (a, b) { return b - a; });
  rowsToDelete.forEach(function (r) { sh.deleteRow(r); });

  setStamp('documents', body.deviceId);
  return { success: true, deleted: rowsToDelete.length };
}

/**
 * action: 'bulkSetClientIds'  ·  { action, updates: [[docId, clientId], ...] }
 * Used when a client is registered, merged, or cleared — retags many
 * documents in one call instead of one fetch per document.
 */
function handleBulkSetClientIds(body) {
  var updates = body.updates || [];
  if (!updates.length) return { success: true, updated: 0 };

  var sh = sheetFor('documents');
  var headers = ensureHeaders(sh, ['id', 'clientId']);
  var idCol = headers.indexOf('id');
  var clientCol = headers.indexOf('clientId');

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { success: true, updated: 0 };

  var map = {};
  updates.forEach(function (u) {
    if (u && u.length >= 1) map[String(u[0])] = (u[1] === undefined || u[1] === null) ? '' : u[1];
  });

  var idValues = sh.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  var clientValues = sh.getRange(2, clientCol + 1, lastRow - 1, 1).getValues();

  var changed = 0;
  for (var i = 0; i < idValues.length; i++) {
    var key = String(idValues[i][0]);
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      clientValues[i][0] = map[key];
      changed++;
    }
  }
  // One write for the whole column rather than a setValue per row — the
  // "Rebuild Registry" flow can touch hundreds of documents at once and a
  // per-cell write would time out well before it finished.
  if (changed) sh.getRange(2, clientCol + 1, clientValues.length, 1).setValues(clientValues);

  setStamp('documents', body.deviceId);
  return { success: true, updated: changed };
}


// ============================================================================
// WRITE HANDLER — bulkSync (whole-collection replace)
// ============================================================================

/**
 * action: 'bulkSync'
 *   { action, collection, data: [...], deviceId, lastKnownStamp }
 *
 * Replies the frontend understands:
 *   { success: true, stamp }         → recorded via recordStamp()
 *   { conflict: true, stamp, ... }   → triggers handleSyncConflict(): re-pull,
 *                                      adopt cloud, retry with the new stamp
 *   { success: false, error }        → queued for retry, silent to the user
 */
function handleBulkSync(body) {
  var collection = body.collection;
  if (!collection) return { success: false, error: 'No collection supplied' };
  collection = resolveSheetAlias(collection);
  if (!SHEETS[collection]) return { success: false, error: 'Unknown collection: ' + collection };

  var incoming = body.data;
  if (!(incoming instanceof Array)) return { success: false, error: 'data must be an array' };

  var currentStamp = getStamp(collection);
  var claimed = body.lastKnownStamp || '';

  // Conflict only when the cloud has a stamp AND the pusher's differs. A
  // first-ever push legitimately has no stamp to send, so an empty claim
  // against an empty cloud stamp is not a conflict — treating it as one
  // would deadlock a fresh device on its very first sync.
  if (currentStamp && claimed !== currentStamp) {
    return {
      conflict: true,
      stamp: currentStamp,
      error: 'Another device wrote to this collection since your last sync'
    };
  }

  var sh = sheetFor(collection);

  // Wipe guard. The frontend already refuses to ADOPT an unexplained empty
  // cloud response; this is the same protection on the write side, for a
  // push of [] over real data. A deliberate clear passes allowEmpty.
  if (incoming.length === 0 && body.allowEmpty !== true) {
    var existingCount = Math.max(0, sh.getLastRow() - 1);
    if (existingCount >= WIPE_GUARD_MIN_RECORDS) {
      return {
        success: false,
        error: 'Refused to replace ' + existingCount + ' record(s) in ' + collection +
               ' with an empty list. Send allowEmpty:true if this is deliberate.'
      };
    }
  }

  writeSheetObjects(sh, incoming);
  var stamp = setStamp(collection, body.deviceId);
  return { success: true, stamp: stamp, count: incoming.length };
}


// ============================================================================
// WRITE HANDLERS — config, sites, letters
// ============================================================================

/**
 * action: 'saveConfig'  ·  { action, data: { key, value } }
 * `value` always arrives pre-stringified from the frontend
 * (JSON.stringify(templates), and so on), so it is stored verbatim. See
 * readConfig() for why it must come back out as a string too.
 */
function handleSaveConfig(body) {
  var d = body.data || {};
  var key = String(d.key || '').trim();
  if (!key) return { success: false, error: 'Config key is required' };

  var sh = sheetFor('config');
  if (sh.getLastRow() === 0) {
    sh.appendRow(['key', 'value']);
    sh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#2c3e50').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }

  var value = d.value === undefined || d.value === null ? '' : d.value;
  if (typeof value === 'object') value = JSON.stringify(value);

  var row = findRowByFirstCol(sh, key);
  if (row > 0) sh.getRange(row, 2).setValue(value);
  else sh.appendRow([key, value]);

  return { success: true, key: key };
}

/**
 * action: 'saveSite'  ·  { action, data: site }
 * Sites are pushed one record at a time rather than by bulkSync — the
 * frontend has its own per-site sync path (runSitesCloudSync) because sites
 * merge rather than being replaced wholesale.
 */
function handleSaveSite(body) {
  var site = body.data;
  if (!site || site.id === undefined || site.id === null) {
    return { success: false, error: 'Site has no id' };
  }
  upsertRecord(sheetFor('sites'), site);
  setStamp('sites', body.deviceId);
  return { success: true, id: site.id };
}

/** action: 'deleteSite'  ·  { action, id } */
function handleDeleteSite(body) {
  if (body.id === undefined || body.id === null) return { success: false, error: 'No id supplied' };
  var removed = deleteRecordById(sheetFor('sites'), body.id);
  setStamp('sites', body.deviceId);
  return { success: true, deleted: removed };
}

/** action: 'saveLetter'  ·  { action, data: letter } */
function handleSaveLetter(body) {
  var letter = body.data;
  if (!letter || letter.id === undefined || letter.id === null) {
    return { success: false, error: 'Letter has no id' };
  }
  upsertRecord(sheetFor('letters'), letter);
  return { success: true, id: letter.id };
}

/** action: 'deleteLetter'  ·  { action, id } */
function handleDeleteLetter(body) {
  if (body.id === undefined || body.id === null) return { success: false, error: 'No id supplied' };
  return { success: true, deleted: deleteRecordById(sheetFor('letters'), body.id) };
}


// ============================================================================
// WRITE HANDLERS — Drive uploads
// ============================================================================

function uploadsFolder() {
  var it = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_FOLDER_NAME);
}

/**
 * action: 'uploadAuditPdf'
 *   { action, data: { id, month, kind, fileName, base64Pdf,
 *                     existingDriveFileId, linkedBatchId, linkedDocNo } }
 *
 * The frontend checks `res.success` and shows `res.error` verbatim on
 * failure, then stores driveFileId/driveUrl on its own record — so both
 * must come back on success or the file is uploaded but unreachable.
 */
function handleUploadAuditPdf(body) {
  var d = body.data || {};
  if (!d.base64Pdf) return { success: false, error: 'No file content received' };

  try {
    var folder = uploadsFolder();

    // Replacing a bill: trash the old file first, or every correction
    // leaves an orphan in Drive that nothing references and nobody deletes.
    if (d.existingDriveFileId) {
      try { DriveApp.getFileById(d.existingDriveFileId).setTrashed(true); } catch (ignored) {}
    }

    var name = (d.month ? d.month + ' — ' : '') +
               (d.kind ? d.kind + ' — ' : '') +
               (d.fileName || ('audit-' + d.id + '.pdf'));

    var blob = Utilities.newBlob(Utilities.base64Decode(stripDataUri(d.base64Pdf)), 'application/pdf', name);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    upsertRecord(sheetFor('auditDocs'), {
      id: d.id,
      month: d.month || '',
      kind: d.kind || '',
      fileName: d.fileName || '',
      driveFileId: file.getId(),
      driveUrl: file.getUrl(),
      linkedBatchId: d.linkedBatchId || '',
      linkedDocNo: d.linkedDocNo || '',
      uploadedAt: new Date().toISOString()
    });

    return { success: true, driveFileId: file.getId(), driveUrl: file.getUrl() };
  } catch (err) {
    return { success: false, error: String(err && err.message ? err.message : err) };
  }
}

/**
 * action: 'uploadLetterScan'
 *   { action, data: { id, docNo, date, fileName, mimeType, base64File } }
 * Images are already compressed and re-encoded to JPEG client-side; PDFs
 * arrive as-is.
 */
function handleUploadLetterScan(body) {
  var d = body.data || {};
  if (!d.base64File) return { success: false, error: 'No file content received' };

  try {
    var folder = uploadsFolder();
    var mime = d.mimeType || 'application/pdf';
    var name = (d.docNo ? d.docNo + ' — ' : '') + (d.fileName || ('letter-' + d.id));

    var blob = Utilities.newBlob(Utilities.base64Decode(stripDataUri(d.base64File)), mime, name);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    upsertRecord(sheetFor('letters'), {
      id: d.id,
      docNo: d.docNo || '',
      date: d.date || '',
      fileName: d.fileName || '',
      scanDriveFileId: file.getId(),
      scanUrl: file.getUrl(),
      uploadedAt: new Date().toISOString()
    });

    return { success: true, driveFileId: file.getId(), driveUrl: file.getUrl(), url: file.getUrl() };
  } catch (err) {
    return { success: false, error: String(err && err.message ? err.message : err) };
  }
}

/** action: 'deleteAuditDoc'  ·  { action, id } */
function handleDeleteAuditDoc(body) {
  if (body.id === undefined || body.id === null) return { success: false, error: 'No id supplied' };

  var sh = sheetFor('auditDocs');
  var row = findRowById(sh, body.id);
  if (row > 0) {
    var headers = getHeaders(sh);
    var fileCol = headers.indexOf('driveFileId');
    if (fileCol !== -1) {
      var fileId = sh.getRange(row, fileCol + 1).getValue();
      // Trashed, not permanently deleted — a mis-tap on a filed purchase
      // bill should be recoverable from Drive's bin for 30 days.
      if (fileId) { try { DriveApp.getFileById(String(fileId)).setTrashed(true); } catch (ignored) {} }
    }
    sh.deleteRow(row);
  }
  return { success: true, deleted: row > 0 };
}

/** A base64 payload may or may not arrive with a data: URI prefix
 *  depending on whether it came from FileReader or from canvas. */
function stripDataUri(b64) {
  var s = String(b64 || '');
  var comma = s.indexOf(',');
  return (s.substring(0, 5) === 'data:' && comma !== -1) ? s.substring(comma + 1) : s;
}


// ============================================================================
// SETUP / DIAGNOSTICS
// ----------------------------------------------------------------------------
// Run these by hand from the Apps Script editor. Nothing here is reachable
// over HTTP.
// ============================================================================

/**
 * Creates any missing sheet tabs. Safe to run against the live spreadsheet:
 * it only ever adds, never touches an existing tab.
 */
function setupSheets() {
  var book = ss();
  var created = [];
  Object.keys(SHEETS).forEach(function (key) {
    var name = SHEETS[key];
    if (!book.getSheetByName(name)) {
      var sh = book.insertSheet(name);
      sh.appendRow(key === 'config' ? ['key', 'value'] : ['id']);
      sh.getRange(1, 1, 1, sh.getLastColumn())
        .setFontWeight('bold').setBackground('#2c3e50').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      if (key === 'meta') sh.hideSheet();
      created.push(name);
    }
  });
  Logger.log(created.length ? 'Created: ' + created.join(', ') : 'All sheets already present.');
  return created;
}

/**
 * Reports what this backend can actually see. Run this first after
 * deploying — it is the fastest way to confirm the script is pointed at the
 * right spreadsheet before any device syncs against it.
 */
function healthCheck() {
  var report = { spreadsheet: ss().getName(), sheets: {}, stamps: {} };
  Object.keys(SHEETS).forEach(function (key) {
    var sh = ss().getSheetByName(SHEETS[key]);
    report.sheets[key] = sh
      ? { tab: SHEETS[key], rows: Math.max(0, sh.getLastRow() - 1), columns: getHeaders(sh).filter(String) }
      : 'MISSING — run setupSheets()';
  });
  BULK_SYNC_COLLECTIONS.forEach(function (c) { report.stamps[c] = getStamp(c) || '(none yet)'; });
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * Every stamp is cleared, so the next push from any device is accepted
 * without a conflict check. Use only to break a genuine sync deadlock —
 * it disables the protection that stops two devices overwriting each other.
 */
function resetSyncStamps() {
  var sh = metaSheet();
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  Logger.log('Sync stamps cleared. The next push from any device will be accepted.');
}
