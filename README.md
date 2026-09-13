# Freebuff2API for macOS

Freebuff2API for macOS is an independent, unsigned Electron wrapper maintained
by `roshin8`. It is not a GitHub fork and does not include the upstream Rust
source. This wrapper builds the gateway from the audited upstream
[Freebuff-2API](https://github.com/lza6/Freebuff-2API) release pinned to
`v0.7.3` (`506240d7deef1272ed05313ed72f7d9f11785e89`). Wrapper releases use
their own version numbers; the current wrapper version is `0.1.2`.

The bundled dashboard is in English. Builds apply the audited
[English UI patch](patches/upstream-v0.7.3/english-dashboard.patch) to the exact
upstream pin before compiling. It covers dashboard labels, client examples,
generated views, diagnostics, and gateway UI messages. Account names, your
skills and memories, and messages from external services retain their original
content.

## Download and install

Requires macOS 13 (Ventura) or later.

Download the asset that matches your Mac from the
[latest release](https://github.com/roshin8/Freebuff-2API/releases/latest):

| Mac processor | Release asset suffix |
| --- | --- |
| Apple Silicon (M1, M2, M3, M4, or later) | `-arm64.dmg` |
| Intel | `-x64.dmg` |

Download the matching `SHA256SUMS.txt` release asset too. In the directory
that contains both files, verify the DMG before opening it. For example, for
an Apple Silicon release:

```bash
grep 'Freebuff2API-.*-arm64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -
```

Use `-x64.dmg` instead for an Intel Mac. The command must report `OK`. Do not
open, install, or remove quarantine from an artifact whose checksum does not
match the published checksum.

Open the verified DMG in Finder and drag `Freebuff2API.app` to
`Applications`. The application is unsigned and unnotarized. On its first
launch, Control-click (or right-click) `Freebuff2API.app` in Applications,
choose **Open**, and then confirm **Open** in the dialog.

If macOS continues to show a quarantine warning *after* you have verified the
checksum for an artifact downloaded from this repository, you may remove that
quarantine attribute:

```bash
xattr -dr com.apple.quarantine /Applications/Freebuff2API.app
```

## First use

On a successful gateway startup, Freebuff2API opens its local dashboard at
`127.0.0.1`. Choose **Login New Account** from the menu bar tray icon, complete
the Freebuff login in the dedicated window, and wait for the wrapper to import
the session into the local gateway. The wrapper does not read your password;
captured cookies are sent only to the loopback gateway. If login import fails,
the login window stays open and shows the reason. The upstream dashboard's
manual import options remain available as alternatives. If the gateway cannot
start, use the configuration and log paths reported by the application to
troubleshoot before attempting login.

The dashboard's **Client setup** tab includes a copy-ready OpenCode provider
configuration generated from the running gateway's URL, current API-key state,
and an available model ID. Merge its `provider` block into
`~/.config/opencode/opencode.jsonc`, restart OpenCode, and run `/models`.

The application keeps its configuration, gateway data, credentials, logs, and
login-related local state under:

```
~/Library/Application Support/Freebuff2API
```

The configuration file is `config.yaml`, containing JSON as required by the
pinned gateway. Existing YAML settings are backed up to `config.yaml.bak`
before an atomic conversion to JSON on startup. Values are preserved;
the backup retains the original comments and formatting. Gateway logs
are in `logs/`. You can also open the configuration, logs, or data directory
from the tray menu.

## Uninstall

Quit Freebuff2API from its tray menu, then move `Freebuff2API.app` from
Applications to the Trash. To also permanently remove its local configuration,
credentials, logs, and data, delete this directory:

```bash
rm -rf "$HOME/Library/Application Support/Freebuff2API"
```

This deletion cannot be undone.

## Security and development

Read [SECURITY.md](SECURITY.md) for the application's security boundaries and
responsible-disclosure process. Contributors should follow
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md); upstream changes are governed by
[docs/UPDATING-UPSTREAM.md](docs/UPDATING-UPSTREAM.md).
