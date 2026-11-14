import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { computeSignature } from '../src/twilio.js';

const BASE = 'https://textback.example.com';
const OPEN_TIME = new Date('2026-11-13T15:00:00Z'); // Fri 10:00 New York
const CLOSED_TIME = new Date('2026-11-15T15:00:00Z'); // Sunday

function setup({ time = OPEN_TIME, failSms = false, env = {} } = {}) {
  const config = loadConfig({
    PUBLIC_BASE_URL: BASE,
    TWILIO_ACCOUNT_SID: 'ACtest',
    TWILIO_AUTH_TOKEN: 'secret-token',
    TWILIO_PHONE_NUMBER: '+15550000000',
    BUSINESS_NAME: 'Acme Paint & Supply',
    FORWARD_TO: '+15551110000',
    NOTIFY_NUMBERS: '+15552220000',
    BUSINESS_HOURS: 'mon-fri 07:00-18:00',
    TIMEZONE: 'America/New_York',
    ADMIN_PASSWORD: 'pw',
    ...env,
  });
  const db = openDb(':memory:');
  const sent = [];
  const sendSms = async (to, body) => {
    if (failSms) throw new Error('boom');
    sent.push({ to, body });
  };
  const clock = { now: time };
  const log = { error() {}, warn() {}, log() {} };
  const handler = createApp({ config, db, sendSms, now: () => clock.now, log });

  // Each request resolves only after the handler finishes, including post-response texting.
  async function post(path, params, { sign = true } = {}) {
    const server = createServer();
    let done;
    const finished = new Promise((r) => (done = r));
    server.on('request', async (req, res) => {
      await handler(req, res);
      done();
    });
    await new Promise((r) => server.listen(0, r));
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (sign) headers['X-Twilio-Signature'] = computeSignature('secret-token', BASE + path, params);
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST',
      headers,
      body: new URLSearchParams(params),
    });
    const text = await res.text();
    await finished;
    server.close();
    return { status: res.status, text };
  }

  async function get(path, headers = {}) {
    const server = createServer(handler);
    await new Promise((r) => server.listen(0, r));
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers });
    const text = await res.text();
    server.close();
    return { status: res.status, text };
  }

  return { config, db, sent, clock, post, get };
}

const CALLER = '+15553334444';

test('during hours, incoming call is forwarded to the shop phone', async () => {
  const { post, sent } = setup();
  const r = await post('/voice/incoming', { CallSid: 'CA1', From: CALLER });
  assert.equal(r.status, 200);
  assert.match(r.text, /<Dial timeout="20" action="https:\/\/textback\.example\.com\/voice\/dial-status"/);
  assert.match(r.text, /<Number>\+15551110000<\/Number>/);
  assert.equal(sent.length, 0);
});

test('unanswered call texts the caller back', async () => {
  const { post, sent, db } = setup();
  await post('/voice/incoming', { CallSid: 'CA1', From: CALLER });
  const r = await post('/voice/dial-status', { CallSid: 'CA1', From: CALLER, DialCallStatus: 'no-answer' });
  assert.match(r.text, /<Say>/);
  assert.deepEqual(sent.map((s) => s.to), [CALLER]);
  assert.match(sent[0].body, /Acme Paint & Supply/);
  const call = db.getCall('CA1');
  assert.equal(call.outcome, 'missed');
  assert.equal(call.texted, 1);
});

test('answered call does not text', async () => {
  const { post, sent, db } = setup();
  await post('/voice/dial-status', { CallSid: 'CA1', From: CALLER, DialCallStatus: 'completed' });
  assert.equal(sent.length, 0);
  assert.equal(db.getCall('CA1').outcome, 'answered');
});

test('busy and caller-hung-up also count as missed', async () => {
  for (const status of ['busy', 'canceled', 'failed']) {
    const { post, sent } = setup();
    await post('/voice/dial-status', { CallSid: 'CA-' + status, From: CALLER, DialCallStatus: status });
    assert.equal(sent.length, 1, status);
  }
});

