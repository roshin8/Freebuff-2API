function navigationDecision(rawUrl, dashboardPort) {
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password) return { action: 'deny' };

    if (Number.isInteger(dashboardPort) && dashboardPort >= 1 && dashboardPort <= 65_535
      && url.origin === new URL(`http://127.0.0.1:${dashboardPort}`).origin) {
      return { action: 'allow' };
    }
    if (url.protocol === 'https:') return { action: 'external', url: url.href };
  } catch {
    // Invalid URLs never leave the application.
  }
  return { action: 'deny' };
}

module.exports = { navigationDecision };
