// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = path.join(root, 'packages/core/vendor/codeburn')
const readJson = async (filename) => JSON.parse(await fs.readFile(filename, 'utf8'))
const [snapshot, registry, tests, local, validation] = await Promise.all([
  readJson(path.join(base, 'snapshot.json')),
  readJson(path.join(base, 'providers.json')),
  readJson(path.join(root, 'reports/codeburn-upstream-tests.json')),
  readJson(path.join(root, 'reports/codeburn-local-audit.json')),
  readJson(path.join(root, 'reports/codeburn-validation.json')),
])
const checks = await Promise.all(
  Object.entries(snapshot.files).map(async ([filename, expected]) => ({
    filename,
    match:
      createHash('sha256')
        .update(await fs.readFile(path.join(base, filename)))
        .digest('hex') === expected,
  })),
)
if (
  checks.some((check) => !check.match) ||
  !tests.success ||
  !validation.success ||
  registry.length !== 43
)
  throw new Error('Report requires passing source fingerprints, upstream tests and Lumi checks')
const e = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
const n = (value) => Number(value ?? 0).toLocaleString('en-US')
const clean = (text) =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
const section = (text, heading) => {
  const start = text.toLowerCase().indexOf(`## ${heading}`.toLowerCase())
  if (start < 0) return ''
  return text
    .slice(start + heading.length + 4)
    .split(/\n## /)[0]
    .trim()
}
const statuses = {
  ready: '本机有记录',
  empty: '本机来源存在，暂无记录',
  absent: '本机未发现',
  partial: '本机部分读取',
  denied: '无读取权限',
  incompatible: '读取失败',
  missing_usage: '缺少计数',
}
const byId = new Map(local.rows.map((row) => [row.provider, row]))
const sourceUrl = (file) => `${snapshot.repository}/blob/${snapshot.commit}/${file}`
const summaries = {
  claude:
    'Claude Code / Desktop / Cowork；完整 JSONL 与 usage-ledger，流式去重及 advisor 独立计数。',
  cline: 'Cline 扩展及主目录任务；读取 UI 事件里的 API 用量，历史消息补充模型信息。',
  'cline-cli': 'CLI 会话 JSON 与逐消息文件；优先逐条用量，汇总回退，避免重复累加。',
  codewhale: '当前及旧版会话 JSON；按来源和会话身份选择有效记录。',
  codebuff: '消息 JSON 数组；读取直接 usage 或嵌套 runState，credits 只作为费用信息。',
  codex: '活动及归档 JSONL；累计差分、恢复与分叉去重，优先读取实际用量记录。',
  copilot: 'VS Code / CLI 日志、OTel 与 session-store；逐条调用与汇总对账，防止重复累计。',
  devin: '优先 SQLite；不可用时读取导出轨迹 JSON，并避免与数据库重复。',
  droid: 'Factory 会话 JSONL；提取模型及 assistant 用量，按消息身份去重。',
  dsh: '多代 JSONL / zstd；按会话选择最高可识别格式，标记不完整计数。',
  gemini: 'JSON 或 JSONL；输入扣除缓存子集，单独保留思考用量并按规则合并到输出。',
  hermes: 'SQLite 会话累计计数与消息记录；使用观察增量账本，避免重读和修剪造成重复。',
  'ibm-bob': 'IBM Bob / Bob-IDE 的 Cline 系任务格式；从 api_req_started 读取计数。',
  'kilo-code': '扩展任务文件；复用 Cline 格式解析器及请求索引去重。',
  kiro: '多代 IDE / CLI 会话及执行文件；有计数时使用计数，估算路径保留来源标记。',
  kimi: '会话 wire.jsonl 的 StatusUpdate.token_usage；主代理与子代理记录分别处理。',
  kimicode: '每代理 wire.jsonl 的 usage.record；将 inputOther、cache、output 映射到各自桶。',
  'lingtai-tui': 'JSONL Token 账本；按来源标识、行位置及计数去重，不重复扫描镜像守护进程账本。',
  'mistral-vibe': '兼容旧版目录与统一日志；累计计数按上游规则转换为增量。',
  mux: '主代理与子代理 chat.jsonl；读取 metadata.usage，并按消息 ID 去重。',
  openclaw: '兼容 JSONL 与 SQLite transcript_events；相同事件跨存储代际去重。',
  openclaude: 'Claude 分叉的 JSONL；只读取带 message.usage 的 assistant 事件，保留估算标记。',
  'open-design': '运行 events.jsonl；读取 usage 事件与最近的模型元数据。',
  pi: '会话 JSONL；优先 responseId，缺失时按时间或行位置去重。',
  omp: '与 Pi 同格式；分别发现主代理与嵌套代理会话。',
  qwen: '项目聊天 JSONL；读取 assistant 用量，按会话与事件 UUID 去重。',
  quickdesk: 'JSONL 指标和历史数据库；逐条指标优先，数据库回退保留估算标记。',
  zerostack: '每会话 JSON；读取 estimated_tokens 并保留估算属性。',
  grok: '会话 summary、signals 与 updates；区分逐轮实报用量和上下文估算路径。',
  grokbot: 'Electron 本地持久化切片；从 transcript replicas 的请求记录提取用量。',
  amp: '优先 usageLedger，按 toMessageId 关联缓存；无账本时回退 assistant usage。',
  'command-code': '会话格式 v3 JSONL；只发现会话本体，跳过 checkpoints / prompts 等 sidecar。',
  antigravity: 'SQLite / protobuf、本地 language-server RPC 与状态行回退；依上游优先级去重。',
  forge: 'SQLite conversations；解析 context.messages 中的用量。',
  goose: 'SQLite sessions；按会话读取计数和模型。',
  cursor: 'SQLite bubbles、agentKv 等记录；真实计数优先，回退估算保留标记。',
  opencode: '兼容旧 JSON 文件与两代 SQLite 表；按会话与消息 ID 跨格式去重。',
  'cursor-agent': '转录 JSONL / 文本，以及无转录会话的本地 SQLite；存在转录时不再扫描相同 store。',
  crush: '全局项目注册表 + 每项目 SQLite；读取会话计数。',
  warp: 'SQLite 对话与交换；逐交换去重，保留上游的估算路径。',
  'vercel-gateway': '官方 report API；按 UTC 日 / 模型汇总，需要已有授权，独立于本地总量。',
  zcode: 'CLI SQLite 的 model_usage；逐请求行读取输入、输出、推理与缓存。',
  zed: 'SQLite threads 中的 JSON / zstd JSON；逐请求用量与累计剩余量按上游对账。',
}
let matrix = ''
for (const provider of registry) {
  let doc = ''
  try {
    doc = await fs.readFile(path.join(base, 'provider-docs', provider.name + '.md'), 'utf8')
  } catch {
    /* Registry remains authoritative if a provider has no documentation. */
  }
  const source =
    /\*\*Source:\*\*\s*`([^`]+)`/.exec(doc)?.[1] ??
    `src/providers/${provider.name === 'omp' ? 'pi' : provider.name}.ts`
  const paths =
    section(doc, 'Where it reads from') ||
    section(doc, 'Data location') ||
    section(doc, 'Storage layout') ||
    '读取路径及环境变量见固定提交的实现文件。'
  const format =
    section(doc, 'Storage format') ||
    section(doc, 'Token model') ||
    section(doc, 'Token accounting') ||
    '沿用上游解析与字段识别。'
  const dedup = section(doc, 'Deduplication') || '使用上游来源去重及共享解析层对账。'
  const row = byId.get(provider.name)
  matrix += `<tr><th scope="row">${e(provider.displayName)}<small>${e(provider.name)}${provider.network ? ' · 网关' : ''}</small></th><td>${e(
    (
      [...paths.matchAll(/`([^`]+)`/g)]
        .map((match) => match[1])
        .filter((value) => /[~/%\\]|_DIR|_HOME/.test(value))
        .slice(0, 8)
        .join(' · ') || clean(paths)
    ).slice(0, 650),
  )}</td><td>${e(summaries[provider.name] ?? clean(format).slice(0, 450))}<details><summary>格式与去重原文</summary>${e(clean(format).slice(0, 450))}<small>${e(clean(dedup).slice(0, 260))}</small></details></td><td><span class="status ${row?.records ? 'ok' : 'muted'}">${e(statuses[row?.state] ?? '未验证')}</span><small>${n(row?.records)} 条记录<br>源码指纹通过 · 格式回归覆盖</small><a href="${sourceUrl(source)}">读取实现 ↗</a></td></tr>`
}
const comparisons = local.rows.filter((row) => row.comparison)
const comparisonRows = comparisons
  .map((row) =>
    ['input', 'output', 'cacheRead', 'cacheWrite', 'total']
      .map(
        (key, index) =>
          `<tr>${index === 0 ? `<th rowspan="5">${e(row.provider)}<small>${n(row.comparison.records)} 条 · 同一解析快照</small></th>` : ''}<td>${e({ input: '未缓存输入', output: '输出（按来源合并推理）', cacheRead: '缓存读取', cacheWrite: '缓存写入', total: '总 Token' }[key])}</td><td class="num">${n(row.comparison.reference[key])}</td><td class="num">${n(row.comparison.lumi[key])}</td><td class="num">${n(row.comparison.lumi[key] - row.comparison.reference[key])}</td></tr>`,
      )
      .join(''),
  )
  .join('')
const [tokens, palette] = await Promise.all(
  ['src/theme/obsidian-solar-amber.css', 'src/theme/palette.css'].map((file) =>
    fs.readFile(path.join(root, file), 'utf8'),
  ),
)
const html = `<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lumi × CodeBurn 用量接入核查报告</title><style>${tokens}\n${palette}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.7 var(--lumi-font-ui)}main{max-width:1280px;margin:auto;padding:40px 28px 70px}h1{font-size:26px;line-height:1.4;margin:8px 0 14px}h2{font-size:18px;margin:0 0 14px}h3{font-size:14px;margin:0 0 8px}p{margin:8px 0 14px}.lead{max-width:85ch;color:var(--secondary)}.brand{color:var(--accent);font-weight:700}.meta,small{font-size:12px;color:var(--secondary)}details{margin-top:8px;font-size:12px;color:var(--secondary)}summary{cursor:pointer;color:var(--accent)}small{display:block;margin-top:5px;overflow-wrap:anywhere}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:24px 0 32px}.summary div{border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:16px}.summary b{display:block;font-size:26px;line-height:1.3;font-variant-numeric:tabular-nums}.summary span{font-size:13px;color:var(--secondary)}section{margin-top:32px;padding:22px;background:var(--panel);border:1px solid var(--line);border-radius:8px}a{color:var(--accent);text-underline-offset:3px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}thead{background:var(--input)}th{font-weight:600}tbody th{min-width:140px}td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.table-wrap{overflow:auto}.matrix{table-layout:fixed;min-width:880px}.matrix th:nth-child(1){width:14%}.matrix th:nth-child(2){width:30%}.matrix th:nth-child(3){width:38%}.matrix th:nth-child(4){width:18%}.status{display:inline-block;padding:3px 7px;border-radius:4px;background:var(--input)}.ok{color:var(--lumi-operational)}.muted{color:var(--secondary)}.note{padding:12px 16px;background:var(--input);border-radius:8px}code{font-family:var(--lumi-font-mono);font-size:12px;overflow-wrap:anywhere}ul,ol{padding-left:22px}li+li{margin-top:8px}.split{display:grid;grid-template-columns:1fr 1fr;gap:24px}footer{margin-top:24px;color:var(--secondary);font-size:12px}@media(max-width:700px){main{padding:24px 16px}.summary{grid-template-columns:1fr 1fr}.split{grid-template-columns:1fr}section{padding:16px}}@media print{body{background:white;color:black}main{padding:0;max-width:none}.summary{margin:16px 0}section{break-inside:auto;padding:14px 0;border:0;border-radius:0}thead{display:table-header-group}tr{break-inside:avoid}.table-wrap{overflow:visible}.matrix{min-width:0}th,td{padding:6px;font-size:10px}small{font-size:10px}a{color:inherit}h2{break-after:avoid}@page{size:A4 landscape;margin:12mm}}
</style></head><body><main><header><div class="brand">Lumi · 工程核对报告</div><h1>AI 用量接入与一致性核查</h1><p class="lead">已把 CodeBurn 的完整来源注册表接入 Lumi：42 款 AI 工具，以及独立统计的 Vercel AI Gateway。读取与解析代码固定到同一上游提交；逐软件格式回归、Lumi 统计边界和本机真实数据分别核查。</p><div class="meta">生成：${e(new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))}（Asia/Shanghai） · 上游 v${e(snapshot.version)} · <a href="${snapshot.repository}/commit/${snapshot.commit}">${snapshot.commit.slice(0, 12)}</a> · MIT</div></header>
<div class="summary"><div><b>43 / 43</b><span>来源注册覆盖（42 工具 + 网关）</span></div><div><b>${n(tests.numPassedTests)}</b><span>上游回归测试通过</span></div><div><b>${n(validation.tests)}</b><span>Lumi 全项目测试通过</span></div><div><b>${comparisons.every((row) => row.comparison.differences.length === 0) ? '0' : '有差异'}</b><span>本机同快照 Token 对照差异</span></div></div>
<section><h2>01 · 核查结论与证据范围</h2><ul><li><b>接入完成：</b>默认采集已从三款软件的原生读取路径切换为固定提交的 CodeBurn 读取管线。所有来源共享 Lumi 的软件 Tab、统计、排行、按会话分页、展开记录与 CSV 导出。</li><li><b>本机实测：</b>${e(
  local.rows
    .filter((row) => row.records)
    .map((row) => `${row.provider} ${n(row.records)} 条`)
    .join('；'),
)}。另有 ${n(local.rows.filter((row) => row.state === 'empty').length)} 个来源目录存在但暂无可用记录。</li><li><b>未安装软件：</b>其注册、上游格式回归与 Lumi 字段转换已验证；本机未发现数据时，不能据此宣称已连接真实软件账户。下表逐项标识。</li><li><b>可复核：</b>${checks.length} 个固定上游文件 SHA-256 指纹全部一致。原始源文件保持不改，适配差异只发生在构建或 Lumi 统计边界。</li></ul><p class="note">“已接入”表示读取能力已实现并进入正式采集流程；“本机有记录”表示本次确实读到了本机数据。这两类证据独立列出。报告不包含会话正文、原始会话 ID、真实会话名称或凭据。</p></section>
<section><h2>02 · 本机同快照聚合对照</h2><p>本节统计本机可读取的全部历史，界面仍按顶部日期范围筛选。先读取上游已经完成去重/对账的会话汇总，再从相同的调用快照生成 Lumi 记录。下列数字分别来自上游会话汇总字段和 Lumi 记录求和。推理按上游规则归入输出，输入为未缓存输入；两边使用同一数据快照，避免扫描期间新增调用造成误差。</p><div class="table-wrap"><table><thead><tr><th>软件</th><th>核查字段</th><th>CodeBurn</th><th>Lumi</th><th>差值</th></tr></thead><tbody>${comparisonRows}</tbody></table></div><small>本机扫描时间：${e(local.createdAt)}。快照之后继续产生的新用量不属于本次对照样本。</small></section>
<section><h2>03 · 全部来源逐项核对</h2><p>“格式回归覆盖”指固定上游测试中的合成/格式样例及 Lumi 全注册表归一化测试，不等同于每款软件均已在本机安装实测。路径、格式及去重说明取自同一固定提交的 provider 文档；读取实现链接也固定到该提交。</p><div class="table-wrap"><table class="matrix"><thead><tr><th>软件 / 来源</th><th>读取位置 / 发现方式</th><th>数据格式与去重口径</th><th>本次验证结果</th></tr></thead><tbody>${matrix}</tbody></table></div></section>
<section><h2>04 · 关键口径与有意保留的差异</h2><div class="table-wrap"><table><thead><tr><th>核查项</th><th>Lumi 实现 / 核对结果</th></tr></thead><tbody>
<tr><th>未缓存输入与缓存</th><td>输入统一为 CodeBurn 的 fresh input，缓存读取和写入单独保存；总量 = 输入 + 输出 + 缓存读 + 缓存写。cachedInputTokens 是缓存读取的别名，禁止再次相加。旧版 Codex 的输入含缓存，所以升级后输入数会变小，应结合缓存卡与总量理解。</td></tr>
<tr><th>推理 Token</th><td>Claude、Codex、Copilot、DSH 的 output 已包含推理，禁止再加；其他来源依照上游 billableOutputTokens 合并。对全部43个注册项逐项运行边界测试。</td></tr>
<tr><th>累计、流式、恢复及多格式</th><td>复用上游 Codex 累计差分/恢复/分叉去重，Claude 流式消息去重与 advisor 计数，Copilot store/逐条调用/shutdown 对账，以及 OpenCode 文件与SQLite来源去重。</td></tr>
<tr><th>估算与缺失字段</th><td>保留上游 isEstimated，界面及CSV有标记。该标记可能仅表示费用估算（如 Amp），不能直接断言 Token 是估算。Lumi 拒绝非有限、负数或非安全整数计数；缺失保持未知，空范围为0。</td></tr>
<tr><th>独立网关</th><td>Vercel Gateway 使用官方 report API，须已有 AI_GATEWAY_API_KEY 或 VERCEL_OIDC_TOKEN 及服务端权限；本机未配置时不发起请求。其记录是按日/模型聚合，不是真实逐会话或逐小时数据；默认从“全部”中排除，单选网关时查看，防止与本地客户端重复。</td></tr>
<tr><th>历史切换与刷新失败</th><td>每软件在成功完整读取后事务替换派生记录，防止新旧ID并存重复。失败保留最后有效数据。网关适配比上游额外把HTTP失败转为采集失败，避免误把失败当作零数据覆盖历史。</td></tr>
<tr><th>名称与隐私</th><td>Codex 仍刷新 session_index + 只读 threads.title；Claude 使用上游 aiTitle。来源没有明确名称则保留脱敏编号，不用对话正文猜测。上游辅助缓存归 Lumi，保存前剔除消息、命令和行为字段；会话摘要与导出只使用显示元数据和计数。</td></tr>
<tr><th>已扫描范围</th><td>未发现的软件不进入顶部软件 Tab，也不进入下方筛选和统计。零记录软件可保留0展示。分页和CSV以同一筛选范围汇总，展开原始计数按需读取。</td></tr>
</tbody></table></div></section>
<section><h2>05 · 验证记录与复现</h2><div class="split"><div><h3>验证结果</h3><ul><li>上游：${tests.testResults.length} 个测试文件，${tests.numPassedTests} 项通过，${tests.numFailedTests} 项失败。</li><li>Lumi：${validation.testFiles} 个测试文件，${validation.tests} 项通过；类型、lint、Rust格式、check、clippy通过。</li><li>Lumi新增边界：43来源覆盖、缓存别名、推理规则、估算/非法计数、Claude完整日志/名称、Gemini发现与缓存恢复、Gateway API及失败保留、会话/明细/CSV、重复刷新。</li><li>上游来源指纹：${checks.length}/${checks.length} 一致。</li></ul></div><div><h3>复现命令</h3><p><code>pnpm verify:usage</code> 会按顺序完成以下步骤并更新报告与验证摘要：</p><ol><li><code>pnpm build:core</code></li><li><code>pnpm test:codeburn</code></li><li><code>pnpm check</code></li><li><code>node scripts/audit-codeburn.mjs</code></li><li><code>node scripts/build-codeburn-report.mjs</code></li></ol><small>审计会读取本机已有来源，仅输出软件级计数。上游辅助缓存使用审计临时目录，结束后清除。</small></div></div><p><a href="codeburn-upstream-tests.json">上游测试明细 JSON</a> · <a href="codeburn-local-audit.json">本机审计 JSON</a> · <a href="codeburn-validation.json">Lumi 验证摘要 JSON</a></p></section>
<footer>证据基准：${e(snapshot.repository)} @ ${e(snapshot.commit)}。本报告核对 Token 采集与聚合；软件更新、数据清理、源格式变化或网关授权范围变化后，应按相同命令重新核验。</footer></main></body></html>`
await fs.writeFile(path.join(root, 'reports/lumi-codeburn-audit.html'), html)
process.stdout.write(
  `Generated reports/lumi-codeburn-audit.html (${Buffer.byteLength(html)} bytes), ${registry.length} sources, ${checks.length} source fingerprints\n`,
)
