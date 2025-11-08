# Reporting Platform Redesign – Technical Plan

## Task Tracker
- [x] Backend: define `QueryConfig` contract and schema migrations
- [x] Backend: implement query builder, caching, async jobs, RBAC hooks
- [x] Backend: expose expanded reporting APIs (query, templates, dashboards, derived fields)
- [x] Frontend: update shared data models/state to new contract
- [x] Frontend: rebuild Visuals & Analytics with advanced charting and interactions
- [x] Frontend: enhance template builder (library, joins graph, spotlight, scheduling, export)
- [x] Frontend: add dashboards builder/viewer/export flows
- [x] Cross-cutting: derived field manager, scheduling UI, Google Drive export, notifications
- [x] QA & rollout: automated tests, monitoring, migration tooling, documentation
- [ ] Multimodel derived fields: expression AST, planner, template editor

## Goals & Scope
- Replace the current preview-only flow with a composable query engine that supports advanced aggregations, comparisons, rolling windows, and caching.
- Upgrade the template builder and Visuals & Analytics experience to consume the new engine.
- Introduce reusable dashboards fed by saved template “views,” with export/sharing capabilities.
- Provide foundations for derived fields, scheduling, RBAC, and future extensibility.

Deliverables are split across backend services, API contracts, frontend surfaces, and cross-cutting infrastructure.

---

## Backend Query Engine
### QueryConfig Contract
- `sources`: array of model ids with optional aliases.
- `joins`: join graph (`left`, `right`, `on`, `type`).
- `filters`: structured objects (`field`, `op`, `value`, `mode`).
- `metrics`: name, expression (column or derived), aggregation (`sum`, `avg`, `count`, `count_distinct`, `min`, `max`), optional window spec.
- `dimensions`: name, expression or column, optional bucketing (`date_trunc`, custom bucket size), sort order, top‑N with “Others”.  
- `time`: optional `{ field, range: { from, to }, bucket: hour/day/week/month/quarter/year, gapFill: zero|null }`.
- `comparison`: optional array describing comparison periods (prev, WoW, MoM, YoY) and join keys.
- `derivedFields`: definitions with expression DSL (validated AST, dependency graph).
- `sort`, `limit`, `offset`, `postProcessing` (pivot, funnel, cohort).
- `options`: `{ explain: boolean, anomalyDetection: { method, threshold }, allowAsync: boolean }`.

### Engine Responsibilities
1. Validate `QueryConfig` (schema + semantic checks).
2. Translate to parameterized SQL using builder utilities (Sequelize `literal`/`fn` wrappers or Knex-like layer).
3. Apply window functions for rolling/cumulative metrics, and `generate_series` for gap fill.
4. Run query via pooled connection with timeout.
5. Support async execution when estimated cost exceeds threshold (enqueue job, poll for status).
6. Cache results by SHA256 hash of normalized `QueryConfig` + template version, with TTL and invalidation when dependencies change.
7. Provide “explain” metadata (selected models, metrics, filters, bucket, comparison) for UI summary.
8. Enforce RBAC hooks (currently permissive, but expose guard points for future role filters).

### Persistence & Schema
- Extend `report_templates` JSONB to store `queryConfig`, `visuals`, `metricsSpotlight`, `schedules`, `derivedFields`.
- New tables:
  - `dashboard_layouts` (id, owner, name, config JSON, share settings, created/updated).
  - `dashboard_cards` (id, dashboard_id, template_id, view_config JSON, position).
  - `report_schedules` (id, template_id, cadence, delivery_targets, last_run, status).
  - `query_cache` (hash, template_id, result JSONB, meta, expires_at, created_at).
  - `derived_field_library` (id, scope workspace/global, name, expression, metadata).
  - `async_jobs` (id, hash, status, payload, result pointer, started/finished).

### APIs
| Endpoint | Method | Description |
| --- | --- | --- |
| `/reports/query` | `POST` | Execute `QueryConfig` (sync); returns result or async token. |
| `/reports/query/:hash` | `GET` | Poll async job & cached responses. |
| `/reports/templates` | `GET/POST` | CRUD with expanded schema, includes derived fields & visuals. |
| `/reports/templates/:id/run` | `POST` | Run stored template with optional overrides (filters/time range). |
| `/reports/templates/:id/schedules` | `POST/PUT/DELETE` | Manage scheduled deliveries. |
| `/reports/dashboards` | `GET/POST/PUT/DELETE` | Manage dashboards & cards. |
| `/reports/derived-fields` | `GET/POST/PUT/DELETE` | Workspace-level derived fields. |
| `/reports/cache/:hash/invalidate` | `POST` | Manual cache bust. |
| `/reports/templates/:id/export` | `POST` | Export template (JSON) to Google Drive. |

