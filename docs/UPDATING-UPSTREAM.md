# Updating the pinned upstream gateway

Upstream changes are deliberate wrapper changes, not automatic dependency
updates. The wrapper currently pins upstream `v0.7.3` at
`506240d7deef1272ed05313ed72f7d9f11785e89`.

1. Select a specific upstream release and commit, then review the complete
   upstream diff, release notes, licensing implications, and any effects on
   gateway configuration, health checks, authentication, and macOS packaging.
2. In `upstream.json`, change all three coordinates together: `repository`,
   `tag`, and the full 40-character `commit`. Do not update only a tag or only
   a commit.
3. Obtain an external local checkout at the selected commit and point
   `FREEBUFF_UPSTREAM_DIR` at its absolute path. The upstream source must not
   be committed into this wrapper repository.
4. Run the selected upstream checkout's locked Rust tests, then prepare and
   test the wrapper:

   ```bash
   cargo test --locked --manifest-path "$FREEBUFF_UPSTREAM_DIR/Cargo.toml"
   npm run prepare:gateway --prefix desktop
   npm test --prefix desktop
   node scripts/verify-workflows.js
   ```

5. Locally package and inspect an unsigned Apple Silicon artifact:

   ```bash
   CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac --prefix desktop -- --arm64
   APP_PATH="$PWD/desktop/dist/mac-arm64/Freebuff2API.app" EXPECTED_ARCH=arm64 node scripts/smoke-bundle.js
   shasum -a 256 desktop/dist/Freebuff2API-0.1.0-arm64.dmg desktop/dist/Freebuff2API-0.1.0-arm64.zip
   ```

6. Document the upstream release notes and test results in a pull request.
   Merge that pull request before creating any wrapper release tag. A wrapper
   version and tag must remain distinct from the upstream version and tag.
