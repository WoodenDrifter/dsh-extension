// dsh-extension：宿主机侧。
//
// 只做两件事：
//   GET  /__dsh-start/ext/bsk/status   读 bsk daemon 的状态（端口 / 版本 / 连接）
//   POST /__dsh-start/ext/bsk/restart  重启 bsk daemon（stop → 600ms → start）
//
// 路径里的 dsh-start 指本机的 DSH-start 控制台（同源工具），与插件名无关，
// 改掉会让已缓存的旧前端拿到 404，所以保持不变。
//
// bsk 是独立进程，跟 dsh 没关系，所以这里直接 spawn bsk.exe，
// 走和控制台（DSH-start）同一套语义：daemon stop --quiet，再 daemon start --foreground。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { spawn } from 'node:child_process'

const NAME = 'dsh-extension'
const inject = []

const BSK_PORT = 52800
const HOME = os.homedir()
const BSK_EXE = process.env.BSK_PATH || path.join(HOME, '.local', 'bin', 'bsk.exe')
const BSK_HOME = process.env.BSK_HOME || path.join(HOME, '.bsk')
const OUT_LOG = path.join(BSK_HOME, 'dsh-ext.out.log')
const ERR_LOG = path.join(BSK_HOME, 'dsh-ext.err.log')

let versionCache = null

