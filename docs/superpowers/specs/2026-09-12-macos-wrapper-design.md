# Freebuff2API macOS Wrapper Design

## Objective

Create an independent public repository named `roshin8/Freebuff-2API` that packages the existing Freebuff2API Rust gateway as an unsigned macOS desktop application. The wrapper repository will not be a GitHub fork and will not contain the upstream Rust source. A complete upstream clone remains available locally for inspection and a later full migration.

## Upstream relationship

- Upstream project: `https://github.com/lza6/Freebuff-2API`
- Initial pinned release: `v0.7.3`
- Initial pinned commit: `506240d7deef1272ed05313ed72f7d9f11785e89`
- The wrapper records the repository URL, tag, and full commit SHA in a machine-readable `upstream.json` file.
- Build workflows check out that exact commit into an isolated build directory and compile the gateway from source. They never execute an unpinned upstream branch.
- The repository preserves the upstream MIT license and includes clear attribution. Wrapper-specific code uses the same MIT license.
- Updating upstream is an explicit pull request that changes `upstream.json`, runs the full build/test workflow, and documents upstream release notes. There is no automatic moving-version dependency.

## Repository topology

The standalone wrapper repository contains:

- `desktop/`: the Electron main process, preload bridge, icons, package metadata, and Node tests.
- `scripts/`: deterministic scripts for validating the upstream pin, locating/copying a locally built gateway, and preparing package resources.
- `.github/workflows/`: pull-request validation and tagged macOS release builds.
- `docs/`: installation, Gatekeeper, local development, security, and upstream-update documentation.
- `upstream.json`: immutable source coordinates for the gateway used by a wrapper release.

The complete upstream source clone is kept separately at `work/Freebuff-2API` in this workspace. The wrapper lives at `work/Freebuff-2API-wrapper`; neither directory is nested inside the other.

## Desktop architecture

The existing upstream Electron launcher is adapted into focused modules rather than copied as one platform-entangled file:

1. `desktop/platform.js` resolves the gateway executable name, packaged/development candidate paths, user-facing data paths, and platform-specific UI behavior.
2. `desktop/gateway.js` owns configuration creation, gateway process startup, health polling, logging, restart limits, and clean shutdown.
3. `desktop/login.js` owns the persistent Freebuff login session, session-cookie capture, and localhost credential import.
4. `desktop/main.js` coordinates Electron lifecycle, main window, tray menu, dialogs, and the other modules.
5. `desktop/preload.js` exposes only the existing allowlisted login operations to the dashboard.

The renderer remains the gateway's embedded dashboard served from localhost; the wrapper does not duplicate or redesign that interface.

## Runtime behavior

- On launch, the app finds the bundled gateway at `Contents/Resources/bin/freebuff2api` and verifies that it is executable.
- The app creates its initial configuration under `~/Library/Application Support/Freebuff2API/config.json` with loopback-only listening, no proxy, memory disabled, and upstream startup checks skipped until an account is imported.
- Gateway databases, imported credentials, logs, and skills remain within `~/Library/Application Support/Freebuff2API`.
- The app starts the gateway with the absolute configuration path and the application-support directory as its working directory.
- It waits up to 15 seconds for `/healthz`, then loads the dashboard from the configured loopback port.
- Unexpected gateway exits use a bounded restart policy: at most three restart attempts in 60 seconds, followed by an actionable dialog containing the log location.
- Closing the main window keeps the tray application running. Choosing Quit terminates the child gateway before exiting.
- The tray provides Open Dashboard, Login New Account, Diagnostics, Open Logs, Open Configuration, Open Data Directory, Check for Updates, and Quit.

## Authentication flow

The wrapper uses Electron's persistent session partition to open `https://freebuff.com/`. After a successful navigation, it reads cookies for that origin through Electron's session API and imports a cookie header into the loopback gateway.

The wrapper never reads account passwords and never sends captured cookies anywhere other than `127.0.0.1` on the configured gateway port. Import failures remain visible and keep the login window open. The manual browser-extension and paste-import methods remain available through the upstream dashboard as fallbacks.

## Security boundaries

