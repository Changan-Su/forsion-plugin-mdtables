/**
 * 表格工作台 md-tables 自检:宿主同款 new Function('ctx', src)(mockCtx) + DOM 垫片 + 假 PM。
 *
 * 覆盖 SPEC §8 全部断言:
 *   A1 贡献点齐全(视图 1 / 命令 5 / 斜杠 1 / 设置 3)
 *   A2 disposer 是函数、执行不抛、工具条 DOM 摘干净、window 监听已摘
 *   A3 编辑器扩展形状:注册 1 次、priority !== 'high'、返回 2 个 Plugin、
 *      **每个 spec 都没有 handleKeyDown / handleTextInput / handleDOMEvents**、都有 view()
 *   A4 XSS:恶意格子内容走视图渲染后 DOM 里没有 img/script 节点、没有 onerror 属性
 *   A5 数据契约往返:parse→serialize→parse 深相等;escape/unescape 恒等
 *   A6 旧宿主 ctx(07-18 后的 API 全删 + 无 getLocale/subscribeLocale)下 setup 不抛、视图仍有可见内容
 *   A7 MSG.zh / MSG.en 键集合相等
 *   A8 切 en 视图不重挂也重渲;再切回 zh 与初始**逐字相同**
 *   B9 v4 路由:正文取 page.text(空 blocks/order **一次都没被读**)、块寻址 API 调用数恒 0、
 *      斜杠 run() 只 return 脚手架 / 取消给 ''、插字口调用数恒 0
 *   B10 活动页写保护:跑完全部命令 + 全部工具条动作 + 斜杠项后整库写口调用数 === 0(并有静态断言)
 *   C1-C11 SPEC §6 的全部向量(含 alignment 必须显式 null、置换引用相等、围栏挡表、拒绝面有提示)
 *
 * 跑法:node check.mjs
 */
process.env.TZ = 'Asia/Shanghai'
import { readFileSync } from 'node:fs'
import { strict as A } from 'node:assert'

const src = readFileSync(new URL('./main.js', import.meta.url), 'utf8')

let passed = 0
const ok = (name) => { passed++; console.log('PASS  ' + name) }

