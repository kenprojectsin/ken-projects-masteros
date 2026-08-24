// ============================================================
// Code_v6.gs BACKEND TESTS
// Runs the real backend file inside a mock Apps Script runtime and
// asserts on the exact request/response contracts the v80 frontend uses.
// ============================================================
const { createRuntime } = require('./gas_mock');
const t = require('./t');

const fresh = () => {
    const rt = createRuntime();
    rt.run('setupSheets');
    return rt;
};

// ============================================================
t.section('Setup and health');
// ============================================================
{
    const rt = fresh();
    t.check('setupSheets creates the Documents tab', !!rt.sheet('Documents'));
    t.check('  and the Config tab with key/value headers',
        JSON.stringify(rt.rowsOf('Config')[0]) === JSON.stringify(['key', 'value']));
    t.check('  and hides the sync bookkeeping tab', rt.sheet('_SyncMeta')._hidden === true);

    const before = Object.keys(rt.book._sheets).length;
    rt.run('setupSheets');
    t.check('running setup twice creates nothing new',
        Object.keys(rt.book._sheets).length === before);

    const h = rt.run('healthCheck');
    t.check('healthCheck names the spreadsheet', !!h.spreadsheet);
    t.check('  and reports a row count per sheet', h.sheets.documents.rows === 0);
}

// ============================================================
t.section('Documents — save, read, delete');
// ============================================================
{
    const rt = fresh();
    const doc = {
        id: 1756000000000, type: 'INV', docNo: 'KT/INV26-27/0042', date: '2026-08-24',
        clientName: 'Ravi', gstin: '33ABCDE1234F1Z5', total: 56000, inclusiveTax: true,
        cart: [{ p: 'AAC Block 8 Inch (Meghalite)', q: 1000, r: 56, g: 12, hsn: '6815', unit: 'Nos' }],
        advLinks: [{ ref: 'KT/ADV26-27/0003', amt: 10000 }]
    };

    let res = rt.post({ action: 'save', data: doc });
    t.check('save reports success', res.success === true);
    t.check('  and says it created rather than updated', res.action === 'created');

    // A bare GET is what syncWithCloud() calls, and it does
    // `savedDocs = (data || []).map(...)` — so this must be an ARRAY.
    let docs = rt.get({});
    t.check('a bare GET returns a bare array', Array.isArray(docs));
    t.check('  containing the document', docs.length === 1);
    t.check('  with the id intact', String(docs[0].id) === String(doc.id));
    t.check('  and the doc number preserved as a string, not coerced to a number',
        docs[0].docNo === 'KT/INV26-27/0042');

    // The single most important round-trip: a cell holds text, but the
    // whole app iterates doc.cart directly.
    t.check('cart round-trips as a real ARRAY, not a JSON string',
        Array.isArray(docs[0].cart));
    t.check('  with the line intact', docs[0].cart[0].p === 'AAC Block 8 Inch (Meghalite)');
    t.check('  and numeric fields still numeric', docs[0].cart[0].q === 1000);
    t.check('advLinks round-trips as an array too', Array.isArray(docs[0].advLinks));

    res = rt.post({ action: 'save', data: Object.assign({}, doc, { total: 60000 }) });
    t.check('re-saving the same id updates rather than duplicating', res.action === 'updated');
    t.check('  and there is still exactly one row', rt.get({}).length === 1);

    // Editing a document adds fields it did not have before; the sheet
    // has to grow a column rather than silently dropping them.
    rt.post({ action: 'save', data: Object.assign({}, doc, { deliverySite: 'SV Puram', vehicle: 'TN39 AB 1234' }) });
    docs = rt.get({});
    t.check('a field with no column yet is stored, not dropped', docs[0].deliverySite === 'SV Puram');
    t.check('  alongside another new one', docs[0].vehicle === 'TN39 AB 1234');

    res = rt.post({ action: 'save', data: { type: 'INV' } });
    t.check('a document with no id is refused', res.success === false);

    res = rt.post({ action: 'delete', id: doc.id });
    t.check('delete succeeds', res.success === true && res.deleted === true);
    t.check('  and the document is gone', rt.get({}).length === 0);

    res = rt.post({ action: 'delete', id: 999999 });
    t.check('deleting something already gone is success, not an error',
        res.success === true && res.deleted === false);
}