### Infrastructure Considerations
- Introduce centralized query builder module (`be/src/services/reporting/queryBuilder.ts`).
- Add Redis or reuse Postgres for caching (initially PG table; abstract storage for future swap).
- Job runner: simple in-process queue with exponential backoff, pluggable adapter (upgrade later to BullMQ/Sidekiq-style).
- Logging & metrics: instrument query duration, cache hit rate, async job latency.

---

## Frontend Architecture
### Data Layer
- Expand API client in `ui/src/api/reports.ts` to support new endpoints, typed `QueryConfig`, `Template`, `Dashboard`, `DerivedField` models.
- Introduce context/store for report builder state (e.g., Zustand/Redux) to manage templates, fields, derived field registry, cached previews.
- Provide query-building helpers mirroring backend contract (ensuring shared validation rules via generated schema or shared package).

### Visuals & Analytics
- **Builder Panel**: metric/dimension selectors with aggregation picker, bucketing controls, comparison toggles, segment/group-by UI, Top-N w/ “Others”.  
- **Derived Field Editor**: expression editor with autocomplete, validation feedback, dependency visuals; support row-level vs aggregate-level fields.  
- **Advanced Charting**: chart gallery (Line/Area/Bar/Scatter/Histogram/Box/Pivot/Funnel/Calendar/ Pareto/Cohort). Each chart gets a renderer component using Recharts/D3, with stable color palette, optional secondary y-axis, tooltips showing deltas and comparisons.  
- **Interaction**: drill-down from chart to data table, cross-filter badges, anomaly toggle (using z-score column).  
- **Explain Panel**: natural-language summary plus raw SQL preview.
- **Data Table**: true query result, sortable, pageable, export to CSV.

### Template Builder Enhancements
- Template library UI with search, version history, rename/duplicate/delete/export.
- Join graph visualization using dagre/vis.js to display multi-hop relationships.
- Field inventory: searchable tree grouped by model, toggle metric/dimension, display data type, derived field badge.
- Metrics spotlight configuration: select metric alias, define target, choose comparison period (prev/ WoW/MoM/YoY), set formatting.
- Schedule configuration (email addresses, Slack webhooks, time zone, cadence).
- Save workflow: optimistic updates, validation for derived-field dependencies, use new template schema.

### Dashboards
- Builder mode: draggable grid layout (React Grid Layout), add cards by selecting template + saved view, configure per-card overrides (time range, filters, comparison).  
- Viewer mode: read-only, supports global time range override and cross-card filters.  
- Export: render dashboard as PNG/PDF (html2canvas + jsPDF or server-side via headless browser).  
- Sharing: generate signed URLs with optional expiry, enforce RBAC.  
- Dashboard list page with search, owners, last updated.

### Derived Fields & Library
- Separate manager view (global vs template).  
- Expression builder: syntax highlighting, linting, preview results using current query sample.  
- Dependency graph anywhere fields are used (visuals, metrics, filters) with safe deletion checks.

#### Multimodel Derived Fields Enablement
- [x] Define expression AST schema that supports column references tagged with `modelId`/`fieldId`, arithmetic operators, functions, and constants.
- [x] Backend: model-aware validation & storage
  - Extend `report_derived_fields` records with `referenced_models` (string[]) and `join_dependencies` (pairs of model ids) derived from the AST.
  - When a derived field is saved (workspace or template scope) parse the AST, ensure every referenced `modelId` exists in the workspace catalog, and persist a normalized list of fields per model.
  - Store a `model_graph_signature` hash (sorted model ids + join ids) so we can quickly detect when the template model set changes and mark the derived field as stale.
