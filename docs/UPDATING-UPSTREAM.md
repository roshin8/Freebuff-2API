# Updating the pinned upstream gateway

Upstream changes are deliberate wrapper changes, not automatic dependency
updates. The wrapper currently pins upstream `v0.7.3` at
`506240d7deef1272ed05313ed72f7d9f11785e89`.

1. Select a specific upstream release and commit, then review the complete
   upstream diff, release notes, licensing implications, and any effects on
   gateway configuration, health checks, authentication, and macOS packaging.
   Review the repository coordinate too. For an update from the same upstream,
   retain `https://github.com/lza6/Freebuff-2API`: the manifest validator and
   workflow contract reject a different repository, so a tag or commit change
   does not by itself authorize a repository change.
2. Obtain an external local checkout and set the selected tag and commit. Fetch
   tags from the expected origin, verify the tag resolves to the selected
   commit, then check out that exact commit:

   ```bash
   export UPSTREAM_TAG="vX.Y.Z"
   export UPSTREAM_COMMIT="0123456789abcdef0123456789abcdef01234567"
   test "$(git -C "$FREEBUFF_UPSTREAM_DIR" remote get-url origin)" = "https://github.com/lza6/Freebuff-2API.git"
   git -C "$FREEBUFF_UPSTREAM_DIR" fetch --force --tags origin
   test "$(git -C "$FREEBUFF_UPSTREAM_DIR" rev-list -n 1 "$UPSTREAM_TAG")" = "$UPSTREAM_COMMIT"
   git -C "$FREEBUFF_UPSTREAM_DIR" checkout "$UPSTREAM_COMMIT"
   test "$(git -C "$FREEBUFF_UPSTREAM_DIR" rev-parse HEAD)" = "$UPSTREAM_COMMIT"
   ```

   The upstream source must remain outside this wrapper repository. This
   explicit tag-to-commit verification is necessary because preparation only
   compares the checkout `HEAD` with the manifest commit; it does not inspect
   the remote origin or resolve the tag.
3. Update every pin consumer in one change:

   - all three `upstream.json` coordinates: `repository`, `tag`, and the full
     40-character `commit`;
   - both hard-coded checkout and `git rev-parse HEAD` verification SHAs in
     `.github/workflows/validate.yml` and `.github/workflows/release.yml`;
   - affected pin fixtures and assertions, including
     `desktop/test/upstream.test.js` and
     `desktop/test/prepare-gateway.test.js`;
   - current-version and attribution documentation, including `README.md`,
     `NOTICE.md`, `docs/DEVELOPMENT.md`, and this guide.

   Search for the previous tag and SHA before committing so newly added pin
   consumers are not missed. Keep the repository coordinate unchanged when it
   still names the same upstream; changing it requires corresponding validator,
   workflow-contract, test, and documentation changes in the reviewed pull
   request.

   Review and regenerate the versioned English UI patch and its integrity
   manifest for the new pin. Audit every added/changed dashboard string, including
   generated JavaScript views and API diagnostics/validation messages. Preserve
   endpoint paths, JSON field names, IDs, matching rules, and user content. Update
   the preparation patch path and integration-test expectations together. Record
   the original and patched SHA-256 of each touched file and the exact commit in
   the patch manifest. Verify clean application, idempotent repeated preparation,
   and rejection of drift before building a release.
4. Run the selected upstream checkout's locked Rust tests, then prepare and
   test the wrapper:

   ```bash
   npm run prepare:gateway --prefix desktop
   cargo test --locked --manifest-path "$FREEBUFF_UPSTREAM_DIR/Cargo.toml"
   npm test --prefix desktop
   node scripts/verify-workflows.js
   ```

5. Locally package and inspect an unsigned Apple Silicon artifact:

   ```bash
   CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac --prefix desktop -- --arm64
   APP_PATH="$PWD/desktop/dist/mac-arm64/Freebuff2API.app" EXPECTED_ARCH=arm64 node scripts/smoke-bundle.js
   scripts/smoke-app.sh "$PWD/desktop/dist/mac-arm64/Freebuff2API.app"
   shasum -a 256 desktop/dist/Freebuff2API-0.1.0-arm64.dmg desktop/dist/Freebuff2API-0.1.0-arm64.zip
   ```

6. Document the upstream release notes and test results in a pull request.
   Merge that pull request before creating any wrapper release tag. A wrapper
   version and tag must remain distinct from the upstream version and tag.
