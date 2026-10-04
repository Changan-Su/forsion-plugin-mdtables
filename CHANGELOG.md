# 更新日志

## 1.0.2 — 2026-10-04

- Space 图标换成插件自己的图标,不再和别的插件共用图标库里的同一枚(`space.json` 的 `iconFile`)。需要支持 Space 自绘图标的 Forsion(2.12.2 之后的版本);更早的版本照旧显示原来的图标。配方版本不变,已保存的布局不受影响。
- **English:** The Space now shows the plugin's own icon instead of a shared library icon (`iconFile` in `space.json`). Needs a Forsion version that supports custom Space icons (later than 2.12.2); earlier versions keep the previous icon. The recipe version is unchanged, so saved layouts are not affected.

## 1.0.1 — 2026-08-21

对抗评审修复轮(报告见 `Forsion-Instrumentality-Project/20260821/REVIEW-mdtables.md`)。发布前修,未上过用户机器。
评审结论:**写路径面是干净的** —— 五个命令 + 工具条 17 个键 + 斜杠项全打一遍,
`writeFile` / `insertMarkdown` / `readFile` / 块寻址 四口调用数全 0,结构操作全走 PM 事务;
三条 P0 模板与 v4 三条硬规矩逐条对照无违反。缺陷集中在**输出面**与**清单视图**两块局部。

- **[P1] 修「格式化 / 复制对齐源码」把行内格式全吃掉**:`cellText` 取的是 `cell.textContent`,
  于是产出的源码里粗体星号、**链接 URL**、行内代码反引号、删除线、行内公式、`<br>` 全没了 ——
  用户粘到 GitHub 上以为只是排版变整齐,实际链接全断。而 README、SPEC §6.0、onboarding 第 4 步
  三处都承诺「`<br>` / `**粗体**` / 链接原样保留」。现在换成「节点 → 行内 markdown」的序列化器:
  按 marks 拼回 `**` / `*` / `` ` `` / `~~` / `[text](href)`,原子节点(行内 HTML / 公式)取 `attrs.value`,
  硬换行出 `<br>`;结构认不出时退回纯文本兜底,别把格子弄空。
  ⚠️`check.mjs` 的假 schema 里 `textContent` 就是原始字符串,**从原理上测不出 mark 丢失** ——
  这也是这条能躲过 25 组断言的原因;新回归用带 marks 的假节点直接打 `cellText`。
- **[P1] 修清单视图展开区的按钮:4 个永远失败、`删除这一列` 永远删第 1 列**。展开区的 `onOp`
  先 `jumpTo(it)`,而 `jumpTo` 写死 `cellStart(it.node, it.pos, 0, 0)` —— **恒定把光标钉到表头行第一格**,
  于是行组三个键每次都弹「表头行不能删除,也不能移动」、`←` 每次都弹「已经在最左边一列了」,
  而「删除这一列」一声不吭删掉整张表的**第 1 列**(不是用户所在那一列)。
  清单视图的职责本来就是**跳转与复制源码**(相位 B 的文案已经这么写了),现在相位 A 也一律
  `disabled`,只留「复制源码」,点一下把光标跳过去,行列操作走表格上方的工具条。
  ⚠️这条的旧断言钉的是「17 个全开」= **把 4 个死键 + 1 个删错目标的键当成了期望值**。
- **[P2] 工具条跟随语言**:`barLocale` 的换语言重画只在 `ensureBar` 里判,而 `ensureBar` 只被
  `syncBar` 调、`syncBar` 只被编辑器 update/scroll/resize 触发 —— 切了语言之后工具条上 17 个按钮的
  title 还是旧语言,要等用户再动一下光标。现在 setup 顶层也订一次 `subscribeLocale`(退订进 `track`)。
- check.mjs 补 R-F1 一组回归并翻正两条写反方向的断言,两条变异验证当场变红。

### 已知未修(记台账,见 REVIEW-mdtables.md Finding 3/5)

- 引用块 `>` 里的表:只读快照通道看不见、活文档通道看得见 → 同一篇笔记点一下正文前后清单条数会跳。
- 清单空态同时显示「这篇笔记里还没有表格」与「还没有打开的笔记」两句互相打架的话
  (`empty` 分支复用了 `noPage` 当副标题)。

## 1.0.0 — 2026-08-21

首个版本。

- **浮动工具条**:光标进表格即出现,五组按钮(行 / 列 / 排序 / 对齐 / 源码)。挂在 `.am-app` 下而非编辑器装饰,不受画布 `transform` 影响。
- **行列操作**:上下左右移动、四向插入、删除。表头不可删不可移,到边界提示而非静默失败。每个动作一个编辑器事务。
- **排序**:按光标所在列,数字列走数值(认千分位与百分号),否则中文拼音;空格子沉底,稳定排序。
- **对齐**:整列 左 / 中 / 右 / 默认。
- **格式化**:产出 CJK 宽 2 的对齐源码到剪贴板(**不改落盘形态** —— 那由宿主序列化器独占,见 README)。
- **清单视图**:鸟瞰当前笔记里的所有表格,点击跳转并展开。
- **斜杠项**:`/` 插入表格,支持 `3x4` 尺寸输入。
- 中英双语,跟随宿主语言实时切换。零产物文件、零网络。
