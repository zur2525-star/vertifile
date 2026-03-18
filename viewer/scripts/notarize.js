// macOS Notarization Script for electron-builder
// Runs automatically after signing (afterSign hook)
// Requires Apple Developer ID + App-Specific Password

const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize macOS builds
  if (electronPlatformName !== 'darwin') return;

  // Skip if not in CI or no credentials
  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD) {
    console.log('  • Skipping notarization — APPLE_ID / APPLE_ID_PASSWORD not set');
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  console.log(`  • Notarizing ${appName}...`);

  await notarize({
    appBundleId: 'com.vertifile.viewer',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  });

  console.log('  • Notarization complete!');
};
