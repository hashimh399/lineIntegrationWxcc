// Local stand-in for SDG's callback endpoint. Prints agent replies and checks the signature.
// Usage: node scripts/mock-sdg-callback.js   (then set WIDGET_CALLBACK_URL=http://127.0.0.1:4100/callback)
const path = require('path');
const http = require('http');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const PORT = Number(process.env.MOCK_SDG_PORT) || 4100;
const secret = process.env.WIDGET_CALLBACK_SECRET;

function signatureStatus(raw, header) {
  if (!secret) return 'not checked (WIDGET_CALLBACK_SECRET unset)';
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const a = Buffer.from(String(header || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'valid' : 'INVALID';
}

http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('mock SDG callback is running');
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      body = raw.toString('utf8');
    }

    const time = new Date().toLocaleTimeString();
    console.log(`\n[${time}] ${req.method} ${req.url}  signature: ${signatureStatus(raw, req.headers['x-signature'])}`);
    if (body && body.event === 'message') {
      console.log(`  ${body.sender} -> ${body.conversationId}: ${body.text}`);
      if (body.attachments?.length) console.log('  attachments:', body.attachments);
    } else if (body && body.event) {
      console.log(`  ${body.event} for ${body.conversationId} (task ${body.taskId}, reason ${body.reason})`);
    }
    console.log('  payload:', JSON.stringify(body));

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Mock SDG callback listening on http://127.0.0.1:${PORT}/callback`);
});
