// ============================================================
// v80 ENGINE TESTS
// Every function under test is EXTRACTED FROM v80.html at run time,
// not copied here. If the shipped file changes, these tests change
// with it or they fail — which is the whole point.
// ============================================================
const { build } = require('./extract');
const t = require('./t');
// Resolved so the suite works whether it is run from the repo root
// (node tests/test_v80_logic.js) or from inside tests/.
const path = require('path');
const FILE = path.join(__dirname, '..', 'index.html');

// ---- shared stubs matching the real app's helpers ----
const cleanDate = d => { if (!d) return ''; return String(d).includes('T') ? String(d).split('T')[0] : String(d); };
const parseLocalDate = s => { const p = String(s || '').split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); };
const isVoidedDoc = d => String((d && d.docNo) || '').includes('VOID');
const getBlockSize = n => { const m = String(n || '').match(/(\d+)\s*inch/i); return m ? Number(m[1]) : 0; };

// ============================================================
t.section('getKnownUnitCost — cost basis for below-cost & breakage');
// ============================================================
{
    const mk = batches => build(FILE, ['getKnownUnitCost'], { getStockBatches: () => batches });

    t.eq('no batches at all → 0 (unknown, not free)',
        mk([]).getKnownUnitCost('AAC Block 8 Inch (Meghalite)'), 0);

    t.eq('batches exist but none costed → 0, so nothing warns',
        mk([{ itemName: 'X', qtyOriginal: 100, qtyRemaining: 100, landingCost: 0 }]).getKnownUnitCost('X'), 0);

    t.eq('single costed batch → its landing cost',
        mk([{ itemName: 'X', qtyOriginal: 100, qtyRemaining: 100, landingCost: 42 }]).getKnownUnitCost('X'), 42);

    // The reason this exists instead of reusing getWeightedAvgCost: since
    // v79 made cost optional, an uncosted batch sitting alongside a costed
    // one would drag a plain average toward zero and silently under-warn.
    t.eq('uncosted batch alongside a costed one is IGNORED, not averaged in',
        mk([
            { itemName: 'X', qtyOriginal: 100, qtyRemaining: 100, landingCost: 40 },
            { itemName: 'X', qtyOriginal: 100, qtyRemaining: 100, landingCost: 0 }
        ]).getKnownUnitCost('X'), 40);

    t.eq('two costed batches → weighted by quantity remaining, not a flat mean',
        mk([
            { itemName: 'X', qtyOriginal: 100, qtyRemaining: 100, landingCost: 30 },
            { itemName: 'X', qtyOriginal: 300, qtyRemaining: 300, landingCost: 50 }
        ]).getKnownUnitCost('X'), 45);

    t.eq('prefers stock ON HAND — that is what the next sale consumes',
        mk([
            { itemName: 'X', qtyOriginal: 100, qtyRemaining: 0, landingCost: 10 },
            { itemName: 'X', qtyOriginal: 100, qtyRemaining: 100, landingCost: 50 }
        ]).getKnownUnitCost('X'), 50);

    t.eq('everything sold → falls back to costed history rather than losing the basis',
        mk([
            { itemName: 'X', qtyOriginal: 100, qtyRemaining: 0, landingCost: 20 },
            { itemName: 'X', qtyOriginal: 300, qtyRemaining: 0, landingCost: 40 }
        ]).getKnownUnitCost('X'), 35);

    t.eq('other items do not contaminate the cost',
        mk([
            { itemName: 'X', qtyOriginal: 10, qtyRemaining: 10, landingCost: 100 },
            { itemName: 'Y', qtyOriginal: 10, qtyRemaining: 10, landingCost: 1 }
        ]).getKnownUnitCost('X'), 100);
}

