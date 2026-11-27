import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { createServer } from 'vite'

const book = 'review-fixture-book-id-001'
const otherBook = 'review-fixture-book-id-002'
const draft = {
  date: '2026-10-05', amount: 120, category: '餐飲', account: '現金', note: '午餐', type: '支出',
}
const ledger = new Map()
let email = 'alice@example.test'
let loseResponse = false
let failMarkerRead = false
let failList = false
let modelResult = []
let server, app, storage, commitTransactionBatch, parseTransactionsWithAI, similarTransactionKey

function googleFixture(input, init) {
  const url = new URL(input)
  const json = (body, status = 200) => Response.json(body, { status })
  if (url.hostname === 'openrouter.ai') {
    return json({ choices: [{ message: { content: JSON.stringify({ transactions: modelResult }) } }] })
  }
  assert.equal(url.hostname, 'sheets.googleapis.com')
  const id = url.pathname.split('/')[3].split(':')[0]
  const { rows, markers } = ledger.get(id)
  if (url.pathname.endsWith(':batchUpdate')) {
    assert.equal(init.method, 'POST')
    const { requests: [{ addNamedRange }, { appendCells }] } = JSON.parse(init.body)
    const marker = addNamedRange.namedRange.namedRangeId
    if (markers.has(marker)) return json({ error: { message: 'Named range already exists' } }, 400)
    markers.add(marker)
    rows.push(...appendCells.rows.map(({ values }) => values.map(({ userEnteredValue: value }) =>
      value.numberValue ?? value.stringValue)))
    if (loseResponse) throw new TypeError('Connection lost after commit')
    return json({})
  }
  if (url.pathname.includes('/values/')) {
    assert.equal(decodeURIComponent(url.pathname.split('/').at(-1)), '交易!A2:H')
    if (failList) return json({ error: { message: 'List unavailable' } }, 503)
    return json({ values: rows })
  }
  if (url.searchParams.get('fields') === 'namedRanges(namedRangeId)') {
    if (failMarkerRead) return json({ error: { message: 'Marker read unavailable' } }, 503)
    return json({ namedRanges: Array.from(markers, (namedRangeId) => ({ namedRangeId })) })
  }
  return json({ sheets: [{ properties: { title: '交易', sheetId: 0 } }] })
}

before(async () => {
  const local = new Map()
  globalThis.window = { localStorage: {
    getItem: (key) => local.get(key) ?? null,
    setItem: (key, value) => local.set(key, String(value)),
    removeItem: (key) => local.delete(key),
  } }
  globalThis.reviewTestProfile = () => ({ email, name: 'Fixture', imageUrl: '' })
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom',
    define: { 'import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID': JSON.stringify('fixture') },
    ssr: { noExternal: ['@capgo/capacitor-social-login'] },
    plugins: [{
      name: 'review-test-google-login',
      enforce: 'pre',
      resolveId(id) {
        if (id === '@capgo/capacitor-social-login') return '\0review-test-google-login'
      },
      load(id) {
        if (id === '\0review-test-google-login') return `export const SocialLogin = {
          initialize: async () => {},
          isLoggedIn: async () => ({ isLoggedIn: true }),
          login: async () => ({ result: {
            responseType: 'online', profile: globalThis.reviewTestProfile(), accessToken: { token: 'fixture-token' },
          } }),
          logout: async () => {},
          refresh: async () => {},
          getAuthorizationCode: async () => ({ accessToken: 'fixture-token' }),
        }`
      },
    }],
  })
  const store = await server.ssrLoadModule('/src/composables/useApp.ts')
  app = store.useApp()
  ;({ storage } = await server.ssrLoadModule('/src/storage.ts'))
  ;({ commitTransactionBatch } = await server.ssrLoadModule('/src/google/sheets.ts'))
  ;({ parseTransactionsWithAI } = await server.ssrLoadModule('/src/ai/openrouter.ts'))
  ;({ similarTransactionKey } = await server.ssrLoadModule('/src/review.ts'))
})

after(async () => {
  await server?.close()
  delete globalThis.window
  delete globalThis.reviewTestProfile
})

beforeEach(async (t) => {
  t.mock.method(globalThis, 'fetch', googleFixture)
  ledger.clear()
  for (const id of [book, otherBook]) ledger.set(id, { rows: [], markers: new Set() })
  email = 'alice@example.test'
  loseResponse = failMarkerRead = failList = false
  await storage.setPendingBatches([])
  await storage.setSpreadsheetId(book)
  await app.signIn()
  await app.hydrate()
})

