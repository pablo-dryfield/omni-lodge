import request from 'supertest';

import {
  createProductionReadConnectorApp,
  type ProductionReadConnectorConfig,
  type ProductionReadQuery,
  type ProductionReadQueryExecutor,
} from '../codexProductionReadConnectorService';

const config = (
  overrides: Partial<ProductionReadConnectorConfig> = {},
): ProductionReadConnectorConfig => ({
  host: '127.0.0.1',
  port: 3019,
  bearerToken: 'test-connector-token',
  database: {
    host: '127.0.0.1',
    port: 5432,
    database: 'omni_lodge_db',
    user: 'codex_cloud_reader',
    password: 'not-used-in-tests',
  },
  maxRows: 50,
  maxResponseBytes: 256 * 1024,
  statementTimeoutMs: 5_000,
  lockTimeoutMs: 1_000,
  rateLimitPerMinute: 60,
  allowedTableKeys: new Set(['public.error_monitoring_issues']),
  ...overrides,
});

const authHeader = { Authorization: 'Bearer test-connector-token' };

describe('Codex production read connector', () => {
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('rejects requests before the query executor when the bearer token is missing', async () => {
    const executor = jest.fn() as jest.MockedFunction<ProductionReadQueryExecutor>;
    const app = createProductionReadConnectorApp(config(), executor);

    await request(app).get('/health').expect(401);

    expect(executor).not.toHaveBeenCalled();
  });

  it('runs the health probe through the read-only executor', async () => {
    const executor = jest.fn(async (query: ProductionReadQuery) => ({
      rows: [{
        user_name: 'codex_cloud_reader',
        database_name: 'omni_lodge_db',
        transaction_read_only: 'on',
      }],
      rowCount: 1,
    }));
    const app = createProductionReadConnectorApp(config(), executor);

    const response = await request(app).get('/health').set(authHeader).expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      service: 'codex-production-read-connector',
      database: {
        user_name: 'codex_cloud_reader',
        database_name: 'omni_lodge_db',
        transaction_read_only: 'on',
      },
    });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0]?.[0].operation).toBe('health');
    expect(executor.mock.calls[0]?.[0].text).toContain('current_setting');
  });

  it('constrains the open error issues report to safe statuses and max rows', async () => {
    const executor = jest.fn(async () => ({
      rows: [{
        id: '620',
        status: 'open',
        title: 'Example issue',
      }],
      rowCount: 1,
    }));
    const app = createProductionReadConnectorApp(config({ maxRows: 25 }), executor);

    const response = await request(app)
      .post('/reports/open-error-issues')
      .set(authHeader)
      .send({ statuses: ['open'], limit: 999 })
      .expect(200);

    expect(response.body).toMatchObject({
      report: 'open_error_issues',
      statuses: ['open'],
      limit: 25,
      rows: [{
        id: '620',
        status: 'open',
        title: 'Example issue',
      }],
    });
    expect(executor.mock.calls[0]?.[0].values).toEqual([['open'], 25]);
    expect(executor.mock.calls[0]?.[0].text).toContain('WHERE status = ANY($1::text[])');
  });

  it('rejects table reads unless the table is explicitly allowlisted', async () => {
    const executor = jest.fn() as jest.MockedFunction<ProductionReadQueryExecutor>;
    const app = createProductionReadConnectorApp(
      config({ allowedTableKeys: new Set() }),
      executor,
    );

    await request(app)
      .post('/tables/read')
      .set(authHeader)
      .send({ schema: 'public', table: 'error_monitoring_issues' })
      .expect(403);

    expect(executor).not.toHaveBeenCalled();
  });

  it('builds allowlisted row reads with identifiers quoted and filter values parameterized', async () => {
    const executor = jest.fn(async () => ({
      rows: [{ id: '620', title: 'Example issue' }],
      rowCount: 1,
    }));
    const app = createProductionReadConnectorApp(config(), executor);

    await request(app)
      .post('/tables/read')
      .set(authHeader)
      .send({
        schema: 'public',
        table: 'error_monitoring_issues',
        columns: ['id', 'title'],
        filters: {
          status: 'open',
          assigned_to_user_id: null,
        },
        orderBy: {
          column: 'last_seen_at',
          direction: 'desc',
        },
        limit: 5,
      })
      .expect(200);

    const query = executor.mock.calls[0]?.[0];
    expect(query?.text).toContain('SELECT "id", "title"');
    expect(query?.text).toContain('FROM "public"."error_monitoring_issues"');
    expect(query?.text).toContain('"status" = $1');
    expect(query?.text).toContain('"assigned_to_user_id" IS NULL');
    expect(query?.text).toContain('ORDER BY "last_seen_at" DESC');
    expect(query?.values).toEqual(['open', 5]);
    expect(query?.text).not.toContain('open');
  });

  it('rejects unsafe identifiers before building SQL', async () => {
    const executor = jest.fn() as jest.MockedFunction<ProductionReadQueryExecutor>;
    const app = createProductionReadConnectorApp(config(), executor);

    await request(app)
      .post('/tables/read')
      .set(authHeader)
      .send({
        schema: 'public',
        table: 'error_monitoring_issues;drop_table_users',
      })
      .expect(400);

    expect(executor).not.toHaveBeenCalled();
  });
});
