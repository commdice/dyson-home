// Loads and validates settings from environment variables.

function required(env, name) {
  const v = env[name];
  if (!v || !v.trim()) throw new Error(`Missing required setting: ${name}`);
  return v.trim();
}

function list(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PORT || 3000),
    publicBaseUrl: required(env, 'PUBLIC_BASE_URL').replace(/\/+$/, ''),

    twilio: {
      accountSid: required(env, 'TWILIO_ACCOUNT_SID'),
      authToken: required(env, 'TWILIO_AUTH_TOKEN'),
      // The Twilio number customers call. Texts are sent from it too.
      phoneNumber: required(env, 'TWILIO_PHONE_NUMBER'),
      // Optional: a Messaging Service SID (needed for US A2P 10DLC sending).
      messagingServiceSid: (env.TWILIO_MESSAGING_SERVICE_SID || '').trim() || null,
      validateSignatures: env.TWILIO_VALIDATE_SIGNATURES !== 'false',
    },

    business: {
      name: required(env, 'BUSINESS_NAME'),
      // Where incoming calls ring (the shop's real phone). Comma-separate to ring several at once.
      forwardTo: list(required(env, 'FORWARD_TO')),
      ringSeconds: Number(env.RING_SECONDS || 20),
      // Who gets a copy of customer text replies (owner / manager cells).
      notifyNumbers: list(env.NOTIFY_NUMBERS),
      timezone: env.TIMEZONE || 'America/New_York',
      hours: env.BUSINESS_HOURS || 'mon-fri 08:00-17:00',
    },

    textback: {
      cooldownHours: Number(env.COOLDOWN_HOURS || 12),
      missedMessage:
        env.MISSED_MESSAGE ||
        "Hi, this is {business}. Sorry we missed your call! How can we help? Reply here and we'll get right back to you.",
      afterHoursMessage:
        env.AFTER_HOURS_MESSAGE ||
        "Hi, this is {business}. We're closed right now but got your call. Reply with what you need and we'll get back to you first thing.",
      afterHoursGreeting:
        env.AFTER_HOURS_GREETING ||
        "Thanks for calling {business}. We're closed right now. We'll send you a text message so you can tell us what you need. Goodbye.",
      missedGreeting:
        env.MISSED_GREETING ||
        "Sorry, nobody could get to the phone. We'll text you in a moment. Goodbye.",
    },

    admin: {
      user: env.ADMIN_USER || 'admin',
      password: (env.ADMIN_PASSWORD || '').trim() || null,
    },

    dbPath: env.DB_PATH || 'data/textback.db',
  };

  if (!config.twilio.validateSignatures) {
    console.warn('WARNING: Twilio signature validation is OFF. Only do this for local testing.');
  }
  return config;
}

export function fill(template, config) {
  return template.replaceAll('{business}', config.business.name);
}