// ============================================================
t.section('Documents — bulk operations');
// ============================================================
{
    const rt = fresh();
    for (let i = 1; i <= 6; i++) {
        rt.post({ action: 'save', data: { id: i, type: 'INV', docNo: 'D' + i, date: '2026-08-01', total: 100, cart: [] } });
    }
    t.check('six documents saved', rt.get({}).length === 6);

    let res = rt.post({ action: 'bulkDeleteDocuments', ids: [2, 4, 6] });
    t.check('bulk delete removes exactly the ids given', res.deleted === 3);
    const left = rt.get({}).map(d => String(d.id)).sort();
    t.check('  and leaves the right ones behind',
        JSON.stringify(left) === JSON.stringify(['1', '3', '5']));

    res = rt.post({ action: 'bulkSetClientIds', updates: [[1, 'C7'], [3, 'C7']] });
    t.check('bulk client tagging reports how many it changed', res.updated === 2);
    let docs = rt.get({});
    t.check('  and the tag landed on the right document',
        docs.find(d => String(d.id) === '1').clientId === 'C7');
    t.check('  and not on the untouched one',
        !docs.find(d => String(d.id) === '5').clientId);

    res = rt.post({ action: 'bulkSetClientIds', updates: [[1, '']] });
    docs = rt.get({});
    t.check('an empty client id clears the tag',
        !docs.find(d => String(d.id) === '1').clientId);

    res = rt.post({ action: 'bulkDeleteDocuments', ids: [] });
    t.check('an empty bulk delete is a harmless no-op', res.success === true && res.deleted === 0);
}

// ============================================================
t.section('bulkSync — replace, stamps and conflict');
// ============================================================
{
    const rt = fresh();
    const clients = [
        { id: 'C1', name: 'Ravi', phone: '9876543210' },
        { id: 'C2', name: 'Kumar', phone: '' }
    ];

    // parseCollectionResponse() accepts a bare array OR { data, stamp }.
    // The envelope is required for conflict detection to work at all.
    let res = rt.post({ action: 'bulkSync', collection: 'clients', data: clients, deviceId: 'devA', lastKnownStamp: null });
    t.check('a first push with no stamp is accepted', res.success === true);
    t.check('  and returns a stamp to remember', !!res.stamp);
    const stampA = res.stamp;

    let got = rt.get({ sheet: 'clients' });
    t.check('the pull returns the { data, stamp } envelope',
        !Array.isArray(got) && Array.isArray(got.data));
    t.check('  with both records', got.data.length === 2);
    t.check('  and the current stamp', got.stamp === stampA);

    // The conflict path in index.html (re-pull, adopt, retry) is dead code
    // unless the server actually rejects a stale push.
    res = rt.post({ action: 'bulkSync', collection: 'clients', data: [], deviceId: 'devB', lastKnownStamp: 'stale-stamp' });
    t.check('a push with a stale stamp is rejected as a conflict', res.conflict === true);
    t.check('  and hands back the current stamp so the retry can succeed', res.stamp === stampA);
    t.check('  and the data is untouched', rt.get({ sheet: 'clients' }).data.length === 2);

    res = rt.post({ action: 'bulkSync', collection: 'clients',
        data: clients.concat([{ id: 'C3', name: 'New' }]), deviceId: 'devB', lastKnownStamp: stampA });
    t.check('retrying with the correct stamp succeeds', res.success === true);
    t.check('  the stamp moves on', res.stamp !== stampA);
    t.check('  and the new record is there', rt.get({ sheet: 'clients' }).data.length === 3);

    // A collection is not homogeneous — an older record lacks fields a
    // newer one has. Taking the first record's keys would drop data.
    rt.post({ action: 'bulkSync', collection: 'stockBatches', data: [
        { id: 'B1', itemName: 'A', qtyOriginal: 100 },
        { id: 'B2', itemName: 'B', qtyOriginal: 50, isDraft: true, landingCost: 42 }
    ], deviceId: 'devA', lastKnownStamp: null });
    const batches = rt.get({ sheet: 'stockBatches' }).data;
    t.check('a field present on only the SECOND record is not lost',
        batches.find(b => b.id === 'B2').landingCost === 42);
    t.check('  and the first record is unaffected',
        batches.find(b => b.id === 'B1').itemName === 'A');
}

