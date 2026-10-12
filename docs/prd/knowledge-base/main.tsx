// SPDX-License-Identifier: MPL-2.0
import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Badge, Button, Card, IconButton, Input, NavigationButton, Segmented, Select, SurfaceEffects, Tabs, Modal } from '../../../src/components/ui'
import ToastProvider, { useToast } from '../../../src/components/ToastProvider'
import '../../../src/theme/obsidian-solar-amber.css'
import '../../../src/theme/palette.css'
import './style.css'

type IconName = 'book' | 'grid' | 'search' | 'arrow' | 'next' | 'source' | 'sun' | 'print' | 'close'
function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21z"/><path d="M4 5.5v13A2.5 2.5 0 0 1 6.5 16H20"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    arrow: <><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></>,
    next: <><path d="m9 18 6-6-6-6"/></>,
    source: <><path d="M4 4h16v13H4z"/><path d="M8 21h8M12 17v4M7 8h10M7 12h6"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>,
    print: <><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

const projects = [
  { name: 'LumiPlug', about: '本地 AI 能力管理，涵盖 MCP 网关、工具与桌面交互。', state: '可用', count: '18 篇', revision: 'v7' },
  { name: 'Order Service', about: '订单、库存与支付流程的服务知识。', state: '需更新', count: '26 篇', revision: 'v3' },
  { name: 'Design Kit', about: '组件规范、主题令牌与品牌资源。', state: '等待 AI', count: '待生成', revision: '—' },
]
const docs = ['项目概览', 'MCP 网关', '工具执行', '本地存储', '安全边界', '更新与恢复']
const graphNodes = [
  { name: '会话协议', x: 17, y: 20, kind: '概念' },
  { name: '工具执行', x: 83, y: 20, kind: '模块' },
  { name: 'MCP 网关', x: 50, y: 50, kind: '模块' },
  { name: '本地存储', x: 17, y: 80, kind: '模块' },
  { name: '知识构建', x: 50, y: 80, kind: '流程' },
  { name: '安全边界', x: 83, y: 80, kind: '约束' },
]
const graphRelations = [
  ['MCP 网关', '引用', '会话协议'],
  ['MCP 网关', '调用', '工具执行'],
  ['MCP 网关', '受约束于', '安全边界'],
  ['知识构建', '写入', '本地存储'],
  ['知识构建', '经由', 'MCP 网关'],
] as const
const articleCopy: Record<string, string> = {
  '项目概览': 'LumiPlug 在本机管理 AI 能力。Core 负责数据与执行边界，外部 AI 通过 MCP 调用能力。',
  'MCP 网关': '外部请求经过本机连接校验，再由 Registry 转交统一执行入口。网关通过工具提供知识读写，不内置回答模型。',
  '工具执行': 'Registry 统一校验公开参数并调度工具。知识构建中的文档和引用同样由 Core 校验后写入。',
  '本地存储': 'Core 使用 SQLite 保存版本化知识。新版本校验完成后原子切换；失败时已发布版本继续可读。',
  '安全边界': '目录授权绑定来源与排除规则。AI 只能在已授权范围内读取；来源正文作为数据处理，不作为可执行指令。',
  '更新与恢复': '更新由 AI 提交增量请求。Core 记录构建阶段与已接收批次；中断后可用恢复凭据继续同一构建。',
}
const refs = ['packages/core/src/mcp/gateway.ts · 连接与工具入口', 'src/components/ToastProvider.tsx · 操作反馈', 'docs/MCP_DESIGN.md · 协议边界']
const sections = [
  ['overview', '概览'], ['interface', '界面'], ['flow', '生成与使用'], ['states', '状态与更新'], ['scope', '实施范围'],
] as const
type SectionId = (typeof sections)[number][0]

