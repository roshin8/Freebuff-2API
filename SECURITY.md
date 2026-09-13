# Security policy

## Security boundaries

Freebuff2API starts its gateway on `127.0.0.1` by default. The embedded
dashboard is accepted only from the configured loopback origin, and captured
Freebuff session cookies are posted only to the local gateway on that
loopback port. The wrapper does not send captured cookies to another host and
does not read account passwords.

The isolated login window admits Freebuff HTTPS hosts and only these OAuth
provider origins: `https://github.com`, `https://accounts.google.com`, and
`https://appleid.apple.com`. Provider subdomains, alternate ports, URL
credentials, and unrelated origins are denied. Allowed popups are routed into
the guarded login window. Cookie capture queries only `https://freebuff.com`
and automatic import runs only after a Freebuff completion URL; provider
navigation cannot trigger import. Each import reads the current local JSON
API key configuration, so successful dashboard key changes apply immediately.

The gateway persists its configuration and local data in
`~/Library/Application Support/Freebuff2API`. Its configured credential/token
data path is `data/tokens.json`; treat the entire application-support directory
as sensitive because it can also contain configuration, logs, imported
credentials, and local browser-session state.

## Release trust

This application is not signed with an Apple Developer certificate and is not
notarized. macOS Gatekeeper warnings are therefore expected. Verify a release
artifact against the `SHA256SUMS.txt` file published with the same GitHub
release before installing it. Do not use quarantine-removal instructions for
an artifact that has not passed that checksum verification.

The gateway source is an unofficial, reverse-engineered implementation of an
upstream service. Its behavior, service compatibility, and account-related
risks can change outside this wrapper project. Use it only if you understand
and accept that risk, and do not treat it as an official Freebuff product.

## Reporting a vulnerability

Please report vulnerabilities privately through this repository's
[GitHub private security advisories](https://github.com/roshin8/Freebuff-2API/security/advisories/new).
Include affected versions, reproduction steps, and impact. Do not include
passwords, session cookies, API keys, or other credentials in a report.
