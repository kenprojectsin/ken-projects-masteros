// Boots the REAL application HTML inside jsdom with the browser APIs the
// app expects, and captures anything it logs to console.error. A boot
// crash is the specific failure v79 shipped (a temporal-dead-zone throw
// inside renderTable), so "did the app come up clean" is the single most
// valuable assertion in this file.
const fs = require('fs');
const { JSDOM } = require('jsdom');

async function bootApp(opts = {}) {
    const html = fs.readFileSync(opts.file || require('path').join(__dirname, '..', 'index.html'), 'utf8');
    const captured = { errors: [], warns: [], logs: [], alerts: [], confirms: [], opened: [] };

    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'https://example.com/',
        pretendToBeVisual: true,
        beforeParse(win) {
            // --- storage seed ---
            const store = Object.assign({}, opts.seed || {});
            win.localStorage.clear();
            Object.keys(store).forEach(k => win.localStorage.setItem(k, store[k]));

            // --- console capture ---
            win.console.error = (...a) => captured.errors.push(a.map(String).join(' '));
            win.console.warn = (...a) => captured.warns.push(a.map(String).join(' '));
            win.console.log = (...a) => captured.logs.push(a.map(String).join(' '));

            // --- dialogs: never block, always record ---
            win.alert = m => captured.alerts.push(String(m));
            win.confirm = m => { captured.confirms.push(String(m)); return opts.confirmAnswer !== false; };
            win.prompt = m => (opts.promptAnswers && opts.promptAnswers.length ? opts.promptAnswers.shift() : null);
            win.open = (u) => { captured.opened.push(String(u)); return null; };
            win.print = () => {};

            // --- APIs jsdom does not implement ---
            win.fetch = () => Promise.resolve({
                ok: true, json: () => Promise.resolve(opts.fetchResponse || []),
                text: () => Promise.resolve('[]')
            });
            // A real .register() returning a promise — the app chains off it.
            Object.defineProperty(win.navigator, 'serviceWorker', {
                configurable: true,
                value: {
                    register: () => Promise.resolve({ addEventListener() {}, update() {}, installing: null, waiting: null }),
                    addEventListener() {},
                    ready: Promise.resolve({ addEventListener() {} })
                }
            });
            win.html2pdf = () => ({ set: function () { return this; }, from: function () { return this; }, save: () => Promise.resolve() });
            win.scrollTo = () => {};
            if (!win.navigator.clipboard) {
                Object.defineProperty(win.navigator, 'clipboard', {
                    configurable: true, value: { writeText: () => Promise.resolve() }
                });
            }
            win.document.execCommand = () => true;
        }
    });

    // Let boot, timers and microtasks settle.
    await new Promise(r => setTimeout(r, 350));

    // App state (cart, savedDocs, currentlyLoadedDocId, selectedDocIds) is
    // declared with `let` at the top level of a classic script. Those live
    // in the global LEXICAL environment, not on `window` — so win.cart is
    // undefined and assigning to it silently does nothing. Indirect eval
    // runs in global scope and can see them, which is the only way to drive
    // real app state from a test without hand-copying the app's internals.
    const app = code => dom.window.eval(code);

    return { dom, win: dom.window, doc: dom.window.document, captured, app };
}

module.exports = { bootApp };