// ============================================================
t.section('getCartBelowCostLines — item 16, the highest-priority check');
// ============================================================
{
    // Built against the REAL computeDocLines, so the sell-side figure is
    // literally the one the printed invoice uses.
    const mkCart = (cart, opts) => {
        opts = opts || {};
        const doc = {
            docType: opts.type || 'INV',
            inclusiveTax: opts.inclusive === undefined ? true : opts.inclusive,
            discountAmt: opts.discount || 0
        };
        const document = {
            getElementById: id => {
                if (id === 'docType') return { value: doc.docType };
                if (id === 'inclusiveTax') return { checked: doc.inclusiveTax };
                if (id === 'discountAmt') return { value: String(doc.discountAmt) };
                return null;
            }
        };
        return build(FILE, ['getCartBelowCostLines', 'getKnownUnitCost', 'computeDocLines'], {
            document,
            cart,
            getStockBatches: () => opts.batches || [],
            BELOW_COST_TYPES: ['INV', 'SAL', 'QUO']
        });
    };

    const batches = [{ itemName: 'AAC Block 8 Inch (Meghalite)', qtyOriginal: 1000, qtyRemaining: 1000, landingCost: 50 }];

    // GST-inclusive ₹56 at 12% = ₹50.00 net — exactly at cost, so silent.
    let r = mkCart([{ p: 'AAC Block 8 Inch (Meghalite)', q: 100, r: 56, g: 12 }], { batches }).getCartBelowCostLines();
    t.eq('rate exactly at cost after stripping GST → no warning', r.length, 0);

    // ₹50 inclusive at 12% = ₹44.64 net, under the ₹50 cost.
    r = mkCart([{ p: 'AAC Block 8 Inch (Meghalite)', q: 100, r: 50, g: 12 }], { batches }).getCartBelowCostLines();
    t.eq('GST-inclusive rate that is fine gross but under cost NET → caught', r.length, 1);
    t.near('  loss per unit is computed on the net figure', r[0].lossPerUnit, 5.36);
    t.near('  total loss scales with quantity', r[0].totalLoss, 536.0, 1);

    // The same ₹50 with the inclusive toggle OFF is a genuine ₹50 net.
    r = mkCart([{ p: 'AAC Block 8 Inch (Meghalite)', q: 100, r: 50, g: 12 }], { batches, inclusive: false }).getCartBelowCostLines();
    t.eq('same rate with GST-inclusive OFF is at cost → no false alarm', r.length, 0);

    // A discount reduces what is actually realised, so it must count.
    r = mkCart([{ p: 'AAC Block 8 Inch (Meghalite)', q: 100, r: 56, g: 12 }], { batches, discount: 1000 }).getCartBelowCostLines();
    t.eq('an at-cost rate pushed under by a document discount → caught', r.length, 1);
    t.near('  discount is allocated across the line before comparing', r[0].netUnit, 40);

    r = mkCart([{ p: 'Unknown Item', q: 100, r: 1, g: 12 }], { batches }).getCartBelowCostLines();
    t.eq('item with no costed batch → silent, never "below ₹0"', r.length, 0);

    r = mkCart([{ p: 'AAC Block 8 Inch (Meghalite)', q: 100, r: 50, g: 12 }], { batches, type: 'ADV' }).getCartBelowCostLines();
    t.eq('ADV is a direct amount, not a rate → not policed', r.length, 0);

    r = mkCart([{ p: 'AAC Block 8 Inch (Meghalite)', q: 100, r: 50, g: 12 }], { batches, type: 'QUO' }).getCartBelowCostLines();
    t.eq('QUO sets a price, so it IS policed — before the price is promised', r.length, 1);

    r = mkCart([
        { p: 'AAC Block 8 Inch (Meghalite)', q: 100, r: 50, g: 12 },
        { p: 'Transport', q: 1, r: 3000, g: 18 }
    ], { batches }).getCartBelowCostLines();
    t.eq('only the offending line is reported, not the whole cart', r.length, 1);
    t.eq('  and it names the right item', r[0].name, 'AAC Block 8 Inch (Meghalite)');

    r = mkCart([{ p: 'AAC Block 8 Inch (Meghalite)', q: 0, r: 10, g: 12 }], { batches }).getCartBelowCostLines();
    t.eq('zero-quantity line cannot divide by zero', r.length, 0);
}

