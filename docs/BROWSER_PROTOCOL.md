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
