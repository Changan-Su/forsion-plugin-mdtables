/**
 * 表格工作台 md-tables —— Forsion 桌面插件(裸 setup(ctx) 体,宿主 new Function('ctx', code) 装载)。
 *
 * markdown 表格的行列操作台:光标落进一张表格 → 表格上方浮出工具条(行/列/排序/对齐/源码);
 * `tables` 视图鸟瞰这一篇里的每张表;「格式化」产出竖线对齐的源码放进剪贴板。
 *
 * ══ 顶注:本插件改文档的合法通路只有两条,一条都不许扩 ══════════════════════════════
 *
 * ① **ProseMirror 事务**(`view.dispatch(tr)`)—— 结构操作(行/列/排序/对齐)的唯一路径。
 *    一次用户动作 = 恰好一个 transaction,于是编辑器自己的 Cmd/Ctrl+Z 一步撤销。
 * ② **宿主中介的斜杠插入** —— 斜杠项的 run() **只 return 那段 markdown**,由宿主自己插进去。
 *    绝不在 run() 里再插一次,否则表格插两遍。
 *
 * 除此之外一律不碰:
 * - **零磁盘写入**。ctx.app 的整库写口本插件一次都不用(check.mjs 有静态断言 + 运行时计数)。
 * - **零「插一段 md 到活动页」调用**。宿主那条插字口本插件也不用 —— 我们只经事务改结构。
 *   这与 20260821 BRIEF「改活动页只有插字口」的偏差是**刻意的、更严的**:那句针对的是
 *   「只有块表面、没有编辑器接缝」的插件;本插件有 registerEditorExtension 这条受支持契约。
 * - **从 `page.text` 算出来的任何结果,永远不许打回活文档。** `page.text` 是「上次保存那一刻」
 *   的快照(≤800ms 陈旧),那 800ms 里用户敲的字会被抹掉。文本层只服务:自检向量、视图清单、
 *   格式化预览、脚手架生成。
 *
 * ══ 三层架构 ═══════════════════════════════════════════════════════════════════
 *
 *   计划层 planner(纯,内容无关)—— planRow / planCol / planSort,只算「哪一行去哪儿」
 *        ├─ 文本层 text ops   parse/serialize/format,服务自检 / 视图 / 剪贴板 / 脚手架
 *        └─ 节点层 doc ops    按同一份置换重排现成 Fragment,未动节点按引用复用
 *
 * 为什么要分:结构操作若走「节点 → 源文本 → 改 → 重新解析 → 建节点」,格子里的粗体 / 链接 /
 * wikilink / 行内公式会被手写解析器压成纯文本 = 毁用户内容。分层之后节点层一个字节都不重建。
 *
 * 安全:一切用户内容只走 createElement + textContent(全文件没有任何 HTML 字符串注入面)。
 * 兼容:07-18 之后的 ctx 面一律可选链,旧宿主缺席时优雅降级(操作按钮置灰并说明原因)。
 * 双语:MSG.zh / MSG.en 两侧键集合相等;ctx.subscribeLocale 触发就地重画(视图不重挂)。
 * 时间:全文件无周期定时器,节流一律 setTimeout 自排程。
 */

const PLUGIN_ID = 'md-tables'
const LS_PREFIX = 'plugin.md-tables.'
const CMD_KEYWORDS = 'table 表格 biaoge 行 列 row col column sort align 对齐 排序 格式化 format'

// ── 中英双语词表(zh/en 两侧键集合必须完全相等,check.mjs 有断言) ─────────────────
// 翻的只有 UI 文案。本插件零落盘,所以没有「会随语言变的产物路径」这个雷区;唯一钉死中文常量的
// 地方是万一将来要落盘时的工作文件夹名(见 README「若 v1.1 要导出源码」一节)。
// 占位符一律 {name} 形式,替换**单趟正则**(逐个 split/join 会把先替进去的用户内容再吃一遍)。
const MSG = {
  zh: {
    // 视图 / 通用
    viewTitle: '表格工作台',
    refresh: '刷新',
    empty: '这篇笔记里还没有表格',
    noPage: '还没有打开的笔记。打开一篇含表格的笔记,或在笔记里打 / 选「插入表格」。',
    noHost: '当前宿主不支持编辑器扩展,表格清单只能查看与复制源码',
    readonlyHint: '只读快照 —— 点一下正文,操作按钮就会亮',
    tablesCount: '{n} 张表格',
    tableLabel: '表 {n}',
    size: '{c} 列 × {r} 行',
    jump: '跳过去',
    selected: '当前选中',
    copySrcTitle: '对齐源码(可直接贴到 GitHub / README)',
    copied: '对齐源码已复制',
    copyFailed: '复制失败,请在下面的框里手动选中',
    sep: '、',
    more: '…',
    untitledCol: '第 {i} 列',
    v3Limited: '这是旧式分块笔记:清单只负责跳转与复制源码。跳过去之后,用表格上方的工具条做行列操作。',
    listJumpHint: '清单只负责跳转与复制源码。点一下就跳过去,再用表格上方的工具条做行列操作。',
    // 工具条组标签
    grpRow: '行',
    grpCol: '列',
    grpSort: '排序',
    grpAlign: '对齐',
    grpSrc: '源码',
    // 工具条 / 操作按钮 title
    rowUp: '上移这一行',
    rowDown: '下移这一行',
    rowAbove: '在上方插入一行',
    rowBelow: '在下方插入一行',
    rowDel: '删除这一行',
    colLeft: '左移这一列',
    colRight: '右移这一列',
    colBefore: '在左侧插入一列',
    colAfter: '在右侧插入一列',
    colDel: '删除这一列',
    sortAsc: '按当前列升序排序',
    sortDesc: '按当前列降序排序',
    alignL: '这一列左对齐',
    alignC: '这一列居中',
    alignR: '这一列右对齐',
    alignNone: '这一列不指定对齐',
    copySrc: '复制对齐后的表格源码',
    // 提示 / 拒绝
    needTable: '把光标放进一张表格里再试',
    lastRow: '表格至少要保留一行数据行,这一行删不得',
    lastCol: '表格至少要保留一列,这一列删不得',
    firstRow: '已经在最上面一行了',
    firstCol: '已经在最左边一列了',
    endRow: '已经在最下面一行了',
    endCol: '已经在最右边一列了',
    headerRow: '表头行不能删除,也不能移动',
    notSimple: '这张表格有合并单元格或结构异常,已跳过',
    noView: '请先点一下正文,把光标放进笔记里',
    insertFailed: '这一步没能应用到编辑器,请重试',
    badSize: '看不懂的尺寸,写成 3x4 这样(行数 x 列数)',
    promptTitle: '插入表格',
    promptLabel: '行数 x 列数(行数不含表头)',
    // 命令 / 斜杠 / 设置标题(注册时取一次,切语言要重启才跟上 —— README 已如实写)
    cmdOpen: '表格工作台',
    cmdFormat: '格式化当前表格(复制对齐源码)',
    cmdRowInsert: '在下方插入一行',
    cmdColInsert: '在右侧插入一列',
    cmdSort: '按当前列升序排序',
    slashLabel: '插入表格',
    slashHint: '可指定行列数',
    setBar: '光标进表格时显示工具条',
    setRows: '新建表格的默认行数(不含表头)',
    setCols: '新建表格的默认列数',
  },
  en: {
    viewTitle: 'Tables',
    refresh: 'Refresh',
    empty: 'No tables in this note yet',
    noPage: 'No note is open. Open a note that has tables, or type / in a note and pick "Insert table".',
    noHost: 'This host has no editor-extension support — the list can only show and copy source',
    readonlyHint: 'Read-only snapshot — click into the note body and the buttons light up',
    tablesCount: '{n} table(s)',
    tableLabel: 'Table {n}',
    size: '{c} cols × {r} rows',
    jump: 'Go to table',
    selected: 'Selected',
    copySrcTitle: 'Aligned source (paste straight into GitHub / a README)',
    copied: 'Aligned source copied',
    copyFailed: 'Copy failed — select the text in the box below instead',
    sep: ', ',
    more: '…',
    untitledCol: 'Col {i}',
    v3Limited: 'This is a legacy block-based note: the list only jumps and copies source. Once there, use the toolbar above the table for row and column edits.',
    listJumpHint: 'The list only jumps and copies source. Click to jump, then use the toolbar above the table for row and column edits.',
    grpRow: 'Row',
    grpCol: 'Column',
    grpSort: 'Sort',
    grpAlign: 'Align',
    grpSrc: 'Source',
    rowUp: 'Move this row up',
    rowDown: 'Move this row down',
    rowAbove: 'Insert a row above',
    rowBelow: 'Insert a row below',
    rowDel: 'Delete this row',
    colLeft: 'Move this column left',
    colRight: 'Move this column right',
    colBefore: 'Insert a column to the left',
    colAfter: 'Insert a column to the right',
    colDel: 'Delete this column',
    sortAsc: 'Sort by this column, ascending',
    sortDesc: 'Sort by this column, descending',
    alignL: 'Align this column left',
    alignC: 'Center this column',
    alignR: 'Align this column right',
    alignNone: 'Leave this column unaligned',
    copySrc: 'Copy the aligned table source',
    needTable: 'Put the cursor inside a table first',
    lastRow: 'A table has to keep at least one body row — this one cannot go',
    lastCol: 'A table has to keep at least one column — this one cannot go',
    firstRow: 'Already at the top row',
    firstCol: 'Already at the leftmost column',
    endRow: 'Already at the bottom row',
    endCol: 'Already at the rightmost column',
    headerRow: 'The header row can be neither deleted nor moved',
    notSimple: 'This table has merged cells or an unexpected structure — skipped',
    noView: 'Click into the note body first so the cursor is in the note',
    insertFailed: 'That step could not be applied to the editor — please try again',
    badSize: 'Could not read that size — write it like 3x4 (rows x columns)',
    promptTitle: 'Insert table',
    promptLabel: 'rows x columns (header row not counted)',
    cmdOpen: 'Table Workbench',
    cmdFormat: 'Format table (copy aligned source)',
    cmdRowInsert: 'Insert row below',
    cmdColInsert: 'Insert column right',
    cmdSort: 'Sort by current column (asc)',
    slashLabel: 'Insert table',
    slashHint: 'Choose rows × columns',
    setBar: 'Show toolbar when cursor enters a table',
    setRows: 'Default body rows for new tables',
    setCols: 'Default columns for new tables',
  },
}