// ============================================================
t.section('detectLargeDocAnomaly — item 15, the slipped digit');
// ============================================================
{
    const { detectLargeDocAnomaly } = build(FILE, ['detectLargeDocAnomaly'], {
        LARGE_DOC_MULTIPLE: 3, LARGE_DOC_MIN_HISTORY: 5
    });
    const typical = [40000, 45000, 50000, 55000, 60000]; // median 50000

    t.eq('a normal invoice passes quietly', detectLargeDocAnomaly('INV', 52000, typical, 0).isLarge, false);
    t.eq('3× the median is the boundary, not yet flagged', detectLargeDocAnomaly('INV', 150000, typical, 0).isLarge, false);
    t.eq('a slipped digit (10×) is flagged', detectLargeDocAnomaly('INV', 500000, typical, 0).isLarge, true);
    t.eq('median is correct on an odd-length history', detectLargeDocAnomaly('INV', 1, typical, 0).median, 50000);
    t.eq('median is correct on an even-length history',
        detectLargeDocAnomaly('INV', 1, [10, 20, 30, 40], 0).median, 25);

    // Median not mean, so one historical fat-finger can't raise the bar
    // for everything that comes after it.
    const withOutlier = [40000, 45000, 50000, 55000, 60000, 5000000];
    t.eq('one huge past mistake does not desensitise the check',
        detectLargeDocAnomaly('INV', 500000, withOutlier, 0).isLarge, true);

    t.eq('too little history → relative test stays silent',
        detectLargeDocAnomaly('INV', 999999, [50000, 50000], 0).isLarge, false);
    t.eq('…but the absolute ceiling still catches it',
        detectLargeDocAnomaly('INV', 999999, [50000, 50000], 200000).isLarge, true);
    t.eq('threshold 0 disables the absolute test',
        detectLargeDocAnomaly('INV', 999999, [], 0).isLarge, false);
    t.eq('both tests tripping gives two distinct reasons',
        detectLargeDocAnomaly('INV', 900000, typical, 200000).reasons.length, 2);
    t.eq('zero total is not an anomaly', detectLargeDocAnomaly('INV', 0, typical, 100).isLarge, false);
    t.eq('empty history and no ceiling → never fires',
        detectLargeDocAnomaly('INV', 10000000, [], 0).isLarge, false);
}

// ============================================================
t.section('getStockAgeing — item 17, capital parked in the yard');
// ============================================================
{
    const mk = batches => build(FILE, ['getStockAgeing', 'bucketForAge'], {
        getStockBatches: () => batches, parseLocalDate, cleanDate,
        todayISO: () => '2026-08-24',
        STOCK_AGE_BUCKETS: [
            { key: 'fresh', max: 30 }, { key: 'watch', max: 60 },
            { key: 'slow', max: 90 }, { key: 'stale', max: Infinity }
        ]
    });

    const batches = [
        { id: 'B1', itemName: 'A', location: 'Stockyard', qtyRemaining: 100, landingCost: 50, purchaseDate: '2026-08-20' }, // 4d
        { id: 'B2', itemName: 'A', location: 'Stockyard', qtyRemaining: 200, landingCost: 50, purchaseDate: '2026-06-20' }, // 65d
        { id: 'B3', itemName: 'B', location: 'Stockyard', qtyRemaining: 50, landingCost: 20, purchaseDate: '2026-01-01' },  // 235d
        { id: 'B4', itemName: 'B', location: 'Stockyard', qtyRemaining: 0, landingCost: 20, purchaseDate: '2025-01-01' }    // sold out
    ];
    const a = mk(batches).getStockAgeing();

    t.eq('fully-sold batches are excluded — nothing is "held"', a.rows.length, 3);
    t.eq('oldest stock is listed first', a.rows[0].batchId, 'B3');
    t.eq('age in days is measured to the day', a.rows[0].days, 235);
    t.eq('a 4-day-old batch is fresh', a.rows.find(r => r.batchId === 'B1').bucket, 'fresh');
    t.eq('a 65-day-old batch is slow, not merely watch', a.rows.find(r => r.batchId === 'B2').bucket, 'slow');
    t.eq('a 235-day-old batch is stale', a.rows.find(r => r.batchId === 'B3').bucket, 'stale');
    t.eq('value is quantity remaining × landing cost', a.rows.find(r => r.batchId === 'B2').value, 10000);
    t.eq('bucket totals sum the quantity', a.totals.stale.qty, 50);
    t.eq('bucket totals sum the value', a.totals.slow.value, 10000);
    t.eq('empty bucket reports zero rather than being absent', a.totals.watch.batches, 0);

    // Backdating happens; a negative age would sort to the top and look
    // like the oldest stock in the yard.
    const fwd = mk([{ id: 'F', itemName: 'A', qtyRemaining: 10, landingCost: 1, purchaseDate: '2026-12-01' }]).getStockAgeing();
    t.eq('a forward-dated batch clamps to 0 days, never negative', fwd.rows[0].days, 0);

    const nocost = mk([{ id: 'N', itemName: 'A', qtyRemaining: 10, landingCost: 0, purchaseDate: '2026-01-01' }]).getStockAgeing();
    t.eq('an uncosted batch still ages (quantity is the point)', nocost.rows.length, 1);
    t.eq('  but carries no rupee value', nocost.rows[0].value, 0);
}

