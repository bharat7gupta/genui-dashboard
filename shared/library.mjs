import { createLibrary, defineComponent } from '@openuidev/react-lang';
import { z } from 'zod/v4';

export const dimensions = [
  'day',
  'week',
  'month',
  'day_of_week',
  'day_type',
  'country',
  'category',
  'brand',
  'product_name',
  'order_status',
];
export const metrics = [
  'revenue',
  'orders',
  'items',
  'customers',
  'average_order_value',
  'average_daily_revenue',
];
export const chartSchema = z
  .object({
    title: z.string().min(1).max(100),
    kind: z.enum(['area', 'bar', 'line', 'donut', 'table']),
    dimension: z.enum(dimensions),
    metric: z.enum(metrics),
    limit: z.number().int().min(1).max(90),
  })
  .refine(
    (s) =>
      s.metric !== 'average_daily_revenue' || ['day_of_week', 'day_type'].includes(s.dimension),
    { message: 'average_daily_revenue requires day_of_week or day_type' },
  );

export function createDashboardLibrary(renderers = {}) {
  const Chart = defineComponent({
    name: 'Chart',
    description:
      'A chart populated from the sales database. No invented data. Use area/line for dates, bar for comparisons, donut for a few categories, table for details.',
    props: chartSchema,
    component: renderers.Chart || (() => null),
  });
  const Dashboard = defineComponent({
    name: 'Dashboard',
    description: 'A complete dashboard with 1 to 6 charts.',
    props: z.object({
      title: z.string().min(1).max(100),
      charts: z.array(Chart.ref).min(1).max(6),
    }),
    component: renderers.Dashboard || (() => null),
  });
  return createLibrary({ root: 'Dashboard', components: [Dashboard, Chart] });
}

export const defaultProgram = `root = Dashboard("Sales overview", [trend, categories, countries])
trend = Chart("Revenue over time", "area", "week", "revenue", 90)
categories = Chart("Top categories", "bar", "category", "revenue", 8)
countries = Chart("Revenue by country", "donut", "country", "revenue", 6)`;