function App() {
  const toast = useToast()
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [activeSection, setActiveSection] = useState<SectionId>('overview')
  const [selectedProject, setSelectedProject] = useState(0)
  const [activeDoc, setActiveDoc] = useState('MCP 网关')
  const [view, setView] = useState<'graph' | 'article'>('graph')
  const [selectedNode, setSelectedNode] = useState('MCP 网关')
  const [sourceOpen, setSourceOpen] = useState(false)
  const [projectView, setProjectView] = useState<'list' | 'detail'>('list')
  const [graphMode, setGraphMode] = useState<'map' | 'list'>('map')
  const [status, setStatus] = useState('中断')
  const [query, setQuery] = useState('')
  const [showAllStates, setShowAllStates] = useState(false)
  const project = projects[selectedProject]!
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  const filteredDocs = useMemo(() => docs.filter((doc) => !query || `${doc}${articleCopy[doc]}`.toLowerCase().includes(query.toLowerCase())), [query])
  const goto = (id: SectionId) => {
    setActiveSection(id)
    document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }
  const openDoc = (doc: string) => { setActiveDoc(doc); setView('article'); setSelectedNode(doc) }
  const jumpBack = () => { setView('graph'); setSelectedNode(activeDoc) }

  return <div className="prd">
    <aside className="rail" aria-label="PRD 目录">
      <div className="mark" aria-hidden="true">L</div>
      <nav aria-label="应用导航"><NavigationButton label="Skills" icon={<Icon name="book" />} current={false} /><NavigationButton label="知识库" icon={<Icon name="grid" />} current /></nav>
      <div className="rail-end">PRD</div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div className="crumb"><span>LumiPlug</span><span className="slash">/</span><strong>知识库 PRD</strong></div>
        <div className="top-actions"><Badge tone="accent">待评审</Badge><IconButton label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name="sun" /></IconButton><IconButton label="打印或导出 PDF" onClick={() => window.print()}><Icon name="print" /></IconButton></div>
      </header>
      <div className="doc-layout">
        <aside className="toc">
          <div className="toc-title">文档</div>
          {sections.map(([id, label]) => <Button key={id} variant={activeSection === id ? 'secondary' : 'ghost'} className="toc-button" onClick={() => goto(id)}>{label}</Button>)}
          <div className="toc-meta"><span>2026-10-06</span><span>设计 GPT-6-Astra</span><span>HTML GPT-6-Luna</span></div>
        </aside>
        <article className="content">
          <section id="overview" className="section overview">
            <div className="title-row"><div><h1>Lumi 知识库</h1><p className="lede">面向项目资料的可溯源知识目录、图谱与 MCP 使用体验。</p></div><Badge>PRD · 评审稿</Badge></div>
            <div className="review-strip"><span><b>产品状态</b> 待评审</span><span><b>设计</b> GPT-6-Astra</span><span><b>文档</b> GPT-6-Luna</span><span><b>范围</b> 首版 · 本机项目</span></div>
            <div className="split-heading"><h2>界面示意</h2><span>交互原型 · 示例数据 · 未连接 Core</span></div>
            <div className="product-frame" aria-label="知识库项目列表与详情的可操作界面示意">
              <div className="app-top"><div className="app-brand"><span className="brand-dot">L</span><span>知识库</span><Badge>示意</Badge></div>{projectView === 'detail' && <div className="app-tools"><Input aria-label="搜索当前知识库" placeholder="搜索知识" value={query} onChange={(e) => setQuery(e.target.value)} /><Button onClick={() => toast('交互示意：此 PRD 未连接 Lumi Core', 'info')}>更新</Button></div>}</div>
              {projectView === 'list' ? <><div className="list-heading"><h4>项目知识库</h4><span>Skills 下方 · 项目列表</span></div><div className="project-strip" aria-label="示例项目列表">
                {projects.map((item, i) => <Card key={item.name} interactive className="project-card"><Button variant="ghost" className="project-chip" onClick={() => { setSelectedProject(i); setActiveDoc('MCP 网关'); setView('graph'); setProjectView('detail') }} aria-label={`打开 ${item.name} 知识库`}>
                  <strong>{item.name}</strong><span>{item.about}</span><small><Badge tone={item.state === '可用' ? 'success' : item.state === '需更新' ? 'accent' : 'neutral'}>{item.state}</Badge><span>{item.count}</span></small>
                </Button></Card>)}
              </div></> : <>
              <div className="detail-head"><div><h3>{project.name}</h3><span className="meta-line">{project.about} <span className="revision">{project.revision} · 示例版本</span></span></div><div className="detail-actions"><Tabs label="详情视图" value={view} onValueChange={(v) => setView(v)} items={[{value:'graph',label:'图谱'},{value:'article',label:'文档'}]} /><Button variant="secondary" onClick={() => toast('交互示意：更新需把请求交给外部 AI', 'info')}>复制更新请求</Button></div></div>
              <div className="back-list"><Button variant="ghost" icon={<Icon name="arrow" />} onClick={() => { setProjectView('list'); setQuery('') }}>返回项目列表</Button></div>
              {selectedProject === 0 ? <div className="workspace">
                <aside className="tree" aria-label="生成知识目录"><div className="tree-tabs"><strong>知识目录</strong><Button variant="ghost" onClick={() => setSourceOpen(true)}>来源</Button></div><Button variant={view === 'graph' ? 'secondary' : 'ghost'} className="tree-entry graph-entry" onClick={() => setView('graph')} icon={<Icon name="grid" />}>知识图谱</Button><div className="tree-group">项目地图</div>
                  {filteredDocs.map((doc, index) => <Button key={doc} variant={activeDoc === doc && view === 'article' ? 'secondary' : 'ghost'} className="tree-entry" onClick={() => openDoc(doc)} aria-pressed={activeDoc === doc && view === 'article'}><span className="tree-guide" aria-hidden="true">{index ? '·' : '⌄'}</span>{doc}</Button>)}
                  {query && filteredDocs.length === 0 && <p className="no-results">没有匹配文档</p>}
                </aside>
                <div className="preview-pane">
                  {view === 'graph' ? <>
                    <div className="pane-head"><div><h4>项目关系概览</h4><span>示意结构 · 节点与连线代表有依据的知识关系</span></div><Segmented label="图谱展示方式" value={graphMode} onValueChange={setGraphMode} items={[{value:'map',label:'关系图'},{value:'list',label:'关系列表'}]} /></div>
                    {graphMode === 'map' ? <div className="graph-wrap">
                      <svg className="edges" viewBox="0 0 720 300" preserveAspectRatio="none" role="img" aria-label="示意知识关系图。线段对应关系列表中的相同关系。">
                        {graphRelations.map(([from, , to]) => {
                          const start = graphNodes.find((node) => node.name === from)!
                          const end = graphNodes.find((node) => node.name === to)!
                          return <path key={`${from}-${to}`} d={`M ${start.x * 7.2} ${start.y * 3} L ${end.x * 7.2} ${end.y * 3}`} />
                        })}
                      </svg>
                      {graphNodes.map((node) => <Card key={node.name} className="graph-node" style={{left:`${node.x}%`,top:`${node.y}%`}}><Button variant={node.name === selectedNode ? 'secondary' : 'ghost'} className="graph-node-button" onClick={() => setSelectedNode(node.name)} aria-pressed={node.name === selectedNode}><Badge tone={node.name === selectedNode ? 'accent' : 'neutral'}>{node.name === selectedNode ? '已选中' : node.kind}</Badge><strong>{node.name}</strong></Button></Card>)}
                    </div> : <div className="graph-rel-list" role="list" aria-label="示意知识关系列表">{graphRelations.map(([from,rel,to]) => <div key={`${from}-${to}`} className="relation-row" role="listitem"><Button variant="ghost" className="relation-content" onClick={() => setSelectedNode(from)}><strong>{from}</strong><span>{rel}</span><strong>{to}</strong></Button><Button variant="ghost" onClick={() => setSourceOpen(true)}>来源</Button></div>)}</div>}
                    <div className="node-detail"><div><Badge tone="protocol">{selectedNode}</Badge><p>{articleCopy[selectedNode] ?? `${selectedNode} 与 MCP 网关存在示意关联；关系须有来源证据。`}</p></div><div className="node-actions"><Button variant="secondary" onClick={() => openDoc(docs.includes(selectedNode) ? selectedNode : 'MCP 网关')}>打开文档</Button><Button variant="ghost" onClick={() => setSourceOpen(true)}>来源 3</Button></div></div>
                  </> : <div className="article-view"><div className="article-toolbar"><Button variant="ghost" icon={<Icon name="arrow" />} onClick={jumpBack}>返回图谱</Button><Button variant="ghost" onClick={() => setSourceOpen(true)}>查看来源</Button></div><div className="article-body"><div className="breadcrumb">核心模块 / {activeDoc}</div><h4>{activeDoc}</h4><p>{articleCopy[activeDoc]}</p><h5>设计说明</h5><p>关系只表达有来源支持的结构。点击来源可核对原始材料与定位；图谱和目录切换后保留当前知识库上下文。</p><blockquote>“{articleCopy[activeDoc]}” <Button variant="ghost" onClick={() => setSourceOpen(true)}>[1]</Button></blockquote><div className="article-tags"><Badge>v7</Badge><Button variant="ghost" onClick={() => setSourceOpen(true)}>来源证据 · 3</Button><Button variant="ghost" onClick={() => setView('graph')}>查看关系</Button></div></div></div>}
                </div>
              </div> : <div className="empty-library"><Badge tone={selectedProject === 1 ? 'accent' : 'neutral'}>{project.state}</Badge><h4>{selectedProject === 1 ? 'Order Service · 示例知识' : 'Design Kit · 等待外部 AI'}</h4><p>{selectedProject === 1 ? '此卡片只展示需更新状态；详情数据不在本 PRD 示意范围内。' : '此示例库尚未生成内容；Lumi 不会自动扫描或生成知识。'}</p></div>}
              </>}
            </div>
            <p className="caption">上述名称、正文、版本和关系均为界面说明用示例，不是扫描结果或真实知识库数据。</p>
          </section>

          <section id="interface" className="section">
            <div className="section-heading"><div><h2>界面结构</h2><p>从 Skills 之后进入知识库；卡片列表直达整页详情。</p></div><span className="section-mark">导航 · 阅读 · 核证</span></div>
            <div className="interface-grid">
              <div><h3>项目列表</h3><ul className="tight-list"><li>卡片只放名称、两行介绍和必要状态。</li><li>待处理聚合等待授权、构建中断与失败。</li><li>搜索项目名称、介绍和来源别名；不跨库搜正文。</li></ul></div>
              <div><h3>详情页</h3><ul className="tight-list"><li>目录与右侧阅读区分开滚动；默认显示聚合图。</li><li>选目录文档进入阅读；节点显示摘要、关联文档和证据。</li><li>阅读、图谱与来源往返时保留项目和上下文。</li></ul></div>
            </div>
            <details className="fold"><summary>组件与窄屏规则</summary><p>既有 Button、IconButton、Tabs、Segmented、Input、Card、Badge、SurfaceButton、Modal 和 Toast 沿用共用实现。GraphView、完整 TreeView、带证据定位的 DocumentViewer 是待确认扩展；评审前不实现业务组件。小窗口时目录可收起，图与正文自然纵向排布。</p></details>
          </section>

          <section id="flow" className="section">
            <div className="section-heading"><div><h2>生成与使用</h2><p>外部 AI 负责理解与生成；Lumi 管理本地权限、校验、版本和检索。</p></div><Badge tone="protocol">无内置模型</Badge></div>
            <div className="flowline" aria-label="知识库生成与使用流程">
              {[
                ['01','AI 提出当前目录','先确认绝对路径与目标'], ['02','用户一次授权','确认范围与排除项'], ['03','读取来源快照','Core 按范围校验'], ['04','分批提交知识','文档、关系、引用'], ['05','校验并原子发布','完整或经用户确认的部分版'], ['06','浏览与 AI 使用','read / search / graph'],
              ].map(([n,title,sub],i) => <div className="flow-step" key={n}><span className="flow-number">{n}</span><strong>{title}</strong><small>{sub}</small>{i<5 && <span className="flow-arrow" aria-hidden="true"><Icon name="next" /></span>}</div>)}
            </div>
            <div className="contract-row"><span>AI 通过 Lumi MCP 读取构建契约和授权快照</span><span className="contract-line"/><Badge tone="success">Lumi Core</Badge></div>
            <div className="usage-grid"><div><h3>授权边界</h3><p>一次授权覆盖该来源范围内的构建读取和后续更新。扩目录、加入排除项或换来源需重新授权。AI 不可自批权限。</p></div><div><h3>更新边界</h3><p>“更新”准备增量请求并交给外部 AI；只有真实收到 begin_build 才进入构建状态。复制成功不等于构建开始。</p></div><div><h3>证据回答</h3><p><code>read</code> 提供文档，<code>search</code> 提供命中段落，<code>graph</code> 提供有界邻域。外部 AI 结合证据作答。</p></div></div>
            <details className="fold"><summary>MCP 工具草案与恢复凭据</summary><p>拟议工具：<code>knowledge_get_contract</code>、<code>knowledge_list</code>、<code>knowledge_request_source</code>、<code>knowledge_get_source</code>、<code>knowledge_scan_source</code>、<code>knowledge_get_scan</code>、<code>knowledge_list_source_files</code>、<code>knowledge_read_source</code>、<code>knowledge_prepare_build</code>、<code>knowledge_begin_build</code>、<code>knowledge_write_batch</code>、<code>knowledge_get_build</code>、<code>knowledge_validate_build</code>、<code>knowledge_publish_build</code>、<code>knowledge_cancel_build</code>、<code>knowledge_read</code>、<code>knowledge_search</code>、<code>knowledge_graph</code>。</p><p><code>prepare_build</code> 由 Core 生成高熵恢复令牌，仅保存短期哈希，不建构建、不占写锁。首次响应丢失可重试准备；<code>begin_build</code> 绑定凭据后可跨 Core 重启续建。丢失令牌须经用户在本机接管，requestKey 本身不授予写权限。</p><p>所有输入采用严格 schema；共享输出不含绝对路径、凭据或未经允许的来源内容。共用 MCP 令牌不是独立客户端身份，不能按 AI 产品名隔离权限。</p></details>
          </section>

          <section id="states" className="section">
            <div className="section-heading"><div><h2>状态与更新</h2><p>发布版可读状态与构建状态分开记录。</p></div><Button variant="ghost" onClick={() => setShowAllStates(!showAllStates)}>{showAllStates ? '收起状态' : '查看全部状态'}</Button></div>
            <div className="state-panel"><label htmlFor="state-picker">状态示意</label><Select id="state-picker" value={status} onChange={(e) => setStatus(e.target.value)}>{['空库','等待授权','等待 AI','构建中','中断','部分完成','校验失败','来源变更','旧版可读'].map((x) => <option key={x}>{x}</option>)}</Select><div className="state-explain"><Badge tone={status === '校验失败' ? 'danger' : status === '来源变更' ? 'accent' : 'neutral'}>{status}</Badge><span>{({ '空库':'没有知识库时显示添加入口，不放假项目。','等待授权':'请求尚未获批，不读取任何来源。','等待 AI':'已授权但外部 AI 尚未发起构建。','构建中':'只显示真实阶段与已接收数量。','中断':'保留已确认批次，可继续同一构建。','部分完成':'列出缺失项；发布前需要用户明确确认。','校验失败':'定位问题并让 AI 修复，不能强行发布。','来源变更':'显示受影响内容，复制增量请求。','旧版可读':'新版构建期间，已发布版本继续可读。'} as Record<string,string>)[status]}</span></div></div>
            {showAllStates && <div className="state-table"><div><strong>网络离线</strong><span>本地已发布阅读和搜索继续可用。</span></div><div><strong>来源撤销</strong><span>旧版可读；新的读取与发布停止。</span></div><div><strong>磁盘写入失败</strong><span>旧版不变；释放空间后幂等重试。</span></div><div><strong>版本冲突</strong><span>禁止静默覆盖，AI 读取差异后合并。</span></div></div>}
            <p className="rule-note">操作结果使用窗口顶部 Toast；持续状态留在内容区。更新请求复制成功只表示请求已准备。</p>
          </section>

          <section id="scope" className="section">
            <div className="section-heading"><div><h2>实施范围</h2><p>首版闭合“授权、生成、校验、发布、查阅、更新与恢复”。</p></div><Badge tone="accent">评审决策待定</Badge></div>
            <div className="acceptance"><div><span className="check">✓</span><span>来源授权和排除规则可查看、撤销、重新绑定</span></div><div><span className="check">✓</span><span>旧版在更新失败或中断时仍可读</span></div><div><span className="check">✓</span><span>文档、关系、引用通过版本校验后原子发布</span></div><div><span className="check">✓</span><span>离线浏览；AI 可检索并返回有版本的证据</span></div><div><span className="check">✓</span><span>跨重启恢复、部分版确认和来源变更有明确路径</span></div></div>
            <div className="decision-box"><h3>需要确认的共用组件</h3><div className="decision-items"><span>GraphView · 节点关系与键盘等价列表</span><span>TreeView · 异步树和方向键行为</span><span>DocumentViewer · 引用定位与新鲜度</span></div></div>
            <details className="fold"><summary>容量目标、技术选择与来源研究</summary><p>设计验收建议：10,000 个来源文件、2,000 篇知识文档、50,000 个节点与 250,000 条边；概览图使用受限子图。单文件建议上限 1 MiB，源快照预算初始 200 MiB。性能目标需在三平台实测，不是已验证承诺。</p><p>首版复用 Core SQLite/WAL；邻域查询采用有预算的 BFS。图形库 Cytoscape.js 为待原型验证建议；不引入 Neo4j、完整 GraphRAG 服务或必需向量模型。</p><ul>{[
              ['Obsidian Graph View','https://obsidian.md/help/plugins/graph'],['DeepWiki','https://docs.devin.ai/work-with-devin/deepwiki'],['GraphRAG Local Search','https://microsoft.github.io/graphrag/query/local_search/'],['MCP Resources','https://modelcontextprotocol.io/specification/2025-11-25/server/resources'],['Cytoscape.js','https://js.cytoscape.org/'],['SQLite FTS5','https://www.sqlite.org/fts5.html'],
            ].map(([title,url]) => <li key={title}><a href={url} target="_blank" rel="noreferrer">{title}</a></li>)}</ul></details>
            <footer className="doc-footer"><span>来源：KNOWLEDGE_BASE_DESIGN.md · 2026-10-06</span><span>交互原型仅解释设计，未实现生产功能</span></footer>
          </section>
        </article>
      </div>
    </main>
    {sourceOpen && <Modal title="来源证据 · 示例" onClose={() => setSourceOpen(false)} actions={<Button variant="secondary" onClick={() => setSourceOpen(false)}>关闭</Button>}>
      <p className="modal-lede">以下路径与引文仅演示来源核对布局，需由发布版本提供真实证据。</p><div className="source-list">{refs.map((ref,i) => <div className="source-item" key={ref}><Badge tone="protocol">[{i+1}]</Badge><div><strong>{ref.split(' · ')[0]}</strong><p>{ref.split(' · ')[1]}</p><small>示意定位 · 知识版本 v7</small></div></div>)}</div>
    </Modal>}
  </div>
}

createRoot(document.getElementById('root')!).render(<ToastProvider><SurfaceEffects depth="heavy"><App /></SurfaceEffects></ToastProvider>)
