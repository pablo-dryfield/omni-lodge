import express from 'express';
import https from 'https';
import fs from 'fs';
import path, { dirname }  from 'path';
import { fileURLToPath } from 'url';
import logger from './utils/logger.js';
import { createProxyMiddleware } from 'http-proxy-middleware';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const uiBuildPath = path.join(__dirname, '..', 'ui', 'build');
const uiIndexFile = path.join(uiBuildPath, 'index.html');
const uiServerPort = Number.parseInt(process.env.UI_SERVER_PORT ?? '3005', 10);

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

const setNoCacheHeaders = (res) => {
  Object.entries(NO_CACHE_HEADERS).forEach(([header, value]) => {
    res.setHeader(header, value);
  });
};

const validateUiBuildAssets = () => {
  try {
    const html = fs.readFileSync(uiIndexFile, 'utf8');
    const references = [...html.matchAll(/(?:src|href)="(\/static\/[^"]+)"/g)].map((match) => match[1]);
    const missingAssets = references.filter((assetPath) => {
      const normalizedPath = assetPath.replace(/^\//, '');
      return !fs.existsSync(path.join(uiBuildPath, normalizedPath));
    });

    if (missingAssets.length > 0) {
      logger.error(`[ui] Missing assets referenced in index.html: ${missingAssets.join(', ')}`);
    }
  } catch (error) {
    logger.error('[ui] Unable to validate build asset references', error);
  }
};

const app = express();
app.set('trust proxy', 1);

app.use(
  '/api',
  createProxyMiddleware({
    target: 'http://127.0.0.1:3001',
    changeOrigin: false,
    xfwd: true,
    ws: true,
    proxyTimeout: 30000,
    pathRewrite: (path) => `/api${path}`,  
  })
);

// Serve static files from the 'build' directory
app.use(
  express.static(uiBuildPath, {
    index: false,
    setHeaders: (res, filePath) => {
      const filename = path.basename(filePath);

      if (filename === 'index.html' || filename === 'asset-manifest.json' || filename === 'service-worker.js') {
        setNoCacheHeaders(res);
        return;
      }

      if (/\.[a-f0-9]{8,}\./i.test(filename)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }),
);

// catch-all only for non-API routes
app.get(/^\/(?!api).*/, (req, res) => {
  if (path.extname(req.path)) {
    res.status(404).type('text/plain').send('Not Found');
    return;
  }

  setNoCacheHeaders(res);
  res.sendFile(uiIndexFile);
});

validateUiBuildAssets();

if(process.env.NODE_ENV === 'production'){
  // Define the directory path where the SSL certificate files are located
  const sslDir = path.join(__dirname, '..', 'be', 'src','ssl');

  // Read SSL certificate and private key files
  const options = {
    key: fs.readFileSync(path.join(sslDir, 'cf-origin.key')), // Read the private key file
    cert: fs.readFileSync(path.join(sslDir, 'cf-origin.pem')), // Read the SSL certificate file
  };
  const server = https.createServer(options, app);
  server.listen(443, '0.0.0.0', () => {
    logger.info(`Server is running on port 443`);
});
}else{
  app.listen(uiServerPort, '0.0.0.0', () => {
    logger.info(`Server is running on port ${uiServerPort}`);
  });
}
