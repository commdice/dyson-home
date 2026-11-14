// Minimal Twilio helpers: webhook signature check, sending SMS, building TwiML.
import { createHmac, timingSafeEqual } from 'node:crypto';

// https://www.twilio.com/docs/usage/security#validating-requests
export function computeSignature(authToken, url, params) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

export function isValidSignature(authToken, url, params, signature) {
  if (!signature) return false;
  const expected = Buffer.from(computeSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function createSmsSender({ accountSid, authToken, phoneNumber, messagingServiceSid }, fetchImpl = fetch) {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  return async function sendSms(to, body) {
    const form = new URLSearchParams({ To: to, Body: body });
    if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
    else form.set('From', phoneNumber);

    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Twilio SMS failed (${res.status}): ${json.message || 'unknown error'}`);
      err.code = json.code;
      throw err;
    }
    return json;
  };
}

const escapeXml = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

export const twiml = {
  wrap: (inner) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`,
  say: (text) => `<Say>${escapeXml(text)}</Say>`,
  hangup: () => '<Hangup/>',
  dial({ numbers, timeout, action, callerId }) {
    const nums = numbers.map((n) => `<Number>${escapeXml(n)}</Number>`).join('');
    const cid = callerId ? ` callerId="${escapeXml(callerId)}"` : '';
    return `<Dial timeout="${timeout}" action="${escapeXml(action)}" method="POST" answerOnBridge="true"${cid}>${nums}</Dial>`;
  },
};