const L = () => {
  try {
    const l = ctx.getLocale ? ctx.getLocale() : 'zh'
    return l === 'en' ? 'en' : 'zh'
  } catch (_) { return 'zh' }
}
const t = (k, vars) => {
  const d = MSG[L()] || MSG.zh
  const s = d[k] != null ? d[k] : (MSG.zh[k] != null ? MSG.zh[k] : k)
  return vars ? s.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m)) : s
}

// ── 设置读法(宿主表单在「值 == 默认值」时把键整个 removeItem,boolean 写 'true'/'false';
//    所以读到 null 不等于「没设置过」也不等于 false,而是「就是默认值」)────────────────
const lsGet = (k) => {
  try { return localStorage.getItem(LS_PREFIX + k) } catch (_) { return null }
}
const lsSet = (k, v) => {
  try { localStorage.setItem(LS_PREFIX + k, String(v)) } catch (_) { /* 隐私模式 / 无 storage */ }
}
const boolSetting = (k, dflt) => {
  const v = lsGet(k)
  return v == null ? dflt : !(v === 'false' || v === '0')
}
const numSetting = (k, dflt, lo, hi) => {
  const raw = lsGet(k)
  const n = parseInt(raw == null ? '' : raw, 10)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
}

const notify = (msg, level) => {
  try {
    if (ctx.notify) { ctx.notify(msg, level ? { level: level } : undefined); return }
  } catch (_) { /* 旧宿主 */ }
  try {
    if (ctx.app && ctx.app.notify) ctx.app.notify(msg)
  } catch (_) { /* 连兜底都没有就闷声 */ }
}
const logActivity = (event, detail) => {
  try {
    if (ctx.activity && ctx.activity.log) ctx.activity.log(event, detail)
  } catch (_) { /* 旧宿主 */ }
}

// ════════════════════════════════════════════════════════════════════════════
// 文本层:Table = { header: string[], align: Align[], rows: string[][] }
// 格子字符串一律存「生」形态(`|` 就是 `|`),转义只发生在序列化那一刻。
// `<br>` / `**粗体**` / `[[链接]]` 原样保留 —— 解析器不认识它们,也不该认识。
// ════════════════════════════════════════════════════════════════════════════

// CJK / 全角 / emoji 按 2 计宽(按码点判,不是按 UTF-16 单元)
const WIDE_RANGES = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
]
function cellWidth(s) {
  const str = s == null ? '' : String(s)
  let w = 0
  for (const ch of str) {
    const cp = ch.codePointAt(0)
    let wide = false
    for (let i = 0; i < WIDE_RANGES.length; i++) {
      const r = WIDE_RANGES[i]
      if (cp >= r[0] && cp <= r[1]) { wide = true; break }
    }
    w += wide ? 2 : 1
  }
  return w
}

/** 生形态 → 源码形态:只管竖线,别动别的。 */
function escapeCell(raw) {
  return String(raw == null ? '' : raw).replace(/\|/g, '\\|')
}
/** 源码形态 → 生形态:`\|` 还原成 `|`,其余反斜杠原样留着(`\n` 不是我们的事)。 */
function unescapeCell(src) {
  const s = String(src == null ? '' : src)
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i)
    if (ch === '\\' && i + 1 < s.length) {
      const nx = s.charAt(i + 1)
      if (nx === '|') { out += '|'; i++; continue }
      out += ch
      continue
    }
    out += ch
  }
  return out
}

/** 线性扫描切格:`\` 后的下一个字符一律吃掉(不作为分隔),只有裸 `|` 才切。 */
function splitCellsRaw(line) {
  const s = String(line == null ? '' : line)
  const out = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i)
    if (ch === '\\' && i + 1 < s.length) { cur += ch + s.charAt(i + 1); i++; continue }
    if (ch === '|') { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}
/** 行尾是不是一个**未转义**的竖线(前面的连续反斜杠是偶数个)。 */
function endsWithBarePipe(line) {
  const s = String(line == null ? '' : line)
  if (!s.length || s.charAt(s.length - 1) !== '|') return false
  let back = 0
  for (let i = s.length - 2; i >= 0 && s.charAt(i) === '\\'; i--) back++
  return back % 2 === 0
}
/** 一行 → 未 trim 的格子源码数组(首尾各剥掉一个可选的竖线)。 */
function rowCells(line) {
  const s = String(line == null ? '' : line).replace(/\s+$/, '')
  const segs = splitCellsRaw(s)
  if (/^\s*\|/.test(s)) segs.shift()
  if (segs.length && endsWithBarePipe(s)) segs.pop()
  return segs
}

function alignOfToken(tok) {
  const s = String(tok == null ? '' : tok)
  const l = s.charAt(0) === ':'
  const r = s.length > 0 && s.charAt(s.length - 1) === ':'
  if (l && r) return 'center'
  if (l) return 'left'
  if (r) return 'right'
  return null
}

/**
 * 源码 → Table,判不出合法一律 null(= 不动它)。判定顺序不许调。
 */
function parseTable(src) {
  if (typeof src !== 'string') return null
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length && lines[0].trim() === '') lines.shift()
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  if (lines.length < 2) return null
  for (let i = 0; i < lines.length; i++) {
    if (/^ {4,}/.test(lines[i])) return null          // 4 空格缩进 = 代码块,不是表
    if (splitCellsRaw(lines[i]).length < 2) return null // 每行至少一个未转义竖线
  }
  const grid = lines.map(rowCells)
  const sepTokens = grid[1].map((c) => c.trim())
  if (!sepTokens.length) return null
  for (let i = 0; i < sepTokens.length; i++) {
    if (!/^:?-+:?$/.test(sepTokens[i])) return null
  }
  const header = grid[0].map((c) => unescapeCell(c.trim()))
  if (header.length !== sepTokens.length) return null   // GFM 严格规则:表头宽 == 分隔行宽
  const align = sepTokens.map(alignOfToken)
  const rows = []
  for (let i = 2; i < grid.length; i++) {
    const r = grid[i].map((c) => unescapeCell(c.trim()))
    while (r.length < header.length) r.push('')
    rows.push(r.slice(0, header.length))
  }
  return { header: header, align: align, rows: rows }
}

/** 分隔行的最小宽:冒号是**加在** 3 根短横之上的,不是占掉一根。 */
function minSepWidth(a) {
  if (a === 'center') return 5
  if (a === 'left' || a === 'right') return 4
  return 3
}
function alignToken(a, w) {
  const n = typeof w === 'number' && Number.isFinite(w) ? Math.max(Math.floor(w), minSepWidth(a)) : minSepWidth(a)
  if (a === 'left') return ':' + '-'.repeat(n - 1)
  if (a === 'right') return '-'.repeat(n - 1) + ':'
  if (a === 'center') return ':' + '-'.repeat(n - 2) + ':'
  return '-'.repeat(n)
}

/**
 * Table → 源码。`opts.pad`(缺省 false)= 补空格对齐竖线。
 * 空格**一律补在格子右边**,不按该列的对齐方式决定补哪边(见 README 范围说明第 10 条)。
 * 末尾不带换行,调用方自己接。
 */