function portOpen(port, timeout = 500) {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      sock.destroy()
      resolve(v)
    }
    sock.setTimeout(timeout)
    sock.once('connect', () => finish(true))
    sock.once('timeout', () => finish(false))
    sock.once('error', () => finish(false))
    sock.connect(port, '127.0.0.1')
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function todayLog() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return path.join(BSK_HOME, `daemon.log.${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)
}

function tail(file, bytes = 64 * 1024) {
  try {
    const st = fs.statSync(file)
    const take = Math.min(st.size, bytes)
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(take)
    fs.readSync(fd, buf, 0, take, st.size - take)
    fs.closeSync(fd)
    return buf.toString('utf8')
  } catch {
    return ''
  }
}

function bskVersion() {
  return new Promise((resolve) => {
    if (!fs.existsSync(BSK_EXE)) return resolve(null)
    const st = fs.statSync(BSK_EXE)
    if (versionCache && versionCache.mtime === st.mtimeMs) return resolve(versionCache.version)
    const child = spawn(BSK_EXE, ['--version'], { windowsHide: true })
    let out = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      resolve(null)
    }, 8000)
    child.stdout.on('data', (d) => (out += d.toString()))
    child.on('close', () => {
      clearTimeout(timer)
      const m = /(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/.exec(out)
      const v = m ? m[1] : null
      versionCache = { mtime: st.mtimeMs, version: v }
      resolve(v)
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
  })
}

// 与 DSH-start 控制台同一套判断：日志里最后一次 connect/disconnect 谁更新
function connection(alive) {
  const file = todayLog()
  const text = tail(file)
  if (!text) return { connected: false, evidence: '无今日 daemon 日志' }
  const lines = text.split(/\r?\n/)
  let lastConnect = -1
  let lastDisconnect = -1
  let lastName = null
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    const isC = /browser connected/.test(l)
    const isD = /browser (disconnected|closed|gone|removed)/.test(l)
    if (isC && lastConnect < 0) {
      lastConnect = i
      const nm = /"name"\s*:\s*"([^"]+)"|name=(\S+)/.exec(l)
      if (nm) lastName = nm[1] || nm[2]
    }
    if (isD && lastDisconnect < 0) lastDisconnect = i
    if (lastConnect >= 0 && lastDisconnect >= 0) break
  }
  // 日志里可能还留着升级前的「协议不兼容」记录，只有它发生在最近一次连接之后、
  // 且当前没有连上，才算真的有问题；否则升级完 bsk 会一直挂着旧告警。
  const kickRe = /local protocol ([\d.]+) is below peer min_compatible_protocol ([\d.]+)/
  let kickIdx = -1
  let kick = null
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = kickRe.exec(lines[i])
    if (m) {
      kickIdx = i
      kick = m
      break
    }
  }
  const connected = alive && lastConnect >= 0 && lastConnect > lastDisconnect
  const kickedAfterConnect = kick && kickIdx > lastConnect
  return {
    connected,
    evidence: connected
      ? lastName
        ? `日志：browser connected（${lastName}）`
        : '日志：浏览器已连接'
      : alive
        ? 'daemon 在跑，但还没有浏览器连上来'
        : 'daemon 未运行，扩展当前未连接',
    browser: lastName,
    protocolWarning: !connected && kickedAfterConnect ? `协议不兼容：本地 ${kick[1]} < 对端最低 ${kick[2]}，建议升级 bsk` : null,
  }
}

async function status() {
  const installed = fs.existsSync(BSK_EXE)
  const alive = installed ? await portOpen(BSK_PORT) : false
  const ver = installed ? await bskVersion() : null
  const conn = connection(alive)
  return {
    installed,
    running: alive,
    port: BSK_PORT,
    version: ver,
    connected: conn.connected,
    evidence: conn.evidence,
    browser: conn.browser || null,
    protocolWarning: conn.protocolWarning || null,
  }
}

function openLogs() {
  try {
    fs.mkdirSync(BSK_HOME, { recursive: true })
    return { out: fs.openSync(OUT_LOG, 'a'), err: fs.openSync(ERR_LOG, 'a') }
  } catch {
    return { out: 'ignore', err: 'ignore' }
  }
}

function runBsk(args, timeout = 15000) {
  return new Promise((resolve) => {
    if (!fs.existsSync(BSK_EXE)) return resolve({ ok: false, error: '未找到 bsk.exe' })
    const child = spawn(BSK_EXE, args, { cwd: BSK_HOME, windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
    }, timeout)
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, code, out, err })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, error: e.message })
    })
  })
}

async function restart() {
  const startedAt = Date.now()
  const steps = []
  if (!fs.existsSync(BSK_EXE)) {
    return { ok: false, message: '未找到 bsk.exe：' + BSK_EXE, steps }
  }

  const wasRunning = await portOpen(BSK_PORT)
  steps.push({ t: Date.now() - startedAt, text: wasRunning ? 'daemon 在运行，先停止' : 'daemon 未运行，直接启动' })

  if (wasRunning) {
    const r = await runBsk(['daemon', 'stop', '--quiet'])
    steps.push({ t: Date.now() - startedAt, text: `stop 退出码 ${r.code}${r.ok ? '' : '（忽略）'}` })
    for (let i = 0; i < 40; i++) {
      if (!(await portOpen(BSK_PORT, 300))) break
      await sleep(250)
    }
  }

  await sleep(600)

  // 清掉可能残留的 daemon.json / daemon.lock，否则 bsk 会以为还有实例
  for (const f of ['daemon.json', 'daemon.lock']) {
    try {
      fs.rmSync(path.join(BSK_HOME, f), { force: true })
    } catch {}
  }

  const logs = openLogs()
  const child = spawn(BSK_EXE, ['daemon', 'start', '--foreground'], {
    cwd: BSK_HOME,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', logs.out, logs.err],
    env: { ...process.env, BSK_AUTO_START: '0' },
  })
  child.unref()
  steps.push({ t: Date.now() - startedAt, text: `start 已投递（pid ${child.pid}）` })

  let up = false
  for (let i = 0; i < 80; i++) {
    if (await portOpen(BSK_PORT, 300)) {
      up = true
      break
    }
    await sleep(250)
  }
  steps.push({ t: Date.now() - startedAt, text: up ? `端口 ${BSK_PORT} 已就绪` : `等待端口 ${BSK_PORT} 超时` })

  const st = await status()
  return {
    ok: up,
    ms: Date.now() - startedAt,
    message: up ? 'bsk 已重启' : 'bsk 启动后没能监听端口',
    steps,
    status: st,
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function apply(ctx) {
  function registerHttp(host, targetCtx) {
    targetCtx.effect(() =>
      host.register({
        kind: 'exact',
        path: '/__dsh-start/ext/bsk/status',
        handler: async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          try {
            sendJson(res, 200, { ok: true, data: await status() })
          } catch (e) {
            sendJson(res, 500, { ok: false, error: e.message })
          }
        },
      })
    )

    targetCtx.effect(() =>
      host.register({
        kind: 'exact',
        path: '/__dsh-start/ext/bsk/restart',
        handler: async (req, res) => {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          try {
            const r = await restart()
            sendJson(res, r.ok ? 200 : 500, { ok: r.ok, data: r, error: r.ok ? undefined : r.message })
          } catch (e) {
            sendJson(res, 500, { ok: false, error: e.message })
          }
        },
      })
    )
  }

  const ws = ctx.get('webServer')
  if (ws !== undefined) registerHttp(ws, ctx)
  else ctx.inject(['webServer'], (sub) => registerHttp(sub.webServer, sub))
}

export { apply, inject, NAME as name }
