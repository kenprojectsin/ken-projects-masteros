// Pulls named function sources straight out of the shipped HTML by
// brace-matching, so the tests exercise the code that actually ships
// rather than a hand-copy that can drift. Same approach used for the
// v78 auto-link engine and the v79 shortfall engine.
const fs = require('fs');

function extract(html, name) {
    const re = new RegExp('function\\s+' + name + '\\s*\\(', 'g');
    const m = re.exec(html);
    if (!m) throw new Error('function not found in shipped file: ' + name);
    // Walk forward to the opening brace of the body, then brace-match.
    let i = html.indexOf('{', m.index);
    if (i === -1) throw new Error('no body for ' + name);
    let depth = 0, inStr = null, inTpl = false, inLine = false, inBlock = false, inRe = false;
    let start = m.index;
    for (let j = i; j < html.length; j++) {
        const c = html[j], p = html[j - 1], n = html[j + 1];
        if (inLine) { if (c === '\n') inLine = false; continue; }
        if (inBlock) { if (c === '*' && n === '/') { inBlock = false; j++; } continue; }
        if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) inStr = null; continue; }
        if (inTpl) { if (c === '\\') { j++; continue; } if (c === '`') inTpl = false; continue; }
        if (inRe) { if (c === '\\') { j++; continue; } if (c === '/') inRe = false; continue; }
        if (c === '/' && n === '/') { inLine = true; j++; continue; }
        if (c === '/' && n === '*') { inBlock = true; j++; continue; }
        if (c === '"' || c === "'") { inStr = c; continue; }
        if (c === '`') { inTpl = true; continue; }
        // Regex literal: only after a token that can't end an expression.
        if (c === '/') {
            let k = j - 1;
            while (k >= 0 && /\s/.test(html[k])) k--;
            if (k >= 0 && '(,=:[!&|?{};+-*%~^'.includes(html[k])) { inRe = true; continue; }
        }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return html.slice(start, j + 1); }
    }
    throw new Error('unbalanced braces extracting ' + name);
}

function loadScript(path) {
    const html = fs.readFileSync(path, 'utf8');
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    return blocks.reduce((a, b) => (a.length > b.length ? a : b));
}

// Builds a sandbox containing the named real functions plus whatever
// dependencies the test injects.
function build(path, names, deps) {
    const src = loadScript(path);
    const bodies = names.map(n => extract(src, n)).join('\n\n');
    const depNames = Object.keys(deps);
    const factory = new Function(...depNames, bodies + '\nreturn {' + names.join(',') + '};');
    return factory(...depNames.map(k => deps[k]));
}

module.exports = { extract, loadScript, build };
