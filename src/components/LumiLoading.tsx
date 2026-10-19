// SPDX-License-Identifier: MPL-2.0
import { t, useLocale } from '../i18n'
export default function LumiLoading() {
  useLocale()

  return (
    <div className="lumi-loading" role="status" aria-label={t('正在加载 Lumi')}>
      <span aria-hidden="true">Lumi</span>
    </div>
  )
}
