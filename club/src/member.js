import qrcode from 'qrcode-generator'
import { publish } from './core.js'
import { SAMPLE_STATEMENT } from './sample-statement.js'
import { isMemberSecret, memberKeys, openStatement, wrapRequest, isLate, fmtMoney, priceIn, describeRequest, newRequestId } from './member-core.js'

const CFG = window.MEMBER_CONFIG
const $ = s => document.querySelector(s)

// Safe element builder: text always goes in as text, never as HTML.
function h(tag, props, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue
    if (k === 'class') e.className = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else e.setAttribute(k, v === true ? '' : v)
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c))
  return e
}
const fill = (sel, ...kids) => { const el = $(sel); el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false)); el.hidden = false; return el }
const row = (a, b, cls) => h('div', { class: 'row ' + (cls || '') }, h('span', null, a), h('span', null, b))
const fmtDate = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) }
const fmtMonth = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }

let S, SECRET, DEMO = false, storeKey

function problem(msg) {
  $('#loading').hidden = true
  fill('#problem', h('p', null, msg),
    h('p', { class: 'muted small' }, 'If this keeps happening, write to ', h('a', { href: 'mailto:' + CFG.contactEmail }, CFG.contactEmail), '.'))
}

async function load() {
  const frag = decodeURIComponent(location.hash.slice(1))
  if (frag === 'demo') {
    DEMO = true
    S = structuredClone(SAMPLE_STATEMENT)
    storeKey = 'sc-sent-demo'
    return render()
  }
  if (!isMemberSecret(frag)) return problem('This link looks incomplete. Please open the full link I sent you, including everything after the #.')
  SECRET = frag
  const { lookupId } = memberKeys(SECRET)
  storeKey = 'sc-sent-' + lookupId
  let file
  try {
    const res = await fetch(CFG.dataPath + lookupId + '.json', { cache: 'no-store' })
    if (res.status === 404) return problem('I couldn’t find your page yet. It may not be published. Try again after my next update.')
    if (!res.ok) throw new Error('HTTP ' + res.status)
    file = await res.json()
  } catch (e) {
    return problem('I couldn’t reach your page just now. Please check your connection and try again.')
  }
  try { S = await openStatement(SECRET, file) }
  catch (e) { return problem('This link doesn’t open your page. It may have been replaced with a new one.') }
  render()
}

// ---------- sent requests (kept on this device until the next update shows them) ----------
function sentList() {
  try { return JSON.parse(localStorage.getItem(storeKey) || '[]').filter(r => r.sentAt > S.updatedAt) } catch (_) { return [] }
}
function remember(r) {
  try { localStorage.setItem(storeKey, JSON.stringify(sentList().concat([{ id: r.id, sentAt: r.sentAt, text: describeRequest(r) }]))) } catch (_) {}
}
function renderSent() {
  const list = sentList()
  if (!list.length) { $('#sent').hidden = true; return }
  fill('#sent', h('strong', null, 'Sent to me'), ' — I’ll take these in at my next update.',
    h('ul', null, list.map(r => h('li', null, r.text))))
}

async function send(req, statusEl, btn) {
  const roastBits = { roastId: S.roast.id, roastLabel: S.roast.label }
  const full = { id: newRequestId(), ...(['skip', 'unskip', 'addon'].includes(req.type) ? roastBits : {}), ...req }
  btn && (btn.disabled = true)
  statusEl.className = 'status'; statusEl.textContent = 'Sending…'
  try {
    let request
    if (DEMO) {
      request = { ...full, sentAt: new Date().toISOString(), memberId: S.memberId }
      await new Promise(r => setTimeout(r, 400))
    } else {
      const w = wrapRequest(SECRET, S, full)
      request = w.request
      const results = await publish(w.wrap, S.relays)
      if (!results.some(r => r.ok)) throw new Error('no relay accepted it')
    }
    remember(request)
    statusEl.className = 'status ok'
    statusEl.textContent = DEMO ? 'Sent (demo, nothing actually went out).' : 'Sent. Thank you!'
    renderSent()
  } catch (e) {
    console.warn(e)
    statusEl.className = 'status err'
    statusEl.textContent = 'That didn’t go through. Please check your connection and try again.'
  } finally { btn && (btn.disabled = false) }
}

