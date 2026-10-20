// SPDX-License-Identifier: MPL-2.0
import { t, getLocale } from '../i18n'
import type { UsageReport, UsageScanStatus, UsageSoftware } from '@lumiplug/shared'
import { usageSoftwareNames } from '@lumiplug/shared'

export interface ScanWatchState {
  round: string
  revision: number
  intermediate: boolean
  terminal: boolean
}
/** At most one intermediate commit and one terminal refresh per observed round. */
export function observeScan(previous: ScanWatchState | null, status: UsageScanStatus) {
  const round = `${status.id}:${status.startedAt ?? ''}`
  const terminal = status.state !== 'scanning'
  const changedRound = previous !== null && previous.round !== round
  const committed = previous !== null && previous.revision !== status.revision
  const intermediate = !changedRound && (previous?.intermediate ?? false)
  const refresh =
    previous !== null &&
    ((terminal && (changedRound || !previous.terminal)) ||
      (!terminal && committed && !intermediate))
  return {
    refresh,
    next: {
      round,
      revision: status.revision,
      terminal,
      intermediate: intermediate || (!terminal && refresh),
    },
  }
}

export const scanLabels: Record<UsageScanStatus['state'], string> = {
  get idle() {
    return t('等待扫描')
  },
  get scanning() {
    return t('扫描中')
  },
  get complete() {
    return t('本轮已完成')
  },
  get partial() {
    return t('本轮结束 · 部分覆盖')
  },
  get failed() {
    return t('本轮扫描失败')
  },
  get paused() {
    return t('采集已暂停')
  },
}

export function scanDescription(status: UsageScanStatus, software: UsageSoftware | 'all') {
  const sources = status.sources.filter(
    (source) =>
      source.filesProgress &&
      (software === 'all' ? source.filesProgress.discovered > 0 : source.software === software),
  )
  const parts: string[] = []
  if (status.state === 'scanning') {
    parts.push(
      status.currentSoftware ? usageSoftwareNames[status.currentSoftware] : t('正在发现来源'),
    )
    if (status.providersTotal)
      parts.push(t('来源 {v0}/{v1}', { v0: status.providersDone, v1: status.providersTotal }))
  }
  if (sources.length) {
    const counts = sources.reduce(
      (sum, source) => {
        const progress = source.filesProgress!
        for (const key of [
          'discovered',
          'checked',
          'read',
          'cached',
          'deferred',
          'limited',
          'failed',
        ] as const)
          sum[key] += progress[key]
        return sum
      },
      { discovered: 0, checked: 0, read: 0, cached: 0, deferred: 0, limited: 0, failed: 0 },
    )
    const names = sources.map((source) => usageSoftwareNames[source.software]).join(' / ')
    parts.push(
      t('{v0} 文件：已检查 {v1}/{v2}，读取 {v3}，缓存 {v4}', {
        v0: names,
        v1: counts.checked,
        v2: counts.discovered,
        v3: counts.read,
        v4: counts.cached,
      }),
    )
    if (sources.some((source) => source.filesProgress?.stage === 'discovering'))
      parts.push(t('文件发现中'))
    if (counts.deferred) parts.push(t('{v0} 个待下轮', { v0: counts.deferred }))
    if (counts.limited) parts.push(t('{v0} 个受限', { v0: counts.limited }))
    if (counts.failed) parts.push(t('{v0} 个读取失败', { v0: counts.failed }))
    if (sources.some((source) => source.filesProgress?.discoveryLimited))
      parts.push(t('发现范围受限，未发现数量未知'))
  }
  if (status.state === 'partial') {
    if (status.sources.some((source) => source.problems?.includes('missing_usage')))
      parts.push(t('部分请求未报告用量'))
    if (status.sources.some((source) => source.problems?.includes('identity_unverified')))
      parts.push(t('部分来源身份待确认，可能重复'))
    if (
      !sources.some((source) => {
        const p = source.filesProgress!
        return p.deferred || p.limited || p.failed || p.discoveryLimited
      }) &&
      !status.sources.some(
        (source) =>
          source.problems?.includes('missing_usage') ||
          source.problems?.includes('identity_unverified'),
      )
    )
      parts.push(t('部分来源受限，已有记录已保留'))
  }
  if (status.state === 'complete') parts.push(t('仅表示本轮已发现范围，不保证全部历史覆盖'))
  return parts.join(' · ')
}

export function scanFeedback(report: UsageReport): {
  message: string
  tone: 'success' | 'info' | 'error'
} {
  const status = report.scan
  const sources = status?.sources ?? report.sources
  if (status?.state === 'failed')
    return { message: t('本轮扫描失败，已保留已有记录，请重试。'), tone: 'error' }
  const partial =
    status?.state === 'partial' ||
    sources.some(
      (source) =>
        source.problems?.length ||
        ['partial', 'denied', 'incompatible', 'missing_usage'].includes(source.state),
    )
  const collision = sources.some((source) => source.problems?.includes('identity_unverified'))
  if (partial) {
    const unreadable =
      sources.some((source) => ['denied', 'incompatible'].includes(source.state)) &&
      !sources.some((source) => source.records > 0)
    return {
      message: t('{v0}，已有记录已保留。{v1}{v2}', {
        v0: unreadable ? t('本轮未能读取有效记录') : t('本轮扫描结束，部分覆盖'),
        v1: collision
          ? t('部分来源身份无法确认，统计可能重复。')
          : t('部分文件受限、待下轮或缺少用量。'),
        v2: report.matched === 0 ? t('当前筛选无记录。') : '',
      }),
      tone: unreadable ? 'error' : 'info',
    }
  }
  return report.matched === 0
    ? { message: t('本轮已发现范围扫描完成，当前筛选无记录。'), tone: 'info' }
    : {
        message: t('本轮已发现范围扫描完成，当前筛选有 {v0} 条请求记录。', {
          v0: report.matched.toLocaleString(getLocale()),
        }),
        tone: 'success',
      }
}
