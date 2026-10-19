// SPDX-License-Identifier: MPL-2.0
import { t, useLocale } from '../../i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import type { Core, EdgeSingular, StylesheetStyle } from 'cytoscape'
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import type { KnowledgeNode, KnowledgeEdge } from '@lumiplug/shared'
import { IconButton, SurfaceButton } from './controls'
import { Segmented } from './choice'
import { advanceGraphFlow } from '../../lib/graph-motion'

export const relationLabels: Record<KnowledgeEdge['type'], string> = {
  get contains() {
    return t('包含')
  },
  get explains() {
    return t('说明')
  },
  get references() {
    return t('引用')
  },
  get depends_on() {
    return t('依赖')
  },
  get calls() {
    return t('调用')
  },
  get implements() {
    return t('实现')
  },
  get related_to() {
    return t('相关')
  },
}
export function GraphView({
  nodes,
  edges,
  selectedId,
  onSelect,
  active = true,
  truncated = false,
}: {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  selectedId: string | null
  onSelect: (id: string) => void
  active?: boolean
  truncated?: boolean
}) {
  useLocale()

  const holder = useRef<HTMLDivElement>(null),
    legend = useRef<HTMLDivElement>(null),
    graph = useRef<Core | null>(null),
    callback = useRef(onSelect)
  const fit = useRef<() => void>(() => {})
  const flowOffset = useRef(0)
  const [compact, setCompact] = useState(false)
  const visibleNodes = useMemo(() => {
    if (!compact || nodes.length <= 6) return nodes
    const priorities = { project: 0, module: 1, concept: 2, symbol: 3 }
    const overview = [...nodes]
      .sort((a, b) => priorities[a.kind] - priorities[b.kind] || a.label.localeCompare(b.label))
      .slice(0, 6)
    const selected = nodes.find((node) => node.id === selectedId)
    if (selected && !overview.some((node) => node.id === selectedId))
      overview[overview.length - 1] = selected
    return overview
  }, [nodes, compact, selectedId])
  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((node) => node.id))
    return edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to))
  }, [edges, visibleNodes])
  const [mode, setMode] = useState<'graph' | 'list'>('graph')
  const [failed, setFailed] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  useEffect(() => {
    callback.current = onSelect
  }, [onSelect])
  useEffect(() => {
    if (!holder.current || !visibleNodes.length) return
    const element = holder.current
    const styles = (): StylesheetStyle[] => {
      const css = getComputedStyle(element),
        color = (name: string) => css.getPropertyValue(name).trim()
      const nodeColors: Record<KnowledgeNode['kind'], string> = {
        project: color('--accent'),
        module: color('--lumi-protocol'),
        concept: color('--lumi-operational'),
        symbol: color('--secondary'),
      }
      const sourceColor = (edge: EdgeSingular) =>
        nodeColors[edge.source().data('kind') as KnowledgeNode['kind']]
      return [
        {
          selector: 'node',
          style: {
            'background-color': color('--secondary'),
            'border-width': 2,
            'border-color': color('--panel'),
            width: 38,
            height: 38,
            label: 'data(label)',
            color: color('--text'),
            'font-size': 13,
            'font-family': css.getPropertyValue('--lumi-font-ui'),
            'text-wrap': 'wrap',
            'text-max-width': '120px',
            'text-valign': 'bottom',
            'text-margin-y': 8,
            'min-zoomed-font-size': 9,
          },
        },
        {
          selector: 'node[kind="project"]',
          style: { 'background-color': color('--accent'), width: 54, height: 54 },
        },
        {
          selector: 'node[kind="module"]',
          style: { 'background-color': color('--lumi-protocol') },
        },
        {
          selector: 'node[kind="concept"]',
          style: { 'background-color': color('--lumi-operational') },
        },
        {
          selector: 'node:selected',
          style: { 'border-color': color('--text'), 'border-width': 4 },
        },
        {
          selector: 'edge',
          style: {
            width: 1.4,
            'line-color': sourceColor,
            'target-arrow-color': sourceColor,
            'target-arrow-shape': 'triangle',
            'curve-style': compact ? 'unbundled-bezier' : 'bezier',
            'control-point-distances': compact ? -96 : 0,
            'control-point-weights': 0.5,
            opacity: 0.5,
          },
        },
        { selector: 'edge[evidenceKind="inferred"]', style: { 'line-style': 'dashed' } },
        { selector: '.graph-muted', style: { opacity: 0.2 } },
        {
          selector: 'node.graph-related',
          style: { 'border-color': color('--accent'), 'border-width': 3 },
        },
        {
          selector: 'node.graph-focused',
          style: { 'border-color': color('--text'), 'border-width': 4 },
        },
        {
          selector: 'edge.graph-related',
          style: {
            width: 2.4,
            opacity: 1,
            'z-index': 2,
          },
        },
        {
          selector: 'edge.graph-flow',
          style: { 'line-style': 'dashed', 'line-dash-pattern': [16, 8] },
        },
        {
          selector: 'edge.graph-flow[evidenceKind="inferred"]',
          style: { 'line-dash-pattern': [4, 8] },
        },
      ]
    }
    let observer: ResizeObserver | null = null,
      theme: MutationObserver | null = null
    try {
      const cy = cytoscape({
        container: element,
        elements: [
          ...visibleNodes.map((node) => ({
            data: {
              id: node.id,
              label: node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label,
              kind: node.kind,
            },
          })),
          ...visibleEdges.map((edge) => ({
            data: {
              id: `edge:${edge.id}`,
              source: edge.from,
              target: edge.to,
              evidenceKind: edge.evidenceKind,
            },
          })),
        ],
        style: styles(),
        layout: {
          name: 'cose',
          animate: false,
          fit: true,
          padding: 54,
          nodeRepulsion: () => 240000,
          idealEdgeLength: () => 130,
          nodeOverlap: 30,
          randomize: false,
        },
        minZoom: 0.15,
        maxZoom: 3,
        wheelSensitivity: 0.2,
      })
      graph.current = cy
      fit.current = () => {
        if (compact) {
          const columns = cy.width() < 480 ? 2 : 3
          cy.layout({
            name: 'grid',
            fit: false,
            cols: columns,
            rows: Math.ceil(visibleNodes.length / columns),
            nodeDimensionsIncludeLabels: true,
            avoidOverlap: true,
            avoidOverlapPadding: 16,
            boundingBox: {
              x1: 12,
              y1: 12,
              w: Math.max(100, cy.width() - 24),
              h: Math.max(120, cy.height() - (legend.current?.offsetHeight ?? 0) - 40),
            },
          }).run()
          cy.zoom(1)
          cy.pan({ x: 0, y: 0 })
        } else cy.fit(undefined, 54)
      }
      cy.on('tap', 'node', (event) => callback.current(event.target.id() as string))
      cy.on('mouseover', 'node', (event) => setHoveredId(event.target.id() as string))
      cy.on('mouseout', 'node', () => setHoveredId(null))
      let fitted = false
      let size: { width: number; height: number } | null = null
      observer = new ResizeObserver(() => {
        cy.resize()
        const next = { width: cy.width(), height: cy.height() }
        if (next.width > 0) setCompact(next.width < 720)
        if (
          next.width > 0 &&
          next.height > 0 &&
          (!fitted || (size && (next.width !== size.width || next.height !== size.height)))
        ) {
          fit.current()
          fitted = true
        }
        if (next.width > 0 && next.height > 0) size = next
      })
      observer.observe(element)
      theme = new MutationObserver(() => cy.style(styles()))
      theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    } catch {
      queueMicrotask(() => setFailed(true))
    }
    return () => {
      observer?.disconnect()
      theme?.disconnect()
      graph.current?.destroy()
      graph.current = null
    }
  }, [visibleNodes, visibleEdges, compact])
  useEffect(() => {
    const cy = graph.current
    if (cy) {
      cy.$(':selected').unselect()
      if (selectedId)
        cy.nodes()
          .filter((node) => node.id() === selectedId)
          .select()
    }
  }, [selectedId, visibleNodes])
  useEffect(() => {
    const cy = graph.current
    if (!cy) return
    const target = cy.getElementById(hoveredId ?? selectedId ?? '')
    const related = target.isNode() ? target.closedNeighborhood() : cy.collection()
    const connections = related.edges()
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const speed =
      parseFloat(getComputedStyle(holder.current!).getPropertyValue('--lumi-graph-flow-speed')) ||
      10
    let frame = 0
    const stop = () => {
      cancelAnimationFrame(frame)
      frame = 0
      if (!cy.destroyed()) connections.removeClass('graph-flow').removeStyle('line-dash-offset')
    }
    const update = () => {
      stop()
      cy.batch(() => {
        cy.elements().removeClass('graph-muted graph-related graph-focused')
        if (target.isNode()) {
          cy.elements().difference(related).addClass('graph-muted')
          related.addClass('graph-related')
          target.addClass('graph-focused')
        }
      })
      if (!active || mode !== 'graph' || document.hidden || media.matches || !connections.length)
        return
      connections.addClass('graph-flow')
      let previous: number | null = null
      const flow = (time: number) => {
        flowOffset.current = advanceGraphFlow(
          flowOffset.current,
          previous === null ? 0 : time - previous,
          speed,
          cy.zoom(),
        )
        previous = time
        connections.style('line-dash-offset', flowOffset.current)
        frame = requestAnimationFrame(flow)
      }
      frame = requestAnimationFrame(flow)
    }
    media.addEventListener('change', update)
    document.addEventListener('visibilitychange', update)
    update()
    return () => {
      stop()
      media.removeEventListener('change', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [hoveredId, selectedId, active, mode, visibleNodes, visibleEdges])
  useEffect(() => {
    if (active && mode === 'graph') requestAnimationFrame(() => graph.current?.resize())
    else queueMicrotask(() => setHoveredId(null))
  }, [active, mode])
  const list = mode === 'list' || failed
  return (
    <section className="ui-graph" aria-label={t('知识关系')}>
      <div className="ui-graph-toolbar">
        <Segmented
          label={t('知识关系视图')}
          value={list ? 'list' : 'graph'}
          onValueChange={setMode}
          items={[
            { value: 'graph', label: t('图谱'), disabled: failed },
            { value: 'list', label: t('关系清单') },
          ]}
        />
        <div className="ui-graph-actions" hidden={list}>
          <IconButton
            label={t('缩小图谱')}
            title={t('缩小')}
            onClick={() => {
              const cy = graph.current
              if (cy) cy.zoom(cy.zoom() / 1.2)
            }}
          >
            <ZoomOut size={18} />
          </IconButton>
          <IconButton
            label={t('放大图谱')}
            title={t('放大')}
            onClick={() => {
              const cy = graph.current
              if (cy) cy.zoom(cy.zoom() * 1.2)
            }}
          >
            <ZoomIn size={18} />
          </IconButton>
          <IconButton label={t('适应图谱')} title={t('适应窗口')} onClick={() => fit.current()}>
            <Maximize size={18} />
          </IconButton>
        </div>
      </div>
      <div className="ui-graph-viewport" hidden={list} onPointerLeave={() => setHoveredId(null)}>
        <div className="ui-graph-canvas" ref={holder} aria-hidden="true" />
        <div className="ui-graph-legend" ref={legend} aria-label={t('节点类型')}>
          <span data-kind="project">{t('项目')}</span>
          <span data-kind="module">{t('模块')}</span>
          <span data-kind="concept">{t('概念')}</span>
          <span data-kind="symbol">{t('符号')}</span>
          {(truncated || visibleNodes.length < nodes.length) && (
            <span>
              {t('已显示 ')}
              {visibleNodes.length}/{nodes.length} {t(' 节点')}
            </span>
          )}
        </div>
      </div>
      {list && (
        <div className="ui-graph-list">
          {nodes.map((node) => (
            <section key={node.id}>
              <SurfaceButton
                className="ui-tree-item"
                aria-pressed={selectedId === node.id}
                onClick={() => onSelect(node.id)}
              >
                {node.label}
              </SurfaceButton>
              <ul>
                {edges
                  .filter((edge) => edge.from === node.id)
                  .map((edge) => (
                    <li key={edge.id}>
                      <span>
                        {relationLabels[edge.type]}
                        {edge.evidenceKind === 'inferred' ? t(' · 推断') : ''}
                      </span>
                      <SurfaceButton className="ui-graph-link" onClick={() => onSelect(edge.to)}>
                        {nodes.find((node) => node.id === edge.to)?.label ?? edge.to}
                      </SurfaceButton>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
