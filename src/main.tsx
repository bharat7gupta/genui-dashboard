import React, { Component, createContext, useContext, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Renderer, type ComponentRenderProps } from '@openuidev/react-lang';
import { AreaChart, BarChart, LineChart, DonutChart, Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from '@tremor/react';
import { ArrowDownToLine, ArrowRight, BarChart3, Check, ChevronDown, Code2, Database, LayoutDashboard, LoaderCircle, RotateCcw, Sparkles, Square, X } from 'lucide-react';
import { createDashboardLibrary, defaultProgram } from '../shared/library.mjs';
import './styles.css';

type Filters = { start?: string; end?: string; status: string; country: string };
type Spec = { title: string; kind: 'area' | 'line' | 'bar' | 'donut' | 'table'; dimension: string; metric: string; limit: number };
type Row = { label: string; value: number };
type Metadata = { items: number; orders: number; start: string; end: string; countries: string[] };
type Health = { model: string; connected: boolean; ready: boolean };
type Message = { role: 'user' | 'assistant'; text: string };
const FiltersContext = createContext<Filters>({ status: 'Complete', country: 'all' });
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat('en-US');
const metricNames: Record<string, string> = { revenue: 'Revenue', orders: 'Orders', items: 'Items sold', customers: 'Customers', average_order_value: 'Average order value' };
const formatValue = (value: number, metric: string) => ['revenue', 'average_order_value'].includes(metric) ? dollars.format(value) : integer.format(value);

async function api<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}

