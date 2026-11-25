import { toHexPubkey, buildPayload, wrapSignup, publish, newSignupId, quote, nextBagStep, usd, sats, maxBags, currencyFor } from './core.js'

const C = window.SIGNUP_CONFIG
const $ = s => document.querySelector(s)
const form = $('#signup')

const recipient = toHexPubkey(C.ordersNpub)
function refreshSetupNote() {
  const n = []
  if (!recipient) n.push('This form doesn’t have an orders key yet, so nothing will be sent. Add your orders npub at the top of the file.')
  if (/PLACEHOLDER/.test(C.coffee.name + C.coffee.origin)) n.push('The coffee name and origin are placeholders. Set them in Merchant Settings, Club roast.')
  if (C.pricing.placeholder) n.push('Prices and discounts are placeholders. Set them at the top of the file, then set <code>placeholder: false</code>.')
  $('#setup-note').hidden = !n.length
  if (n.length) $('#setup-note').innerHTML = '<strong>Setup mode.</strong> ' + n.join(' ')
}
refreshSetupNote()

// Coffee and roast info. The page ships with the values in the config, then
// swaps in whatever was last saved in Merchant Settings (Club roast).
function renderRoast() {
  const cf = C.coffee
  $('#coffee-h').textContent = cf.name
  $('#coffee-meta').textContent = [cf.origin, cf.producer, cf.process].filter(Boolean).join(' · ')
  $('#coffee-tasting').textContent = cf.tasting
  $('#coffee-story').textContent = cf.story
  $('#next-roast').textContent = 'Next roast: the week of ' + nextRoast(C.roast.roastWeek).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) + '.'
  $('#roast-note').textContent = C.roast.note
}
renderRoast()
fetch('/api/club-roast', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => {
  const r = d && d.roast
  if (!r || !r.name) return
  for (const k of ['name', 'origin', 'producer', 'process', 'tasting', 'story']) C.coffee[k] = r[k] || ''
  if (r.note) C.roast.note = r.note
  if (r.roastWeek) C.roast.roastWeek = r.roastWeek
  renderRoast()
  refreshSetupNote()
}).catch(() => {})

// First day of the given week of this month (week 2 starts on the 8th),
// or next month's if this month's has already ended.
function nextRoast(week, today = new Date()) {
  const start = 1 + (week - 1) * 7
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), start)
  const end = new Date(today.getFullYear(), today.getMonth(), start + 6)
  return today <= end ? thisMonth : new Date(today.getFullYear(), today.getMonth() + 1, start)
}

// Cadence choices
C.cadences.forEach((c, i) => {
  const el = document.createElement('label')
  el.className = 'card'
  el.innerHTML = `<input type="radio" name="cadence" value="${c.id}" ${i === 0 ? 'checked' : ''}> <span></span>`
  el.querySelector('span').textContent = c.label
  $('#cadences').appendChild(el)
})

// Bag stepper (typing allowed, clamped to the pound limit)
const bagsIn = form.bags
const MAX = maxBags(C.pricing)
bagsIn.max = MAX
const clamp = () => { bagsIn.value = Math.max(1, Math.min(MAX, Math.round(+bagsIn.value) || 1)) }
$('#minus').onclick = () => { bagsIn.value = +bagsIn.value - 1; clamp(); update() }
$('#plus').onclick = () => { bagsIn.value = +bagsIn.value + 1; clamp(); update() }
bagsIn.addEventListener('change', () => { clamp(); update() })
$('#bag-limit').textContent = `Up to ${C.pricing.maxLbsPerMonth} lb a month.`

// Prepay label shows its discount
$('#prepay-label').textContent = `Pay the year up front, ${C.pricing.prepayPct}% extra off`

function sel() {
  return { kind: form.kind.value, bags: +bagsIn.value, cadence: form.cadence.value,
           plan: form.plan.value, delivery: form.delivery.value }
}

const row = (label, value, cls = '') => `<div class="qrow ${cls}"><span>${label}</span><span>${value}</span></div>`