// ============================================================
t.section('getBreakageReport — item 19, the mismatch in rupees');
// ============================================================
{
    const mk = (counts, ledger, batches) => build(FILE, ['getBreakageReport', 'getKnownUnitCost'], {
        getPhysicalCounts: () => counts,
        getSimpleLedgerQty: n => ledger[n] || 0,
        getStockBatches: () => batches
    });
    const batches = [
        { itemName: 'A', qtyOriginal: 1000, qtyRemaining: 500, landingCost: 50 },
        { itemName: 'B', qtyOriginal: 1000, qtyRemaining: 500, landingCost: 0 }
    ];

    let r = mk({ A: { qty: 453 } }, { A: 500 }, batches).getBreakageReport();
    t.eq('a shortfall is recorded as a shortage', r.shortages.length, 1);
    t.eq('  47 blocks missing', r.shortageQty, 47);
    t.eq('  costed at landing cost — the number worth acting on', r.shortageValue, 2350);
    t.eq('  and no phantom surplus', r.surpluses.length, 0);

    r = mk({ A: { qty: 520 } }, { A: 500 }, batches).getBreakageReport();
    t.eq('counting more than the ledger is a surplus, not a shortage', r.surpluses.length, 1);
    t.eq('  shortage total stays clean at zero', r.shortageValue, 0);

    // Deliberate: finding extra 4-inch blocks does not pay for broken
    // 8-inch ones, and netting would hide both facts.
    r = mk({ A: { qty: 450 }, B: { qty: 550 } }, { A: 500, B: 500 }, batches).getBreakageReport();
    t.eq('shortage and surplus are reported separately', r.shortages.length + r.surpluses.length, 2);
    t.eq('  surplus is NOT netted off the shortage', r.shortageQty, 50);

    r = mk({ B: { qty: 400 } }, { B: 500 }, batches).getBreakageReport();
    t.eq('an uncosted item still reports the count', r.shortageQty, 100);
    t.eq('  with no invented rupee figure', r.shortageValue, 0);
    t.eq('  and says how many items lack a cost', r.uncostedItems, 1);

    r = mk({ A: { qty: 500 } }, { A: 500 }, batches).getBreakageReport();
    t.eq('an exact match produces no rows at all', r.shortages.length + r.surpluses.length, 0);

    r = mk({}, {}, batches).getBreakageReport();
    t.eq('nothing counted yet → empty report, not a crash', r.shortageValue, 0);

    r = mk({ A: { qty: 400 }, C: { qty: 0 } }, { A: 500, C: 90 }, batches).getBreakageReport();
    t.eq('biggest rupee loss is listed first', r.shortages[0].itemName, 'A');
}