- The gateway listens only on `127.0.0.1` by default.
- External URLs are opened through the system browser unless they belong to the dedicated Freebuff login window.
- Renderer Node integration is disabled, context isolation is enabled, and the preload bridge exposes only named login operations.
- Navigation and new-window handlers deny unexpected origins.
- Gateway output is treated as text and written to local logs without shell evaluation.
- The upstream commit is pinned. The workflow verifies the checked-out SHA before compiling.
- Release artifacts include SHA-256 checksum files.
- The application is unsigned because no Apple Developer certificate is available. Documentation must not imply code signing or notarization.

## macOS packaging

The first release supports two native packages:

- Apple Silicon (`arm64`) built on GitHub's `macos-15` arm64 runner.
- Intel (`x64`) built on GitHub's `macos-15-intel` runner.

Each runner compiles the Rust gateway for its native architecture, runs Rust tests, installs locked Node dependencies, runs Node tests, packages the matching Electron application, and emits architecture-labelled `.dmg` and `.zip` artifacts. Packages are created with signing discovery disabled.

The application identifier is `com.roshin8.freebuff2api`, the product name is `Freebuff2API`, and release filenames include the wrapper version and architecture. A tag matching `v*` publishes both architectures plus checksums to one GitHub Release.

Because the app is unsigned, in-app installation is disabled. Check for Updates opens the repository's latest-release page in the user's default browser.

## First-launch experience

The README and release notes explain that users must download the package matching their processor and use Finder's right-click → Open flow on first launch. A secondary troubleshooting command is documented for users who still receive a quarantine warning:

```bash
xattr -dr com.apple.quarantine /Applications/Freebuff2API.app
```

The documentation warns users to run that command only on an artifact downloaded from this repository after verifying its published SHA-256 checksum.

## Local development

Local wrapper development uses the separately cloned upstream repository rather than downloading a second copy. A preparation script accepts an explicit `FREEBUFF_UPSTREAM_DIR`, validates that its `HEAD` equals the commit in `upstream.json`, builds the gateway, and copies the resulting binary into a generated resource directory ignored by Git.

The development command launches Electron against that generated binary. Packaged builds never rely on a developer's pre-existing `target/` directory.

## Error handling

- A missing or non-executable gateway produces a platform-correct installation error before any window attempts to load localhost.
- Invalid configuration reports the real configuration path and log path.
- Port conflicts identify the configured port and link to the configuration file.
- Login-cookie capture distinguishes incomplete login, missing session cookie, gateway rejection, and connection failure.
- Build scripts fail on upstream SHA mismatch, missing artifacts, wrong binary architecture, failing tests, or packaging errors.

## Testing strategy

- Node unit tests cover platform path selection, initial configuration, configured-port parsing, restart limiting, cookie-header construction, allowed navigation origins, and update behavior.
- Gateway process tests use a temporary executable fixture and temporary user-data directory; they do not require a real Freebuff credential.
- Rust tests run against the exact pinned upstream checkout in CI.
- Packaging smoke tests inspect each `.app` bundle, assert the gateway exists and is executable, and use `file`/`lipo` to verify the declared architecture.
- An Apple Silicon local smoke test launches the unpacked app, waits for `/healthz`, checks the dashboard response, and confirms the gateway exits with the app.
- Release publication is permitted only after tests, packaging inspection, and checksum generation succeed for both architectures.

## Versioning and releases

The wrapper begins at `v0.1.0` while recording upstream `v0.7.3` separately. Wrapper tags do not impersonate upstream versions. Release notes state both versions, supported architectures, unsigned status, Gatekeeper instructions, upstream attribution, and checksum verification steps.

## Non-goals for the wrapper phase

- No copy of the upstream Rust source in the wrapper repository.
- No GitHub fork relationship.
- No Apple code signing, notarization, or silent auto-update.
- No Windows or Linux desktop packages.
- No dashboard redesign.
- No modification of upstream API behavior.
- No automatic upstream version tracking.

## Completion criteria

The wrapper phase is complete when the independent public repository exists, CI passes, a `v0.1.0` GitHub Release contains working arm64 and x64 `.dmg` and `.zip` packages with checksums, the Apple Silicon package passes a local launch/health/shutdown smoke test, and installation plus Gatekeeper instructions are documented.