test('after hours: greeting, no ringing, after-hours text', async () => {
  const { post, sent, db } = setup({ time: CLOSED_TIME });
  const r = await post('/voice/incoming', { CallSid: 'CA9', From: CALLER });
  assert.doesNotMatch(r.text, /<Dial/);
  assert.match(r.text, /closed/);
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /closed/);
  assert.equal(db.getCall('CA9').outcome, 'after_hours');
});

test('cooldown: same caller is not texted twice in a row', async () => {
  const { post, sent, db, clock } = setup();
  await post('/voice/dial-status', { CallSid: 'CA1', From: CALLER, DialCallStatus: 'no-answer' });
  await post('/voice/dial-status', { CallSid: 'CA2', From: CALLER, DialCallStatus: 'no-answer' });
  assert.equal(sent.length, 1);
  assert.equal(db.getCall('CA2').skip_reason, 'cooldown');

  clock.now = new Date(Date.now() + 13 * 3600_000); // past the 12h cooldown
  await post('/voice/dial-status', { CallSid: 'CA3', From: CALLER, DialCallStatus: 'no-answer' });
  assert.equal(sent.length, 2);
});

test('blocked caller ID and staff numbers are never texted', async () => {
  const { post, sent, db } = setup();
  await post('/voice/dial-status', { CallSid: 'CA1', From: 'anonymous', DialCallStatus: 'no-answer' });
  await post('/voice/dial-status', { CallSid: 'CA2', From: '+266696687', DialCallStatus: 'no-answer' });
  await post('/voice/dial-status', { CallSid: 'CA3', From: '+15552220000', DialCallStatus: 'no-answer' });
  assert.equal(sent.length, 0);
  assert.equal(db.getCall('CA1').skip_reason, 'no_caller_id');
  assert.equal(db.getCall('CA3').skip_reason, 'internal_number');
});

test('SMS failure is logged and does not break the call', async () => {
  const { post, db } = setup({ failSms: true });
  const r = await post('/voice/dial-status', { CallSid: 'CA1', From: CALLER, DialCallStatus: 'no-answer' });
  assert.equal(r.status, 200);
  assert.equal(db.getCall('CA1').skip_reason, 'send_failed');
});

test('customer reply is forwarded to the owner', async () => {
  const { post, sent, db } = setup();
  await post('/sms/incoming', { From: CALLER, Body: 'Need 5 gal of Navajo White' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '+15552220000');
  assert.match(sent[0].body, /Navajo White/);
  assert.match(sent[0].body, /\+15553334444/);
  assert.equal(db.recentMessages()[0].direction, 'in');
});

test('owner can reply to a customer from the business number', async () => {
  const { post, sent } = setup();
  await post('/sms/incoming', { From: '+15552220000', Body: `${CALLER} In stock, ready for pickup at 3.` });
  assert.deepEqual(sent, [{ to: CALLER, body: 'In stock, ready for pickup at 3.' }]);
});

test('requests without a valid Twilio signature are rejected', async () => {
  const { post, sent } = setup();
  const r = await post('/voice/dial-status', { CallSid: 'CA1', From: CALLER, DialCallStatus: 'no-answer' }, { sign: false });
  assert.equal(r.status, 403);
  assert.equal(sent.length, 0);
});

test('admin page needs login and shows activity', async () => {
  const { post, get } = setup();
  await post('/voice/dial-status', { CallSid: 'CA1', From: CALLER, DialCallStatus: 'no-answer' });
  assert.equal((await get('/admin')).status, 401);
  const auth = 'Basic ' + Buffer.from('admin:pw').toString('base64');
  const r = await get('/admin', { Authorization: auth });
  assert.equal(r.status, 200);
  assert.match(r.text, /Acme Paint &amp; Supply/);
  assert.match(r.text, /\+15553334444/);
  assert.match(r.text, /Texted ✓/);
});