// ============================================================
t.section('computeFreightComparison — item 18, the invisible leak');
// ============================================================
{
    const mk = (docs, batches, cash) => build(FILE,
        ['computeFreightComparison', 'isFreightLineName', 'computeDocLines'], {
        savedDocs: docs, getStockBatches: () => batches, getCashEntries: () => cash,
        cleanDate, isVoidedDoc,
        FREIGHT_LINE_KEYWORDS: ['transport', 'freight', 'lorry', 'delivery charge', 'cartage']
    });

    const docs = [
        { type: 'INV', docNo: 'I1', date: '2026-08-05', clientName: 'A', inclusiveTax: false, cart: [{ p: 'AAC Block 8 Inch', q: 100, r: 50, g: 12 }, { p: 'Transport', q: 1, r: 3000, g: 18 }] },
        { type: 'INV', docNo: 'I2', date: '2026-08-06', clientName: 'B', inclusiveTax: false, cart: [{ p: 'AAC Block 8 Inch', q: 100, r: 50, g: 12 }] },
        { type: 'INV', docNo: 'I3 - VOID', date: '2026-08-07', clientName: 'C', inclusiveTax: false, cart: [{ p: 'Transport', q: 1, r: 9999, g: 18 }] },
        { type: 'QUO', docNo: 'Q1', date: '2026-08-08', clientName: 'D', cart: [{ p: 'Transport', q: 1, r: 5000, g: 18 }] }
    ];
    const batches = [
        { id: 'B1', itemName: 'AAC Block 8 Inch', transportCost: 4000, purchaseDate: '2026-08-01' },
        { id: 'B2', itemName: 'AAC Block 8 Inch', transportCost: 0, purchaseDate: '2026-08-02' }
    ];
    const cash = [{ date: '2026-08-03', direction: 'OUT', category: 'Transport', party: 'Lorry', amount: 1500 }];

    let r = mk(docs, batches, cash).computeFreightComparison('2026-08-01', '2026-08-31');
    t.eq('freight charged is summed from transport lines', r.charged, 3000);
    t.eq('a voided invoice contributes nothing', r.charged, 3000);
    t.eq('a quotation is not revenue and is excluded', r.salesDocs, 2);
    t.eq('counts invoices that DID carry freight', r.docsWithFreight, 1);
    t.eq('and the ones that did not — the actual leak', r.docsWithoutFreight, 1);
    t.eq('freight paid comes from batch transport cost', r.paidBatches, 4000);
    t.eq('a zero-transport batch is not listed as a trip', r.batchRows.length, 1);
    t.eq('the gap is charged minus paid', r.gapVsBatches, -1000);
    t.eq('recovery percentage is reported', r.recoveryPct, 75);
    t.eq('cash-book transport is captured separately', r.paidCash, 1500);
    // Summing the two paid sources would double-count a trip recorded in
    // both places, so the overlap is flagged instead of silently added.
    t.eq('the double-count risk is flagged, not silently resolved', r.mayDoubleCount, true);
    t.eq('cash transport is NOT added into the batch figure', r.paidBatches, 4000);

    r = mk(docs, batches, cash).computeFreightComparison('2026-09-01', '2026-09-30');
    t.eq('a period with no activity reports zeros', r.charged + r.paidBatches + r.paidCash, 0);
    t.eq('no batch freight → recovery percentage is null, not Infinity', r.recoveryPct, null);

    r = mk(docs, batches, cash).computeFreightComparison('', '');
    t.eq('blank dates mean all time', r.charged, 3000);

    const { isFreightLineName } = mk([], [], []);
    t.eq('"Transport" matches', isFreightLineName('Transport'), true);
    t.eq('"Loading & Unloading" is labour, not freight', isFreightLineName('Loading & Unloading'), false);
    t.eq('"Lorry Freight Charges" matches', isFreightLineName('Lorry Freight Charges'), true);
    t.eq('a block is not freight', isFreightLineName('AAC Block 8 Inch (Meghalite)'), false);
    t.eq('empty name is not freight', isFreightLineName(''), false);
}

// ============================================================
t.section('getRecentVehicles — item 12');
// ============================================================
{
    const mk = docs => build(FILE, ['getRecentVehicles'], {
        savedDocs: docs, parseLocalDate, cleanDate, VEHICLE_CHIP_COUNT: 6
    });
    const docs = [
        { date: '2026-08-01', vehicle: 'TN39 AB 1234' },
        { date: '2026-08-02', vehicle: 'TN39 AB 1234' },
        { date: '2026-08-20', vehicle: 'TN41 XY 9876' },
        { date: '2026-08-03', vVeh: 'TN39 CD 5555' },
        { date: '2026-08-04', vehicle: '  tn39 ab 1234  ' },
        { date: '2026-08-05', vehicle: '-' },
        { date: '2026-08-06', vehicle: '' }
    ];
    const v = mk(docs).getRecentVehicles(6);

    t.eq('noise like "-" and blanks are dropped', v.length, 3);
    t.eq('recency wins over frequency — this week beats last year', v[0].name, 'TN41 XY 9876');
    t.eq('case and stray spaces normalise to one lorry', v.find(x => x.name === 'TN39 AB 1234').count, 3);
    t.eq('voucher vehicles (vVeh) are included too',
        v.some(x => x.name === 'TN39 CD 5555'), true);
    t.eq('the list is capped', mk(docs).getRecentVehicles(1).length, 1);
    t.eq('no documents → empty, not a crash', mk([]).getRecentVehicles(6).length, 0);
}

