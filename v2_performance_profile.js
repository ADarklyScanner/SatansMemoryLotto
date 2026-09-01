const { performance } = require('perf_hooks');
const { loadProductionRuntime, buildFixtureRows, FIXTURE_GAME } = require('./v2_test_runtime');

function elapsed(start) { return Number((performance.now() - start).toFixed(2)); }
function profileCase(label, rowCount) {
  const { audit } = loadProductionRuntime();
  const rows = buildFixtureRows(rowCount);
  const report = { case: label, rows: rowCount };
  let start = performance.now();
  const normalized = audit.normalizeHistoryRows(rows, 'fixture', FIXTURE_GAME.id, { total: rows.length });
  report.normalizationMs = elapsed(start);
  start = performance.now();
  const logicalKeys = normalized.rows.map((row) => row._logical_key);
  audit.detectPageBoundaryOverlap(logicalKeys.slice(0, 100), logicalKeys.slice(100, 200));
  report.logicalDedupeMs = elapsed(start);
  start = performance.now();
  const env = audit.buildSelectedWindowEnvironment(normalized.rows, FIXTURE_GAME, 'all');
  report.historyStatisticsMs = elapsed(start);
  const scoringSample = Array.from({ length: 30 }, (_, index) => ({ main: [1 + index, 11 + index, 21 + index, 31 + index, 41 + index], bonus: null }));
  start = performance.now();
  const repeatedFamilyScores = scoringSample.map((candidate) => Object.fromEntries(Object.keys(audit.MODEL_FAMILY_WEIGHTS.set1).map((familyId) => [familyId, audit.computeFamilyScoreForCandidate(candidate, familyId, env)])));
  report.preOptimizationRepeatedInventoryMs = elapsed(start);
  start = performance.now();
  const sharedInventoryScores = scoringSample.map((candidate) => audit.computeModelFamilyScores(candidate, 'set1', env));
  report.optimizedSharedInventoryMs = elapsed(start);
  if (JSON.stringify(repeatedFamilyScores) !== JSON.stringify(sharedInventoryScores)) throw new Error('Shared-inventory optimization changed family-score results');
  const models = {};
  for (const modelKey of ['set1', 'set2', 'set3']) {
    start = performance.now();
    const candidates = audit.generateModelCandidates(modelKey, env, 4000);
    const candidateMs = elapsed(start);
    start = performance.now();
    const mutations = audit.generateOneNumberMutations(candidates.slice(0, 100), env, modelKey);
    const mutationMs = elapsed(start);
    start = performance.now();
    const ranked = candidates.concat(mutations).sort((left, right) => (right.FinalModelScore || 0) - (left.FinalModelScore || 0));
    const rankingMs = elapsed(start);
    start = performance.now();
    const bonus = audit.buildIndependentBonusSelection(modelKey, ranked[0].main, FIXTURE_GAME, env);
    const bonusMs = elapsed(start);
    models[modelKey] = { candidateGenerationAndScoringMs: candidateMs, mutationMs, rankingMs, bonusMs, initialCandidates: candidates.length, mutations: mutations.length, winner: ranked[0].main, bonus };
  }
  report.models = models;
  report.apiDownloadMs = 'not profiled: local fixed fixture';
  report.cacheMs = 'not profiled: IndexedDB browser operation';
  report.renderingMs = 'not profiled: DOM/WebView operation';
  console.log(JSON.stringify(report));
}

profileCase('Mega Millions scale fixture', 1400);
profileCase('Smaller lottery fixture', 180);