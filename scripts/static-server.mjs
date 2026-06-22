// Minimal dependency-free static file server. Used by the recorder, the
// screenshot capture, and the verifier so they don't need an external server.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

export function serve(rootDir, port = 0) {
  const root = normalize(rootDir);
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let filePath = normalize(join(root, urlPath));
      if (!filePath.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
      let s;
      try { s = await stat(filePath); } catch { res.writeHead(404).end('not found'); return; }
      if (s.isDirectory()) filePath = join(filePath, 'index.html');
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      resolve({ server, port: p, url: `http://127.0.0.1:${p}` });
    });
  });
}

// CLI: node scripts/static-server.mjs <dir> <port>
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || 'demo';
  const port = Number(process.argv[3] || 8080);
  serve(dir, port).then(({ url }) => console.log('Serving', dir, 'at', url));
}
