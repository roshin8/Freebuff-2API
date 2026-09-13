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

`FREEBUFF_UPSTREAM_DIR` must be an absolute path. The preparation script checks
that its `HEAD` matches every coordinate recorded in `upstream.json` before it
builds or copies a gateway binary.

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
