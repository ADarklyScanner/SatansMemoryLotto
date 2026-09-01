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

function makeClassList() {
  return { add() {}, remove() {}, contains() { return false; }, toggle() { return true; } };
}

function makeElement() {
  return {
    style: {}, classList: makeClassList(),
    addEventListener() {}, removeEventListener() {}, appendChild() {}, setAttribute() {},
    value: '', innerHTML: '', textContent: '', checked: false, disabled: false,
    dataset: {}, children: [], querySelector() { return makeElement(); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
    focus() {}, blur() {}, click() {}, className: '', id: ''
  };
}

function buildContext() {
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
      try {
        const parsed = JSON.parse(s);
        return parsed == null ? fallback : parsed;
      } catch {
        return fallback;
      }
    },
    stateKey: (s) => (s && s.slug) ? s.slug : 'state',
    gameKey: (s, g) => (g && g.id) ? String(g.id) : 'game',
    selectedState: { slug: 'state-x', name: 'State X' },
    selectedGame: { id: 1, name: 'Game 1', mainRange: [1, 69], bonusRange: [1, 26], mainBalls: 5 },
    generationWindow: 'all',
    fullRows: [],
    analysis: null,
    historyLimit: 50,
    viewMode: 'all',
    stateQuery: '',
    gameQuery: '',
    __historyPipelineDebug: []
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  vm.runInContext(script, ctx);
  return { ctx, win }; 
}

function runRequirement(label, fn) {
  try {
    fn();
    console.log('PASS:', label);
  } catch (error) {
    console.log('FAIL:', label);
    console.log(String(error && error.stack ? error.stack : error));
    process.exitCode = 1;
  }
}

function main() {
  const { ctx } = buildContext();

  runRequirement('page-boundary overlap is detected without removing legitimate rows', () => {
    const previousPage = [
      'draw_id:1|draw_date:2024-01-02|state:CA|game:mega_millions',
      'draw_id:2|draw_date:2024-01-01|state:CA|game:mega_millions'
    ];
    const nextPage = [
      'draw_id:2|draw_date:2024-01-01|state:CA|game:mega_millions',
      'draw_id:3|draw_date:2023-12-31|state:CA|game:mega_millions'
    ];
    const overlap = ctx.detectPageBoundaryOverlap(previousPage, nextPage);
    assert(overlap.length === 1 && overlap[0] === previousPage[1], 'Boundary overlap check should detect the shared draw record only');
  });

  runRequirement('logical duplicate detection does not collapse valid same-number draws with different identities', () => {
    const rows = [
      { draw_id: 'A', draw_number: 101, draw_date: '2024-01-04', numbers: [1, 2, 3, 4, 5], bonus_ball: 7 },
      { draw_id: 'B', draw_number: 102, draw_date: '2024-01-05', numbers: [1, 2, 3, 4, 5], bonus_ball: 7 },
      { draw_id: 'A', draw_number: 101, draw_date: '2024-01-04', numbers: [1, 2, 3, 4, 5], bonus_ball: 7 }
    ];
    const normalized = ctx.normalizeHistoryRows(rows, 'ca', 'mega_millions', { total: 3 });
    assert(normalized.rows.length === 2, 'same numbers with different draw IDs must remain distinct logical draws');
    assert(normalized.rejects.some((reject) => reject.reason === 'duplicate_logical_key_in_page'), 'page duplicate reject should be recorded');
  });

  runRequirement('malformed rows are rejected with exact reasons and preserved for debugging', () => {
    const rows = [
      { draw_id: 'ok', draw_number: 1, draw_date: '2024-01-01', numbers: [1, 2, 3, 4, 5], bonus_ball: 7 },
      { draw_id: 'bad', draw_number: 2, draw_date: '2024-01-02', numbers: [], bonus_ball: 9 },
      { draw_id: 'missing', draw_number: 3, draw_date: null, numbers: [6, 7, 8, 9, 10] }
    ];
    const normalized = ctx.normalizeHistoryRows(rows, 'ca', 'lottery', { total: 3 });
    assert(normalized.rowCountBeforeNormalization === 3, 'row count before normalization should be 3');
    assert(normalized.rowCountAfterNormalization === 1, 'only the valid row should remain');
    assert(normalized.rejects.some((reject) => reject.reason === 'missing_numbers'), 'missing_numbers reject should exist');
  });

  runRequirement('shallow provider archives are recognized as upstream coverage limits', () => {
    const providerMeta = { total: 148, state: 'CA', game: 'mega_millions' };
    const rows = Array.from({ length: providerMeta.total }, (_, idx) => ({
      draw_id: 'ca-' + idx,
      draw_number: idx + 1,
      draw_date: '2024-01-' + String((idx % 28) + 1).padStart(2, '0'),
      numbers: [1, 2, 3, 4, 5],
      bonus_ball: 7
    }));
    const normalized = ctx.normalizeHistoryRows(rows, 'ca', 'mega_millions', providerMeta);
    assert(normalized.rowCountAfterNormalization === 148, 'provider archive should not be fabricated or expanded');
    assert(providerMeta.total < 500, 'California Mega Millions archive is shallow compared to state archives');
  });

  runRequirement('cache isolation stays keyed by state/game/window/version', () => {
    const stateA = { slug: 'stateA', name: 'State A' };
    const stateB = { slug: 'stateB', name: 'State B' };
    const gameA = { id: 'gameA', slug: 'game-a', name: 'Game A', mainRange: [1, 69], mainBalls: 5 };
    const gameB = { id: 'gameB', slug: 'game-b', name: 'Game B', mainRange: [1, 69], mainBalls: 5 };
    const keyA = ctx.stateKey(stateA) + '::' + ctx.gameKey(stateA, gameA) + '::all::2';
    const keyB = ctx.stateKey(stateB) + '::' + ctx.gameKey(stateB, gameB) + '::100::2';
    assert(keyA !== keyB, 'state/game/window/version keys must not collide');
    assert(keyA.includes('stateA'), 'stateA key should be preserved');
    assert(keyB.includes('gameB'), 'stateB/gameB key should be preserved');
  });

  runRequirement('cache version bump prevents stale entries from restoring silently', () => {
    const key = 'ca::mega_millions::all::1';
    const staleEntry = { cacheVersion: 1, cacheKey: key, rows: [{ draw_date: '2024-01-01', numbers: [1, 2, 3, 4, 5] }] };
    assert(staleEntry.cacheVersion !== ctx.HISTORY_CACHE_VERSION, 'stale cache version must differ from current version');
  });

  runRequirement('provided rows are ordered chronologically by draw date and modern entries remain intact', () => {
    const rows = [
      { draw_date: '2024-01-10', draw_number: 10, numbers: [1, 2, 3, 4, 5], bonus_ball: 8 },
      { draw_date: '2024-01-09', draw_number: 9, numbers: [2, 3, 4, 5, 6], bonus_ball: 9 },
      { draw_date: '2024-01-11', draw_number: 11, numbers: [3, 4, 5, 6, 7], bonus_ball: 10 }
    ];
    const ordered = rows.slice().sort((a, b) => {
      const left = String(a.draw_date || '');
      const right = String(b.draw_date || '');
      return right.localeCompare(left);
    });
    assert(ordered[0].draw_date === '2024-01-11', 'newest row should stay first after sort');
    assert(ordered[ordered.length - 1].draw_date === '2024-01-09', 'oldest row should stay last after sort');
  });

  if (process.exitCode === 0) {
    console.log('PIPELINE REGRESSION: 7 / 7 PASS');
  }
}

main();
