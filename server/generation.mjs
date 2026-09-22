import { createParser } from '@openuidev/react-lang';
import { z } from 'zod/v4';
import { createDashboardLibrary, chartSchema, defaultProgram } from '../shared/library.mjs';

const library = createDashboardLibrary();
const parser = createParser(library.toJSONSchema(), 'Dashboard');

export function validateProgram(raw) {
  const program = raw.trim().replace(/^```(?:openui(?:-lang)?|\w*)?\s*\n/, '').replace(/\n```$/, '');
  const result = parser.parse(program);
  if (!result.root || result.root.typeName !== 'Dashboard' || result.meta.incomplete || result.meta.errors.length || result.meta.unresolved.length || result.queryStatements.length || result.mutationStatements.length || Object.keys(result.stateDeclarations).length) {
    throw new Error('Return a complete Dashboard with valid Chart components. ' + result.meta.errors.map(e => e.message).join('; '));
  }
  const title = z.string().min(1).max(100).parse(result.root.props.title);
  const nodes = z.array(z.any()).min(1).max(6).parse(result.root.props.charts);
  const charts = nodes.map(node => {
    if (node?.typeName !== 'Chart' || node.hasDynamicProps || node.partial) throw new Error('Only static Chart components are supported');
    return chartSchema.parse(node.props);
  });
  // Re-serialize validated literals, so only our two registered components reach the browser.
  const canonical = `root = Dashboard(${JSON.stringify(title)}, [${charts.map((_, i) => `chart${i}`).join(', ')}])\n` + charts.map((c, i) => `chart${i} = Chart(${[c.title, c.kind, c.dimension, c.metric, c.limit].map(v => JSON.stringify(v)).join(', ')})`).join('\n');
  return { program: canonical, title, charts };
}

export async function modelStatus(base, model) {
  try {
    const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Ollama unavailable');
    const body = await response.json();
    const models = (body.models || []).map(m => m.name);
    return { model, connected: true, ready: models.includes(model) || models.includes(`${model}:latest`), models };
  } catch { return { model, connected: false, ready: false, models: [] }; }
}

export async function generateDashboard({ prompt, current, filters, base, model, signal }) {
  const system = library.prompt({
    additionalRules: [
      'Generate only 1 to 6 Chart components in a Dashboard. No data arrays, Query, Mutation, functions or reactive state.',
      'The data covers January 1 through March 31, 2025. Currency is USD. Revenue is sum(sale_price), orders are distinct order_id, average_order_value is revenue / distinct orders.',
      'Chart arguments are exactly title, kind, dimension, metric, limit. Use limit 90 for daily/weekly/monthly time series, 5 to 10 for top categories. Use chronological dimensions for line/area and categorical dimensions for bar/donut/table.',
      'Each assignment MUST be on its own line, outside all arrays. The Dashboard array contains only variable names: [chart1, chart2]. NEVER put chart1 = Chart(...) inside the array.',
      'The dimension argument is ONE string, e.g. "month" or "category". NEVER use an array such as ["month"].',
      'All charts share the UI date, country and order-status filters. You cannot change filters through chart code. Do not pretend to filter data or invent unsupported fields.',
      'For a follow-up, revise the current dashboard while preserving charts the user did not ask to change. Return the entire revised program.',
    ],
    examples: [defaultProgram],
  });
  const previous = current ? validateProgram(current).program : defaultProgram;
  const messages = [{ role: 'system', content: system }, { role: 'user', content: `Current dashboard:\n${previous}\nActive filters: ${JSON.stringify(filters)}\nRequest: ${prompt}` }];
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ model, messages, stream: false, options: { temperature: 0.1, num_ctx: 8192, num_predict: 1400 } }),
    });
    if (!response.ok) {
      if (response.status === 404) throw new Error(`Model ${model} is not installed. Run: ollama pull ${model}`);
      throw new Error(`Ollama returned HTTP ${response.status}. Check the local model server.`);
    }
    const body = await response.json();
    const content = body.message?.content || '';
    try { return { ...validateProgram(content), model }; }
    catch (error) {
      lastError = error;
      messages.push({ role: 'assistant', content }, { role: 'user', content: `Fix the program: ${error.message.slice(0,1500)}. Assignments must be separate top-level lines, NOT inside arrays. Dimension must be a string, NOT an array. Follow this exact syntax, adjusting titles, kinds, dimensions and metrics to my request:\nroot = Dashboard("Monthly sales", [chart1, chart2])\nchart1 = Chart("Monthly revenue", "line", "month", "revenue", 90)\nchart2 = Chart("Top categories", "bar", "category", "revenue", 5)\nReturn only the complete corrected OpenUI Lang program.` });
    }
  }
  throw new Error(`The model could not produce a valid dashboard. Try a simpler request. ${lastError.message.slice(0,200)}`);
}
