// SPDX-License-Identifier: MPL-2.0
import type { UsageRecord } from '@lumiplug/shared'
import type { ReactNode } from 'react'
import { Badge, Card, DataText } from './ui'
import { tokenNumber, usageNames } from '../lib/usage'
import { compactTokens } from '../lib/usage-dashboard'

export function UsageRecordTable({
  records,
  empty,
  busy = false,
  label = '会话用量记录',
}: {
  records: UsageRecord[]
  empty?: ReactNode
  busy?: boolean
  label?: string
}) {
  return (
    <div className="usage-record-table-scroll">
      <div
        role="table"
        aria-label={label}
        aria-colcount={8}
        aria-busy={busy || undefined}
        className="usage-record-table"
      >
        <div role="row" className="usage-record-row usage-record-header">
          {['时间', '模型', '输入', '输出', '缓存读取', '缓存写入', '总计', '来源'].map((name) => (
            <span role="columnheader" key={name}>
              <DataText muted>{name}</DataText>
            </span>
          ))}
        </div>
        <div role="rowgroup" aria-label="用量记录列表" className="usage-record-list" tabIndex={0}>
          {records.map((row) => (
            <UsageRecordCard key={row.id} row={row} embedded />
          ))}
          {!records.length && (
            <div role="row" className="usage-record-empty">
              <span role="cell" aria-colspan={8}>
                {empty ?? <DataText muted>暂无会话记录。</DataText>}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function UsageRecordCard({
  row,
  embedded = false,
}: {
  row: UsageRecord
  embedded?: boolean
}) {
  const quality =
    row.quality === 'reported'
      ? '来源已报告'
      : row.quality === 'estimated'
        ? '来源估算'
        : row.quality === 'context_snapshot'
          ? '上下文快照'
          : '缺少用量'
  const inputLabel = `输入${row.inputIncludesCache === true ? '（含缓存）' : row.inputIncludesCache === false ? '（不含缓存）' : '（缓存语义未知）'}`
  if (embedded) {
    return (
      <div role="row" className="usage-record-row">
        <span role="cell" className="usage-record-time" title={new Date(row.time).toLocaleString()}>
          <DataText mono>
            <time dateTime={row.time}>{new Date(row.time).toLocaleString()}</time>
          </DataText>
        </span>
        <span role="cell" className="usage-record-model" title={row.model ?? '未知模型'}>
          <DataText>{row.model ?? '未知模型'}</DataText>
        </span>
        {[
          { label: '输入', description: inputLabel, value: row.input },
          { label: '输出', description: '输出', value: row.output },
          { label: '缓存读', description: '缓存读取', value: row.cacheRead },
          { label: '缓存写', description: '缓存写入', value: row.cacheWrite },
          { label: '总计', description: '总计', value: row.total },
        ].map(({ label, description, value }) => (
          <span
            key={label}
            className="usage-record-value"
            role="cell"
            title={`${description} ${tokenNumber(value)} Token`}
            aria-label={`${description} ${tokenNumber(value)} Token`}
          >
            <DataText mono>{compactTokens(value)}</DataText>
          </span>
        ))}
        <span role="cell">
          <Badge>{quality.replace(/^来源/, '')}</Badge>
        </span>
      </div>
    )
  }
  return (
    <Card>
      <div className="usage-section-heading">
        <strong>
          {usageNames[row.software]} · {row.model ?? '未知模型'}
        </strong>
        <Badge>{quality}</Badge>
      </div>
      <p>
        <time dateTime={row.time}>{new Date(row.time).toLocaleString()}</time> · 会话{' '}
        {row.sessionName?.trim() || row.session}
      </p>
      <dl className="usage-detail-values">
        <div>
          <dt>总 Token</dt>
          <dd>{tokenNumber(row.total)}</dd>
        </div>
        <div>
          <dt>
            输入
            {row.inputIncludesCache === true
              ? '（含缓存）'
              : row.inputIncludesCache === false
                ? '（不含缓存）'
                : '（缓存语义未知）'}
          </dt>
          <dd>{tokenNumber(row.input)}</dd>
        </div>
        <div>
          <dt>输出</dt>
          <dd>{tokenNumber(row.output)}</dd>
        </div>
        <div>
          <dt>缓存读取 / 写入</dt>
          <dd>
            {tokenNumber(row.cacheRead)} / {tokenNumber(row.cacheWrite)}
          </dd>
        </div>
      </dl>
    </Card>
  )
}
