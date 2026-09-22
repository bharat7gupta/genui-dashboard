import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDataStore } from '../server/data.mjs';
import { compileDashboard, validateProgram } from '../server/generation.mjs';

test('calendar averages account for unequal day counts, zero-sales days, filters and coverage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sales-calendar-'));
  let store;
  try {
    const csv = path.join(dir, 'sales.csv');
    await writeFile(csv, 'order_date,sale_price,order_status,country,order_id,user_id\n2025-01-06,60,Complete,US,1,1\n2025-01-06,40,Complete,France,1,1\n2025-01-11,70,Complete,US,2,2\n2025-01-13,200,Cancelled,US,3,3\n');
    store = await createDataStore(csv);
    const spec = { title: 'Average daily sales', kind: 'bar', dimension: 'day_of_week', metric: 'average_daily_revenue', limit: 7 };
    const filters = { status: 'Complete', country: 'all' };
    const result = await store.chart(spec, filters);
    assert.equal(result.rows.length, 7);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.rows.find(r => r.label === 'Monday'), { label: 'Monday', value: 50, days: 2, total: 100 });
    assert.equal(result.rows.find(r => r.label === 'Sunday').value, 0);
    assert.equal(result.rows[0].value, 0);
    const typeSpec = { ...spec, dimension: 'day_type', limit: 2 };
    const types = await store.chart(typeSpec, filters);
    assert.deepEqual(types.rows, [{ label: 'Weekday', value: 100 / 6, days: 6, total: 100 }, { label: 'Weekend', value: 35, days: 2, total: 70 }]);
    const us = await store.chart(typeSpec, { ...filters, country: 'US' });
    assert.equal(us.rows.find(r => r.label === 'Weekday').value, 10);
    const narrow = await store.chart(spec, { ...filters, start: '2025-01-06', end: '2025-01-06' });
    assert.deepEqual(narrow.rows, [{ label: 'Monday', value: 100, days: 1, total: 100 }]);
    const extended = await store.chart(spec, { ...filters, start: '2024-01-01', end: '2026-01-01' });
    assert.deepEqual(extended.rows, result.rows);
    const outside = await store.chart(spec, { ...filters, start: '2026-01-01', end: '2026-01-02' });
    assert.deepEqual(outside.rows, []);
    const noSales = await store.chart(spec, { ...filters, country: 'Unknown' });
    assert.ok(noSales.rows.every(r => r.value === 0));
    const dashboard = compileDashboard({ title: 'Calendar comparison', charts: [spec, typeSpec] });
    assert.deepEqual(validateProgram(dashboard.program), dashboard);
    assert.throws(() => compileDashboard({ title: 'Invalid average', charts: [{ ...spec, dimension: 'country' }] }));
  } finally { store?.close(); await rm(dir, { recursive: true, force: true }); }
});
