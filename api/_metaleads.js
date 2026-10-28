// Meta lead-form leads, read by Pulse itself (owner 2026-10-28: "pulse reads meta directly"), so the old Edge feed
// (renellence-edge main api/_ads.js metaLeads, /api/reports?kind=adleads-feed) can be retired at the switch. The same reading
// as that feed: every lead form of every Page the ad account promotes, each read with the Page's own token, leads since a
// moment. The rep comes from the postal area (api/_territory.js, a copy of Edge's rules), else the province; Yousef's
// hand-assigned list (REP_SAID) wins over both. Two reps sharing an area come back as "Lucas or Sam" (an admin assigns).
// Not carried over: the reps' Google lead sheets (Tracking sheets were dropped, owner 2026-10-28).
//   META_ADS_TOKEN (a token with leads_retrieval + pages_manage_ads), META_AD_ACCOUNTS (first = the account whose Pages are
//   read; default sayphacanada ads), META_API_VERSION (optional; a version Meta names as newer is taken by itself).
'use strict';
const TERRITORY = require('./_territory');

const GRAPH = 'https://graph.facebook.com';
const ACCOUNT = () => String(process.env.META_AD_ACCOUNTS || '882258327950643').split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean)[0];
const token = () => process.env.META_ADS_TOKEN || '';
const ready = () => !!token();
let apiVersion = process.env.META_API_VERSION || 'v26.0';

async function graph(tok, path, params, retried) {
  const qs = Object.keys(params || {}).map((k) => k + '=' + encodeURIComponent(params[k])).join('&');
  const used = apiVersion;
  let url = GRAPH + '/' + used + '/' + path + '?' + qs + '&access_token=' + encodeURIComponent(tok);
  const out = [];
  for (let page = 0; page < 20 && url; page++) {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    const named = j.error && Number(j.error.code) === 2635 && /latest version: (v\d+\.\d+)/.exec(String(j.error.message || ''));
    if (named && named[1] !== used && !retried) { apiVersion = named[1]; return graph(tok, path, params, true); }
    if (!r.ok || j.error) throw new Error('meta_' + ((j.error && j.error.code) || r.status) + (j.error && j.error.message ? ': ' + String(j.error.message).slice(0, 160) : ''));
    if (!Array.isArray(j.data)) return j;
    out.push(...j.data);
    url = j.paging && j.paging.next;
  }
  return out;
}

// Provinces no postal rule covers (Edge's TR_PROV_RULE).
const PROV_REP = { MB: 'Emily', SK: 'Emily', NB: 'Emily', NS: 'Emily', PE: 'Emily', NL: 'Emily' };
const PROV_CODE = { ontario: 'ON', ont: 'ON', on: 'ON', 'british columbia': 'BC', bc: 'BC', alberta: 'AB', ab: 'AB', quebec: 'QC', qc: 'QC', que: 'QC',
  manitoba: 'MB', mb: 'MB', saskatchewan: 'SK', sk: 'SK', 'new brunswick': 'NB', nb: 'NB', 'nova scotia': 'NS', ns: 'NS',
  'prince edward island': 'PE', pe: 'PE', pei: 'PE', 'newfoundland and labrador': 'NL', newfoundland: 'NL', nl: 'NL',
  yukon: 'YT', yt: 'YT', 'northwest territories': 'NT', nt: 'NT', nunavut: 'NU', nu: 'NU' };
const PROV_START = [[/^brit|^b\.?\s?c\b|colomb/, 'BC'], [/^alb|^alta/, 'AB'], [/^qu|^qc|^pq/, 'QC'], [/^ont/, 'ON'], [/^manit/, 'MB'], [/^sask/, 'SK'],
  [/^new\s?bruns/, 'NB'], [/^nova/, 'NS'], [/^prince|^p\.?e\.?i/, 'PE'], [/^newf|^labrad/, 'NL']];
