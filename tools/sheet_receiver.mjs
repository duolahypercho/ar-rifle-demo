// Receives contact sheets posted by demo.sheet.post(name) (src/review.js) and writes them as JPEGs.
//   node tools/sheet_receiver.mjs <out dir> [port=5199]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] || 'screenshots/sheets';
const port = +(process.argv[3] || 5199);
fs.mkdirSync(out, { recursive: true });
http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.end();
    const name = (new URL(req.url, 'http://x').searchParams.get('n') || 'sheet').replace(/[^\w.-]/g, '_');
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const ext = name.includes('.') ? '' : '.jpg';
      fs.writeFileSync(path.join(out, name + ext), Buffer.concat(parts));
      res.end('ok');
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`sheets -> ${out} on ${port}`));