- [x] Planner & execution updates
  - Enhance `executePreviewQuery` / `executeAggregatedQuery` so that, before SQL generation, they reconcile the draft template model list against each derived field’s `referenced_models`.
  - For every column node in the AST, resolve the column alias using template join aliases; if a referenced model is not present, emit a structured validation error before hitting the database.
  - Teach the planner to request any missing joins required by the derived field by walking `join_dependencies`; if the join graph cannot satisfy the requirement, block execution with a message describing the missing relationship.
  - Cache the compiled SQL fragment per derived field keyed by (field id + model graph signature) to avoid recompiling on every preview run.
- [x] Query serialization & hashing
  - Include `derivedFields` payload (id, expression AST, referenced models, join dependencies, compiled SQL hash) in both the template serialization and the query hash input.
  - Update cache invalidation so that a change in the derived field graph or template join graph busts relevant cache entries.
- [x] Frontend: template-level derived field workspace
  - Add a persistent "Derived fields" drawer (right-side panel) in the template builder that lists derived fields, along with CTA buttons for "New" and "Edit." Drawer hosts a tokenized expression editor (Monaco-lite) with syntax highlighting for functions/operators and in-line validation states.
  - [x] Introduce a chips-based field palette grouped by model: each chip inserts `modelId.fieldId` tokens; palette should respect current template field selections and grey out fields that aren't available in the selected models.
  - [x] Display a "join coverage" callout under the editor that enumerates models referenced in the current AST, the joins currently connecting them, and warnings when coverage is missing (e.g., "Add a join between Bookings and Guests").
  - [x] When the expression validates, show a read-only preview table seeded by the first 20 rows of the current models to reinforce cross-model behavior; hide the preview if validation fails.
  - Persist `referencedModels`, `referencedFields`, `joinDependencies`, and `modelGraphSignature` when saving so the backend no longer needs to re-derive them.
- [x] Template model change handling
  - Detect model add/remove events in the builder reducer; when a referenced model disappears, mark the affected derived fields with a `status: "stale"` flag, disable them from the preview payload, and surface an inline badge ("Needs model Bookings") next to each field.
  - Provide one-click "Resolve" actions that either reopen the editor (to swap columns) or restore the missing model; log the change to analytics so we can see how often users hit this edge case.
  - Backend preview/query endpoints should reject payloads containing stale derived fields with a structured error (`code: "DERIVED_FIELD_STALE"`) to keep API behavior consistent even if the UI misses a state update.
  - Saving or running a template with stale derived fields should block the CTA, explaining which models must be re-added or which fields must be edited/removed before proceeding.
- [x] API DTO & transport updates
  - Update `ui/src/api/reports.ts` types plus backend DTOs so `DerivedFieldDefinitionDto` carries `expressionAst`, `referencedModels`, `joinDependencies`, and `modelGraphSignature`.
  - Ensure preview/run payloads send only the normalized AST plus metadata; backend responds with per-field validation errors when joins/models are missing.
- [ ] Tests
  - Backend: expand `derivedFieldExpression` unit tests to snapshot the compiled hash, cover referential metadata extraction, and verify error codes for missing joins/models. Add end-to-end preview tests that simulate template payloads with/without the correct `modelGraphSignature` and ensure cache hashes change when derived fields mutate.
  - Frontend: add RTL specs for the drawer component (token insertion, stale badge rendering, join coverage hints) plus reducers that handle model removal. Record Cypress flows for: (1) create expression spanning 3 models, (2) remove a model and observe disabled state + blocking save, (3) restore model and confirm preview works.

### Scheduling & Delivery
- UI flow to enable schedule: choose cadence, recipients, delivery format (PDF, CSV, Slack message), message template.  
- Show next run, history, status.  
- Integration hooks for Google Drive export (OAuth & drive API).  
- Error handling surfaced in UI and via notifications.

---

## Backend–Frontend Alignment
- Share validation schemas via generated types (`@reporting/types` package) or JSON schema compilation.
- Ensure serialization of derived expressions / QueryConfig is stable (canonical ordering before hashing).
- Standardize time zone handling (store UTC, display per-user locale).
- Add `explain` metadata to template runs to populate UI summary & logging.

---

## Rollout Strategy
1. **Infra & Contracts**: build query builder, migrations, schema validation, minimal API stub returning mocked data for UI development.
2. **Frontend Pilot**: implement new Visuals & Analytics against mock query service; preserve fallback to legacy preview for regression safety.
3. **Template Schema Migration**: migration script to convert existing templates into new JSON structure (initially infer metrics & visuals from selected columns).
4. **Backend Feature Parity**: incrementally enable aggregations, comparisons, caching; gate advanced features behind feature flags.
5. **Dashboards & Scheduling**: once query engine solid, roll out dashboard builder, derived field manager, scheduling UI.
6. **Production Enablement**: monitoring, alerting, load testing, documentation, training materials.

