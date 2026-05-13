'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, 'dist');
const port = Number(process.env.PORT || 8090);
const logPath = path.join(__dirname, 'preview.log');

function log(message) {
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
}

process.on('uncaughtException', error => {
  log(`uncaughtException ${error.stack || error.message}`);
  process.exit(1);
});

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(root, safePath === '/' ? 'index.html' : safePath);

  if (!filePath.startsWith(root)) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (error, body) => {
    if (error) {
      fs.readFile(path.join(root, 'index.html'), (indexError, indexBody) => {
        if (indexError) send(res, 404, 'Not found');
        else send(res, 200, indexBody, types['.html']);
      });
      return;
    }
    send(res, 200, body, types[path.extname(filePath)] || 'application/octet-stream');
  });
});

server.listen(port, () => {
  log(`Preview running at http://localhost:${port}`);
  console.log(`Preview running at http://localhost:${port}`);
});
