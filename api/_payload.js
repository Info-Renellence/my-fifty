// Records from n8n's own data, never from HubSpot (owner 2026-10-28, Option B: "n8n writes to v2 and HubSpot at the same
// time"). Each n8n HubSpot write is followed by a step that sends Pulse the same request and HubSpot's answer
// (api/intake.js). This builds, for api/intake.js, the record a write touched out of:
//   - that write itself: HubSpot's answer (its id and the fields it holds) with the request's fields on top, and the
//     links the request makes (body.associations: an order's customer, clinic and products; a note's contact);
//   - earlier writes Pulse already keeps (ingest_events, source n8n): the create that made the record, then every later
//     change to it in the order they came, so a change to one field still sees the whole record;
//   - an order's products: the line items n8n created just before the order (their request and answer are kept too).
// Nothing here calls HubSpot. A record none of n8n's writes made (an older one, or one made in HubSpot itself) is not
// found: the 5-minute HubSpot pull (the bridge) brings those in.
'use strict';

// HubSpot's association type ids (the ones n8n's writes use) -> what the link points at.
const LINK = {
  1: 'companies', 279: 'companies', 182: 'companies', 188: 'companies', 190: 'companies', 192: 'companies', 509: 'companies',
  194: 'contacts', 200: 'contacts', 202: 'contacts', 204: 'contacts', 507: 'contacts', 280: 'contacts',
  513: 'line_items',
};
const parse = (b) => (typeof b === 'string' ? (() => { try { return JSON.parse(b); } catch (e) { return {}; } })() : b || {});

// body.associations -> { contacts: [ids], companies: [...], line_items: [...] } in HubSpot's read shape.
function linksOf(body) {
  const out = {};
  for (const a of (body && body.associations) || []) {
    const id = a && a.to && a.to.id != null ? String(a.to.id) : '';
    const t = ((a && a.types) || []).map((x) => LINK[Number(x.associationTypeId)]).find(Boolean);
    if (id && t) (out[t] = out[t] || []).push(id);
  }
  return Object.fromEntries(Object.entries(out).map(([k, ids]) => [k, { results: [...new Set(ids)].map((id) => ({ id })) }]));
}
const merge = (a, b) => {
  const out = Object.assign({}, a || {});
  for (const [k, v] of Object.entries(b || {})) {
    const ids = [...new Set([...((out[k] || {}).results || []), ...(v.results || [])].map((x) => String(x.id)))];   // each link once
    out[k] = { results: ids.map((id) => ({ id })) };
  }
  return out;
};

// The records in one write: HubSpot's answer per record, the request's fields on top (the request is what n8n meant).
function recordsIn(hs) {
  const resp = hs.response || {}, body = parse(hs.body);
  const out = [];
  if (resp.id) out.push({ id: String(resp.id), properties: Object.assign({}, resp.properties || {}, body.properties || {}), associations: merge(resp.associations, linksOf(body)) });
  (resp.results || []).forEach((r, i) => {
    if (!r || !r.id) return;
    const b = (body.inputs || [])[i] || {};
    out.push({ id: String(r.id), properties: Object.assign({}, r.properties || {}, b.properties || {}), associations: linksOf(b) });
  });
  // a PATCH whose answer is short (HubSpot answers some changes with the id only): the id from the address
  const m = String(hs.url || '').match(/\/objects\/\w+\/(\d+)(?:\?|$)/);
  if (!out.length && m && body.properties) out.push({ id: m[1], properties: Object.assign({}, body.properties), associations: {} });
  return out;
}

// source(tx, hs): what api/intake.js's sync functions ask for, answered from n8n's data.
function source(tx, hs) {
  const here = new Map(recordsIn(hs).map((r) => [r.id, r]));
  // type = 'contacts' | 'companies' | 'orders' | 'calls' | 'meetings' | 'notes' | 'tasks'
  async function record(type, id) {
    id = String(id);
    const made = await tx`
      select payload from ingest_events
       where source = 'n8n' and payload->'hs'->>'method' = 'POST' and payload->'hs'->>'url' like ${'%/objects/' + type + '%'}
         and (payload->'hs'->'response'->>'id' = ${id} or payload->'hs'->'response'->'results' @> (${JSON.stringify([{ id }])}::text)::jsonb)
       order by received_at limit 1`;
    let rec = null;
    if (made.length) rec = recordsIn(made[0].payload.hs).find((r) => r.id === id) || null;
    // every later change to it, oldest first (this write included if it is one of them)
    const changes = await tx`
      select payload from ingest_events
       where source = 'n8n' and payload->'hs'->>'method' = 'PATCH' and payload->'hs'->>'url' like ${'%/objects/' + type + '/' + id}
       order by received_at`;
    for (const c of changes) {
      const r = recordsIn(c.payload.hs).find((x) => x.id === id);
      if (r) rec = { id, properties: Object.assign({}, rec ? rec.properties : {}, r.properties), associations: rec ? rec.associations : {}, partial: !rec || rec.partial };
    }
    const now = here.get(id);
    if (now) rec = { id, properties: Object.assign({}, rec ? rec.properties : {}, now.properties), associations: merge(rec && rec.associations, now.associations), partial: (!rec || rec.partial) && hs.method !== 'POST' };
    return rec;
  }
  async function lineItems(ids) {
    const out = [];
    for (const id of ids) {
      const [row] = await tx`
        select payload from ingest_events
         where source = 'n8n' and payload->'hs'->>'url' like '%/objects/line_items/batch/create%'
           and payload->'hs'->'response'->'results' @> (${JSON.stringify([{ id: String(id) }])}::text)::jsonb
         order by received_at desc limit 1`;
      const r = row && recordsIn(row.payload.hs).find((x) => x.id === String(id));
      if (r) out.push(r);
    }
    return out;
  }
  return {
    payload: true,
    contact: (id) => record('contacts', id),
    company: (id) => record('companies', id),
    order: (id) => record('orders', id),
    activity: (type, id) => record(type, id),
    lineItems,
  };
}

module.exports = { source, recordsIn, linksOf };