// ============================================================
t.section('getSiteSuggestions — item 11');
// ============================================================
{
    const mk = (sites, docs) => build(FILE, ['getSiteSuggestions'], {
        getSites: () => sites, savedDocs: docs, parseLocalDate, cleanDate
    });
    const s = mk(
        [{ name: 'Sudha Madam — SV Puram' }, { name: 'Site B' }],
        [
            { date: '2026-08-01', deliverySite: 'Old Site' },
            { date: '2026-08-20', deliverySite: 'Newest Site' },
            { date: '2026-08-02', deliverySite: 'site b' },
            { date: '2026-08-03', deliverySite: '' }
        ]
    ).getSiteSuggestions();

    t.eq('registry entries come first', s[0].name, 'Sudha Madam — SV Puram');
    t.eq('a site typed on a document but never registered is offered', s.some(x => x.name === 'Newest Site'), true);
    t.eq('a case-different repeat of a registered site is not duplicated',
        s.filter(x => x.name.toLowerCase() === 'site b').length, 1);
    t.eq('blank sites are skipped', s.some(x => !x.name), false);
    t.eq('most recently used history outranks older history',
        s.findIndex(x => x.name === 'Newest Site') < s.findIndex(x => x.name === 'Old Site'), true);
    t.eq('empty everything → empty list', mk([], []).getSiteSuggestions().length, 0);
}

// ============================================================
t.section('computeOutstandingRows — item 20 (the extraction)');
// ============================================================
{
    const mk = (docs, cash, creditDays) => build(FILE,
        ['computeOutstandingRows', 'getClientCreditStatus', 'getOverdueClientStatements', 'buildStatementMessage'], {
        savedDocs: docs, getCashEntries: () => cash,
        getCreditPeriodDays: () => creditDays,
        todayISO: () => '2026-08-24', parseLocalDate, cleanDate
    });

    const docs = [
        { id: 1, type: 'INV', docNo: 'I1', date: '2026-07-01', clientName: 'Ravi', phone: '9876543210', total: 50000 },
        { id: 2, type: 'INV', docNo: 'I2', date: '2026-08-20', clientName: 'Ravi', total: 20000 },
        { id: 3, type: 'INV', docNo: 'I3', date: '2026-06-01', clientName: 'Kumar', total: 30000 },
        { id: 4, type: 'INV', docNo: 'I4 - VOID', date: '2026-06-01', clientName: 'Kumar', total: 99999 },
        { id: 5, type: 'INV', docNo: 'I5', date: '2026-08-01', clientName: 'Paid Up', total: 10000 },
        { id: 6, type: 'RCP', docNo: 'R1', date: '2026-08-02', clientName: 'Paid Up', total: 10000 }
    ];

    let rows = mk(docs, [], 0).computeOutstandingRows();
    t.eq('a fully-settled invoice drops out', rows.some(r => r.docNo === 'I5'), false);
    t.eq('a voided invoice never appears', rows.some(r => r.docNo.includes('VOID')), false);
    t.eq('the rest remain', rows.length, 3);
    t.eq('rows come back oldest first', rows[0].docNo, 'I3');
    t.eq('_age is present — the report no longer computes it', rows[0]._age !== undefined, true);
    t.eq('with 0-day terms, age is simply days since invoice', rows.find(r => r.docNo === 'I2')._age, 4);

    // The D4 fix, now shared with the save-time gate rather than living
    // only inside the report.
    rows = mk(docs, [], 30).computeOutstandingRows();
    t.eq('30-day terms shift age by exactly the credit period',
        rows.find(r => r.docNo === 'I2')._age, -26);
    t.eq('within-terms invoices go negative, not to zero',
        rows.find(r => r.docNo === 'I2')._age < 0, true);

    const cash = [{ direction: 'IN', linkedDoc: 'I1', amount: 20000 }];
    rows = mk(docs, cash, 0).computeOutstandingRows();
    t.eq('a cash-book payment reduces the balance', rows.find(r => r.docNo === 'I1').balanceDue, 30000);

    // --- credit status, the thing item 20 actually gates on ---
    let st = mk(docs, [], 30).getClientCreditStatus('Ravi');
    t.eq('client status finds every one of their open invoices', st.docCount, 2);
    t.eq('total owed includes within-terms invoices', st.totalDue, 70000);
    t.eq('overdue counts ONLY what is past terms', st.overdueDue, 50000);
    t.eq('  and how many documents that is', st.overdueCount, 1);
    t.eq('past-due flag is set', st.isPastDue, true);
    t.eq('oldest age is the worst invoice', st.oldestAge, 24);

    st = mk(docs, [], 90).getClientCreditStatus('Ravi');
    t.eq('generous terms → owes money but is NOT past due', st.isPastDue, false);
    t.eq('  and still reports the balance', st.totalDue, 70000);

    t.eq('name matching ignores case and padding',
        mk(docs, [], 30).getClientCreditStatus('  ravi  ').docCount, 2);
    t.eq('a client who owes nothing returns null',
        mk(docs, [], 0).getClientCreditStatus('Paid Up'), null);
    t.eq('an empty name returns null rather than everyone',
        mk(docs, [], 0).getClientCreditStatus(''), null);
    t.eq('an unknown client returns null',
        mk(docs, [], 0).getClientCreditStatus('Nobody'), null);
}

