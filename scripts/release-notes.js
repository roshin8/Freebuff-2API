const { version } = require('../desktop/package.json');
const upstream = require('../upstream.json');

function releaseNotes(wrapperVersion = version) {
  return `Freebuff2API for macOS wrapper **v${wrapperVersion}**, maintained by roshin8.

Bundles upstream [lza6/Freebuff-2API](https://github.com/lza6/Freebuff-2API) **${upstream.tag}** at ${upstream.commit}, with the versioned English dashboard patch. This is an independent wrapper; upstream gateway attribution and licenses are in NOTICE.md and LICENSE.

Requires macOS 13 or later. Choose **arm64** for Apple Silicon or **x64** for Intel. Each architecture has a DMG installer and ZIP app archive.

These builds are **unsigned and unnotarized**. Gatekeeper may block first launch. After verifying your download, move Freebuff2API.app to Applications and try Control-click → Open. If blocked, open System Settings → Privacy & Security → Open Anyway, then confirm. Only if you trust this repository and verified the checksum, you can remove quarantine for this app with:

\`\`\`bash
xattr -dr com.apple.quarantine /Applications/Freebuff2API.app
\`\`\`

Download SHA256SUMS.txt alongside your chosen artifact. Verify the Apple Silicon DMG in that directory:

\`\`\`bash
grep 'Freebuff2API-${wrapperVersion}-arm64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -
\`\`\`

For Intel use x64 instead of arm64; for the ZIP use .zip instead of .dmg. The command must report OK. If you download all four packages, run \`shasum -a 256 -c SHA256SUMS.txt\`. Do not install a download with a mismatched checksum.

See [installation and first-use instructions](https://github.com/roshin8/Freebuff-2API/blob/v${wrapperVersion}/README.md) and [security guidance](https://github.com/roshin8/Freebuff-2API/blob/v${wrapperVersion}/SECURITY.md).
`;
}

if (require.main === module) {
  if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== `v${version}`) {
    console.error('Release tag must match the packaged wrapper version.');
    process.exitCode = 1;
  } else process.stdout.write(releaseNotes());
}

module.exports = { releaseNotes };
