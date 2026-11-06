// dsh-extension：浏览器侧 —— 「拓展」容器。
//
// 这个包本身不带任何功能，只提供一块面板和一个注册契约：
//   ctx.provide('extensionHub', { version, register(item), list(), subscribe(fn) })
// 其它插件（例如 dsh-bsk-daemon）把自己的卡片注册进来，这里统一负责
// 折叠、拖拽排序、开关、搜索和持久化。所有卡片平铺成一条列表，不分分类。
//
// Bundle 格式（client-modules 协议）：经典脚本，通过 window.__ModuleLoader__.load
// 注册工厂；工厂拿到 require，返回 { apply, inject }。不用 JSX。
window.__ModuleLoader__.load({
  // id 必须与 package.json 的 name 完全一致，短名会被判成「加载了但没注册」
  id: 'dsh-extension',
  factory: (require) => {
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'dsh-extension'
    const PANEL_ID = 'dsh-extension'
    const STORE_KEY = 'dsh-extension.state.v2'

    // dsh 真实主题 token（--dsw-alias-* 家族）；每个都带兜底，浅色主题也能跟随
    const C = {
      text: 'var(--dsw-alias-label-primary, #e6e6e8)',
      text2: 'var(--dsw-alias-label-secondary, #b0b3b8)',
      text3: 'var(--dsw-alias-label-tertiary, #76797e)',
      line: 'var(--dsw-alias-border-l1, rgba(128,128,128,.28))',
      line2: 'var(--dsw-alias-border-l2, rgba(128,128,128,.18))',
      card: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.10))',
      panel: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06))',
      hover: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16))',
      ok: 'var(--dsw-alias-state-success-primary, #2ec866)',
      warn: 'var(--dsw-alias-state-warn-primary, #f0931b)',
      err: 'var(--dsw-alias-state-error-primary, #ff5c5c)',
      primary: 'var(--dsw-alias-state-business-primary, #4176e6)',
      thumb: 'var(--dsw-alias-switch-thumb, #fff)',
      mono: 'var(--dsw-font-markdown-code-font-family, ui-monospace, Consolas, monospace)',
    }

    const SCOPES = [
      { id: 'all', zh: '全部', en: 'All' },
      { id: 'name', zh: '名称', en: 'Name' },
      { id: 'desc', zh: '简介', en: 'Description' },
    ]
    const RESTART_REASON = {
      'no-hmr': '这个 profile 没装 HMR，改动只在启动时生效',
      'package-moved': '包目录发生了搬迁',
      'host-module': '改到了宿主进程自己 import 的模块',
      'unmanaged-plugin': '该插件不在 Loader 条目里',
      'module-comparison': '没法把已加载模块和磁盘上的文件对上',
    }

    // ---------------- 注册表 ----------------
    const items = new Map()
    const regListeners = new Set()

    function notify() {
      for (const fn of regListeners) {
        try {
          fn()
        } catch {}
      }
    }

    const hub = {
      version: 1,
      register(item) {
        if (!item || typeof item.id !== 'string' || item.id === '') throw new Error('extensionHub: item.id 必填')
        items.set(item.id, item)
        notify()
        return () => {
          if (items.get(item.id) === item) {
            items.delete(item.id)
            notify()
          }
        }
      },
      list() {
        return Array.from(items.values())
      },
      subscribe(fn) {
        regListeners.add(fn)
        return () => regListeners.delete(fn)
      },
    }

    // ---------------- 持久化 ----------------
    function loadState() {
      const base = { order: [], collapsed: {}, scope: 'all', snapshot: {}, disabled: {} }
      try {
        const raw = localStorage.getItem(STORE_KEY)
        if (!raw) return base
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return base
        return {
          order: Array.isArray(parsed.order) ? parsed.order.filter((x) => typeof x === 'string') : [],
          collapsed: parsed.collapsed && typeof parsed.collapsed === 'object' ? parsed.collapsed : {},
          scope: SCOPES.some((s) => s.id === parsed.scope) ? parsed.scope : 'all',
          snapshot: parsed.snapshot && typeof parsed.snapshot === 'object' ? parsed.snapshot : {},
          disabled: parsed.disabled && typeof parsed.disabled === 'object' ? parsed.disabled : {},
        }
      } catch {
        return base
      }
    }

    const P = { data: loadState(), timer: null }
    function persistSoon() {
      if (P.timer) clearTimeout(P.timer)
      P.timer = setTimeout(() => {
        P.timer = null
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify(P.data))
        } catch {}
      }, 300)
    }

    // ---------------- 小工具 ----------------
    function pick(text, lang) {
      if (!text) return ''
      return (lang === 'en' ? text.en || text.zh : text.zh || text.en) || ''
    }

    // ---------------- 原子组件 ----------------
    function IconExt(props) {
      const size = (props && props.size) || 18
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 2.5, y: 2.5, width: 9, height: 9, rx: 2.2, stroke: 'currentColor', strokeWidth: 1.4 }),
        h('rect', { x: 8.5, y: 8.5, width: 9, height: 9, rx: 2.2, stroke: 'currentColor', strokeWidth: 1.4, opacity: 0.65 }),
        h('path', { d: 'M12.8 3.6l3.4 3.4M16.2 3.6l-3.4 3.4', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' })
      )
    }

    function IconSearch({ size = 14 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('circle', { cx: 7, cy: 7, r: 4.6, stroke: 'currentColor', strokeWidth: 1.4 }),
        h('path', { d: 'M10.6 10.6L14 14', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' })
      )
    }

    function Chevron({ open, size = 10 }) {
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size + 4,
            height: size + 4,
            color: C.text3,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform .15s',
            flex: 'none',
          },
        },
        h(
          'svg',
          { width: size, height: size, viewBox: '0 0 10 10', fill: 'none', 'aria-hidden': 'true' },
          h('path', { d: 'M3 1.5L7 5l-4 3.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' })
        )
      )
    }

    function Switch({ checked, disabled, busy, onChange, label }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': label,
          title: label,
          disabled: disabled || busy,
          onClick: (e) => {
            e.stopPropagation()
            if (!disabled && !busy && onChange) onChange(!checked)
          },
          style: {
            width: 34,
            height: 19,
            flex: 'none',
            border: 'none',
            padding: 0,
            borderRadius: 999,
            position: 'relative',
            background: checked ? C.primary : 'rgba(128,128,128,.38)',            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.45 : busy ? 0.6 : 1,
            transition: 'background .15s, opacity .15s',
          },
        },
        h('span', {
          style: {
            position: 'absolute',
            top: 2.5,
            left: checked ? 17.5 : 2.5,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: C.thumb,
            boxShadow: '0 1px 2px rgba(0,0,0,.35)',
            transition: 'left .15s',
          },
        })
      )
    }

    function Highlight({ text, query }) {
      if (!query || !text) return h('span', null, text || '')
      const lower = text.toLowerCase()
      const q = query.toLowerCase()
      if (lower.indexOf(q) < 0) return h('span', null, text)
      const out = []
      let i = 0
      let n = 0
      while (i <= text.length) {
        const at = lower.indexOf(q, i)
        if (at < 0) {
          out.push(text.slice(i))
          break
        }
        if (at > i) out.push(text.slice(i, at))
        out.push(
          h(
            'mark',
            {
              key: `m${n++}`,
              style: { background: `${C.warn}44`, color: 'inherit', borderRadius: 2, padding: '0 1px' },
            },
            text.slice(at, at + q.length)
          )
        )
        i = at + q.length
      }
      return h('span', null, out)
    }

    // ---------------- 插件清单 / 开关 ----------------
    // 远端调用偶尔会慢一拍或暂时不通，这里带超时和重试；最近一次成功的结果做缓存，
    // 面板重开时先用旧的渲染，再用新结果覆盖。
    const rowsCache = { rows: [], pm: null }

    function withTimeout(promise, ms, label) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label}超时`)), ms)
        promise.then(
          (v) => {
            clearTimeout(timer)
            resolve(v)
          },
          (e) => {
            clearTimeout(timer)
            reject(e)
          }
        )
      })
    }

    async function readRows(ctx) {
      let inv
      let pm
      try {
        inv = ctx.get('remote.pluginInventory')
        pm = ctx.get('remote.pluginManager')
      } catch {
        inv = pm = undefined
      }
      if (!inv || !pm) throw new Error('这个 profile 没有提供插件管理接口')

      const snap = await withTimeout(inv.list(), 8000, '读取插件清单')
      if (!snap || !snap.ok) throw new Error('读取插件清单失败')
      if (snap.value.managementAvailable !== true) throw new Error('该 profile 不支持持久化插件管理')

      const rows = await withTimeout(pm.listPlugins(), 8000, '读取插件列表')
      if (!rows || !rows.ok) throw new Error('读取插件列表失败')
      return { pm, rows: rows.value || [] }
    }

    function usePluginRows(ctx, tick) {
      const [state, setState] = useState(() =>
        rowsCache.pm
          ? { status: 'ready', reason: '', pm: rowsCache.pm, rows: rowsCache.rows }
          : { status: 'loading', reason: '', pm: null, rows: [] }
      )

      const load = useCallback(async () => {
        let lastError = null
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const got = await readRows(ctx)
            rowsCache.pm = got.pm
            rowsCache.rows = got.rows
            setState({ status: 'ready', reason: '', pm: got.pm, rows: got.rows })
            return
          } catch (e) {
            lastError = e
            await new Promise((r) => setTimeout(r, 250 + attempt * 500))
          }
        }
        setState({
          status: 'unavailable',
          reason: (lastError && lastError.message) || '插件管理不可用',
          pm: rowsCache.pm,
          rows: rowsCache.rows,
        })
      }, [ctx])

      useEffect(() => {
        load()
      }, [load, tick])

      return Object.assign({ reload: load }, state)
    }

    function rowFor(rows, pluginName) {
      if (!pluginName) return null
      for (const r of rows) {
        if (r.moduleName === pluginName || r.entryId === pluginName) return r
      }
      return null
    }

    function useLang(ctx) {
      const [lang, setLang] = useState(() => {
        const loc = ctx.get('locale')
        try {
          return (loc && loc.getSnapshot().active) || 'zh'
        } catch {
          return 'zh'
        }
      })
      useEffect(() => {
        const loc = ctx.get('locale')
        if (!loc || !loc.subscribe) return undefined
        return loc.subscribe(() => {
          try {
            setLang(loc.getSnapshot().active)
          } catch {}
        })
      }, [ctx])
      return lang
    }

    // ---------------- 面板 ----------------
    function HubPage(props) {
      const ctx = props && props.ctx
      const lang = useLang(ctx)
      const [version, setVersion] = useState(0)
      const [tick, setTick] = useState(0)
      const [query, setQuery] = useState('')
      const [scope, setScope] = useState(P.data.scope)
      const [busyId, setBusyId] = useState(null)
      const [notice, setNotice] = useState(null)
      const [dragId, setDragId] = useState(null)
      const [over, setOver] = useState(null)
      const viewRef = useRef({ ids: [] })

      const plugins = usePluginRows(ctx, tick)

      useEffect(() => {
        const un = hub.subscribe(() => setVersion((n) => n + 1))
        return un
      }, [])

      const registered = hub.list()

      // 注册过但当前没加载的卡片（多是被关掉了），用快照补一条占位
      const placeholders = useMemo(() => {
        const out = []
        const have = new Set(registered.map((i) => i.id))
        for (const id of Object.keys(P.data.snapshot)) {
          if (have.has(id)) continue
          const snap = P.data.snapshot[id]
          if (!snap || !snap.pluginName) continue
          const row = rowFor(plugins.rows, snap.pluginName)
          // 刚被我们关掉的（P.data.disabled 立即可用）优先，其次看插件清单里的实际状态
          if (P.data.disabled[id] === true || (row && row.enabled === false)) {
            out.push(Object.assign({ placeholder: true }, snap, { id }))
          }
        }
        return out
      }, [version, plugins.rows])

      // 记住每张卡的元数据，供上面那步兜底
      useEffect(() => {
        let dirty = false
        for (const item of registered) {
          const rec = {
            name: item.name || {},
            desc: item.desc || {},
            order: item.order || 0,
            pluginName: item.pluginName || undefined,
          }
          const old = P.data.snapshot[item.id]
          if (!old || JSON.stringify(old) !== JSON.stringify(rec)) {
            P.data.snapshot[item.id] = rec
            dirty = true
          }
          if (P.data.disabled[item.id]) {
            delete P.data.disabled[item.id]
            dirty = true
          }
        }
        if (dirty) persistSoon()
      }, [version])

      const all = useMemo(() => registered.concat(placeholders), [version, placeholders])

      // 视觉顺序：先按持久化的 order 数组，再按 item.order
      const list = useMemo(() => {
        const q = query.trim().toLowerCase()
        const sorted = all.slice().sort((a, b) => {
          const ia = P.data.order.indexOf(a.id)
          const ib = P.data.order.indexOf(b.id)
          if (ia >= 0 && ib >= 0) return ia - ib
          if (ia >= 0) return -1
          if (ib >= 0) return 1
          return (a.order || 0) - (b.order || 0)
        })
        return q ? sorted.filter((item) => matchItem(item, q, scope, lang)) : sorted
      }, [version, all, query, scope, lang])

      viewRef.current = { ids: list.map((i) => i.id) }

      const total = registered.length + placeholders.length
      const hit = list.length

      const toggleCollapse = useCallback((key, next) => {
        P.data.collapsed[key] = next
        persistSoon()
        setVersion((n) => n + 1)
      }, [])

      const changeScope = useCallback((id) => {
        setScope(id)
        P.data.scope = id
        persistSoon()
      }, [])

      // 把当前视觉顺序写回持久化数组，作为后续拖拽的基准
      const syncOrder = useCallback(() => {
        const ids = viewRef.current.ids
        if (ids.length === 0) return
        const merged = ids.slice()
        for (const id of P.data.order) if (merged.indexOf(id) < 0) merged.push(id)
        P.data.order = merged
      }, [])

      const moveItem = useCallback(
        (id, beforeId) => {
          syncOrder()
          const arr = P.data.order.filter((x) => x !== id)
          const at = beforeId ? arr.indexOf(beforeId) : -1
          if (at >= 0) arr.splice(at, 0, id)
          else arr.push(id)
          P.data.order = arr
          persistSoon()
          setVersion((n) => n + 1)
        },
        [syncOrder]
      )

      const step = useCallback(
        (id, delta) => {
          const ids = viewRef.current.ids
          const at = ids.indexOf(id)
          if (at < 0) return
          const to = at + delta
          if (to < 0 || to >= ids.length) return
          const before = delta < 0 ? ids[to] : ids[to + 1] || null
          moveItem(id, before)
        },
        [moveItem]
      )

      const doToggle = useCallback(
        async (item, next) => {
          const row = rowFor(plugins.rows, item.pluginName)
          if (!plugins.pm || !row) {
            setNotice({ tone: 'err', text: plugins.reason || '找不到这个插件对应的管理条目' })
            return
          }
          if (row.readOnlyReason) {
            setNotice({ tone: 'err', text: `这一行不可修改（${row.readOnlyReason}）` })
            return
          }
          setBusyId(item.id)
          setNotice(null)
          try {
            const res = await plugins.pm.setPluginEnabled(row.entryId, next)
            if (!res || !res.ok) {
              setNotice({ tone: 'err', text: (res && res.error && (res.error.code || res.error.diagnostic)) || '操作失败' })
              return
            }
            const v = res.value || {}
            if (v.application === 'applied') {
              // 立刻记下\"这张卡现在是停用状态\"，这样插件被卸载后还能看到一张灰卡，随时开回来
              if (next) delete P.data.disabled[item.id]
              else P.data.disabled[item.id] = true
              persistSoon()
              setNotice({ tone: 'ok', text: next ? '已启用，插件正在加载' : '已停用，插件已卸载' })
            } else if (v.application === 'restart-required') {
              setNotice({
                tone: 'warn',
                text: `已写入配置，重启 dsh web 后生效（${RESTART_REASON[v.restartReason] || v.restartReason || '未知原因'}）`,
              })
            } else if (v.application === 'failed') {
              setNotice({ tone: 'err', text: `失败：${(v.error && v.error.code) || 'operation-error'}` })
            } else {
              setNotice({ tone: '', text: '操作已取消' })
            }
          } catch (e) {
            setNotice({ tone: 'err', text: e.message || String(e) })
          } finally {
            setBusyId(null)
            setTick((n) => n + 1)
            setVersion((n) => n + 1)
          }
        },
        [plugins]
      )

      const onDropBefore = useCallback(
        (beforeId) => {
          const id = dragId
          setDragId(null)
          setOver(null)
          if (!id) return
          moveItem(id, beforeId)
        },
        [dragId, moveItem]
      )

      // 指针落在某张卡上时：上半 → 插到它前面，下半 → 插到它后面
      const dropBeforeId = useCallback((itemId, side) => {
        if (side === 'before') return itemId
        const ids = viewRef.current.ids
        const at = ids.indexOf(itemId)
        return at >= 0 && at + 1 < ids.length ? ids[at + 1] : null
      }, [])

      const renderLine = (key) =>
        h('div', { key, style: { height: 2, margin: '2px 0', borderRadius: 2, background: C.primary, opacity: 0.9 } })

      const renderCard = (item) => {
        const key = `card:${item.id}`
        const collapsed = P.data.collapsed[item.id] === true
        const expanded = query ? true : !collapsed
        const row = rowFor(plugins.rows, item.pluginName)
        const enabled = item.placeholder ? false : !(row && row.enabled === false)
        const icon = item.icon || IconExt
        const ghost = Boolean(item.placeholder)
        return h(
          'div',
          {
            key,
            draggable: !ghost,
            onDragStart: (e) => {
              if (ghost) return
              syncOrder()
              setDragId(item.id)
              try {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', item.id)
              } catch {}
            },
            onDragEnd: () => {
              setDragId(null)
              setOver(null)
            },
            onDragOver: (e) => {
              if (!dragId || dragId === item.id) return
              e.preventDefault()
              e.stopPropagation()
              const r = e.currentTarget.getBoundingClientRect()
              const side = e.clientY - r.top < r.height / 2 ? 'before' : 'after'
              setOver({ ref: item.id, side })
            },
            onDrop: (e) => {
              e.preventDefault()
              e.stopPropagation()
              const side = over && over.ref === item.id ? over.side : 'before'
              onDropBefore(dropBeforeId(item.id, side))
            },
            style: { borderRadius: 10, opacity: ghost ? 0.62 : dragId === item.id ? 0.4 : 1 },
          },
          over && over.ref === item.id && over.side === 'before'
            ? renderLine(`${key}:line-before`)
            : null,
          h(
            'div',
            {
              style: {
                border: `1px solid ${C.line}`,
                borderRadius: 10,
                background: C.card,
                overflow: 'hidden',
                marginBottom: 8,
              },
            },
            h(
              'div',
              {
                onClick: () => {
                  if (ghost) return
                  toggleCollapse(item.id, !collapsed)
                },
                onKeyDown: (e) => {
                  if (!e.altKey) return
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    step(item.id, -1)
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    step(item.id, 1)
                  }
                },
                tabIndex: ghost ? -1 : 0,
                onFocus: () => {
                  focusId.current = item.id
                },
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '10px 12px',
                  cursor: ghost ? 'default' : 'pointer',
                  userSelect: 'none',
                  outline: 'none',
                },
              },
              h(
                'span',
                {
                  title: '拖拽排序',
                  style: {
                    color: C.text3,
                    fontSize: 13,
                    letterSpacing: -1,
                    cursor: ghost ? 'default' : 'grab',
                    opacity: ghost ? 0.3 : 0.9,
                    flex: 'none',
                  },
                },
                '⠿'
              ),
              ghost ? h('span', { style: { width: 14 } }) : h(Chevron, { open: expanded }),
              h('span', { style: { display: 'inline-flex', color: C.text2, flex: 'none' } }, h(icon, { size: 16 })),
              h(
                'div',
                { style: { minWidth: 0, flex: 1 } },
                h(
                  'div',
                  { style: { fontSize: 13.5, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                  h(Highlight, { text: pick(item.name, lang), query })
                ),
                pick(item.desc, lang)
                  ? h(
                      'div',
                      { style: { fontSize: 11.5, color: C.text3, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                      h(Highlight, { text: pick(item.desc, lang), query })
                    )
                  : null
              ),
              ghost
                ? h(
                    'span',
                    { style: { fontSize: 11, color: C.text3, border: `1px solid ${C.line2}`, borderRadius: 999, padding: '1px 8px', flex: 'none' } },
                    lang === 'en' ? 'Disabled' : '已停用'
                  )
                : item.Badge
                  ? h('span', { style: { flex: 'none' } }, h(item.Badge, null))
                  : null,
              h(Switch, {
                checked: enabled,
                busy: busyId === item.id,
                disabled: plugins.status !== 'ready' || !row || Boolean(row.readOnlyReason),
                label:
                  plugins.status === 'loading'
                    ? '正在读取插件状态…'
                    : plugins.status === 'unavailable'
                      ? plugins.reason || '插件管理不可用'
                      : !row
                        ? '找不到插件条目'
                        : row.readOnlyReason
                          ? `不可修改（${row.readOnlyReason}）`
                          : enabled
                            ? '停用这个插件'
                            : '启用这个插件',
                onChange: (next) => doToggle(item, next),
              })
            ),
            expanded
              ? h(
                  'div',
                  { style: { borderTop: `1px solid ${C.line2}`, padding: '12px 14px 14px' } },
                  ghost
                    ? h(
                        'div',
                        { style: { fontSize: 12.5, color: C.text2, lineHeight: 1.7 } },
                        lang === 'en'
                          ? 'This plugin is disabled, so its card cannot render. Turn the switch on to load it again.'
                          : '这个插件当前是停用状态，卡片内容渲染不出来。打开右上角的开关就会重新加载。'
                      )
                    : h(item.Body, null)
                )
              : null
          ),
          over && over.ref === item.id && over.side === 'after'
            ? renderLine(`${key}:line-after`)
            : null
        )
      }

      const scopeLabel = (s) => pick(s, lang)

      return h(
        'div',
        { style: { padding: '22px 26px', maxWidth: 880, color: C.text } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: 10 } },
          h('div', { style: { fontSize: 19, fontWeight: 600 } }, lang === 'en' ? 'Extensions' : '拓展'),
          h('span', { style: { flex: 1 } }),
          h(
            'span',
            { style: { fontSize: 11.5, color: C.text3 } },
            (lang === 'en' ? `${total} extension${total === 1 ? '' : 's'}` : `共 ${total} 个拓展`) +
              (query ? (lang === 'en' ? ` · ${hit} matched` : ` · 命中 ${hit}`) : '')
          ),
          plugins.status === 'unavailable'
            ? h(
                'button',
                {
                  type: 'button',
                  onClick: () => setTick((n) => n + 1),
                  title: plugins.reason,
                  style: {
                    marginLeft: 8,
                    border: `1px solid ${C.line2}`,
                    background: 'transparent',
                    color: C.text3,
                    borderRadius: 999,
                    padding: '1px 8px',
                    fontSize: 11,
                    cursor: 'pointer',
                  },
                },
                lang === 'en' ? 'Plugin control unavailable · retry' : '插件管理不可用 · 重试'
              )
            : null
        ),
        h(
          'div',
          { style: { fontSize: 12.5, color: C.text2, marginTop: 4, marginBottom: 16 } },
          lang === 'en'
            ? 'A shelf for small features. Each card is contributed by a plugin; collapse, reorder, switch, search.'
            : '各种小功能的集合处。卡片由插件注册进来，可以折叠、拖拽排序、开关和搜索。'
        ),

        // 搜索行
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 } },
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                height: 32,
                padding: '0 10px',
                minWidth: 220,
                flex: '1 1 240px',
                maxWidth: 340,
                borderRadius: 8,
                border: `1px solid ${C.line}`,
                background: C.panel,
                color: C.text3,
              },
            },
            h(IconSearch, { size: 14 }),
            h('input', {
              value: query,
              onChange: (e) => setQuery(e.target.value),
              placeholder: lang === 'en' ? 'Search extensions…' : '搜索拓展…',
              'aria-label': lang === 'en' ? 'Search extensions' : '搜索拓展',
              style: {
                flex: 1,
                minWidth: 0,
                height: '100%',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: C.text,
                fontSize: 12.5,
                fontFamily: 'inherit',
              },
            }),
            query
              ? h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => setQuery(''),
                    title: lang === 'en' ? 'Clear' : '清空',
                    style: {
                      border: 'none',
                      background: 'transparent',
                      color: C.text3,
                      cursor: 'pointer',
                      fontSize: 14,
                      lineHeight: 1,
                      padding: 0,
                    },
                  },
                  '×'
                )
              : null
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 4, alignItems: 'center' } },
            h(
              'span',
              { style: { fontSize: 11.5, color: C.text3, marginRight: 2 } },
              lang === 'en' ? 'in' : '搜'
            ),
            SCOPES.map((s) =>
              h(
                'button',
                {
                  key: s.id,
                  type: 'button',
                  onClick: () => changeScope(s.id),
                  'aria-pressed': scope === s.id,
                  style: {
                    height: 26,
                    padding: '0 10px',
                    fontSize: 12,
                    borderRadius: 999,
                    cursor: 'pointer',
                    color: scope === s.id ? C.primary : C.text2,
                    border: `1px solid ${scope === s.id ? C.primary : C.line2}`,
                    background: scope === s.id ? `${C.primary}1f` : 'transparent',
                  },
                },
                scopeLabel(s)
              )
            )
          )
        ),

        notice
          ? h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  lineHeight: 1.6,
                  borderRadius: 8,
                  padding: '7px 10px',
                  marginBottom: 12,
                  color: notice.tone === 'err' ? C.err : notice.tone === 'ok' ? C.ok : notice.tone === 'warn' ? C.warn : C.text2,
                  border: `1px solid ${notice.tone === 'err' ? C.err : notice.tone === 'ok' ? C.ok : notice.tone === 'warn' ? C.warn : C.line}44`,
                  background: notice.tone === 'err' ? `${C.err}14` : notice.tone === 'ok' ? `${C.ok}14` : notice.tone === 'warn' ? `${C.warn}14` : C.panel,
                },
              },
              h('span', { style: { flex: 1 } }, notice.text),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => setNotice(null),
                  style: { border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, lineHeight: 1, opacity: 0.75 },
                },
                '×'
              )
            )
          : null,

        // 平铺列表：不分类，直接一张接一张
        list.length === 0
          ? h(
              'div',
              {
                style: {
                  border: `1px dashed ${C.line}`,
                  borderRadius: 12,
                  padding: '34px 20px',
                  textAlign: 'center',
                  color: C.text3,
                },
              },
              h('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: 10, opacity: 0.6 } }, h(IconExt, { size: 26 })),
              h(
                'div',
                { style: { fontSize: 13, color: C.text2, marginBottom: 4 } },
                query ? (lang === 'en' ? 'Nothing matched.' : '没有匹配的拓展。') : lang === 'en' ? 'No extensions yet.' : '还没有拓展。'
              ),
              h(
                'div',
                { style: { fontSize: 11.5, lineHeight: 1.7 } },
                query
                  ? lang === 'en'
                    ? 'Try a different keyword or switch the scope.'
                    : '换个关键词，或者切换一下搜索范围。'
                  : lang === 'en'
                    ? 'Install a dsh plugin that registers a card into extensionHub and it will show up here.'
                    : '装一个把卡片注册到 extensionHub 的 dsh 插件，就会出现在这里。'
              )
            )
          : h(
              'div',
              {
                onDragOver: (e) => {
                  if (!dragId) return
                  e.preventDefault()
                },
                onDrop: (e) => {
                  // 落在卡片之间的空隙 → 挪到最后
                  e.preventDefault()
                  if (!dragId) return
                  onDropBefore(null)
                },
                style: { display: 'flex', flexDirection: 'column' },
              },
              list.map((item) => renderCard(item))
            ),

        h(
          'div',
          { style: { fontSize: 11, color: C.text3, marginTop: 14, lineHeight: 1.8 } },
          lang === 'en'
            ? 'Drag ⠿ to reorder (or focus a card and press Alt+↑/↓). The switch really enables or disables the owning plugin.'
            : '拖动 ⠿ 排序（或聚焦卡片后按 Alt+↑/↓）。右上角开关是真的启用/停用对应插件。'
        )
      )
    }

    // 匹配：名称 / 简介 / 全部，中英文一起比
    function matchItem(item, q, scope, lang) {
      const name = [pick(item.name, 'zh'), pick(item.name, 'en')].join(' ').toLowerCase()
      const desc = [pick(item.desc, 'zh'), pick(item.desc, 'en')].join(' ').toLowerCase()
      if (scope === 'name') return name.indexOf(q) >= 0
      if (scope === 'desc') return desc.indexOf(q) >= 0
      return name.indexOf(q) >= 0 || desc.indexOf(q) >= 0
    }

    function apply(ctx) {
      // 注册契约：先 provide，再把同一个对象挂到 window 上兜底
      //（万一 client 侧的 cordis 服务有隔离，消费方还能从全局拿到）
      try {
        ctx.provide('extensionHub', hub)
      } catch (e) {
        console.warn(`[${NS}] provide extensionHub 失败`, e)
      }
      window.__DSH_EXTENSION_HUB__ = hub
      ctx.effect(
        () => () => {
          if (window.__DSH_EXTENSION_HUB__ === hub) delete window.__DSH_EXTENSION_HUB__
        },
        `${NS}: window hub`
      )

      const Page = (props) => h(HubPage, Object.assign({}, props, { ctx }))

      try {
        // 先注册主面板，否则点侧栏条目时 layout.selectPanel 会找不到目标
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, Page))
      } catch (e) {
        console.warn(`[${NS}] 注册主面板失败`, e)
      }
      try {
        // 侧栏：order 11 正好排在「自动化任务」(order 10) 下面。
        // label 用 thunk，切换语言时会重新取。
        const labelOf = () => {
          try {
            const loc = ctx.get('locale')
            const id = loc ? loc.getSnapshot().active : 'zh'
            return id === 'en' ? 'Extensions' : '拓展'
          } catch {
            return '拓展'
          }
        }
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 11, locale: NS, label: labelOf }, IconExt)
        )
      } catch (e) {
        console.warn(`[${NS}] 注册侧栏项失败`, e)
      }
    }

    return { apply, inject: ['slots'] }
  },
})
