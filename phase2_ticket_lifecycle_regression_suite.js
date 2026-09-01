const { loadProductionRuntime } = require('./v2_test_runtime');

function assert(condition, message) { if (!condition) throw new Error(message); }
function run(label, test) { try { test(); console.log('PASS:', label); } catch (error) { console.error('FAIL:', label, error.message); process.exitCode = 1; } }

const { context, audit } = loadProductionRuntime();
const game = { id: 'mega', name: 'Mega', mainRange: [1, 70], bonusRange: [1, 25], mainBalls: 5, bonusBalls: 1 };
const state = { slug: 'state-x', name: 'State X' };

run('Saved Picks migrate legacy records while preserving label and notes fields', () => {
  context.localStorage.setItem('lfp_saved_sets_v3', JSON.stringify([{ at: '2025-01-01T00:00:00.000Z', state: 'State X', game: 'Mega', sets: [{ main: [1, 2, 3, 4, 5], bonus: 6 }, null] }]));
  const migrated = audit.savedSets();
  assert(migrated.length === 1 && migrated[0].pickId && migrated[0].sets[0].bonus === 6, 'legacy saved pick was not migrated');
  assert(typeof migrated[0].label === 'string' && typeof migrated[0].notes === 'string', 'migrated metadata fields missing');
  assert(audit.savedSets()[0].pickId === migrated[0].pickId, 'migration was not idempotent');
});

run('Played tickets retain stable identity and generated/saved/manual sources stay distinct', () => {
  audit.storePlayedTickets([]);
  const generated = audit.createPlayedTicket({ stateId: 'state-x', gameId: 'state-x::mega', state: 'State X', game: 'Mega', mainNumbers: [1, 2, 3, 4, 5], bonusNumber: 6, source: 'generated', cost: 2, intendedDrawDate: '2025-01-10' });
  const saved = audit.createPlayedTicket({ stateId: 'state-x', gameId: 'state-x::mega', state: 'State X', game: 'Mega', mainNumbers: [6, 7, 8, 9, 10], bonusNumber: 1, source: 'saved', cost: 3 });
  const manual = audit.createPlayedTicket({ stateId: 'state-x', gameId: 'state-x::mega', state: 'State X', game: 'Mega', mainNumbers: [11, 12, 13, 14, 15], source: 'manual', cost: 1 });
  assert(generated.ticketId !== saved.ticketId && saved.ticketId !== manual.ticketId, 'ticket IDs are not stable/unique');
  assert(audit.playedTickets().map((ticket) => ticket.source).sort().join(',') === 'generated,manual,saved', 'ticket sources were not retained');
});

run('Checking separates main and bonus, rejects wrong draws, and is idempotent', () => {
  const ticket = audit.playedTickets().find((entry) => entry.source === 'generated');
  const wrong = { draw_id: 'wrong', draw_date: '2025-01-09', numbers: [1, 2, 3, 4, 5], bonus_ball: 6 };
  assert(audit.ticketResultMatch(ticket, wrong) === null, 'ticket matched the wrong draw');
  const result = { draw_id: 'right', draw_date: '2025-01-10', numbers: [1, 2, 3, 4, 20], bonus_ball: 6 };
  const checked = audit.checkPlayedTicket(ticket, result);
  assert(checked.matchedMain === 4 && checked.bonusMatch === true && checked.winnings === null, 'main/bonus or unavailable-prize behavior is incorrect');
  const repeated = audit.checkPlayedTicket(checked, result);
  assert(JSON.stringify(checked) === JSON.stringify(repeated), 'repeated checking changed an already checked ticket');
  const unassigned = audit.playedTickets().find((entry) => entry.source === 'manual');
  assert(audit.ticketResultMatch(unassigned, result) === null, 'unassigned ticket was checked against an unrelated result');
  const corrected = audit.checkPlayedTicket(checked, { draw_id: 'corrected', draw_date: '2025-01-10', numbers: [1, 2, 3, 4, 20], bonus_ball: 7 });
  assert(corrected.resultIdentity === 'corrected' && corrected.bonusMatch === false, 'corrected provider result did not replace prior result identity');
});

run('Financial totals derive from tickets and unresolved scheduler query remains isolated', () => {
  const tickets = audit.playedTickets();
  const totals = audit.ticketFinancialTotals(tickets);
  assert(totals.spent === 6 && totals.won === 0 && totals.net === -6, 'financial totals are not ticket-derived');
  const unresolved = audit.unresolvedTicketGameKeys(tickets);
  assert(unresolved.length === 1 && unresolved[0].includes('state-x'), 'unresolved ticket game query is not isolated');
  const crossGame = audit.createPlayedTicket({ stateId: 'other', gameId: 'other::mega', state: 'Other', game: 'Mega', mainNumbers: [1, 2, 3, 4, 5], cost: 4, intendedDrawDate: '2025-01-10' });
  const before = audit.playedTickets().find((ticket) => ticket.ticketId === crossGame.ticketId);
  const after = audit.checkAvailablePlayedTickets([{ draw_id: 'right', draw_date: '2025-01-10', numbers: [1, 2, 3, 4, 5], bonus_ball: 6 }], 'state-x', 'state-x::mega').find((ticket) => ticket.ticketId === crossGame.ticketId);
  assert(after.status === before.status, 'cross-game ticket was checked using selected-game results');
});

if (!process.exitCode) console.log('PHASE 2 TICKETS: 4 / 4 PASS');