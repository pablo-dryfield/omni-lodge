import http from 'node:http';

import {
  createPgProductionReadExecutor,
  createProductionReadConnectorApp,
  loadProductionReadConnectorConfig,
} from '../services/codexProductionReadConnectorService.js';

const config = loadProductionReadConnectorConfig();
const { executor, close } = createPgProductionReadExecutor(config);
const app = createProductionReadConnectorApp(config, executor);
const server = http.createServer(app);

const shutdown = (signal: string): void => {
  console.info(JSON.stringify({
    component: 'codex-production-read-connector',
    event: 'shutdown_requested',
    signal,
    timestampUtc: new Date().toISOString(),
  }));

  server.close((serverError) => {
    close()
      .then(() => {
        if (serverError) {
          console.error(JSON.stringify({
            component: 'codex-production-read-connector',
            event: 'shutdown_server_error',
            message: serverError.message,
            timestampUtc: new Date().toISOString(),
          }));
          process.exit(1);
        }
        process.exit(0);
      })
      .catch((closeError: unknown) => {
        console.error(JSON.stringify({
          component: 'codex-production-read-connector',
          event: 'shutdown_pool_error',
          message: closeError instanceof Error ? closeError.message : 'unknown error',
          timestampUtc: new Date().toISOString(),
        }));
        process.exit(1);
      });
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(config.port, config.host, () => {
  console.info(JSON.stringify({
    component: 'codex-production-read-connector',
    event: 'listening',
    host: config.host,
    port: config.port,
    timestampUtc: new Date().toISOString(),
  }));
});
