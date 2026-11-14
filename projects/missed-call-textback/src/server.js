import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createSmsSender } from './twilio.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const sendSms = createSmsSender(config.twilio);
const app = createApp({ config, db, sendSms });

createServer(app).listen(config.port, () => {
  console.log(`Missed Call Text Back for ${config.business.name} listening on :${config.port}`);
  console.log(`  Voice webhook: ${config.publicBaseUrl}/voice/incoming`);
  console.log(`  SMS webhook:   ${config.publicBaseUrl}/sms/incoming`);
  console.log(`  Dashboard:     ${config.publicBaseUrl}/admin${config.admin.password ? '' : '  (disabled: set ADMIN_PASSWORD)'}`);
});
