// A stand-in for Ollama's HTTP API (/api/embed, /api/pull) for tests.
// Embeddings come from a tiny hand-made "concept" vocabulary, so words with the
// same meaning (van / truck / automobile) land close together, like a real model.
import http from 'node:http';

const CONCEPTS = [
  ['car', 'cars', 'van', 'vans', 'truck', 'automobile', 'vehicle', 'vehicles', 'transit'],
  ['backup', 'backups', 'snapshot', 'snapshots', 'restore', 'copy', 'copies', 'safeguard'],
  ['printer', 'printers', 'toner', 'ink', 'print', 'printing'],
  ['paint', 'colour', 'color', 'primer', 'tint', 'gallon'],
  ['money', 'invoice', 'invoices', 'bill', 'billing', 'payment', 'pay', 'accounting', 'quickbooks'],
  ['network', 'wifi', 'router', 'vlan', 'internet', 'gateway', 'ubiquiti'],
  ['nightly', 'night', 'evening', 'daily', 'schedule', 'scheduled'],
];
const DIM = 64;

function embedText(text) {
  const v = new Array(DIM).fill(0);
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) || []) {
    const c = CONCEPTS.findIndex((group) => group.includes(w));
    if (c >= 0) v[c] += 1;
    else { // unknown words: weak hashed noise so unrelated texts aren't identical
      let h = 0;
      for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      v[16 + (h % (DIM - 16))] += 0.15;
    }
  }
  return v;
}

export async function startFakeOllama({ hasModel = true } = {}) {
  const state = { hasModel, up: true, embedCalls: 0, embeddedTexts: [], pulls: 0, models: new Set() };
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const data = body ? JSON.parse(body) : {};
    const reply = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (!state.up) { req.socket.destroy(); return; }
    if (req.url === '/api/embed') {
      if (!state.hasModel) return reply(404, { error: `model "${data.model}" not found, try pulling it first` });
      state.embedCalls++;
      state.models.add(data.model);
      const inputs = Array.isArray(data.input) ? data.input : [data.input];
      state.embeddedTexts.push(...inputs);
      return reply(200, { model: data.model, embeddings: inputs.map(embedText) });
    }
    if (req.url === '/api/pull') {
      state.pulls++;
      state.hasModel = true;
      return reply(200, { status: 'success' });
    }
    reply(404, { error: 'not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  state.url = `http://127.0.0.1:${server.address().port}`;
  state.close = () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  return state;
}
