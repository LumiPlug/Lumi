// SPDX-License-Identifier: MPL-2.0
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button, IconButton, Input, Switch, Textarea } from '../components/ui/controls'
import { StageSection } from '../components/ui/StageSection'
import { Field } from '../components/ui/Field'
import { InputHint } from '../components/ui/InputHint'
import { Tooltip } from '../components/ui/Tooltip'
import { nextChoiceIndex, Tabs } from '../components/ui/choice'
import { ExpandableTable } from '../components/ui/DataDashboard'

describe('shared UI interaction contract', () => {
  it('distinguishes table navigation from disclosure for assistive technology', () => {
    const props = {
      label: '会话',
      rows: [{ id: 'one', name: '示例会话' }],
      columns: [{ key: 'name', label: '名称', render: (row: { name: string }) => row.name }],
      rowKey: (row: { id: string }) => row.id,
      rowName: (row: { name: string }) => row.name,
    }
    const navigation = renderToStaticMarkup(<ExpandableTable {...props} onRowOpen={() => {}} />)
    expect(navigation).toContain('aria-label="查看示例会话的明细"')
    expect(navigation).not.toContain('aria-expanded')
    expect(navigation).not.toContain('aria-controls')
    expect(navigation).not.toContain('ui-data-table-expansion')
    const disclosure = renderToStaticMarkup(
      <ExpandableTable {...props} renderExpanded={() => <p>记录</p>} />,
    )
    expect(disclosure).toContain('aria-label="展开示例会话"')
    expect(disclosure).toContain('aria-expanded="false"')
    expect(disclosure).toContain('aria-controls=')
    expect(disclosure).toContain('ui-data-table-expansion')
  })
  it('preserves Field label and error association through question hints without submitting the form', () => {
    const html = renderToStaticMarkup(
      <Field label="任务名称" error="名称必填">
        <InputHint id="name" label="任务名称" hint="输入任务名称">
          <Input id="name" aria-describedby="existing" />
        </InputHint>
      </Field>,
    )
    expect(html).toContain('for="name"')
    expect(html).toContain('id="name"')
    expect(html).toContain('aria-describedby="existing name-error"')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('aria-label="任务名称输入提示"')
    expect(html).toContain('lucide-circle-question-mark')
    expect(html).toMatch(/<button[^>]*type="button"/)
    expect(html).toContain('名称必填')
    expect(html).not.toContain('role="tooltip"')
    expect(renderToStaticMarkup(<Tooltip label="现有配置">信息</Tooltip>)).toContain(
      'aria-label="现有配置说明"',
    )
  })
  it('anchors multiline hints separately and omits empty hints while preserving private input masking', () => {
    const multiline = renderToStaticMarkup(
      <InputHint label="内容" hint="多行提示" multiline>
        <Textarea defaultValue={'一\n二'} />
      </InputHint>,
    )
    expect(multiline).toContain('ui-input-hint--multiline')
    expect(multiline).toContain('一\n二')
    for (const hint of ['', '  ', undefined]) {
      const html = renderToStaticMarkup(
        <InputHint label="私有参数" hint={hint}>
          <Input type="password" value="masked" readOnly />
        </InputHint>,
      )
      expect(html).toContain('type="password"')
      expect(html).not.toContain('ui-tooltip-trigger')
      expect(html).not.toContain('ui-input-hint')
    }
  })

  it('skips disabled choices and wraps direction keys without inventing a selection', () => {
    const items = [{}, { disabled: true }, {}, { disabled: true }]
    expect(nextChoiceIndex(items, 0, 'ArrowRight')).toBe(2)
    expect(nextChoiceIndex(items, 2, 'ArrowRight')).toBe(0)
    expect(nextChoiceIndex(items, 0, 'ArrowLeft')).toBe(2)
    expect(nextChoiceIndex(items, 2, 'Home')).toBe(0)
    expect(nextChoiceIndex(items, 0, 'End')).toBe(2)
    expect(nextChoiceIndex(items, 0, 'Enter')).toBeUndefined()
    expect(nextChoiceIndex([{ disabled: true }], 0, 'Home')).toBeUndefined()
  })
  it('preserves native form attributes, busy state and both loading width layers', () => {
    const idle = renderToStaticMarkup(
      <Button aria-busy type="submit" form="config">
        保存
      </Button>,
    )
    const busy = renderToStaticMarkup(
      <Button loading type="submit" form="config">
        保存
      </Button>,
    )
    for (const html of [idle, busy]) {
      expect(html).toContain('type="submit"')
      expect(html).toContain('form="config"')
      expect(html).toContain('aria-busy="true"')
      expect(html).toContain('保存')
      expect(html).toContain('处理中…')
    }
    expect(idle).not.toContain('disabled=""')
    expect(busy).toContain('disabled=""')
    expect(renderToStaticMarkup(<Button>默认操作</Button>)).toContain('type="button"')
  })
  it('keeps icon loading inside its fixed frame with a readable status and hidden glow copy', () => {
    const html = renderToStaticMarkup(
      <IconButton label="运行" loading glow>
        <svg aria-hidden="true" />
      </IconButton>,
    )
    expect(html).toContain('aria-label="运行，处理中"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('ui-icon-glow" aria-hidden="true"')
    expect(html).not.toContain('>处理中…<')
  })
  it('keeps switches native, named, disabled and associated with their form', () => {
    const html = renderToStaticMarkup(
      <Switch
        label="必填"
        checked
        disabled
        name="required"
        form="config"
        aria-describedby="hint"
      />,
    )
    expect(html).toContain('role="switch"')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('checked=""')
    expect(html).toContain('disabled=""')
    expect(html).toContain('name="required"')
    expect(html).toContain('form="config"')
    expect(html).toContain('aria-describedby="hint"')
    expect(html).toContain('必填')
  })
  it('associates labels and validation descriptions while preserving an existing description', () => {
    const html = renderToStaticMarkup(
      <Field label="名称" description="请填写名称" error="名称必填">
        <Input id="name" aria-describedby="existing" />
      </Field>,
    )
    expect(html).toContain('for="name"')
    expect(html).toContain('aria-describedby="existing name-description name-error"')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('id="name-error"')
    const counted = renderToStaticMarkup(
      <Field label="用途">
        <Textarea id="purpose" showCount value="用途" maxLength={1000} readOnly />
      </Field>,
    )
    expect(counted).toContain('for="purpose"')
    expect(counted).toContain('id="purpose"')
    expect(counted).toContain('rows="5"')
    expect(counted).toContain('剩余 998 字')
    expect(counted).toMatch(/aria-describedby="[^"]+"/)
  })
  it('exposes counts and stable panel relationships without changing the controlled value', () => {
    const items = [
      { value: 'installed', label: '已安装', count: 5, id: 'installed', panelId: 'panel' },
      { value: 'archived', label: '已归档', count: 2, disabled: true },
    ]
    let requested = false
    const html = renderToStaticMarkup(
      <Tabs
        label="技能"
        items={items}
        value="installed"
        onValueChange={() => {
          requested = true
        }}
      />,
    )
    expect(requested).toBe(false)
    expect(html).toContain('aria-controls="panel"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('ui-choice-count">5</span>')
    const explicit = renderToStaticMarkup(
      <Tabs
        label="工具"
        items={[{ value: 'all', label: '全部', count: 5, accessibleLabel: '全部，5 个工具' }]}
        value="all"
        onValueChange={() => {}}
      />,
    )
    expect(explicit).toContain('aria-label="全部，5 个工具"')
    expect(explicit).toContain('ui-choice-count" aria-hidden="true"')
  })
  it('separates stage execution state from expansion and exposes only history toggles', () => {
    const current = renderToStaticMarkup(
      <StageSection title="当前" state="current" expanded={false}>
        当前内容
      </StageSection>,
    )
    const pending = renderToStaticMarkup(
      <StageSection title="未来" state="pending" expanded>
        未发生内容
      </StageSection>,
    )
    const past = renderToStaticMarkup(
      <StageSection title="历史" state="past" expanded={false} onExpandedChange={() => {}}>
        历史内容
      </StageSection>,
    )
    expect(current).toContain('aria-current="step"')
    expect(current).not.toContain('<button')
    expect(pending).not.toContain('未发生内容')
    expect(pending).not.toContain('<button')
    expect(past).toContain('aria-expanded="false"')
    expect(past).toContain('hidden=""')
    expect(renderToStaticMarkup(<Button variant="text">参数入口</Button>)).toContain(
      'ui-button--text',
    )
  })
  it('keeps stage outcome separate from expansion and supplies a non-color status', () => {
    const failed = renderToStaticMarkup(
      <StageSection title="运行" state="past" status="failed" expanded />,
    )
    expect(failed).toContain('data-status="failed"')
    expect(failed).toContain('aria-expanded="true"')
    expect(failed).toContain('失败')
    const running = renderToStaticMarkup(
      <StageSection title="运行" state="current" status="running" />,
    )
    expect(running).toContain('ui-stage-spinner')
    expect(running).toContain('运行中')
    expect(
      renderToStaticMarkup(<StageSection title="结果" state="current" status="completed" />),
    ).not.toContain('ui-stage-spinner')
  })
})
