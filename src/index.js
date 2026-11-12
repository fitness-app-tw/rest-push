/**
 * Fitness 組間休息通知伺服器（部署在你自己的 Cloudflare 帳號）。
 *
 * 用途：iPhone 的網頁 App 在背景時會被系統暫停，無法自己準時跳出通知。
 * App 在休息開始時，把「時間到要送出的推送通知」先準備好（內容已加密、已簽名）交給這裡，
 * 這裡在指定的時間把它送到 Apple／Google 的推送服務。
 *
 * - 不存放任何訓練資料：只暫存尚未送出的通知（加密過，這裡讀不到內容），送出後即刪除。
 * - 沒有任何金鑰：通知由 App 加密、簽名。
 * - 第一台設定的裝置成為擁有者（送出一組隨機的存取碼），之後只接受帶有同一組存取碼的請求。
 */
import { DurableObject } from 'cloudflare:workers'

const VERSION = 1

/** 只轉送到這些推送服務（不能被拿來當成任意網址的轉送站） */
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^push\.services\.mozilla\.com$/]

/** 每一則通知最多保留多久（休息時間最長 59:59，再多留一點） */
const MAX_AHEAD = 2 * 60 * 60 * 1000
const MAX_JOBS = 50

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    const path = new URL(req.url).pathname
    // App 的「檢查」用：確認網址正確、這裡是組間休息通知伺服器
    if (req.method === 'GET' && path === '/') return json({ app: 'fitness-rest-push', version: VERSION })
    if (req.method !== 'POST' || !['/claim', '/schedule', '/cancel'].includes(path)) return json({ error: 'not-found' }, 404)
    let body
    try {
      body = await req.json()
    } catch {
      return json({ error: 'bad-request' }, 400)
    }
    const hub = env.HUB.get(env.HUB.idFromName('main'))
    const r = await hub.handle(path, body ?? {})
    return json(r.body, r.status)
  },
}

const isStr = (x, max) => typeof x === 'string' && x.length > 0 && x.length <= max

function validJob(j, allowLocal) {
  if (!j || !isStr(j.tag, 200) || typeof j.at !== 'number' || !isStr(j.endpoint, 1000) || !isStr(j.body ?? 'x', 8000)) return false
  if (j.at > Date.now() + MAX_AHEAD) return false
  let u
  try {
    u = new URL(j.endpoint)
  } catch {
    return false
  }
  const local = allowLocal && u.protocol === 'http:' && u.hostname === 'localhost'
  if (!local && (u.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(u.hostname)))) return false
  if (!j.headers || typeof j.headers !== 'object') return false
  return Object.entries(j.headers).every(([k, v]) => isStr(k, 100) && typeof v === 'string' && v.length <= 2000)
}

const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/** 一個帳號只有一個：存擁有者的存取碼、尚未送出的通知，用鬧鐘在時間到時送出 */
export class Hub extends DurableObject {
  async handle(path, b) {
    const store = this.ctx.storage
    const token = await store.get('token')
    if (path === '/claim') {
      if (!isStr(b.token, 200) || b.token.length < 20) return { status: 400, body: { error: 'bad-token' } }
      if (!token) {
        await store.put('token', b.token)
        return { status: 200, body: { ok: true } }
      }
      return token === b.token ? { status: 200, body: { ok: true } } : { status: 403, body: { error: 'claimed' } }
    }
    if (!token || b.token !== token) return { status: 401, body: { error: 'unauthorized' } }

    if (path === '/schedule') {
      const jobs = Array.isArray(b.jobs) ? b.jobs : []
      const allowLocal = this.env.ALLOW_LOCAL === '1'
      if (!jobs.length || jobs.length > MAX_JOBS || !jobs.every((j) => validJob(j, allowLocal))) return { status: 400, body: { error: 'bad-job' } }
      const pending = await store.list({ prefix: 'job:' })
      if (pending.size + jobs.length > MAX_JOBS * 2) return { status: 429, body: { error: 'too-many' } }
      for (const j of jobs) await store.put(`job:${j.tag}`, { at: j.at, endpoint: j.endpoint, headers: j.headers, body: j.body ?? '' })
      await this.arm()
      return { status: 200, body: { ok: true } }
    }

    // /cancel：tags 沒給就取消全部
    const tags = Array.isArray(b.tags) ? b.tags.filter((t) => isStr(t, 200)) : null
    const keys = tags ? tags.map((t) => `job:${t}`) : [...(await store.list({ prefix: 'job:' })).keys()]
    for (let i = 0; i < keys.length; i += 100) await store.delete(keys.slice(i, i + 100))
    await this.arm()
    return { status: 200, body: { ok: true } }
  }

  /** 鬧鐘設在最早的那一則 */
  async arm() {
    const store = this.ctx.storage
    let next = Infinity
    for (const j of (await store.list({ prefix: 'job:' })).values()) next = Math.min(next, j.at)
    if (next === Infinity) await store.deleteAlarm()
    else await store.setAlarm(Math.max(next, Date.now()))
  }

  async alarm() {
    const store = this.ctx.storage
    const now = Date.now()
    const due = [...(await store.list({ prefix: 'job:' })).entries()].filter(([, j]) => j.at <= now + 300)
    // 先刪再送：同一則不會送兩次
    if (due.length) await store.delete(due.map(([k]) => k))
    await Promise.all(
      due.map(([, j]) =>
        fetch(j.endpoint, { method: 'POST', headers: j.headers, body: j.body ? fromB64(j.body) : undefined }).catch(() => {}),
      ),
    )
    await this.arm()
  }
}
