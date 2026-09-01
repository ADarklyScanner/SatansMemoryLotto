const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.join(__dirname, 'app', 'src', 'main', 'assets', 'index.html');

function makeElement() {
  return { style: {}, classList: { add() {}, remove() {}, contains() { return false; }, toggle() { return true; } }, addEventListener() {}, appendChild() {}, setAttribute() {}, value: '', innerHTML: '', textContent: '', checked: false, disabled: false, dataset: {}, children: [], querySelector() { return makeElement(); }, querySelectorAll() { return []; }, focus() {}, scrollIntoView() {} };
}

function loadProductionRuntime() {
  const document = { body: makeElement(), documentElement: makeElement(), getElementById: () => makeElement(), querySelector: () => makeElement(), querySelectorAll: () => [], createElement: () => makeElement(), addEventListener() {} };
  const localStorage = { data: {}, getItem(key) { return this.data[key] || null; }, setItem(key, value) { this.data[key] = String(value); } };
  const window = { document, localStorage, navigator: { userAgent: 'node' }, location: { href: 'http://localhost' }, addEventListener() {}, setTimeout, clearTimeout, requestAnimationFrame(callback) { callback(); } };
  const context = { console, document, window, localStorage, navigator: window.navigator, setTimeout, clearTimeout, performance: { now: () => Date.now() }, fetch: async () => ({ ok: true, json: async () => ({}) }), alert() {} };
  context.globalThis = context;
  vm.createContext(context);
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n');
  vm.runInContext(script, context);
  return { context, audit: window.__v2Audit };
}

function buildFixtureRows(length = 180) {
  return Array.from({ length }, (_, index) => ({
    draw_id: 'fixture-' + index,
    draw_number: 9000 - index,
    draw_date: '2025-' + String(12 - Math.floor(index / 28)).padStart(2, '0') + '-' + String(28 - (index % 28)).padStart(2, '0'),
    numbers: Array.from({ length: 5 }, (_, offset) => ((index * 11 + offset * 17 + 3) % 70) + 1).sort((a, b) => a - b),
    bonus_ball: ((index * 7 + 4) % 25) + 1
  }));
}

const FIXTURE_GAME = { id: 'mega_fixture', name: 'Mega Fixture', mainRange: [1, 70], bonusRange: [1, 25], mainBalls: 5, bonusBalls: 1 };
function serializableSets(fit) { return fit.sets.map((set) => ({ modelKey: set.modelKey, main: set.main, bonus: set.bonus, FinalModelScore: set.FinalModelScore, familyScores: set.familyScores })); }

module.exports = { loadProductionRuntime, buildFixtureRows, FIXTURE_GAME, serializableSets };