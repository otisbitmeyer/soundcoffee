import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { unwrapEvent } from 'nostr-tools/nip59'
import { buildPayload, wrapSignup, parseMessage, quote, maxBags } from '../src/core.js'
import fs from 'fs'
const C = eval('(' + fs.readFileSync('../../public/join.html','utf8').match(/window\.SIGNUP_CONFIG = (\{[\s\S]*?\n\})/)[1] + ')')
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1 } }
ok(maxBags(C.pricing) === 20, 'max 20 bags at 1 lb')
ok(maxBags({...C.pricing, bagLbs: .75}) === 26, '12oz -> 26 bags')
let a = quote(C, {kind:'club',bags:3,cadence:'bimonthly',plan:'prepay',delivery:'ship'})
ok(a.usd.perDelivery===5100 && a.usd.year===30600 && a.shipping==='included', 'club prepay')
a = quote(C, {kind:'club',bags:3,cadence:'monthly',plan:'per-roast',delivery:'ship'})
ok(a.usd.perDelivery===5400 && a.shipping==='at-shipping', 'club per-roast ships later')
a = quote(C, {kind:'club',bags:50,cadence:'monthly',plan:'per-roast',delivery:'pickup'})
ok(a.bags===20 && a.bagPct===20 && a.shipping==='none', 'clamp + pickup')
a = quote(C, {kind:'once',bags:2,delivery:'ship'})
ok(a.usd.total===4000 && a.bagPct===0 && a.shipping==='at-shipping', 'once')
const sk = generateSecretKey(), pk = getPublicKey(sk)
for (const f of [
  {kind:'club',name:'Ada',email:'a@b.co',bags:'4',cadence:'quarterly',plan:'prepay',delivery:'ship',line1:'1 Main',city:'Holland',region:'MI',postal:'49423',pay:'ln'},
  {kind:'once',name:'Bo',email:'b@c.co',bags:'2',cadence:'monthly',plan:'per-roast',delivery:'ship',line1:'1 Main',city:'Holland',region:'MI',postal:'49423',pay:'usd'}]) {
  const p = buildPayload(f, C); const r = unwrapEvent(wrapSignup(p, pk).wrap, sk)
  console.log(r.content.split('\n-----')[0] + '\n'); ok(JSON.stringify(parseMessage(r.content))===JSON.stringify(p),'roundtrip')
}
console.log(process.exitCode ? 'FAILURES' : 'all checks pass')
