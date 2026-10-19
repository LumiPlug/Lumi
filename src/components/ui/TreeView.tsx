// SPDX-License-Identifier: MPL-2.0
import { t, useLocale } from '../../i18n'
import { useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react'
import { SurfaceButton } from './controls'

export interface TreeItem {
  id: string
  parentId: string | null
  title: string
  order: number
}
export function TreeView({
  items,
  selectedId,
  onSelect,
  label = t('知识目录'),
}: {
  items: TreeItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  label?: string
}) {
  useLocale()

  const [expandedItems, setExpandedItems] = useState(new Map<string, boolean>())
  const [focused, setFocused] = useState<string | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const children = useMemo(() => {
    const map = new Map<string | null, TreeItem[]>()
    for (const item of items) {
      const siblings = map.get(item.parentId) ?? []
      siblings.push(item)
      map.set(item.parentId, siblings)
    }
    for (const siblings of map.values())
      siblings.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
    return map
  }, [items])
  const isExpanded = (item: TreeItem) => expandedItems.get(item.id) ?? item.parentId === null
  const visible: { item: TreeItem; level: number; size: number; position: number }[] = []
  const walk = (parentId: string | null, level: number, visited: Set<string>) => {
    const siblings = children.get(parentId) ?? []
    siblings.forEach((item, index) => {
      if (visited.has(item.id)) return
      visible.push({ item, level, size: siblings.length, position: index + 1 })
      if (isExpanded(item)) walk(item.id, level + 1, new Set([...visited, item.id]))
    })
  }
  walk(null, 1, new Set())
  const focusId = visible.some((row) => row.item.id === focused)
    ? focused
    : visible.some((row) => row.item.id === selectedId)
      ? selectedId
      : visible[0]?.item.id
  const focus = (id?: string) => {
    if (id) {
      setFocused(id)
      buttons.current.get(id)?.focus()
    }
  }
  const toggle = (item: TreeItem) =>
    setExpandedItems((current) => {
      const next = new Map(current)
      next.set(item.id, !(current.get(item.id) ?? item.parentId === null))
      return next
    })
  return (
    <div role="tree" aria-label={label} className="ui-tree">
      {visible.map(({ item, level, size, position }, index) => {
        const folder = children.has(item.id),
          expanded = isExpanded(item)
        return (
          <SurfaceButton
            key={item.id}
            ref={(element) => {
              if (element) buttons.current.set(item.id, element)
              else buttons.current.delete(item.id)
            }}
            role="treeitem"
            aria-level={level}
            aria-setsize={size}
            aria-posinset={position}
            aria-selected={selectedId === item.id}
            aria-expanded={folder ? expanded : undefined}
            tabIndex={focusId === item.id ? 0 : -1}
            className="ui-tree-item"
            style={{ paddingLeft: 8 + (level - 1) * 16 }}
            title={item.title}
            onFocus={() => setFocused(item.id)}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => {
              if (
                ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                  event.key,
                )
              )
                event.preventDefault()
              if (event.key === 'ArrowDown') focus(visible[index + 1]?.item.id)
              if (event.key === 'ArrowUp') focus(visible[index - 1]?.item.id)
              if (event.key === 'Home') focus(visible[0]?.item.id)
              if (event.key === 'End') focus(visible.at(-1)?.item.id)
              if (event.key === 'ArrowRight' && folder) {
                if (!expanded) toggle(item)
                else focus(children.get(item.id)?.[0]?.id)
              }
              if (event.key === 'ArrowLeft') {
                if (folder && expanded) toggle(item)
                else focus(item.parentId ?? undefined)
              }
            }}
          >
            <span
              className="ui-tree-chevron"
              onClick={(event) => {
                if (folder) {
                  event.stopPropagation()
                  toggle(item)
                }
              }}
            >
              {folder ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
            </span>
            {folder ? <Folder size={16} /> : <FileText size={16} />}
            <span className="ui-tree-title">{item.title}</span>
          </SurfaceButton>
        )
      })}
    </div>
  )
}