// ============================================================
t.section('getOverdueClientStatements / buildStatementMessage — item 23');
// ============================================================
{
    const mk = (docs, creditDays) => build(FILE,
        ['getOverdueClientStatements', 'buildStatementMessage', 'computeOutstandingRows'], {
        savedDocs: docs, getCashEntries: () => [],
        getCreditPeriodDays: () => creditDays,
        todayISO: () => '2026-08-24', parseLocalDate, cleanDate
    });

    const docs = [
        { id: 1, type: 'INV', docNo: 'I1', date: '2026-06-01', clientName: 'Ravi', phone: '9876543210', total: 50000 },
        { id: 2, type: 'INV', docNo: 'I2', date: '2026-07-01', clientName: 'Ravi', total: 20000 },
        { id: 3, type: 'INV', docNo: 'I3', date: '2026-08-23', clientName: 'Fresh Co', total: 5000 },
        { id: 4, type: 'INV', docNo: 'I4', date: '2026-05-01', clientName: 'Kumar', total: 90000 }
    ];

    let list = mk(docs, 0).getOverdueClientStatements(1);
    t.eq('one entry per client, not per invoice', list.length, 3);
    t.eq('biggest debtor is first — that is who to call', list[0].clientName, 'Kumar');
    t.eq("a client's invoices are pooled into one total",
        list.find(c => c.clientName === 'Ravi').total, 70000);
    t.eq('a phone number is picked up from any of their documents',
        list.find(c => c.clientName === 'Ravi').phone, '9876543210');

    list = mk(docs, 0).getOverdueClientStatements(30);
    t.eq('the minimum-days filter excludes recent invoices', list.some(c => c.clientName === 'Fresh Co'), false);
    t.eq('  and keeps the genuinely old ones', list.length, 2);

    // Ravi's I1 (2026-06-01, 84 days) is still 24 days past 60-day terms;
    // only his I2 falls back inside them. So he stays on the list with a
    // reduced balance — which is the correct behaviour, and worth pinning
    // down because "generous terms" must not silently drop a real debtor.
    list = mk(docs, 60).getOverdueClientStatements(1);
    t.eq('60-day terms still catch anyone with an older invoice', list.length, 2);
    t.eq('  worst debtor first', list[0].clientName, 'Kumar');
    t.eq('  and a client\'s within-terms invoice is excluded from their statement',
        list.find(c => c.clientName === 'Ravi').total, 50000);

    const msg = mk(docs, 0).getOverdueClientStatements(1).find(c => c.clientName === 'Ravi').message;
    t.eq('the statement names the client', msg.includes('Ravi'), true);
    t.eq('it itemises every invoice', msg.includes('I1') && msg.includes('I2'), true);
    t.eq('it states the combined total', msg.includes('70,000'), true);
    t.eq('it shows how far past due each one is', msg.includes('past due'), true);
    t.eq('it carries a payment-crossed-in-post caveat', msg.toLowerCase().includes('already been made'), true);

    t.eq('nobody overdue → empty list, not a crash', mk([], 0).getOverdueClientStatements(1).length, 0);
}

