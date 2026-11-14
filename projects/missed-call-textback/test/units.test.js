import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHours, isOpen } from '../src/hours.js';
import { computeSignature, isValidSignature, twiml } from '../src/twilio.js';

test('business hours: open/closed in the shop timezone', () => {
  const rules = parseHours('mon-fri 07:00-18:00; sat 08:00-14:00');
  const tz = 'America/New_York';
  // Fri 2026-11-13 10:00 EST = 15:00 UTC
  assert.equal(isOpen(rules, new Date('2026-11-13T15:00:00Z'), tz), true);
  // Fri 18:30 EST -> closed
  assert.equal(isOpen(rules, new Date('2026-11-13T23:30:00Z'), tz), false);
  // Sat 13:59 EST open, 14:00 closed
  assert.equal(isOpen(rules, new Date('2026-11-14T18:59:00Z'), tz), true);
  assert.equal(isOpen(rules, new Date('2026-11-14T19:00:00Z'), tz), false);
  // Sunday closed
  assert.equal(isOpen(rules, new Date('2026-11-15T15:00:00Z'), tz), false);
});

test('business hours: wrap-around day ranges and bad input', () => {
  const rules = parseHours('sat-mon 09:00-10:00');
  assert.equal(isOpen(rules, new Date('2026-11-16T14:30:00Z'), 'America/New_York'), true); // Mon
  assert.equal(isOpen(rules, new Date('2026-11-17T14:30:00Z'), 'America/New_York'), false); // Tue
  assert.throws(() => parseHours('funday 09:00-10:00'));
  assert.throws(() => parseHours('mon 9am-5pm'));
});

test('Twilio signature matches the official example', () => {
  const params = {
    CallSid: 'CA1234567890ABCDE',
    Caller: '+12349013030',
    Digits: '1234',
    From: '+12349013030',
    To: '+18005551212',
  };
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  assert.equal(computeSignature('12345', url, params), '0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
  assert.equal(isValidSignature('12345', url, params, '0/KCTR6DLpKmkAf8muzZqo1nDgQ='), true);
  assert.equal(isValidSignature('12345', url, { ...params, Digits: '9' }, '0/KCTR6DLpKmkAf8muzZqo1nDgQ='), false);
  assert.equal(isValidSignature('12345', url, params, undefined), false);
});

test('TwiML escapes text', () => {
  assert.equal(twiml.say('Tom & Jerry <Paint>'), '<Say>Tom &amp; Jerry &lt;Paint&gt;</Say>');
});
