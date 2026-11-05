// SPDX-License-Identifier: MPL-2.0

// Keep the iframe and response CSP in sync. Opaque origins, top-level navigation
// blocking and inherited popup sandboxing protect the host UI and its secrets.
export const HOME_IFRAME_SANDBOX = [
  'allow-scripts',
  'allow-forms',
  'allow-modals',
  'allow-downloads',
  'allow-popups',
  'allow-pointer-lock',
  'allow-orientation-lock',
  'allow-presentation',
].join(' ')

// Delegate browser features; WebView support, opaque-origin rules, user gestures
// and OS/browser permission prompts still determine which APIs are available.
export const HOME_IFRAME_ALLOW = [
  'accelerometer',
  'ambient-light-sensor',
  'autoplay',
  'bluetooth',
  'camera',
  'clipboard-read',
  'clipboard-write',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'geolocation',
  'gyroscope',
  'hid',
  'idle-detection',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'picture-in-picture',
  'publickey-credentials-create',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'speaker-selection',
  'usb',
  'web-share',
  'window-management',
  'xr-spatial-tracking',
]
  .map((feature) => `${feature} *`)
  .join('; ')

export const HOME_CONTENT_SECURITY_POLICY = [
  'default-src * data: blob:',
  "script-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
  "style-src * data: blob: 'unsafe-inline'",
  'connect-src * data: blob: ws: wss:',
  'worker-src * data: blob:',
  `sandbox ${HOME_IFRAME_SANDBOX}`,
].join('; ')