test('review can edit or skip without appending, and survives rehydration in the right book', async () => {
  await app.stageDrafts([draft], { kind: 'manual' })
  await app.stageDrafts([{ ...draft, date: '' }, { ...draft, note: '略過項目' }], { kind: 'ai-text' })
  const [manual, ai] = app.pendingBatches.value
  await assert.rejects(app.confirmPendingBatch(ai.id), /補齊/)
  await app.editPendingDraft(ai.id, 0, { ...draft, amount: 135 })
  await app.editPendingDraft(ai.id, 1)
  await app.editPendingDraft(manual.id, 0)
  assert.equal(ledger.get(book).rows.length, 0)

  await storage.setSpreadsheetId(otherBook)
  await app.hydrate()
  assert.deepEqual(app.pendingBatches.value, [])
  await storage.setSpreadsheetId(book)
  await app.signOut()
  assert.deepEqual(app.pendingBatches.value, [])
  email = 'bob@example.test'
  await app.signIn()
  await app.hydrate()
  assert.deepEqual(app.pendingBatches.value, [])
  await app.signOut()
  email = 'alice@example.test'
  await app.signIn()
  await app.hydrate()

  assert.deepEqual(app.pendingBatches.value[0].drafts.map((item) => item.amount), [135])
  await app.confirmPendingBatch(ai.id)
  assert.deepEqual(ledger.get(book).rows.map((row) => row[1]), [135])
  assert.deepEqual(ledger.get(otherBook).rows, [])
})

test('same source ID converges on one atomic commit; separate look-alikes can still be kept', async () => {
  const source = { kind: 'ai-text', eventId: 'private-source-id-01' }
  await app.stageDrafts([draft], source)
  const first = app.pendingBatches.value[0]
  await app.discardPendingBatch(first.id)
  await app.stageDrafts([draft], source)
  const second = app.pendingBatches.value[0]
  assert.equal(first.id, second.id)
  const results = await Promise.all([commitTransactionBatch(book, first), commitTransactionBatch(book, second)])
  assert.deepEqual(results.sort(), ['already-written', 'written'])
  assert.equal(ledger.get(book).rows.length, 1)
  assert.ok(!ledger.get(book).rows[0].join(' ').includes(source.eventId))

  await app.confirmPendingBatch(second.id)
  await app.stageDrafts([{ ...draft, note: '　午餐　' }], { kind: 'manual' })
  const independent = app.pendingBatches.value[0]
  assert.equal(similarTransactionKey(app.state.transactions[0]), similarTransactionKey(independent.drafts[0]))
  assert.equal((await app.confirmPendingBatch(independent.id)).result, 'written')
  assert.equal(ledger.get(book).rows.length, 2)
})

test('a lost write response with no readable marker freezes the original draft safely across restart', async () => {
  await app.stageDrafts([draft], { kind: 'manual' })
  const id = app.pendingBatches.value[0].id
  loseResponse = failMarkerRead = true
  await assert.rejects(app.confirmPendingBatch(id), /Connection lost/)
  assert.equal(ledger.get(book).rows.length, 1)
  await app.hydrate()
  assert.equal(app.pendingBatches.value[0].submitted, true)
  await assert.rejects(app.editPendingDraft(id, 0, { ...draft, amount: 999 }), /無法修改/)

  loseResponse = failMarkerRead = false
  assert.equal((await app.confirmPendingBatch(id)).result, 'already-written')
  assert.deepEqual(ledger.get(book).rows.map((row) => row[1]), [120])
  assert.deepEqual(app.pendingBatches.value, [])
})

test('a refresh failure after a confirmed write does not leave a draft to submit twice', async () => {
  await app.stageDrafts([draft], { kind: 'manual' })
  const id = app.pendingBatches.value[0].id
  failList = true
  const result = await app.confirmPendingBatch(id)
  assert.equal(result.result, 'written')
  assert.match(result.warnings.join(' '), /已入帳.*無法更新明細/)
  await app.hydrate()
  assert.deepEqual(app.pendingBatches.value, [])
  assert.equal(ledger.get(book).rows.length, 1)
})

test('AI leaves missing data and unsupported currency unresolved, but respects explicit relative dates', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-06T12:00:00Z') })
  modelResult = [
    { date: '昨天', amount: 120, note: '午餐' },
    null,
    { note: '未提日期', amount: 55 },
    { date: '2026-02-30', amount: true, note: '未確認' },
    { date: '今天', amount: 70, currency: 'USD', note: '海外付款' },
  ]
  const { transactions } = await parseTransactionsWithAI('not-a-real-key', '', '測試文字')
  assert.deepEqual(transactions.map(({ date, amount }) => [date, amount]), [
    ['2026-10-05', 120], ['', 55], ['', 0], ['2026-10-06', 0],
  ])
})

