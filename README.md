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
3. The server validates the chart specifications, converts them to OpenUI Lang, and validates the resulting program against the component library.
4. OpenUI renders the registered Tremor components. Charts obtain their values from server-owned DuckDB aggregation queries. The model never supplies sales values or executes SQL.

Questions that require unavailable fields or unsupported calculations can return an explanation instead of a chart. The CSV has no order time or timezone, so hourly or time-of-day sales cannot be calculated. Unsupported responses preserve the current dashboard.

A new analytical question requests a new view. Explicit follow-ups modify the current view. Invalid output is retried once; failure leaves the existing dashboard intact. Schema validation constrains structure, but model interpretation can still be wrong, so inspect chart labels and active filters.

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
