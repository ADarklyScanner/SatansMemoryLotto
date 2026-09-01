const { loadProductionRuntime } = require('./v2_test_runtime');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(label, test) {
  try {
    test();
    console.log('PASS:', label);
  } catch (error) {
    console.error('FAIL:', label, error.message);
    process.exitCode = 1;
  }
}

function rows(count) {
  return Array.from({ length: count }, (_, index) => ({
    draw_id: 'small-' + index,
    draw_number: count - index,
    draw_date: '2025-06-' + String((index % 28) + 1).padStart(2, '0'),
    numbers: [1, 3, 5, 7, 9].map((number, offset) => ((number + index + offset) % 12) + 1).sort((a, b) => a - b),
    bonus_ball: (index % 5) + 1
  }));
}

function fit(windowKey, scoreOffset) {
  const env = { windowInfo: { key: windowKey, actual: windowKey === 'all' ? 180 : Number(windowKey) } };
  return { env, sets: ['set1', 'set2', 'set3'].map((modelKey, index) => ({ modelKey, main: [index + 1, index + 2, index + 3, index + 4, index + 5], bonus: index + 1, FinalModelScore: 60 + scoreOffset + index })) };
}

const { audit } = loadProductionRuntime();
const game = { id: 'small', name: 'Small', mainRange: [1, 12], bonusRange: [1, 5], mainBalls: 5, bonusBalls: 1 };
const productionFit = audit.buildHistoricalFitModelSets(rows(180), game, 'all');

run('Strictness is deterministic, monotonic, and maximum selects the top V2 candidate', () => {
  const pools = [0, 1, 2, 3, 4].map((level) => audit.strictnessPoolSize(productionFit.rankedByModel.set1.length, level));
  assert(pools.every((size, index) => index === 0 || size <= pools[index - 1]), 'strictness pools did not narrow monotonically');
  const low = audit.strictnessSetsForFit(productionFit, game, 0);
  const maximum = audit.strictnessSetsForFit(productionFit, game, 4);
  const repeat = audit.strictnessSetsForFit(productionFit, game, 4);
  assert(JSON.stringify(maximum) === JSON.stringify(repeat), 'strictness output changed for identical input');
  maximum.forEach((set) => {
    const ranked = productionFit.rankedByModel[set.modelKey];
    assert(JSON.stringify(set.main) === JSON.stringify(ranked[0].main), 'maximum strictness did not select the top V2 candidate');
    assert(ranked.slice(0, low.find((item) => item.modelKey === set.modelKey).strictnessPoolSize).some((candidate) => JSON.stringify(candidate.main) === JSON.stringify(set.main)), 'higher strictness introduced a candidate outside the lower-strictness pool');
  });
});

run('Cross-window consensus is deterministic, independent, and resists one-window dominance', () => {
  const consensus = audit.buildCrossWindowConsensusFromFits({ '100': fit('100', 0), '1000': fit('1000', 0), all: fit('all', 0) });
  const repeat = audit.buildCrossWindowConsensusFromFits({ '100': fit('100', 0), '1000': fit('1000', 0), all: fit('all', 0) });
  assert(JSON.stringify(consensus) === JSON.stringify(repeat), 'consensus is not deterministic');
  assert(consensus.windows.map((window) => window.actualHistoryCount).join(',') === '100,1000,180', 'window histories were not retained independently');
  const dominated = audit.buildCrossWindowConsensusFromFits({ '100': { env: { windowInfo: { key: '100', actual: 100 } }, sets: [{ main: [12, 11, 10, 9, 8], bonus: 5, FinalModelScore: 100 }] }, '1000': { env: { windowInfo: { key: '1000', actual: 90 } }, sets: [{ main: [1, 2, 3, 4, 5], bonus: 1, FinalModelScore: 60 }] }, all: { env: { windowInfo: { key: 'all', actual: 90 } }, sets: [{ main: [1, 2, 3, 4, 5], bonus: 1, FinalModelScore: 60 }] } });
  const oneWindow = dominated.mainNumbers.find((entry) => entry.number === 12);
  const persistent = dominated.mainNumbers.find((entry) => entry.number === 1);
  assert(oneWindow.coverage < persistent.coverage && oneWindow.consensusScore < persistent.consensusScore, 'one-window strength masqueraded as durable consensus');
  const derivedFromHundred = audit.buildBatch1DerivedAnalysis(rows(180), game, audit.buildHistoricalFitModelSets(rows(180), game, '100'));
  assert(derivedFromHundred.consensus.windows.find((window) => window.key === 'all').actualHistoryCount === 180, 'All-history consensus incorrectly reused a non-All primary fit');
});

run('Physical context rejects invented or malformed metadata and preserves source isolation', () => {
  const unavailable = audit.analyzePhysicalContext(rows(10), { slug: 'california' }, { id: 'mega_millions' });
  assert(unavailable.recordCount === 0 && unavailable.recommendationInfluence === 0, 'unavailable equipment data gained recommendation influence');
  const normalized = audit.normalizePhysicalContextRecords([{ drawDate: '2025-01-01', drawId: '1', machineId: 'A', ballSetId: 'B', sourceUrl: 'https://operator.example/record' }, { drawDate: '2025-01-02', sourceUrl: 'https://operator.example/record' }, { drawDate: '2025-01-03', sourceUrl: 'https://operator.example/record' }], { slug: 'x' }, game);
  assert(normalized.records.length === 1 && normalized.rejects.length === 2, 'physical metadata validation did not reject unsafe records');
  const documentedRows = Array.from({ length: 29 }, (_, index) => ({ physical_context: { drawDate: '2025-01-' + String(index + 1).padStart(2, '0'), drawId: String(index), machineId: 'A', sourceUrl: 'https://operator.example/record' } }));
  const insufficient = audit.analyzePhysicalContext(documentedRows, { slug: 'x' }, game);
  assert(insufficient.groups[0].sufficient === false && insufficient.recommendationInfluence === 0, 'insufficient equipment sample affected recommendations');
});

if (!process.exitCode) console.log('BATCH 1 EXPANSION: 3 / 3 PASS');