// ============================================================
t.section('bulkSync — the wipe guard');
// ============================================================
{
    const rt = fresh();
    let s = rt.post({ action: 'bulkSync', collection: 'cashBook',
        data: [{ id: 1, amount: 100 }, { id: 2, amount: 200 }, { id: 3, amount: 300 }, { id: 4, amount: 400 }],
        deviceId: 'devA', lastKnownStamp: null }).stamp;

    let res = rt.post({ action: 'bulkSync', collection: 'cashBook', data: [], deviceId: 'devA', lastKnownStamp: s });
    t.check('pushing [] over a populated collection is refused', res.success === false);
    t.check('  with an explanation naming the record count', /4 record/.test(res.error));
    t.check('  and nothing was deleted', rt.get({ sheet: 'cashBook' }).data.length === 4);

    res = rt.post({ action: 'bulkSync', collection: 'cashBook', data: [], deviceId: 'devA', lastKnownStamp: s, allowEmpty: true });
    t.check('a deliberate clear with allowEmpty succeeds', res.success === true);
    t.check('  and does empty it', rt.get({ sheet: 'cashBook' }).data.length === 0);

    // Below the guard threshold, an empty push is normal churn.
    const rt2 = fresh();
    const s2 = rt2.post({ action: 'bulkSync', collection: 'trips', data: [{ id: 1 }], deviceId: 'd', lastKnownStamp: null }).stamp;
    res = rt2.post({ action: 'bulkSync', collection: 'trips', data: [], deviceId: 'd', lastKnownStamp: s2 });
    t.check('emptying a nearly-empty collection is allowed', res.success === true);
}

// ============================================================
t.section('Sheet aliases — the same data under two names');
// ============================================================
{
    const rt = fresh();
    rt.post({ action: 'bulkSync', collection: 'cashBook',
        data: [{ id: 1, direction: 'OUT', amount: 500, category: 'Transport' }],
        deviceId: 'devA', lastKnownStamp: null });

    // needsAnyPull fetches '?sheet=cash'; SYNC_COLLECTION_MAP pushes as
    // 'cashBook'. Both must reach the same rows.
    const viaCash = rt.get({ sheet: 'cash' });
    const viaCashBook = rt.get({ sheet: 'cashBook' });
    t.check("'?sheet=cash' resolves to the cash book", viaCash.data.length === 1);
    t.check('  and matches what the push key returns',
        JSON.stringify(viaCash.data) === JSON.stringify(viaCashBook.data));

    rt.post({ action: 'bulkSync', collection: 'projects', data: [{ id: 'P1', name: 'Site A' }],
        deviceId: 'devA', lastKnownStamp: null });
    t.check("'?sheet=projectsFlat' resolves to projects",
        rt.get({ sheet: 'projectsFlat' }).data.length === 1);

    // The old backend fell through to returning every document for an
    // unknown key, which silently poisoned the projects cache.
    const bad = rt.get({ sheet: 'nonsenseKey' });
    t.check('an unknown sheet errors instead of falling through', !!bad.error);
    t.check('  and specifically does NOT return the documents list', !Array.isArray(bad));
}

// ============================================================
t.section('Config — the string/object encoding rule');
// ============================================================
{
    const rt = fresh();
    rt.post({ action: 'saveConfig', data: { key: 'pricingConfig', value: JSON.stringify({ tiers: { Customer: 10 } }) } });
    rt.post({ action: 'saveConfig', data: { key: 'auditLockDate', value: '2026-06-30' } });
    rt.post({ action: 'saveConfig', data: { key: 'auditLockTypes', value: JSON.stringify(['INV', 'RCM']) } });
    rt.post({ action: 'saveConfig', data: { key: 'itemBundles', value: JSON.stringify([{ id: 'BN1', name: 'Standard load' }]) } });
    rt.post({ action: 'saveConfig', data: { key: 'largeDocThreshold', value: 500000 } });

    const cfg = rt.get({ sheet: 'config' });
    t.check('config comes back as one flat object, not an array',
        !Array.isArray(cfg) && typeof cfg === 'object');

    // migratePricingConfigBrands(data.pricingConfig) is handed this
    // directly, so it must be a real object.
    t.check('pricingConfig is parsed to an OBJECT', typeof cfg.pricingConfig === 'object');
    t.check('  with its contents', cfg.pricingConfig.tiers.Customer === 10);

    // These are all guarded by `typeof === 'string'` in index.html. Parsing
    // them here would make every one of those guards fail and the setting
    // would arrive and be silently discarded.
    t.check('auditLockDate stays a STRING', typeof cfg.auditLockDate === 'string');
    t.check('auditLockTypes stays a STRING for its typeof guard', typeof cfg.auditLockTypes === 'string');
    t.check('  and is still valid JSON for the caller to parse',
        JSON.stringify(JSON.parse(cfg.auditLockTypes)) === JSON.stringify(['INV', 'RCM']));
    t.check('v80 itemBundles stays a STRING for the CONFIG_SYNC_KEYS loop',
        typeof cfg.itemBundles === 'string');
    t.check('v80 largeDocThreshold round-trips as a scalar string',
        String(cfg.largeDocThreshold) === '500000');

    rt.post({ action: 'saveConfig', data: { key: 'auditLockDate', value: '2026-07-31' } });
    t.check('re-saving a key updates in place', rt.get({ sheet: 'config' }).auditLockDate === '2026-07-31');
    t.check('  without adding a duplicate row',
        rt.rowsOf('Config').filter(r => r[0] === 'auditLockDate').length === 1);

    t.check('a config write with no key is refused',
        rt.post({ action: 'saveConfig', data: { value: 'x' } }).success === false);
}

