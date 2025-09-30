import express from 'express';
import https from 'https';
import fs from 'fs';
import path, { dirname }  from 'path';
import { fileURLToPath } from 'url';
import logger from './utils/logger.js';
import { createProxyMiddleware } from 'http-proxy-middleware';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
app.use(express.static(path.join(__dirname, '..', 'ui', 'build')));

// catch-all only for non-API routes
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'ui', 'build', 'index.html'));
});

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
  app.listen(3000, '0.0.0.0', () => {
    logger.info(`Server is running on port 3000`);
  });
}