function provCode(v) {
  const s = String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\.$/, '');
  return PROV_CODE[s] || (PROV_START.find((p) => p[0].test(s)) || [])[1] || '';
}
// Yousef 2026-10-14: leads Edge could not place; by email, wins over everything.
const REP_SAID = { 'danielkandaeya@gmail.com': 'Sam', 'therese@thebeautyinitiative.com': 'Emily', 'latifiannazila@gmail.com': 'Sam' };
const LEAD_FIELDS = { first_name: 'first', last_name: 'last', full_name: 'full', email: 'email', phone_number: 'phone', city: 'city',
  post_code: 'postal', zip_code: 'postal', postal_code: 'postal', zip: 'postal', province: 'province', state: 'province', company_name: 'clinic' };

// One Meta lead -> the shape api/_meta.js takes (the same as the old Edge feed's).
function leadRow(l, form, page) {
  const got = {};
  (l.field_data || []).forEach((f) => {
    const value = (f.values || []).join(', ').trim(), key = String(f.name || '');
    const known = LEAD_FIELDS[key.toLowerCase()];
    if (known) { got[known] = value; return; }
    if (!got.clinic && /clinic|company|business/i.test(key)) { got.clinic = value; return; }
    if (!got.postal && /postal|post_code|zip/i.test(key)) { got.postal = value; return; }
    if (!got.province && /province|state|region/i.test(key)) { got.province = value; return; }
    if (!got.city && /\bcity|ville/i.test(key)) got.city = value;
  });
  const fsa = TERRITORY.fsaOf(got.postal), pv = provCode(got.province);
  const rule = fsa ? TERRITORY.ruleFor(fsa) : TERRITORY.placeRule(pv || got.province, got.city);
  const said = REP_SAID[String(got.email || '').trim().toLowerCase()] || '';
  const rep = said || (rule ? rule.reps.join(' or ') : PROV_REP[pv] || '');
  return { id: String(l.id), at: String(l.created_time || ''), ts: Date.parse(l.created_time || '') || 0,
    name: [got.first, got.last].filter(Boolean).join(' ') || got.full || got.email || 'No name',
    email: got.email || '', phone: got.phone || '', clinic: got.clinic || '', city: got.city || '', postal: got.postal || '',
    province: pv || got.province || '', rep, repFrom: said ? 'said' : rule ? (fsa ? 'postal' : 'province') : rep ? 'province' : '',
    form: form.name || '', page: page.name || '', campaign: String(l.campaign_name || ''), ad: String(l.ad_name || ''), organic: !!l.is_organic };
}

// Every lead since sinceMs (ms), newest first, and the forms that could not be read.
async function leadsSince(sinceMs) {
  const tok = token();
  if (!tok) throw new Error('meta_not_connected');
  const pages = await graph(tok, 'act_' + ACCOUNT() + '/promote_pages', { fields: 'id,name', limit: 50 });
  const out = [], failed = [];
  for (const page of pages) {
    const pageToken = ((await graph(tok, page.id, { fields: 'access_token' }).catch(() => ({}))).access_token) || tok;
    const forms = await graph(pageToken, page.id + '/leadgen_forms', { fields: 'id,name,status,leads_count', limit: 100 });
    for (const form of forms) {
      if (form.leads_count != null && !(Number(form.leads_count) > 0)) continue;
      try {
        const leads = await graph(pageToken, form.id + '/leads', Object.assign({ fields: 'id,created_time,field_data,ad_name,campaign_id,campaign_name,is_organic', limit: 200 },
          sinceMs ? { filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(sinceMs / 1000) }]) } : {}));
        leads.forEach((l) => out.push(leadRow(l, form, page)));
      } catch (e) { failed.push({ form: form.name || form.id, error: e.message }); }
    }
  }
  // Every form refusing is the token lacking leads_retrieval: one clear error, not a quiet empty list.
  if (!out.length && failed.length) throw new Error(failed[0].error);
  return { leads: out.sort((a, b) => b.ts - a.ts), failed, generatedAt: new Date().toISOString() };
}

module.exports = { leadsSince, leadRow, provCode, ready };
