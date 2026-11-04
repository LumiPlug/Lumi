# Lumi Browser loopback protocol v1

Browser tools run inside Lumi Core. The Chrome extension connects directly to
`ws://127.0.0.1:43127/ws`; no Native Messaging host or browser-specific child process
is started. Existing Lumi MCP transports are unchanged.

## Trust and lifecycle

The desktop host alone may enable, disable, or explicitly reset stored credentials. Existing
MCP callers cannot grant those permissions. The listener requires the exact Host,
path (no query), and official `chrome-extension://hfhigjgopbjmojflbhhnahpfpnmiaman`
Origin. Origin is browser CSRF defense, not authentication of local executables.
Opening settings diagnoses only; explicit connection enables the listener.
Disabling closes sockets, invalidates sessions and pending work, and does not
permit extension retries to enable it again.

## First connection: trust on first use (TOFU)

Clicking Connect is the explicit local enable action. It opens a bounded 120-second
enrollment window in Core, bound to the current listener lifecycle. Opening settings
only diagnoses. Startup restoration without a stored credential does not open
registration; the user must click Connect. Only one enrollment candidate is accepted
at a time; timeout, closing, or a newer explicit connection attempt cancels the old
candidate. Success closes enrollment.

Both peers exchange role-bound commitments, then fresh P-256 public keys and
nonces. The protocol automatically derives and pins a shared secret after the
transcript is consistent. There is **no displayed short code, human code approval,
or pre-existing identity anchor**. ECDH proves possession of the peer's fresh key,
not that the peer is the intended Lumi or extension. The initial connection can be
intercepted or impersonated by a local program able to claim the loopback port or
forge an extension Origin. TOFU explicitly does not protect against that adversary.
Ordinary browser pages and other extension Origins remain blocked.

Core and extension retain the credential for subsequent mutual proof verification.
The extension persists only after verifying the server proof; this is confirmation
of the just-established TOFU key, not independent first-contact authentication.
Existing valid credentials from earlier versions remain valid. A failed proof never
automatically deletes a pin or re-enters enrollment. Partial persistence or profile
changes require explicit recovery, not silent replacement.

## Reconnection and messages

`auth_hello` carries a fresh client nonce. Core replies with a fresh server nonce
and role-separated HMAC server proof. Only after verification does the extension
return the client proof. Neither connection transmits the long-term credential.
Fresh directional AES-GCM keys are derived for each connection. Business frames
are `{type:"secure",seq,data}` with monotonically increasing sequence numbers,
direction/session-associated data, and authenticated encryption. Replays,
reflections, malformed frames and failed tags close the channel; no bearer fallback
exists. Plaintext payloads are limited to 512 KiB; framed WebSocket payloads to
1 MiB. Pre-authentication payload, pending connection and queue limits are smaller.
Authenticated heartbeat and deadlines bound idle or stalled connections.

Business commands remain schema-validated operations, not arbitrary
CDP. A shared Lumi control domain serializes callers; it is **not** per-Agent
isolation. Policy revisions, session identities and cancellation epochs remain
independent defenses. A click whose outcome is uncertain is never replayed.

## Storage and limits

One Core pairing is bound to one Chrome profile. The Core pairing file contains a
usable secret, not a harmless hash: POSIX ownership and modes 0700/0600 are checked;
Windows relies on the user's data-directory ACL. Extension credential access is
limited to trusted extension contexts. Credentials are never put in URLs, logs,
status responses, source control, or MCP output. This does not defend against
malware able to read the same user's credential files or local denial of service.
Explicit credential reset invalidates the old connection; a new explicit Connect
action opens a fresh TOFU window. Authentication failure never automatically replaces
a stored credential. Browser-required permission prompts remain under user control.

Implementation: `packages/core/src/browser/secure-crypto.ts`,
`websocket-transport.ts`, `service.ts`, `controller.ts`; extension counterparts
`extension/security.mjs` and `extension/transport.mjs` in LumiBrowserMCP.
Automated tests use real loopback WebSockets and MCP with a simulated Chrome peer;
actual Chrome/UI/operating-system acceptance remains separate.

## 2026-11-04 本机直接连接更新

此节取代前文关于持久信任、120 秒登记窗口和重新配对的描述。Browser User 开启后，扩展自动连接固定 loopback 端口；每次连接以临时 ECDH 密钥协商建立加密会话，不保存跨连接凭证，不需要用户重新配对。升级自动删除本功能拥有的旧配对记录。Chrome 扩展固定身份、HTTP(S) 网页规则、暂停、用户接管、串行控制和不重放不确定操作继续生效。扩展和 Lumi 均需升级。本机进程可以伪装服务或来源，此模式不验证已配对设备的身份连续性。Lumi MCP 面向 Agent 的令牌独立保留。

## Common action extension (2026-11-05)

The browser tool catalog now has 20 entries. New session-scoped operations are
`activate_tab`, `close_tab`, `go_back`, `go_forward`, `hover`, `press_key`,
`select_option`, and `set_checked`. `open_tab.active` is optional and defaults to
false. `click.button` is left/right/middle and `click.clickCount` is 1/2.
All operations retain the existing policy/epoch/shared-queue checks. History
navigation inspects the destination with Page.getNavigationHistory before
Page.navigateToHistoryEntry. Session removal during explicit close or history
navigation does not prematurely discard its pending response. Unknown outcomes
remain non-retryable. Keys are an enumerated page-key set with optional Shift;
no arbitrary CDP, JavaScript, file-system paths or browser shortcuts are exposed.

## Advanced browser actions (Lumi 0.1.8 / extension 0.6.0)

The catalog now exposes 39 bounded tools. `advanced-tools.json` is mirrored by
extension/advanced-catalog.mjs; both sides reject unknown fields and arbitrary
JavaScript/CDP commands. New tools cover tab state and waits, document-bound
iframe actions, accessibility references, uploads/downloads, JavaScript dialogs,
opt-in diagnostics, drag/touch, captures/PDF, table extraction, and emulation.

Frame tokens expire after 60 seconds and are checked against documentId and URL;
semantic references expire after 30 seconds and exclude child-frame content.
DOM event actions explicitly return `inputMode: dom_events`. A dialog interrupts
the triggering operation, returns `dialogPending` without replaying remaining
steps, and requires a separate explicit accept/dismiss action.

Uploads require absolute existing regular files, no symbolic links, at most
100 MiB per file; selection does not submit a form. Downloads require Chrome's
downloads permission and expose only IDs associated with the current session.
Page-triggered downloads are associated by exact referrer; stripped referrers
are not guessed. New-tab waits use opener IDs or observed navigation-target
creation and expose only allowed sessions.

Diagnostics are opt-in, bounded to 200 events; headers are not collected.
Common credential fields and URL queries are redacted, but this is not a complete
PII detector. Explicit text response-body reads remain bounded and marked as
untrusted page data. Captures/PDF use session-bound internal chunks, at most
20 MiB, and are validated and stored under Core's browser-artifacts directory
with exclusive random filenames and SHA-256. Partial files are removed; the
directory allows at most 100 artifacts. Artifact chunks are not public tools.

Emulation supports viewport, device scale, touch and network conditions; reset
restores defaults. Native browser dialogs/menus, OS file pickers, arbitrary
JavaScript, privileged pages and arbitrary CDP access remain unsupported.
