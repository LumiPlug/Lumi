// SPDX-License-Identifier: MPL-2.0
import { useId, useState } from 'react'
import { Archive, BookOpen, Play, Settings } from 'lucide-react'
import { Badge, Card, IconButton, SurfaceButton, Tabs } from './ui'
import { skillAddedTime } from '../lib/skills'
import { toolAddedTime } from '../lib/tools'
import { useToast } from './ToastProvider'
import './tools.css'

type Kind = 'tools' | 'skills' | 'knowledge'
const tools = [
  {
    name: '启动开发服务',
    protocol: 'terminal',
    status: '已启用',
    tone: 'success',
    action: '运行',
    description: '在项目目录启动本地开发服务，集中查看运行日志和结果。',
    createdAt: '2026-10-10T01:20:00Z',
  },
  {
    name: '项目健康检查',
    protocol: 'http',
    status: '草稿',
    tone: 'accent',
    action: '审阅',
    description: '检查服务连通性。',
    createdAt: '2026-10-09T06:30:00Z',
  },
  {
    name: '文档检索',
    protocol: 'mcp',
    status: '已停用',
    tone: 'neutral',
    action: '审阅',
    description: '连接文档服务，查询项目资料与接口说明。',
    createdAt: '2026-10-08T03:15:00Z',
  },
] as const
const skills = [
  {
    name: 'impeccable',
    client: 'Codex',
    source: 'codex',
    description: '检查与改进界面层级、交互和可访问性，交付可评审的视觉设计。',
    fileCreatedAt: '2026-10-10T01:20:00Z',
    firstSeenAt: null,
  },
  {
    name: 'artifact-template-analytics-dashboard',
    client: 'Codex',
    source: 'codex',
    description: '使用模板创建分析看板，组织数据、指标和图表。',
    fileCreatedAt: '1970-01-01T00:00:01Z',
    firstSeenAt: '2026-10-09T06:30:00Z',
  },
  {
    name: 'find-skills',
    client: 'Gemini CLI',
    source: 'gemini',
    description: '发现适合当前任务的技能与安装来源。',
    fileCreatedAt: '1970-01-01T00:00:01Z',
    firstSeenAt: null,
  },
] as const
const libraries = [
  {
    name: 'Lumi',
    branch: 'main',
    version: 'v1',
    description: '本机 AI 工具、技能与知识库的产品规格、架构和界面规范。',
    documents: 24,
    nodes: 68,
    date: '2026-10-10',
  },
  {
    name: '项目开发手册',
    branch: 'feature/knowledge',
    version: 'v2',
    description: '整理项目约定、接口和开发流程，保留文档之间的引用关系。',
    documents: 12,
    nodes: 35,
    date: '2026-10-09',
  },
] as const