---

## Open Questions / Follow-ups
- Expression language: adopt SQL fragments with sanitizer or introduce safe DSL (e.g., math.js AST).  
- Caching store choice (Postgres vs Redis) for first iteration.  
- Async job queue persistence (in Postgres vs dedicated queue).  
- Slack/email delivery infrastructure (existing notifier or new microservice).  
- RBAC granularity (field-level restrictions, template ownership, dashboard sharing scope).  
- Migration tooling & backward compatibility for users relying on legacy preview UI during transition.

---

This document serves as the foundation for the implementation steps outlined in the project plan. As we execute, we’ll open focused design docs for any deep-dive areas (expression DSL, dashboard layout schema, scheduling pipeline). Should requirements shift, update this doc to keep backend/frontend teams aligned.

---

## QA & Rollout Plan

### Test Matrix
- **Backend**
  - `reportQueryService`: validate builder permutations (filters, joins, buckets, comparisons, async/cached paths).
  - Controllers: supertest coverage for `/reports/query`, `/reports/templates`, `/reports/dashboards`, `/reports/derived-fields`.
  - Jobs/caching: simulate long-running queries to ensure async jobs + cache invalidation work under load.
  - Migrations: run `sequelize-cli db:migrate` in CI against disposable Postgres.
- **Frontend**
  - React Testing Library suites for template builder, dashboards workspace, derived fields manager (form validation, optimistic updates).
  - E2E smoke (Playwright/Cypress) for report preview → save → dashboard card add → export flows.
  - Visual regression snapshots for Mantine-heavy surfaces (template library drawer, dashboards grid).
- **Manual regression**
  - Cross-browser spot checks (Chromium/Safari/Firefox).
  - Accessibility audit (keyboard nav, aria labels) on builder controls, modals, derived fields table.
  - Performance pass: preview + analytics run under 200 selected columns.

### Tooling & Automation
- Scripts:
  - `npm run lint:ui`, `npm run test:ui`, `npm run test:be`.
  - `npm run seed:reporting-demo` to load sample templates/dashboards.
- CI (GitHub Actions):
  - Matrix Node 18/20.
  - Cache node_modules, run lint → tests → build.
  - Publish coverage artifact (Codecov).

### Monitoring & Alerting
- Metrics (Prometheus):
  - `report_query_duration_seconds`, `report_query_errors_total`, `report_cache_hits_total`.
  - `report_schedule_dispatch_total` (labeled by status), `report_async_jobs_inflight`.
- Logging: structured via `pino` including `templateId`, `dashboardId`, `userId`.
- Alerts:
  - Query error rate >5% over 5m.
  - Async queue length >20 for >2m.
  - Schedule dispatch failures >3 consecutive per template.

### Migration & Rollout
- Order:
  1. Run reporting-engine migration.
  2. Backfill legacy templates (script converts columns/aliases/visuals).
  3. Seed starter dashboards + derived fields (workspace library) for onboarding.
- Feature flags:
  - `reporting.builder.v2`, `reporting.dashboards`, `reporting.derivedFields`.
  - Enable per environment (dev → staging → pilot customers → GA).
- Rollback plan:
  - Maintain legacy preview endpoints for one release.
  - Snapshot `report_templates`, `report_dashboards`, `derived_field_definitions` prior to rollout.

### Documentation & Training
- Update internal handbook:
  - Template builder user guide with scheduling/export steps.
  - Dashboards quick start (card layouts, JSON export/import).
  - Derived fields cookbook with sample expressions + gotchas.
- Record Loom walkthrough for GTM teams; host in knowledge base.
- Update API reference (OpenAPI/Stoplight) for new endpoints.

### Release Checklist
1. ✅ All migrations applied on staging; smoke tests pass.
2. ✅ CI green (lint/unit/e2e).
3. ✅ Monitoring dashboards updated with new metrics/alerts.
4. ✅ Feature flags enabled for pilot cohort; capture feedback.
5. ✅ Public rollout announcement + documentation published.
