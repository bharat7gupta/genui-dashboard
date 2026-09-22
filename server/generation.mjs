import { createParser } from '@openuidev/react-lang';
import { z } from 'zod/v4';
import { createDashboardLibrary, chartSchema, defaultProgram } from '../shared/library.mjs';

const library = createDashboardLibrary();
const parser = createParser(library.toJSONSchema(), 'Dashboard');
export const dashboardSchema = z
  .object({
    title: z.string().min(1).max(100),
    charts: z.array(chartSchema.strict()).min(1).max(6),
  })
  .strict();
const responseSchema = z.union([
  dashboardSchema,
  z.object({ unsupported: z.string().min(1).max(600) }).strict(),
]);
const outputSchema = z.toJSONSchema(responseSchema);
const missingTimeMessage =
  'This CSV contains order dates but no order time or timezone, so I cannot determine which hours have the most sales. Add an order timestamp and its timezone to enable time-of-day analysis. Your dashboard is unchanged.';

export function compileDashboard(input) {
  const { title, charts } = dashboardSchema.parse(input);
  const program =
    `root = Dashboard(${JSON.stringify(title)}, [${charts.map((_, i) => `chart${i}`).join(', ')}])\n` +
    charts
      .map(
        (c, i) =>
          `chart${i} = Chart(${[c.title, c.kind, c.dimension, c.metric, c.limit].map((v) => JSON.stringify(v)).join(', ')})`,
      )
      .join('\n');
  return { program, title, charts };
}

export function validateProgram(raw) {
  const program = raw
    .trim()
    .replace(/^```(?:openui(?:-lang)?|\w*)?\s*\n/, '')
    .replace(/\n```$/, '');
  const result = parser.parse(program);
  if (
    !result.root ||
    result.root.typeName !== 'Dashboard' ||
    result.meta.incomplete ||
    result.meta.errors.length ||
    result.meta.unresolved.length ||
    result.queryStatements.length ||
    result.mutationStatements.length ||
    Object.keys(result.stateDeclarations).length
  ) {
    throw new Error(
      'Return a complete Dashboard with valid Chart components. ' +
        result.meta.errors.map((e) => e.message).join('; '),
    );
  }
  const title = z.string().min(1).max(100).parse(result.root.props.title);
  const nodes = z.array(z.any()).min(1).max(6).parse(result.root.props.charts);
  const charts = nodes.map((node) => {
    if (node?.typeName !== 'Chart' || node.hasDynamicProps || node.partial)
      throw new Error('Only static Chart components are supported');
    return chartSchema.parse(node.props);
  });
  // Re-serialize validated literals, so only our two registered components reach the browser.
  return compileDashboard({ title, charts });
}

export async function modelStatus(base, model) {
  try {
    const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Ollama unavailable');
    const body = await response.json();
    const models = (body.models || []).map((m) => m.name);
    return {
      model,
      connected: true,
      ready: models.includes(model) || models.includes(`${model}:latest`),
      models,
    };
  } catch {
    return { model, connected: false, ready: false, models: [] };
  }
}