// ════════════════════════════════════════════════════════════════════════════
// 0. 静态纪律
// ════════════════════════════════════════════════════════════════════════════
A.ok(!/writeFile\(/.test(src), 'main.js 里不许出现整库写口(v1 零产物,B10 的静态一半)')
A.ok(!/insertMarkdown\(/.test(src), 'main.js 里不许出现「插一段 md 到活动页」的调用(比 BRIEF 更严,刻意)')
A.ok(!/insertBlockAfter|deleteBlock\(|setFmExtra\(|mountBlocks\(|\.undo\(/.test(src), '块寻址 API 一个都不许用(v4 上它们只会诚实拒绝)')
A.ok(!/innerHTML/.test(src), 'main.js 禁 innerHTML(XSS 面归零)')
A.ok(!/querySelector/.test(src), 'main.js 禁 querySelector(全部直引用)')
A.ok(!/setInterval/.test(src), '轮询用 setTimeout 自排程,禁周期定时器')
A.ok(!/new Date\(\)/.test(src), '「现在」一律 Date.now()')
A.ok(!/color:\s*#fff/i.test(src), 'CSS 不许写死白字(强调色上的字走 var(--on-accent))')
A.ok(!/priority:\s*'high'/.test(src), "编辑器扩展绝不进 'high' 桶(Tab 归宿主)")
{
  const lines = src.split('\n')
  const asi = [...lines.keys()].filter((i) => {
    if (!/^\s*[([]/.test(lines[i])) return false
    let p = i - 1
    while (p >= 0 && !lines[p].trim()) p--
    return p >= 0 && /[)\]'"`\w]\s*$/.test(lines[p])
  }).map((i) => i + 1)
  A.equal(asi.length, 0, `以 ( [ 开头的行会被 ASI 粘到上一句:第 ${asi.join(',')} 行`)
}
ok('静态纪律:零写入 / 零块寻址 / 零 innerHTML / 无 high 桶 / 无 ASI 陷阱')

// ── 冻钟(本插件不依赖时间,冻上只是纪律) ──
const NOW = Date.parse('2026-08-21T04:00:00.000Z')
Date.now = () => NOW

// ════════════════════════════════════════════════════════════════════════════
// 1. DOM 垫片
// ════════════════════════════════════════════════════════════════════════════
function mkText(v) {
  const n = { tag: '#text', children: [], attrs: {}, appendChild() {}, setAttribute() {}, addEventListener() {} }
  let s = String(v)
  Object.defineProperty(n, 'textContent', { get: () => s, set: (x) => { s = String(x) } })
  return n
}
function mkEl(tag) {
  const el = {
    tag, children: [], attrs: {}, listeners: {}, parentElement: null, isConnected: true,
    className: '', disabled: false, value: '', title: '',
    offsetWidth: 300, offsetHeight: 30, scrollTop: 0,
    style: { setProperty() {}, removeProperty() {} },
    focus() {}, blur() {}, select() {},
    setAttribute(k, v) { el.attrs[k] = String(v) },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null },
    addEventListener(type, fn) { (el.listeners[type] || (el.listeners[type] = [])).push(fn) },
    removeEventListener(type, fn) {
      const a = el.listeners[type]
      if (a) el.listeners[type] = a.filter((f) => f !== fn)
    },
    remove() {
      const p = el.parentElement
      if (p) p.children = p.children.filter((x) => x !== el)
      el.parentElement = null
    },
    closest(sel) {
      const cls = sel.replace(/^\./, '')
      for (let n = el; n; n = n.parentElement) {
        if (String(n.className || '').split(/\s+/).includes(cls)) return n
      }
      return null
    },
  }
  el.classList = {
    add: (...cs) => { const s = new Set(String(el.className).split(/\s+/).filter(Boolean)); cs.forEach((c) => s.add(c)); el.className = [...s].join(' ') },
    remove: (...cs) => { el.className = String(el.className).split(/\s+/).filter((c) => c && !cs.includes(c)).join(' ') },
    contains: (c) => String(el.className).split(/\s+/).includes(c),
  }
  let own = ''
  el.appendChild = (c) => {
    if (c && c.tag === '#frag') { for (const k of c.children.slice()) el.appendChild(k); return c }
    if (c && c.parentElement && c.parentElement !== el) c.remove()
    el.children.push(c)
    if (c && typeof c === 'object') c.parentElement = el
    return c
  }
  Object.defineProperty(el, 'textContent', {
    get: () => own + el.children.map((c) => (c && c.textContent) || '').join(''),
    set: (v) => { el.children.length = 0; own = String(v) },
  })
  return el
}
let execCopied = null
globalThis.document = {
  createElement: mkEl,
  createTextNode: mkText,
  createDocumentFragment: () => mkEl('#frag'),
  addEventListener() {},
  removeEventListener() {},
  body: mkEl('body'),
  execCommand: (cmd) => { if (cmd === 'copy') { execCopied = 'ok'; return true } return false },
}
const findAll = (node, pred) => {
  const out = []
  const walk = (n) => { for (const c of (n.children || [])) { if (pred(c)) out.push(c); walk(c) } }
  walk(node)
  return out
}
const byTag = (node, tag) => findAll(node, (c) => c.tag === tag)
const byAttr = (node, key) => findAll(node, (c) => c.attrs && key in c.attrs)
const fire = (el, type, evt) => {
  const a = (el.listeners && el.listeners[type]) || []
  for (const f of a.slice()) f(evt || { preventDefault() {}, stopPropagation() {} })
}
const clickOp = (root, op) => {
  const hits = findAll(root, (c) => c.attrs && c.attrs['data-op'] === op)
  A.ok(hits.length, `找不到操作按钮 ${op}`)
  fire(hits[0], 'mousedown', { preventDefault() {} })
  fire(hits[0], 'click')
  return hits[0]
}

// ── window 垫片(带监听账本,A2 断言 disposer 摘干净) ──
const winListeners = []
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 860,
  addEventListener: (type, fn, opts) => { winListeners.push({ type, fn, cap: !!(opts === true || (opts && opts.capture)) }) },
  removeEventListener: (type, fn, opts) => {
    const cap = !!(opts === true || (opts && opts.capture))
    const i = winListeners.findIndex((l) => l.type === type && l.fn === fn && l.cap === cap)
    if (i >= 0) winListeners.splice(i, 1)
  },
}

// ── localStorage 垫片 ──
const _ls = new Map()
globalThis.localStorage = {
  getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: (k) => _ls.delete(k),
}

// ── 剪贴板垫片 ──
let clipboard = null
let clipboardFail = false
Object.defineProperty(globalThis, 'navigator', {
  value: {
    clipboard: {
      writeText: async (s) => { if (clipboardFail) throw new Error('not a secure context'); clipboard = String(s) },
    },
  },
  configurable: true, writable: true,
})

// ════════════════════════════════════════════════════════════════════════════
// 2. 假 ProseMirror(节点 / schema / EditorView / PmToolkit)
// ════════════════════════════════════════════════════════════════════════════
function makeSchema(rec) {
  const nodes = {}
  const names = ['doc', 'paragraph', 'table', 'table_header_row', 'table_row', 'table_header', 'table_cell']
  const node = (name, attrs, content, textVal) => {
    const kids = []
    if (Array.isArray(content)) kids.push(...content)
    else if (content) kids.push(content)
    Object.defineProperty(kids, 'size', { get: () => kids.reduce((s, k) => s + k.nodeSize, 0), configurable: true })
    const n = { type: nodes[name], attrs: attrs || {}, content: kids, marks: [] }
    Object.defineProperty(n, 'childCount', { get: () => kids.length })
    n.child = (i) => kids[i]
    Object.defineProperty(n, 'nodeSize', {
      get: () => (name === 'paragraph' ? 2 + (textVal ? String(textVal).length : 0) : 2 + kids.reduce((s, k) => s + k.nodeSize, 0)),
    })
    Object.defineProperty(n, 'textContent', {
      get: () => (textVal != null ? String(textVal) : kids.map((k) => k.textContent).join('')),
    })
    n.resolve = (p) => ({ pos: p })
    n.descendants = (f) => {
      const walk = (parent, base) => {
        let p = base
        for (const k of parent.content) {
          const go = f(k, p)
          if (go !== false) walk(k, p + 1)
          p += k.nodeSize
        }
      }
      walk(n, 0)
    }
    return n
  }
  for (const name of names) {
    nodes[name] = {
      name,
      create(attrs, content, marks) {
        if (rec) rec.push({ name, attrs, content })
        return node(name, attrs, content)
      },
    }
  }
  return { schema: { nodes }, nodes, node }
}

/** 造一张表:cells = [[表头…], [行…], …];align = 每列 alignment attr。 */
function mkTable(S, cells, align) {
  const rows = []
  for (let r = 0; r < cells.length; r++) {
    const isHead = r === 0
    const cs = []
    for (let c = 0; c < cells[r].length; c++) {
      const para = S.node('paragraph', null, [], cells[r][c])
      const at = { alignment: align && align[c] !== undefined ? align[c] : null }
      cs.push(S.node(isHead ? 'table_header' : 'table_cell', at, [para]))
    }
    rows.push(S.node(isHead ? 'table_header_row' : 'table_row', null, cs))
  }
  return S.node('table', null, rows)
}

function mkPmKit(bag) {
  class Plugin { constructor(spec) { this.spec = spec; if (bag) bag.push(this) } }
  class PluginKey { constructor(name) { this.name = name } }
  return {
    Plugin, PluginKey,
    Selection: {}, NodeSelection: {},
    TextSelection: { near: (rp) => ({ kind: 'text', pos: rp && rp.pos }) },
    Decoration: {}, DecorationSet: {}, Slice: {}, Fragment: {},
    keymap: () => ({}), InputRule: class {}, inputRules: () => ({}),
  }
}

/** 把 $from 造在 table > row[r] > cell[c] > paragraph 里(depth 4)。 */
function resolveIn(doc, tablePos, tableNode, r, c) {
  const row = tableNode.child(r)
  const cell = row.child(Math.min(c, row.childCount - 1))
  const para = cell.child(0)
  const chain = [doc, tableNode, row, cell, para]
  return {
    depth: 4,
    node: (d) => chain[d],
    before: (d) => (d === 1 ? tablePos : 0),
    index: (d) => (d === 1 ? r : d === 2 ? Math.min(c, row.childCount - 1) : 0),
  }
}

/** 一个能跑 commit() 的假 EditorView(dispatch 会把新表换进 doc,于是可以连着做多步操作)。 */
function mkHarnessView(S, table, r, c, dom) {
  const view = {
    dom, dispatched: [], focused: 0, destroyedFlag: false,
    table,
    coordsAtPos: () => ({ left: 120, top: 260, right: 180, bottom: 284 }),
    hasFocus: () => true,
    focus() { view.focused++ },
  }
  const build = () => {
    const doc = S.node('doc', null, [view.table])
    const sel = { $from: resolveIn(doc, 0, view.table, view.r, view.cc) }
    view.state = {
      doc, schema: S.schema, selection: sel,
      get tr() {
        const tr = { ops: [], doc }
        tr.replaceWith = (from, to, node) => { tr.ops.push({ k: 'replace', from, to, node }); return tr }
        tr.setSelection = (s) => { tr.ops.push({ k: 'sel', s }); return tr }
        tr.scrollIntoView = () => { tr.ops.push({ k: 'scroll' }); return tr }
        return tr
      },
    }
  }
  view.r = r
  view.cc = c
  view.dispatch = (tr) => {
    view.dispatched.push(tr)
    const rep = tr.ops.find((o) => o.k === 'replace')
    if (rep) { view.table = rep.node; view.r = Math.min(view.r, view.table.childCount - 1) }
    build()
  }
  view.place = (rr, cc) => { view.r = rr; view.cc = cc; build() }
  build()
  return view
}

// ════════════════════════════════════════════════════════════════════════════
// 3. mock ctx
// ════════════════════════════════════════════════════════════════════════════
const reg = {
  views: [], commands: [], slash: [], settings: [], status: [],
  notes: [], activity: [], opened: [], editorExt: [],
}
const appCalls = { write: 0, read: 0, insertMd: 0, insertBlock: 0, delBlock: 0, fmExtra: 0, mount: 0, undo: 0, focus: [] }
let locale = 'zh'
const localeSubs = new Set()
const pageSubs = new Set()
let PAGE = null
let promptReply = '3x3'
let promptCalls = 0

const baseApp = () => ({
  notify() {},
  getActivePage: () => (PAGE ? PAGE.path : null),
  getActivePageText: () => (PAGE ? PAGE.text : ''),
  getPage: () => PAGE,
  subscribePage: (cb) => { pageSubs.add(cb); return () => pageSubs.delete(cb) },
  readFile: async () => { appCalls.read++; return null },
  writeFile: async () => { appCalls.write++ },
  insertMarkdown: () => { appCalls.insertMd++; return true },
  insertBlockAfter: () => { appCalls.insertBlock++; return null },
  deleteBlock: async () => { appCalls.delBlock++ },
  setFmExtra: () => { appCalls.fmExtra++ },
  mountBlocks: () => { appCalls.mount++; return () => {} },
  undo: () => { appCalls.undo++ },
  requestFocus: (id, place) => { appCalls.focus.push([id, place]) },
  workFolder: () => '表格工作台',
  prompt: async () => { promptCalls++; return promptReply },
  listPages: async () => [],
  listFiles: async () => [],
  searchVault: async () => [],
  vaultRoot: () => null,
})

const makeCtx = () => ({
  registerView: (v) => reg.views.push(v),
  registerCommand: (c) => reg.commands.push(c),
  registerSlashItem: (s) => reg.slash.push(s),
  registerSetting: (s) => reg.settings.push(s),
  registerStatusItem: (s) => { reg.status.push(s); return { update() {}, dispose() {} } },
  registerEditorExtension: (factory, opts) => { reg.editorExt.push({ factory, opts }) },
  registerSettingsView() {},
  registerTheme() {}, registerPanel() {}, registerFileType() {}, registerEmbedRenderer() {},
  registerFileCreator() {}, registerPropertyType() {},
  openView: (id) => reg.opened.push(id),
  notify: (m, o) => reg.notes.push({ m, o }),
  getLocale: () => locale,
  subscribeLocale: (cb) => { localeSubs.add(cb); return () => localeSubs.delete(cb) },
  loadData: async () => null,
  saveData: async () => {},
  achievements: { registerSeries() {}, track() {} },
  activity: { log: (e, d) => reg.activity.push({ e, d }) },
  app: baseApp(),
})

const setLocale = (l) => { locale = l; for (const cb of Array.from(localeSubs)) cb(l) }

globalThis.__MD_TABLES_TEST__ = {}
const ctx = makeCtx()
const dispose = new Function('ctx', src)(ctx)
const T = globalThis.__MD_TABLES_TEST__

// ════════════════════════════════════════════════════════════════════════════
// A1 贡献点齐全
// ════════════════════════════════════════════════════════════════════════════
A.equal(typeof dispose, 'function', 'setup 应返回 disposer')
A.equal(reg.views.length, 1, '只注册一个视图')
A.ok(reg.views.find((v) => v.id === 'tables' && typeof v.mount === 'function'), '应注册 tables 视图')
A.equal(reg.views[0].singleton, true, 'tables 视图是单例')
for (const id of ['md-tables-open', 'md-tables-format', 'md-tables-row-insert', 'md-tables-col-insert', 'md-tables-sort']) {
  A.ok(reg.commands.find((c) => c.id === id && typeof c.run === 'function'), `应注册命令 ${id}`)
}
A.equal(reg.commands.length, 5, '恰好五个命令,不许自创')
{
  const s = reg.slash.find((x) => x.id === 'md-tables-insert')
  A.ok(s, '应注册斜杠项 md-tables-insert')
  A.equal(s.icon, 'table', '斜杠图标用宿主词表名 table,别塞 emoji')
  A.equal(typeof s.run, 'function', '斜杠项用动态 run()(要问行列数)')
  A.equal(s.scaffold, undefined, '不许同时给静态 scaffold')
}
{
  const keys = reg.settings.map((s) => s.key).sort()
  A.deepEqual(keys, ['barEnabled', 'scaffoldCols', 'scaffoldRows'], '三个设置项')
  const bar = reg.settings.find((s) => s.key === 'barEnabled')
  A.equal(bar.type, 'boolean'); A.equal(bar.default, true)
  const rows = reg.settings.find((s) => s.key === 'scaffoldRows')
  A.equal(rows.type, 'number'); A.equal(rows.default, 3); A.equal(rows.min, 1); A.equal(rows.max, 50)
  const cols = reg.settings.find((s) => s.key === 'scaffoldCols')
  A.equal(cols.max, 20)
}
A.equal(reg.status.length, 0, '状态栏刻意不注册(表格上方已有工具条)')
for (const k of ['cellWidth', 'escapeCell', 'unescapeCell', 'parseTable', 'serializeTable', 'formatTable',
  'minSepWidth', 'alignToken', 'applyAlign', 'scaffoldTable', 'parseSize', 'planRow', 'planCol', 'planSort',
  'numOf', 'isNumericColumn', 'findTablesInText', 'isSimpleGfmTable', 'cellStart', 'newCell', 'newHeader',
  'rebuildRows', 'rebuildCols']) {
  A.equal(typeof T[k], 'function', `钩子应暴露 ${k}`)
}
A.ok(T.MSG && T.MSG.zh && T.MSG.en, '钩子应暴露 MSG')
ok('A1 贡献点齐全:1 视图 / 5 命令 / 1 斜杠 / 3 设置 + 测试钩子清单')

// ════════════════════════════════════════════════════════════════════════════
// A3 编辑器扩展形状(不抢任何键)
// ════════════════════════════════════════════════════════════════════════════
A.equal(reg.editorExt.length, 1, 'registerEditorExtension 恰好一次')
A.notEqual(reg.editorExt[0].opts && reg.editorExt[0].opts.priority, 'high', "绝不进 'high' 桶")
A.equal(reg.editorExt[0].opts.priority, 'normal', "显式 'normal' 桶")
const pmBag = []
const pmKit = mkPmKit(pmBag)
const plugins = reg.editorExt[0].factory(pmKit)
A.equal(plugins.length, 2, '返回两个 Plugin(bar + track)')
for (const p of plugins) {
  A.ok(p.spec && typeof p.spec.view === 'function', '每个 Plugin 都要有 view() 生命周期')
  const props = p.spec.props
  A.ok(!props || (!props.handleKeyDown && !props.handleTextInput && !props.handleDOMEvents),
    '不许注册任何按键 / DOM 事件 props —— 「不抢任何键」是形状不是承诺')
}
ok('A3 编辑器扩展:normal 桶 / 2 个 Plugin / 只有 view() / 零按键 props')

// ════════════════════════════════════════════════════════════════════════════
// C1 cellWidth
// ════════════════════════════════════════════════════════════════════════════
A.equal(T.cellWidth('abc'), 3)
A.equal(T.cellWidth('中文'), 4)
A.equal(T.cellWidth('日本語テスト'), 12)
A.equal(T.cellWidth('한글'), 4)
A.equal(T.cellWidth('a\\|b'), 4, '源码形态四个字符 a \\ | b')
A.equal(T.cellWidth('（全角括号）'), 12)
A.equal(T.cellWidth(''), 0)
ok('C1 cellWidth 七条向量(CJK / 假名 / 韩文 / 全角 / 转义形态)')

// ════════════════════════════════════════════════════════════════════════════
// C2 parseTable P1-P9
// ════════════════════════════════════════════════════════════════════════════
const P1SRC = '| a | b |\n| --- | --- |\n| 1 | 2 |'
A.deepEqual(T.parseTable(P1SRC), { header: ['a', 'b'], align: [null, null], rows: [['1', '2']] }, 'P1')
A.deepEqual(T.parseTable('a | b | c\n:- | :-: | -:\n1 | 2\n3 | 4 | 5 | 6'),
  { header: ['a', 'b', 'c'], align: ['left', 'center', 'right'], rows: [['1', '2', ''], ['3', '4', '5']] }, 'P2 无边竖线 + 补齐 + 截断')
{
  const p3 = T.parseTable('| x | y |\n| --- | --- |\n| a \\| b | 第一行<br>第二行 |')
  A.deepEqual(p3.rows[0], ['a | b', '第一行<br>第二行'], 'P3 生形态 + <br> 原样')
}
A.equal(T.parseTable('| a | b |\n| 1 | 2 |'), null, 'P4 缺分隔行')
A.equal(T.parseTable('| a | b | c |\n| --- | --- |\n| 1 | 2 | 3 |'), null, 'P5 表头宽 != 分隔行宽')
A.equal(T.parseTable('| a | b |\n| --- | -x- |\n| 1 | 2 |'), null, 'P6 分隔行含非法字符')
A.equal(T.parseTable('| a | b |'), null, 'P7 只有一行')
A.equal(T.parseTable(P1SRC.split('\n').map((l) => '    ' + l).join('\n')), null, 'P8 四空格缩进 = 代码块')
A.deepEqual(T.parseTable('| a \\| b |\n| --- |\n| 1 |'),
  { header: ['a | b'], align: [null], rows: [['1']] }, 'P9 合法一列表 + 转义竖线')
ok('C2 parseTable P1-P9(P4-P8 精确 null)')

// ════════════════════════════════════════════════════════════════════════════
// C3 serializeTable S1-S3
// ════════════════════════════════════════════════════════════════════════════
A.equal(T.serializeTable({ header: ['a', 'b'], align: ['left', null], rows: [['1', '2']] }),
  '| a | b |\n| :--- | --- |\n| 1 | 2 |', 'S1 minSepWidth floor:left=4 → :---,null=3 → ---')
A.equal(T.serializeTable({ header: ['a|b'], align: [null], rows: [['x']] }).split('\n')[0],
  '| a\\|b |', 'S2 生形态竖线必须转义')
A.equal(T.serializeTable(T.parseTable(P1SRC)), P1SRC, 'S3 往返')
ok('C3 serializeTable S1-S3')

// ════════════════════════════════════════════════════════════════════════════
// C4 formatTable F1-F3(构造式逐字,别手数空格)
// ════════════════════════════════════════════════════════════════════════════
{
  const LN = (cs) => '| ' + cs.join(' | ') + ' |'
  const f1in = ['| 名称 | 说明 |', '| --- | --- |', '| 中文很长的一格 | ok |', '| a | 第二列中文 |'].join('\n')
  const f1want = [
    LN(['名称' + ' '.repeat(10), '说明' + ' '.repeat(6)]),
    LN(['-'.repeat(14), '-'.repeat(10)]),
    LN(['中文很长的一格', 'ok' + ' '.repeat(8)]),
    LN(['a' + ' '.repeat(13), '第二列中文']),
  ].join('\n')
  A.equal(T.formatTable(f1in), f1want, 'F1 CJK 宽 2 的逐字对齐')

  const f2in = ['| aaaaa | bbbbb | ccccc |', '| :- | :-: | -: |', '| 1 | 2 | 3 |'].join('\n')
  const f2want = [
    LN(['aaaaa', 'bbbbb', 'ccccc']),
    LN([':----', ':---:', '----:']),
    LN(['1' + ' '.repeat(4), '2' + ' '.repeat(4), '3' + ' '.repeat(4)]),
  ].join('\n')
  A.equal(T.formatTable(f2in), f2want, 'F2 空格一律补右边(不按对齐方式决定补哪边)')

  for (const bad of ['| a | b |\n| 1 | 2 |', '| a | b |', '| a | b |\n| --- | -x- |\n| 1 | 2 |']) {
    A.equal(T.formatTable(bad), null, 'F3 判不出合法一律 null')
  }
}
ok('C4 formatTable F1(构造式逐字)/ F2 / F3')

// ════════════════════════════════════════════════════════════════════════════
// C5 planRow / planCol + 节点层置换引用相等
// ════════════════════════════════════════════════════════════════════════════
A.deepEqual(T.planRow(3, 1, 'insertBelow'), { order: [0, 1, -1, 2], cursorRow: 2 }, 'R1')
A.deepEqual(T.planRow(3, 1, 'insertAbove'), { order: [0, -1, 1, 2], cursorRow: 1 }, 'R2')
A.deepEqual(T.planRow(3, 1, 'moveUp'), { order: [1, 0, 2], cursorRow: 0 }, 'R3')
A.deepEqual(T.planRow(3, 2, 'delete'), { order: [0, 1], cursorRow: 1 }, 'R4')
A.equal(T.planRow(1, 0, 'delete'), null, 'R5 body 至少一行')
A.equal(T.planRow(3, 0, 'moveUp'), null, 'R6')
A.equal(T.planRow(3, 2, 'moveDown'), null, 'moveDown 到底')
A.equal(T.planRow(3, 5, 'delete'), null, 'at 越界')
A.deepEqual(T.planCol(3, 0, 'insertLeft'), { order: [-1, 0, 1, 2], cursorCol: 0 }, 'C1')
A.equal(T.planCol(3, 2, 'moveRight'), null, 'C2')
A.equal(T.planCol(1, 0, 'delete'), null, 'C3 至少一列')
{
  const S = makeSchema(null)
  const tb = mkTable(S, [['h1', 'h2'], ['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2']])
  const head = tb.child(0)
  const body = [tb.child(1), tb.child(2), tb.child(3)]
  const rows = T.rebuildRows(S.schema, tb, T.planRow(3, 1, 'insertBelow'))
  A.equal(rows.length, 5)
  A.ok(rows[0] === head, '表头行按引用复用')
  A.ok(rows[1] === body[0] && rows[2] === body[1] && rows[4] === body[2], '未动的行是**同一个对象引用**(内联 mark 零丢失的可测形状)')
  A.ok(rows[3] !== body[0] && rows[3].type.name === 'table_row', '新行是新建的 table_row')
  A.equal(rows[3].childCount, 2, '新行的列数跟着表走')

  const moved = T.rebuildRows(S.schema, tb, T.planRow(3, 1, 'moveUp'))
  A.ok(moved[1] === body[1] && moved[2] === body[0] && moved[3] === body[2], '上移 = 换位置,不是重建')

  const c0 = [tb.child(0).child(0), tb.child(0).child(1)]
  const cols = T.rebuildCols(S.schema, tb, T.planCol(2, 0, 'insertLeft'))
  A.equal(cols.length, 4, '列操作每行都要重建(格子清单变了)')
  A.ok(cols[0].child(1) === c0[0] && cols[0].child(2) === c0[1], '未动的格子是同一个对象引用')
  A.ok(cols[0].type.name === 'table_header_row' && cols[1].type.name === 'table_row', '行类型没搞混')
}
ok('C5 planRow/planCol 向量 + rebuild 置换真的落到节点层(=== 引用相等)')

// ════════════════════════════════════════════════════════════════════════════
// C6 planSort T1-T7
// ════════════════════════════════════════════════════════════════════════════
A.deepEqual(T.planSort(['10', '9', '100'], 'asc').order, [1, 0, 2], 'T1 数值列升序')
A.deepEqual(T.planSort(['10', '9', '100'], 'desc').order, [2, 0, 1], 'T2 数值列降序')
A.deepEqual(T.planSort(['北京', '上海', '广州'], 'asc').order, [0, 2, 1], 'T3 文本列按拼音')
A.deepEqual(T.planSort(['b', '', 'a'], 'asc').order, [2, 0, 1], 'T4 空格子沉底')
A.deepEqual(T.planSort(['1,200', '300', '80%'], 'asc').order, [2, 1, 0], 'T5 千分位 / 百分号')
A.deepEqual(T.planSort(['a', 'a', 'b'], 'asc').order, [0, 1, 2], 'T6 等值稳定')
A.deepEqual(T.planSort(['b', '', 'a'], 'desc').order, [0, 2, 1], 'T7 降序空格子仍沉底')
A.equal(T.numOf('1,200'), 1200); A.equal(T.numOf('80%'), 80); A.equal(T.numOf('abc'), null); A.equal(T.numOf(''), null)
A.equal(T.isNumericColumn(['1', '', '2']), true, '空格子不参与数值判定')
A.equal(T.isNumericColumn(['', '']), false, '整列空不算数值列')
A.equal(T.isNumericColumn(['1', 'x']), false)
ok('C6 planSort T1-T7 + numOf / isNumericColumn')

// ════════════════════════════════════════════════════════════════════════════
// C7 新格子 alignment 必须显式为 null(不是 undefined、不是 schema default 'left')
// ════════════════════════════════════════════════════════════════════════════
{
  const rec = []
  const S = makeSchema(rec)
  const tb = mkTable(S, [['h1', 'h2', 'h3'], ['a', 'b', 'c'], ['d', 'e', 'f']], ['center', 'right', null])
  rec.length = 0
  T.rebuildCols(S.schema, tb, T.planCol(3, 0, 'insertLeft'))
  const heads = rec.filter((r) => r.name === 'table_header')
  const cells = rec.filter((r) => r.name === 'table_cell')
  A.equal(heads.length, 1, '表头行只新建一个 table_header')
  A.equal(cells.length, 2, 'body 两行各新建一个 table_cell')
  for (const r of heads.concat(cells)) {
    A.ok(r.attrs && 'alignment' in r.attrs, '新格子必须显式带 alignment')
    A.equal(r.attrs.alignment, null, "新列的 alignment 必须是 null —— 吃 schema default 'left' 会让分隔符静默变成 :---")
  }
  A.equal(rec.filter((r) => r.name === 'table_header_row').length, 1, '只有一行表头行')
  A.equal(rec.filter((r) => r.name === 'table_row').length, 2, 'body 行用 table_row 工厂')

  // 新增的**行**则继承该列表头的 alignment(对齐是逐格 DOM 样式,否则新行在居中列里会歪)
  rec.length = 0
  T.rebuildRows(S.schema, tb, T.planRow(2, 0, 'insertBelow'))
  const newRowCells = rec.filter((r) => r.name === 'table_cell')
  A.equal(newRowCells.length, 3)
  A.deepEqual(newRowCells.map((r) => r.attrs.alignment), ['center', 'right', null], '新行的格子继承各列的 alignment')
  A.ok(T.newCell(S.schema, undefined).attrs.alignment === null, 'newCell 缺省 alignment = null')
  A.ok(T.newHeader(S.schema, undefined).attrs.alignment === null, 'newHeader 缺省 alignment = null')
}
ok('C7 新格子 alignment 显式 null / 新行继承列对齐 / 表头与 body 工厂没搞混')

// ════════════════════════════════════════════════════════════════════════════
// C8 alignToken / scaffoldTable / parseSize
// ════════════════════════════════════════════════════════════════════════════
A.equal(T.alignToken(null), '---'); A.equal(T.alignToken('left'), ':---')
A.equal(T.alignToken('center'), ':---:'); A.equal(T.alignToken('right'), '---:')
A.equal(T.alignToken('left', 6), ':-----'); A.equal(T.alignToken('center', 6), ':----:')
A.equal(T.alignToken(null, 14), '-'.repeat(14))
A.equal(T.minSepWidth(null), 3); A.equal(T.minSepWidth('left'), 4); A.equal(T.minSepWidth('center'), 5)
A.equal(T.scaffoldTable(2, 3), '|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |', 'canonical 脚手架')
A.ok(T.parseTable(T.scaffoldTable(2, 3)), '脚手架自己必须能被解析回来')
for (const s of ['4x3', '4X3', '4*3', '4×3', '4 3', '4,3']) {
  A.deepEqual(T.parseSize(s), { rows: 4, cols: 3 }, `parseSize ${s}`)
}
A.deepEqual(T.parseSize('999x999'), { rows: 50, cols: 20 }, '钳在 1-50 / 1-20')
A.equal(T.parseSize('abc'), null); A.equal(T.parseSize('3'), null); A.equal(T.parseSize(''), null)
{
  const al = T.applyAlign({ header: ['a', 'b'], align: [null, null], rows: [['1', '2']] }, 1, 'center')
  A.deepEqual(al.align, [null, 'center']); A.deepEqual(al.rows, [['1', '2']], 'applyAlign 其余逐字保留')
}
ok('C8 alignToken / minSepWidth / scaffoldTable / parseSize / applyAlign')

// ════════════════════════════════════════════════════════════════════════════
// C9 findTablesInText N1-N3(围栏必须挡住栏内的表)
// ════════════════════════════════════════════════════════════════════════════
{
  const F = '```'
  const n1 = ['正文', '', F + 'md', '| a | b |', '| --- | --- |', '| 1 | 2 |', F, '', '| x | y |', '| --- | --- |', '| 3 | 4 |'].join('\n')
  const r1 = T.findTablesInText(n1)
  A.equal(r1.length, 1, 'N1 围栏里的表不算')
  A.equal(r1[0].line, 8, 'N1 行号')
  A.deepEqual(r1[0].header, ['x', 'y'])
  A.equal(r1[0].rows, 1); A.equal(r1[0].cols, 2)
  A.deepEqual(T.findTablesInText('没有表格的正文'), [], 'N2')
  const n3 = ['| a | b |', '| --- | --- |', '| 1 | 2 |', '', '| c | d |', '| --- | --- |', '| 3 | 4 |', '| 5 | 6 |'].join('\n')
  const r3 = T.findTablesInText(n3)
  A.equal(r3.length, 2, 'N3 两张紧邻的表')
  A.equal(r3[0].line, 0); A.equal(r3[1].line, 4); A.equal(r3[1].rows, 2)
  const fmSrc = ['---', 'title: x', '---', '', '| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')
  A.equal(T.findTablesInText(fmSrc)[0].line, 4, 'frontmatter 跳过后行号仍是磁盘行号')
  const tilde = ['~~~', '| a | b |', '| --- | --- |', '| 1 | 2 |', '~~~'].join('\n')
  A.deepEqual(T.findTablesInText(tilde), [], '~~~ 围栏同样挡住')
}
ok('C9 findTablesInText N1-N3 + frontmatter + ~~~ 围栏')

// ════════════════════════════════════════════════════════════════════════════
// C10 isSimpleGfmTable 负向量 + cellStart 下标
// ════════════════════════════════════════════════════════════════════════════
{
  const S = makeSchema(null)
  A.equal(T.isSimpleGfmTable(mkTable(S, [['a', 'b'], ['1', '2']])), true, '正常两列表')
  const merged = mkTable(S, [['a', 'b'], ['1', '2']])
  merged.child(1).child(0).attrs.colspan = 2
  A.equal(T.isSimpleGfmTable(merged), false, '合并单元格 → 拒绝')
  const ragged = S.node('table', null, [
    S.node('table_header_row', null, [S.node('table_header', {}, [S.node('paragraph', null, [], 'a')]), S.node('table_header', {}, [S.node('paragraph', null, [], 'b')])]),
    S.node('table_row', null, [S.node('table_cell', {}, [S.node('paragraph', null, [], '1')])]),
  ])
  A.equal(T.isSimpleGfmTable(ragged), false, '行宽不齐 → 拒绝')
  const noHead = S.node('table', null, [
    S.node('table_row', null, [S.node('table_cell', {}, [S.node('paragraph', null, [], 'a')])]),
    S.node('table_row', null, [S.node('table_cell', {}, [S.node('paragraph', null, [], 'b')])]),
  ])
  A.equal(T.isSimpleGfmTable(noHead), false, '首行不是 table_header_row → 拒绝')
  A.equal(T.isSimpleGfmTable(null), false)

  // 2 行 × 2 列、每格 nodeSize 4(cell 开闭 2 + 空 paragraph 2)
  const flat = mkTable(S, [['', ''], ['', '']])
  A.equal(flat.child(0).child(0).nodeSize, 4, '空格子 nodeSize = 4')
  A.equal(flat.child(0).nodeSize, 10, '行 nodeSize = 2 + 4 + 4')
  A.equal(flat.nodeSize, 22, '表 nodeSize = 2 + 10 + 10')
  A.equal(T.cellStart(flat, 0, 0, 0), 4)
  A.equal(T.cellStart(flat, 0, 0, 1), 8)
  A.equal(T.cellStart(flat, 0, 1, 0), 14)
}
ok('C10 isSimpleGfmTable 三条负向量 + cellStart 三个下标')

// ════════════════════════════════════════════════════════════════════════════
// A5 数据契约往返
// ════════════════════════════════════════════════════════════════════════════
for (const s of [P1SRC, 'a | b | c\n:- | :-: | -:\n1 | 2\n3 | 4 | 5',
  '| x | y |\n| --- | :---: |\n| a \\| b | 第一行<br>第二行 |',
  '| 名称 | **粗体** | [[wiki]] |\n| :--- | --- | ---: |\n| 中文 |  | 3 |']) {
  const one = T.parseTable(s)
  const two = T.parseTable(T.serializeTable(one))
  A.deepEqual(two, one, '写→读→再写不丢字段:' + s.split('\n')[0])
  const three = T.parseTable(T.serializeTable(one, { pad: true }))
  A.deepEqual(three, one, '补空格版本也必须能原样读回来')
}
A.equal(T.escapeCell('a|b'), 'a\\|b')
A.equal(T.unescapeCell('a\\|b'), 'a|b')
A.equal(T.escapeCell(T.unescapeCell('第一行<br>第二行')), '第一行<br>第二行')
A.equal(T.unescapeCell(T.escapeCell('a|b\\c')), 'a|b\\c', '非竖线的反斜杠原样留着')
ok('A5 Table 契约往返(canonical / pad 两种形态)+ escape/unescape 恒等')

// ════════════════════════════════════════════════════════════════════════════
// A7 双语词表键集合相等
// ════════════════════════════════════════════════════════════════════════════
{
  const zh = Object.keys(T.MSG.zh).sort()
  const en = Object.keys(T.MSG.en).sort()
  A.deepEqual(en, zh, '两侧键集合必须完全相等(漏翻一条就红)')
  A.ok(zh.length > 40, '词表规模合理')
  for (const k of zh) {
    A.equal(typeof T.MSG.en[k], 'string', `en.${k} 必须是字符串`)
    A.ok(T.MSG.en[k].length > 0, `en.${k} 不许空串`)
  }
  // 英文侧不许残留中文(表头预览之外的一切界面文案)
  const cjk = /[一-鿿]/
  for (const k of zh) A.ok(!cjk.test(T.MSG.en[k]), `en.${k} 残留中文:${T.MSG.en[k]}`)
  A.equal(T.MSG.zh.sep, '、'); A.equal(T.MSG.en.sep, ', ')
  A.ok(T.MSG.en.tablesCount.includes('table(s)'), '复数别硬套')
  // t() 必须单趟正则:用户把内容命名成 {n} 也不许被当占位符再吃一遍
  A.equal(T.t('tablesCount', { n: '{n}' }), T.MSG.zh.tablesCount.replace('{n}', '{n}'), 't() 单趟替换')
  A.equal(T.t('size', { c: 2 }), T.MSG.zh.size.replace('{c}', '2'), '未知键原样留着')
}
ok('A7 MSG.zh / MSG.en 键集合相等 + 英文零中文 + t() 单趟正则')

// ════════════════════════════════════════════════════════════════════════════
// 视图:相位 C(只读快照)/ XSS / 双语往返
// ════════════════════════════════════════════════════════════════════════════
let pageSeq = 0
const mkPage = (text, model) => {
  pageSeq++
  return { token: 'tok-' + pageSeq, path: 'notes/正在写.md', status: 'ready', text, model: model || 'text', blocks: {}, order: [], fmExtra: '' }
}
const view = reg.views[0]
const host = mkEl('div')
host.className = 'am-app'
const mountEl = mkEl('div')
host.appendChild(mountEl)
document.body.appendChild(host)

// ── A4 XSS ──
{
  PAGE = mkPage(['| <img src=x onerror=alert(1)> | "><script> |', '| --- | --- |', '| [[a]] | **b** |'].join('\n'))
  T.setLastView(null)
  const off = view.mount(mountEl)
  A.equal(typeof off, 'function', '视图 mount 返回 disposer')
  const line = findAll(mountEl, (c) => String(c.className).includes('mdt-line'))
  A.equal(line.length, 1, '只读快照相位也要列出表格')
  fire(line[0], 'click')
  A.ok(mountEl.textContent.includes('onerror'), '恶意内容作为**文本**出现(证明真的渲染了它)')
  A.equal(byTag(mountEl, 'img').length, 0, 'DOM 里没有 img 节点')
  A.equal(byTag(mountEl, 'script').length, 0, 'DOM 里没有 script 节点')
  A.equal(byAttr(mountEl, 'onerror').length, 0, '没有 onerror 属性')
  A.equal(byAttr(mountEl, 'src').length, 0, '没有 src 属性')
  A.ok(reg.notes.some((n) => String(n.m).includes('请先点一下正文')), '相位 C 点跳转要提示,不静默')
  off()
}
ok('A4 XSS:恶意格子内容走视图后无 img/script 节点、无 onerror/src 属性')

// ── A8 zh → en → zh 逐字往返(视图不重挂) ──
{
  PAGE = mkPage(['| 姓名 | 年龄 |', '| --- | --- |', '| 甲 | 1 |'].join('\n'))
  T.setLastView(null)
  const off = view.mount(mountEl)
  const zh1 = mountEl.textContent
  A.ok(zh1.includes('表格工作台'), '中文界面')
  setLocale('en')
  const en1 = mountEl.textContent
  A.ok(en1.includes('Tables'), '切 en 后**不重挂**也重渲成英文')
  A.ok(en1.includes('Refresh') && en1.includes('table(s)'), '英文串真的出现了')
  A.ok(!en1.includes('表格工作台'), '英文界面不许残留插件自己的中文文案')
  setLocale('zh')
  A.equal(mountEl.textContent, zh1, 'zh → en → zh 整棵视图文本逐字相同')
  // 选中项在语言切换中必须保住
  const l = findAll(mountEl, (c) => String(c.className).includes('mdt-line'))
  fire(l[0], 'click')
  const selBefore = findAll(mountEl, (c) => String(c.className).includes('mdt-item') && String(c.className).includes('sel')).length
  A.equal(selBefore, 1, '点一下选中')
  setLocale('en')
  A.equal(findAll(mountEl, (c) => String(c.className).includes('mdt-item') && String(c.className).includes('sel')).length, 1, '切语言选中项不丢')
  setLocale('zh')
  off()
}
ok('A8 切 en 视图就地重渲 + zh→en→zh 逐字往返 + 选中项不丢')

// ════════════════════════════════════════════════════════════════════════════
// B9 v4 路由自检
// ════════════════════════════════════════════════════════════════════════════
{
  // 三种相位:空页 / 陈旧令牌 / v4 页
  PAGE = null
  T.setLastView(null)
  let off = view.mount(mountEl)
  A.ok(mountEl.textContent.includes('还没有打开的笔记'), '空页相位有可见文本,不是一片空白')
  A.equal(findAll(mountEl, (c) => String(c.className).includes('mdt-line')).length, 0)
  off()

  PAGE = { token: 'stale', path: null, status: 'idle', text: '', model: 'text', blocks: {}, order: [], fmExtra: '' }
  off = view.mount(mountEl)
  A.ok(mountEl.textContent.includes('还没有打开的笔记'), '无 path = 无活动页')
  off()

  // v4 页:正文只能来自 page.text,空 blocks/order 一次都不许被读
  let blocksRead = 0
  let orderRead = 0
  const v4 = mkPage(['| 甲 | 乙 |', '| --- | --- |', '| 1 | 2 |'].join('\n'))
  Object.defineProperty(v4, 'blocks', { get() { blocksRead++; return {} } })
  Object.defineProperty(v4, 'order', { get() { orderRead++; return [] } })
  PAGE = v4
  T.setLastView(null)
  off = view.mount(mountEl)
  A.ok(mountEl.textContent.includes('1 张表格'), 'v4 页正文来自 page.text')
  A.ok(mountEl.textContent.includes('甲'), '表头预览来自 page.text 里那张表')
  A.equal(blocksRead, 0, 'v4 上 blocks 恒空 —— 一次都不许去读它拿正文')
  A.equal(orderRead, 0, 'v4 上 order 恒空 —— 同上')

  // text 换成另一张表 → 清单跟着变
  const v4b = mkPage(['| 丙 | 丁 | 戊 |', '| --- | --- | --- |', '| a | b | c |', '| d | e | f |'].join('\n'))
  PAGE = v4b
  for (const cb of Array.from(pageSubs)) cb(v4b)
  A.ok(mountEl.textContent.includes('丙'), 'subscribePage 回调后清单跟着 page.text 变')
  A.ok(mountEl.textContent.includes('3 列 × 2 行'), '尺寸 = 列数 × body 行数')
  A.ok(!mountEl.textContent.includes('甲'), '旧表不该还挂着')
  off()

  A.equal(appCalls.insertBlock, 0, 'insertBlockAfter 调用数恒 0')
  A.equal(appCalls.delBlock, 0, 'deleteBlock 调用数恒 0')
  A.equal(appCalls.fmExtra, 0, 'setFmExtra 调用数恒 0')
  A.equal(appCalls.mount, 0, 'mountBlocks 调用数恒 0')
  A.equal(appCalls.undo, 0, 'undo 调用数恒 0')
  A.equal(appCalls.insertMd, 0, '插字口调用数恒 0(本插件比 BRIEF 更严:结构改动全走编辑器事务)')
}
// 斜杠 run():只 return 脚手架 / 取消给 '' / 尺寸看不懂给 '' + notify
{
  const slash = reg.slash[0]
  promptReply = '2x4'
  const md = await slash.run({ folder: 'attachments' })
  A.equal(md, T.scaffoldTable(2, 4), 'run() resolve 出的就是 scaffoldTable(2,4) 那个字符串')
  A.ok(T.parseTable(md), '脚手架自身合法')
  A.equal(appCalls.insertMd, 0, 'run() 里绝不自己插一遍(否则表格插两遍)')
  promptReply = null
  A.equal(await slash.run({}), '', '用户取消 → 空串 = 什么都不插')
  const before = reg.notes.length
  promptReply = '看不懂'
  A.equal(await slash.run({}), '', '尺寸看不懂 → 空串')
  A.ok(reg.notes.length > before && String(reg.notes[reg.notes.length - 1].m).includes('看不懂的尺寸'), '看不懂要提示,不静默')
  // 设置项决定 prompt 初值
  _ls.set('plugin.md-tables.scaffoldRows', '7')
  _ls.set('plugin.md-tables.scaffoldCols', '5')
  A.equal(T.numSetting('scaffoldRows', 3, 1, 50), 7)
  A.equal(T.numSetting('scaffoldCols', 3, 1, 20), 5)
  _ls.delete('plugin.md-tables.scaffoldRows')
  _ls.delete('plugin.md-tables.scaffoldCols')
  promptReply = '3x3'
}
// 设置读法容错:null / 'true' / 'false' / 垃圾值四种都喂一遍
{
  const K = 'plugin.md-tables.barEnabled'
  _ls.delete(K); A.equal(T.boolSetting('barEnabled', true), true, 'null = 就是默认值(宿主在值==默认时 removeItem)')
  _ls.set(K, 'false'); A.equal(T.boolSetting('barEnabled', true), false)
  _ls.set(K, 'true'); A.equal(T.boolSetting('barEnabled', true), true)
  _ls.set(K, '???'); A.equal(T.boolSetting('barEnabled', true), true, '垃圾值当真')
  _ls.delete(K)
  _ls.set('plugin.md-tables.scaffoldRows', 'x'); A.equal(T.numSetting('scaffoldRows', 3, 1, 50), 3, '数字垃圾值回退默认')
  _ls.set('plugin.md-tables.scaffoldRows', '999'); A.equal(T.numSetting('scaffoldRows', 3, 1, 50), 50, '钳上界')
  _ls.delete('plugin.md-tables.scaffoldRows')
}
ok('B9 v4 路由:正文取 page.text / 空 blocks·order 零读 / 块寻址与插字口调用数恒 0 / 斜杠只 return')

// ════════════════════════════════════════════════════════════════════════════
// 工具条 + 全部动作(真的经 barPlugin 的 view() 建 DOM、真的点按钮)
// ════════════════════════════════════════════════════════════════════════════
const S = makeSchema(null)
const editorDom = mkEl('div')
host.appendChild(editorDom)
let hv = mkHarnessView(S, mkTable(S, [['名称', '数量'], ['乙', '9'], ['甲', '10'], ['丙', '']]), 1, 0, editorDom)
T.setPmKit(pmKit)
T.setLastView(hv)

const barPluginView = plugins[0].spec.view(hv)
const trackPluginView = plugins[1].spec.view(hv)
A.ok(winListeners.some((l) => l.type === 'scroll' && l.cap), 'barPlugin 在 view 里加了 capture 的 scroll 监听')
A.ok(winListeners.some((l) => l.type === 'resize'), '同上 resize')
barPluginView.update()
const bar = T.getBar()
A.ok(bar, '光标在表里 → 工具条建出来了')
A.equal(bar.style.display, 'flex', '工具条可见')
A.ok(T.getLayer() && T.getLayer().parentElement === host, '层根传送到最近的 .am-app 下(不是裸 body)')
{
  const ops = findAll(bar, (c) => c.attrs && c.attrs['data-op']).map((c) => c.attrs['data-op'])
  A.deepEqual(ops, ['rowUp', 'rowDown', 'rowAbove', 'rowBelow', 'rowDel',
    'colLeft', 'colRight', 'colBefore', 'colAfter', 'colDel',
    'sortAsc', 'sortDesc', 'alignL', 'alignC', 'alignR', 'alignNone', 'copySrc'], '五组 17 个按钮,顺序钉死')
  for (const b of findAll(bar, (c) => c.attrs && c.attrs['data-op'])) {
    A.ok(b.title && b.title.length, `按钮 ${b.attrs['data-op']} 要有 title`)
    A.equal(b.getAttribute('aria-label'), b.title, '同款 aria-label')
  }
}
ok('工具条:传送到 .am-app / 五组 17 键顺序钉死 / 每键 title + aria-label')

// ── 全部行列动作真的改了 doc(而且一次操作 = 一个事务) ──
{
  const n0 = hv.table.childCount
  hv.place(2, 0)                                    // 光标在 body 第 2 行(「甲」)
  clickOp(bar, 'rowBelow')
  A.equal(hv.table.childCount, n0 + 1, '下方插入一行')
  A.equal(hv.dispatched.length, 1, '一次操作 = 恰好一个 transaction')
  A.equal(hv.dispatched[0].ops.filter((o) => o.k === 'replace').length, 1)
  clickOp(bar, 'rowUp')
  A.equal(hv.table.childCount, n0 + 1, '上移不改行数')
  clickOp(bar, 'rowDel')
  A.equal(hv.table.childCount, n0, '删除一行')
  const c0 = hv.table.child(0).childCount
  clickOp(bar, 'colAfter')
  A.equal(hv.table.child(0).childCount, c0 + 1, '右侧插入一列')
  A.equal(hv.table.child(1).childCount, c0 + 1, 'body 行也跟着加')
  clickOp(bar, 'colRight')
  clickOp(bar, 'colDel')
  A.equal(hv.table.child(0).childCount, c0, '删除一列')
  clickOp(bar, 'alignC')
  A.equal(hv.table.child(0).child(hv.cc).attrs.alignment, 'center', '对齐写到表头格')
  A.equal(hv.table.child(1).child(hv.cc).attrs.alignment, 'center', '整列全设(DOM 显示按每格 style)')
  clickOp(bar, 'alignNone')
  A.equal(hv.table.child(0).child(hv.cc).attrs.alignment, null, '取消对齐 = null(才序列化成 ---)')
}
// ── 排序真的按判据来 ──
{
  hv = mkHarnessView(S, mkTable(S, [['名称', '数量'], ['乙', '9'], ['甲', '10'], ['丙', '']]), 1, 1, editorDom)
  T.setLastView(hv)
  barPluginView.update()
  T.setLastView(hv)
  const colOf = (n) => { const a = []; for (let r = 1; r < n.childCount; r++) a.push(n.child(r).child(1).textContent); return a }
  T.runAction('sortAsc')
  A.deepEqual(colOf(hv.table), ['9', '10', ''], '数值列升序 + 空格子沉底')
  T.runAction('sortDesc')
  A.deepEqual(colOf(hv.table), ['10', '9', ''], '降序空格子仍沉底')
  A.equal(_ls.get('plugin.md-tables.lastSortDir'), 'desc', '排序方向记进 localStorage')
}
// ── 复制源码 ──
{
  clipboard = null
  T.runAction('copySrc')
  await new Promise((r) => setTimeout(r, 0))
  A.ok(clipboard && clipboard.includes('| 名称'), '对齐源码进了剪贴板')
  A.equal(clipboard, T.serializeTable(T.tableToTable(hv.table), { pad: true }))
  A.ok(reg.notes.some((n) => String(n.m).includes('已复制')), '复制成功要通知')
  // navigator.clipboard 缺席 / 抛错 → execCommand 兜底,兜底也失败绝不报成功
  clipboardFail = true
  execCopied = null
  clipboard = null
  const okCopy = await T.copyText('abc')
  A.equal(okCopy, true, 'clipboard 抛错时落到 execCommand')
  A.equal(execCopied, 'ok')
  clipboardFail = false
}
ok('工具条动作:行列增删移动 / 整列对齐 / 排序判据 / 剪贴板双通道')

// ════════════════════════════════════════════════════════════════════════════
// C11 拒绝面有提示不静默
// ════════════════════════════════════════════════════════════════════════════
{
  const one = mkHarnessView(S, mkTable(S, [['h'], ['only']]), 1, 0, editorDom)
  T.setLastView(one)
  let before = reg.notes.length
  A.equal(T.runAction('rowDel'), false, 'body 只剩一行 → 拒绝')
  A.ok(reg.notes.length > before, '拒绝必须有提示,不静默失败')
  A.ok(String(reg.notes[reg.notes.length - 1].m).includes(T.MSG.zh.lastRow), '文案就是 t(lastRow)')
  A.equal(one.dispatched.length, 0, '拒绝时一个事务都不派')

  before = reg.notes.length
  A.equal(T.runAction('colDel'), false, '只剩一列 → 拒绝')
  A.ok(String(reg.notes[reg.notes.length - 1].m).includes(T.MSG.zh.lastCol))

  const three = mkHarnessView(S, mkTable(S, [['h', 'i'], ['a', 'b'], ['c', 'd'], ['e', 'f']]), 1, 0, editorDom)
  T.setLastView(three)
  A.equal(T.runAction('rowUp'), false, '已在最上面一行')
  A.ok(String(reg.notes[reg.notes.length - 1].m).includes(T.MSG.zh.firstRow))
  three.place(3, 0)
  A.equal(T.runAction('rowDown'), false, '已在最下面一行')
  A.ok(String(reg.notes[reg.notes.length - 1].m).includes(T.MSG.zh.endRow))
  three.place(1, 0)
  A.equal(T.runAction('colLeft'), false, '已在最左边一列')
  A.ok(String(reg.notes[reg.notes.length - 1].m).includes(T.MSG.zh.firstCol))
  three.place(1, 1)
  A.equal(T.runAction('colRight'), false, '已在最右边一列')
  A.ok(String(reg.notes[reg.notes.length - 1].m).includes(T.MSG.zh.endCol))
  // 表头行不能删 / 不能移动
  three.place(0, 0)
  A.equal(T.runAction('rowDel'), false)
  A.ok(String(reg.notes[reg.notes.length - 1].m).includes(T.MSG.zh.headerRow), '表头行有专门文案')
  // 光标在表头行 + 「下方插入」= 在表头正下方插一行
  const n1 = three.table.childCount
  A.equal(T.runAction('rowBelow'), true)
  A.equal(three.table.childCount, n1 + 1)
  A.equal(three.table.child(1).child(0).textContent, '', '新行插在表头正下方')

  // 合并单元格 → 整表让开
  const merged = mkTable(S, [['a', 'b'], ['1', '2']])
  merged.child(1).child(0).attrs.colspan = 2
  const mv = mkHarnessView(S, merged, 1, 0, editorDom)
  T.setLastView(mv)
  A.equal(T.runAction('rowBelow'), false)
  A.ok(String(reg.notes[reg.notes.length - 1].m).includes('合并单元格'), '拒绝面有提示')
  A.equal(mv.dispatched.length, 0)
  // 无 view / 不在表里
  T.setLastView(null)
  A.equal(T.runAction('rowBelow'), false)
  A.ok(String(reg.notes[reg.notes.length - 1].m).includes('请先点一下正文'))
  const outside = mkHarnessView(S, mkTable(S, [['a'], ['1']]), 1, 0, editorDom)
  outside.state.selection = { $from: { depth: 1, node: () => ({ type: { name: 'paragraph' } }), before: () => 0, index: () => 0 } }
  T.setLastView(outside)
  A.equal(T.runAction('rowBelow'), false)
  A.ok(String(reg.notes[reg.notes.length - 1].m).includes('把光标放进一张表格'))
}
ok('C11 拒绝面全有提示:最后一行/列、边界、表头行、合并单元格、无 view、不在表里')

// ════════════════════════════════════════════════════════════════════════════
// 五个命令 + 相位 A(活 doc)
// ════════════════════════════════════════════════════════════════════════════
{
  const av = mkHarnessView(S, mkTable(S, [['甲', '乙'], ['1', '2'], ['3', '4']]), 1, 0, editorDom)
  T.setLastView(av)
  PAGE = mkPage('（正文由活 doc 权威提供）')
  const off = view.mount(mountEl)
  A.ok(mountEl.textContent.includes('1 张表格'), '相位 A:清单来自活 doc')
  const line = findAll(mountEl, (c) => String(c.className).includes('mdt-line'))[0]
  fire(line, 'click')
  const enabled = findAll(mountEl, (c) => c.attrs && c.attrs['data-op'] && !c.disabled).map((c) => c.attrs['data-op'])
  // [回归 2026-08-21 · 评审 Finding 2] 展开区的行/列/排序/对齐按钮**一律 disabled**。
  //   它们先 jumpTo(it),而 jumpTo 写死 cellStart(node, pos, 0, 0) —— 恒把光标钉到表头行第一格:
  //   行组三个键永远弹「表头行不能删除」、`←` 永远弹「已经在最左边」,
  //   而「删除这一列」一声不吭删掉整张表的**第 1 列**(不是用户那一列)。
  //   这条断言上一版钉的是「17 个全开」= 把 4 个死键 + 1 个删错目标的键当成了期望值。
  A.deepEqual(enabled, ['copySrc'], '相位 A:展开区只留「复制源码」,行列操作走表格上方的工具条')
  const n0 = av.table.childCount
  clickOp(mountEl, 'rowBelow')
  A.equal(av.table.childCount, n0, '展开区的行列键点不动 doc(它们已经 disabled;误点也不许改错目标)')
  // 「复制源码」仍然可用,而且点一下会把光标跳过去(清单视图的两件事)
  clickOp(mountEl, 'copySrc')
  off()

  // 相位 B(v3 分块):只给跳转与复制源码
  T.setLastView(null)
  PAGE = {
    token: 'v3', path: 'notes/old.md', status: 'ready', model: 'blocks', fmExtra: '',
    text: '', order: ['b1', 'b2'],
    blocks: { b1: '一段正文', b2: '| p | q |\n| --- | --- |\n| 1 | 2 |' },
  }
  const off2 = view.mount(mountEl)
  A.ok(mountEl.textContent.includes('1 张表格'), 'v3:逐块扫描出一张表')
  A.ok(mountEl.textContent.includes('旧式分块笔记'), 'v3 要说清能力边界')
  const l2 = findAll(mountEl, (c) => String(c.className).includes('mdt-line'))[0]
  fire(l2, 'click')
  A.deepEqual(appCalls.focus[appCalls.focus.length - 1], ['b2', 'start'], 'v3 跳转走 requestFocus(只读焦点,不要令牌)')
  const off3 = findAll(mountEl, (c) => c.attrs && c.attrs['data-op'] && c.disabled).map((c) => c.attrs['data-op'])
  A.ok(off3.includes('rowBelow') && off3.includes('sortAsc'), 'v3 下行列/排序按钮 disabled')
  A.ok(!off3.includes('copySrc'), 'v3 下仍可复制源码')
  off2()
}
{
  // 五个命令逐个跑一遍
  const cv = mkHarnessView(S, mkTable(S, [['甲', '乙'], ['1', '2'], ['3', '4']]), 1, 0, editorDom)
  T.setLastView(cv)
  PAGE = mkPage('x')
  const byId = (id) => reg.commands.find((c) => c.id === id)
  reg.opened.length = 0
  byId('md-tables-open').run()
  A.deepEqual(reg.opened, ['tables'], 'open 命令打开视图')
  const rows0 = cv.table.childCount
  byId('md-tables-row-insert').run()
  A.equal(cv.table.childCount, rows0 + 1, 'row-insert 命令真的插了一行')
  const cols0 = cv.table.child(0).childCount
  byId('md-tables-col-insert').run()
  A.equal(cv.table.child(0).childCount, cols0 + 1, 'col-insert 命令真的插了一列')
  byId('md-tables-sort').run()
  A.equal(_ls.get('plugin.md-tables.lastSortDir'), 'asc', '命令面板的排序恒升序(不做隐式 toggle)')
  clipboard = null
  reg.opened.length = 0
  byId('md-tables-format').run()
  await new Promise((r) => setTimeout(r, 0))
  A.ok(clipboard && clipboard.includes('|'), 'format 命令把对齐源码复制走')
  A.deepEqual(reg.opened, ['tables'], 'format 顺带打开视图')
  A.equal(cv.dispatched.filter((tr) => tr.ops.some((o) => o.k === 'replace')).length, 3, 'format 不改文档(只有前三条命令改)')
}
ok('五个命令逐个跑通 + 相位 A 全开 / 相位 B 只给跳转与复制')

// ════════════════════════════════════════════════════════════════════════════
// B10 活动页写保护:整库写口调用数恒 0
// ════════════════════════════════════════════════════════════════════════════
A.equal(appCalls.write, 0, '跑完全部命令 + 全部工具条动作 + 斜杠项后,整库写口调用数 === 0')
A.equal(appCalls.insertMd, 0, '插字口调用数也恒 0')
A.equal(appCalls.read, 0, 'v1 连读都不读别的文件')
A.equal(ctx.app.getActivePage(), PAGE ? PAGE.path : null, '活动页就是我们一直在操作的那一篇')
ok('B10 活动页写保护:writeFile / 插字口 / readFile 调用数全 0(静态断言在文件开头)')

// ════════════════════════════════════════════════════════════════════════════
// A2 disposer
// ════════════════════════════════════════════════════════════════════════════
{
  barPluginView.update()
  A.ok(T.getBar() && T.getBar().parentElement, 'dispose 之前工具条挂在层根上')
  const winBefore = winListeners.length
  A.ok(winBefore >= 2, 'dispose 之前 window 监听还在')
  dispose()
  A.equal(T.getBar(), null, 'disposer 之后工具条单例已清空')
  A.equal(T.getLayer(), null, '层根已清空')
  A.equal(findAll(host, (c) => String(c.className).includes('mdt-layer')).length, 0, '层根从 host 上摘干净')
  A.equal(winListeners.length, 0, 'scroll / resize 监听已摘干净')
  A.equal(T.getLastView(), null, 'lastView 已销号')
  A.doesNotThrow(() => dispose(), 'disposer 重复执行不抛')
  // 编辑器实例自己的 destroy 也不许抛(宿主会在下一拍收编辑器)
  A.doesNotThrow(() => { barPluginView.destroy(); trackPluginView.destroy() }, 'plugin view destroy 不抛')
}
ok('A2 disposer:工具条 DOM 摘干净 / window 监听归零 / lastView 销号 / 重复执行不抛')

// ════════════════════════════════════════════════════════════════════════════
// A6 旧宿主 ctx
// ════════════════════════════════════════════════════════════════════════════
{
  const old = makeCtx()
  delete old.notify
  delete old.activity
  delete old.getLocale
  delete old.subscribeLocale
  delete old.registerStatusItem
  delete old.registerSettingsView
  delete old.registerEditorExtension
  delete old.loadData
  delete old.saveData
  delete old.app.workFolder
  delete old.app.insertMarkdown
  delete old.app.listPages
  delete old.app.listFiles
  delete old.app.searchVault
  delete old.app.vaultRoot
  delete old.app.prompt
  reg.views.length = 0
  reg.commands.length = 0
  reg.slash.length = 0
  reg.settings.length = 0
  reg.editorExt.length = 0
  globalThis.__MD_TABLES_TEST__ = {}
  let oldDispose = null
  A.doesNotThrow(() => { oldDispose = new Function('ctx', src)(old) }, '旧宿主下 setup 不抛')
  A.equal(typeof oldDispose, 'function')
  A.equal(reg.views.length, 1, '旧宿主下视图照样注册')
  A.equal(reg.commands.length, 5, '五个命令照样注册(只有 run() 降级)')
  A.equal(reg.settings.length, 3, '设置项照样注册')
  A.equal(reg.editorExt.length, 0, '旧宿主没有编辑器扩展这条口')
  PAGE = mkPage(['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'))
  const el2 = mkEl('div')
  const off = reg.views[0].mount(el2)
  A.ok(el2.textContent.length > 0, '旧宿主下视图仍挂出可见内容')
  A.ok(el2.textContent.includes('表格工作台'), '回退中文')
  A.ok(el2.textContent.includes('不支持编辑器扩展'), '如实说明降级原因')
  const offOps = findAll(el2, (c) => c.attrs && c.attrs['data-op'])
  A.ok(offOps.length === 0 || offOps.every((c) => c.disabled || c.attrs['data-op'] === 'copySrc'), '旧宿主下操作按钮不该可用')
  // 旧宿主没有 prompt:斜杠项回退到设置里的默认尺寸,不抛
  const md = await reg.slash[0].run({})
  A.equal(md, T.scaffoldTable(3, 3), '旧宿主无 prompt → 用默认尺寸,不抛')
  A.doesNotThrow(() => off())
  A.doesNotThrow(() => oldDispose())
}
ok('A6 旧宿主 ctx:setup 不抛 / 贡献点齐全 / 视图有可见内容 / 回退中文 / 无 prompt 也能插表')

console.log('\n══════════════════════════════════════════════')
// ══════════════════════════════════════════════════════════════════════════
// [回归] 2026-08-21 评审 Finding 1:单元格 → **markdown 源码**,不是纯文本
//   以前是 `cell.textContent`,于是「格式化 / 复制对齐源码」把粗体、链接 URL、行内代码、
//   删除线、行内公式、<br> 全吃掉 —— 用户粘到 GitHub 上链接全断,而 README / SPEC §6.0 /
//   onboarding 三处都承诺「<br> / **粗体** / 链接原样保留」。
// ══════════════════════════════════════════════════════════════════════════
{
  const txt = (t, marks) => ({ isText: true, text: t, marks: marks || [] })
  const mk = (n, attrs) => ({ type: { name: n }, attrs: attrs || {}, isText: false, childCount: 0 })
  const para = (kids) => ({ childCount: kids.length, child: (i) => kids[i], content: {}, textContent: kids.map((k) => k.text || '').join('') })
  const cell = (kids) => ({ childCount: 1, child: () => para(kids), textContent: kids.map((k) => k.text || '').join('') })
  const M = (n) => ({ type: { name: n }, attrs: {} })
  A.equal(T.cellText(cell([txt('重要', [M('strong')])])), '**重要**', 'R-F1 粗体带回星号')
  A.equal(T.cellText(cell([txt('斜', [M('em')])])), '*斜*', 'R-F1 斜体')
  A.equal(T.cellText(cell([txt('npm run dev', [M('inlineCode')])])), '`npm run dev`', 'R-F1 行内代码带回反引号')
  A.equal(T.cellText(cell([txt('废弃', [M('strike_through')])])), '~~废弃~~', 'R-F1 删除线')
  A.equal(
    T.cellText(cell([txt('文档', [{ type: { name: 'link' }, attrs: { href: 'https://example.com/doc' } }])])),
    '[文档](https://example.com/doc)', 'R-F1 链接必须带 URL 出去(不带 = 用户粘到 GitHub 上链接全断)')
  A.equal(T.cellText(cell([txt('第一行'), mk('hardbreak'), txt('第二行')])), '第一行<br>第二行', 'R-F1 <br> 原样(README 明写)')
  A.equal(T.cellText(cell([txt('见 '), mk('math_inline', { value: '$E=mc^2$' })])), '见 $E=mc^2$', 'R-F1 行内公式是原子节点,正文在 attrs 上')
  A.equal(T.cellText(cell([txt('普通')])), '普通', 'R-F1 没有 mark 的照旧是纯文本')
  A.equal(T.cellText({ textContent: '兜底', childCount: 0 }), '兜底', 'R-F1 结构认不出时退回纯文本,别把格子弄空')
  console.log('  ✅ R-F1 单元格序列化保住行内格式与链接')
}

console.log(`md-tables 自检全绿:${passed} 组断言通过`)
console.log('（SPEC §8 的 A1-A8 / B9-B10 / C1-C11 全覆盖）')
console.log('══════════════════════════════════════════════')
