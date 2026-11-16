// Smoke test: no database or network needed. Run with `npm test` from app/.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const src = path.join(__dirname, '..', 'src');
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js')) files.push(p);
  }
})(src);
for (const f of files) execFileSync(process.execPath, ['--check', f]);
console.log(`ok  syntax: ${files.length} files`);

const { PHASES, ALL_ITEMS } = require('../src/roadmap');
assert(PHASES.length > 0 && ALL_ITEMS.length > 0, 'roadmap is empty');
const keys = ALL_ITEMS.map((i) => (Array.isArray(i) ? i[0] : i.key));
assert.strictEqual(new Set(keys).size, keys.length, 'duplicate roadmap keys');
console.log(`ok  roadmap: ${ALL_ITEMS.length} items, unique keys`);

const { esc } = require('../src/views');
assert.strictEqual(esc('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
console.log('ok  views: HTML escaping');

const persona = require('../src/persona');
assert(typeof persona === 'string' && persona.length > 100, 'persona missing');
console.log('ok  persona loaded');
console.log('smoke test passed');