function ChartPanel({ spec }: { spec: Spec }) {
  const filters = useContext(FiltersContext);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState(spec.kind);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify({ spec, filters });
  useEffect(() => setKind(spec.kind), [spec.kind]);
  useEffect(() => {
    const controller = new AbortController();
    setRows(null); setError('');
    api<{ rows: Row[] }>('/api/chart', { spec, filters }, controller.signal).then(r => setRows(r.rows)).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
    // The serialized key includes every query field.
  }, [key, retry]);
  const metric = metricNames[spec.metric] || spec.metric;
  const chartData = (rows || []).map(r => ({ name: r.label, [metric]: r.value }));
  const common = { data: chartData, index: 'name', categories: [metric], colors: ['emerald'], valueFormatter: (v: number) => formatValue(v, spec.metric), showAnimation: true, showLegend: false, yAxisWidth: 72, className: 'h-64 mt-6', noDataText: 'No matching sales' };
  function exportCsv() {
    const cell = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
    const csv = ['Dimension,Value', ...(rows || []).map(r => `${cell(/^[=+@\-]/.test(r.label) ? "'" + r.label : r.label)},${cell(r.value)}`)].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `${spec.dimension}-${spec.metric}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  return <Card className={`chart-card ${['day', 'week', 'month'].includes(spec.dimension) ? 'wide' : ''}`}>
    <div className="chart-heading"><div><h3>{spec.title}</h3><p>{metric} · {spec.dimension.replaceAll('_', ' ')}{!['day', 'week', 'month'].includes(spec.dimension) ? ` · top ${spec.limit}` : ''}</p></div><div className="chart-tools">
      <select aria-label={`Chart type for ${spec.title}`} value={kind} onChange={e => setKind(e.target.value as Spec['kind'])}><option value="area">Area</option><option value="line">Line</option><option value="bar">Bar</option><option value="donut">Donut</option><option value="table">Table</option></select>
      <button className="icon-button" aria-label={`Download ${spec.title} as CSV`} onClick={exportCsv} disabled={!rows?.length}><ArrowDownToLine size={16}/></button>
    </div></div>
    {error ? <div className="chart-empty" role="alert"><p>{error}</p><button onClick={() => setRetry(v => v + 1)}>Retry</button></div> : !rows ? <div className="chart-empty"><LoaderCircle className="spin" size={22}/><span>Reading sales data…</span></div> : !rows.length ? <div className="chart-empty"><Database size={24}/><p>No sales match these filters.</p></div> : <>
      {kind === 'area' && <AreaChart {...common}/>}
      {kind === 'line' && <LineChart {...common}/>}
      {kind === 'bar' && <BarChart {...common} layout="vertical" yAxisWidth={110} className="h-72 mt-5"/>}
      {kind === 'donut' && <div className="donut-layout"><DonutChart data={chartData} index="name" category={metric} colors={['emerald', 'teal', 'cyan', 'blue', 'amber', 'slate']} valueFormatter={common.valueFormatter} className="h-48 w-48"/><ul>{rows.map((r, i) => <li key={r.label}><span className={`legend-dot dot-${i % 6}`}/><span>{r.label}</span><strong>{formatValue(r.value, spec.metric)}</strong></li>)}</ul></div>}
      {kind === 'table' && <div className="table-scroll"><Table><TableHead><TableRow><TableHeaderCell>{spec.dimension.replaceAll('_', ' ')}</TableHeaderCell><TableHeaderCell>{metric}</TableHeaderCell></TableRow></TableHead><TableBody>{rows.map(r => <TableRow key={r.label}><TableCell>{r.label}</TableCell><TableCell>{formatValue(r.value, spec.metric)}</TableCell></TableRow>)}</TableBody></Table></div>}
    </>}
    <div className="chart-foot"><span className="small-dot"/> sales_snapshot.csv <span>{kind === 'donut' ? 'Shares of displayed groups' : 'Calculated with DuckDB'}</span></div>
  </Card>;
}

const library = createDashboardLibrary({
  Chart: ({ props }: ComponentRenderProps) => <ChartPanel spec={props as Spec}/>,
  Dashboard: ({ props, renderNode }: ComponentRenderProps) => <section aria-label={String(props.title)} className="chart-grid">{renderNode(props.charts)}</section>,
});

class RenderBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="error-banner">This dashboard could not be rendered. Reset it or try another request.</div> : this.props.children; }
}

function App() {
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [filters, setFilters] = useState<Filters>({ status: 'Complete', country: 'all' });
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [program, setProgram] = useState(defaultProgram);
  const [title, setTitle] = useState('Sales overview');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dataError, setDataError] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [showCode, setShowCode] = useState(false);
  const [showData, setShowData] = useState(false);
  const [retry, setRetry] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    setDataError('');
    api<Metadata>('/api/metadata', undefined, abort.signal).then(m => { setMetadata(m); setFilters(f => ({ ...f, start: m.start, end: m.end })); }).catch(e => { if (!abort.signal.aborted) setDataError(e.message); });
    const check = () => api<Health>('/api/health', undefined, abort.signal).then(setHealth).catch(() => { if (!abort.signal.aborted) setHealth(null); });
    check(); const timer = setInterval(check, 20000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [retry]);
  useEffect(() => {
    if (!metadata) return;
    const abort = new AbortController(); setSummary(null); setDataError('');
    api<Record<string, number>>('/api/summary', filters, abort.signal).then(setSummary).catch(e => { if (!abort.signal.aborted) setDataError(e.message); });
    return () => abort.abort();
  }, [filters, metadata]);
  useEffect(() => {
    // Newer browsers return a Promise here; React effects must not return it.
    void chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, busy]);
  useEffect(() => () => controller.current?.abort(), []);
  const setFilter = (name: keyof Filters, value: string) => { setFilters(f => ({ ...f, [name]: value })); setError(''); };
  async function generate(text = prompt) {
    if (!text.trim() || busy) return;
    setBusy(true); setError(''); setPrompt('');
    setMessages(m => [...m, { role: 'user', text }]);
    const abort = new AbortController(); controller.current = abort;
    try {
      const result = await api<{ program: string; title: string; charts: Spec[] }>('/api/generate', { prompt: text, current: program, filters }, abort.signal);
      setProgram(result.program); setTitle(result.title);
      setMessages(m => [...m, { role: 'assistant', text: `Updated your dashboard with ${result.charts.length} charts: ${result.charts.map(c => c.title).join(', ')}.` }]);
    } catch (e) {
      setPrompt(text);
      setError(abort.signal.aborted ? 'Generation cancelled. Your dashboard is unchanged.' : (e as Error).message);
    } finally { setBusy(false); controller.current = null; }
  }
  function reset() { setProgram(defaultProgram); setTitle('Sales overview'); setMessages([]); setError(''); setPrompt(''); }
  const examples = ['Show monthly revenue and the top 5 categories', 'Compare orders and revenue by country', 'Add a table of the top 10 products'];
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="/" aria-label="Sales Studio home"><span className="brand-mark"><BarChart3 size={23}/></span><span>sales<span className="brand-light">studio</span><small>YOUR DATA, IN VIEW</small></span></a>
      <div className="workspace-label">WORKSPACE</div><button className="nav-item active" onClick={() => setShowData(false)}><LayoutDashboard size={17}/>Dashboard<span className="nav-count">1</span></button><button className="nav-item" onClick={() => setShowData(true)}><Database size={17}/>Data source</button>
      <div className="sidebar-note"><span className="local-badge"><span className="small-dot"/> LOCAL WORKSPACE</span><h4>A conversation<br/>with your data.</h4><p>Ask a question. Find a pattern. Make your next move.</p></div>
      <div className="source-card"><Database size={17}/><div><strong>sales_snapshot.csv</strong><span>{metadata ? `${integer.format(metadata.items)} rows connected` : 'Connecting…'}</span></div>{metadata && <Check size={15}/>}</div><div className="sidebar-bottom"><span className="avatar">BG</span><div>My workspace<small>Local · Private</small></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>Dashboard</strong></div><span className="privacy"><span className="small-dot"/> Runs on your machine</span></header>
      <div className="content-layout"><main className="dashboard-main"><div className="page-heading"><div><div className="eyebrow">SALES INTELLIGENCE</div><h1>{title}</h1><p>Your sales story, one question at a time.</p></div><button className="secondary-button" disabled={busy} onClick={reset}><RotateCcw size={15}/>Reset view</button></div>
        <div className="filters"><div className="date-filter"><label>From<input type="date" aria-label="Start date" min={metadata?.start} max={filters.end || metadata?.end} value={filters.start || ''} disabled={busy} onChange={e => setFilter('start', e.target.value)}/></label><span>—</span><label>To<input type="date" aria-label="End date" min={filters.start || metadata?.start} max={metadata?.end} value={filters.end || ''} disabled={busy} onChange={e => setFilter('end', e.target.value)}/></label></div>
          <label className="select-filter"><span>Orders</span><select aria-label="Order status" value={filters.status} disabled={busy} onChange={e => setFilter('status', e.target.value)}>{['Complete', 'Shipped', 'Processing', 'Cancelled', 'Returned', 'all'].map(s => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s === 'Complete' ? 'Completed' : s}</option>)}</select><ChevronDown size={13}/></label>
          <label className="select-filter"><span>Market</span><select aria-label="Country" value={filters.country} disabled={busy} onChange={e => setFilter('country', e.target.value)}><option value="all">All countries</option>{metadata?.countries.map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={13}/></label>
        </div>
        <div className="definition-note">USD · {filters.status === 'all' ? 'All order statuses, including cancelled and returned' : `${filters.status === 'Complete' ? 'Completed' : filters.status} orders only`} · Revenue = sum of item sale prices</div>
        {dataError && <div className="error-banner" role="alert">{dataError} <button onClick={() => setRetry(n => n + 1)}>Retry</button></div>}
        <div className="stats-grid">{['revenue', 'orders', 'average_order_value', 'customers'].map((metric, i) => <Card className="stat-card" key={metric}><div className="stat-label">{metricNames[metric]}<span>{['$', '#', '↗', '◎'][i]}</span></div><div className="stat-value">{summary ? formatValue(summary[metric], metric) : <span className="loading-number">—</span>}</div><div className="stat-detail">{['Across selected orders', 'Distinct orders', 'Revenue per order', 'Unique customers'][i]}</div></Card>)}</div>
        <div className="section-heading"><h2>Your dashboard <span>{messages.length ? 'AI composed' : 'Starting view'}</span></h2><button onClick={() => setShowCode(v => !v)} aria-expanded={showCode}><Code2 size={15}/>{showCode ? 'Hide' : 'View'} OpenUI</button></div>
        {showCode && <pre className="code-view">{program}</pre>}
        <FiltersContext.Provider value={filters}><RenderBoundary key={program}><Renderer library={library} response={program} isStreaming={false}/></RenderBoundary></FiltersContext.Provider>
        <footer className="dashboard-footer"><span><Database size={12}/> One source of truth. Every value comes from your CSV.</span><span>Jan – Mar 2025</span></footer>
      </main>
      <aside className="assistant-panel"><div className="assistant-heading"><span className="spark-icon"><Sparkles size={18}/></span><div><h2>Dashboard assistant</h2><p>From a question to a clearer picture</p></div></div>
        <div className="assistant-content"><div className="assistant-intro"><span className="intro-symbol"><Sparkles size={25}/></span><h3>What would you<br/>like to explore?</h3><p>Describe the view you need. I’ll arrange the charts around your question.</p></div>
          {!messages.length && <div className="suggestions"><div className="suggestion-label">A FEW IDEAS TO GET STARTED</div>{examples.map(text => <button key={text} disabled={busy || !health?.ready} onClick={() => generate(text)}><span>{text}</span><ArrowRight size={16}/></button>)}</div>}
          <div className="chat-messages" aria-live="polite">{messages.map((message, i) => <div className={`message ${message.role}`} key={i}>{message.role === 'assistant' && <span className="message-label"><Sparkles size={12}/>STUDIO</span>}<p>{message.text}</p></div>)}{busy && <div className="thinking"><LoaderCircle className="spin" size={15}/> Composing your dashboard…<small>The local model may take a minute.</small></div>}<div ref={chatEnd}/></div>
        </div>
        <div className="composer-area">{error && <div className="generation-error" role="alert">{error}</div>}{health && !health.ready && <div className="generation-error">{health.connected ? `Install the model with: ollama pull ${health.model}` : 'Ollama is offline. Start it with ollama serve.'}</div>}
          <form className="composer" onSubmit={e => { e.preventDefault(); generate(); }}><textarea aria-label="Describe your dashboard" placeholder="Ask about your sales…" value={prompt} maxLength={2000} disabled={busy} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); } }}/><div className="composer-actions"><span>↵ to send · Shift + ↵ for a new line</span>{busy ? <button type="button" aria-label="Cancel generation" onClick={() => controller.current?.abort()}><Square size={14}/></button> : <button type="submit" aria-label="Generate dashboard" disabled={!prompt.trim() || !health?.ready}><ArrowRight size={18}/></button>}</div></form>
          <div className="model-status"><span className={`small-dot ${health?.ready ? '' : 'offline'}`}/><span>{health?.model || 'Checking local model…'}</span><span>LOCAL</span></div><p className="composer-note">Use the filters above to change dates, status or country.</p>
        </div>
      </aside></div>
    </div>
    {showData && <div className="modal-backdrop" onClick={() => setShowData(false)}><section className="data-modal" role="dialog" aria-modal="true" aria-label="Data source details" onClick={e => e.stopPropagation()}><button className="modal-close icon-button" aria-label="Close data source" autoFocus onClick={() => setShowData(false)} onKeyDown={e => { if (e.key === 'Escape') setShowData(false); }}><X size={20}/></button><Database size={28}/><h2>Your sales data</h2><p>sales_snapshot.csv</p><dl><dt>Order items</dt><dd>{metadata?.items.toLocaleString()}</dd><dt>Distinct orders</dt><dd>{metadata?.orders.toLocaleString()}</dd><dt>Date range</dt><dd>{metadata?.start} – {metadata?.end}</dd><dt>Currency</dt><dd>USD (assumed)</dd><dt>Default revenue</dt><dd>Completed orders only</dd></dl><p className="modal-note">The CSV is loaded into DuckDB when the server starts. Restart the server after replacing it. The model chooses the view; DuckDB calculates every value.</p><button className="secondary-button" onClick={() => setShowData(false)}>Back to dashboard</button></section></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
