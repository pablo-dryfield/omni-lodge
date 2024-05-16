import express from 'express';
import https from 'https';
import fs from 'fs';
import path, { dirname }  from 'path';
import { fileURLToPath } from 'url';
import logger from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Serve static files from the 'build' directory
app.use(express.static(path.join(__dirname, '..', 'ui', 'build')));

// Route for serving the index.html file (for client-side routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'ui', 'build', 'index.html'));
});

if(process.env.NODE_ENV === 'production'){
  // Define the directory path where the SSL certificate files are located
  const sslDir = path.join(__dirname, '..', 'be', 'src','ssl');

  // Read SSL certificate and private key files
  const options = {
    key: fs.readFileSync(path.join(sslDir, 'omni-lodge.work.gd.key')), // Read the private key file
    cert: fs.readFileSync(path.join(sslDir, 'omni-lodge.work.gd.cer')), // Read the SSL certificate file
    ca: fs.readFileSync(path.join(sslDir, 'ca.cer')), // Read the CA certificate file (if applicable)
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