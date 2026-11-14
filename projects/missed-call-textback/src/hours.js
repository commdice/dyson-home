// Business hours: "mon-fri 08:00-17:00; sat 09:00-13:00"
// Days not listed are closed. Times are in the configured timezone.

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Bad time "${hhmm}" (use HH:MM)`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function expandDays(spec) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.trim().toLowerCase().split('-');
    const start = DAYS.indexOf(a);
    const end = b === undefined ? start : DAYS.indexOf(b);
    if (start < 0 || end < 0) throw new Error(`Bad day range "${part}"`);
    for (let i = start; ; i = (i + 1) % 7) {
      out.add(i);
      if (i === end) break;
    }
  }
  return out;
}

export function parseHours(text) {
  const rules = [];
  for (const chunk of text.split(';')) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const [days, range] = trimmed.split(/\s+/);
    if (!range) throw new Error(`Bad hours entry "${trimmed}"`);
    const [open, close] = range.split('-').map(toMinutes);
    rules.push({ days: expandDays(days), open, close });
  }
  return rules;
}

function localDayAndMinutes(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return {
    day: DAYS.indexOf(get('weekday').toLowerCase().slice(0, 3)),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

export function isOpen(rules, date, timezone) {
  const { day, minutes } = localDayAndMinutes(date, timezone);
  return rules.some((r) => r.days.has(day) && minutes >= r.open && minutes < r.close);
}
