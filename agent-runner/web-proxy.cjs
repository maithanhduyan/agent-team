// Minimal HTTP + WebSocket proxy for the business-owner command center.
//
// `dsh web` only binds 127.0.0.1 inside the container (0.0.0.0 is blocked
// by DSH for safety). Docker port publishing targets the container's eth0,
// so this proxy listens on 0.0.0.0:3081 and forwards to 127.0.0.1:3080,
// keeping the original Host header so the browser-trust fence still sees
// the loopback origin (e.g. localhost:3080) and accepts /api calls.
//
// Retries ECONNREFUSED with backoff so it survives dsh web booting after
// the proxy starts.
'use strict';
const http = require('http');
const net = require('net');

const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 3080;
const LISTEN_HOST = '0.0.0.0';
const LISTEN_PORT = 3081;
const MAX_ATTEMPTS = 60; // ~60s of retrying while dsh web boots
const RETRY_MS = 1000;

function forward(req, res, attempts) {
  const proxy = http.request({
    host: TARGET_HOST,
    port: TARGET_PORT,
    method: req.method,
    path: req.url,
    headers: req.headers,
  }, (pres) => {
    res.writeHead(pres.statusCode, pres.headers);
    pres.pipe(res);
  });
  proxy.on('error', (err) => {
    if (err.code === 'ECONNREFUSED' && attempts < MAX_ATTEMPTS) {
      res.on('close', () => req.destroy());
      setTimeout(() => forward(req, res, attempts + 1), RETRY_MS);
      return;
    }
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('proxy error: ' + err.message);
  });
  req.pipe(proxy);
}

const server = http.createServer((req, res) => forward(req, res, 0));

server.on('upgrade', (req, socket, head) => {
  const target = net.connect(TARGET_PORT, TARGET_HOST, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [k, v] of Object.entries(req.headers)) lines.push(`${k}: ${v}`);
    target.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) target.write(head);
  });
  target.on('error', () => socket.destroy());
  socket.pipe(target).pipe(socket);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`[web-proxy] listening on ${LISTEN_HOST}:${LISTEN_PORT} -> ${TARGET_HOST}:${TARGET_PORT}`);
});
