// Minimal assertion helper. Label FIRST, matching the v79 harness
// convention so the two suites read the same way.
let pass = 0, fail = 0;
const fails = [];

function check(label, ok, detail) {
    if (ok) { pass++; console.log('  ✓ ' + label); }
    else { fail++; fails.push(label + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
}
function eq(label, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    check(label, a === e, a === e ? '' : 'got ' + a + ', expected ' + e);
}
function near(label, actual, expected, tol) {
    tol = tol === undefined ? 0.01 : tol;
    const ok = Math.abs(actual - expected) <= tol;
    check(label, ok, ok ? '' : 'got ' + actual + ', expected ~' + expected);
}
function section(name) { console.log('\n── ' + name); }
function report(suite) {
    console.log('\n' + '═'.repeat(52));
    console.log(suite + ': ' + pass + '/' + (pass + fail));
    if (fail) { console.log('FAILURES:'); fails.forEach(f => console.log('  • ' + f)); }
    console.log('═'.repeat(52));
    return fail;
}
module.exports = { check, eq, near, section, report };
