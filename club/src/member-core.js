// Sound Coffee member links: statements (ledger → member) and requests (member → ledger).
// No DOM code, so the page, the statement maker and the ledger can all share it.
//
// One random secret per member lives after the # in their link. From it we derive:
//   lookupId  – the statement file name on the website   (m/data/<lookupId>.json)
//   aesKey    – opens that file (AES-256-GCM)
//   signing key – a Nostr key that signs the member's requests, so the ledger knows
//                 a request really came from the holder of that link.
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { getPublicKey } from 'nostr-tools/pure'
import { wrapEvent, unwrapEvent } from 'nostr-tools/nip59'

export const STATEMENT_SCHEMA = 'sound-coffee-statement/1'
export const REQUEST_SCHEMA = 'sound-coffee-request/1'
export const MAX_FIELD = 2000        // longest text field the ledger will accept
export const MAX_REQUEST_BYTES = 8000

// ---------- secrets ----------
const b64u = {
  enc: b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0))
}
const b64 = {
  enc: b => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) },
  dec: s => Uint8Array.from(atob(s), c => c.charCodeAt(0))
}

export function newMemberSecret() { return b64u.enc(crypto.getRandomValues(new Uint8Array(32))) }
export function isMemberSecret(s) { return typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s) }

const derive = (label, secret) => {
  const sb = b64u.dec(secret), lb = utf8ToBytes('sound-coffee/' + label + '/')
  const m = new Uint8Array(lb.length + sb.length); m.set(lb); m.set(sb, lb.length)
  return sha256(m)
}
export function memberKeys(secret) {
  if (!isMemberSecret(secret)) throw new Error('not a member secret')
  const signSk = derive('sign', secret)
  return {
    lookupId: bytesToHex(derive('lookup', secret)).slice(0, 32),
    aesRaw: derive('key', secret),
    signSk,
    signPubkey: getPublicKey(signSk)
  }
}

// ---------- statements ----------
async function aesKey(raw, usage) { return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage]) }

export async function sealStatement(secret, statement) {
  const { aesRaw } = memberKeys(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(aesRaw, 'encrypt'),
    utf8ToBytes(JSON.stringify({ ...statement, schema: STATEMENT_SCHEMA }))))
  return { v: 1, iv: b64.enc(iv), ct: b64.enc(ct) }
}
export async function openStatement(secret, file) {
  const { aesRaw } = memberKeys(secret)
  if (!file || file.v !== 1) throw new Error('unknown statement format')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(file.iv) }, await aesKey(aesRaw, 'decrypt'), b64.dec(file.ct))
  const s = JSON.parse(new TextDecoder().decode(pt))
  if (s.schema !== STATEMENT_SCHEMA) throw new Error('unknown statement schema')
  return s
}

// ---------- money ----------
// Money = { amt: integer, cur: 'USD' (cents) | 'SAT' }
export function fmtMoney(m) {
  if (!m) return ''
  if (m.cur === 'SAT') return m.amt.toLocaleString('en-US') + ' sats'
  const c = m.amt
  return '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })
}
export const priceIn = (price, cur) => price && (cur === 'SAT'
  ? (price.sats != null ? { amt: price.sats, cur: 'SAT' } : null)
  : (price.usdCents != null ? { amt: price.usdCents, cur: 'USD' } : null))

// ---------- roast dates ----------
// Changes close when roast week starts.
export function isLate(statement, now = new Date()) {
  const c = statement.roast && statement.roast.cutoff
  if (!c) return false
  const [y, m, d] = c.split('-').map(Number)
  return now >= new Date(y, m - 1, d)
}

// ---------- requests ----------
const REQUEST_TYPES = ['skip', 'unskip', 'pause', 'resume', 'change', 'addon', 'message']

export function newRequestId() {
  return 'RQ-' + bytesToHex(crypto.getRandomValues(new Uint8Array(5))).toUpperCase()
}

