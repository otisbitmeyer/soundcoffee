import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { wrapEvent } from 'nostr-tools/nip59'
import { SAMPLE_STATEMENT } from '../src/sample-statement.js'
import { newMemberSecret, memberKeys, sealStatement, openStatement, wrapRequest, openRequest, requestText } from '../src/member-core.js'
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m) } else console.log('ok  ', m) }
const ordersSk = generateSecretKey(), ordersPk = getPublicKey(ordersSk)
const secret = newMemberSecret(), other = newMemberSecret()
const st = { ...SAMPLE_STATEMENT, ordersPubkey: ordersPk }
const file = await sealStatement(secret, st)
ok(JSON.stringify(file).indexOf('Ada') < 0, 'statement file reveals nothing in plain text')
ok((await openStatement(secret, file)).name === 'Ada', 'right link opens statement')
try { await openStatement(other, file); ok(false, 'wrong link blocked') } catch { ok(true, 'wrong link cannot open statement') }
const k = memberKeys(secret)
ok(k.lookupId !== memberKeys(other).lookupId && k.lookupId.length === 32, 'each link has its own file name')
const members = new Map([[k.signPubkey, { id: 'M-0001', name: 'Ada' }]])
const { wrap } = wrapRequest(secret, st, { type: 'pause', until: '2027-02' })
const got = openRequest(wrap, ordersSk, members)
ok(got.request.type === 'pause' && got.member.id === 'M-0001', 'genuine pause request opens and matches member')
const w2 = wrapRequest(secret, st, { type: 'addon', roastId: '2026-12', itemId: 'choc-70', itemName: 'Bar', qty: 2 }).wrap
ok(openRequest(w2, ordersSk, members).request.qty === 2, 'add-on request opens')
// forgery: a stranger with their own key copies the format
const strangerSk = generateSecretKey()
const r = { schema: 'sound-coffee-request/1', id: 'RQ-X', memberId: 'M-0001', sentAt: new Date().toISOString(), type: 'pause', until: '2030-01' }
const forged = wrapEvent({ kind: 14, created_at: 1, tags: [['p', ordersPk]], content: requestText(r) }, strangerSk, ordersPk)
try { openRequest(forged, ordersSk, members); ok(false, 'forgery') } catch (e) { ok(/known member/.test(e.message), 'forged request rejected: ' + e.message) }
// another member's link claiming to be M-0001
const k2 = memberKeys(other); members.set(k2.signPubkey, { id: 'M-0002' })
const imp = wrapRequest(other, { ...st, memberId: 'M-0001' }, { type: 'skip', roastId: '2026-12' }).wrap
try { openRequest(imp, ordersSk, members); ok(false, 'impersonation') } catch (e) { ok(/does not match/.test(e.message), 'member posing as another rejected') }
// bad fields
const bad = wrapRequest(secret, st, { type: 'change', bags: '<img src=x onerror=alert(1)>', cadence: 'monthly' }).wrap
try { openRequest(bad, ordersSk, members); ok(false, 'bad fields') } catch (e) { ok(/bags/.test(e.message), 'junk in a number field rejected') }
const big = wrapRequest(secret, st, { type: 'message', text: 'x'.repeat(5000) }).wrap
try { openRequest(big, ordersSk, members); ok(false, 'big') } catch (e) { ok(true, 'oversized message rejected: ' + e.message) }
// someone else cannot read the request
try { openRequest(wrap, generateSecretKey(), members); ok(false, 'read') } catch { ok(true, 'only the orders key opens requests') }
console.log(fails ? fails + ' FAILED' : 'all member checks pass')
fs: { const fs = await import('fs'); fs.mkdirSync('./.test-output/m/data', { recursive: true })
  const st2 = { ...st, updatedAt: '2026-11-24T15:00:00Z' }
  fs.writeFileSync('./.test-output/m/data/' + k.lookupId + '.json', JSON.stringify(await sealStatement(secret, st2)))
  fs.writeFileSync('./.test-output/secret.txt', secret) }
{ const fs = await import('fs'); const { bytesToHex } = await import('@noble/hashes/utils.js'); fs.writeFileSync('./.test-output/orders.txt', bytesToHex(ordersSk) + '\n' + k.signPubkey) }
