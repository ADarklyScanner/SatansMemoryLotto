const { loadProductionRuntime, buildFixtureRows, FIXTURE_GAME, serializableSets } = require('./v2_test_runtime');
const { audit } = loadProductionRuntime();
const rows = buildFixtureRows();
const first = JSON.stringify(serializableSets(audit.regenerateV2Sets(rows, FIXTURE_GAME, 'all')));
for (let run = 0; run < 3; run++) {
  const next = JSON.stringify(serializableSets(audit.regenerateV2Sets(rows, FIXTURE_GAME, 'all')));
  if (next !== first) throw new Error('Production Regenerate output changed on run ' + (run + 2));
}
if (!first.includes('FinalModelScore') || !first.includes('bonus')) throw new Error('Regenerate output omitted V2 score or bonus result');
console.log('PRODUCTION REGENERATE: 4 / 4 PASS');