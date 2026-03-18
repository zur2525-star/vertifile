# Code Signing & Notarization Guide — PVF Viewer

## Why Sign?
Without code signing:
- **macOS**: Gatekeeper shows "unidentified developer" warning. Users must right-click → Open.
- **Windows**: SmartScreen shows "unrecognized app" warning.

With signing, the app installs and opens cleanly — no warnings.

---

## macOS Signing

### What You Need
1. **Apple Developer Program** membership ($99/year) — https://developer.apple.com/programs/
2. **Developer ID Application** certificate (for distribution outside App Store)
3. **App-Specific Password** for notarization

### Step-by-Step

#### 1. Enroll in Apple Developer Program
- Go to https://developer.apple.com/programs/enroll/
- Sign in with your Apple ID
- Pay $99/year
- Wait for approval (usually 24-48 hours)

#### 2. Create Developer ID Certificate
- Open **Keychain Access** → Certificate Assistant → Request a Certificate from CA
- Upload to https://developer.apple.com/account/resources/certificates/add
- Select "Developer ID Application"
- Download and double-click to install

#### 3. Set Environment Variables
```bash
# Your Apple Developer email
export APPLE_ID="zur2525@gmail.com"

# App-specific password (generate at appleid.apple.com → Security → App-Specific Passwords)
export APPLE_ID_PASSWORD="xxxx-xxxx-xxxx-xxxx"

# Your Team ID (find at developer.apple.com/account → Membership)
export APPLE_TEAM_ID="XXXXXXXXXX"
```

#### 4. Update package.json
Change `"identity": null` to your identity:
```json
"identity": "Developer ID Application: Your Name (TEAMID)"
```

#### 5. Build with Signing
```bash
npm run build
```
The `afterSign` hook will automatically notarize the app.

---

## Windows Signing

### What You Need
- **Code Signing Certificate** from a trusted CA:
  - **Standard**: ~$70-200/year (Sectigo, Comodo, DigiCert)
  - **EV (Extended Validation)**: ~$200-400/year (removes SmartScreen warnings immediately)

### Step-by-Step

#### 1. Purchase Certificate
Recommended providers:
- **Sectigo** (cheapest): https://sectigo.com/code-signing
- **DigiCert** (best reputation): https://www.digicert.com/signing/code-signing-certificates

#### 2. Set Environment Variables
```bash
# Path to your .pfx certificate file
export WIN_CSC_LINK="/path/to/certificate.pfx"

# Certificate password
export WIN_CSC_KEY_PASSWORD="your-password"
```

#### 3. Build with Signing
```bash
npm run build:win
```

---

## Current Status (No Certificates)

The builds work without signing, with these user experiences:

### macOS (unsigned)
1. User downloads DMG
2. Drags to Applications
3. First launch: "PVF Viewer can't be opened because it is from an unidentified developer"
4. User goes to System Settings → Privacy & Security → click "Open Anyway"
5. Subsequent launches work normally

### Windows (unsigned)
1. User downloads .exe
2. Launches it: "Windows protected your PC" (SmartScreen)
3. Click "More info" → "Run anyway"
4. App works normally after that

---

## CI/CD (GitHub Actions)

Once you have certificates, add this workflow for automatic signed builds:

```yaml
# .github/workflows/build.yml
name: Build & Release
on:
  push:
    tags: ['v*']

jobs:
  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd viewer && npm ci
      - run: cd viewer && npm run build
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_ID_PASSWORD: ${{ secrets.APPLE_ID_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          CSC_LINK: ${{ secrets.MAC_CERTIFICATE }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CERT_PASSWORD }}
      - uses: actions/upload-artifact@v4
        with:
          name: mac-build
          path: viewer/dist/*.dmg

  build-win:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd viewer && npm ci
      - run: cd viewer && npm run build:win
        env:
          WIN_CSC_LINK: ${{ secrets.WIN_CERTIFICATE }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CERT_PASSWORD }}
      - uses: actions/upload-artifact@v4
        with:
          name: win-build
          path: viewer/dist/*.exe
```

---

## Cost Summary

| Item | Cost | Required? |
|------|------|-----------|
| Apple Developer Program | $99/year | For macOS signing |
| Standard Code Signing Cert (Windows) | ~$70-200/year | For Windows signing |
| EV Code Signing Cert (Windows) | ~$200-400/year | To skip SmartScreen |
| GitHub Actions | Free (2000 min/month) | For CI/CD builds |

**Minimum to start**: $99/year (Apple only) or ~$170/year (both platforms with standard cert)