export async function generateDashboard({ prompt, current, filters, base, model, signal }) {
  const system = `You design sales dashboards. Return only JSON matching the supplied schema.
Choose chart specifications, never data values, SQL or executable code.
FIRST decide whether the question can actually be answered with the available data and supported calculations. If not, return {"unsupported":"A concise explanation of the missing data or capability and what is needed. Your dashboard is unchanged."}. This is a valid answer. Do not substitute the nearest available dimension or invent a chart title that claims unsupported analysis. For mixed requests with an unsupported part, explain the limitation instead of silently answering only part.
CSV columns: order_item_id, order_id, order_date, order_status, item_status, user_id, country, city, product_id, product_name, category, brand, sale_price. order_date is DATE ONLY, e.g. 2025-01-01: NO hour, time, timestamp, or timezone. There is no cost, profit, inventory, or visit data. Some CSV columns are not supported chart dimensions; use only the dimensions listed below.
Questions about time of day, peak hours, mornings, afternoons or evenings CANNOT be answered. Day of week is NOT hour of day. Return unsupported and explain that an order timestamp and timezone are required. Do not use day, day_of_week or day_type as a substitute.
Metrics: revenue = sum of sale_price; orders = distinct order_id; customers = distinct user_id (purchasing customers); items = row count; average_order_value = revenue / distinct orders.
Dimensions: day (individual calendar dates), week, month, day_of_week (Monday through Sunday), day_type (Weekday versus Weekend), country, category, brand, product_name, order_status.
For recurring weekday patterns and weekday/weekend comparisons, use average_daily_revenue with day_of_week or day_type. This metric sums sales per calendar day then averages across all matching dates, including zero-sales dates. It is only supported with those two dimensions. Never substitute day (calendar dates) when the user asks for day of the week. Results for this metric are sorted lowest first.
A question asking which days have least sales AND whether weekdays or weekends are weaker needs two bar charts: average_daily_revenue by day_of_week (limit 7), and average_daily_revenue by day_type (limit 2). Use these averages instead of totals to account for unequal numbers of dates. Sales means revenue unless the user specifies order counts.
Kinds: line or area for time trends, bar for comparisons, donut for a few categories, table for details.
Use limit 90 for time series and 5 to 10 for top groups unless requested otherwise.
A fresh analytical question replaces the dashboard with ONLY the requested charts. A question about one metric by one dimension needs exactly ONE chart. Do not add related metrics, revenue charts, or unrelated charts.
An explicit edit such as "add", "change that to", or "keep" updates the current dashboard; preserve unaffected charts. Return the complete revised dashboard.
All charts share the provided UI filters. You cannot change filters in the chart specification. Do not claim to filter a date, status or country different from the active filters. Data covers January through March 2025; currency is USD.
Example request: Show me the number of purchasing customers over each month
Example response: {"title":"Monthly purchasing customers","charts":[{"title":"Purchasing customers by month","kind":"line","dimension":"month","metric":"customers","limit":90}]}
Output schema: ${JSON.stringify(outputSchema)}`;
  const previous = validateProgram(current || defaultProgram);
  const messages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `Current dashboard: ${JSON.stringify({ title: previous.title, charts: previous.charts })}\nActive filters: ${JSON.stringify(filters)}\nRequest: ${prompt}`,
    },
  ];
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(model.startsWith('qwen3') ? { think: false } : {}),
        format: outputSchema,
        options: { temperature: 0, num_ctx: 8192, num_predict: 2000 },
      }),
    });
    if (!response.ok) {
      if (response.status === 404)
        throw new Error(`Model ${model} is not installed. Run: ollama pull ${model}`);
      throw new Error(`Ollama returned HTTP ${response.status}. Check the local model server.`);
    }
    const body = await response.json();
    const content = body.message?.content || '';
    try {
      if (body.done_reason === 'length')
        throw new Error('The response exceeded the output token limit. Keep titles concise.');
      const parsed = responseSchema.parse(JSON.parse(content));
      if ('unsupported' in parsed) return { unsupported: parsed.unsupported, model };
      // Reject hourly claims even if the model selects a schema-valid date dimension.
      if (
        [parsed.title, ...parsed.charts.map((c) => c.title)].some((title) =>
          /\b(hour(?:s|ly)?|time[- ]of[- ](?:the[- ])?day|morning|afternoon|evening)\b/i.test(
            title,
          ),
        )
      ) {
        return { unsupported: missingTimeMessage, model };
      }
      const compiled = compileDashboard(parsed);
      // Verify the generated OpenUI against the same library used by the browser.
      return { ...validateProgram(compiled.program), model };
    } catch (error) {
      lastError = error;
      messages.push(
        { role: 'assistant', content },
        {
          role: 'user',
          content: `Correct the JSON to match the schema and my request. Validation error: ${error.message.slice(0, 1500)}. Return the entire corrected JSON object, with no markdown.`,
        },
      );
    }
  }
  throw new Error(
    `The local model returned an invalid dashboard after two attempts. Your current dashboard is unchanged. Please retry. ${lastError.message.slice(0, 200)}`,
  );
}