// ============================================================
t.section('Sites and letters — per-record writes');
// ============================================================
{
    const rt = fresh();
    rt.post({ action: 'saveSite', data: { id: 'S1', name: 'SV Puram', timeline: JSON.stringify([]) } });
    rt.post({ action: 'saveSite', data: { id: 'S2', name: 'Site B' } });
    t.check('both sites saved', rt.get({ sheet: 'sites' }).length === 2);

    rt.post({ action: 'saveSite', data: { id: 'S1', name: 'SV Puram (renamed)' } });
    let sites = rt.get({ sheet: 'sites' });
    t.check('saving an existing site updates it', sites.length === 2);
    t.check('  with the new name', sites.find(s => s.id === 'S1').name === 'SV Puram (renamed)');

    t.check('deleteSite removes it', rt.post({ action: 'deleteSite', id: 'S2' }).deleted === true);
    t.check('  leaving one', rt.get({ sheet: 'sites' }).length === 1);

    rt.post({ action: 'saveLetter', data: { id: 1756000000001, docNo: 'KT/LET/0001', body: 'Dear sir' } });
    // Letters are read with `data.map(...)`, so this one must be an array.
    t.check('letters come back as a bare array', Array.isArray(rt.get({ sheet: 'letters' })));
    t.check('  with the letter', rt.get({ sheet: 'letters' }).length === 1);
    t.check('deleteLetter removes it',
        rt.post({ action: 'deleteLetter', id: 1756000000001 }).deleted === true);
}

// ============================================================
t.section('lineItems — derived from documents, so it cannot drift');
// ============================================================
{
    const rt = fresh();
    rt.post({ action: 'save', data: { id: 1, type: 'INV', docNo: 'KT/INV26-27/0001', date: '2026-08-01', total: 100,
        cart: [{ p: 'Block', q: 10, r: 56, g: 12, hsn: '6815' }, { p: 'Transport', q: 1, r: 3000, g: 18, hsn: '9965' }] } });
    rt.post({ action: 'save', data: { id: 2, type: 'SAL', docNo: 'KT/SAL26-27/0001', date: '2026-08-02', total: 50,
        cart: [{ p: 'Block', q: 5, r: 50, g: 0, hsn: '' }] } });
    rt.post({ action: 'save', data: { id: 3, type: 'INV', docNo: 'KT/INV26-27/0002 - VOID', date: '2026-08-03', total: 999,
        cart: [{ p: 'Block', q: 999, r: 56, g: 12, hsn: '6815' }] } });

    const items = rt.get({ sheet: 'lineItems' });
    t.check('one row per cart line of every Tax Invoice', items.length === 2);
    t.check('  Sales Invoices are excluded (no GST data by design)',
        !items.some(i => i.docNo.indexOf('SAL') !== -1));
    t.check('  voided invoices are excluded', !items.some(i => i.docNo.indexOf('VOID') !== -1));
    t.check('  the shape matches what the GSTR report reads',
        ['docNo', 'docDate', 'p', 'q', 'r', 'g', 'hsn'].every(k => k in items[0]));
    t.check('  quantities stay numeric for the HSN summary maths', items[0].q === 10);

    // Editing a document must change the line items, with no second copy
    // to keep in step.
    rt.post({ action: 'save', data: { id: 1, type: 'INV', docNo: 'KT/INV26-27/0001', date: '2026-08-01', total: 100,
        cart: [{ p: 'Block', q: 20, r: 56, g: 12, hsn: '6815' }] } });
    const after = rt.get({ sheet: 'lineItems' });
    t.check('editing an invoice changes its line items immediately', after.length === 1);
    t.check('  with the corrected quantity', after[0].q === 20);
}

