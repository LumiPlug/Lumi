// SPDX-License-Identifier: MPL-2.0
import { t, useLocale } from '../../i18n'
import { SurfaceButton } from './controls'
export function ThemePicker({
  value,
  onValueChange,
}: {
  value: 'dark' | 'light'
  onValueChange: (value: 'dark' | 'light') => void
}) {
  useLocale()

  return (
    <div className="appearance-options" role="group" aria-label={t('主题')}>
      {(['dark', 'light'] as const).map((option) => (
        <SurfaceButton
          type="button"
          key={option}
          className="appearance-option"
          aria-label={t('{v0}主题', { v0: option === 'dark' ? t('深色') : t('浅色') })}
          aria-pressed={value === option}
          onClick={() => onValueChange(option)}
        >
          <span className="appearance-swatch" data-preview-theme={option} aria-hidden="true">
            <span className="appearance-preview-sidebar">
              <i />
              <i />
              <i />
            </span>
            <span className="appearance-preview-content">
              <i />
              <i />
            </span>
            <span className="appearance-preview-label">
              {option === 'dark' ? t('深色') : t('浅色')}
            </span>
          </span>
          {value === option && (
            <svg
              className="appearance-preview-check"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m5 12 4 4 10-10" />
            </svg>
          )}
        </SurfaceButton>
      ))}
    </div>
  )
}
