// Run with: node worker/tests/security.test.mjs
// Checks that strangers are refused, that payments can't be faked from the
// browser, and that emails can't carry injected HTML. Uses an in-memory
// stand-in for KV and D1, so nothing real is touched.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateSecretKey, finalizeEvent } from "nostr-tools/pure";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "index.js"), "utf8");
const worker = (await import("../index.js")).default;

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`);
  if (!ok) failed++;
}

// ---- stand-ins -------------------------------------------------------
function makeKV() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix = "" } = {}) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}
const dbCalls = [];
const DB = {
  prepare(sql) {
    const stmt = {
      bind() { return stmt; },
      async first() { return { id: "x", amount_sats: 1000, amount_usd_cents: null }; },
      async all() { return { results: [] }; },
      async run() { dbCalls.push(sql); return { meta: { changes: 1 } }; },
    };
    return stmt;
  },
};
const sentEmails = [];
const realFetch = globalThis.fetch;
let verifyAnswer = { settled: true };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("api.resend.com")) { sentEmails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  if (u.includes("/.well-known/lnurlp/")) return new Response(JSON.stringify({ callback: "https://pay.getalby.com/cb" }), { status: 200 });
  if (u.includes("verify")) return new Response(JSON.stringify(verifyAnswer), { status: 200 });
  return new Response("not available in test", { status: 404 });
};

function env(extra = {}) {
  return { SOUND_COFFEE_KV: makeKV(), DB, RESEND_API_KEY: "re_test", ADMIN_EMAIL: "admin@example.com", SOUND_COFFEE_LUD16: "shop@getalby.com", ...extra };
}
const call = (e, method, path, { body, headers } = {}) =>
  worker.fetch(new Request(`https://soundcoffee.org${path}`, {
    method,
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }), e, { waitUntil() {} });

