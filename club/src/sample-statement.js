// Sample statement: used by the #demo page and as the starting point in the statement maker.
// The ledger will produce these; every amount is Money { amt, cur } (USD in cents).
export const SAMPLE_STATEMENT = {
  memberId: 'M-0001',
  name: 'Ada',
  updatedAt: '2026-11-24T15:00:00Z',
  ordersPubkey: '',                       // hex pubkey of your orders key
  relays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.0xchat.com'],
  contact: { email: 'hello@example.com' },
  currency: 'USD',                        // 'USD' or 'SAT': prices show only in this
  pay: 'usd',                             // usd | ln | btc | cash
  roast: { id: '2026-12', label: 'December', week: '2026-12-08', cutoff: '2026-12-08' },
  plan: {
    bags: 2, bagLbs: 1, maxBags: 20,
    cadence: 'monthly',
    cadences: [
      { id: 'monthly', label: 'Every month', perYear: 12 },
      { id: 'bimonthly', label: 'Every other month', perYear: 6 },
      { id: 'quarterly', label: 'Every three months', perYear: 4 }
    ],
    plan: 'per-roast',                    // per-roast | prepay
    prepaidThrough: null,                 // e.g. '2027-11' for prepaid members
    delivery: 'ship',                     // ship | deliver | pickup
    status: 'active',                     // active | paused
    pausedUntil: null                     // 'YYYY-MM' when paused
  },
  next: {
    included: true,                       // false if their cadence skips this roast
    skipped: false,
    lines: [
      { label: '2 bags, monthly club', amount: { amt: 3800, cur: 'USD' } }
    ],
    shipping: 'at-shipping'               // included | at-shipping | none
  },
  coffee: { name: 'December coffee', origin: 'Origin to come', tasting: 'Full body, sweet, with cherry juice on the finish.' },
  menu: [
    { id: 'special-2026q4', kind: 'special', name: 'Winter special', size: '8 oz',
      desc: 'This quarter’s small-lot coffee.', price: { usdCents: 1400, sats: 14000 }, stock: 3 },
    { id: 'choc-70', kind: 'product', name: '70% chocolate bar', size: '2 oz',
      desc: 'Bean-to-bar, made here.', price: { usdCents: 900, sats: 9000 }, stock: 12 },
    { id: 'bag-extra', kind: 'product', name: 'Extra bag of this month’s coffee', size: '1 lb',
      desc: 'Added at the regular price.', price: { usdCents: 2000, sats: 20000 }, stock: null }
  ],
  credit: { amt: 0, cur: 'USD' },         // any earlier overpayment still held
  bills: [
    { id: 'B-2026-11', label: 'November roast', amount: { amt: 3800, cur: 'USD' }, status: 'due',
      total: { amt: 3800, cur: 'USD' }, paid: { amt: 0, cur: 'USD' },
      lines: [{ label: '2 bags, monthly club', amount: { amt: 3800, cur: 'USD' } }],
      pay: { squareUrl: 'https://square.link/u/EXAMPLE' } },
    { id: 'B-2026-12', label: 'December roast (Lightning)', amount: { amt: 38000, cur: 'SAT' }, status: 'due',
      total: { amt: 40000, cur: 'SAT' }, paid: { amt: 2000, cur: 'SAT' },
      lines: [{ label: '2 bags, monthly club', amount: { amt: 40000, cur: 'SAT' } }],
      shipping: { label: 'Shipping', amount: { amt: 0, cur: 'SAT' } },
      converted: 'Shipping was priced at $6 and converted once, at $1 = 1,000 sats, when this bill was made.',
      pay: { lightning: { address: 'you@example.com', sats: 38000, comment: 'B-2026-12' } } },
    { id: 'B-2026-10', label: 'October roast', amount: { amt: 3800, cur: 'USD' }, status: 'paid' }
  ],
  history: [
    { roastId: '2026-11', label: 'November', summary: '2 bags, shipped', amount: { amt: 3800, cur: 'USD' }, paid: false },
    { roastId: '2026-10', label: 'October', summary: '2 bags, shipped', amount: { amt: 3800, cur: 'USD' }, paid: true }
  ]
}