// ============================================================
t.section('Drive uploads');
// ============================================================
{
    const rt = fresh();
    const b64 = Buffer.from('%PDF-1.4 fake').toString('base64');

    let res = rt.post({ action: 'uploadAuditPdf', data: {
        id: 'AD1', month: '2026-08', kind: 'PURCHASE_BILL', fileName: 'meghalite.pdf',
        base64Pdf: b64, existingDriveFileId: null, linkedBatchId: 'SB1', linkedDocNo: '' } });
    t.check('audit PDF upload succeeds', res.success === true);
    // The frontend stores both on its own record; without them the file is
    // uploaded but unreachable.
    t.check('  and returns a Drive file id', !!res.driveFileId);
    t.check('  and a URL', /drive\.google\.com/.test(res.driveUrl));
    const firstId = res.driveFileId;
    t.check('  and records it in the sheet', rt.get({ sheet: 'auditDocs' }).length === 1);

    res = rt.post({ action: 'uploadAuditPdf', data: {
        id: 'AD1', month: '2026-08', kind: 'PURCHASE_BILL', fileName: 'meghalite-corrected.pdf',
        base64Pdf: b64, existingDriveFileId: firstId } });
    t.check('re-uploading trashes the superseded file rather than orphaning it',
        rt.driveFiles[firstId]._trashed === true);
    t.check('  and does not create a second sheet row', rt.get({ sheet: 'auditDocs' }).length === 1);

    const dataUri = 'data:application/pdf;base64,' + b64;
    res = rt.post({ action: 'uploadAuditPdf', data: { id: 'AD2', month: '2026-08', kind: 'EXPENSE', base64Pdf: dataUri } });
    t.check('a data: URI prefix is stripped rather than corrupting the file', res.success === true);

    res = rt.post({ action: 'uploadAuditPdf', data: { id: 'AD3' } });
    t.check('an upload with no file content is refused', res.success === false);
    t.check('  with an error the UI can show verbatim', typeof res.error === 'string');

    const second = rt.get({ sheet: 'auditDocs' }).find(d => d.id === 'AD1').driveFileId;
    res = rt.post({ action: 'deleteAuditDoc', id: 'AD1' });
    t.check('deleting an audit doc succeeds', res.success === true);
    t.check('  trashes the Drive file (recoverable, not destroyed)',
        rt.driveFiles[second]._trashed === true);
    t.check('  and removes the row', !rt.get({ sheet: 'auditDocs' }).some(d => d.id === 'AD1'));

    res = rt.post({ action: 'uploadLetterScan', data: {
        id: 1, docNo: 'KT/LET/0001', date: '2026-08-24', fileName: 'scan.jpg',
        mimeType: 'image/jpeg', base64File: b64 } });
    t.check('letter scan upload succeeds', res.success === true);
    t.check('  and returns a URL', !!res.url);
}

// ============================================================
t.section('Robustness');
// ============================================================
{
    const rt = fresh();
    let res = rt.post({ action: 'nonsenseAction' });
    t.check('an unknown action is reported, not silently ignored', res.success === false);
    t.check('  and names the action', /nonsenseAction/.test(res.error));

    const raw = JSON.parse(rt.ctx.doPost({ postData: { contents: 'not json at all' } })._text);
    t.check('a malformed body returns an error rather than throwing', raw.success === false);

    res = rt.post({ action: 'bulkSync', collection: 'clients', data: 'not an array', deviceId: 'd' });
    t.check('bulkSync refuses a non-array payload', res.success === false);

    res = rt.post({ action: 'bulkSync', data: [], deviceId: 'd' });
    t.check('bulkSync refuses a missing collection', res.success === false);

    // A row that somehow lost its cart must render as an empty document,
    // not throw inside every report that touches it.
    rt.post({ action: 'save', data: { id: 5, type: 'INV', docNo: 'X', date: '2026-08-01', total: 1 } });
    t.check('a document with no cart column reads back with cart: []',
        Array.isArray(rt.get({})[0].cart));

    rt.run('resetSyncStamps');
    t.check('resetSyncStamps clears the stamps', rt.run('getStamp', 'clients') === '');
}

process.exit(t.report('Code_v6.gs backend'));