export function describeRequest(r) {
  switch (r.type) {
    case 'skip': return `Skip the ${r.roastLabel || r.roastId} roast`
    case 'unskip': return `Undo skipping the ${r.roastLabel || r.roastId} roast`
    case 'pause': return `Pause until ${r.until}`
    case 'resume': return 'Start my deliveries again'
    case 'change': return `Change to ${r.bags} bag${r.bags > 1 ? 's' : ''}, ${String(r.cadenceLabel || r.cadence).toLowerCase()}`
    case 'addon': return `Add ${r.qty} × ${r.itemName} to the ${r.roastLabel || r.roastId} roast`
    case 'message': return 'Message: ' + r.text
    default: return r.type
  }
}

export function requestText(r, memberName) {
  return [
    `Request ${r.id} from ${memberName || r.memberId}`,
    describeRequest(r) + (r.late ? '\n(Sent after the cutoff.)' : ''),
    '', '-----BEGIN REQUEST JSON-----', JSON.stringify(r), '-----END REQUEST JSON-----'
  ].join('\n')
}

// Signed by the member's link key, sealed to the orders key.
export function wrapRequest(secret, statement, req) {
  const { signSk } = memberKeys(secret)
  const r = { schema: REQUEST_SCHEMA, id: req.id || newRequestId(), memberId: statement.memberId,
              sentAt: new Date().toISOString(), late: isLate(statement), ...req }
  const rumor = {
    kind: 14, created_at: Math.floor(Date.now() / 1000),
    tags: [['p', statement.ordersPubkey], ['subject', 'Member request ' + r.id], ['t', 'sound-coffee-request']],
    content: requestText(r, statement.name)
  }
  return { request: r, wrap: wrapEvent(rumor, signSk, statement.ordersPubkey) }
}

// ---------- ledger side ----------
// Opens a gift wrap with the orders key and checks it. members: Map of signPubkey → member record.
// Returns { request, member } or throws with a reason. Treat every field as plain text.
export function openRequest(wrap, ordersSk, members) {
  if (JSON.stringify(wrap).length > MAX_REQUEST_BYTES * 2) throw new Error('too large')
  const rumor = unwrapEvent(wrap, ordersSk)          // verifies the seal signature, and rumor.pubkey === seal.pubkey
  const member = members.get(rumor.pubkey)
  if (!member) throw new Error('not signed by a known member link')
  const m = /-----BEGIN REQUEST JSON-----\n([\s\S]*?)\n-----END REQUEST JSON-----/.exec(rumor.content || '')
  if (!m || m[1].length > MAX_REQUEST_BYTES) throw new Error('no request data')
  const r = JSON.parse(m[1])
  const problems = checkRequest(r, member)
  if (problems.length) throw new Error('invalid request: ' + problems.join('; '))
  return { request: r, member }
}

const isStr = (v, max = 200) => typeof v === 'string' && v.length <= max
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi

export function checkRequest(r, member) {
  const p = []
  if (!r || r.schema !== REQUEST_SCHEMA) p.push('schema')
  if (!REQUEST_TYPES.includes(r.type)) p.push('type')
  if (!isStr(r.id, 40) || !isStr(r.sentAt, 40)) p.push('id/sentAt')
  if (member && r.memberId !== member.id) p.push('memberId does not match link')
  if (r.type === 'skip' || r.type === 'unskip' || r.type === 'addon') { if (!isStr(r.roastId, 20)) p.push('roastId') }
  if (r.type === 'pause' && !/^\d{4}-\d{2}$/.test(r.until || '')) p.push('until')
  if (r.type === 'change') {
    if (!isInt(r.bags, 1, 200)) p.push('bags')
    if (!isStr(r.cadence, 40)) p.push('cadence')
  }
  if (r.type === 'addon') { if (!isStr(r.itemId, 60) || !isInt(r.qty, 1, 50)) p.push('item/qty') }
  if (r.type === 'message' && !isStr(r.text, MAX_FIELD)) p.push('text')
  return p
}