test('existing Sheets dates match equivalent ISO drafts without losing the original day', async () => {
  const serial = (Date.UTC(2026, 9, 5) - Date.UTC(1899, 11, 30)) / 86400000 + 0.75
  const row = (date, id) => [date, 120, '餐飲', '現金', '午餐', '支出', '', id]
  ledger.get(book).rows.push(row(serial, 'legacy-serial'), row('2026/10/5', 'legacy-text'))
  await app.refreshTransactions()
  assert.deepEqual(app.state.transactions.map((tx) => similarTransactionKey(tx)), [
    similarTransactionKey(draft), similarTransactionKey(draft),
  ])
})

test('receipt review requires a merchant, date and actual TWD total; previews do not persist', async () => {
  const { receiptDraft } = await server.ssrLoadModule('/src/receipt.ts')
  const clear = receiptDraft('山海茶舖\n115/11/27\n小計 160\n實付 NT$120\n找零 380')
  assert.deepEqual([clear.note, clear.date, clear.amount], ['山海茶舖', '2026-11-27', 120])
  assert.equal(receiptDraft('TOTAL: 1,200.00').amount, 1200)
  for (const text of ['找零 380', 'Subtotal 90', '合計 6.75', 'USD 7\nTOTAL 7', '合計 20\n合計 200']) {
    assert.equal(receiptDraft(text).amount, 0, text)
  }
  assert.equal(receiptDraft('日期 2026/02/30').date, '')
  const blank = receiptDraft('')
  const id = await app.stageDrafts([blank], { kind: 'photo' })
  app.receiptPreviews.set(id, 'test-preview')
  assert.equal(app.pendingBatches.value[0].source, 'photo')
  assert.ok(!JSON.stringify(await storage.getPendingBatches()).includes('test-preview'))
  await assert.rejects(app.confirmPendingBatch(id), /補齊/)
  await app.editPendingDraft(id, 0, { ...clear, note: '' })
  await assert.rejects(app.confirmPendingBatch(id), /補齊/)
  assert.equal(ledger.get(book).rows.length, 0)
  await app.editPendingDraft(id, 0, clear)
  await app.confirmPendingBatch(id)
  assert.deepEqual(ledger.get(book).rows.map(row => row[1]), [120])
  assert.equal(app.receiptPreviews.has(id), false)
})

test('Ministry QR sample reads the tax-inclusive hex total and skips right-side item data', async () => {
  const { invoiceCandidate } = await server.ssrLoadModule('/src/invoice.ts')
  // Ministry of Finance QR specification, UTF-8 example in section 4.
  const left = 'AB112233441020523999900000144000001540000000001234567ydXZt4LAN1UHN/j1juVcRA==:**********:3:3:1:乾電池:1:105:'
  const right = '**口罩:1:210:牛奶:1:25'
  const { number, draft } = invoiceCandidate({ codes: [right, left] })
  assert.deepEqual([number, draft.date, draft.amount, draft.note], ['AB11223344', '2013-05-23', 340, ''])
  assert.equal(invoiceCandidate({ text: '回刺回', codes: [left, right] }).draft.note, '')
  assert.equal(invoiceCandidate({ text: '商家：海山茶舖', codes: [left] }).draft.note, '海山茶舖')
  assert.deepEqual(invoiceCandidate({ text: left }), { number, draft })
  assert.throws(() => invoiceCandidate({ codes: [right] }), /左側/)
  assert.throws(() => invoiceCandidate({ codes: [left.slice(0, 48)] }), /左側/)
  assert.throws(() => invoiceCandidate({ codes: [left.replace('1020523', '1020230')] }), /日期/)
  assert.throws(() => invoiceCandidate({ text: 'CD-11223344', codes: [left] }), /多張/)
})

test('numbered invoices deduplicate across receipt text, QR, reload and committed Sheets markers', async () => {
  const { invoiceCandidate, invoiceEventId } = await server.ssrLoadModule('/src/invoice.ts')
  const parsed = invoiceCandidate({ text: '商家：海山商店\n發票號碼 AB-11223344\n2013/05/23\n實付 340' })
  assert.deepEqual([parsed.number, parsed.draft.date, parsed.draft.amount, parsed.draft.note],
    ['AB11223344', '2013-05-23', 340, '海山商店'])
  const source = { kind: 'invoice', invoiceNumber: parsed.number, eventId: invoiceEventId(parsed.number, parsed.draft.date) }
  const id = await app.stageDrafts([parsed.draft], source)
  await app.hydrate()
  assert.equal(app.pendingBatches.value[0].invoiceNumber, parsed.number)
  assert.match(await app.checkInvoiceImport(source.eventId, app.reviewBook.value), /已在待確認清單/)
  await assert.rejects(app.stageDrafts([parsed.draft], source), /已在待確認清單/)
  assert.equal(ledger.get(book).rows.length, 0)
  await app.confirmPendingBatch(id)
  assert.equal(ledger.get(book).rows.length, 1)
  // The commit marker survives even if another device has deleted the row.
  ledger.get(book).rows.length = 0
  await app.hydrate()
  await assert.rejects(app.stageDrafts([parsed.draft], source), /已入帳/)
  assert.equal(app.pendingBatches.value.length, 0)
  assert.notEqual(invoiceEventId(parsed.number, '2013-07-01'), source.eventId)
  assert.equal(invoiceEventId('', parsed.draft.date), undefined)
})

