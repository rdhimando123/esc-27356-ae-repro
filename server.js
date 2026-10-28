'use strict';

const http = require('http');
const zlib = require('zlib');

const PORT = process.env.PORT || 8080;
const BODY = Buffer.from(
  `<!DOCTYPE html><html><head><title>ESC-27356 AE repro</title></head>` +
    `<body><h1>ESC-27356 Accept-Encoding repro</h1>` +
    `<p>Origin negotiates Content-Encoding from Accept-Encoding and sets Cache-Control: no-store, no-transform.</p>` +
    `<p>${'x'.repeat(8000)}</p></body></html>`
);

function parseAcceptEncoding(header) {
  if (!header) return [];
  return header.split(',').map((part) => {
    const [token, ...params] = part.trim().split(';');
    let q = 1;
    for (const p of params) {
      const m = p.trim().match(/^q\s*=\s*([0-9.]+)$/i);
      if (m) q = parseFloat(m[1]);
    }
    return { token: token.trim().toLowerCase(), q };
  }).filter((x) => x.token && x.q > 0);
}

function chooseEncoding(acceptEncoding) {
  const accepted = new Set(parseAcceptEncoding(acceptEncoding).map((x) => x.token));
  // Prefer br, then gzip — mirrors typical origin + CF rewritten "br, gzip"
  if (accepted.has('br') || accepted.has('*')) return 'br';
  if (accepted.has('gzip')) return 'gzip';
  return 'identity';
}

const server = http.createServer((req, res) => {
  const ae = req.headers['accept-encoding'] || '';
  const encoding = chooseEncoding(ae);
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'Vary': 'Accept-Encoding',
    'X-Repro-Accept-Encoding': ae || '(absent)',
    'X-Repro-Chosen-Encoding': encoding,
  };

  if (req.url === '/health' || req.url === '/_health') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store, no-transform' });
    res.end('ok');
    return;
  }

  if (encoding === 'br') {
    headers['Content-Encoding'] = 'br';
    res.writeHead(200, headers);
    zlib.brotliCompress(BODY, (err, out) => {
      if (err) {
        res.end(BODY);
        return;
      }
      res.end(out);
    });
    return;
  }

  if (encoding === 'gzip') {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    zlib.gzip(BODY, (err, out) => {
      if (err) {
        res.end(BODY);
        return;
      }
      res.end(out);
    });
    return;
  }

  res.writeHead(200, headers);
  res.end(BODY);
});

server.listen(PORT, () => {
  console.log(`esc-27356-ae-repro listening on ${PORT}`);
});
