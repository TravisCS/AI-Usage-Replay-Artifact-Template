// Session replay: scrub through a Claude Code session and see the panes as they were at
// that moment. Reads window.REPLAY_DATA from data.js (so the page opens by double click),
// or data.json when data.js is missing (for example on a web server), both made by the
// session-replay skill, and draws with the user's own mod code in mods.js (sprites, ETA
// bar gags, jungle, schedule math).
(function () {
  'use strict'

  const MIN = 60000
  const M = window.Mods
  const SP = M.sprites
  const PU = M.pushers
  const JU = M.jungle
  const PL = M.plan
  const TR = M.track

  const $ = id => document.getElementById(id)
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const fmt = n => Number(n || 0).toLocaleString('en-US')
  const ms = iso => (iso ? Date.parse(iso) : NaN)
  const svgUri = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  const lowerHalf = s => String(s).replace(/\b(AM|PM)\b/g, m => m.toLowerCase())
  const plural = (n, w, ws) => `${fmt(n)} ${n === 1 ? w : ws || w + 's'}`
  // Saved per replay, so two replays opened from the same folder keep their own places.
  let storeKey = 'session-replay:'
  const store = {
    get(k) { try { return localStorage.getItem(storeKey + k) } catch (e) { return null } },
    set(k, v) { try { localStorage.setItem(storeKey + k, String(v)) } catch (e) { /* private window */ } },
  }

  let D, OFFSET, T0, T1, T, HOLIDAY
  let AGENTS = [] // every workflow agent, oldest first
  let WFS = []
  let CHAT = []
  let MILESTONES = []
  let SCHED_STATES = [] // schedule after each update_schedule call
  let PLAN_STATES = [] // task list after each update_plan call
  let ACT = { busyCum: [], outCum: [], main: [], running: [] }
  let FETCH = [], SEARCH = [], SHELL = [], LIBRARY = []
  const ui = { playing: false, speed: 10, tab: 'chat', ctab: 'pages', filter: '', limit: 150, open: new Map(), openAgent: null, last: {} }

  // ---- time labels (Pacific time, 12-hour) ----
  const local = t => new Date(t + OFFSET * MIN)
  function clock12(t) {
    const d = local(t)
    const h24 = d.getUTCHours()
    const h = h24 % 12 === 0 ? 12 : h24 % 12
    return `${h}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`
  }
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const dayLabel = t => { const d = local(t); return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}` }
  const longDate = t => { const d = local(t); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}` }
  function span(msv) {
    const m = Math.max(0, Math.round(msv / MIN))
    if (m < 1) return 'under a minute'
    if (m < 60) return `${m} min`
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
  }
  const dur = msv => lowerHalf(PL.duration(msv))

  // ---- load ----
  function showError(err, drawing) {
    const div = document.createElement('div')
    div.className = 'error'
    const why = esc(err && err.message ? err.message : err)
    // A double-clicked page cannot fetch data.json (the browser blocks it), so data.js is the
    // only way in from a folder.
    div.innerHTML = drawing
      ? `<strong>The replay could not be drawn.</strong> ${why}. Rebuild it with the session-replay skill.`
      : location.protocol === 'file:'
        ? `<strong>The replay data did not load.</strong> data.js is missing from this folder or could not be read. Rebuild the replay with the session-replay skill, or open the folder through a web server to use data.json.`
        : `<strong>The replay data did not load.</strong> ${why}. Keep data.js or data.json in the same folder as this page, then open it again.`
    document.querySelector('.titlebar').after(div)
    $('subtitle').textContent = ''
    if (err && err.stack) console.error(err)
  }
  function start(data) {
    try { init(data) } catch (err) { showError(err, true) }
  }
  // (The data is read at the very end of this file, once every constant below exists.)

  function init(data) {
    D = data
    D.workflows = D.workflows || []
    D.chat = D.chat || []
    D.milestones = D.milestones || []
    D.plan = D.plan || []
    D.commits = D.commits || []
    D.schedule = D.schedule || { calls: [], lost_state: [] }
    D.schedule.calls = D.schedule.calls || []
    D.citations = D.citations || {}
    for (const k of ['web_fetch', 'web_search', 'shell_urls', 'library']) D.citations[k] = D.citations[k] || []
    D.activity = D.activity || { start_minute: D.session.start, rows: [] }
    const R = D.replay || {}
    storeKey = 'session-replay:' + (R.slug || D.session.id || '') + ':'
    OFFSET = D.session.utc_offset_minutes || -420
    T0 = ms(D.session.start)
    T1 = ms(D.session.end)
    if (!(T1 - T0 >= MIN)) T1 = T0 + MIN // a window of a single moment still gets a timeline
    const d0 = local(T0)
    HOLIDAY = SP.holidayOf(new Date(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate(), 12).getTime())

    // Agents in the order they appeared; agent-sprites gives each the next color.
    WFS = D.workflows.map(w => ({ ...w, s: ms(w.start), e: ms(w.end) }))
    for (const w of WFS) {
      w.list = w.agents.map(a => ({ ...a, wf: w, s: ms(a.start), e: ms(a.end) }))
      AGENTS.push(...w.list)
      w.s = Math.min(w.s || Infinity, ...w.list.map(a => a.s).filter(Number.isFinite))
    }
    AGENTS.sort((a, b) => a.s - b.s)
    AGENTS.forEach((a, i) => { a.color = i; a.costume = SP.costumeOf(HOLIDAY, a.id); a.seed = SP.seedOf(a.id) })
    for (const w of WFS) w.list.sort((a, b) => a.s - b.s)

    CHAT = D.chat.map(c => ({ ...c, tm: ms(c.t) })).sort((a, b) => a.tm - b.tm)
    MILESTONES = D.milestones.map(m => ({ ...m, label: String(m.label || '').replace(/\(1 agents\)/g, '(1 agent)'), tm: ms(m.t) })).sort((a, b) => a.tm - b.tm)

    // Task list after each call. Each session keeps its own list (a new session starts
    // empty), and the page shows the list of the session that made the latest call, so two
    // sessions running at once do not wipe each other's list.
    const planBy = new Map()
    PLAN_STATES = D.plan.map(c => ({ tm: ms(c.t), ok: c.ok, input: c.input, session: c.session })).sort((a, b) => a.tm - b.tm).map(c => {
      let plan = planBy.get(c.session) || []
      if (c.ok) plan = TR.applyPlanCall(plan, c.input || {})
      planBy.set(c.session, plan)
      return { tm: c.tm, plan }
    })

    // Schedule after each call, replayed with the mod's own apply(); tracking runs just
    // before each call, as the live pane kept doing between calls. A new session starts
    // with an empty pane, and each session keeps its own pane (shown for the session that
    // made the latest call).
    const schedBy = new Map()
    const lost = new Map((D.schedule.lost_state || []).map(l => [l.t, l]))
    SCHED_STATES = D.schedule.calls.map(c => ({ ...c, tm: ms(c.t) })).sort((a, b) => a.tm - b.tm).map(c => {
      let sched = schedBy.get(c.session) || { title: '', utcOffsetMinutes: OFFSET, parts: [], updatedAt: schedBy.size ? c.tm : T0 }
      if (c.ok) {
        const tracked = TR.derive(sched, agentsAt(c.tm), planAt(c.tm), c.tm)
        if (tracked) sched = tracked
        try { sched = PL.apply(sched, c.input || {}, c.tm) } catch (e) { /* the pane refused it too */ }
      } else if (lost.has(c.t)) {
        sched = { ...sched, parts: [], updatedAt: c.tm }
      }
      schedBy.set(c.session, sched)
      return { tm: c.tm, pt: c.pt, ok: c.ok, result: c.result, lost: lost.get(c.t), sched }
    })

    // Busy minutes and output tokens, cumulative by minute.
    const a0 = ms(D.activity.start_minute)
    const total = Math.ceil((T1 - a0) / MIN) + 1
    ACT.offset0 = Math.round((a0 - T0) / MIN)
    ACT.busyCum = new Array(total + 1).fill(0)
    ACT.outCum = new Array(total + 1).fill(0)
    ACT.main = new Array(total + 1).fill(0)
    ACT.running = new Array(total + 1).fill(0)
    ACT.agentEv = new Array(total + 1).fill(0)
    const busy = new Array(total + 1).fill(0)
    const out = new Array(total + 1).fill(0)
    for (const [off, main, agentEv, running, outTok] of D.activity.rows) {
      if (off < 0 || off > total) continue
      busy[off] = 1; out[off] = outTok; ACT.main[off] = main; ACT.running[off] = running; ACT.agentEv[off] = agentEv
    }
    let b = 0, o = 0
    for (let i = 0; i <= total; i++) { b += busy[i]; o += out[i]; ACT.busyCum[i] = b; ACT.outCum[i] = o }
    ACT.a0 = a0
    ACT.total = total

    const cit = D.citations
    FETCH = cit.web_fetch.map(x => ({ ...x, kind: 'page', tm: ms(x.first) })).sort((a, b) => b.tm - a.tm)
    SHELL = cit.shell_urls.map(x => ({ ...x, kind: 'shell', tm: ms(x.first) })).sort((a, b) => b.tm - a.tm)
    SEARCH = cit.web_search.map(x => ({ ...x, tm: ms(x.first) })).sort((a, b) => b.tm - a.tm)
    LIBRARY = cit.library.slice().sort((a, b) => String(a.publisher).localeCompare(String(b.publisher)))
    // The Citations pane opens on the Library, where the sources the work relied on are, whenever
    // the replay has one; the Library button then comes first. Otherwise it opens on the pages fetched.
    if (LIBRARY.length) {
      ui.ctab = 'library'
      const lib = document.querySelector('[data-ctab="library"]')
      if (lib && lib.parentNode) lib.parentNode.prepend(lib)
    }

    if (R.title) $('pageTitle').textContent = R.title
    $('subtitle').textContent = (R.subtitle ? R.subtitle + '. ' : '') + `${D.session.start_pt} to ${D.session.end_pt}, Pacific time.` + (D.session.title ? ` Session "${D.session.title}".` : '')
    $('footRules').innerHTML = `Tokens: ${esc(D.session.token_rule)} Busy time: ${esc(D.session.busy_rule)} Data made ${esc(D.generated_pt)} by the session-replay skill; README.md next to this page says how to refresh it.`
    // Legend entries only for marks this replay has.
    const kinds = new Set(MILESTONES.map(m => m.kind))
    $('lgWfs').hidden = !kinds.has('workflow_start')
    $('lgWfe').hidden = !kinds.has('workflow_end')
    $('lgCommit').hidden = !kinds.has('commit')
    $('lgLost').hidden = !kinds.has('schedule_lost')
    $('lgMsg').hidden = !CHAT.some(c => c.role === 'user')

    INTERNAL = D.internal_links || {}
    document.addEventListener('click', e => {
      const l = e.target.closest && e.target.closest('a[data-goto]')
      if (!l) return
      e.preventDefault()
      goInside(l.dataset.goto)
    })
    buildTimeline()
    buildJump()
    buildChat()
    buildAgents()
    buildHelpers()
    buildCommits()
    buildRefine()
    wire()
    drawJungle()

    const saved = Number(store.get('t'))
    T = Number.isFinite(saved) && saved >= T0 && saved <= T1 ? saved : T1
    const sp = Number(store.get('speed'))
    if ([1, 10, 60].includes(sp)) setSpeed(sp)
    const tab = store.get('tab')
    if (tab) setTab(tab)
    measureSticky()
    render(true)
    requestAnimationFrame(scrollChat)
  }

  // ---- state at a moment ----
  function statusAt(a, t) {
    if (!(a.s <= t)) return 'waiting'
    if (a.status === 'running') return 'running'
    if (t < a.e) return 'running'
    if (a.status === 'done') return 'done'
    if (a.status === 'error') return 'failed'
    if (a.status === 'stopped') return 'stopped'
    return 'waiting'
  }
  function agentsAt(t) {
    const out = []
    for (const a of AGENTS) {
      if (!(a.s <= t)) continue
      const st = statusAt(a, t)
      const rec = { id: a.id, label: a.label, status: st === 'running' ? 'running' : st === 'done' ? 'done' : 'failed', startedAt: a.s }
      if (rec.status !== 'running') rec.endedAt = a.e
      out.push(rec)
    }
    return out
  }
  function lastIndex(list, t) {
    let lo = 0, hi = list.length - 1, ans = -1
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].tm <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1 }
    return ans
  }
  function planAt(t) {
    const i = lastIndex(PLAN_STATES, t)
    return i < 0 ? [] : PLAN_STATES[i].plan
  }
  const minuteAt = t => Math.max(0, Math.min(ACT.total, Math.floor((t - ACT.a0) / MIN)))

  // ---- timeline ----
  const pct = t => ((t - T0) / (T1 - T0)) * 100
  function buildTimeline() {
    const W = 1000, H = 54
    const maxRun = Math.max(1, ...ACT.running)
    const totalMin = (T1 - T0) / MIN
    const x = m => ((m + ACT.offset0) / totalMin) * W
    let area = `M0,${H}`
    for (let i = 0; i <= ACT.total; i++) {
      const y = H - 4 - (ACT.running[i] / maxRun) * (H - 10)
      area += ` L${x(i).toFixed(1)},${y.toFixed(1)} L${x(i + 1).toFixed(1)},${y.toFixed(1)}`
    }
    area += ` L${W},${H} Z`
    let main = ''
    for (let i = 0; i <= ACT.total; i++) if (ACT.main[i] > 0) main += `<rect x="${x(i).toFixed(1)}" y="${H - 3}" width="${Math.max(1, x(1) - x(0)).toFixed(2)}" height="3" fill="#f1efe7" opacity="0.55"/>`
    let grid = ''
    const ticks = []
    // Whole hours; a short window that would get fewer than 3 of them gets 5, 10, 15 or 30
    // minute ticks instead (at most 6).
    const firstAt = step => Math.ceil((T0 + OFFSET * MIN) / (step * MIN)) * step * MIN - OFFSET * MIN
    // A long window (a day or more) steps 2, 3, 6, 12 or 24 hours so the labels stay apart.
    let stepMin = 60
    if (Math.floor((T1 - firstAt(60)) / (60 * MIN)) + 1 < 3) stepMin = [5, 10, 15, 30, 60].find(st => totalMin / st <= 6) || 60
    else if (totalMin / 60 > 14) stepMin = [2, 3, 6, 12, 24].map(h => h * 60).find(st => totalMin / st <= 14) || 24 * 60
    for (let t = firstAt(stepMin); t <= T1; t += stepMin * MIN) {
      const gx = ((t - T0) / (T1 - T0)) * W
      grid += `<line x1="${gx.toFixed(1)}" x2="${gx.toFixed(1)}" y1="0" y2="${H}" stroke="#4a4843" stroke-width="1" vector-effect="non-scaling-stroke"/>`
      const d = local(t), h24 = d.getUTCHours(), mi = d.getUTCMinutes()
      const label = mi === 0 ? `${h24 % 12 === 0 ? 12 : h24 % 12} ${h24 < 12 ? 'am' : 'pm'}` : clock12(t)
      ticks.push(`<span style="left:${pct(t).toFixed(2)}%">${label}</span>`)
    }
    $('histSvg').innerHTML = grid + `<path d="${area}" fill="#d9775766" stroke="#d97757" stroke-width="1" vector-effect="non-scaling-stroke"/>` + main
    $('ticks').innerHTML = ticks.join('')
    $('hist').title = `Agents running each minute (peak ${maxRun}); the light line at the bottom marks minutes the main thread was busy`

    const marks = []
    for (const c of CHAT) {
      // Marks are for the mouse; keyboard users reach the same moments with the jump list
      // and the previous and next buttons, so the marks are not tab stops.
      if (c.role === 'user') { const tt = `${esc(c.pt)}: you wrote &quot;${esc(c.text.slice(0, 90))}${c.text.length > 90 ? '...' : ''}&quot;`; marks.push(`<button type="button" tabindex="-1" class="mk msg" style="left:${pct(c.tm).toFixed(2)}%" data-t="${c.tm}" title="${tt}" aria-label="${tt}"></button>`) }
      if (c.role === 'handoff') marks.push(`<button type="button" tabindex="-1" class="mk handoff" style="left:${pct(c.tm).toFixed(2)}%" data-t="${c.tm}" title="${esc(c.pt)}: opening message (handoff)" aria-label="${esc(c.pt)}: opening message (handoff)"></button>`)
    }
    for (const m of MILESTONES) {
      const cls = m.kind === 'workflow_start' ? 'wfs' : m.kind === 'workflow_end' ? 'wfe' : m.kind === 'commit' ? 'commit' : m.kind === 'schedule_lost' ? 'lost' : ''
      if (!cls) continue
      marks.push(`<button type="button" tabindex="-1" class="mk ${cls}" style="left:${pct(m.tm).toFixed(2)}%" data-t="${m.tm}" title="${esc(m.pt)}: ${esc(m.label)}" aria-label="${esc(m.pt)}: ${esc(m.label)}"></button>`)
    }
    $('lanes').innerHTML = marks.join('')
    $('scrubber').max = String(Math.round((T1 - T0) / 1000))
  }

  function buildJump() {
    const kinds = { session: 'Session', message: 'Message', workflow_start: 'Starts', workflow_end: 'Ends', commit: 'Commit', schedule_lost: 'Schedule' }
    const opts = ['<option value="">Jump to a moment...</option>']
    const items = MILESTONES.slice()
    // Every typed message too, so you can find what you asked.
    const named = new Set(MILESTONES.filter(m => m.kind === 'message').map(m => m.tm))
    for (const c of CHAT) if (c.role === 'user' && !named.has(c.tm)) items.push({ tm: c.tm, pt: c.pt, kind: 'user', label: `You: ${c.text.replace(/\s+/g, ' ').slice(0, 70)}${c.text.length > 70 ? '...' : ''}` })
    items.sort((a, b) => a.tm - b.tm)
    ui.jumpTimes = items.map(m => m.tm)
    for (const m of items) opts.push(`<option value="${m.tm}">${esc(lowerHalf(m.pt))}: ${esc(m.label || kinds[m.kind])}</option>`)
    $('jumpTo').innerHTML = opts.join('')
  }

  // Private claude.ai pages the chat links to, each mapped to the pane of this replay that carries a copy,
  // so the link works for anyone who can see the replay.
  let INTERNAL = {}
  function goInside(tab) {
    setTab(tab)
    const p = document.querySelector(`[data-pane="${tab}"]`)
    if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ---- chat ----
  function md(text) {
    const lines = esc(text).split('\n')
    let html = '', list = false, para = []
    const inline = s => s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (all, label, url) => INTERNAL[url]
        ? `<a href="#${INTERNAL[url]}" data-goto="${INTERNAL[url]}" title="Opens inside this replay">${label}</a>`
        : `<a href="${url}" target="_blank" rel="noopener">${label}</a>`)
    const flush = () => { if (para.length) { html += `<p>${inline(para.join('<br>'))}</p>`; para = [] } }
    for (const line of lines) {
      const m = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/)
      if (m) { flush(); if (!list) { html += '<ul>'; list = true } html += `<li>${inline(m[1])}</li>`; continue }
      if (list) { html += '</ul>'; list = false }
      if (line.trim() === '') { flush(); continue }
      para.push(line.replace(/^#+\s*/, ''))
    }
    flush()
    if (list) html += '</ul>'
    return html
  }
  function buildChat() {
    const body = $('chatBody')
    body.innerHTML = ''
    for (const c of CHAT) {
      const el = document.createElement('div')
      el.className = 'msg ' + c.role
      el.hidden = true
      const note = c.note ? `<div class="note">${esc(c.note)}</div>` : ''
      if (c.role === 'handoff') {
        el.innerHTML = `<div class="who">${esc(c.pt)}</div><details><summary>Opening message, carried over from the earlier session's handoff</summary><div class="text">${esc(c.text)}</div>${note}</details>`
      } else if (c.role === 'user') {
        el.innerHTML = `<div class="who">You, ${esc(c.pt)}</div><div class="bubble">${esc(c.text)}</div>`
      } else if (c.role === 'system') {
        el.innerHTML = `<div class="who">${esc(c.pt)}</div><div class="sys">${esc(c.text)}</div>`
      } else if (c.role === 'next_step') {
        const btns = (c.buttons || []).map((b, i) => `<span class="chip${i === 0 ? ' primary' : ''}">${esc(b)}</span>`).join('')
        el.innerHTML = `<div class="who">Next step, ${esc(c.pt)}</div><div class="box"><div>${esc(c.text)}</div>${c.ask ? `<div class="q">${esc(c.ask)}</div>` : ''}${btns ? `<div class="chips">${btns}</div>` : ''}</div>`
      } else {
        el.innerHTML = `<div class="who">Claude, ${esc(c.pt)}</div><div class="text">${md(c.text)}</div>${note}`
      }
      body.appendChild(el)
      c.el = el
    }
    const working = document.createElement('div')
    working.className = 'working'
    working.hidden = true
    body.appendChild(working)
    ui.workingEl = working
    const none = document.createElement('p')
    none.className = 'empty'
    none.hidden = true
    none.textContent = CHAT.length ? 'No messages yet at this moment.' : 'No chat messages in this replay window.'
    body.prepend(none)
    ui.noChatEl = none
  }
  function scrollChat() { const b = $('chatBody'); b.scrollTop = b.scrollHeight }
  function renderChat() {
    const n = lastIndex(CHAT, T) + 1
    const wk = minuteAt(T)
    const busyMain = ACT.main[wk] > 0
    const running = AGENTS.filter(a => statusAt(a, T) === 'running').length
    const key = `${n}|${busyMain}|${running}`
    if (ui.last.chat !== key) {
      const grew = ui.last.chatN === undefined || n !== ui.last.chatN
      CHAT.forEach((c, i) => { c.el.hidden = i >= n })
      ui.noChatEl.hidden = n > 0
      const typed = CHAT.slice(0, n).filter(c => c.role === 'user').length
      $('chatMeta').textContent = `${plural(n, 'message')} by ${clock12(T)}, ${typed} typed by you`
      const bits = []
      if (busyMain) bits.push('Claude is working in the main thread')
      if (running) bits.push(`${plural(running, 'agent')} running`)
      ui.workingEl.hidden = bits.length === 0 || T >= T1
      ui.workingEl.textContent = bits.join('; ') + '...'
      if (grew) scrollChat()
      ui.last.chat = key
      ui.last.chatN = n
    }
    // The task list pinned under the chat, as the app shows it.
    const plan = planAt(T)
    const pkey = JSON.stringify(plan)
    if (ui.last.plan !== pkey) {
      const box = $('taskList')
      box.hidden = plan.length === 0
      const done = plan.filter(s => s.status === 'completed').length
      box.innerHTML = `<h3>Task list, ${done} of ${plan.length} done</h3><ol>${plan.map(s => `<li class="${esc(s.status)}">${esc(s.content)}</li>`).join('')}</ol>`
      ui.last.plan = pkey
    }
  }

  // ---- agents ----
  const spriteCache = new Map()
  function agentSprite(a, st) {
    const key = a.id + '|' + st
    let uri = spriteCache.get(key)
    if (!uri) {
      const svg = st === 'running' ? SP.spriteSvg(a.color, 'running', a.costume, { seed: a.seed }) : SP.spriteSvg(a.color, st === 'stopped' ? 'failed' : st, a.costume)
      uri = svgUri(svg)
      spriteCache.set(key, uri)
    }
    return uri
  }
  const STATUS_WORD = { running: 'working', done: 'done', failed: 'failed', stopped: 'stopped, no result', waiting: 'not started yet' }
  function buildAgents() {
    const body = $('agentsBody')
    body.innerHTML = ''
    for (const w of WFS) {
      const g = document.createElement('div')
      g.className = 'group'
      g.hidden = true
      g.innerHTML = `<button type="button" class="ghead" aria-expanded="false"><span class="caret">+</span><span class="name">${esc(w.name)}</span><span class="st"></span></button>` +
        `<div class="gwrap" hidden><div class="gdesc" title="Click to show all of it">${esc(w.description || '')}${w.user_request ? `<br>Started after you wrote: "${esc(w.user_request)}"` : ''}</div><div class="gbody"></div></div>`
      const gbody = g.querySelector('.gbody')
      for (const a of w.list) {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = 'agent'
        row.setAttribute('aria-expanded', 'false')
        row.innerHTML = `<img alt="" width="30" height="30"><span class="lab">${esc(a.label)}<small></small></span><span class="el"></span>`
        const det = document.createElement('div')
        det.className = 'detail'
        det.hidden = true
        gbody.appendChild(row)
        gbody.appendChild(det)
        a.row = row; a.det = det; a.img = row.querySelector('img'); a.small = row.querySelector('small'); a.elEl = row.querySelector('.el')
        row.addEventListener('click', () => toggleAgent(a))
      }
      g.querySelector('.gdesc').addEventListener('click', e => e.currentTarget.classList.toggle('full'))
      g.querySelector('.ghead').addEventListener('click', () => {
        ui.open.set(w.id, !isOpen(w))
        ui.last.agents = null
        renderAgents()
      })
      w.g = g; w.head = g.querySelector('.ghead'); w.stEl = g.querySelector('.ghead .st'); w.wrap = g.querySelector('.gwrap'); w.caret = g.querySelector('.caret')
      body.appendChild(g)
    }
  }
  function wfRunning(w, t) { return w.status === 'running' || w.list.some(a => statusAt(a, t) === 'running') || t < w.e }
  function isOpen(w) { return ui.open.has(w.id) ? ui.open.get(w.id) : wfRunning(w, T) }
  function toggleAgent(a) {
    const open = ui.openAgent === a.id
    if (ui.openAgent) { const prev = AGENTS.find(x => x.id === ui.openAgent); if (prev) { prev.det.hidden = true; prev.row.setAttribute('aria-expanded', 'false') } }
    ui.openAgent = open ? null : a.id
    if (!open) { a.det.innerHTML = agentDetail(a); a.det.hidden = false; a.row.setAttribute('aria-expanded', 'true'); wireDetail(a) }
  }
  function agentDetail(a) {
    const tk = a.tokens || {}
    const tools = Object.entries(a.tools || {}).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<span class="chip">${esc(k)} ${fmt(v)}</span>`).join('')
    const st = statusAt(a, T)
    const ran = a.status === 'running' ? `${clock12(a.s)}, still running when the data was read` : `${clock12(a.s)} to ${clock12(a.e)} (${span(a.e - a.s)})`
    return `<p class="task"><strong>Task:</strong> ${esc(a.task || a.task_first_line || '')}</p>` +
      (a.result ? `<div><strong>Result:</strong> ${esc(a.result)}</div>` : '') +
      `<dl>` +
      `<dt>Workflow</dt><dd>${esc(a.wf.name)}${a.phase ? ', phase ' + esc(a.phase) : ''}${a.attempt > 1 ? ', attempt ' + a.attempt : ''}</dd>` +
      `<dt>Ran</dt><dd>${ran}</dd>` +
      `<dt>At ${clock12(T)}</dt><dd class="st-${st}">${STATUS_WORD[st]}</dd>` +
      `<dt>Tokens, all</dt><dd>${fmt(tk.total)}</dd>` +
      `<dt>Output</dt><dd>${fmt(tk.output)}</dd>` +
      `<dt>Input</dt><dd>${fmt(tk.input)}</dd>` +
      `<dt>Cache read</dt><dd>${fmt(tk.cache_read)}</dd>` +
      `<dt>Cache written</dt><dd>${fmt(tk.cache_creation)}</dd>` +
      `<dt>API messages</dt><dd>${fmt(a.messages)}</dd>` +
      `<dt>Tool calls</dt><dd>${fmt(a.tool_calls)}</dd>` +
      `<dt>Web</dt><dd>${plural(a.web_fetches || 0, 'page fetch', 'page fetches')}, ${plural(a.web_searches || 0, 'search', 'searches')}</dd>` +
      `<dt>Last work tool</dt><dd>${esc(a.last_work_tool || 'none')}</dd>` +
      `</dl><div class="chips">${tools}</div>` +
      `<div class="row"><button type="button" class="btn" data-go="${a.s}">Go to its start</button>${Number.isFinite(a.e) ? `<button type="button" class="btn" data-go="${a.e}">Go to its end</button>` : ''}</div>`
  }
  function wireDetail(a) {
    a.det.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); seek(Number(b.dataset.go)) }))
  }
  function renderAgents() {
    const started = WFS.filter(w => w.s <= T)
    const running = started.filter(w => wfRunning(w, T))
    const finished = started.filter(w => !wfRunning(w, T))
    running.sort((a, b) => b.s - a.s)
    finished.sort((a, b) => b.e - a.e)
    const order = running.concat(finished)
    const orderKey = order.map(w => w.id + (isOpen(w) ? '+' : '-')).join(',')
    if (ui.last.agents !== orderKey) {
      const body = $('agentsBody')
      for (const w of WFS) w.g.hidden = !(w.s <= T)
      for (const w of order) body.appendChild(w.g)
      for (const w of order) {
        const open = isOpen(w)
        w.wrap.hidden = !open
        w.caret.textContent = open ? '-' : '+'
        w.head.setAttribute('aria-expanded', String(open))
      }
      ui.last.agents = orderKey
    }
    let nRun = 0, nDone = 0, nStarted = 0
    for (const w of order) {
      let r = 0, d = 0, f = 0
      for (const a of w.list) {
        const st = statusAt(a, T)
        if (st === 'running') r++
        else if (st === 'done') d++
        else if (st === 'failed' || st === 'stopped') f++
        if (st !== 'waiting') nStarted++
        if (!w.wrap.hidden) {
          if (a.lastSt !== st) {
            a.img.src = agentSprite(a, st)
            a.img.alt = `${a.label}: ${STATUS_WORD[st]}`
            a.row.className = 'agent s-' + st
            a.small.className = 'st-' + st
            a.small.textContent = STATUS_WORD[st]
            a.lastSt = st
          }
          a.elEl.textContent = st === 'running' ? dur(T - a.s) : st === 'waiting' ? '' : dur(a.e - a.s)
        } else a.lastSt = null
      }
      nRun += r; nDone += d
      const isRun = running.includes(w)
      const n = w.list.length
      w.stEl.innerHTML = isRun
        ? `<span class="st-running">${r} working</span>, ${d} of ${n} done, ${dur(T - w.s)}`
        : `${w.status === 'stopped' ? '<span class="st-stopped">stopped</span>' : w.status === 'killed' ? '<span class="st-failed">stopped by hand</span>' : '<span class="st-done">done</span>'}, ${n} agent${n === 1 ? '' : 's'}, ${dur(w.e - w.s)}`
    }
    $('agentsMeta').textContent = started.length ? `${nRun} working, ${plural(started.length, 'workflow')} so far` : WFS.length ? 'none yet' : 'none'
    if (!started.length && !ui.emptyAgents) {
      ui.emptyAgents = document.createElement('p')
      ui.emptyAgents.className = 'empty'
      const firstWf = Math.min(...WFS.map(w => w.s).filter(Number.isFinite))
      ui.emptyAgents.textContent = Number.isFinite(firstWf)
        ? 'No workflow has started yet. The first one starts at ' + clock12(firstWf) + '.'
        : 'No workflows ran in this replay window.' + ((D.helpers && D.helpers.count) ? ' The Helpers pane lists the agents Claude started with the Agent tool.' : '')
      $('agentsBody').prepend(ui.emptyAgents)
    }
    if (ui.emptyAgents) ui.emptyAgents.hidden = started.length > 0
    if (ui.openAgent) {
      const a = AGENTS.find(x => x.id === ui.openAgent)
      const st = statusAt(a, T)
      if (a && a.detSt !== st + T) { a.det.innerHTML = agentDetail(a); wireDetail(a); a.detSt = st + T }
    }
  }

  // ---- schedule ----
  const SPRITE_STATUS = { pending: 'waiting', running: 'running', done: 'done', failed: 'failed', blocked: 'blocked' }
  const BAR_COLOR = { pending: 'var(--idle)', running: 'var(--run)', done: 'var(--ok)', failed: 'var(--bad)', blocked: 'var(--warn)' }
  function rightText(part, t, w) {
    const tz = OFFSET
    switch (part.status) {
      case 'done': return part.startedAt !== undefined && part.finishedAt !== undefined ? `done in ${dur(part.finishedAt - part.startedAt)}` : 'done'
      case 'failed': return 'failed'
      case 'blocked': return `blocked, ${PL.estimateText(part)}`
      case 'running': {
        const elapsed = t - (part.startedAt ?? t)
        if (elapsed > part.estimateMax * MIN) return `over by ${dur(elapsed - part.estimateMax * MIN)}`
        return `${dur(elapsed)} of ${PL.estimateText(part)}, ends ${lowerHalf(PL.clockRange(w.endLo, w.endHi, tz))}`
      }
      default: return `${PL.estimateText(part)}, starts about ${lowerHalf(PL.clock(w.startLo, tz))}`
    }
  }
  function scheduleAt(t) {
    const i = lastIndex(SCHED_STATES, t)
    if (i < 0) return { i, s: null }
    const base = SCHED_STATES[i].sched
    const s = TR.derive(base, agentsAt(t), planAt(t), t) || base
    return { i, s }
  }
  function renderSchedule(force) {
    const { i, s } = scheduleAt(T)
    const body = $('schedBody')
    if (!s || s.parts.length === 0) {
      const key = 'empty' + i
      if (ui.last.sched !== key || force) {
        const lostCall = i >= 0 && SCHED_STATES[i].lost
        body.innerHTML = lostCall
          ? `<p class="empty">At ${esc(lostCall.pt)} the pane had lost its state. ${lostCall.restored_pt ? `A replace call rebuilt it at ${esc(lostCall.restored_pt)}.` : 'Nothing rebuilt it in this window.'}</p>`
          : SCHED_STATES.length === 0
            ? `<p class="empty">The Schedule pane was not used in this replay window.</p>`
            : `<p class="empty">Nothing scheduled yet. Claude fills this in with update_schedule when work starts.</p>`
        $('schedMeta').textContent = ''
        ui.last.sched = key
        ui.partIds = null
      }
      return
    }
    const o = PL.overall(s, T)
    const ids = s.parts.map(p => p.id).join(',') + '|' + s.title
    if (ui.partIds !== ids) {
      body.innerHTML = `<div class="stitle"></div><div class="headline"></div><div class="walker"><img alt=""></div><div class="caption"></div><div class="caption pdone"></div><div class="parts"></div><div class="reply"></div>`
      const box = body.querySelector('.parts')
      ui.partEls = new Map()
      s.parts.forEach(p => {
        const el = document.createElement('div')
        el.className = 'part'
        el.innerHTML = `<img alt="" width="30" height="30"><div><div class="top"><span class="pname"></span><span class="right"></span></div><div class="bar"><i></i></div><div class="d"></div></div>`
        box.appendChild(el)
        ui.partEls.set(p.id, { el, img: el.querySelector('img'), name: el.querySelector('.pname'), right: el.querySelector('.right'), bar: el.querySelector('.bar i'), d: el.querySelector('.d'), st: null })
      })
      ui.partIds = ids
      ui.walkerKey = null
    }
    body.querySelector('.stitle').textContent = s.title
    const mid = (o.endLo + o.endHi) / 2
    const total = o.isDone ? 1 : Math.min(0.97, Math.max(0, (T - o.start) / Math.max(mid - o.start, MIN)))
    const head = body.querySelector('.headline')
    const inLo = dur(o.endLo - T), inHi = dur(o.endHi - T)
    head.className = 'headline' + (o.isDone ? ' done' : '')
    head.textContent = o.isDone ? `All done at ${clock12(o.endHi)}` : `ETA ${lowerHalf(PL.clockRange(o.endLo, o.endHi, OFFSET))}, in ${inLo}${inHi === inLo ? '' : ' to ' + inHi}`

    // The overall bar, with the sprite doing the gag of the half minute (by the real clock, as in the pane).
    const wrap = body.querySelector('.walker')
    const px = Math.max(160, Math.min(520, Math.floor(wrap.clientWidth || 300)))
    const seed = SP.seedOf(s.title)
    const gag = PU.pusherAt(Date.now(), seed)
    const wkey = `${px}|${Math.round(total * 300)}|${o.isDone}|${gag.name}|${s.title}`
    if (ui.walkerKey !== wkey) {
      const img = wrap.querySelector('img')
      img.src = svgUri(PU.walkerSvg(px, total, o.isDone, o.isDone ? '#3fb950' : '#d97757', SP.costumeOf(HOLIDAY, s.title), Date.now(), seed, gag))
      img.width = px
      img.height = PU.WALKER_H
      img.alt = o.isDone ? 'All done; the sprite takes a bow at the end of the bar' : `${Math.round(total * 100)}% of the way to the ETA; he's ${gag.caption}`
      body.querySelector('.caption').textContent = o.isDone ? '' : `He's ${gag.caption}.`
      ui.walkerKey = wkey
    }
    const nDone = s.parts.filter(p => p.status === 'done').length
    body.querySelector('.pdone').textContent = `${nDone} of ${s.parts.length} parts done, started ${clock12(o.start)}`

    s.parts.forEach((p, idx) => {
      const r = ui.partEls.get(p.id)
      if (!r) return
      const w = o.windows.get(p.id)
      const st = SPRITE_STATUS[p.status]
      if (r.st !== st + idx) {
        const costume = SP.costumeOf(HOLIDAY, p.id)
        r.img.src = svgUri(SP.spriteSvg(idx, st, costume, st === 'running' ? { seed: SP.seedOf(p.id) } : undefined))
        r.img.alt = `${p.name}: ${p.status}`
        r.st = st + idx
      }
      const isOver = p.status === 'running' && T - (p.startedAt ?? T) > p.estimateMax * MIN
      r.name.textContent = p.name
      r.name.className = 'pname st-' + p.status
      r.right.textContent = rightText(p, T, w)
      r.right.className = 'right' + (isOver ? ' over' : '')
      r.bar.style.width = (PL.fill(p, T) * 100).toFixed(1) + '%'
      r.bar.style.background = isOver ? 'var(--warn)' : BAR_COLOR[p.status]
      const lines = []
      if (p.detail !== undefined) lines.push(esc(p.detail))
      if (p.progress !== undefined) lines.push((p.pinned ? '' : 'auto: ') + esc(p.progress))
      r.d.innerHTML = lines.join('<br>')
    })

    const call = SCHED_STATES[i]
    const lostSoFar = (D.schedule.lost_state || []).filter(l => ms(l.t) <= T)
    const rkey = i + '|' + lostSoFar.length
    if (ui.last.reply !== rkey) {
      body.querySelector('.reply').innerHTML =
        `Last update_schedule call, ${esc(call.pt)} (call ${i + 1} of ${SCHED_STATES.length}). ${call.result ? `The pane replied: ${esc(lowerHalf(call.result))}` : 'The pane had not replied yet.'}` +
        lostSoFar.map(l => `<div class="lost">${esc(l.pt)}: the pane had lost its state; ${l.restored_pt ? `rebuilt at ${esc(l.restored_pt)}` : 'not rebuilt in this window'}.</div>`).join('')
      ui.last.reply = rkey
    }
    $('schedMeta').textContent = `${s.parts.filter(p => p.status === 'running').length} running`
  }

  // ---- helpers ----
  // Agent-tool helpers follow the timeline like workflow agents: hidden until they start.
  let HELPERS = []
  function buildHelpers() {
    const h = D.helpers || { count: 0, items: [] }
    HELPERS = (h.items || []).map(x => ({ ...x, s: ms(x.start), e: ms(x.end) })).filter(x => Number.isFinite(x.s)).sort((a, b) => a.s - b.s)
    HELPERS.forEach((x, i) => { x.color = AGENTS.length + i; x.costume = SP.costumeOf(HOLIDAY, x.id); x.seed = SP.seedOf(x.id) })
    const body = $('helpersBody')
    if (HELPERS.length === 0) {
      $('helpersMeta').textContent = 'none'
      body.innerHTML = `<p class="empty">${esc(h.note || 'No helper agents ran in this replay window.')}</p>`
      return
    }
    body.innerHTML = `<p class="empty" id="helpersNone">No helper has started yet. The first one starts at ${esc(clock12(HELPERS[0].s))}.</p>`
    for (const x of HELPERS) {
      const row = document.createElement('div')
      row.className = 'helper'
      row.hidden = true
      const tk = x.tokens || {}
      row.innerHTML = `<div class="agent"><img alt="" width="30" height="30"><span class="lab">${esc(x.label)}<small></small></span><span class="el"></span></div>` +
        `<div class="hmeta">${x.type ? esc(x.type) + ', ' : ''}${esc(clock12(x.s))} to ${esc(clock12(x.e))}, ${fmt(tk.total)} tokens (${fmt(tk.output)} output), ${plural(x.tool_calls || 0, 'tool call')}${x.task ? `<br>Task: ${esc(x.task)}` : ''}</div>`
      body.appendChild(row)
      x.row = row; x.img = row.querySelector('img'); x.small = row.querySelector('small'); x.elEl = row.querySelector('.el')
    }
  }
  function helperStatus(x, t) {
    if (!(x.s <= t)) return 'waiting'
    if (x.status === 'running' || t < x.e) return 'running'
    return 'done'
  }
  function renderHelpers() {
    if (!HELPERS.length) return
    let started = 0, running = 0
    for (const x of HELPERS) {
      const st = helperStatus(x, T)
      x.row.hidden = st === 'waiting'
      if (st === 'waiting') continue
      started++
      if (st === 'running') running++
      if (x.lastSt !== st) {
        x.img.src = svgUri(st === 'running' ? SP.spriteSvg(x.color, 'running', x.costume, { seed: x.seed }) : SP.spriteSvg(x.color, st, x.costume))
        x.small.className = 'st-' + st
        x.small.textContent = STATUS_WORD[st]
        x.lastSt = st
      }
      x.elEl.textContent = st === 'running' ? dur(T - x.s) : dur(x.e - x.s)
    }
    $('helpersNone').hidden = started > 0
    $('helpersMeta').textContent = `${running} working, ${started} of ${plural(HELPERS.length, 'helper')} started`
  }

  // ---- citations ----
  function titleFromUrl(u) {
    try {
      const url = new URL(u)
      const parts = url.pathname.split('/').filter(Boolean)
      const clean = seg => { try { seg = decodeURIComponent(decodeURIComponent(seg)) } catch (e) { /* keep as is */ } return seg.replace(/\.(html?|php|aspx?|pdf|jsp|json|xml|csv)$/i, '').replace(/[-_+]+/g, ' ').trim() }
      const named = parts.map(clean).filter(x => x.length >= 3 && !/^\d+$/.test(x) && !GENERIC.test(x))
      let last = named.length ? named[named.length - 1] : ''
      const tail = parts.length ? clean(parts[parts.length - 1]) : ''
      if (last && tail && tail !== last && GENERIC.test(tail)) last += ` (${tail})`
      if (!last) return url.hostname.replace(/^www\./, '') + ' home page'
      if (last.length > 90) last = last.slice(0, 90) + '...'
      return last.charAt(0).toUpperCase() + last.slice(1)
    } catch (e) { return u }
  }
  const GENERIC = /^(query|index|default|view|search|download|file|files|content|main|home|page|api|rest|services|en|us|docs|item|items|mapserver|featureserver)$/i
  const isPdf = u => /\.pdf($|\?)/i.test(u)
  const shortUrl = u => (u.length > 90 ? u.slice(0, 87) + '...' : u)
  function apaPage(x) {
    const site = (x.domain || '').replace(/^www\./, '')
    const title = titleFromUrl(x.url) + (isPdf(x.url) ? ' [PDF]' : '')
    return `<i>${esc(title)}</i>. (n.d.). ${esc(site)}. Retrieved ${esc(longDate(x.tm))}, from <a href="${esc(x.url)}" target="_blank" rel="noopener" title="${esc(x.url)}">${esc(shortUrl(x.url))}</a>`
  }
  function apaDate(raw) {
    const s = String(raw || '').trim()
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (m) return { text: `${m[1]}, ${MONTHS[+m[2] - 1]} ${+m[3]}`, clean: true }
    m = s.match(/^(\d{4})-(\d{2})$/)
    if (m) return { text: `${m[1]}, ${MONTHS[+m[2] - 1]}`, clean: true }
    m = s.match(/^(\d{4})$/)
    if (m) return { text: m[1], clean: true }
    m = s.match(/\b(19|20)\d{2}\b/)
    if (m) return { text: m[0], clean: false }
    return { text: 'n.d.', clean: !s }
  }
  function apaLib(x) {
    const d = apaDate(x.date)
    const pub = String(x.publisher || '').replace(/\.$/, '')
    // A journal article keeps its title plain and puts the journal in italics; anything else italicizes the title.
    const title = x.source ? esc(x.title) : `<i>${esc(x.title)}</i>`
    const desc = x.desc ? ` [${esc(x.desc)}]` : ''
    const source = x.source ? ` <i>${esc(x.source)}</i>${x.source_tail ? esc(x.source_tail) : ''}.` : x.site ? ` ${esc(x.site)}.` : ''
    const link = x.url ? ` <a href="${esc(x.url)}" target="_blank" rel="noopener" title="${esc(x.url)}">${esc(shortUrl(x.url))}</a>` : ''
    return `${esc(pub)}. (${esc(d.text)}). ${title}${desc}.${source}${link}` +
      `<div class="m">${x.used_for ? `Used for ${esc(x.used_for)}` : `Filed for ${esc(x.used_by || 'the library')}`}${d.clean ? '' : `; date as written: ${esc(x.date)}`}${x.date_note ? `; ${esc(x.date_note)}` : ''}</div>`
  }
  const agentsText = list => (list || []).slice(0, 4).join(', ') + ((list || []).length > 4 ? ` and ${list.length - 4} more` : '')
  function renderCitations(force) {
    const nF = FETCH.length - lowerCount(FETCH, T)
    const nS = SEARCH.length - lowerCount(SEARCH, T)
    const nH = SHELL.length - lowerCount(SHELL, T)
    const key = [ui.ctab, ui.filter, ui.limit, nF, nS, nH].join('|')
    if (!force && ui.last.cite === key) return
    ui.last.cite = key
    const sites = new Set(FETCH.filter(x => x.tm <= T).map(x => x.domain))
    $('citeMeta').textContent = `${plural(nF, 'page')} on ${plural(sites.size, 'site')}, ${plural(nS, 'search', 'searches')}` + (LIBRARY.length ? `, ${plural(LIBRARY.length, 'library source')}` : '')
    const counts = { pages: nF, searches: nS, shell: nH, library: LIBRARY.length }
    document.querySelectorAll('[data-ctab]').forEach(b => {
      const k = b.dataset.ctab
      const name = { pages: 'Pages', searches: 'Searches', shell: 'Shell links', library: 'Library' }[k]
      b.textContent = `${name} ${fmt(counts[k])}`
      b.setAttribute('aria-pressed', String(k === ui.ctab))
    })
    const f = ui.filter.trim().toLowerCase()
    const match = (...xs) => !f || xs.some(x => String(x || '').toLowerCase().includes(f))
    let rows = [], note = ''
    if (ui.ctab === 'pages' || ui.ctab === 'shell') {
      const src = (ui.ctab === 'pages' ? FETCH : SHELL).filter(x => x.tm <= T && match(x.url, x.domain, (x.agents || []).join(' ')))
      rows = src.map(x => `<div class="cite"><div class="apa">${apaPage(x)}</div><div class="m">First ${esc(clock12(x.tm))}${x.count > 1 ? `, ${x.count} times` : ''}, by ${esc(agentsText(x.agents))}${x.failed ? `; <span class="bad">${x.failed} of ${x.count} failed</span>` : ''}</div></div>`)
      note = ui.ctab === 'pages' ? 'Pages fetched with WebFetch, newest first. Titles come from the address; the log keeps no page titles.' : 'Addresses reached from shell commands (curl and similar), newest first.'
    } else if (ui.ctab === 'searches') {
      const src = SEARCH.filter(x => x.tm <= T && match(x.query, (x.agents || []).join(' '), (x.domains || []).join(' ')))
      rows = src.map(x => `<div class="cite"><div class="apa">"${esc(x.query)}"</div><div class="m">${esc(clock12(x.tm))}${x.count > 1 ? `, ${x.count} times` : ''}, by ${esc(agentsText(x.agents))}${x.domains ? `; only on ${esc(x.domains.join(', '))}` : ''}</div></div>`)
      note = 'Web searches, newest first.'
    } else {
      const src = LIBRARY.filter(x => match(x.publisher, x.title, x.used_by, x.url))
      rows = src.map(x => `<div class="cite"><div class="apa">${apaLib(x)}</div></div>`)
      const libName = D.citations.library_name
      note = LIBRARY.length
        ? `The project's citation library${libName ? ` (${libName})` : ''}, all of it: the file has no times, so it does not follow the timeline.`
        : 'No citation library was given for this replay.'
    }
    const total = { pages: FETCH.length, searches: SEARCH.length, shell: SHELL.length, library: LIBRARY.length }[ui.ctab]
    const emptyText = total === 0
      ? ({ pages: 'No pages were fetched in this replay window.', searches: 'No web searches in this replay window.', shell: 'No links were reached from shell commands in this replay window.', library: 'Nothing is in the library for this replay.' }[ui.ctab]) +
        (ui.ctab !== 'library' && LIBRARY.length ? ' The sources the work relied on are under Library.' : '')
      : f && rows.length === 0 ? 'Nothing matches the filter.' : 'Nothing here yet at this moment.'
    const shown = rows.slice(0, ui.limit)
    $('citeBody').innerHTML = `<p class="note">${esc(note)}</p>` + (shown.length ? shown.join('') : emptyText ? `<p class="empty">${esc(emptyText)}</p>` : '') +
      (rows.length > ui.limit ? `<button type="button" class="btn more" id="citeMore">Show ${Math.min(150, rows.length - ui.limit)} more of ${fmt(rows.length - ui.limit)}</button>` : '')
    const more = $('citeMore')
    if (more) more.addEventListener('click', () => { ui.limit += 150; renderCitations(true) })
  }
  // Lists sorted newest first: how many are later than t.
  function lowerCount(list, t) {
    let lo = 0, hi = list.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].tm > t) lo = mid + 1; else hi = mid }
    return lo
  }

  // ---- refinement questions ----
  // The questions from the skill review page and the answers saved there. They do not follow the timeline.
  function buildRefine() {
    const R2 = D.refinement
    const pane = document.querySelector('[data-pane="refine"]')
    const tabBtn = document.querySelector('[data-tab="refine"]')
    if (!R2 || !Array.isArray(R2.questions) || !R2.questions.length) { if (tabBtn) tabBtn.hidden = true; return }
    pane.hidden = false
    const qs = R2.questions
    const picked = q => (q.choices || []).find(c => c.value === q.answer)
    const nAns = qs.filter(q => picked(q) || (q.comment || '').trim()).length
    $('refineMeta').textContent = `${nAns} of ${qs.length} answered, ${R2.answered_pt || ''}`
    const toc = '<ol class="rtoc">' + qs.map(q => `<li><a href="#rq-${esc(q.id)}">${esc(q.title.replace(/^\d+\.\s*/, ''))}</a>${picked(q) ? ` <span>${esc(picked(q).label)}</span>` : ' <em class="faint">no answer</em>'}</li>`).join('') + '</ol>'
    const card = q => {
      const p = picked(q)
      const code = q.code ? `<pre>${q.code.lines.map((l, i) => `<span class="${l.hl ? 'hl' : ''}"><i>${q.code.start + i}</i>${esc(l.t)}</span>`).join('')}</pre>` : ''
      const quote = q.quote && q.quote.length ? `<blockquote>${q.quote.map(t => `<p>${esc(t)}</p>`).join('')}</blockquote>` : ''
      const choices = (q.choices || []).length ? `<ul>${q.choices.map(c => `<li class="${c.value === q.answer ? 'pick' : ''}"><b>${esc(c.label)}</b>${c.detail ? `<small>${esc(c.detail)}</small>` : ''}</li>`).join('')}</ul>` : ''
      const ans = p ? '' : (q.choices || []).length ? '<p class="ans">No choice saved for this one.</p>' : '<p class="ans">Left blank.</p>'
      const comment = (q.comment || '').trim() ? `<p class="ans">Your comment: ${esc(q.comment)}</p>` : (q.choices || []).length ? '<p class="ans">No comment written.</p>' : ''
      return `<div class="rq" id="rq-${esc(q.id)}"><div class="kind">${esc(q.kind)}</div><h3>${esc(q.title)}</h3><p>${esc(q.what)}</p>` +
        (q.src ? `<div class="src">${esc(q.src)}</div>` : '') + quote + code +
        (q.ask ? `<p class="ask">${esc(q.ask)}</p>` : '') + choices + ans + comment + '</div>'
    }
    $('refineBody').innerHTML = `<p class="note">${esc(R2.intro || '')}${R2.page_title ? ` The questions and answers are copied here from the ${esc(R2.page_title)} page, so anyone who can see this replay can read them; links to that page in the chat open this tab.` : ''}</p>` + toc + qs.map(card).join('')
  }

  // ---- commits ----
  function buildCommits() {
    const list = D.commits.map(c => ({ ...c, tm: ms(c.t) })).sort((a, b) => a.tm - b.tm)
    ui.commits = list
    if (!list.length) {
      $('strip').innerHTML = `<p class="empty">${esc(D.git && D.git.repo ? 'No commits in this replay window.' : 'No git repository was read for this replay.')}</p>`
      $('commitsMeta').textContent = ''
      return
    }
    $('strip').innerHTML = list.map(c => `<button type="button" class="commit" data-go="${c.tm}" title="${esc(c.full)}"><span class="h">${esc(c.hash)}</span> <span class="muted">${esc(c.pt)}</span><span class="s">${esc(c.subject)}</span><span class="n">${plural(c.files, 'file')}, +${fmt(c.insertions)} -${fmt(c.deletions)}</span></button>`).join('')
    $('strip').querySelectorAll('[data-go]').forEach((b, i) => { list[i].el = b; b.addEventListener('click', () => seek(Number(b.dataset.go))) })
  }
  function renderCommits() {
    if (!ui.commits.length) return
    const n = lastIndex(ui.commits, T) + 1
    if (ui.last.commits === n) return
    ui.commits.forEach((c, i) => { c.el.classList.toggle('future', i >= n); c.el.classList.toggle('latest', i === n - 1) })
    $('commitsMeta').textContent = `${n} of ${ui.commits.length} made by ${clock12(T)}; faded ones come later. Click one to go there.`
    const target = ui.commits[Math.max(0, n - 1)]
    if (target) { const strip = $('strip'); strip.scrollLeft = Math.max(0, target.el.offsetLeft - strip.clientWidth / 2) }
    ui.last.commits = n
  }

  // ---- totals ----
  function renderTotals() {
    const s = D.session
    const toolCalls = s.main_tool_calls + AGENTS.reduce((n, a) => n + (a.tool_calls || 0), 0)
    const m = minuteAt(T)
    const busyNow = ACT.busyCum[m] || 0
    const outNow = ACT.outCum[m] || 0
    const wfNow = WFS.filter(w => w.s <= T).length
    const agNow = AGENTS.filter(a => a.s <= T).length
    const runNow = AGENTS.filter(a => statusAt(a, T) === 'running').length
    const toolsNow = AGENTS.filter(a => a.status !== 'running' && a.e <= T).reduce((n, a) => n + (a.tool_calls || 0), 0)
    const key = [wfNow, agNow, runNow, busyNow, outNow, toolsNow].join('|')
    if (ui.last.totals === key) return
    ui.last.totals = key
    const tk = s.totals
    const tile = (k, v, now, n) => `<div class="tot"><div class="k">${k}</div><div class="v">${v}</div><div class="n"><span class="now">${now}</span></div><div class="n">${n}</div></div>`
    $('totals').innerHTML =
      tile('Workflows', fmt(s.workflow_count), `${wfNow} started by ${clock12(T)}`, `${s.workflow_count - WFS.filter(w => w.status === 'running').length} finished by the end`) +
      tile('Agents', fmt(s.workflow_agent_count), `${agNow} started, ${runNow} working now`, `${fmt(s.helper_count)} Agent-tool helpers`) +
      tile('Tool calls', fmt(toolCalls), `${fmt(toolsNow)} by agents finished by then`, `${fmt(s.main_tool_calls)} in the main thread`) +
      tile('Tokens, exact', fmt(tk.total), `${fmt(outNow)} output tokens so far`, `output ${fmt(tk.output)}, input ${fmt(tk.input)}, cache read ${fmt(tk.cache_read)}, cache written ${fmt(tk.cache_creation)}`) +
      tile('Busy time', span(s.busy_minutes * MIN), `${span(busyNow * MIN)} busy so far`, `${span(s.wall_minutes * MIN)} on the clock, ${fmt(s.api_messages)} API messages`)
  }

  // ---- the jungle ----
  function drawJungle() {
    const wrap = $('jungle')
    if (!wrap) return
    const hidden = store.get('jungle') === '0'
    wrap.dataset.hidden = hidden ? '1' : '0'
    $('jungleToggle').textContent = hidden ? 'Show jungle' : 'Hide jungle'
    if (hidden) return
    const w = Math.max(300, Math.round(wrap.clientWidth))
    if (ui.jungleW === w) return
    ui.jungleW = w
    const img = $('jungleImg')
    img.src = svgUri(JU.monkeyVineSvg(w, Date.now()))
    img.style.height = JU.JUNGLE_H + 'px'
  }

  // ---- render loop and controls ----
  function render(force) {
    T = Math.max(T0, Math.min(T1, T))
    $('clockTime').textContent = clock12(T)
    $('tabClock').textContent = clock12(T)
    $('clockDay').textContent = `${dayLabel(T)}, ${span(T - T0)} in`
    const p = pct(T)
    $('playhead').style.left = `calc(${p.toFixed(3)}% - 1px)`
    const sv = String(Math.round((T - T0) / 1000))
    if ($('scrubber').value !== sv) $('scrubber').value = sv
    renderTotals()
    renderChat()
    renderAgents()
    renderSchedule(force)
    renderHelpers()
    const now = performance.now()
    if (force || !ui.playing || !ui.citeAt || now - ui.citeAt > 400) { renderCitations(force); ui.citeAt = now }
    renderCommits()
    if (!ui.playing) store.set('t', Math.round(T))
  }
  function seek(t) { T = t; render(false) }
  let rafLast = 0
  function frame(ts) {
    if (!ui.playing) return
    const dt = rafLast ? Math.min(1, (ts - rafLast) / 1000) : 0
    rafLast = ts
    T += dt * ui.speed * MIN
    if (T >= T1) { T = T1; setPlaying(false) }
    render(false)
    if (ui.playing) requestAnimationFrame(frame)
  }
  function setPlaying(on) {
    ui.playing = on
    $('play').textContent = on ? 'Pause' : 'Play'
    if (on) {
      if (T >= T1) T = T0
      rafLast = 0
      requestAnimationFrame(frame)
    } else {
      store.set('t', Math.round(T))
    }
  }
  function setSpeed(sp) {
    ui.speed = sp
    document.querySelectorAll('[data-speed]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === sp)))
    store.set('speed', sp)
  }
  function setTab(tab) {
    ui.tab = tab
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)))
    document.querySelectorAll('.panes [data-pane]').forEach(p => p.classList.toggle('on', p.dataset.pane === tab))
    store.set('tab', tab)
    ui.walkerKey = null
    if (T !== undefined) render(true)
    if (tab === 'chat') scrollChat()
  }
  function measureSticky() {
    const h = $('scrub').getBoundingClientRect().height
    document.documentElement.style.setProperty('--sticky-h', Math.round(h) + 'px')
  }
  function seekFromPointer(e) {
    const r = $('hist').getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    seek(T0 + f * (T1 - T0))
  }
  function wire() {
    $('play').addEventListener('click', () => setPlaying(!ui.playing))
    document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))))
    $('scrubber').addEventListener('input', e => seek(T0 + Number(e.target.value) * 1000))
    const hist = $('hist')
    let dragging = false
    hist.addEventListener('pointerdown', e => { dragging = true; hist.setPointerCapture(e.pointerId); seekFromPointer(e) })
    hist.addEventListener('pointermove', e => { if (dragging) seekFromPointer(e) })
    hist.addEventListener('pointerup', () => { dragging = false; store.set('t', Math.round(T)) })
    $('lanes').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) seek(Number(b.dataset.t)) })
    const jump = e => { if (e.target.value) seek(Number(e.target.value)) }
    $('jumpTo').addEventListener('change', jump)
    $('jumpTo').addEventListener('input', jump)
    const step = dir => {
      const times = ui.jumpTimes
      const t = dir > 0 ? times.find(x => x > T + 500) : times.slice().reverse().find(x => x < T - 500)
      if (t !== undefined) seek(t)
    }
    $('prevMs').addEventListener('click', () => step(-1))
    $('nextMs').addEventListener('click', () => step(1))
    document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)))
    document.querySelectorAll('[data-ctab]').forEach(b => b.addEventListener('click', () => { ui.ctab = b.dataset.ctab; ui.limit = 150; renderCitations(true) }))
    $('citeFilter').addEventListener('input', e => { ui.filter = e.target.value; ui.limit = 150; renderCitations(true) })
    if ($('jungleToggle')) $('jungleToggle').addEventListener('click', () => {
      const hidden = $('jungle').dataset.hidden === '1'
      store.set('jungle', hidden ? '1' : '0')
      ui.jungleW = null
      drawJungle()
      measureSticky()
    })
    document.addEventListener('keydown', e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target
      const tag = (el.tagName || '').toLowerCase()
      // On the slider the arrows step a minute too (the slider itself counts seconds).
      if (el.id === 'scrubber' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault()
        seek(T + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1) * MIN)
        return
      }
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return
      // Space on a focused button or link presses it; it plays or pauses only from the page.
      if (e.key === ' ' && el.closest && el.closest('button, a, summary, [role="tab"], [role="button"]')) return
      if (e.key === ' ') { e.preventDefault(); setPlaying(!ui.playing) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(T + (e.shiftKey ? 10 : 1) * MIN) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(T - (e.shiftKey ? 10 : 1) * MIN) }
    })
    let rt
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { measureSticky(); drawJungle(); ui.walkerKey = null; render(true) }, 200) })
    // The ETA bar's gag changes every half minute by the clock, as in the pane.
    setInterval(() => { if (!ui.playing) renderSchedule(false) }, 5000)
  }

  // ---- read the data: data.js when the page is opened from a folder, else data.json ----
  if (window.REPLAY_DATA) start(window.REPLAY_DATA)
  else {
    fetch('data.json', { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error('data.json answered ' + r.status); return r.json() })
      .then(start)
      .catch(showError)
  }
})()