export default function ResourceCardDesignPreview() {
  const [kind, setKind] = useState<Kind>('tools')
  const id = useId()
  const toast = useToast()
  const preview = (action: string, name: string) => toast(`示例：${action} ${name}。`, 'info')
  return (
    <section className="ui-demo-resource-design" aria-label="资源卡片视觉方案">
      <div className="ui-components-summary">
        <p>设计方案 · 示例数据 · 名称与操作优先，身份、用途和辅助信息分层。</p>
        <Tabs
          label="卡片类型"
          value={kind}
          onValueChange={setKind}
          items={[
            { value: 'tools', label: '工具', id: `${id}-tools`, panelId: `${id}-panel-tools` },
            { value: 'skills', label: 'Skills', id: `${id}-skills`, panelId: `${id}-panel-skills` },
            {
              value: 'knowledge',
              label: '知识库',
              id: `${id}-knowledge`,
              panelId: `${id}-panel-knowledge`,
            },
          ]}
        />
      </div>
      <div
        className="ui-demo-resource-grid"
        data-card-kind={kind}
        role="tabpanel"
        id={`${id}-panel-${kind}`}
        aria-labelledby={`${id}-${kind}`}
        tabIndex={0}
      >
        {kind === 'tools' &&
          tools.map((tool) => (
            <Card
              key={tool.name}
              density="compact"
              interactive
              role="article"
              className="ui-demo-resource-card"
            >
              <SurfaceButton
                className="tools-card-open"
                aria-label={`查看 ${tool.name}，${tool.status}`}
                onClick={() => preview('查看', tool.name)}
              />
              <div className="tools-row-title">
                <strong title={tool.name}>{tool.name}</strong>
                <Badge tone={tool.tone}>{tool.status}</Badge>
                <IconButton
                  className="tools-card-action"
                  tone={tool.tone}
                  glow
                  label={`${tool.action} ${tool.name}（${tool.status}）`}
                  onClick={() => preview(tool.action, tool.name)}
                >
                  {tool.action === '运行' ? (
                    <Play size={18} aria-hidden="true" />
                  ) : (
                    <Settings size={18} aria-hidden="true" />
                  )}
                </IconButton>
              </div>
              <p className="ui-resource-description ui-demo-resource-description">
                {tool.description}
              </p>
              <div className="ui-resource-meta ui-demo-resource-identity ui-demo-resource-footer">
                <Badge data-tool-kind={tool.protocol}>{tool.protocol.toUpperCase()}</Badge>
                <time dateTime={tool.createdAt} title="示例添加时间（本机时区）">
                  {toolAddedTime(tool.createdAt).text}
                </time>
              </div>
            </Card>
          ))}
        {kind === 'skills' &&
          skills.map((skill, index) => {
            const added = skillAddedTime(skill)
            const dateId = `${id}-skill-date-${index}`
            return (
              <Card
                key={skill.name}
                density="compact"
                interactive
                role="article"
                className="ui-demo-resource-card"
              >
                <SurfaceButton
                  className="tools-card-open"
                  aria-label={`查看 ${skill.name} 详情`}
                  aria-describedby={dateId}
                  onClick={() => preview('查看', skill.name)}
                />
                <div className="tools-row-title">
                  <strong title={skill.name}>{skill.name}</strong>
                  <IconButton
                    className="tools-card-action"
                    tone="accent"
                    glow
                    label={`归档 ${skill.name}`}
                    onClick={() => preview('归档', skill.name)}
                  >
                    <Archive size={18} aria-hidden="true" />
                  </IconButton>
                </div>
                <p className="ui-resource-description ui-demo-resource-description">
                  {skill.description}
                </p>
                <div className="ui-resource-meta ui-demo-resource-footer ui-demo-resource-identity">
                  <Badge data-source={skill.source}>{skill.client}</Badge>
                  <span className="ui-demo-resource-date" id={dateId} title={added.description}>
                    {added.dateTime ? (
                      <time dateTime={added.dateTime}>{added.text}</time>
                    ) : (
                      added.text
                    )}
                  </span>
                </div>
              </Card>
            )
          })}
        {kind === 'knowledge' &&
          libraries.map((library) => (
            <Card
              key={library.name}
              density="compact"
              interactive
              role="article"
              className="ui-demo-resource-card ui-demo-resource-card--knowledge"
            >
              <SurfaceButton
                className="tools-card-open"
                aria-label={`查看知识库 ${library.name}，分支 ${library.branch}`}
                onClick={() => preview('查看', library.name)}
              />
              <div className="tools-row-title">
                <BookOpen size={18} aria-hidden="true" />
                <strong title={library.name}>{library.name}</strong>
              </div>
              <div className="ui-resource-meta">
                <Badge tone="protocol">{library.branch}</Badge>
                <Badge>{library.version}</Badge>
              </div>
              <p className="ui-resource-description ui-demo-resource-description">
                {library.description}
              </p>
              <div className="ui-resource-meta ui-demo-resource-footer">
                <span>
                  {library.documents} 个文档 · {library.nodes} 个节点
                </span>
                <time dateTime={library.date} title="示例更新时间">
                  更新于 {library.date}
                </time>
              </div>
            </Card>
          ))}
      </div>
    </section>
  )
}
