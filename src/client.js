// dsh-extension：浏览器侧。
//
// 在侧栏「自动化任务」下面加一行「拓展」（order 11），点开是一个面板，
// 面板里是可折叠分组，分组内是 bsk 的状态与「重启 bsk」按钮。
//
// Bundle 格式（client-modules 协议）：经典脚本，通过 window.__ModuleLoader__.load
// 注册工厂；工厂拿到 require，返回 { apply, inject }。
// 不用 JSX：一律 React.createElement；颜色用 dsw 主题变量并带兜底值。
window.__ModuleLoader__.load({
  // 这里的 id 必须与 package.json 的 name 完全一致。
  // 写成短名会让 harness 认为「加载了但没注册」，进而把它后面的整串模块一起判成 pending。
  id: 'dsh-extension',
  factory: (require) => {
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useRef, useState } = React

    const NS = 'dsh-extension'
    const PANEL_ID = 'dsh-extension'
    const STORE_KEY = 'dsh-extension.open'

    const C = {
      text: 'var(--dsw-text-primary, #e6e6e8)',
      text2: 'var(--dsw-text-secondary, #b0b3b8)',
      text3: 'var(--dsw-text-tertiary, #76797e)',
      line: 'var(--dsw-border-subtle, rgba(255,255,255,.10))',
      card: 'var(--dsw-bg-elevated, rgba(255,255,255,.035))',
      hover: 'var(--dsw-bg-hover, rgba(255,255,255,.06))',
      ok: 'var(--dsw-accent-success, #2ec866)',
      warn: 'var(--dsw-accent-warning, #f0931b)',
      err: 'var(--dsw-accent-danger, #ff5c5c)',
      primary: 'var(--dsw-accent-primary, #5c7bff)',
      mono: 'var(--dsw-font-mono, ui-monospace, Consolas, monospace)',
    }

    function IconBsk(props) {
      const size = (props && props.size) || 18
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 2.5, y: 2.5, width: 9, height: 9, rx: 2.2, stroke: 'currentColor', strokeWidth: 1.4 }),
        h('rect', { x: 8.5, y: 8.5, width: 9, height: 9, rx: 2.2, stroke: 'currentColor', strokeWidth: 1.4, opacity: 0.65 }),
        h('path', { d: 'M12.8 3.6l3.4 3.4M16.2 3.6l-3.4 3.4', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' })
      )
    }

    function Dot({ color }) {
      return h('span', {
        style: {
          display: 'inline-block',
          width: 7,
          height: 7,
          borderRadius: 999,
          background: color,
          boxShadow: `0 0 6px ${color}`,
          flex: 'none',
        },
      })
    }

    function Pill({ children, tone }) {
      const color = tone === 'ok' ? C.ok : tone === 'warn' ? C.warn : tone === 'err' ? C.err : C.text3
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 11,
            lineHeight: '16px',
            padding: '1px 8px',
            borderRadius: 999,
            color,
            border: `1px solid ${color}44`,
            background: `${color}14`,
            whiteSpace: 'nowrap',
          },
        },
        h(Dot, { color }),
        children
      )
    }

    function Btn({ children, onClick, disabled, primary }) {
      const [hover, setHover] = useState(false)
      return h(
        'button',
        {
          type: 'button',
          disabled,
          onClick,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            height: 28,
            padding: '0 12px',
            fontSize: 12.5,
            borderRadius: 7,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            color: primary ? '#fff' : C.text,
            background: primary ? (hover ? '#7c9bff' : C.primary) : hover ? C.hover : 'transparent',
            border: primary ? '1px solid transparent' : `1px solid ${C.line}`,
            transition: 'background .12s',
          },
        },
        children
      )
    }

    async function getStatus() {
      const res = await fetch('/__dsh-start/ext/bsk/status', { credentials: 'same-origin' })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error || '状态读取失败')
      return j.data
    }

    function ExtPage() {
      const [open, setOpen] = useState(() => {
        try {
          return localStorage.getItem(STORE_KEY) !== '0'
        } catch {
          return true
        }
      })
      const [st, setSt] = useState(null)
      const [err, setErr] = useState(null)
      const [busy, setBusy] = useState(false)
      const [steps, setSteps] = useState([])
      const [result, setResult] = useState(null)
      const alive = useRef(true)

      const refresh = useCallback(async () => {
        try {
          const s = await getStatus()
          if (alive.current) {
            setSt(s)
            setErr(null)
          }
        } catch (e) {
          if (alive.current) setErr(e.message)
        }
      }, [])

      useEffect(() => {
        alive.current = true
        refresh()
        const t = setInterval(refresh, 5000)
        return () => {
          alive.current = false
          clearInterval(t)
        }
      }, [refresh])

      const toggle = () => {
        const next = !open
        setOpen(next)
        try {
          localStorage.setItem(STORE_KEY, next ? '1' : '0')
        } catch {}
      }

      const doRestart = async () => {
        setBusy(true)
        setResult(null)
        setSteps([{ t: 0, text: '正在重启 bsk…' }])
        const started = Date.now()
        try {
          const res = await fetch('/__dsh-start/ext/bsk/restart', { method: 'POST', credentials: 'same-origin' })
          const j = await res.json()
          if (alive.current) {
            setResult({ ok: Boolean(j.ok), message: (j.data && j.data.message) || j.error || '' })
            setSteps((j.data && j.data.steps) || [])
            if (j.data && j.data.status) setSt(j.data.status)
          }
        } catch (e) {
          if (alive.current) setResult({ ok: false, message: e.message })
        } finally {
          if (alive.current) {
            setBusy(false)
            refresh()
          }
        }
      }

      const badge = !st
        ? { text: '读取中…', tone: '' }
        : !st.installed
          ? { text: '未安装 bsk', tone: '' }
          : st.running
            ? st.connected
              ? { text: '已连接浏览器', tone: 'ok' }
              : { text: 'daemon 运行中 · 未连接', tone: 'warn' }
            : { text: 'daemon 未运行', tone: '' }

      return h(
        'div',
        { style: { padding: '22px 26px', maxWidth: 860, color: C.text } },
        h('div', { style: { fontSize: 19, fontWeight: 600, marginBottom: 4 } }, '拓展'),
        h('div', { style: { fontSize: 12.5, color: C.text2, marginBottom: 18 } }, '本机扩展与工具。这里管理浏览器扩展 bsk 的 daemon。'),

        // ---------------- 可折叠分组
        h(
          'div',
          { style: { border: `1px solid ${C.line}`, borderRadius: 10, background: C.card, overflow: 'hidden' } },
          h(
            'div',
            {
              onClick: toggle,
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '11px 14px',
                cursor: 'pointer',
                userSelect: 'none',
              },
            },
            h('span', {
              style: {
                display: 'inline-block',
                fontSize: 10,
                color: C.text3,
                transform: open ? 'rotate(90deg)' : 'none',
                transition: 'transform .15s',
              },
            }, '▶'),
            h(
              'span',
              { style: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600 } },
              h(IconBsk, { size: 16 }),
              '浏览器扩展（bsk）'
            ),
            h(Pill, { tone: badge.tone }, badge.text),
            h('span', { style: { flex: 1 } }),
            st && st.running
              ? h('span', { style: { fontSize: 11.5, color: C.text3, fontFamily: C.mono } }, `:${st.port} · v${st.version || '?'}`)
              : null
          ),
          open
            ? h(
                'div',
                { style: { borderTop: `1px solid ${C.line}`, padding: '12px 14px 14px' } },
                err ? h('div', { style: { fontSize: 12, color: C.err, marginBottom: 8 } }, err) : null,
                h(
                  'div',
                  { style: { fontSize: 12.5, color: C.text2, lineHeight: 1.75, marginBottom: 10 } },
                  st ? st.evidence : '读取中…'
                ),
                st && st.protocolWarning
                  ? h(
                      'div',
                      {
                        style: {
                          fontSize: 12,
                          color: C.warn,
                          border: `1px solid ${C.warn}44`,
                          background: `${C.warn}14`,
                          borderRadius: 7,
                          padding: '7px 10px',
                          marginBottom: 10,
                          lineHeight: 1.6,
                        },
                      },
                      st.protocolWarning
                    )
                  : null,
                h(
                  'div',
                  { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                  h(Btn, { primary: true, onClick: doRestart, disabled: busy }, busy ? '正在重启…' : '重启 bsk'),
                  h(Btn, { onClick: refresh, disabled: busy }, '刷新状态'),
                  result
                    ? h(
                        'span',
                        { style: { fontSize: 12, color: result.ok ? C.ok : C.err } },
                        (result.ok ? '✓ ' : '✗ ') + result.message
                      )
                    : null
                ),
                steps.length
                  ? h(
                      'div',
                      {
                        style: {
                          marginTop: 10,
                          fontFamily: C.mono,
                          fontSize: 11.5,
                          lineHeight: 1.7,
                          color: C.text3,
                          background: 'rgba(0,0,0,.25)',
                          border: `1px solid ${C.line}`,
                          borderRadius: 7,
                          padding: '8px 10px',
                          maxHeight: 150,
                          overflow: 'auto',
                          whiteSpace: 'pre-wrap',
                        },
                      },
                      steps.map((s, i) => h('div', { key: i }, `${String(s.t).padStart(5, ' ')}ms  ${s.text}`))
                    )
                  : null,
                h(
                  'div',
                  { style: { fontSize: 11, color: C.text3, marginTop: 10, lineHeight: 1.7 } },
                  '重启会先 daemon stop，再以 --foreground 重新拉起，等 52800 端口就绪。',
                  '这一步只影响浏览器扩展，不会中断当前对话。'
                )
              )
            : null
        )
      )
    }

    function apply(ctx) {
      // 任何一步失败都只记录、不抛：这个面板挂掉不应该把整包 UI 拖下水。
      try {
        // 先注册主面板，否则点侧栏条目时 layout.selectPanel 会找不到目标
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, ExtPage))
      } catch (e) {
        console.warn(`[${NS}] 注册主面板失败`, e)
      }
      try {
        // 侧栏：order 11 正好排在「自动化任务」(order 10) 下面
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 11, locale: NS, label: () => '拓展' },
            IconBsk
          )
        )
      } catch (e) {
        console.warn(`[${NS}] 注册侧栏项失败`, e)
      }
    }

    return { apply, inject: ['slots'] }
  },
})