// ---------- sections ----------
function nextSection() {
  const p = S.plan, n = S.next
  const kids = [h('h2', null, `Your ${S.roast.label} roast`),
    h('p', { class: 'muted small' }, `Roast week starts ${fmtDate(S.roast.week)}. Changes close then.`)]
  if (p.status === 'paused') {
    kids.push(h('p', null, `You’re paused until ${fmtMonth(p.pausedUntil)}.`))
  } else if (!n.included) {
    kids.push(h('p', null, 'This roast isn’t one of yours with your current schedule. You can still add extras below if you’d like something this month.'))
  } else if (n.skipped) {
    kids.push(h('p', null, 'You’re skipping this one.'))
  } else {
    n.lines.forEach(l => kids.push(row(l.label, l.amount ? fmtMoney(l.amount) : '')))
    const shipTxt = { included: 'Included', 'at-shipping': 'Added when it goes out', none: 'Pickup' }[n.shipping]
    if (shipTxt) kids.push(row(p.delivery === 'deliver' ? 'Delivery' : 'Shipping', shipTxt))
    const tot = n.lines.reduce((a, l) => (l.amount && l.amount.cur === S.currency ? a + l.amount.amt : a), 0)
    if (p.plan === 'prepay') kids.push(row('Coffee', 'Prepaid', 'total'))
    else kids.push(row('Coffee total', fmtMoney({ amt: tot, cur: S.currency }), 'total'))
  }
  if (p.plan === 'prepay' && p.prepaidThrough) kids.push(h('p', { class: 'muted small' }, `Prepaid through ${fmtMonth(p.prepaidThrough)}.`))
  if (S.coffee) kids.push(h('p', { class: 'small', style: 'margin-top:10px' }, h('strong', null, 'This month\u2019s Sound Coffee: '), S.coffee.name,
    S.coffee.tasting ? h('span', { class: 'muted' }, ' — ' + S.coffee.tasting) : null))
  fill('#s-next', kids)
}

function qr(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make()
  const box = h('div', { class: 'qr', role: 'img', 'aria-label': 'QR code' })
  box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) // built from QR modules only
  return box
}
function copyBtn(text) {
  const b = h('button', { class: 'ghost', type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(text); b.textContent = 'Copied' } catch (_) { b.textContent = 'Copy failed' }
    setTimeout(() => { b.textContent = 'Copy' }, 1800)
  } }, 'Copy')
  return b
}
const safeUrl = u => /^https:\/\//i.test(u || '') ? u : null

