# Lumi Browser loopback protocol v1

Browser tools run inside Lumi Core. The Chrome extension connects directly to
`ws://127.0.0.1:43127/ws`; no Native Messaging host or browser-specific child process
is started. Existing Lumi MCP transports are unchanged.

## Trust and lifecycle

The desktop host alone may enable, disable, approve, or reset pairing. Existing
MCP callers cannot grant those permissions. The listener requires the exact Host,
path (no query), and official `chrome-extension://hfhigjgopbjmojflbhhnahpfpnmiaman`
Origin. Origin is browser CSRF defense, not authentication of local executables.
Opening settings diagnoses only; explicit connection enables the listener.
Disabling closes sockets, invalidates sessions and pending work, and does not
permit extension retries to enable it again.

## First pairing

1. Both peers generate fresh P-256 ECDH keys and 32-byte nonces.
2. Exchange role-bound SHA-256 commitments before revealing the public keys and
   nonces. Verify each revelation against its commitment.
3. Derive the pairing secret and six-digit SAS using HKDF over the shared ECDH
   value and canonical transcript. Display the same SAS in Lumi and the extension.
4. The user must confirm both displays. Approval names the exact candidate ID and
   code, bound to a live socket and expiring candidate, never a future candidate.
5. Core stores the credential only after both confirmations. The extension stores
   its credential only after verifying the server proof in the next handshake.
   A partial storage failure requires explicit re-pairing, not silent replacement.

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

Business commands remain schema-validated seven-tool operations, not arbitrary
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
Explicit re-pairing invalidates the old connection and requires a new two-display
confirmation; it must not auto-replace a credential after an authentication error.

Implementation: `packages/core/src/browser/secure-crypto.ts`,
`websocket-transport.ts`, `service.ts`, `controller.ts`; extension counterparts
`extension/security.mjs` and `extension/transport.mjs` in LumiBrowserMCP.
Automated tests use real loopback WebSockets and MCP with a simulated Chrome peer;
actual Chrome/UI/operating-system acceptance remains separate.
