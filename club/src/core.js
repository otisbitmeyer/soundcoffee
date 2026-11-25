// Sound Coffee Club sign-up: payload building and gift-wrapping (NIP-59 / NIP-17).
// No DOM code here, so the same functions run in the page and in tests.
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { wrapEvent } from 'nostr-tools/nip59'
import * as nip19 from 'nostr-tools/nip19'

export const SCHEMA = 'sound-coffee-signup/3'

// ---------- Pricing ----------
// Most bags allowed in one roast/order, from the pound limit.
export const maxBags = p => Math.max(1, Math.floor(p.maxLbsPerMonth / p.bagLbs))

// Discounts add up: bag discount % + prepay % (club only), taken off the full price.
export function bagDiscountPct(pricing, bags) {
  let pct = 0
  for (const s of pricing.bagDiscounts) if (bags >= s.minBags) pct = Math.max(pct, s.pct)
  return pct
}
export function nextBagStep(pricing, bags) {
  const cur = bagDiscountPct(pricing, bags)
  return pricing.bagDiscounts.filter(s => s.minBags > bags && s.pct > cur && s.minBags <= maxBags(pricing))
    .sort((a, b) => a.minBags - b.minBags)[0] || null
}

// Shipping is worked out when each box ships, except for members who prepay the year.
// Returns 'included' | 'at-shipping' | 'none' (pickup).
export function shippingRule(sel) {
  if (sel.delivery === 'pickup') return 'none'
  if (sel.kind === 'club' && sel.plan === 'prepay') return 'included'
  return 'at-shipping'
}

// sel = { kind: 'club'|'once', bags, cadence, plan: 'prepay'|'per-roast', delivery }
// Coffee only (shipping is billed separately unless included). Amounts in cents (usd) and sats.
export function quote(C, sel) {
  const p = C.pricing
  const bags = Math.max(1, Math.min(maxBags(p), sel.bags | 0))
  const club = sel.kind === 'club'
  const cad = club ? (C.cadences.find(c => c.id === sel.cadence) || C.cadences[0]) : null
  const bagPct = club ? bagDiscountPct(p, bags) : 0
  const prepayPct = club && sel.plan === 'prepay' ? p.prepayPct : 0
  const mk = unit => {
    const full = unit * bags
    const perDelivery = Math.round(full * (100 - bagPct - prepayPct) / 100)
    return club
      ? { full, perDelivery, deliveries: cad.perYear, yearFull: full * cad.perYear, year: perDelivery * cad.perYear }
      : { full, perDelivery: full, total: full }
  }
  return {
    bags, lbs: +(bags * p.bagLbs).toFixed(2), bagPct, prepayPct,
    shipping: shippingRule(sel),
    usd: mk(Math.round(p.bagUsd * 100)),
    sats: mk(Math.round(p.bagSats))
  }
}

// Which currency a payment method shows prices in.
export const currencyFor = pay => (pay === 'ln' || pay === 'btc') ? 'sats' : 'usd'

// Accepts npub… or 64-char hex. Returns hex or null.
export function toHexPubkey(s) {
  s = (s || '').trim()
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase()
  try {
    const d = nip19.decode(s)
    if (d.type === 'npub') return d.data
    if (d.type === 'nprofile') return d.data.pubkey
  } catch (_) {}
  return null
}

export function newSignupId() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const b = crypto.getRandomValues(new Uint8Array(6))
  return 'SC-' + Array.from(b, x => a[x % a.length]).join('')
}

// form = plain object from the page. Returns the record the ledger stores.
// The quote is a snapshot of what the customer saw; the ledger re-checks it.
export function buildPayload(form, C, now = new Date()) {
  const needsAddress = form.delivery === 'ship' || form.delivery === 'deliver'
  const kind = form.kind === 'once' ? 'once' : 'club'
  const cad = kind === 'club' ? (C.cadences.find(c => c.id === form.cadence) || C.cadences[0]) : null
  const q = quote(C, { kind, bags: +form.bags, cadence: form.cadence, plan: form.plan, delivery: form.delivery })
  return {
    schema: SCHEMA,
    id: form.id || newSignupId(),
    submittedAt: now.toISOString(),
    kind,
    name: form.name.trim(),
    email: (form.email || '').trim(),
    npub: (form.npub || '').trim(),
    bags: q.bags,
    cadence: cad ? { id: cad.id, label: cad.label, perYear: cad.perYear } : null,
    plan: kind === 'club' ? (form.plan === 'prepay' ? 'prepay' : 'per-roast') : 'on-ship',
    lbs: q.lbs,
    shipping: q.shipping,   // 'included' | 'at-shipping' | 'none'
    currency: currencyFor(form.pay),
    quote: { bagPct: q.bagPct, prepayPct: q.prepayPct, usdCents: q.usd, sats: q.sats },
    delivery: {
      method: form.delivery,
      address: needsAddress ? {
        line1: (form.line1 || '').trim(), line2: (form.line2 || '').trim(),
        city: (form.city || '').trim(), region: (form.region || '').trim(),
        postal: (form.postal || '').trim(), country: (form.country || '').trim()
      } : null
    },
    pay: form.pay,           // "usd" | "ln" | "btc" | "cash"
    notes: (form.notes || '').trim()
  }
}

