// Tiny HTTP server that serves recover.html on a given port
// Usage: node scan-ports.js 5173
//        node scan-ports.js 5175
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = parseInt(process.argv[2]) || 5173;
const html = fs.readFileSync(path.join(__dirname, 'public', 'recover.html'), 'utf-8');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Recovery page running at http://localhost:${port}/recover.html`);
  console.log('Open this URL in the SAME browser where Arnold was running.');
  console.log('Press Ctrl+C to stop.');
});