test('a bill stays a summary, including a card statement with itemized purchases', async () => {
  const { parseMail } = await server.ssrLoadModule('/src/mail.ts')
  const parsed = parseMail('帳單期間：2026/10/01 至 2026/10/31\n本期應繳金額：NT$ 1,250\n繳款截止日：2026/11/20\n交易金額：TWD 120\n商家：海山茶舖', '信用卡月結帳單')
  assert.deepEqual(parsed, { kind: 'bill', period: '2026/10/01 至 2026/10/31', due: '2026-11-20', money: 'NT$ 1,250' })
  assert.equal(ledger.get(book).rows.length, 0)
})

test('mail card purchase, reversal, declined transaction and foreign refund have different outcomes', async () => {
  const { parseMail } = await server.ssrLoadModule('/src/mail.ts')
  const source = '特店名稱：海山茶舖\n交易時間：2026/11/27 09:41\n交易金額：NT$ 120'
  const purchase = parseMail(source, '信用卡消費通知')
  assert.deepEqual([purchase.action, purchase.draft.note, purchase.draft.amount, purchase.draft.date, purchase.time],
    ['purchase', '海山茶舖', 120, '2026-11-27', '09:41'])
  assert.equal(parseMail(source, '刷卡取消通知').draft, undefined)
  assert.equal(parseMail(source + '\n本筆交易已取消', '刷卡通知').draft, undefined)
  assert.equal(parseMail(source + '\n交易結果：未核准', '信用卡交易通知').draft, undefined)
  const refund = parseMail(source.replace('NT$ 120', 'USD 3.25'), '信用卡退款通知')
  assert.deepEqual([refund.action, refund.draft.type, refund.draft.amount, refund.money], ['refund', '收入', 0, 'USD 3.25'])
  assert.equal(parseMail(source.replace('NT$ 120', '120'), '刷卡通知').draft.amount, 0)
})

test('an invoice attachment and a card notification meet in the review queue before any write', async () => {
  const { parseMail } = await server.ssrLoadModule('/src/mail.ts')
  const { readMailFile, readMailAttachment } = await server.ssrLoadModule('/src/mailFile.ts')
  const attachment = '商家：海山茶舖\n發票號碼 AB-11223344\n2026/11/27\n實付 120'
  const raw = ['Subject: Invoice', 'Message-ID: <fixture@example.test>', 'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=parts', '', '--parts', 'Content-Type: text/plain', '', 'See attached.',
    '--parts','Content-Type: text/plain; charset=UTF-8','Content-Disposition: attachment; filename="invoice.txt"',
    'Content-Transfer-Encoding: base64','', Buffer.from(attachment).toString('base64'),'--parts--'].join('\r\n')
  const mail = await readMailFile(new File([raw], 'invoice.eml'))
  const invoice = parseMail(mail.text, mail.subject, await readMailAttachment(mail.attachments[0]))
  const card = parseMail('交易時間：2026/11/27 09:41\n交易金額：TWD 120\n特店名稱：海山茶舖', '刷卡消費通知')
  assert.equal(invoice.number, 'AB11223344')
  const invoiceSource = { kind: 'mail-invoice', invoiceNumber: invoice.number, eventId: '2026/6/AB11223344' }
  const id = await app.stageDrafts([invoice.draft], invoiceSource)
  await assert.rejects(app.stageDrafts([invoice.draft], { ...invoiceSource, kind: 'invoice' }), /已在待確認清單/)
  const cardId = await app.stageDrafts([card.draft], { kind: 'mail-card', eventId: 'card-message-1' })
  assert.equal(app.pendingBatches.value.length, 2)
  assert.equal(similarTransactionKey(invoice.draft), similarTransactionKey(card.draft))
  assert.equal(ledger.get(book).rows.length, 0)
  await app.discardPendingBatch(cardId)
  await app.confirmPendingBatch(id)
  assert.equal(ledger.get(book).rows.length, 1)
  assert.ok(!JSON.stringify(ledger.get(book).rows).includes('fixture@example.test'))
})
