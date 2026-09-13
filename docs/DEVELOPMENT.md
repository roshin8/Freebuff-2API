# Development

This wrapper supports native macOS `arm64` and `x64` builds. Use macOS with
Node.js 20 or later, Rust 1.95, Cargo, and the macOS developer tools that
provide `file`, `shasum`, and `xattr`. Start in a local clone of this wrapper.

## Clone and pin the upstream checkout

The upstream source must remain outside this repository. Clone it as a sibling
directory, check out the audited commit, and export its absolute path:

```bash
git clone https://github.com/lza6/Freebuff-2API.git ../Freebuff-2API-upstream
git -C ../Freebuff-2API-upstream checkout 506240d7deef1272ed05313ed72f7d9f11785e89
export FREEBUFF_UPSTREAM_DIR="$PWD/../Freebuff-2API-upstream"
```

`FREEBUFF_UPSTREAM_DIR` must be an absolute path. The manifest loader accepts
only the expected upstream repository format and a syntactically valid tag, and
the preparation script checks that the checkout's `HEAD` equals the
manifest `commit` before applying the versioned English dashboard patch or
building a gateway binary. It does not
inspect the checkout's remote origin or verify that the manifest tag resolves
to that commit; perform those checks when updating the pin.

Preparation then verifies SHA-256 hashes of every patched source file against
`patches/upstream-v0.7.3/manifest.json`. It accepts either the clean pinned files
or the exact already-patched files, checks patch applicability in the appropriate
direction, and rejects source drift or a partially applied patch. Only the files
listed in the patch are modified. Keep unrelated upstream changes out of release
build checkouts. Repeating preparation is safe; to start over, use a fresh external
checkout rather than discarding edits in an existing one.

## Install, prepare, and test

Install the locked desktop dependencies, build the pinned native gateway into
the ignored generated-resource directory, then run the upstream and wrapper
tests:

```bash
npm ci --prefix desktop
npm run prepare:gateway --prefix desktop
cargo test --locked --manifest-path "$FREEBUFF_UPSTREAM_DIR/Cargo.toml"
npm test --prefix desktop
node scripts/verify-workflows.js
```

## Run locally

Start the Electron application:

```bash
npm run start --prefix desktop
```

After a successful gateway startup, use a second terminal to verify the
default loopback health endpoint:

```bash
curl --fail --silent --show-error http://127.0.0.1:47821/healthz
```

The app stores its development configuration, data, and logs under
`~/Library/Application Support/Freebuff2API`. Quit it from the tray menu when
you finish testing.

## Package and inspect an Apple Silicon build

After preparation and tests, build an unsigned Apple Silicon package, inspect
the bundled gateway, and print checksums for the artifacts:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac --prefix desktop -- --arm64
APP_PATH="$PWD/desktop/dist/mac-arm64/Freebuff2API.app" EXPECTED_ARCH=arm64 node scripts/smoke-bundle.js
shasum -a 256 desktop/dist/Freebuff2API-0.1.0-arm64.dmg desktop/dist/Freebuff2API-0.1.0-arm64.zip
```

The build deliberately disables signing discovery. Build on an Intel Mac with
`--x64` when validating the Intel artifact; the CI release matrix builds both
native architectures.

Run the packaged application smoke test with an isolated temporary profile:

```bash
scripts/smoke-app.sh "$PWD/desktop/dist/mac-arm64/Freebuff2API.app"
```

This checks the English `/ui` HTML, renderer title, diagnostics, cost and validation
messages, gateway recovery, and clean shutdown. The fetched HTML must contain no
Han-script characters. Keep `FREEBUFF_UPSTREAM_DIR` exported when running Node
tests so the exact-source patch integration test runs; without a checkout, that
integration test is skipped while the synthetic preparation tests still run.
