import test from 'node:test';
import assert from 'node:assert/strict';
import { compileDashboard, validateProgram, generateDashboard } from '../server/generation.mjs';

const dashboard = { title: 'Monthly customers', charts: [{ title: 'Purchasing customers', kind: 'line', dimension: 'month', metric: 'customers', limit: 90 }] };

test('structured dashboard round trips through the real OpenUI parser, including escaped titles', () => {
  const input = structuredClone(dashboard);
  input.title = 'Customers "by month"\n2025';
  input.charts[0].title = 'A \\ B, [chart]';
  const compiled = compileDashboard(input);
  assert.deepEqual(validateProgram(compiled.program), compiled);
});

test('rejects unsupported metrics, invalid limits, invented data, and empty dashboards', () => {
  for (const change of [{ metric: 'profit' }, { limit: 1000 }, { dimension: ['month'] }, { data: [123] }]) {
    assert.throws(() => compileDashboard({ ...dashboard, charts: [{ ...dashboard.charts[0], ...change }] }));
  }
  assert.throws(() => compileDashboard({ title: 'Empty', charts: [] }));
});

test('sends schema-constrained JSON, disables Qwen thinking, and preserves edit context', async t => {
  let request;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    request = JSON.parse(options.body);
    return Response.json({ message: { content: JSON.stringify(dashboard) } });
  });
  const result = await generateDashboard({ prompt: 'Change that to a line chart', current: compileDashboard(dashboard).program, filters: { status: 'Complete', country: 'all' }, base: 'http://localhost:11434', model: 'qwen3.5:4b' });
  assert.equal(request.think, false);
  assert.equal(request.format.anyOf[0].type, 'object');
  assert.equal(request.format.anyOf[0].properties.charts.items.properties.metric.enum.includes('customers'), true);
  assert.match(request.messages[1].content, /Purchasing customers/);
  assert.deepEqual(result.charts, dashboard.charts);
  assert.equal(result.model, 'qwen3.5:4b');
});

test('retries a malformed response once and validates the correction', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: { content: ++calls === 1 ? '{broken' : JSON.stringify(dashboard) } }));
  const result = await generateDashboard({ prompt: 'Monthly customers', filters: {}, base: 'http://localhost:11434', model: 'qwen3.5:4b' });
  assert.equal(calls, 2);
  assert.equal(result.charts[0].metric, 'customers');
});

test('fails explicitly after two invalid responses instead of returning a fabricated dashboard', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ message: { content: '{}' } }); });
  await assert.rejects(generateDashboard({ prompt: 'Monthly customers', filters: {}, base: 'http://localhost:11434', model: 'qwen3.5:4b' }), /current dashboard is unchanged/);
  assert.equal(calls, 2);
});

test('unsupported questions return an explanation without a program or retry', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ message: { content: JSON.stringify({ unsupported: 'There are no timestamps in this CSV. Your dashboard is unchanged.' }) } });
  });
  const result = await generateDashboard({ prompt: 'At what time of day do we have most sales?', current: compileDashboard(dashboard).program, filters: {}, base: 'http://localhost:11434', model: 'qwen3.5:4b' });
  assert.match(result.unsupported, /timestamps/);
  assert.equal(result.program, undefined);
  assert.equal(calls, 1);
});

test('blocks a schema-valid weekday chart mislabeled as hourly sales', async t => {
  const misleading = { title: 'Sales by hour of day', charts: [{ ...dashboard.charts[0], title: 'Sales by hour', dimension: 'day_of_week', metric: 'revenue' }] };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: { content: JSON.stringify(misleading) } }));
  const result = await generateDashboard({ prompt: 'Peak sales times?', filters: {}, base: 'http://localhost:11434', model: 'qwen3.5:4b' });
  assert.match(result.unsupported, /no order time/);
  assert.equal(result.program, undefined);
});