function renderQuote() {
  const s = sel(), q = quote(C, s)
  const lbs = `${q.lbs} lb`
  $('#bag-lbs').textContent = `bag${q.bags > 1 ? 's' : ''} · ${lbs}`
  const nx = s.kind === 'club' ? nextBagStep(C.pricing, q.bags) : null
  $('#bag-hint').textContent = (q.bagPct ? `${q.bagPct}% off at ${q.bags} bags. ` : '') + (nx ? `${nx.minBags} bags gets ${nx.pct}% off.` : '')

  if (!form.pay.value) {
    $('#quote').innerHTML = '<p class="qnote" style="margin:0">Choose how you’ll pay to see your price.</p>'
    return
  }
  const cur = currencyFor(form.pay.value)
  const m = k => cur === 'sats' ? sats(q.sats[k]) : usd(q.usd[k])
  const shipWord = s.delivery === 'deliver' ? 'Delivery' : 'Shipping'
  const shipRow = { included: [shipWord, 'Included'], 'at-shipping': [shipWord, 'Added when it goes out'], none: ['Pickup', 'No charge'] }[q.shipping]
  let h = ''
  if (s.kind === 'club') {
    const off = q.bagPct + q.prepayPct
    h += row(`${q.bags} bag${q.bags > 1 ? 's' : ''} each roast`, off ? `<s>${m('full')}</s>` : m('full'))
    if (q.bagPct) h += row('Bag discount', `−${q.bagPct}%`, 'disc')
    if (q.prepayPct) h += row('Paying up front', `−${q.prepayPct}%`, 'disc')
    h += row(shipRow[0], shipRow[1], q.shipping === 'included' ? 'disc' : '')
    h += row('Each roast', m('perDelivery'), 'strong')
    h += row(`A year (${q.usd.deliveries} roasts)`, m('year'), 'strong')
    if (off) h += row('You save', `${cur === 'sats' ? sats(q.sats.yearFull - q.sats.year) : usd(q.usd.yearFull - q.usd.year)} a year`, 'disc')
    h += `<p class="qnote">${s.plan === 'prepay'
      ? 'One payment for the year, before your first roast, with shipping included.'
      : 'You pay for each roast as it ships' + (q.shipping === 'at-shipping' ? ', with shipping worked out when it’s packed. Pay the year up front and shipping is included.' : '.')}</p>`
  } else {
    h += row(`${q.bags} bag${q.bags > 1 ? 's' : ''}`, m('full'))
    h += row(shipRow[0], shipRow[1])
    h += row(q.shipping === 'at-shipping' ? 'Coffee total' : 'Total', m('total'), 'strong')
    h += `<p class="qnote">${q.shipping === 'at-shipping' ? 'Once it ships, I’ll send your bill with shipping added.' : 'You pay when you pick it up.'} Club members get bag discounts.</p>`
  }
  $('#quote').innerHTML = h
}

function update() {
  const k = form.kind.value
  document.querySelectorAll('[data-club]').forEach(el => { el.hidden = k !== 'club' })
  $('#bags-legend').textContent = k === 'club' ? 'Bags each roast' : 'How many bags?'
  $('#send').textContent = k === 'club' ? 'Send my sign-up' : 'Send my order'

  const d = form.delivery.value
  const addr = $('#address')
  addr.hidden = !(d === 'ship' || d === 'deliver')
  addr.querySelectorAll('[data-req]').forEach(i => { i.required = !addr.hidden })
  $('#addr-legend').textContent = d === 'deliver' ? 'Where should I bring it?' : 'Shipping address'
  const cashOk = d === 'pickup' || d === 'deliver'
  $('#pay-cash').hidden = !cashOk
  if (!cashOk && form.pay.value === 'cash') form.querySelector('input[name=pay][value=cash]').checked = false
  renderQuote()
}
form.addEventListener('change', update)
form.addEventListener('input', update)
update()

function setStatus(msg, kind = '') { const s = $('#status'); s.textContent = msg; s.className = 'status ' + kind }

form.addEventListener('submit', async e => {
  e.preventDefault()
  if (form.website.value) return // honeypot
  const f = Object.fromEntries(new FormData(form))
  if (!f.email && !f.npub) return setStatus('Please give me an email or a Nostr key so I can reach you.', 'err')
  if (f.npub && !toHexPubkey(f.npub)) return setStatus('That Nostr key doesn’t look right. It should start with npub1.', 'err')
  if (!recipient) return setStatus('This form isn’t connected yet, so nothing was sent.', 'err')

  const payload = buildPayload({ ...f, id: newSignupId() }, C)
  const btn = $('#send')
  btn.disabled = true
  setStatus('Sealing and sending…')
  try {
    const { wrap } = wrapSignup(payload, recipient)
    const results = await publish(wrap, C.relays)
    if (!results.some(r => r.ok)) throw new Error(results.map(r => r.url + ': ' + r.msg).join('\n'))
    form.hidden = true
    $('#done').hidden = false
    $('#ref').textContent = payload.id
    $('#done-what').textContent = payload.kind === 'club'
      ? 'with your bill and your personal club link.'
      : 'with your bill once it ships.'
    $('#done-contact').textContent = payload.email || 'Nostr'
    window.scrollTo(0, 0)
  } catch (err) {
    console.warn(err)
    btn.disabled = false
    setStatus('It didn’t go through. Please check your connection and try again. If it keeps failing, send me a note directly.', 'err')
  }
})
