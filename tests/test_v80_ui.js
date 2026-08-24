// ============================================================
// v80 STRUCTURAL / BOOT TESTS
// Boots the real v80.html in jsdom. The headline assertion is that the
// app comes up with a clean console — v79's shipped bug was a boot-time
// throw inside renderTable() that no unit test would ever have seen.
// ============================================================
const { bootApp } = require('./harness');
const t = require('./t');

(async () => {
    const { win, doc, captured, app } = await bootApp();
    const byId = id => doc.getElementById(id);
    const has = id => !!byId(id);

    // ============================================================
    t.section('Boot health — the v79 lesson');
    // ============================================================
    const realErrors = captured.errors.filter(e =>
        !/Not implemented|Could not parse CSS|jsdom/i.test(e));
    t.check('app boots with no console errors', realErrors.length === 0,
        realErrors.slice(0, 3).join(' | '));
    t.check('the document table rendered (boot reached renderTable)', has('tableBody'));
    t.check('the version badge is present', has('appVersionBadge'));

    // ============================================================
    t.section('New DOM anchors exist');
    // ============================================================
    [
        ['cartBelowCostWarning', 'item 16 below-cost banner'],
        ['clientCreditWarning', 'item 20 credit banner'],
        ['bundleChips', 'item 22 bundle chips'],
        ['vehicleChips', 'item 12 vehicle chips'],
        ['deliverySiteSuggestions', 'item 11 site datalist'],
        ['docSyncSummary', 'item 14 sync summary'],
        ['stockAgeingBody', 'item 17 ageing panel'],
        ['breakageReportBody', 'item 19 breakage panel'],
        ['freightCompareBody', 'item 18 freight panel'],
        ['freightCompareMonth', 'item 18 month filter'],
        ['bulkStatementModal', 'item 23 statements modal'],
        ['bulkStatementBody', 'item 23 statements list'],
        ['bulkStatementMinDays', 'item 23 minimum-days filter'],
        ['largeDocThresholdIn', 'item 15 review ceiling input'],
        ['btnSelectAllFiltered', 'item 24 select-all-matching button']
    ].forEach(([id, what]) => t.check(what + ' (#' + id + ')', has(id)));

    // ============================================================
    t.section('Wiring — every new function is reachable from the page');
    // ============================================================
    [
        'getKnownUnitCost', 'getCartBelowCostLines', 'renderCartBelowCostWarning',
        'detectLargeDocAnomaly', 'checkLargeDocBeforeSave', 'setLargeDocThreshold',
        'getClientCreditStatus', 'checkCreditPeriodBeforeSave', 'renderClientCreditWarning',
        'getSiteSuggestions', 'refreshSiteSuggestions', 'getRecentVehicles',
        'renderVehicleChips', 'applyVehicleChip', 'updateStickyGrandTotal',
        'getUnsyncedDocIds', 'getDocSyncState', 'renderDocSyncSummary',
        'getStockAgeing', 'renderStockAgeing', 'getBreakageReport', 'renderBreakageReport',
        'computeFreightComparison', 'renderFreightComparison',
        'repeatLastInvoice', 'findLastDocForRepeat',
        'getItemBundles', 'saveCurrentCartAsBundle', 'applyItemBundle', 'deleteItemBundle',
        'renderBundleChips', 'openBulkStatements', 'renderBulkStatements',
        'sendBulkStatement', 'copyBulkStatement', 'copyAllStatements',
        'selectAllFilteredDocs', 'wireCartFieldAutoAdvance', 'renderV80DocExtras',
        'computeOutstandingRows', 'getFilteredDocsForList', 'getCurrentFilteredDocs'
    ].forEach(fn => t.check(fn + '() is defined', typeof win[fn] === 'function'));

    // Inline onclick handlers can only reach globals — a function that
    // exists but isn't on window would fail silently at the tap.
    const inlineHandlers = ['repeatLastInvoice', 'openBulkStatements', 'selectAllFilteredDocs',
        'saveCurrentCartAsBundle', 'copyAllStatements', 'renderFreightComparison',
        'setLargeDocThreshold', 'renderBulkStatements', 'closeBulkStatements'];
    inlineHandlers.forEach(fn =>
        t.check(fn + ' is reachable from an inline onclick', typeof win[fn] === 'function'));

    // ============================================================
    t.section('Renders survive an empty database');
    // ============================================================
    // Every one of these runs on a brand-new device with nothing stored.
    [
        'renderCartBelowCostWarning', 'renderClientCreditWarning', 'renderVehicleChips',
        'renderBundleChips', 'refreshSiteSuggestions', 'updateStickyGrandTotal',
        'renderStockAgeing', 'renderBreakageReport', 'renderFreightComparison',
        'renderDocSyncSummary', 'renderV80DocExtras', 'renderBulkStatements'
    ].forEach(fn => {
        let err = null;
        try { win[fn](); } catch (e) { err = e.message; }
        t.check(fn + '() survives an empty database', err === null, err);
    });

    // ============================================================
    t.section('Item 16 — below-cost banner behaviour');
    // ============================================================
    {
        win.localStorage.setItem('kenStockBatches', JSON.stringify([
            { id: 'B1', itemName: 'AAC Block 8 Inch (Meghalite)', location: 'Stockyard',
              qtyOriginal: 1000, qtyRemaining: 1000, landingCost: 50, purchaseDate: '2026-01-01' }
        ]));
        byId('docType').value = 'INV';
        byId('inclusiveTax').checked = true;

        app("cart.length=0; cart.push({p:'AAC Block 8 Inch (Meghalite)',q:100,r:56,g:12,hsn:'6815',unit:'Nos'})");
        win.renderCartBelowCostWarning();
        t.check('an at-cost rate leaves the banner hidden',
            byId('cartBelowCostWarning').style.display === 'none');

        app("cart.length=0; cart.push({p:'AAC Block 8 Inch (Meghalite)',q:100,r:45,g:12,hsn:'6815',unit:'Nos'})");
        win.renderCartBelowCostWarning();
        const el = byId('cartBelowCostWarning');
        t.check('a below-cost rate shows the banner', el.style.display === 'block');
        t.check('  it names the item', el.innerHTML.includes('AAC Block 8 Inch'));
        t.check('  it states the landing cost', el.innerHTML.includes('50'));
        t.check('  it totals the margin given away', el.innerHTML.includes('Total margin given away'));

        app('cart.length=0');
        win.renderCartBelowCostWarning();
        t.check('emptying the cart hides it again', el.style.display === 'none');
    }

    // ============================================================
    t.section('Item 12 — vehicle chips');
    // ============================================================
    {
        app("savedDocs.length=0;"
            + "savedDocs.push({id:1,type:'INV',docNo:'I1',date:'2026-08-20',vehicle:'TN39 AB 1234',cart:[]},"
            + "{id:2,type:'INV',docNo:'I2',date:'2026-08-10',vehicle:'TN41 XY 9876',cart:[]});");
        win.renderVehicleChips();
        const host = byId('vehicleChips');
        t.check('chips render from document history', host.style.display === 'block');
        t.check('  the most recent lorry is offered', host.innerHTML.includes('TN39 AB 1234'));

        win.applyVehicleChip('TN39 AB 1234');
        t.check('tapping a chip fills the field', byId('vehIn').value === 'TN39 AB 1234');
        win.applyVehicleChip('TN39 AB 1234');
        t.check('tapping the same chip again clears it (mis-tap escape)', byId('vehIn').value === '');

        app('savedDocs.length=0');
        win.renderVehicleChips();
        t.check('no history → chips hidden entirely', host.style.display === 'none');
    }

    // ============================================================
    t.section('Item 11 — site suggestions');
    // ============================================================
    {
        win.localStorage.setItem('kenSites', JSON.stringify([{ id: 'S1', name: 'SV Puram Site' }]));
        app("savedDocs.length=0; savedDocs.push({id:9,type:'INV',docNo:'X',date:'2026-08-01',deliverySite:'Typed Only Site',cart:[]})");
        win.refreshSiteSuggestions();
        const dl = byId('deliverySiteSuggestions');
        t.check('the registry site is offered', dl.innerHTML.includes('SV Puram Site'));
        t.check('a site only ever typed on a document is offered too', dl.innerHTML.includes('Typed Only Site'));
        t.check('the input is bound to the datalist',
            byId('deliverySiteIn').getAttribute('list') === 'deliverySiteSuggestions');
    }

    // ============================================================
    t.section('Item 22 — bundles round-trip');
    // ============================================================
    {
        byId('docType').value = 'INV';
        app("cart.length=0; cart.push({p:'AAC Block 8 Inch (Meghalite)',q:1000,r:56,g:12,hsn:'6815',unit:'Nos'},{p:'Transport',q:1,r:3000,g:18,hsn:'9965',unit:'Trip'})");
        const b = app("buildBundleFromCart('Test load', cart)");
        win.saveItemBundles([b]);
        t.check('a saved bundle persists', win.getItemBundles().length === 1);

        win.renderBundleChips();
        const host = byId('bundleChips');
        t.check('the bundle appears as a chip', host.innerHTML.includes('Test load'));
        t.check('a "save cart as bundle" affordance is always offered',
            host.innerHTML.includes('Save cart as bundle'));

        app('cart.length=0');
        win.applyItemBundle(b.id);
        t.check('applying a bundle fills the cart', app('cart.length') === 2);
        t.check('  quantities come back', app('cart[0].q') === 1000);
        t.check('  a fixed service rate comes back', app("cart.find(c=>c.p==='Transport').r") === 3000);

        const before = app('cart.length');
        win.applyItemBundle(b.id);
        t.check('re-applying does not duplicate lines already present', app('cart.length') === before);

        win.saveItemBundles([]);
        app('cart.length=0');
    }

    // ============================================================
    t.section('Item 25 — auto-advance between qty and rate');
    // ============================================================
    {
        t.check('the wiring flag is set so it can never double-bind',
            byId('qtyInput').getAttribute('data-v80-wired') === '1');
        win.wireCartFieldAutoAdvance(); // idempotency: a second call must be a no-op
        t.check('calling the wiring twice is safe',
            byId('qtyInput').getAttribute('data-v80-wired') === '1');

        byId('docType').value = 'INV';
        byId('qtyInput').value = '10';
        byId('qtyInput').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        t.check('Enter in Qty moves focus to Rate', doc.activeElement === byId('rateInput'));

        // Enter on a zero rate must NOT add a line or steal focus — the
        // alert explaining why would be hidden behind a focus jump.
        // A real product must be selected, or addItem() bails on `if(!p)`
        // long before it reaches the rate check — the assertion would then
        // pass for entirely the wrong reason.
        const prod = byId('prodSelect');
        const realOption = Array.from(prod.options)
            .map(o => o.value)
            .find(v => v && v !== 'CUSTOM');
        t.check('the product dropdown has real options to test against', !!realOption);
        prod.value = realOption;

        app('cart.length=0');
        byId('qtyInput').value = '10';
        byId('rateInput').value = '0';
        const alertsBefore = captured.alerts.length;
        byId('rateInput').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        t.check('Enter on a zero rate adds nothing', app('cart.length') === 0);
        t.check('  and explains why rather than failing silently',
            captured.alerts.length > alertsBefore);
        t.check('  and does NOT steal focus, so the alert cause stays visible',
            doc.activeElement !== prod);

        byId('rateInput').value = '75';
        byId('rateInput').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        t.check('Enter on a valid rate adds the line', app('cart.length') === 1);
        t.check('  and returns focus to the product picker for the next line',
            doc.activeElement === prod);
        app('cart.length=0');
    }

    // ============================================================
    t.section('Item 13 — sticky total is print-safe');
    // ============================================================
    {
        win.updateStickyGrandTotal();
        const bar = byId('stickyGrandTotalBar');
        t.check('the sticky bar exists once created', !!bar);
        t.check('  it is marked no-print so it can never reach a PDF',
            bar.classList.contains('no-print'));
        t.check('  and it lives outside #billPage entirely',
            !byId('billPage').contains(bar));

        doc.body.classList.add('pdf-export-mode');
        win.updateStickyGrandTotal();
        t.check('  it hides during a PDF capture', bar.style.display === 'none');
        doc.body.classList.remove('pdf-export-mode');
    }

    // ============================================================
    t.section('Item 20 / 15 — save gates are ordered before the password prompts');
    // ============================================================
    {
        const src = win.saveDocument.toString();
        const iBelow = src.indexOf('getCartBelowCostLines');
        const iCredit = src.indexOf('checkCreditPeriodBeforeSave');
        const iLarge = src.indexOf('checkLargeDocBeforeSave');
        const iPwd = src.indexOf('MASTER_PASSWORD');
        t.check('the below-cost gate is in saveDocument', iBelow > -1);
        t.check('the credit-period gate is in saveDocument', iCredit > -1);
        t.check('the large-document gate is in saveDocument', iLarge > -1);
        t.check('all three run BEFORE any master-password prompt',
            iPwd > -1 && iBelow < iPwd && iCredit < iPwd && iLarge < iPwd);
    }

    // ============================================================
    t.section('Item 14 — per-document sync badges');
    // ============================================================
    {
        win.localStorage.setItem('kenOfflineDocQueue', JSON.stringify([{ id: 777 }]));
        t.check('a queued document reads as device-only', win.getDocSyncState(777) === 'queued');
        win.renderDocSyncSummary();
        t.check('the summary chip warns about it',
            byId('docSyncSummary').innerHTML.includes('this device only'));
        // _pendingPush accumulates during the test run (every localStorage
        // write queues a config sync), so it has to be cleared explicitly
        // for the all-clear state to be reachable — and a pending push
        // legitimately outranks "all backed up".
        win.localStorage.setItem('kenOfflineDocQueue', '[]');
        app('_pendingPush.clear()');
        win.renderDocSyncSummary();
        t.check('with nothing queued and nothing pending it reports all clear',
            byId('docSyncSummary').innerHTML.includes('backed up'));

        app("_pendingPush.add('documents')");
        win.renderDocSyncSummary();
        t.check('a pending push outranks the all-clear message',
            byId('docSyncSummary').innerHTML.includes('Syncing'));
        app('_pendingPush.clear()');
    }

    // ============================================================
    t.section('Item 24 — select all across pages, not just the current one');
    // ============================================================
    {
        app("savedDocs.length=0; for(let i=1;i<=120;i++){savedDocs.push({id:i,type:'INV',docNo:'KT/INV26-27/'+String(i).padStart(4,'0'),date:'2026-08-01',clientName:'C',total:1000,cart:[]});}");
        byId('filterType').value = 'ALL';
        byId('searchFilter').value = '';
        byId('docFilterFrom').value = '';
        byId('docFilterTo').value = '';
        t.check('the filter sees all 120, past the 50-per-page limit',
            win.getCurrentFilteredDocs().length === 120);

        app('selectedDocIds.clear()');
        win.selectAllFilteredDocs();
        t.check('select-all-matching selects every one of them',
            app('selectedDocIds.size') === 120);

        byId('searchFilter').value = '0007';
        t.check('a search narrows what select-all would take',
            win.getCurrentFilteredDocs().length < 120);
        byId('searchFilter').value = '';
        app('selectedDocIds.clear()');
    }

    // ============================================================
    t.section('Regression — v78/v79 behaviour still intact');
    // ============================================================
    {
        app('savedDocs.length=0');
        win.localStorage.setItem('kenStockBatches', JSON.stringify([
            { id: 'B1', itemName: 'AAC Block 8 Inch (Meghalite)', location: 'Stockyard',
              qtyOriginal: 100, qtyRemaining: 100, landingCost: 50, purchaseDate: '2026-01-01' }
        ]));
        t.check('v78 simple bought quantity still works',
            win.getSimpleBoughtQty('AAC Block 8 Inch (Meghalite)') === 100);

        byId('docType').value = 'INV';
        app("cart.length=0; cart.push({p:'AAC Block 8 Inch (Meghalite)',q:500,r:56,g:12,hsn:'6815',unit:'Nos'})");
        t.check('v79 stock shortfall detection still fires',
            win.getCartStockShortfalls().length === 1);

        // The outstanding report is the function that was refactored — it
        // must still render after having its core lifted out of it.
        let err = null;
        try { win.renderOutstanding(); } catch (e) { err = e.message; }
        t.check('renderOutstanding still runs after the extraction', err === null, err);
        t.check('  and computeOutstandingRows returns an array',
            Array.isArray(win.computeOutstandingRows()));

        err = null;
        try { win.renderDocList(); } catch (e) { err = e.message; }
        t.check('renderDocList still runs after the filter extraction', err === null, err);

        err = null;
        try { win.renderTable(); } catch (e) { err = e.message; }
        t.check('renderTable still runs with the v80 hook added', err === null, err);

        const finalErrors = captured.errors.filter(e => !/Not implemented|Could not parse CSS|jsdom/i.test(e));
        t.check('no console errors accumulated across the whole run',
            finalErrors.length === 0, finalErrors.slice(0, 3).join(' | '));
    }

    const failures = t.report('v80 structural / boot');
    // The app sets intervals that keep Node's event loop alive forever.
    process.exit(failures);
})();
