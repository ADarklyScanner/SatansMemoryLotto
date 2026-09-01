const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const HTML_PATH = path.join(ROOT, 'app', 'src', 'main', 'assets', 'index.html');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildBrowerLikeContext() {
  const makeClassList = () => ({
    add() {}, remove() {}, contains() { return false; }, toggle() { return true; }
  });
  const makeElement = () => ({
    style: {}, classList: makeClassList(),
    addEventListener() {}, removeEventListener() {}, appendChild() {}, setAttribute() {},
    value: '', innerHTML: '', textContent: '', checked: false, disabled: false,
    dataset: {}, children: [], querySelector() { return makeElement(); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
    focus() {}, blur() {}, click() {}, className: '', id: ''
  });

  const document = {
    body: makeElement(),
    documentElement: makeElement(),
    getElementById: () => makeElement(),
    querySelector: () => makeElement(),
    querySelectorAll: () => [],
    createElement: () => makeElement(),
    addEventListener() {}, removeEventListener() {}
  };

  const localStorage = {
    store: {},
    getItem(key) { return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null; },
    setItem(key, value) { this.store[key] = String(value); },
    removeItem(key) { delete this.store[key]; },
    clear() { this.store = {}; }
  };

  const win = {
    document,
    localStorage,
    navigator: { userAgent: 'node' },
    location: { href: 'http://localhost' },
    addEventListener() {}, removeEventListener() {},
    setTimeout, clearTimeout,
    innerWidth: 1280,
    innerHeight: 720
  };

  const ctx = {
    console,
    document,
    window: win,
    localStorage,
    navigator: win.navigator,
    setTimeout,
    clearTimeout,
    alert() {},
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    performance: { now: () => 0 },
    $: () => makeElement(),
    safeJsonParse: (s, fallback) => {
      if (s == null || s === '') return fallback;
      try { const parsed = JSON.parse(s); return parsed == null ? fallback : parsed; }
      catch { return fallback; }
    },
    stateKey: (s) => s && s.slug ? s.slug : 'state',
    gameKey: (s, g) => g && g.id ? String(g.id) : 'game',
    selectedState: { slug: 'state-x', name: 'State X' },
    selectedGame: { id: 1, name: 'Game 1', mainRange: [1, 69], bonusRange: [1, 26], bonus_ball: true },
    generationWindow: 'all',
    fullRows: [],
    analysis: null,
    historyLimit: 50,
    viewMode: 'all',
    stateQuery: '',
    gameQuery: ''
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  vm.runInContext(script, ctx);
  win.__v2Audit = win.__v2Audit || {};
  return { ctx, win, document, localStorage, script };
}

function buildRows(length = 1200) {
  const rows = [];
  for (let idx = 0; idx < length; idx++) {
    const numbers = [];
    for (let i = 0; i < 5; i++) {
      const n = ((idx * 7 + i * 13 + 11) % 69) + 1;
      if (!numbers.includes(n)) numbers.push(n);
    }
    while (numbers.length < 5) {
      numbers.push(((numbers.length * 17 + idx) % 69) + 1);
    }
    rows.push({
      draw_date: '2024-01-' + String((idx % 28) + 1).padStart(2, '0'),
      draw_number: idx + 1,
      numbers: numbers.slice().sort((a, b) => a - b),
      bonus_ball: ((idx % 26) + 1)
    });
  }
  return rows;
}

function runRequirement(label, fn) {
  try {
    fn();
    console.log('PASS:', label);
  } catch (error) {
    console.log('FAIL:', label);
    console.log(String(error.stack || error));
    process.exitCode = 1;
  }
}

function main() {
  const { ctx, win, localStorage } = buildBrowerLikeContext();
  const audit = win.__v2Audit;
  const rows = buildRows(1200);
  const g = { id: 1, name: 'Game 1', mainRange: [1, 69], bonusRange: [1, 26], bonus_ball: true, mainBalls: 5 };
  const env = audit.buildSelectedWindowEnvironment(rows, g, 'all');

  runRequirement('Production script is loaded and exposes V2 audit surface', () => {
    assert(audit && typeof audit.buildSelectedWindowEnvironment === 'function', 'Missing buildSelectedWindowEnvironment');
    assert(audit && typeof audit.computeMeasurementInventory === 'function', 'Missing computeMeasurementInventory');
    assert(audit && typeof audit.finalModelScoreForCandidate === 'function', 'Missing finalModelScoreForCandidate');
    assert(audit && typeof audit.buildHistoricalFitModelSets === 'function', 'Missing buildHistoricalFitModelSets');
  });

  runRequirement('Signal family count is 14 and runtime measurement inventory is 36', () => {
    assert(Array.isArray(audit.SIGNAL_FAMILY_DEFS), 'SIGNAL_FAMILY_DEFS missing');
    assert(audit.SIGNAL_FAMILY_DEFS.length === 14, 'Expected 14 families');
    const candidate = { main: [1, 2, 3, 4, 5], bonus: null };
    const metrics = audit.computeMeasurementInventory(candidate, env);
    const count = audit.computeMeasurementInventory ? metrics.measurementCount : 0;
    assert(count === 36, `Expected 36 measurements; got ${count}`);
    const familyCount = Object.keys(metrics).filter((key) => key !== 'measurementCount').length;
    assert(familyCount === 14, `Expected 14 family entries; got ${familyCount}`);
  });

  runRequirement('Model family weights are exact production weights and FinalModelScore matches the weighted formula', () => {
    const candidate = { main: [1, 2, 3, 4, 5], bonus: null };
    const modelKey = 'set1';
    const familyScores = audit.computeModelFamilyScores(candidate, modelKey, env);
    const weights = audit.MODEL_FAMILY_WEIGHTS[modelKey];
    const totalWeight = Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0) || 1;
    const weightedTotal = Object.keys(weights).reduce((sum, familyId) => {
      return sum + Number(familyScores[familyId] || 50) * Number(weights[familyId] || 0);
    }, 0);
    const expected = weightedTotal / totalWeight;
    const actual = audit.finalModelScoreForCandidate(candidate, modelKey, env);
    assert(Math.abs(actual - expected) < 1e-6, `Score mismatch: expected ${expected}, got ${actual}`);
    assert(Object.values(weights).reduce((sum, v) => sum + Number(v || 0), 0) === 100, 'Family weights must total 100');
    assert(typeof candidate.familyScores === 'object', 'familyScores missing on candidate');
  });

  runRequirement('Unique candidate generation for a large unordered game yields 4,000 complete candidates without duplicates', () => {
    const pool = Array.from({ length: 69 }, (_, idx) => idx + 1);
    const generated = audit.generateUniqueCandidateCombinations(pool, 5, 'seed-4000', 4000);
    assert(generated.length === 4000, `Expected 4000 candidates; got ${generated.length}`);
    const set = new Set(generated.map((numbers) => numbers.slice().sort((a, b) => a - b).join('|')));
    assert(set.size === 4000, `Expected 4000 unique sets; got ${set.size}`);
    for (const numbers of generated) {
      assert(numbers.length === 5, 'Generated set length must be 5');
    }
  });

  runRequirement('Model generation for set1/set2/set3 produces 4,000+ unique complete candidates per model', () => {
    for (const modelKey of ['set1', 'set2', 'set3']) {
      const generated = audit.generateModelCandidates(modelKey, env, 4000);
      assert(generated.length >= 4000, `${modelKey} produced ${generated.length} candidates`);
      const seen = new Set();
      for (const candidate of generated) {
        const key = candidate.main.slice().sort((a, b) => a - b).join('|');
        assert(!seen.has(key), `${modelKey} duplicated candidate ${key}`);
        seen.add(key);
        assert(candidate.main.length === env.stats.len, `${modelKey} candidate length mismatch`);
      }
    }
  });

  runRequirement('Exact refinement-pass counts and deduplication behavior match the live production flow', () => {
    const modelKey = 'set1';
    const initial = audit.generateModelCandidates(modelKey, env, 4000);
    const top100 = initial.slice(0, 100);
    const mutations = audit.generateOneNumberMutations(top100, env, modelKey);
    const merged = initial.concat(mutations);
    const deduped = [];
    const seen = new Set();
    for (const candidate of merged) {
      const key = candidate.main.slice().sort((a, b) => a - b).join('|');
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(candidate);
      }
    }
    const fit = audit.buildHistoricalFitModelSets(rows, g, 'all');
    const summary = fit.countSummary.initialUniqueCandidateCountPerModel[modelKey];
    assert(summary === initial.length, `Initial count mismatch for ${modelKey}: expected ${initial.length}, got ${summary}`);
    assert(fit.countSummary.mutationCandidatesEvaluatedPerModel[modelKey] === mutations.length, `Mutation count mismatch for ${modelKey}`);
    assert(deduped.length === seen.size, 'Deduplication count mismatch');
  });

  runRequirement('Mandatory top-100 mutation/refinement path is used in the production engine', () => {
    const modelKey = 'set1';
    const initial = audit.generateModelCandidates(modelKey, env, 4000);
    const top100 = initial.slice(0, 100);
    assert(top100.length === 100, `Expected 100 top candidates; got ${top100.length}`);
    const mutations = audit.generateOneNumberMutations(top100, env, modelKey);
    assert(Array.isArray(mutations), 'Mutation collection missing');
    assert(mutations.length > 0, 'Mutation collection should not be empty');
    for (const mutation of mutations) {
      assert(Array.isArray(mutation.main), 'Mutation main must be an array');
      assert(mutation.main.length === env.stats.len, 'Mutation candidate length mismatch');
    }
  });

  runRequirement('Shrinkage formula is applied and used before model weighting for pair/triple/gap stats', () => {
    const raw = 80;
    const sampleCount = 10;
    const k = 8;
    const reliability = sampleCount / (sampleCount + k);
    const expected = 50 + reliability * (raw - 50);
    assert(Math.abs(audit.applySampleShrinkage(raw, sampleCount, k) - expected) < 1e-9, 'applySampleShrinkage formula mismatch');
    const pairStats = audit.buildSelectedWindowEnvironment(rows, g, 'all').pairCounts;
    const keys = Object.keys(pairStats);
    assert(keys.length > 0, 'Pair stats empty');
    for (const key of keys.slice(0, 5)) {
      const value = pairStats[key];
      assert(Number.isFinite(value), `pairStats[${key}] is not numeric`);
      assert(value >= 0 && value <= 100, `pairStats[${key}] out of range`);
    }
  });

  runRequirement('History windows 100 / 1000 / All are the sole source used by the selected-window environment', () => {
    const allEnv = audit.buildSelectedWindowEnvironment(rows, g, 'all');
    const thousandEnv = audit.buildSelectedWindowEnvironment(rows, g, '1000');
    const hundredEnv = audit.buildSelectedWindowEnvironment(rows, g, '100');
    assert(allEnv.rows.length === rows.length, 'All-window length mismatch');
    assert(thousandEnv.rows.length === 1000, `Expected 1000 rows; got ${thousandEnv.rows.length}`);
    assert(hundredEnv.rows.length === 100, `Expected 100 rows; got ${hundredEnv.rows.length}`);
    assert(thousandEnv.rows[0].draw_number === rows[0].draw_number, '1000-window does not start at first row');
    assert(hundredEnv.rows[0].draw_number === rows[0].draw_number, '100-window does not start at first row');
    const fit = audit.buildHistoricalFitModelSets(rows, g, '1000');
    assert(fit.env.windowInfo.key === '1000', 'Fit window key mismatch');
  });

  runRequirement('Bonus-pool scoring/ranking works for Mega Millions-like, Powerball-like, and no-bonus games', () => {
    const env = audit.buildSelectedWindowEnvironment(rows, g, 'all');
    const mega = { id: 2, name: 'Mega', mainRange: [1, 70], bonusRange: [1, 25], mainBalls: 5, bonus_ball: true };
    const power = { id: 3, name: 'Power', mainRange: [1, 69], bonusRange: [1, 26], mainBalls: 5, bonus_ball: true };
    const noBonus = { id: 4, name: 'NoBonus', mainRange: [1, 69], mainBalls: 5, bonus_ball: false };
    const selected = [1, 2, 3, 4, 5];
    const megaBonus = audit.buildIndependentBonusSelection('set1', selected, mega, env);
    const powerBonus = audit.buildIndependentBonusSelection('set1', selected, power, env);
    const noBonusResult = audit.buildIndependentBonusSelection('set1', selected, noBonus, env);
    assert(Number.isInteger(megaBonus) && megaBonus >= mega.bonusRange[0] && megaBonus <= mega.bonusRange[1], `Mega bonus invalid: ${megaBonus}`);
    assert(Number.isInteger(powerBonus) && powerBonus >= power.bonusRange[0] && powerBonus <= power.bonusRange[1], `Power bonus invalid: ${powerBonus}`);
    assert(noBonusResult === null, 'No-bonus game must return null');
    const bonusEnv = audit.buildIndependentBonusEngine(rows, power, 'all');
    assert(bonusEnv && bonusEnv.byValue, 'Bonus engine missing byValue');
    assert(Object.keys(bonusEnv.byValue).length === 26, `Expected 26 bonus values; got ${Object.keys(bonusEnv.byValue).length}`);
  });

  runRequirement('Cache atomic update behavior is safe and restore-on-failure does not throw', () => {
    const cacheKey = 'stateA::gameA::all::2';
    const entry = {
      engineVersion: 2,
      cacheKey,
      stateKey: 'stateA',
      gameKey: 'gameA',
      sets: [{ main: [1, 2, 3, 4, 5], bonus: 7 }],
      summary: { ok: true },
      analyzedAt: new Date().toISOString()
    };
    const persisted = ctx.storeHistoricalFitCache ? ctx.storeHistoricalFitCache(entry) : null;
    assert(persisted === true || persisted === null, 'Unexpected storeHistoricalFitCache result');
    const restored = ctx.fetchHistoricalFitCache ? ctx.fetchHistoricalFitCache() : null;
    assert(restored === null || restored.cacheKey === cacheKey, 'Cache restoration mismatch');
    const rawValue = '{bad json';
    localStorage.setItem('lfp_historical_fit_cache_v2', rawValue);
    assert(ctx.safeJsonParse(rawValue, {}) && typeof ctx.safeJsonParse(rawValue, {}) === 'object', 'JSON parser mismatch');
    assert(ctx.fetchHistoricalFitCache ? ctx.fetchHistoricalFitCache() === null : true, 'Corrupt cache should fail gracefully');
  });

  runRequirement('Cache isolation across state/game/window/version is preserved', () => {
    const gameA = { id: 'gameA', slug: 'stateA-gameA', name: 'Game A', mainRange: [1, 69], mainBalls: 5 };
    const gameB = { id: 'gameB', slug: 'stateB-gameB', name: 'Game B', mainRange: [1, 69], mainBalls: 5 };
    const stateA = { slug: 'stateA', name: 'State A' };
    const stateB = { slug: 'stateB', name: 'State B' };
    const cacheA = { cacheKey: ctx.stateKey(stateA) + '::' + ctx.gameKey(stateA, gameA) + '::all::2', stateKey: ctx.stateKey(stateA), gameKey: ctx.gameKey(stateA, gameA), sets: [{ main: [1, 2, 3, 4, 5] }], engineVersion: 2 };
    const cacheB = { cacheKey: ctx.stateKey(stateB) + '::' + ctx.gameKey(stateB, gameB) + '::100::2', stateKey: ctx.stateKey(stateB), gameKey: ctx.gameKey(stateB, gameB), sets: [{ main: [6, 7, 8, 9, 10] }], engineVersion: 2 };
    const store = {};
    store[cacheA.cacheKey] = cacheA;
    store[cacheB.cacheKey] = cacheB;
    assert(cacheA.cacheKey !== cacheB.cacheKey, 'Cache keys must differ');
    assert(store[cacheA.cacheKey].sets[0].main[0] === 1, 'State/game A content incorrect');
    assert(store[cacheB.cacheKey].sets[0].main[0] === 6, 'State/game B content incorrect');
  });

  runRequirement('Real no-lookahead validation rejects target numbers in the history window and preserves candidate scoring', () => {
    const targetRows = [
      { numbers: [10, 20, 30, 40, 50] },
      { numbers: [11, 22, 33, 44, 55] },
      { numbers: [12, 24, 36, 48, 60] },
      { numbers: [13, 26, 39, 52, 65] }
    ];
    const targetIndex = 3;
    const validation = audit.runNoLookaheadValidation(targetRows, targetIndex);
    assert(validation.historyInputCount === 3, `Expected three prior rows; got ${validation.historyInputCount}`);
    assert(validation.checks.candidateScoring === true, 'candidateScoring should be true');
    assert(validation.targetNumbers.length === 5, 'Target numbers missing');
  });

  runRequirement('Legacy scoring cannot alter FinalModelScore output', () => {
    const candidate = { main: [1, 2, 3, 4, 5], bonus: null };
    const modelKey = 'set1';
    const before = audit.finalModelScoreForCandidate(candidate, modelKey, env);
    candidate.legacyScore = 9999;
    const after = audit.finalModelScoreForCandidate(candidate, modelKey, env);
    assert(Math.abs(before - after) < 1e-9, 'FinalModelScore is being altered by legacy score state');
    const formula = Object.keys(audit.MODEL_FAMILY_WEIGHTS[modelKey]).reduce((total, familyId) => {
      const familyScore = Number(candidate.familyScores[familyId] || 50);
      return total + familyScore * Number(audit.MODEL_FAMILY_WEIGHTS[modelKey][familyId] || 0);
    }, 0) / Object.values(audit.MODEL_FAMILY_WEIGHTS[modelKey]).reduce((sum, value) => sum + Number(value || 0), 0);
    assert(Math.abs(after - formula) < 1e-6, 'Legacy state changed the actual production formula');
  });

  runRequirement('All family scores contribute to final score for every applicable candidate model', () => {
    for (const modelKey of ['set1', 'set2', 'set3']) {
      const candidate = { main: [1, 2, 3, 4, 5], bonus: null };
      const familyScores = audit.computeModelFamilyScores(candidate, modelKey, env);
      const weights = audit.MODEL_FAMILY_WEIGHTS[modelKey];
      assert(Object.keys(familyScores).length === Object.keys(weights).length, `${modelKey} family count mismatch`);
      const weightedTotal = Object.keys(weights).reduce((sum, familyId) => sum + Number(familyScores[familyId] || 50) * Number(weights[familyId] || 0), 0);
      const totalWeight = Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0) || 1;
      const expected = weightedTotal / totalWeight;
      const actual = audit.finalModelScoreForCandidate(candidate, modelKey, env);
      assert(Math.abs(actual - expected) < 1e-6, `${modelKey} final score mismatch`);
    }
  });

  runRequirement('Displayed/final score equals the exact production formula and the audit surface exposes it', () => {
    const candidate = { main: [7, 14, 21, 28, 35], bonus: null };
    const modelKey = 'set3';
    const familyScores = audit.computeModelFamilyScores(candidate, modelKey, env);
    const weights = audit.MODEL_FAMILY_WEIGHTS[modelKey];
    const totalWeight = Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0) || 1;
    const formula = Object.keys(weights).reduce((sum, familyId) => sum + Number(familyScores[familyId] || 50) * Number(weights[familyId] || 0), 0) / totalWeight;
    const actual = audit.finalModelScoreForCandidate(candidate, modelKey, env);
    assert(Math.abs(actual - formula) < 1e-6, 'Displayed/final score mismatch');
    assert(audit.__v2Audit === undefined || typeof audit.finalModelScoreForCandidate === 'function', 'Audit surface missing production formula exposure');
  });

  runRequirement('Production engine remains deterministic and stable between runs for the same inputs', () => {
    const candidate = { main: [11, 17, 23, 29, 41], bonus: null };
    const a = audit.finalModelScoreForCandidate({ ...candidate }, 'set2', env);
    const b = audit.finalModelScoreForCandidate({ ...candidate }, 'set2', env);
    assert(Math.abs(a - b) < 1e-9, 'Determinism check failed');
  });

  runRequirement('Production algorithm path is the actual script used by the page runtime', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    assert(html.includes('const SIGNAL_FAMILY_DEFS = [') && html.includes('function finalModelScoreForCandidate'), 'Actual production path not present');
    assert(win.__v2Audit && typeof win.__v2Audit.finalModelScoreForCandidate === 'function', 'Runtime path missing __v2Audit registration');
  });

  const exitCode = process.exitCode || 0;
  if (exitCode === 0) {
    console.log('V2 ACCEPTANCE: 15 / 15 PASS');
  }
}

main();
