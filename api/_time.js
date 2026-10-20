// Dates in Toronto time, which is the business's day (the day goal, the streak, EOD, "today").
const TZ = 'America/Toronto';
const DAY = 86400000;

// 'YYYY-MM-DD' of a moment, in Toronto.
const ymd = (d) => new Date(d || Date.now()).toLocaleDateString('en-CA', { timeZone: TZ });

// How far Toronto is from UTC at a moment, in minutes (-240 in summer, -300 in winter).
function offsetMin(at) {
  const d = new Date(at);
  const local = new Date(d.toLocaleString('en-US', { timeZone: TZ }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local - utc) / 60000);
}

// The UTC moment of a Toronto wall-clock time on a date: atLocal('2026-10-20', 17, 0) = 5 PM that day.
function atLocal(date, h, m) {
  const guess = Date.parse(date + 'T00:00:00Z') + ((h || 0) * 60 + (m || 0)) * 60000;
  return new Date(guess - offsetMin(guess) * 60000);
}

const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const weekday = (date) => new Date(date + 'T12:00:00Z').getUTCDay(); // 0 Sunday … 6 Saturday
const isBusinessDay = (date, holidays) => { const w = weekday(date); return w !== 0 && w !== 6 && !(holidays || []).includes(date); };

// Whole days between two moments, by Toronto calendar date.
const daysBetween = (from, to) => Math.round((Date.parse(ymd(to || Date.now()) + 'T12:00:00Z') - Date.parse(ymd(from) + 'T12:00:00Z')) / DAY);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Oct 20"
const short = (d) => { const s = ymd(d); return MONTHS[+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10)); };

module.exports = { TZ, DAY, ymd, atLocal, addDays, weekday, isBusinessDay, daysBetween, short, offsetMin, MONTHS };
