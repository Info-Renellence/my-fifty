// History's emails (api/_email.js, owner 2026-10-28): only what was written this time.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../api/_email');

const SAM = [
  'Thanks for letting me know, I would love to come in and see Dr Tania.  Would she happen to have a small window open On October 30th by chance?',
  '', '', '', 'Looking forward to your reply :)', '', '', '', 'Warmly,', '', '', '', 'Samantha Almas', '', 'Senior Aesthetic Business Manager, Ontario', '',
  'Renellence Inc.', '', '289.923.0633 | sam.almas@renellence.com: mailto:sam.almas@renellence.com', '', 'www.renellence.com: https://www.renellence.com/', '',
  'Book a Meeting With Me: https://meetings-na3.hubspot.com/sam-almas | Become a Renellence Partner: https://onboarding.renellence.com/?rep=r7dnw4 --',
  'Prefer fewer emails from me? Click here: https://dMml0304.na3.hs-sales-sub.com/preferences/en/single?data=W2n', '',
  'On Tuesday, October 20, 2026, 8:48:46 p.m. -0400, "service thelaserclinic.ca" <service@thelaserclinic.ca> wrote:', '>Hi Samantha,', '>old',
].join('\r\n');

test('a rep\'s reply: the message, the sign-off and the name; no signature, footer, links or quoted thread', () => {
  const out = E.cleanEmail(SAM);
  assert.equal(out, 'Thanks for letting me know, I would love to come in and see Dr Tania.  Would she happen to have a small window open On October 30th by chance?\n\nLooking forward to your reply :)\n\nWarmly,\nSamantha Almas');
});

test('a reply from a clinic: links read as text, "Sent from my iPhone" and the quote are gone', () => {
  const out = E.cleanEmail('Hi Sam,\n\nOur menu is at https://www.theclinic.ca/menu?x=1 and you can book <https://cal.com/x>.\n\nBest regards,\nJessica\nThe Laser Clinic\n\nSent from my iPhone\n\nOn Oct 20, 2026, at 8:13 PM, Samantha Almas <sam@renellence.com> wrote:\n> old');
  assert.equal(out, 'Hi Sam,\n\nOur menu is at theclinic.ca and you can book.\n\nBest regards,\nJessica');
});

test('Outlook\'s From/Sent block is the thread; a "From:" in the text is not; nothing left keeps the original', () => {
  assert.equal(E.cleanEmail('Sounds good.\n\nFrom: Sam Almas\nSent: Monday\nTo: x\n\nold'), 'Sounds good.');
  assert.equal(E.cleanEmail('From: the front desk, we are closed Monday.'), 'From: the front desk, we are closed Monday.');
  assert.equal(E.cleanEmail('> only a quote'), '> only a quote');
});

test('forHistory: the subject apart, and the whole email only when something was left out', () => {
  const a = E.forHistory('Re: Intro', SAM);
  assert.equal(a.subject, 'Re: Intro');
  assert.ok(a.full.includes('Prefer fewer emails'));
  assert.equal(E.forHistory('Hi', 'Short note.').full, '');
});
