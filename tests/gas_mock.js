// ============================================================
// Minimal in-memory Google Apps Script runtime.
// Enough of SpreadsheetApp / DriveApp / LockService / Utilities to run
// Code_v6.gs for real and assert on what it does — the backend is a
// reconstruction against live business data, so "it looks right" is not
// good enough.
// ============================================================
const fs = require('fs');
const vm = require('vm');

function makeRange(sheet, row, col, numRows, numCols) {
    return {
        getValues() {
            const out = [];
            for (let r = 0; r < numRows; r++) {
                const line = [];
                for (let c = 0; c < numCols; c++) {
                    const rr = sheet._data[row - 1 + r];
                    line.push(rr && rr[col - 1 + c] !== undefined ? rr[col - 1 + c] : '');
                }
                out.push(line);
            }
            return out;
        },
        setValues(vals) {
            vals.forEach((line, r) => {
                const rowIdx = row - 1 + r;
                if (!sheet._data[rowIdx]) sheet._data[rowIdx] = [];
                line.forEach((v, c) => { sheet._data[rowIdx][col - 1 + c] = v; });
            });
            sheet._normalise();
            return this;
        },
        getValue() { return this.getValues()[0][0]; },
        setValue(v) { return this.setValues([[v]]); },
        clearContent() {
            for (let r = 0; r < numRows; r++) {
                const rowIdx = row - 1 + r;
                if (!sheet._data[rowIdx]) continue;
                for (let c = 0; c < numCols; c++) sheet._data[rowIdx][col - 1 + c] = '';
            }
            sheet._normalise();
            return this;
        },
        setFontWeight() { return this; },
        setBackground() { return this; },
        setFontColor() { return this; }
    };
}

function makeSheet(name) {
    const sheet = {
        _name: name,
        _data: [],
        _hidden: false,
        getName() { return name; },
        _normalise() {
            // Trailing all-blank rows must not count toward getLastRow(),
            // exactly as Sheets behaves after a clearContent().
            while (sheet._data.length &&
                   (!sheet._data[sheet._data.length - 1] ||
                    sheet._data[sheet._data.length - 1].every(v => v === '' || v === undefined || v === null))) {
                sheet._data.pop();
            }
        },
        getLastRow() { return sheet._data.length; },
        getLastColumn() {
            return sheet._data.reduce((m, r) => Math.max(m, r ? r.length : 0), 0);
        },
        appendRow(vals) { sheet._data.push(vals.slice()); return sheet; },
        getRange(row, col, numRows, numCols) {
            return makeRange(sheet, row, col, numRows === undefined ? 1 : numRows, numCols === undefined ? 1 : numCols);
        },
        deleteRow(row) { sheet._data.splice(row - 1, 1); return sheet; },
        setFrozenRows() { return sheet; },
        hideSheet() { sheet._hidden = true; return sheet; }
    };
    return sheet;
}

function makeSpreadsheet(name) {
    const sheets = {};
    return {
        getName() { return name; },
        getSheetByName(n) { return sheets[n] || null; },
        insertSheet(n) { sheets[n] = makeSheet(n); return sheets[n]; },
        _sheets: sheets
    };
}

function createRuntime(opts = {}) {
    const book = makeSpreadsheet(opts.name || 'KEN Traders DB');
    const driveFiles = {};
    let fileSeq = 0;
    const log = [];

    const sandbox = {
        SpreadsheetApp: {
            getActiveSpreadsheet: () => book,
            openById: () => book
        },
        ContentService: {
            MimeType: { JSON: 'application/json' },
            createTextOutput(text) {
                return { _text: text, setMimeType() { return this; }, getContent() { return this._text; } };
            }
        },
        LockService: {
            getScriptLock: () => ({ tryLock: () => true, releaseLock() {} })
        },
        Utilities: {
            base64Decode: s => Buffer.from(String(s), 'base64'),
            newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
            formatDate: (d, tz, fmt) => d.toISOString().slice(0, 10)
        },
        Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
        DriveApp: {
            Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
            Permission: { VIEW: 'VIEW' },
            getFoldersByName: () => ({ hasNext: () => true, next: () => folder }),
            createFolder: () => folder,
            getFileById(id) {
                if (!driveFiles[id]) throw new Error('No file: ' + id);
                return driveFiles[id];
            }
        },
        Logger: { log: m => log.push(String(m)) },
        console
    };

    const folder = {
        createFile(blob) {
            const id = 'FILE' + (++fileSeq);
            const file = {
                _id: id, _blob: blob, _trashed: false,
                getId: () => id,
                getUrl: () => 'https://drive.google.com/file/d/' + id + '/view',
                setSharing() { return this; },
                setTrashed(v) { this._trashed = v; return this; }
            };
            driveFiles[id] = file;
            return file;
        }
    };

    const ctx = vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(opts.file || require('path').join(__dirname, '..', 'Code_v6.gs'), 'utf8'), ctx, { filename: 'Code_v6.gs' });

    const call = (fn, ...args) => vm.runInContext(fn, ctx)(...args);

    return {
        ctx, book, driveFiles, log,
        get: params => JSON.parse(vm.runInContext('doGet', ctx)({ parameter: params || {} })._text),
        post: body => JSON.parse(vm.runInContext('doPost', ctx)({ postData: { contents: JSON.stringify(body) } })._text),
        run: (name, ...args) => vm.runInContext(name, ctx)(...args),
        sheet: n => book.getSheetByName(n),
        rowsOf: n => { const s = book.getSheetByName(n); return s ? s._data : null; }
    };
}

module.exports = { createRuntime };