const PAY_LABEL = { usd: 'Dollars (card, via Square)', ln: 'Bitcoin, Lightning', btc: 'Bitcoin, on-chain', cash: 'Cash' }
const DELIVERY_LABEL = { ship: 'Ship it', deliver: 'Hand delivery', pickup: 'Pickup' }

// Human-readable text first, so it also reads well in any NIP-17 DM app.
// The JSON after the marker line is what the ledger parses.
export const usd = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })
export const sats = n => n.toLocaleString('en-US') + ' sats'

const SHIP_LABEL = { included: 'shipping included', 'at-shipping': 'shipping billed when it ships', none: 'pickup' }

export function messageText(p) {
  const L = [], q = p.quote
  const money = k => p.currency === 'sats' ? sats(q.sats[k]) : usd(q.usdCents[k])
  const bagTxt = `${p.bags} bag${p.bags > 1 ? 's' : ''} (${p.lbs} lb)`
  L.push((p.kind === 'club' ? 'New Sound Coffee Club sign-up ' : 'New order-once ') + p.id)
  L.push('Name: ' + p.name)
  if (p.email) L.push('Email: ' + p.email)
  if (p.npub) L.push('Nostr: ' + p.npub)
  if (p.kind === 'club') {
    L.push(`Club: ${bagTxt}, ${p.cadence.label.toLowerCase()} (${p.cadence.perYear} roasts a year)`)
    L.push('Plan: ' + (p.plan === 'prepay' ? 'pay the year up front' : 'pay as each roast ships'))
    L.push(`Quote: ${q.bagPct + q.prepayPct}% off, ${money('perDelivery')} per roast, ${money('year')} a year, ${SHIP_LABEL[p.shipping]}`)
  } else {
    L.push(`Order once: ${bagTxt}, paid once it ships`)
    L.push(`Quote: ${money('total')} for coffee, ${SHIP_LABEL[p.shipping]}`)
  }
  L.push('Delivery: ' + (DELIVERY_LABEL[p.delivery.method] || p.delivery.method))
  const a = p.delivery.address
  if (a) L.push('Address: ' + [a.line1, a.line2, a.city, a.region, a.postal, a.country].filter(Boolean).join(', '))
  L.push('Pays with: ' + (PAY_LABEL[p.pay] || p.pay))
  if (p.notes) L.push('Notes: ' + p.notes)
  L.push('', '-----BEGIN SIGNUP JSON-----', JSON.stringify(p), '-----END SIGNUP JSON-----')
  return L.join('\n')
}

// Parse a received message back into the record (for the ledger side).
export function parseMessage(text) {
  const m = /-----BEGIN SIGNUP JSON-----\n([\s\S]*?)\n-----END SIGNUP JSON-----/.exec(text || '')
  if (!m) return null
  const p = JSON.parse(m[1])
  return p && p.schema === SCHEMA ? p : null
}

// Gift-wraps the sign-up to the orders key with a throwaway sender key.
export function wrapSignup(payload, recipientHex) {
  const sk = generateSecretKey()
  const rumor = {
    kind: 14,
    content: messageText(payload),
    tags: [['p', recipientHex], ['subject', 'Club sign-up ' + payload.id], ['t', 'sound-coffee-signup']],
    created_at: Math.floor(Date.now() / 1000)
  }
  return { wrap: wrapEvent(rumor, sk, recipientHex), senderPubkey: getPublicKey(sk) }
}

// Publish one event to several relays over plain WebSockets.
// Resolves with per-relay results once every relay answered or timed out.
export function publish(event, relays, timeoutMs = 8000, WS = globalThis.WebSocket) {
  return Promise.all(relays.map(url => new Promise(resolve => {
    let done = false, ws
    const finish = (ok, msg) => { if (done) return; done = true; try { ws && ws.close() } catch (_) {} resolve({ url, ok, msg }) }
    const t = setTimeout(() => finish(false, 'timed out'), timeoutMs)
    try {
      ws = new WS(url)
      ws.onopen = () => ws.send(JSON.stringify(['EVENT', event]))
      ws.onmessage = e => {
        try {
          const m = JSON.parse(e.data)
          if (m[0] === 'OK' && m[1] === event.id) { clearTimeout(t); finish(!!m[2], m[3] || '') }
        } catch (_) {}
      }
      ws.onerror = () => { clearTimeout(t); finish(false, 'could not connect') }
    } catch (err) { clearTimeout(t); finish(false, String(err)) }
  })))
}