function billsSection() {
  const due = (S.bills || []).filter(b => b.status === 'due')
  if (!due.length) return fill('#s-bills', h('h2', null, 'Bills'), h('p', null, 'You’re all paid up. Thank you!'))
  const kids = [h('h2', null, 'Bills')]
  due.forEach(b => {
    const pay = b.pay || {}, opts = []
    if (safeUrl(pay.squareUrl)) opts.push(h('div', { class: 'actions' }, h('a', { class: 'btn', href: safeUrl(pay.squareUrl), target: '_blank', rel: 'noopener' }, 'Pay by card')))
    if (pay.lightning && pay.lightning.invoice) {
      const inv = pay.lightning.invoice
      opts.push(h('div', null, h('p', { class: 'small', style: 'margin-top:8px' }, 'Pay with Lightning:'), qr(inv.toUpperCase()),
        h('div', { class: 'code' }, inv), h('div', { class: 'actions' }, h('a', { class: 'btn', href: 'lightning:' + inv }, 'Open wallet'), copyBtn(inv))))
    }
    if (pay.lightning && pay.lightning.address) {
      opts.push(h('p', { class: 'small', style: 'margin-top:8px' }, `Or send ${fmtMoney(b.amount)} to my Lightning address `, h('strong', null, pay.lightning.address),
        ` with ${b.id} in the note.`))
    }
    if (pay.onchain && pay.onchain.address) {
      const btc = (pay.onchain.sats / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
      const uri = `bitcoin:${pay.onchain.address}?amount=${btc}`
      opts.push(h('div', null, h('p', { class: 'small', style: 'margin-top:8px' }, `Pay on-chain: ${pay.onchain.sats.toLocaleString('en-US')} sats to`), qr(uri),
        h('div', { class: 'code' }, pay.onchain.address), h('div', { class: 'actions' }, h('a', { class: 'btn', href: uri }, 'Open wallet'), copyBtn(pay.onchain.address))))
    }
    if (pay.cash) opts.push(h('p', { class: 'small muted' }, 'Cash is fine at pickup or delivery.'))
    if (!opts.length) opts.push(h('p', { class: 'small muted' }, 'I’ll send payment details shortly.'))
    kids.push(h('div', { class: 'item' }, row(b.label, fmtMoney(b.amount)), opts))
  })
  fill('#s-bills', kids)
}

function stepper(min, max, start) {
  let v = start
  const out = h('output', null, v)
  const set = x => { v = Math.max(min, Math.min(max, x)); out.textContent = v; minus.disabled = v <= min; plus.disabled = v >= max; el.dispatchEvent(new Event('change')) }
  const minus = h('button', { type: 'button', 'aria-label': 'Fewer', onclick: () => set(v - 1) }, '−')
  const plus = h('button', { type: 'button', 'aria-label': 'More', onclick: () => set(v + 1) }, '+')
  const el = h('span', { class: 'stepper' }, minus, out, plus)
  el.value = () => v
  minus.disabled = v <= min
  return el
}

function menuSection() {
  const items = S.menu || []
  if (!items.length) return
  const canAdd = S.plan.status === 'active'
  const kids = [h('h2', null, `This month’s extras`),
    h('p', { class: 'muted small' }, `Added to your ${S.roast.label} roast and billed with it.`)]
  items.forEach(it => {
    const price = priceIn(it.price, S.currency)
    const soldOut = it.stock === 0
    const max = it.stock == null ? 10 : Math.min(10, it.stock)
    const st = h('p', { class: 'status' })
    const qty = stepper(1, Math.max(1, max), 1)
    const btn = h('button', { type: 'button', disabled: soldOut || !canAdd || !price, onclick: () =>
      send({ type: 'addon', itemId: it.id, itemName: it.name, qty: qty.value() }, st, btn) }, soldOut ? 'Sold out' : 'Add to my roast')
    kids.push(h('div', { class: 'item' },
      h('h3', null, it.name, it.size ? h('span', { class: 'muted' }, ' · ' + it.size) : null),
      it.desc ? h('p', { class: 'small muted' }, it.desc) : null,
      row(it.kind === 'special' ? 'Quarterly special' : 'Price', price ? fmtMoney(price) + ' each' : 'Ask me'),
      it.stock != null && it.stock > 0 && it.stock <= 3 ? h('p', { class: 'small', style: 'color:var(--err);font-weight:700' }, `Only ${it.stock} left`) : null,
      soldOut ? null : h('div', { class: 'actions' }, qty, btn), st))
  })
  if (!canAdd) kids.push(h('p', { class: 'small muted' }, 'Extras ride along with a roast, so they’re off while you’re paused.'))
  fill('#s-menu', kids)
}

function nextMonths(count) {
  const now = new Date(), out = []
  for (let i = 1; i <= count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

function changesSection() {
  const p = S.plan, n = S.next
  const kids = [h('h2', null, 'Make a change')]
  if (isLate(S)) kids.push(h('p', { class: 'note' }, `The ${S.roast.label} roast has started, so changes go into the next one unless I can fit them in.`))

  if (p.status === 'paused') {
    const st = h('p', { class: 'status' })
    const b = h('button', { type: 'button', onclick: () => send({ type: 'resume' }, st, b) }, 'Start my deliveries again')
    kids.push(h('details', { open: true }, h('summary', null, `Paused until ${fmtMonth(p.pausedUntil)}`), h('div', { class: 'actions' }, b), st))
  } else {
    if (n.included) {
      const st = h('p', { class: 'status' })
      const b = n.skipped
        ? h('button', { type: 'button', onclick: () => send({ type: 'unskip' }, st, b) }, `Undo skip`)
        : h('button', { type: 'button', onclick: () => send({ type: 'skip' }, st, b) }, `Skip ${S.roast.label}`)
      kids.push(h('details', null, h('summary', null, n.skipped ? 'Undo skipping this roast' : 'Skip this roast'),
        p.plan === 'prepay' ? h('p', { class: 'small muted' }, 'Your prepaid year moves back by one roast.') : null,
        h('div', { class: 'actions' }, b), st))
    }
    const st = h('p', { class: 'status' })
    const sel = h('select', { id: 'pause-until' }, nextMonths(6).map(m => h('option', { value: m }, fmtMonth(m))))
    const b = h('button', { type: 'button', onclick: () => send({ type: 'pause', until: sel.value }, st, b) }, 'Pause')
    kids.push(h('details', null, h('summary', null, 'Pause for a while'),
      h('label', { class: 'f', for: 'pause-until' }, 'Start again in'), sel,
      p.plan === 'prepay' ? h('p', { class: 'small muted', style: 'margin-top:6px' }, 'Your prepaid year moves back by the roasts you miss.') : null,
      h('div', { class: 'actions' }, b), st))
  }

  // Bags and cadence
  {
    const st = h('p', { class: 'status' })
    const max = p.maxBags || 20
    const bags = stepper(1, max, p.bags)
    const lbs = h('span', { class: 'muted small' })
    const showLbs = () => { lbs.textContent = ` ${+(bags.value() * (p.bagLbs || 1)).toFixed(2)} lb each roast` }
    bags.addEventListener('change', showLbs); showLbs()
    const cad = h('select', { id: 'cad' }, (p.cadences || []).map(c => h('option', { value: c.id, selected: c.id === p.cadence }, c.label)))
    const b = h('button', { type: 'button', onclick: () => {
      const c = (p.cadences || []).find(x => x.id === cad.value) || { id: cad.value, label: cad.value }
      if (bags.value() === p.bags && c.id === p.cadence) { st.className = 'status'; st.textContent = 'That’s what you have now.'; return }
      send({ type: 'change', bags: bags.value(), cadence: c.id, cadenceLabel: c.label }, st, b)
    } }, 'Send change')
    kids.push(h('details', null, h('summary', null, 'Change bags or how often'),
      h('label', { class: 'f' }, 'Bags each roast'), h('div', null, bags, lbs),
      h('label', { class: 'f', for: 'cad' }, 'How often'), cad,
      h('p', { class: 'small muted', style: 'margin-top:6px' }, 'Small changes go through at my next update. Bigger ones I look over first. Your price updates with your bag discount.'),
      h('div', { class: 'actions' }, b), st))
  }
  kids.push(h('p', { class: 'small muted', style: 'margin-top:12px' }, 'For a new address or a different way to pay, send me a message below.'))
  fill('#s-changes', kids)
}

function historySection() {
  const hs = S.history || []
  if (!hs.length) return
  fill('#s-history', h('h2', null, 'History'),
    hs.map(x => h('div', { class: 'item' },
      row(x.label, x.amount ? fmtMoney(x.amount) : ''),
      h('div', { class: 'row small' }, h('span', { class: 'muted' }, x.summary || ''),
        h('span', null, h('span', { class: 'pill ' + (x.paid ? 'ok' : 'due') }, x.paid ? 'Paid' : 'Due'))))))
}

function messageSection() {
  const st = h('p', { class: 'status' })
  const ta = h('textarea', { id: 'msg', maxlength: 2000, placeholder: 'A new address, a question, a gift, anything special…' })
  const b = h('button', { type: 'button', onclick: () => {
    const text = ta.value.trim()
    if (!text) { st.className = 'status err'; st.textContent = 'Write a few words first.'; return }
    send({ type: 'message', text }, st, b).then(() => { if (st.classList.contains('ok')) ta.value = '' })
  } }, 'Send message')
  const email = S.contact && S.contact.email
  fill('#s-message', h('h2', null, 'Message me'), h('label', { class: 'f', for: 'msg', hidden: true }, 'Message'), ta,
    h('div', { class: 'actions' }, b), st,
    email ? h('p', { class: 'small muted' }, 'Or write to ', h('a', { href: 'mailto:' + email }, email), '.') : null)
}

function render() {
  $('#loading').hidden = true
  $('#app').hidden = false
  $('#demo-note').hidden = !DEMO
  $('#hello').textContent = `Hello, ${S.name}`
  document.title = 'Sound Coffee · ' + S.name
  renderSent(); nextSection(); billsSection(); menuSection(); changesSection(); historySection(); messageSection()
  $('#updated').textContent = 'Last updated ' + new Date(S.updatedAt).toLocaleString('en-US', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '.'
}

window.addEventListener('hashchange', () => location.reload())
load()