function serializeTable(tb, opts) {
  if (!tb || !tb.header) return null
  const pad = !!(opts && opts.pad)
  const cols = tb.header.length
  const escRow = (arr) => {
    const e = []
    for (let c = 0; c < cols; c++) e.push(escapeCell(arr && arr[c] != null ? arr[c] : ''))
    return e
  }
  const head = escRow(tb.header)
  const body = (tb.rows || []).map(escRow)
  const align = []
  for (let c = 0; c < cols; c++) align.push(tb.align && tb.align[c] != null ? tb.align[c] : null)
  const W = []
  for (let c = 0; c < cols; c++) {
    let w = minSepWidth(align[c])
    if (pad) {
      w = Math.max(w, cellWidth(head[c]))
      for (let r = 0; r < body.length; r++) w = Math.max(w, cellWidth(body[r][c]))
    }
    W.push(w)
  }
  const padTo = (s, c) => (pad ? s + ' '.repeat(Math.max(0, W[c] - cellWidth(s))) : s)
  const line = (cells) => '| ' + cells.map(padTo).join(' | ') + ' |'
  const out = [line(head), '| ' + align.map((a, c) => alignToken(a, W[c])).join(' | ') + ' |']
  for (let r = 0; r < body.length; r++) out.push(line(body[r]))
  return out.join('\n')
}

/** 源码 → 竖线对齐的源码;判不出合法一律 null。 */
function formatTable(src) {
  const tb = parseTable(src)
  return tb ? serializeTable(tb, { pad: true }) : null
}

/** 纯:换 align[col],其余逐字保留。 */
function applyAlign(tb, col, a) {
  if (!tb) return tb
  const align = (tb.align || []).slice()
  if (col >= 0 && col < align.length) align[col] = a == null ? null : a
  return { header: (tb.header || []).slice(), align: align, rows: (tb.rows || []).map((r) => r.slice()) }
}

/** canonical(不补空格)的空表脚手架;rows = body 行数,不含表头。 */
function scaffoldTable(rows, cols) {
  const c = Math.max(1, Math.min(20, Math.floor(Number(cols)) || 1))
  const r = Math.max(1, Math.min(50, Math.floor(Number(rows)) || 1))
  const blank = () => {
    const a = []
    for (let i = 0; i < c; i++) a.push('')
    return a
  }
  const body = []
  for (let i = 0; i < r; i++) body.push(blank())
  return serializeTable({ header: blank(), align: blank().map(() => null), rows: body }, { pad: false })
}

/** '3x3' / '3X3' / '3*3' / '3×3' / '3 3' / '3,3' → {rows, cols}(分别钳在 1-50 / 1-20)。 */
function parseSize(raw) {
  const m = /^\s*(\d{1,5})\s*(?:[xX*×,]\s*|\s+)(\d{1,5})\s*$/.exec(String(raw == null ? '' : raw))
  if (!m) return null
  return {
    rows: Math.min(50, Math.max(1, parseInt(m[1], 10))),
    cols: Math.min(20, Math.max(1, parseInt(m[2], 10))),
  }
}

/**
 * 全文扫描:围栏状态机挡住代码块里的假表;仅当第 1 行恰为 `---` 且后面有闭合 `---` 时跳 frontmatter。
 * Found = { line(0-based), src, header, rows, cols }
 */
