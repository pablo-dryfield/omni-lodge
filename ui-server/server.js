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

const UI_CONTENT_SECURITY_POLICY = [
  "script-src 'self' https://connect.facebook.net",
  "connect-src 'self' https://connect.facebook.net https://graph.facebook.com https://www.facebook.com https://web.facebook.com",
  "frame-src 'self' blob: data: https://www.facebook.com https://web.facebook.com",
].join('; ');

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

app.use((_req, res, next) => {
  // Keep the browser allowlist narrow while permitting Meta's official
  // Embedded Signup SDK and preserving OmniLodge's existing local previews.
  res.setHeader('Content-Security-Policy', UI_CONTENT_SECURITY_POLICY);
  next();
});

app.use(
  '/api',
  createProxyMiddleware({
    target: 'http://127.0.0.1:3001',
    changeOrigin: false,
    xfwd: true,
    ws: true,
    // Embedded Signup completes several bounded Meta calls before returning.
    proxyTimeout: 120000,
    pathRewrite: (path) => `/api${path}`,  
  })
);

// Serve static files from the 'build' directory
app.use(
  express.static(uiBuildPath, {
    index: false,
    setHeaders: (res, filePath) => {
      const filename = path.basename(filePath);

      if (filename.endsWith('.webmanifest')) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      }

      if (
        filename === 'index.html' ||
        filename === 'asset-manifest.json' ||
        filename === 'service-worker.js' ||
        filename === 'manifest.json' ||
        filename === 'pwa-manifest-selector.js' ||
        filename === 'install.html' ||
        filename.endsWith('.webmanifest')
      ) {
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