// ============================================================
t.section('buildBundleFromCart / findLastDocForRepeat — items 22, 21');
// ============================================================
{
    const { buildBundleFromCart } = build(FILE, ['buildBundleFromCart'], { getBlockSize });
    const b = buildBundleFromCart('Standard load', [
        { p: 'AAC Block 8 Inch (Meghalite)', q: 1000, r: 56, g: 12, hsn: '6815', unit: 'Nos' },
        { p: 'Transport', q: 1, r: 3000, g: 18, hsn: '9965', unit: 'Trip' }
    ]);
    t.eq('the bundle keeps its name', b.name, 'Standard load');
    t.eq('quantities are saved — a bundle without them saves nothing', b.items[0].q, 1000);
    // Block rates move with tier and tonnage; a frozen one would be wrong.
    t.eq('a BLOCK rate is deliberately not frozen', b.items[0].r, null);
    t.eq('a fixed-price service rate IS kept', b.items[1].r, 3000);
    t.eq('HSN and GST carry over', b.items[0].hsn, '6815');
    t.eq('a whitespace-only name is trimmed away', buildBundleFromCart('  ', []).name, '');
    t.eq('an empty cart makes an empty bundle, not a crash', buildBundleFromCart('x', []).items.length, 0);

    const { findLastDocForRepeat } = build(FILE, ['findLastDocForRepeat'], {
        savedDocs: [
            { id: 1, type: 'INV', docNo: 'I1', date: '2026-08-01', clientName: 'Ravi', cart: [{ p: 'A', q: 1 }] },
            { id: 2, type: 'INV', docNo: 'I2', date: '2026-08-10', clientName: 'Ravi', cart: [{ p: 'B', q: 1 }] },
            { id: 3, type: 'INV', docNo: 'I3 - VOID', date: '2026-08-20', clientName: 'Ravi', cart: [{ p: 'C', q: 1 }] },
            { id: 4, type: 'INV', docNo: 'I4', date: '2026-08-15', clientName: 'Kumar', cart: [{ p: 'D', q: 1 }] },
            { id: 5, type: 'QUO', docNo: 'Q1', date: '2026-08-22', clientName: 'Ravi', cart: [{ p: 'E', q: 1 }] },
            { id: 6, type: 'INV', docNo: 'I6', date: '2026-08-18', clientName: 'Empty', cart: [] }
        ],
        isVoidedDoc, parseLocalDate, cleanDate
    });

    t.eq("picks this client's most recent invoice", findLastDocForRepeat('Ravi').docNo, 'I2');
    t.eq('a voided document is never used as a template', findLastDocForRepeat('Ravi').docNo !== 'I3 - VOID', true);
    t.eq('a quotation is not an invoice to repeat', findLastDocForRepeat('Ravi').type, 'INV');
    t.eq('name matching is case-insensitive', findLastDocForRepeat('RAVI').docNo, 'I2');
    t.eq('no client name → most recent invoice overall', findLastDocForRepeat('').docNo, 'I4');
    t.eq('an empty-cart invoice is useless as a template', findLastDocForRepeat('Empty'), null);
    t.eq('an unknown client returns null so the caller can fall back', findLastDocForRepeat('Nobody'), null);
}

// ============================================================
t.section('getDocSyncState / docSyncBadgeHTML — item 14');
// ============================================================
{
    const mk = (queue, pending) => build(FILE,
        ['getUnsyncedDocIds', 'getDocSyncState', 'docSyncBadgeHTML'], {
        getOfflineDocQueue: () => queue, _pendingPush: new Set(pending)
    });

    let m = mk([{ id: 42 }], []);
    t.eq('a queued document is flagged as device-only', m.getDocSyncState(42), 'queued');
    t.eq('  and id type does not matter (Sheets returns strings)', m.getDocSyncState('42'), 'queued');
    t.eq('a document not in the queue is synced', m.getDocSyncState(99), 'synced');
    t.eq('the queued badge is loud', m.docSyncBadgeHTML('queued').includes('THIS DEVICE ONLY'), true);
    t.eq('a synced document gets NO badge — a badge on every row is noise',
        m.docSyncBadgeHTML('synced'), '');

    m = mk([], ['documents']);
    t.eq('an unpushed documents collection shows as syncing', m.getDocSyncState(1), 'pending');
    t.eq('  with its own badge', m.docSyncBadgeHTML('pending').includes('SYNCING'), true);

    m = mk([], ['clients']);
    t.eq('a different collection pending does not mislabel documents', m.getDocSyncState(1), 'synced');
    t.eq('an empty queue is an empty map', Object.keys(mk([], []).getUnsyncedDocIds()).length, 0);
}

process.exit(t.report('v80 engine logic'));