function findTablesInText(text) {
  const out = []
  if (typeof text !== 'string' || !text) return out
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  if (lines.length && lines[0].trim() === '---') {
    let close = -1
    for (let k = 1; k < lines.length; k++) {
      if (lines[k].trim() === '---') { close = k; break }
    }
    if (close > 0) i = close + 1
  }
  let fenceCh = ''
  let fenceLen = 0
  let seg = []
  let segStart = -1
  const flush = () => {
    if (seg.length >= 2) {
      const src = seg.join('\n')
      const tb = parseTable(src)
      if (tb) out.push({ line: segStart, src: src, header: tb.header.slice(), rows: tb.rows.length, cols: tb.header.length })
    }
    seg = []
    segStart = -1
  }
  for (; i < lines.length; i++) {
    const ln = lines[i]
    const fm = /^ {0,3}(`{3,}|~{3,})/.exec(ln)
    if (fenceCh) {
      if (fm && fm[1].charAt(0) === fenceCh && fm[1].length >= fenceLen && ln.slice(ln.indexOf(fm[1]) + fm[1].length).trim() === '') {
        fenceCh = ''
        fenceLen = 0
      }
      continue
    }
    if (fm) { flush(); fenceCh = fm[1].charAt(0); fenceLen = fm[1].length; continue }
    if (ln.trim() === '' || splitCellsRaw(ln).length < 2) { flush(); continue }
    if (segStart < 0) segStart = i
    seg.push(ln)
  }
  flush()
  return out
}

// ════════════════════════════════════════════════════════════════════════════
// 计划层:纯、内容无关。两条路(文本层 / 节点层)共用同一份置换。
// order 里 -1 = 新的空行 / 空列。
// ════════════════════════════════════════════════════════════════════════════

function planSeq(count, at, kind) {
  const n = Math.floor(Number(count))
  const a = Math.floor(Number(at))
  if (!Number.isFinite(n) || n < 1) return null
  if (!Number.isFinite(a) || a < 0 || a >= n) return null
  const base = []
  for (let i = 0; i < n; i++) base.push(i)
  if (kind === 'before') { const o = base.slice(); o.splice(a, 0, -1); return { order: o, cursor: a } }
  if (kind === 'after') { const o = base.slice(); o.splice(a + 1, 0, -1); return { order: o, cursor: a + 1 } }
  if (kind === 'delete') {
    if (n <= 1) return null
    const o = base.slice()
    o.splice(a, 1)
    return { order: o, cursor: Math.min(a, o.length - 1) }
  }
  if (kind === 'prev') {
    if (a <= 0) return null
    const o = base.slice()
    o[a - 1] = a
    o[a] = a - 1
    return { order: o, cursor: a - 1 }
  }
  if (kind === 'next') {
    if (a >= n - 1) return null
    const o = base.slice()
    o[a] = a + 1
    o[a + 1] = a
    return { order: o, cursor: a + 1 }
  }
  return null
}

const ROW_KIND = { insertAbove: 'before', insertBelow: 'after', delete: 'delete', moveUp: 'prev', moveDown: 'next' }
const COL_KIND = { insertLeft: 'before', insertRight: 'after', delete: 'delete', moveLeft: 'prev', moveRight: 'next' }

/** at = **body 行下标**(0-based,不含表头)。返回 {order, cursorRow} 或 null。 */
function planRow(bodyCount, at, op) {
  const kind = ROW_KIND[op]
  if (!kind) return null
  const p = planSeq(bodyCount, at, kind)
  return p ? { order: p.order, cursorRow: p.cursor } : null
}
/** 返回 {order, cursorCol} 或 null。 */
function planCol(colCount, at, op) {
  const kind = COL_KIND[op]
  if (!kind) return null
  const p = planSeq(colCount, at, kind)
  return p ? { order: p.order, cursorCol: p.cursor } : null
}

const NUM_RE = /^[+-]?[\d,]*\.?\d+%?$/
/** 数值化:命中 NUM_RE 才算数,否则 null(= 文本)。 */
function numOf(s) {
  const v = String(s == null ? '' : s).trim()
  if (!NUM_RE.test(v)) return null
  const n = parseFloat(v.replace(/,/g, '').replace(/%$/, ''))
  return Number.isFinite(n) ? n : null
}
/** 所有**非空**格子都能数值化,且至少有一个非空 → 数值列。 */
function isNumericColumn(vals) {
  const filled = (vals || []).map((v) => String(v == null ? '' : v)).filter((v) => v.trim() !== '')
  if (!filled.length) return false
  for (let i = 0; i < filled.length; i++) {
    if (numOf(filled[i]) === null) return false
  }
  return true
}
/**
 * 排序计划:空格子恒沉底(升降序都是最后);数值列按数值,文本列按 localeCompare(_, 'zh');
 * 等值稳定(带原下标做 tie-break);表头永远不参与。
 */
function planSort(bodyCol, dir) {
  const vals = (bodyCol || []).map((v) => String(v == null ? '' : v))
  const desc = dir === 'desc'
  const filled = []
  const blanks = []
  for (let i = 0; i < vals.length; i++) {
    if (vals[i].trim() === '') blanks.push(i)
    else filled.push(i)
  }
  const numeric = isNumericColumn(vals)
  filled.sort((x, y) => {
    let d
    if (numeric) d = numOf(vals[x]) - numOf(vals[y])
    else d = vals[x].localeCompare(vals[y], 'zh')
    if (!d) return x - y
    return desc ? -d : d
  })
  return { order: filled.concat(blanks) }
}

// ════════════════════════════════════════════════════════════════════════════
// 节点层:按同一份置换重排现成 Fragment。未动的 row / cell **按引用复用** ——
// 这就是「格子里的粗体 / 链接 / wikilink 零丢失」的可测形状。
// ════════════════════════════════════════════════════════════════════════════

/**
 * 拒绝面:判不出是一张简单 GFM 表就整表让开(不出工具条、命令提示后返回)。
 */
function isSimpleGfmTable(node) {
  try {
    if (!node || typeof node.child !== 'function') return false
    if (!(node.childCount >= 2)) return false
    const head = node.child(0)
    if (!head || !head.type || head.type.name !== 'table_header_row') return false
    let width = -1
    for (let r = 0; r < node.childCount; r++) {
      const row = node.child(r)
      if (!row || !row.type) return false
      if (r > 0 && row.type.name !== 'table_row') return false
      if (!(row.childCount >= 1)) return false
      if (width < 0) width = row.childCount
      else if (row.childCount !== width) return false
      for (let c = 0; c < row.childCount; c++) {
        const cell = row.child(c)
        if (!cell || !cell.type) return false
        const at = cell.attrs || {}
        if (at.colspan != null && at.colspan !== 1) return false
        if (at.rowspan != null && at.rowspan !== 1) return false
        if (cell.childCount !== 1) return false
        const first = cell.child(0)
        if (!first || !first.type || first.type.name !== 'paragraph') return false
      }
    }
    return true
  } catch (_) { return false }
}

/** tablePos = 表节点**之前**的位置;返回该格 paragraph 内部的位置。 */
function cellStart(tableNode, tablePos, rowIdx, colIdx) {
  let p = tablePos + 1                       // 进 table
  for (let r = 0; r < rowIdx; r++) p += tableNode.child(r).nodeSize
  p += 1                                     // 进 row
  const row = tableNode.child(rowIdx)
  for (let c = 0; c < colIdx; c++) p += row.child(c).nodeSize
  return p + 2                               // 进 cell,再进它的 paragraph
}

const alignOfCell = (cell) => {
  const a = cell && cell.attrs ? cell.attrs.alignment : null
  return a == null ? null : a
}

// ⚠️ schema 的 alignment default 是 'left' —— 裸调 createAndFill() 会让新插入的列在下次保存时
// 整列分隔符静默从 `---` 变成 `:---`(git diff 里冒出一行没人改过的东西)。**必须显式传 null**。
const newCell = (schema, align) => schema.nodes.table_cell.create({ alignment: align == null ? null : align }, schema.nodes.paragraph.create())
const newHeader = (schema, align) => schema.nodes.table_header.create({ alignment: align == null ? null : align }, schema.nodes.paragraph.create())

/**
 * 行置换 → 新的 rows 数组(下标 0 恒为原表头行,按引用复用)。
 * plan.order 里的下标是 **body 坐标**;-1 = 新空行(每格继承该列表头的 alignment,
 * 否则新行在一整列居中的表里会歪 —— 对齐是逐格 DOM 样式)。
 * duck-typed 契约:schema.nodes.{table_row,table_cell,paragraph}.create;
 *                  tableNode.{childCount,child(i)};row.{childCount,child(i)}
 */
function rebuildRows(schema, tableNode, plan) {
  const head = tableNode.child(0)
  const body = []
  for (let i = 1; i < tableNode.childCount; i++) body.push(tableNode.child(i))
  const cols = head.childCount
  const aligns = []
  for (let c = 0; c < cols; c++) aligns.push(alignOfCell(head.child(c)))
  const out = [head]
  const order = plan && plan.order ? plan.order : []
  for (let k = 0; k < order.length; k++) {
    const idx = order[k]
    if (idx === -1) {
      const cells = []
      for (let c = 0; c < cols; c++) cells.push(newCell(schema, aligns[c]))
      out.push(schema.nodes.table_row.create(null, cells))
    } else {
      out.push(body[idx])
    }
  }
  return out
}

/**
 * 列置换 → 新的 rows 数组(每行都要重建,因为它的格子清单变了;**格子本身按引用复用**)。
 * -1 = 新列:表头行用 table_header 工厂,body 行用 table_cell 工厂,两处都显式 {alignment: null}。
 */
function rebuildCols(schema, tableNode, plan) {
  const order = plan && plan.order ? plan.order : []
  const out = []
  for (let r = 0; r < tableNode.childCount; r++) {
    const row = tableNode.child(r)
    const isHead = r === 0
    const cells = []
    for (let k = 0; k < order.length; k++) {
      const idx = order[k]
      if (idx === -1) cells.push(isHead ? newHeader(schema, null) : newCell(schema, null))
      else cells.push(row.child(idx))
    }
    const type = isHead ? schema.nodes.table_header_row : schema.nodes.table_row
    out.push(type.create(row.attrs || null, cells))
  }
  return out
}

/** 返回 {node, pos, depth, rowIndex(含表头), colIndex} 或 null。pos = 表节点之前的位置。 */
function findTableAt(state) {
  try {
    const $from = state.selection.$from
    for (let d = $from.depth; d >= 1; d--) {
      if ($from.node(d).type.name === 'table') {
        return {
          node: $from.node(d),
          pos: $from.before(d),
          depth: d,
          rowIndex: $from.index(d),
          colIndex: $from.index(d + 1),
        }
      }
    }
  } catch (_) { /* 选区形态异常 = 当作不在表里 */ }
  return null
}

/** 节点 → 文本层 Table(只服务序列化 / 预览 / 排序判据,**永不回写**)。 */
function tableToTable(node) {
  const header = []
  const align = []
  const head = node.child(0)
  for (let c = 0; c < head.childCount; c++) {
    const cell = head.child(c)
    header.push(cellText(cell))
    align.push(alignOfCell(cell))
  }
  const rows = []
  for (let r = 1; r < node.childCount; r++) {
    const row = node.child(r)
    const arr = []
    for (let c = 0; c < row.childCount; c++) arr.push(cellText(row.child(c)))
    rows.push(arr)
  }
  return { header: header, align: align, rows: rows }
}
/** mark 名 → markdown 定界符。宿主 schema 的名字(strong / em / inlineCode / strike_through)。 */
const MARK_WRAP = { strong: '**', em: '*', inlineCode: '`', code_inline: '`', strike_through: '~~', strikethrough: '~~', del: '~~' }
/** 一个 inline 节点 → markdown 源码片段。 */
function inlineToMd(n) {
  if (!n) return ''
  const ty = (n.type && n.type.name) || ''
  if (ty === 'hardbreak' || ty === 'hard_break' || ty === 'br') return '<br>'
  // 行内 HTML / 公式在宿主 schema 里是**原子节点**,正文在 attrs 上,textContent 拿不到
  if (!n.isText) {
    const a = n.attrs || {}
    const raw = a.value != null ? a.value : (a.html != null ? a.html : (a.text != null ? a.text : ''))
    if (raw) return String(raw)
    return n.textContent != null ? String(n.textContent) : ''
  }
  let out = String(n.text == null ? '' : n.text)
  let href = ''
  const wraps = []
  for (const m of (n.marks || [])) {
    const mn = (m.type && m.type.name) || ''
    if (mn === 'link') { href = (m.attrs && m.attrs.href) || ''; continue }
    const w = MARK_WRAP[mn]
    if (w) wraps.push(w)
  }
  for (const w of wraps) out = w + out + w
  if (href) out = '[' + out + '](' + href + ')'
  return out
}
/** 单元格 → markdown **源码**(不是纯文本)。
 *  ⚠️ 以前是 `cell.textContent`,于是「格式化 / 复制对齐源码」把粗体、链接 URL、行内代码、
 *     删除线、行内公式、`<br>` 全吃掉 —— 用户粘到 GitHub 上链接全断(评审 Finding 1),
 *     而 README / SPEC §6.0 / onboarding 三处都承诺「`<br>` / `**粗体**` / 链接原样保留」。 */
function cellText(cell) {
  try {
    if (!cell) return ''
    const parts = []
    const walk = (node) => {
      if (!node) return
      if (node.isText || !node.content || !node.childCount) { parts.push(inlineToMd(node)); return }
      for (let i = 0; i < node.childCount; i++) walk(node.child(i))
    }
    // 单元格里通常是一个 paragraph;逐层下钻到 inline 层
    if (cell.childCount) { for (let i = 0; i < cell.childCount; i++) walk(cell.child(i)) }
    else return String(cell.textContent == null ? '' : cell.textContent)
    const out = parts.join('')
    // 兜底:序列化不出东西(假 schema / 未知结构)就退回纯文本,别把格子弄空
    return out || String(cell.textContent == null ? '' : cell.textContent)
  } catch (_) {
    try { return String(cell && cell.textContent != null ? cell.textContent : '') } catch (_e) { return '' }
  }
}

// ── 一次操作 = 一个事务(五种操作全走这一条) ─────────────────────────────────
let pmKit = null   // 宿主递进来的 ProseMirror 工具箱(每个编辑器实例的工厂调用里存一次)

function commit(view, hit, nextTableNode, cursor) {
  try {
    const state = view.state
    let tr = state.tr.replaceWith(hit.pos, hit.pos + hit.node.nodeSize, nextTableNode)
    if (pmKit && pmKit.TextSelection) {
      const p = cellStart(nextTableNode, hit.pos, cursor.row, cursor.col)
      const size = tr.doc && tr.doc.content ? tr.doc.content.size : p
      tr = tr.setSelection(pmKit.TextSelection.near(tr.doc.resolve(Math.min(p, size))))
    }
    if (tr.scrollIntoView) tr.scrollIntoView()
    view.dispatch(tr)
    if (view.focus) view.focus()
    return true
  } catch (_) {
    notify(t('insertFailed'), 'error')
    return false
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 操作层:工具条与视图共用同一批 handler(别写两套)
// ════════════════════════════════════════════════════════════════════════════

const ROW_ACTIONS = { rowUp: 'moveUp', rowDown: 'moveDown', rowAbove: 'insertAbove', rowBelow: 'insertBelow', rowDel: 'delete' }
const COL_ACTIONS = { colLeft: 'moveLeft', colRight: 'moveRight', colBefore: 'insertLeft', colAfter: 'insertRight', colDel: 'delete' }
const ALIGN_ACTIONS = { alignL: 'left', alignC: 'center', alignR: 'right', alignNone: null }
const ROW_REJECT = { delete: 'lastRow', moveUp: 'firstRow', moveDown: 'endRow' }
const COL_REJECT = { delete: 'lastCol', moveLeft: 'firstCol', moveRight: 'endCol' }

let lastView = null
function liveView() {
  const v = lastView
  if (!v) return null
  try {
    if (v.isDestroyed) return null
  } catch (_) { return null }
  return v
}

/** 拿「当前这张表」,拿不到就照 SPEC 的拒绝面提示并返回 null(绝不静默失败)。 */
function currentHit(quiet) {
  const view = liveView()
  if (!view) {
    if (!quiet) notify(t('noView'), 'warning')
    return null
  }
  const hit = findTableAt(view.state)
  if (!hit) {
    if (!quiet) notify(t('needTable'), 'warning')
    return null
  }
  if (!isSimpleGfmTable(hit.node)) {
    if (!quiet) notify(t('notSimple'), 'warning')
    return null
  }
  return { view: view, hit: hit }
}

function applyRowOpOnDoc(view, hit, op) {
  const bodyCount = hit.node.childCount - 1
  if (hit.rowIndex === 0 && (op === 'delete' || op === 'moveUp' || op === 'moveDown')) {
    notify(t('headerRow'), 'warning')
    return false
  }
  // 光标在表头行 + 「下方插入」= 在表头正下方插一行 → 等价于 body 0 的 insertAbove
  const effOp = hit.rowIndex === 0 && op === 'insertBelow' ? 'insertAbove' : op
  const at = hit.rowIndex === 0 ? 0 : Math.min(bodyCount - 1, hit.rowIndex - 1)
  const plan = planRow(bodyCount, at, effOp)
  if (!plan) {
    notify(t(ROW_REJECT[effOp] || 'insertFailed'), 'warning')
    return false
  }
  const rows = rebuildRows(view.state.schema, hit.node, plan)
  const next = hit.node.type.create(hit.node.attrs, rows)
  const cols = hit.node.child(0).childCount
  return commit(view, hit, next, { row: plan.cursorRow + 1, col: Math.min(hit.colIndex, cols - 1) })
}

function applyColOpOnDoc(view, hit, op) {
  const colCount = hit.node.child(0).childCount
  const at = Math.max(0, Math.min(colCount - 1, hit.colIndex))
  const plan = planCol(colCount, at, op)
  if (!plan) {
    notify(t(COL_REJECT[op] || 'insertFailed'), 'warning')
    return false
  }
  const rows = rebuildCols(view.state.schema, hit.node, plan)
  const next = hit.node.type.create(hit.node.attrs, rows)
  return commit(view, hit, next, { row: hit.rowIndex, col: plan.cursorCol })
}

function applySortOnDoc(view, hit, col, dir) {
  const tb = tableToTable(hit.node)
  const column = tb.rows.map((r) => (r[col] == null ? '' : r[col]))
  const plan = planSort(column, dir)
  const rows = rebuildRows(view.state.schema, hit.node, { order: plan.order })
  const next = hit.node.type.create(hit.node.attrs, rows)
  let cursorRow = 0
  if (hit.rowIndex > 0) {
    const moved = plan.order.indexOf(hit.rowIndex - 1)
    cursorRow = moved >= 0 ? moved + 1 : 1
  }
  return commit(view, hit, next, { row: cursorRow, col: col })
}

function applyAlignOnDoc(view, hit, col, align) {
  const rows = []
  for (let r = 0; r < hit.node.childCount; r++) {
    const row = hit.node.child(r)
    const cells = []
    for (let c = 0; c < row.childCount; c++) {
      const cell = row.child(c)
      if (c !== col) { cells.push(cell); continue }
      const attrs = Object.assign({}, cell.attrs || {}, { alignment: align == null ? null : align })
      cells.push(cell.type.create(attrs, cell.content, cell.marks))
    }
    rows.push(row.type.create(row.attrs || null, cells))
  }
  const next = hit.node.type.create(hit.node.attrs, rows)
  return commit(view, hit, next, { row: hit.rowIndex, col: col })
}

/** 剪贴板:Electron 的 file:// 不是 secure context,navigator.clipboard 可能缺席。 */
async function copyText(s) {
  try {
    if (globalThis.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(String(s))
      return true
    }
  } catch (_) { /* 权限被拒 / 非 secure context → 落到 execCommand */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = String(s)
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    const host = layerRoot || document.body       // ⚠️挂插件自己的层根,不挂裸 body
    if (!host) return false
    host.appendChild(ta)
    if (ta.select) ta.select()
    const ok = document.execCommand ? document.execCommand('copy') : false
    ta.remove()
    return !!ok
  } catch (_) { return false }
}

async function copySource(src) {
  const ok = await copyText(src)
  notify(ok ? t('copied') : t('copyFailed'), ok ? 'success' : 'warning')
  if (ok) logActivity('copy-source', { text: String(src).slice(0, 80) })
  return ok
}

/** 工具条与视图共用的动作入口。返回 true = 真的改了文档 / 真的复制了。 */
function runAction(action) {
  const cur = currentHit(false)
  if (!cur) return false
  const view = cur.view
  const hit = cur.hit
  if (ROW_ACTIONS[action]) {
    const ok = applyRowOpOnDoc(view, hit, ROW_ACTIONS[action])
    if (ok) logActivity('row-op', { op: ROW_ACTIONS[action] })
    return ok
  }
  if (COL_ACTIONS[action]) {
    const ok = applyColOpOnDoc(view, hit, COL_ACTIONS[action])
    if (ok) logActivity('col-op', { op: COL_ACTIONS[action] })
    return ok
  }
  if (action === 'sortAsc' || action === 'sortDesc') {
    const dir = action === 'sortDesc' ? 'desc' : 'asc'
    lsSet('lastSortDir', dir)
    const cols = hit.node.child(0).childCount
    const ok = applySortOnDoc(view, hit, Math.max(0, Math.min(cols - 1, hit.colIndex)), dir)
    if (ok) logActivity('sort', { dir: dir })
    return ok
  }
  if (action in ALIGN_ACTIONS) {
    const cols = hit.node.child(0).childCount
    const ok = applyAlignOnDoc(view, hit, Math.max(0, Math.min(cols - 1, hit.colIndex)), ALIGN_ACTIONS[action])
    if (ok) logActivity('align', { to: String(ALIGN_ACTIONS[action]) })
    return ok
  }
  if (action === 'copySrc') {
    const src = serializeTable(tableToTable(hit.node), { pad: true })
    void copySource(src)
    return true
  }
  return false
}

// ════════════════════════════════════════════════════════════════════════════
// 样式(视图与工具条共用一份;一切颜色走宿主 token,没有硬编码前景 / 背景)
// ════════════════════════════════════════════════════════════════════════════

const STYLE = `
.mdt-root{height:100%;min-height:0;overflow:auto;color:inherit;background:var(--bg);font-size:13px;line-height:1.55}
.mdt-root *{box-sizing:border-box}
.mdt-wrap{max-width:820px;margin:0 auto;padding:18px 20px 48px;display:flex;flex-direction:column;gap:12px}
.mdt-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.mdt-title{font-size:20px;font-weight:700;color:inherit}
.mdt-count{font-size:11.5px;color:var(--text-muted, currentColor)}
.mdt-flex1{flex:1}
.mdt-note{font-size:12px;color:var(--text-muted, currentColor);padding:8px 10px;border-radius:10px;border:1px solid var(--border, currentColor);line-height:1.6}
.mdt-empty{padding:44px 12px;text-align:center;color:var(--text-muted, currentColor);font-size:12.5px}
.mdt-empty b{display:block;font-size:15px;color:inherit;margin-bottom:8px}
.mdt-list{display:flex;flex-direction:column;gap:6px}
.mdt-item{border:1px solid var(--border, currentColor);border-radius:12px;background:var(--bg-card);overflow:hidden}
.mdt-item.sel{border-color:var(--accent, currentColor)}
.mdt-item.bad{opacity:.72}
.mdt-line{display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;color:inherit}
.mdt-line:hover{background:var(--accent-light)}
.mdt-idx{font-size:11.5px;font-weight:700;letter-spacing:.04em;color:var(--text-muted, currentColor);white-space:nowrap}
.mdt-prev{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit}
.mdt-size{font-size:11.5px;color:var(--text-muted, currentColor);white-space:nowrap}
.mdt-exp{padding:2px 12px 12px;display:flex;flex-direction:column;gap:8px}
.mdt-ta{width:100%;min-height:96px;max-height:280px;resize:vertical;padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:inherit;background:var(--bg);border:1px solid var(--border, currentColor);border-radius:10px;outline:none;white-space:pre}
.mdt-lab{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted, currentColor)}
.mdt-btn{padding:5px 11px;font:inherit;font-size:12px;color:inherit;border:1px solid var(--border, currentColor);border-radius:9px;background:var(--bg-card);cursor:pointer;white-space:nowrap}
.mdt-btn:hover:not(:disabled){background:var(--accent-light)}
.mdt-btn:disabled{opacity:.55;cursor:default}
.mdt-ops{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.mdt-grp{display:flex;gap:3px;align-items:center;padding:2px 5px;border:1px solid var(--border, currentColor);border-radius:10px}
.mdt-glab{font-size:10.5px;color:var(--text-muted, currentColor);padding:0 3px;white-space:nowrap}
.mdt-ob{min-width:26px;height:24px;padding:0 6px;font:inherit;font-size:12.5px;line-height:1;color:inherit;background:transparent;border:1px solid transparent;border-radius:7px;cursor:pointer}
.mdt-ob:hover:not(:disabled){background:var(--accent-light);border-color:var(--border, currentColor)}
.mdt-ob:disabled{opacity:.55;cursor:default}
.mdt-layer{position:fixed;inset:0;pointer-events:none;z-index:60}
.mdt-bar{position:fixed;left:0;top:0;display:none;gap:8px;align-items:center;pointer-events:auto;padding:4px 7px;border:1px solid var(--border, currentColor);border-radius:12px;background:var(--bg-glass);background:var(--bg-card);box-shadow:var(--card-shadow);color:inherit;font-size:13px;max-width:min(96vw,760px);overflow-x:auto}
`

// ── 小工具:一切用户内容只经 textContent(全文件零 HTML 字符串注入面) ──────────
function h(tag, cls, text) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (text != null) el.textContent = text
  return el
}
function mkBtn(label, cls, onClick, title) {
  const b = h('button', 'mdt-btn' + (cls ? ' ' + cls : ''), label)
  b.setAttribute('type', 'button')
  if (title) { b.title = title; b.setAttribute('aria-label', title) }
  if (onClick) b.addEventListener('click', onClick)
  return b
}

// 五组按钮,顺序钉死。字形是 unicode 符号不是 emoji。
const OP_GROUPS = [
  { label: 'grpRow', items: [['rowUp', '↑'], ['rowDown', '↓'], ['rowAbove', '＋↑'], ['rowBelow', '＋↓'], ['rowDel', '✕']] },
  { label: 'grpCol', items: [['colLeft', '←'], ['colRight', '→'], ['colBefore', '＋←'], ['colAfter', '＋→'], ['colDel', '✕']] },
  { label: 'grpSort', items: [['sortAsc', '↑A'], ['sortDesc', '↓A']] },
  { label: 'grpAlign', items: [['alignL', '⇤'], ['alignC', '⇔'], ['alignR', '⇥'], ['alignNone', '⌫']] },
  { label: 'grpSrc', items: [['copySrc', '⧉']] },
]

/**
 * 工具条与视图展开区共用的按钮排。
 * opts = { disabled, why, alwaysOn: string[], onOp(op) }
 */
function renderOps(container, opts) {
  const o = opts || {}
  const disabled = !!o.disabled
  const alwaysOn = o.alwaysOn || []
  const onOp = o.onOp || runAction
  for (let g = 0; g < OP_GROUPS.length; g++) {
    const grp = h('div', 'mdt-grp')
    grp.appendChild(h('span', 'mdt-glab', t(OP_GROUPS[g].label)))
    const items = OP_GROUPS[g].items
    for (let i = 0; i < items.length; i++) {
      const key = items[i][0]
      const glyph = items[i][1]
      const off = disabled && alwaysOn.indexOf(key) < 0
      const b = h('button', 'mdt-ob', glyph)
      b.setAttribute('type', 'button')
      b.setAttribute('data-op', key)
      b.title = off && o.why ? t(key) + ' — ' + t(o.why) : t(key)
      b.setAttribute('aria-label', b.title)
      if (off) b.disabled = true
      else {
        // ⚠️mousedown 上 preventDefault 保住编辑器选区;动作挂 click。
        // 绝不在 pointerdown 上 preventDefault —— 那样浏览器就不补发 mousedown/click,按钮当场点不动。
        b.addEventListener('mousedown', (e) => { if (e && e.preventDefault) e.preventDefault() })
        b.addEventListener('click', () => { onOp(key) })
      }
      grp.appendChild(b)
    }
    container.appendChild(grp)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 编辑器扩展:两个 Plugin,**都只有 view() 生命周期** —— 没有 handleKeyDown /
// handleTextInput / handleDOMEvents,于是「不抢任何键」是 check 可断言的形状。
// 工具条不用 decoration:widget decoration 住在 PM 的 DOM 子树里传送不出去,
// 画布的 transform 一来必被平移缩放。走「传送到最近的 .am-app + fixed 定位」这条。
// ════════════════════════════════════════════════════════════════════════════

let layerRoot = null   // .mdt-layer,fixed 满屏、pointer-events:none 的层根
let barEl = null       // .mdt-bar,setup 闭包里的**单例**(一篇 v3 是几十个编辑器)
let barOwner = null    // 谁的选区在表里谁占
let barLocale = ''     // 工具条内容是用哪种语言画的
const cleanups = new Set()

/** 登记一份「必须收干净」的清理动作;返回的函数执行一次后自动销号。 */
function track(fn) {
  const wrapped = () => {
    if (!cleanups.has(wrapped)) return
    cleanups.delete(wrapped)
    try { fn() } catch (_) { /* 清理不许连坐 */ }
  }
  cleanups.add(wrapped)
  return wrapped
}

function fallbackHost() {
  try { return document.body || null } catch (_) { return null }
}
function ensureLayer(host) {
  const target = host || fallbackHost()
  if (!target) return null
  if (!layerRoot) {
    layerRoot = h('div', 'mdt-layer')
    const st = h('style')
    st.textContent = STYLE
    layerRoot.appendChild(st)
  }
  if (layerRoot.parentElement !== target) {
    if (layerRoot.parentElement && layerRoot.remove) layerRoot.remove()
    target.appendChild(layerRoot)
  }
  return layerRoot
}
function ensureBar(layer) {
  if (!barEl) {
    barEl = h('div', 'mdt-bar')
    barEl.setAttribute('role', 'toolbar')
  }
  if (barEl.parentElement !== layer) {
    if (barEl.parentElement && barEl.remove) barEl.remove()
    layer.appendChild(barEl)
  }
  const loc = L()
  if (barLocale !== loc) {
    barLocale = loc
    barEl.textContent = ''
    renderOps(barEl, { disabled: false })
  }
  return barEl
}
function hideBar(v) {
  if (v && barOwner && barOwner !== v) return
  barOwner = null
  if (barEl) barEl.style.display = 'none'
}
function positionBar(v, hit) {
  let box = null
  try { box = v.coordsAtPos(hit.pos + 1) } catch (_) { box = null }
  if (!box) { barEl.style.display = 'none'; return }
  barEl.style.display = 'flex'
  const bw = barEl.offsetWidth || 0
  const bh = barEl.offsetHeight || 0
  const vw = globalThis.window && window.innerWidth ? window.innerWidth : 1280
  let left = Math.min(box.left, Math.max(8, vw - bw - 8))
  if (!(left >= 8)) left = 8
  let top = box.top - bh - 6
  if (!(top >= 8)) top = (box.bottom != null ? box.bottom : box.top) + 6
  barEl.style.left = Math.round(left) + 'px'
  barEl.style.top = Math.round(top) + 'px'
}
function syncBar(v) {
  if (!boolSetting('barEnabled', true)) { hideBar(v); return }
  let focused = true
  try { focused = v.hasFocus ? v.hasFocus() : true } catch (_) { focused = true }
  if (!focused && barOwner !== v) { hideBar(v); return }
  const hit = findTableAt(v.state)
  if (!hit || !isSimpleGfmTable(hit.node)) { hideBar(v); return }
  const host = v.dom && v.dom.closest ? (v.dom.closest('.am-app') || fallbackHost()) : fallbackHost()
  const layer = ensureLayer(host)
  if (!layer) return
  barOwner = v
  ensureBar(layer)
  positionBar(v, hit)
}

function makeBarPlugin(pm) {
  return new pm.Plugin({
    key: new pm.PluginKey('MD_TABLES_BAR'),
    view: (v) => {
      const onWin = () => { if (barOwner === v) syncBar(v) }
      let offWin = () => {}
      try {
        window.addEventListener('scroll', onWin, { capture: true, passive: true })
        window.addEventListener('resize', onWin)
        offWin = track(() => {
          window.removeEventListener('scroll', onWin, { capture: true })
          window.removeEventListener('resize', onWin)
        })
      } catch (_) { /* 没有 window(node 自检)= 无需摘 */ }
      return {
        update: () => { syncBar(v) },
        destroy: () => {
          offWin()
          if (barOwner === v) hideBar(v)
        },
      }
    },
  })
}

function makeTrackPlugin(pm) {
  return new pm.Plugin({
    key: new pm.PluginKey('MD_TABLES_TRACK'),
    view: (v) => {
      const onFocus = () => { lastView = v }
      try { if (v.hasFocus && v.hasFocus()) lastView = v } catch (_) { /* 形态异常 */ }
      let offDom = () => {}
      try {
        v.dom.addEventListener('focus', onFocus, true)
        offDom = track(() => { v.dom.removeEventListener('focus', onFocus, true) })
      } catch (_) { /* 没有 dom = 没什么可摘 */ }
      if (!lastView) lastView = v
      return {
        update: () => { bumpDocGen() },
        // ⚠️销毁必须销号:一篇 v3 有几十个编辑器,切页销毁是常态;拿着死 view 派事务会抛。
        destroy: () => {
          offDom()
          if (lastView === v) lastView = null
        },
      }
    },
  })
}

// ── 活 doc 变更节流(120ms,setTimeout 自排程 —— 全文件没有周期定时器) ──────────
const docSubs = new Set()
let docTimer = null
function bumpDocGen() {
  if (docTimer) return
  docTimer = setTimeout(() => {
    docTimer = null
    const subs = Array.from(docSubs)
    for (let i = 0; i < subs.length; i++) {
      try { subs[i]() } catch (_) { /* 一个视图挂了不连坐别的 */ }
    }
  }, 120)
}

// ════════════════════════════════════════════════════════════════════════════
// 视图 tables
// ════════════════════════════════════════════════════════════════════════════

let pendingSelectPos = null   // 「格式化」命令顺手在视图里选中那张表

/** 相位判定:先判相位,再决定给不给操作按钮。 */
function readPhase() {
  let pg = null
  try { pg = ctx.app && ctx.app.getPage ? ctx.app.getPage() : null } catch (_) { pg = null }
  if (!pg || !pg.path) return { phase: 'nopage', items: [] }
  const model = pg.model ? pg.model : 'blocks'
  // 新老宿主通吃:v4 正文在 page.text,v3 才按块 id 拼
  const text = pg.text != null ? pg.text : (pg.order || []).map((id) => (pg.blocks || {})[id] || '').join('\n\n')
  const view = liveView()
  if (view && model !== 'blocks') {
    const live = collectDocTables(view)
    if (live) return { phase: 'A', items: live, view: view }
  }
  if (model === 'blocks') {
    const out = []
    const order = pg.order || []
    for (let i = 0; i < order.length; i++) {
      const id = order[i]
      const found = findTablesInText((pg.blocks || {})[id] || '')
      for (let k = 0; k < found.length; k++) {
        out.push({
          header: found[k].header, rows: found[k].rows, cols: found[k].cols,
          src: found[k].src, simple: true, blockId: id,
        })
      }
    }
    return { phase: 'B', items: out }
  }
  const found = findTablesInText(text)
  return {
    phase: 'C',
    items: found.map((f) => ({ header: f.header, rows: f.rows, cols: f.cols, src: f.src, simple: true, line: f.line })),
  }
}

/** 遍历活 doc 收表(权威源,带位置)。doc 形态异常 → null,调用方降级到文本相位。 */
function collectDocTables(view) {
  const out = []
  try {
    const doc = view.state.doc
    if (!doc || typeof doc.descendants !== 'function') return null
    doc.descendants((node, pos) => {
      if (node && node.type && node.type.name === 'table') {
        const simple = isSimpleGfmTable(node)
        const tb = simple ? tableToTable(node) : null
        out.push({
          node: node, pos: pos, simple: simple,
          header: tb ? tb.header : [],
          rows: tb ? tb.rows.length : 0,
          cols: tb ? tb.header.length : 0,
          src: tb ? serializeTable(tb, { pad: true }) : '',
        })
        return false
      }
      return true
    })
  } catch (_) { return null }
  return out
}

function headerPreview(header) {
  const cells = header || []
  const shown = []
  for (let i = 0; i < Math.min(4, cells.length); i++) {
    const s = String(cells[i] == null ? '' : cells[i]).trim()
    shown.push(s === '' ? t('untitledCol', { i: i + 1 }) : s)
  }
  let out = shown.join(t('sep'))
  if (cells.length > 4) out += t('more')
  return out
}
const itemKey = (it, idx) => idx + '|' + (it.header || []).join('')

function mountTables(el) {
  el.textContent = ''
  const styleEl = h('style')
  styleEl.textContent = STYLE
  el.appendChild(styleEl)
  const root = h('div', 'mdt-root')
  el.appendChild(root)

  const ui = { selKey: null, srcScroll: 0, listScroll: 0 }
  let srcArea = null

  const snapshot = () => {
    try {
      ui.srcScroll = srcArea ? srcArea.scrollTop || 0 : ui.srcScroll
      ui.listScroll = root.scrollTop || 0
    } catch (_) { /* 垫片里没有滚动 */ }
  }

  const jumpTo = (it) => {
    if (it.node != null && it.pos != null) {
      const view = liveView()
      if (!view) { notify(t('noView'), 'warning'); return false }
      try {
        const p = cellStart(it.node, it.pos, 0, 0)
        let tr = view.state.tr
        if (pmKit && pmKit.TextSelection) {
          const size = tr.doc && tr.doc.content ? tr.doc.content.size : p
          tr = tr.setSelection(pmKit.TextSelection.near(tr.doc.resolve(Math.min(p, size))))
        }
        if (tr.scrollIntoView) tr.scrollIntoView()
        view.dispatch(tr)
        if (view.focus) view.focus()
        return true
      } catch (_) {
        notify(t('insertFailed'), 'warning')
        return false
      }
    }
    if (it.blockId) {
      try {
        if (ctx.app && ctx.app.requestFocus) { ctx.app.requestFocus(it.blockId, 'start'); return true }
      } catch (_) { /* 旧宿主 */ }
    }
    notify(t('noView'), 'warning')
    return false
  }

  const render = () => {
    snapshot()
    root.textContent = ''
    srcArea = null
    const wrap = h('div', 'mdt-wrap')
    root.appendChild(wrap)

    const state = readPhase()
    const items = state.items || []

    // 「格式化」命令顺手认领选中项
    if (pendingSelectPos != null) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].pos === pendingSelectPos) { ui.selKey = itemKey(items[i], i); break }
      }
      pendingSelectPos = null
    }

    const head = h('div', 'mdt-head')
    head.appendChild(h('div', 'mdt-title', t('viewTitle')))
    head.appendChild(h('span', 'mdt-count', t('tablesCount', { n: items.length })))
    head.appendChild(h('div', 'mdt-flex1'))
    head.appendChild(mkBtn(t('refresh'), '', () => { render() }, t('refresh')))
    wrap.appendChild(head)

    if (!hostHasEditorExt) wrap.appendChild(h('div', 'mdt-note', t('noHost')))
    if (state.phase === 'B') wrap.appendChild(h('div', 'mdt-note', t('v3Limited')))
    if (state.phase === 'C') wrap.appendChild(h('div', 'mdt-note', t('readonlyHint')))

    if (state.phase === 'nopage') {
      const em = h('div', 'mdt-empty')
      em.appendChild(h('b', '', t('viewTitle')))
      em.appendChild(h('div', '', t('noPage')))
      wrap.appendChild(em)
      return
    }
    if (!items.length) {
      const em = h('div', 'mdt-empty')
      em.appendChild(h('b', '', t('empty')))
      em.appendChild(h('div', '', t('noPage')))
      wrap.appendChild(em)
      return
    }

    // 认领选中项:认不回来就落到无选中态,绝不静默选到别的表上
    let selIdx = -1
    for (let i = 0; i < items.length; i++) {
      if (itemKey(items[i], i) === ui.selKey) { selIdx = i; break }
    }
    if (selIdx < 0) ui.selKey = null

    const list = h('div', 'mdt-list')
    wrap.appendChild(list)
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const key = itemKey(it, i)
      const card = h('div', 'mdt-item' + (i === selIdx ? ' sel' : '') + (it.simple ? '' : ' bad'))
      const line = h('div', 'mdt-line')
      line.setAttribute('role', 'button')
      line.appendChild(h('span', 'mdt-idx', t('tableLabel', { n: i + 1 })))
      line.appendChild(h('span', 'mdt-prev', headerPreview(it.header)))
      line.appendChild(h('span', 'mdt-size', t('size', { c: it.cols, r: it.rows })))
      line.title = t('jump')
      line.addEventListener('click', () => {
        snapshot()
        ui.selKey = ui.selKey === key ? null : key
        if (ui.selKey) jumpTo(it)
        render()
      })
      card.appendChild(line)

      if (i === selIdx) {
        const exp = h('div', 'mdt-exp')
        if (!it.simple) {
          exp.appendChild(h('div', 'mdt-note', t('notSimple')))
        } else {
          const ops = h('div', 'mdt-ops')
          // ⚠️ 展开区的行/列/排序/对齐按钮**一律 disabled**(评审 Finding 2)。
          //    它们以前先 `jumpTo(it)`,而 jumpTo 写死 `cellStart(it.node, it.pos, 0, 0)` ——
          //    恒定把光标钉到**表头行第一格**,于是行组三个键永远弹「表头行不能删除」、
          //    `←` 永远弹「已经在最左边」、而「删除这一列」一声不吭删掉整张表的**第 1 列**
          //    (不是用户那一列)。清单视图的职责是跳转与复制源码,行列操作走表格上方的工具条。
          renderOps(ops, {
            disabled: true,
            why: state.phase === 'B' ? 'v3Limited' : 'listJumpHint',
            alwaysOn: ['copySrc'],
            onOp: (op) => {
              if (op === 'copySrc') { void copySource(it.src); return }
              // 跳过去就好 —— 操作在表格上方的工具条上做
              jumpTo(it)
            },
          })
          exp.appendChild(ops)
          exp.appendChild(h('div', 'mdt-lab', t('copySrcTitle')))
          const ta = h('textarea', 'mdt-ta')
          ta.setAttribute('readonly', 'readonly')
          ta.setAttribute('spellcheck', 'false')
          ta.textContent = it.src || ''   // 先设默认值(真 DOM 里 textarea 的内容),再设 value
          ta.value = it.src || ''
          srcArea = ta
          exp.appendChild(ta)
          const bar = h('div', 'mdt-ops')
          bar.appendChild(mkBtn(t('copySrc'), '', () => { void copySource(it.src) }, t('copySrc')))
          exp.appendChild(bar)
        }
        card.appendChild(exp)
      }
      list.appendChild(card)
    }

    try {
      if (srcArea && ui.srcScroll) srcArea.scrollTop = ui.srcScroll
      if (ui.listScroll) root.scrollTop = ui.listScroll
    } catch (_) { /* 垫片里没有滚动 */ }
  }

  render()

  const onDoc = () => { render() }
  docSubs.add(onDoc)
  let offPage = null
  try {
    if (ctx.app && ctx.app.subscribePage) offPage = ctx.app.subscribePage(() => { render() })
  } catch (_) { offPage = null }
  let offLocale = null
  try {
    if (ctx.subscribeLocale) offLocale = ctx.subscribeLocale(() => { render() })
  } catch (_) { offLocale = null }

  const dispose = track(() => {
    docSubs.delete(onDoc)
    if (offPage) { try { offPage() } catch (_) { /* 宿主也会兜底 */ } }
    if (offLocale) { try { offLocale() } catch (_) { /* 同上 */ } }
  })
  return dispose
}

// ════════════════════════════════════════════════════════════════════════════
// 贡献点注册
// ════════════════════════════════════════════════════════════════════════════

let hostHasEditorExt = false
try {
  if (ctx.registerEditorExtension) {
    hostHasEditorExt = true
    ctx.registerEditorExtension((pm) => {
      pmKit = pm
      return [makeBarPlugin(pm), makeTrackPlugin(pm)]
    }, { priority: 'normal' })
  }
} catch (_) { hostHasEditorExt = false }
if (!hostHasEditorExt) notify(t('noHost'), 'info')

ctx.registerView({ id: 'tables', title: t('viewTitle'), mount: mountTables, singleton: true })

const openTables = () => {
  try { ctx.openView('tables') } catch (_) { /* 无工作台的宿主(独立笔记 app) */ }
}

async function cmdFormat() {
  const cur = currentHit(false)
  if (!cur) return
  const src = serializeTable(tableToTable(cur.hit.node), { pad: true })
  pendingSelectPos = cur.hit.pos
  openTables()
  await copySource(src)
  logActivity('format')
}

ctx.registerCommand({ id: 'md-tables-open', title: t('cmdOpen'), keywords: CMD_KEYWORDS, run: () => { openTables() } })
ctx.registerCommand({ id: 'md-tables-format', title: t('cmdFormat'), keywords: CMD_KEYWORDS, run: () => { void cmdFormat() } })
ctx.registerCommand({ id: 'md-tables-row-insert', title: t('cmdRowInsert'), keywords: CMD_KEYWORDS, run: () => { runAction('rowBelow') } })
ctx.registerCommand({ id: 'md-tables-col-insert', title: t('cmdColInsert'), keywords: CMD_KEYWORDS, run: () => { runAction('colAfter') } })
// 命令面板恒升序:降序在工具条/视图上(命令面板要可预测,不做隐式 toggle)
ctx.registerCommand({ id: 'md-tables-sort', title: t('cmdSort'), keywords: CMD_KEYWORDS, run: () => { runAction('sortAsc') } })

ctx.registerSlashItem({
  id: 'md-tables-insert',
  label: t('slashLabel'),
  hint: t('slashHint'),
  icon: 'table',
  keywords: 'table 表格 biaoge 表 grid',
  // ⚠️**只 return**,宿主负责插。在这里再插一次 = 表格插两遍。
  // 返回的 md 是 canonical(不补空格)形态 —— 补过空格的表插进去立刻被宿主重新序列化。
  run: async () => {
    const r0 = numSetting('scaffoldRows', 3, 1, 50)
    const c0 = numSetting('scaffoldCols', 3, 1, 20)
    let raw = r0 + 'x' + c0
    try {
      // Electron 没有 window.prompt,永远走 ctx.app.prompt
      if (ctx.app && ctx.app.prompt) raw = await ctx.app.prompt(t('promptTitle'), r0 + 'x' + c0, { label: t('promptLabel') })
    } catch (_) { raw = null }
    if (raw == null) return ''                       // 用户取消 → 什么都不插
    const size = parseSize(raw)
    if (!size) { notify(t('badSize'), 'warning'); return '' }
    logActivity('scaffold', { rows: size.rows, cols: size.cols })
    return scaffoldTable(size.rows, size.cols)
  },
})

ctx.registerSetting({ key: 'barEnabled', type: 'boolean', default: true, label: t('setBar') })
ctx.registerSetting({ key: 'scaffoldRows', type: 'number', default: 3, min: 1, max: 50, label: t('setRows') })
ctx.registerSetting({ key: 'scaffoldCols', type: 'number', default: 3, min: 1, max: 20, label: t('setCols') })

// ── check.mjs 测试钩子 ──────────────────────────────────────────────────────
// rebuildRows / rebuildCols 的签名是 (schema, tableNode, plan) —— duck-typed,
// check 造假 schema/节点即可,不引 ProseMirror。
if (globalThis.__MD_TABLES_TEST__) {
  Object.assign(globalThis.__MD_TABLES_TEST__, {
    cellWidth, escapeCell, unescapeCell, splitCellsRaw, rowCells,
    parseTable, serializeTable, formatTable, minSepWidth, alignToken, applyAlign,
    scaffoldTable, parseSize, findTablesInText,
    planRow, planCol, planSort, planSeq, numOf, isNumericColumn,
    isSimpleGfmTable, cellStart, newCell, newHeader, rebuildRows, rebuildCols,
    findTableAt, tableToTable, runAction, currentHit, readPhase, headerPreview, cellText,
    copyText, MSG, L, t, boolSetting, numSetting,
    setLastView: (v) => { lastView = v },
    getLastView: () => lastView,
    getBar: () => barEl,
    getLayer: () => layerRoot,
    setPmKit: (k) => { pmKit = k },
  })
}

// 工具条也要跟随语言(评审 Finding 4):`barLocale` 的换语言重画只在 ensureBar 里判,
// 而 ensureBar 只被 syncBar 调、syncBar 只被编辑器 update/scroll/resize 触发 ——
// 于是切了语言之后工具条上 17 个按钮的 title 还是旧语言,直到用户再动一下光标。
if (ctx.subscribeLocale) {
  const offBarLocale = ctx.subscribeLocale(() => { try { if (barOwner) syncBar(barOwner) } catch (_) { /* ignore */ } })
  track(() => { try { offBarLocale() } catch (_) { /* ignore */ } })
}

return () => {
  try {
    if (docTimer) clearTimeout(docTimer)
  } catch (_) { /* node 垫片 */ }
  docTimer = null
  const list = Array.from(cleanups)
  for (let i = 0; i < list.length; i++) {
    try { list[i]() } catch (_) { /* 一个清理失败不挡别的 */ }
  }
  cleanups.clear()
  docSubs.clear()
  try {
    if (barEl && barEl.remove) barEl.remove()
  } catch (_) { /* 已经不在树上 */ }
  try {
    if (layerRoot && layerRoot.remove) layerRoot.remove()
  } catch (_) { /* 同上 */ }
  barEl = null
  layerRoot = null
  barOwner = null
  barLocale = ''
  lastView = null
  pmKit = null
  pendingSelectPos = null
}
