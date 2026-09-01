const { loadProductionRuntime, buildFixtureRows, FIXTURE_GAME, serializableSets } = require('./v2_test_runtime');

async function main() {
  const { audit } = loadProductionRuntime();
  const events = [];
  const rows = buildFixtureRows();
  const result = await audit.buildHistoricalFitModelSetsWithProgress(rows, FIXTURE_GAME, 'all', (event) => events.push(event));
  const percents = events.map((event) => event.percent);
  if (!events.length || events[0].label !== 'Preparing historical statistics…') throw new Error('V2 progress did not start at historical-statistics preparation');
  if (events[events.length - 1].label !== 'Analysis complete' || percents[percents.length - 1] !== 100) throw new Error('Fresh V2 analysis did not finish at Analysis complete / 100%');
  if (percents.some((percent, index) => index > 0 && percent < percents[index - 1])) throw new Error('V2 progress regressed between stages');
  for (const stage of ['Generating candidate combinations…', 'Scoring candidate combinations…', 'Refining top candidates…', 'Ranking final sets…', 'Analyzing bonus pool…', 'Saving analysis…']) {
    if (!events.some((event) => event.label === stage)) throw new Error('Missing V2 progress stage: ' + stage);
  }
  const direct = serializableSets(audit.buildHistoricalFitModelSets(rows, FIXTURE_GAME, 'all'));
  if (JSON.stringify(serializableSets(result)) !== JSON.stringify(direct)) throw new Error('Progress yielding changed deterministic V2 output');
  console.log('V2 PROGRESS: ' + events.length + ' EVENTS / PASS');
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });