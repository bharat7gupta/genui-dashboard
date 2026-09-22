import { DuckDBInstance } from '@duckdb/node-api';
import { z } from 'zod/v4';
import { chartSchema } from '../shared/library.mjs';

export const filterSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['Complete', 'Shipped', 'Processing', 'Cancelled', 'Returned', 'all']).default('Complete'),
  country: z.string().max(100).default('all'),
}).refine(f => !f.start || !f.end || f.start <= f.end, 'Start date must be before end date');

const dimensionSql = {
  day: "strftime(order_date, '%Y-%m-%d')",
  week: "strftime(date_trunc('week', order_date), '%Y-%m-%d')",
  month: "strftime(order_date, '%Y-%m')",
  country: 'country', category: 'category', brand: "coalesce(nullif(brand, ''), 'Unknown')",
  product_name: 'product_name', order_status: 'order_status',
};
const metricSql = {
  revenue: 'sum(sale_price)', orders: 'count(distinct order_id)', items: 'count(*)',
  customers: 'count(distinct user_id)', average_order_value: 'sum(sale_price) / nullif(count(distinct order_id), 0)',
};

export async function createDataStore(csvPath) {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  // Only this fixed, server-owned path can be read. No model SQL is executed.
  const file = csvPath.replaceAll("'", "''");
  await connection.run(`CREATE TABLE sales AS SELECT * REPLACE (CAST(order_date AS DATE) AS order_date, CAST(sale_price AS DECIMAL(18, 4)) AS sale_price) FROM read_csv_auto('${file}')`);
  const query = async (sql, params = []) => {
    const reader = await connection.runAndReadAll(sql, params);
    return JSON.parse(JSON.stringify(reader.getRowObjects(), (_, v) => typeof v === 'bigint' ? Number(v) : v));
  };
  function where(input) {
    const f = filterSchema.parse(input || {});
    const clauses = [], params = [];
    if (f.start) { clauses.push('order_date >= ?::DATE'); params.push(f.start); }
    if (f.end) { clauses.push('order_date <= ?::DATE'); params.push(f.end); }
    if (f.status !== 'all') { clauses.push('order_status = ?'); params.push(f.status); }
    if (f.country !== 'all') { clauses.push('country = ?'); params.push(f.country); }
    return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }
  return {
    async metadata() {
      const [meta] = await query("SELECT count(*) AS items, count(distinct order_id) AS orders, strftime(min(order_date), '%Y-%m-%d') AS start, strftime(max(order_date), '%Y-%m-%d') AS end FROM sales");
      return { ...meta, countries: (await query('SELECT DISTINCT country FROM sales ORDER BY country')).map(r => r.country) };
    },
    async summary(filters) {
      const w = where(filters);
      const [row] = await query(`SELECT coalesce(sum(sale_price)::DOUBLE, 0) AS revenue, count(distinct order_id) AS orders, count(*) AS items, count(distinct user_id) AS customers, coalesce((sum(sale_price) / nullif(count(distinct order_id), 0))::DOUBLE, 0) AS average_order_value FROM sales ${w.sql}`, w.params);
      return row;
    },
    async chart(input, filters) {
      const spec = chartSchema.parse(input);
      const w = where(filters);
      const chronological = ['day', 'week', 'month'].includes(spec.dimension);
      const order = chronological ? 'label ASC' : 'value DESC, label ASC';
      const rows = await query(`SELECT ${dimensionSql[spec.dimension]} AS label, (${metricSql[spec.metric]})::DOUBLE AS value FROM sales ${w.sql} GROUP BY 1 ORDER BY ${order} LIMIT ${spec.limit}`, w.params);
      return { rows, truncated: rows.length === spec.limit };
    },
    close() { connection.closeSync(); instance.closeSync(); },
  };
}
