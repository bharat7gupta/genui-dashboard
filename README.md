# Sales Studio

A local conversational dashboard using React, Tremor, OpenUI Lang, a Node server, DuckDB, and Ollama.

## Start

Requires Node.js 20.16 or newer and Ollama.

```sh
npm install
ollama pull qwen3.5:4b
# Start the Ollama app, or run `ollama serve` in another terminal.
npm run dev
```

Open http://127.0.0.1:3000/ in your browser. The model is already installed on the current machine.

Ask: **Show me the number of purchasing customers over each month**.
Then: **Change that to a bar chart**.

Use the date, status, and country controls to filter the data. Each chart also has a type selector and a CSV download button. The starting dashboard works even when Ollama is offline; conversational generation needs Ollama.

## How it works

1. Node loads `sales_snapshot.csv` into an in-memory DuckDB `sales` table at startup.
2. Ollama runs `qwen3.5:4b` locally with thinking disabled and schema-constrained JSON output.
3. The model produces a structured analytical plan: fields, date transforms, aggregations, filters, sorting, and limits.
4. The server validates and compiles the plan into parameterized DuckDB SQL, then OpenUI renders the result with Tremor. The model never supplies sales values or SQL.

Questions that require unavailable fields or unsupported calculations can return an explanation instead of a chart. The CSV has no order time or timezone, so hourly or time-of-day sales cannot be calculated. Unsupported responses preserve the current dashboard.

A new analytical question requests a new view. Explicit follow-ups modify the current view. Invalid output is retried once; failure leaves the existing dashboard intact. Schema validation constrains structure, but model interpretation can still be wrong, so inspect chart labels and active filters.

## Pending

- Finish and evaluate the general query planner; model plans can still be semantically wrong.
- Add answerability and calculation-claim checks before executing a plan.
- Add ratios, percentages, comparisons, multi-series charts, and clarification for ambiguous questions.
- Estimate query cost and block or warn on slow, high-cardinality, or oversized requests.
- Add timeouts, cancellation, caching, pagination, and concurrency limits.
- Add authentication, field/row authorization, export controls, rate limits, and audit logs.
- Add schema/data-quality checks, file refresh, freshness tracking, and persistent DuckDB support.
- Add a natural-language regression suite, browser tests, monitoring, and a production deployment plan.

## Data definitions

- Currency: USD (assumed).
- Default filter: `order_status = 'Complete'`.
- Revenue: sum of `sale_price` for matching items.
- Orders: distinct `order_id`; customers: distinct `user_id`; items: row count.
- Average order value: revenue divided by distinct matching orders.
- Day-of-week and weekday/weekend comparisons support average daily revenue: daily sales totals averaged across calendar dates, including zero-sales dates. Coverage is restricted to the snapshot date range. These charts sort lowest first.
- Customer counts are distinct within each group. Summing monthly customer counts can double-count repeat customers.
- Changing to all statuses includes cancelled and returned orders.
- The CSV covers January–March 2025. Restart the server after replacing the CSV. No persistent `.duckdb` file is created.
- Dashboard state lasts for the current page session.

## Configuration and checks

Copy `.env.example` to `.env` to override the model, Ollama address, CSV path, or port. Restart the server after changing configuration or server code.

```sh
npm test
npm run build
npm start
```

`npm start` serves the production build; `npm run dev` serves the development app. Use one at a time on port 3000. The server binds to loopback, for use on this machine.
