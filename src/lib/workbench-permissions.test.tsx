// SPDX-License-Identifier: MPL-2.0

import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { HOME_CONTENT_SECURITY_POLICY } from '@lumiplug/shared'
import WorkbenchContent from '../components/WorkbenchContent'

vi.mock('../components/ToastProvider', () => ({ useToast: () => vi.fn() }))

describe('homepage browser permissions and host isolation', () => {
  it('opens browser capabilities without allowing the page or popups to become the host', () => {
    const html = renderToStaticMarkup(
      <WorkbenchContent
        headingRef={createRef<HTMLHeadingElement>()}
        view={{
          version: 1,
          updatedAt: null,
          compatible: true,
          runtimeUrl: 'http://127.0.0.1:12345/home/test/1/index.html',
          manifest: {
            formatVersion: 2,
            template: 'lumi-html-home',
            lumiVersion: '0.1.4',
            sdkVersion: '0.1.4',
            bridgeVersion: 1,
            projectId: 'f06cb86e-b41c-418e-9034-c92325d76732',
            name: '权限验证',
            entry: 'index.html',
          },
        }}
        active
        ready
        loadError={false}
        onRetry={() => {}}
      />,
    )
    const sandbox = html.match(/sandbox="([^"]+)"/)![1]!.split(' ')
    for (const permission of ['allow-scripts', 'allow-forms', 'allow-downloads', 'allow-popups'])
      expect(sandbox).toContain(permission)
    for (const permission of [
      'allow-same-origin',
      'allow-top-navigation',
      'allow-top-navigation-by-user-activation',
      'allow-popups-to-escape-sandbox',
    ])
      expect(sandbox).not.toContain(permission)
    // A restrictive second sandbox on the HTTP response would silently undo
    // iframe permissions; a broader one could weaken the standalone resource.
    expect(HOME_CONTENT_SECURITY_POLICY.split('; ').find((part) => part.startsWith('sandbox ')))
      .toBe(`sandbox ${sandbox.join(' ')}`)
    expect(html).toContain('fullscreen *')
    expect(html).toContain('clipboard-write *')
    expect(html).toContain('camera *')
    expect(html).toContain('referrerPolicy="no-referrer"')
  })
})
