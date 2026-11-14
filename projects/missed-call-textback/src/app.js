// HTTP handlers for the Twilio webhooks and the admin page.
import { fill } from './config.js';
import { parseHours, isOpen } from './hours.js';
import { isValidSignature, twiml } from './twilio.js';
import { renderAdmin } from './admin.js';

const BLOCKED_CALLER_IDS = new Set(['', 'anonymous', 'restricted', 'unknown', 'private', '+266696687', '+7378742833', '+2562533', '+8656696']);

async function readForm(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

function send(res, status, body, type = 'text/xml') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

export function createApp({ config, db, sendSms, now = () => new Date(), log = console }) {
  const hours = parseHours(config.business.hours);
  const internal = new Set([...config.business.forwardTo, ...config.business.notifyNumbers, config.twilio.phoneNumber]);

  // Decide whether to text the caller, and do it. Never throws.
  async function textBack({ callSid, from, outcome, dialStatus, template }) {
    let skipReason = null;
    const number = (from || '').trim();

    if (BLOCKED_CALLER_IDS.has(number.toLowerCase()) || !number.startsWith('+')) skipReason = 'no_caller_id';
    else if (internal.has(number)) skipReason = 'internal_number';
    else {
      const last = db.lastTextedAt(number);
      if (last && now() - last < config.textback.cooldownHours * 3600_000) skipReason = 'cooldown';
    }

    let texted = false;
    if (!skipReason) {
      const body = fill(template, config);
      try {
        await sendSms(number, body);
        db.logMessage('out', number, body, 'sent');
        texted = true;
      } catch (err) {
        log.error(`Text back to ${number} failed:`, err.message);
        db.logMessage('out', number, body, 'failed');
        skipReason = 'send_failed';
      }
    }
    db.logCall({ callSid, from: number, outcome, dialStatus, texted, skipReason });
    return { texted, skipReason };
  }

  async function forwardToStaff(text) {
    await Promise.all(
      config.business.notifyNumbers.map((n) =>
        sendSms(n, text).catch((err) => log.error(`Notify ${n} failed:`, err.message)),
      ),
    );
  }

  // ---- Route handlers. Each returns { body, after } where `after` runs once the reply is sent,
  // so Twilio gets its TwiML instantly and texting never delays the caller.

  function voiceIncoming(p) {
    if (!isOpen(hours, now(), config.business.timezone)) {
      return {
        body: twiml.wrap(twiml.say(fill(config.textback.afterHoursGreeting, config)) + twiml.hangup()),
        after: () =>
          textBack({ callSid: p.CallSid, from: p.From, outcome: 'after_hours', template: config.textback.afterHoursMessage }),
      };
    }
    db.logCall({ callSid: p.CallSid, from: p.From, outcome: 'ringing' });
    return {
      body: twiml.wrap(
        twiml.dial({
          numbers: config.business.forwardTo,
          timeout: config.business.ringSeconds,
          action: `${config.publicBaseUrl}/voice/dial-status`,
        }),
      ),
    };
  }

  function dialStatus(p) {
    const status = p.DialCallStatus;
    if (status === 'completed' || status === 'answered') {
      db.logCall({ callSid: p.CallSid, from: p.From, outcome: 'answered', dialStatus: status });
      return { body: twiml.wrap(twiml.hangup()) };
    }
    // no-answer | busy | failed | canceled (caller hung up while ringing)
    return {
      body: twiml.wrap(
        (status === 'canceled' ? '' : twiml.say(fill(config.textback.missedGreeting, config))) + twiml.hangup(),
      ),
      after: () =>
        textBack({ callSid: p.CallSid, from: p.From, outcome: 'missed', dialStatus: status, template: config.textback.missedMessage }),
    };
  }

  function smsIncoming(p) {
    const from = (p.From || '').trim();
    const body = (p.Body || '').trim();

    // Staff can reply to a customer *from the business number* by texting:  +15551234567 your message
    if (config.business.notifyNumbers.includes(from)) {
      const m = /^@?(\+\d{8,15})\s+([\s\S]+)$/.exec(body);
      if (m) {
        return {
          body: twiml.wrap(''),
          after: async () => {
            try {
              await sendSms(m[1], m[2]);
              db.logMessage('out', m[1], m[2], 'sent');
            } catch (err) {
              db.logMessage('out', m[1], m[2], 'failed');
              await sendSms(from, `Couldn't send to ${m[1]}: ${err.message}`).catch(() => {});
            }
          },
        };
      }
    }

    db.logMessage('in', from, body, 'received');
    return {
      body: twiml.wrap(''),
      after: () => forwardToStaff(`Text from ${from} to ${config.business.name}:\n${body}\n\n(Reply to them by texting: ${from} your message)`),
    };
  }

  const routes = {
    'POST /voice/incoming': voiceIncoming,
    'POST /voice/dial-status': dialStatus,
    'POST /sms/incoming': smsIncoming,
  };

  function checkAdminAuth(req) {
    if (!config.admin.password) return false;
    const header = req.headers.authorization || '';
    if (!header.startsWith('Basic ')) return false;
    const [user, ...rest] = Buffer.from(header.slice(6), 'base64').toString().split(':');
    return user === config.admin.user && rest.join(':') === config.admin.password;
  }

  return async function handle(req, res) {
    const path = req.url.split('?')[0];
    try {
      if (req.method === 'GET' && path === '/health') return send(res, 200, 'ok', 'text/plain');

      if (req.method === 'GET' && path === '/admin') {
        if (!config.admin.password) return send(res, 403, 'Set ADMIN_PASSWORD to enable the admin page.', 'text/plain');
        if (!checkAdminAuth(req)) {
          res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Missed Call Text Back"' });
          return res.end('Login required');
        }
        return send(res, 200, renderAdmin(config, db), 'text/html; charset=utf-8');
      }

      const route = routes[`${req.method} ${path}`];
      if (!route) return send(res, 404, 'Not found', 'text/plain');

      const params = await readForm(req);
      if (config.twilio.validateSignatures) {
        const url = config.publicBaseUrl + req.url;
        if (!isValidSignature(config.twilio.authToken, url, params, req.headers['x-twilio-signature'])) {
          log.warn(`Rejected request with bad Twilio signature: ${req.method} ${req.url}`);
          return send(res, 403, 'Invalid signature', 'text/plain');
        }
      }

      const { body, after } = route(params);
      send(res, 200, body);
      if (after) await after();
    } catch (err) {
      log.error('Request failed:', err);
      if (!res.headersSent) send(res, 500, twiml.wrap(twiml.hangup()));
    }
  };
}