// ---- 1. every route is deliberately placed -----------------------------
const setItems = (name) => {
  const block = source.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`))[1];
  return [...block.matchAll(/"((?:GET|POST) [^"]+)"/g)].map((m) => m[1]);
};
const admin = setItems("ADMIN_ROUTES");
const open = setItems("PUBLIC_ROUTES");
const dispatched = [...source.matchAll(/request\.method === "(GET|POST)" && url\.pathname === "([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
const unplaced = dispatched.filter((r) => !admin.includes(r) && !open.includes(r));
check("every route in the Worker is listed as admin or public", unplaced.length === 0, unplaced.join(", "));
check("no route is in both lists", admin.every((r) => !open.includes(r)));

// ---- 2. strangers are refused on every admin route -----------------------
const e1 = env();
let allRefused = true;
const leaks = [];
for (const route of admin) {
  const [method, path] = route.split(" ");
  const none = await call(e1, method, path, { body: method === "POST" ? {} : undefined });
  const junk = await call(e1, method, path, { headers: { Authorization: "Bearer " + "a".repeat(64) }, body: method === "POST" ? {} : undefined });
  if (none.status !== 401 || junk.status !== 401) { allRefused = false; leaks.push(route); }
}
check(`all ${admin.length} admin routes refuse no token and a made-up token`, allRefused, leaks.join(", "));
check("no database call was made by any refused request", dbCalls.length === 0);

// ---- 3. admin sign-in only accepts the Sound Coffee key ------------------
const stranger = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [["u", "https://soundcoffee.org/api/admin/session"], ["method", "POST"]], content: "" }, generateSecretKey());
const r3 = await call(e1, "POST", "/api/admin/session", { body: { event: stranger } });
check("admin sign-in refuses an event from any other key", r3.status === 401);
const r3b = await call(e1, "POST", "/api/admin/session", { body: {} });
check("admin sign-in refuses an empty request", r3b.status === 401);

// ---- 4. a real session token gets in -----------------------------------
const e2 = env();
const token = "b".repeat(64);
await e2.SOUND_COFFEE_KV.put(`admin-session:${token}`, "1");
const r4 = await call(e2, "GET", "/api/orders", { headers: { Authorization: `Bearer ${token}` } });
check("a valid admin session can read the order list", r4.status === 200);

// ---- 5. emails can't carry injected HTML --------------------------------
sentEmails.length = 0;
await call(e2, "POST", "/api/notify-message", {
  headers: { Authorization: `Bearer ${token}` },
  body: { orderId: "o<b>1", buyerEmail: "buyer@example.com", message: 'Hi <a href="https://evil.example">click</a>\nthanks' },
});
const html = sentEmails[0]?.html || "";
check("notify-message escapes HTML in the message", html.includes("&lt;a href=") && !html.includes('<a href="https://evil.example"'));
check("notify-message keeps line breaks", html.includes("<br>"));

// ---- 6. payments can't be confirmed by the browser's say-so ---------------
async function register(e, id, extra) {
  return call(e, "POST", "/api/pending-payment", {
    body: { id, type: "purchase", pubkey: "c".repeat(64), sellerPubkey: "3e8220285e34b7dd2212b6eb62648c4e2cffdaab2f740daeeb50405e9883f45d", invoice: "lnbc1fake", amountSats: 1000, ...extra },
  });
}
const e3 = env();
verifyAnswer = { settled: true };
await register(e3, "order-evil-0001", { verifyUrl: "https://evil.example.com/verify/abc" });
dbCalls.length = 0;
const r6 = await (await call(e3, "POST", "/api/confirm-payment", { body: { id: "order-evil-0001" } })).json();
check("a verify address on another provider is not trusted", r6.status === "pending" && r6.reason === "wrong-provider", JSON.stringify(r6));
check("...and the order was not marked paid", !dbCalls.some((q) => q.includes("payment_status = 'paid'")));

await register(e3, "order-none-0001", { verifyUrl: null });
const r6b = await (await call(e3, "POST", "/api/confirm-payment", { body: { id: "order-none-0001" } })).json();
check("'I paid' with no way to check leaves the order unpaid", r6b.status === "pending" && r6b.reason === "needs-manual-check");

await register(e3, "order-good-0001", { verifyUrl: "https://pay.getalby.com/verify/abc" });
const r6c = await (await call(e3, "POST", "/api/confirm-payment", { body: { id: "order-good-0001" } })).json();
check("a verify address on the seller's own provider, reporting paid, is accepted", r6c.status === "confirmed", JSON.stringify(r6c));

await call(e3, "POST", "/api/pending-payment", { body: { id: "zap-evil-00001", type: "zap", pubkey: "d".repeat(64), invoice: "lnbc1fake", amountSats: 5000, verifyUrl: "https://evil.example.com/verify/z" } });
const r6d = await (await call(e3, "POST", "/api/confirm-payment", { body: { id: "zap-evil-00001" } })).json();
check("a zap with no payment proof is not counted", r6d.status === "pending" && r6d.reason === "no-proof", JSON.stringify(r6d));

const r6e = await call(e3, "POST", "/api/pending-payment", { body: { id: "order-good-0001", type: "purchase", pubkey: "c".repeat(64), invoice: "lnbc1other", amountSats: 1, verifyUrl: "https://evil.example.com/v" } });
const kept = JSON.parse(await e3.SOUND_COFFEE_KV.get("pending:order-good-0001"));
check("an existing pending payment can't be overwritten", (await r6e.json()).existing === true && kept.invoice === "lnbc1fake");

// ---- 7. feed fetches only reach plain public https addresses ---------------
for (const bad of ["http://example.com/feed.xml", "https://127.0.0.1/feed", "https://localhost/feed", "https://example.com:8443/feed", "https://169.254.169.254/latest"]) {
  const r = await call(env(), "GET", `/api/podcast-feed?url=${encodeURIComponent(bad)}`);
  check(`podcast-feed refuses ${bad}`, r.status === 502);
}

// ---- 8. rate limit on checkout creation -------------------------------
const e8 = env();
let last = 0;
for (let i = 0; i < 12; i++) last = (await call(e8, "POST", "/api/create-square-checkout", { body: {} })).status;
check("the 11th+ checkout request in a minute is turned away (429)", last === 429);

globalThis.fetch = realFetch;
console.log(failed ? `\n${failed} check(s) failed` : "\nall security checks pass");
process.exit(failed ? 1 : 0);
