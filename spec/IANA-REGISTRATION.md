> **STATUS: APPROVED AND REGISTERED** -- Registration confirmed by IANA on 2026-04-15.
> See: https://www.iana.org/assignments/media-types/application/vnd.vertifile.pvf

# IANA Media Type Registration: `application/vnd.vertifile.pvf`

**Document type:** IANA Media Type Registration Application (per RFC 6838)
**Format:** Protected Verified File (PVF)
**Applicant:** Zur Halfon, Vertifile
**Date prepared:** 2026-03-18
**Registration tree:** Vendor (`vnd.`)

---

## Table of Contents

1. [Media Type Registration Template](#1-media-type-registration-template)
2. [Submission Instructions](#2-submission-instructions)
3. [Apple Uniform Type Identifier (UTI) Registration](#3-apple-uniform-type-identifier-uti-registration)
4. [Windows Registry Association](#4-windows-registry-association)
5. [Linux / freedesktop.org Integration](#5-linux--freedesktoporg-integration)
6. [Browser MIME Handling](#6-browser-mime-handling)

---

## 1. Media Type Registration Template

The following template conforms to the format specified in RFC 6838, Section 5.6.

```
Type name: application

Subtype name: vnd.vertifile.pvf

Required parameters: N/A

Optional parameters:
  version - PVF format version identifier. Indicates the version of
    the PVF specification to which the file conforms. Currently defined
    values: "1.0". Default: "1.0".

Encoding considerations: 8bit
  PVF files are UTF-8 encoded HTML documents. They consist entirely of
  printable Unicode characters and standard HTML markup, with embedded
  binary data represented as base64-encoded strings within the document
  body. No additional content-transfer-encoding is required for
  transport over 8bit-clean channels.

Security considerations:
  PVF files are self-contained HTML documents that include embedded
  JavaScript code for document integrity verification. The following
  security properties and considerations apply:

  1. Integrity verification: Each PVF file embeds a SHA-256 hash of
     the original document payload and an HMAC-SHA256 signature
     computed with a server-held secret key. These values enable
     verification that the file has not been altered since issuance.

  2. Embedded JavaScript: The verification engine is implemented in
     JavaScript and is embedded directly within the PVF file. This
     JavaScript performs cryptographic hash computation and signature
     validation entirely client-side, requiring no network access for
     basic verification. The JavaScript code is obfuscated to resist
     tampering, but consumers should be aware that executing embedded
     scripts carries inherent risk.

  3. Sandboxed rendering: PVF files SHOULD be opened in sandboxed
     environments (e.g., browser sandboxes, isolated viewer
     applications) to mitigate risks associated with embedded script
     execution. Implementations MUST NOT grant PVF files access to
     local filesystem resources, network sockets, or other system
     capabilities beyond what is required for rendering and
     verification.

  4. Non-executable payload: The protected document payload (PDF,
     image, or other content) is stored as a base64-encoded string
     within the HTML structure. The payload is inert data and is not
     directly executable. Extraction and rendering of the payload
     should be handled by the appropriate viewer for the payload's
     own media type.

  5. Blind processing model: The Vertifile issuance server operates
     under a "blind processing" model in which the server never reads
     or inspects the document content. The server receives only the
     cryptographic hash of the document and returns a signed
     verification stamp. This ensures confidentiality of the protected
     document at the point of issuance.

  6. No external resource dependencies: A conforming PVF file does not
     require loading any external resources (scripts, stylesheets,
     fonts, or network endpoints) to perform basic document rendering
     and integrity verification. All verification logic and assets are
     self-contained.

  7. Visual stamp: PVF files include a visual verification stamp that
     displays the verification status. Users should be aware that the
     visual stamp alone is not a security guarantee — programmatic
     verification of the cryptographic signatures is the authoritative
     integrity check.

Interoperability considerations:
  PVF files are valid HTML5 documents and can be rendered by any modern
  web browser that supports the HTML5 specification. The embedded
  verification engine requires JavaScript support; browsers or viewers
  with JavaScript disabled will display the protected document content
  without interactive verification capability.

  PVF files begin with the magic comment <!--PVF:1.0--> which allows
  identification independent of file extension or media type headers.

  The base64-encoded document payload can be extracted and decoded by
  any conforming implementation to recover the original document in
  its native format.

  PVF files are designed to degrade gracefully: in environments that
  do not support JavaScript, the document content remains accessible
  as a rendered HTML page, though verification functionality will not
  be available.

Published specification:
  https://github.com/zur2525-star/vertifile/blob/main/spec/PVF-FORMAT-SPEC-v1.0.md

Applications that use this media type:
  PVF Viewer - Desktop application for macOS and Windows for viewing
    and verifying PVF files with full offline verification support.
  Vertifile web platform (https://vertifile.com) - Cloud service for
    issuing, managing, and verifying PVF files.
  Any HTML5-capable web browser - PVF files can be opened directly in
    modern web browsers (Chrome, Firefox, Safari, Edge) for rendering
    and verification.

Fragment identifier considerations: N/A

Additional information:
  Deprecated alias names for this type: N/A
  Magic number(s): <!--PVF:1.0-->
  File extension(s): .pvf
  Macintosh file type code(s): N/A
  Uniform Type Identifier: com.vertifile.pvf conforming to public.html

Person & email address to contact for further information:
  Zur Halfon
  info@vertifile.com

Intended usage: COMMON

Restrictions on usage: N/A

Author:
  Zur Halfon
  Vertifile

Change controller:
  Zur Halfon
  info@vertifile.com
```

---

## 2. Submission Instructions

### How to Submit This Registration to IANA

The vendor tree (`vnd.`) registration process is defined in RFC 6838, Section 3.2. Vendor tree registrations do not require IETF review or an RFC; they follow a streamlined first-come, first-served process administered by IANA.

### Step-by-Step Process

**Step 1: Prepare the application**

The registration template in Section 1 of this document is formatted per RFC 6838, Section 5.6. Review it for completeness and accuracy before submission.

**Step 2: Submit via the IANA web form**

Navigate to the IANA Media Types registration form:

> **https://www.iana.org/form/media-types**

Fill in the form fields using the information from the template above. The form will ask for:

- Type name (`application`)
- Subtype name (`vnd.vertifile.pvf`)
- All fields from the registration template
- Contact information

Alternatively, you may submit the registration by email to `media-types@iana.org` with the completed template in the body of the message.

**Step 3: IANA review**

IANA will review the submission for completeness. This is an administrative review, not a technical evaluation. For vendor tree registrations, IANA verifies that:

- The template is complete and properly formatted
- The subtype name follows vendor tree naming conventions (`vnd.<organization>.<type>`)
- The contact information is valid
- There are no conflicts with existing registrations

**Step 4: Await confirmation**

Typical timeline:

| Phase | Expected Duration |
|---|---|
| Initial acknowledgment | 1-5 business days |
| Review and follow-up questions (if any) | 1-4 weeks |
| Registration published | 1-2 weeks after approval |
| **Total (nominal)** | **2-6 weeks** |

IANA may request clarifications or modifications. Respond promptly to any follow-up messages to avoid delays.

**Step 5: Verify publication**

Once approved, the registration will appear in the IANA Media Types registry:

> **https://www.iana.org/assignments/media-types/media-types.xhtml**

Search for `vnd.vertifile.pvf` under the `application` type to confirm publication.

### Tips for Successful Registration

1. **Be thorough in Security Considerations.** This is the section most likely to draw follow-up questions. The template above provides detailed coverage of the embedded JavaScript, sandboxing recommendations, and payload safety.

2. **Provide a reachable published specification URL.** The GitHub link must be publicly accessible at the time of submission. Verify the link resolves before submitting.

3. **Use a stable contact email address.** IANA will use this address for all correspondence. Ensure `info@vertifile.com` is monitored.

4. **Do not request a standards tree name.** Standards tree registrations (`application/pvf`) require an IETF-approved specification. The vendor tree (`application/vnd.vertifile.pvf`) is appropriate for a product-specific format and does not require IETF review.

5. **Respond quickly to IANA follow-up.** Delayed responses can cause the application to be deprioritized. Aim to respond within 5 business days.

6. **Keep the specification up to date.** If the published specification URL changes after registration, submit an update to IANA via the same form or by emailing `media-types@iana.org`.

---

## 3. Apple Uniform Type Identifier (UTI) Registration

To register `com.vertifile.pvf` as a Uniform Type Identifier on macOS and iOS, add the following entries to your application's `Info.plist`. This enables macOS/iOS to recognize `.pvf` files and associate them with your application.

### Exported Type Declaration (Info.plist)

Add this to the `Info.plist` of the PVF Viewer application:

```xml
<key>UTExportedTypeDeclarations</key>
<array>
  <dict>
    <key>UTTypeIdentifier</key>
    <string>com.vertifile.pvf</string>

    <key>UTTypeDescription</key>
    <string>Protected Verified File</string>

    <key>UTTypeConformsTo</key>
    <array>
      <string>public.html</string>
      <string>public.data</string>
    </array>

    <key>UTTypeTagSpecification</key>
    <dict>
      <key>public.filename-extension</key>
      <array>
        <string>pvf</string>
      </array>
      <key>public.mime-type</key>
      <string>application/vnd.vertifile.pvf</string>
    </dict>

    <key>UTTypeIconFiles</key>
    <array>
      <string>pvf-document.icns</string>
    </array>

    <key>UTTypeReferenceURL</key>
    <string>https://vertifile.com</string>
  </dict>
</array>
```

### Document Type Registration (Info.plist)

To declare that your application can open `.pvf` files:

```xml
<key>CFBundleDocumentTypes</key>
<array>
  <dict>
    <key>CFBundleTypeName</key>
    <string>Protected Verified File</string>

    <key>CFBundleTypeRole</key>
    <string>Viewer</string>

    <key>LSHandlerRank</key>
    <string>Owner</string>

    <key>LSItemContentTypes</key>
    <array>
      <string>com.vertifile.pvf</string>
    </array>

    <key>CFBundleTypeIconFiles</key>
    <array>
      <string>pvf-document.icns</string>
    </array>
  </dict>
</array>
```

### Swift UTType Declaration (iOS 14+ / macOS 11+)

For applications using the modern `UTType` API:

```swift
import UniformTypeIdentifiers

extension UTType {
    static let pvf = UTType(
        exportedAs: "com.vertifile.pvf",
        conformingTo: .html
    )
}
```

---

## 4. Windows Registry Association

To associate `.pvf` files with the PVF Viewer application on Windows, create the following registry entries under `HKEY_CLASSES_ROOT`. These can be applied via an installer (e.g., NSIS, WiX) or a `.reg` file.

### Registry File (.reg)

```reg
Windows Registry Editor Version 5.00

; --- File extension association ---
[HKEY_CLASSES_ROOT\.pvf]
@="VertifilePVF"
"Content Type"="application/vnd.vertifile.pvf"
"PerceivedType"="document"

; --- ProgID definition ---
[HKEY_CLASSES_ROOT\VertifilePVF]
@="Protected Verified File"
"FriendlyTypeName"="Protected Verified File"

[HKEY_CLASSES_ROOT\VertifilePVF\DefaultIcon]
@="\"C:\\Program Files\\Vertifile\\PVF Viewer\\pvf-viewer.exe\",0"

[HKEY_CLASSES_ROOT\VertifilePVF\shell]
@="open"

[HKEY_CLASSES_ROOT\VertifilePVF\shell\open]
@="Open with PVF Viewer"
"FriendlyAppName"="PVF Viewer"

[HKEY_CLASSES_ROOT\VertifilePVF\shell\open\command]
@="\"C:\\Program Files\\Vertifile\\PVF Viewer\\pvf-viewer.exe\" \"%1\""

; --- MIME type mapping ---
[HKEY_CLASSES_ROOT\MIME\Database\Content Type\application/vnd.vertifile.pvf]
"Extension"=".pvf"
"CLSID"="{25336920-03F9-11CF-8FD0-00AA00686F13}"
```

### Per-User Registration (non-admin)

For per-user installation without administrator privileges, use `HKEY_CURRENT_USER\Software\Classes` instead of `HKEY_CLASSES_ROOT`:

```reg
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\Classes\.pvf]
@="VertifilePVF"
"Content Type"="application/vnd.vertifile.pvf"

[HKEY_CURRENT_USER\Software\Classes\VertifilePVF]
@="Protected Verified File"

[HKEY_CURRENT_USER\Software\Classes\VertifilePVF\shell\open\command]
@="\"C:\\Users\\%USERNAME%\\AppData\\Local\\Vertifile\\pvf-viewer.exe\" \"%1\""
```

### Windows AppX Manifest (for MSIX/UWP packages)

```xml
<Extensions>
  <uap:Extension Category="windows.fileTypeAssociation">
    <uap:FileTypeAssociation Name="pvf">
      <uap:SupportedFileTypes>
        <uap:FileType ContentType="application/vnd.vertifile.pvf">.pvf</uap:FileType>
      </uap:SupportedFileTypes>
      <uap:DisplayName>Protected Verified File</uap:DisplayName>
      <uap:Logo>Assets\pvf-icon.png</uap:Logo>
    </uap:FileTypeAssociation>
  </uap:Extension>
</Extensions>
```

---

## 5. Linux / freedesktop.org Integration

### MIME Type Definition (XML)

Create the file `vertifile-pvf.xml` and install it into the shared MIME database:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/vnd.vertifile.pvf">
    <comment>Protected Verified File</comment>
    <comment xml:lang="en">Protected Verified File</comment>

    <!-- Magic number detection -->
    <magic priority="60">
      <match type="string" offset="0:64" value="&lt;!--PVF:1.0--&gt;" />
    </magic>

    <!-- File extension -->
    <glob pattern="*.pvf" />

    <!-- Inherits from HTML -->
    <sub-class-of type="text/html" />

    <icon name="application-vnd.vertifile.pvf" />
    <generic-icon name="x-office-document" />
  </mime-type>
</mime-info>
```

Install and update the MIME database:

```bash
# System-wide installation (requires root)
sudo cp vertifile-pvf.xml /usr/share/mime/packages/
sudo update-mime-database /usr/share/mime

# Per-user installation
mkdir -p ~/.local/share/mime/packages
cp vertifile-pvf.xml ~/.local/share/mime/packages/
update-mime-database ~/.local/share/mime
```

### Desktop Entry File

Create `vertifile-pvf-viewer.desktop`:

```ini
[Desktop Entry]
Version=1.1
Type=Application
Name=PVF Viewer
GenericName=Document Viewer
Comment=View and verify Protected Verified Files
Exec=/usr/bin/pvf-viewer %f
Icon=vertifile-pvf-viewer
Terminal=false
Categories=Office;Viewer;Security;
MimeType=application/vnd.vertifile.pvf;
StartupNotify=true
Keywords=pvf;vertifile;protected;verified;document;
```

Install the desktop entry:

```bash
# System-wide
sudo cp vertifile-pvf-viewer.desktop /usr/share/applications/
sudo update-desktop-database /usr/share/applications

# Per-user
cp vertifile-pvf-viewer.desktop ~/.local/share/applications/
update-desktop-database ~/.local/share/applications
```

### Icon Installation

Install icons at standard sizes for the file type:

```bash
for size in 16 24 32 48 64 128 256 512; do
  sudo cp "icons/${size}x${size}/application-vnd.vertifile.pvf.png" \
    "/usr/share/icons/hicolor/${size}x${size}/mimetypes/"
done
sudo gtk-update-icon-cache /usr/share/icons/hicolor/
```

### Verify Installation

```bash
# Check MIME type detection by file extension
xdg-mime query filetype document.pvf
# Expected output: application/vnd.vertifile.pvf

# Check default application
xdg-mime query default application/vnd.vertifile.pvf
# Expected output: vertifile-pvf-viewer.desktop

# Set PVF Viewer as the default handler
xdg-mime default vertifile-pvf-viewer.desktop application/vnd.vertifile.pvf
```

---

## 6. Browser MIME Handling

### How Browsers Handle Registered MIME Types

Once `application/vnd.vertifile.pvf` is registered with IANA and the operating system, browsers interact with PVF files through the following mechanisms.

### Server Configuration

Web servers must be configured to serve `.pvf` files with the correct `Content-Type` header. Without this, browsers will fall back to `application/octet-stream` and prompt for download.

**Apache** (`.htaccess` or `httpd.conf`):

```apache
AddType application/vnd.vertifile.pvf .pvf
```

**Nginx** (`mime.types` or server block):

```nginx
types {
    application/vnd.vertifile.pvf  pvf;
}
```

**Express.js (Node.js)**:

```javascript
const express = require('express');
const app = express();

express.static.mime.define({
  'application/vnd.vertifile.pvf': ['pvf']
});
```

### Content-Disposition for Inline Viewing

Because PVF files are valid HTML, browsers can render them inline. Servers should send the following headers to enable direct in-browser viewing:

```
Content-Type: application/vnd.vertifile.pvf
Content-Disposition: inline; filename="document.pvf"
X-Content-Type-Options: nosniff
```

To force download instead of inline rendering:

```
Content-Type: application/vnd.vertifile.pvf
Content-Disposition: attachment; filename="document.pvf"
```

### Chrome Handling

Chrome uses the operating system MIME type associations to determine behavior. Once the OS-level registration is in place:

1. If `Content-Disposition: inline` is set and Chrome recognizes the MIME type as renderable HTML, it will render the file in-tab.
2. If no handler is registered, Chrome will download the file and offer to open it with the default system application.
3. Chrome extensions can register as handlers for specific MIME types via the `file_handlers` manifest field (Manifest V3):

```json
{
  "file_handlers": [
    {
      "action": "/open-pvf",
      "name": "Protected Verified File",
      "accept": {
        "application/vnd.vertifile.pvf": [".pvf"]
      }
    }
  ]
}
```

### Firefox Handling

Firefox maintains its own MIME type handler database independently of the OS. Users can configure `.pvf` handling via:

1. **Automatic detection**: Firefox reads the `Content-Type` header and matches it against its handler list. New MIME types default to "Save File" behavior.
2. **Manual configuration**: Users navigate to `Settings > General > Applications` and search for `application/vnd.vertifile.pvf` to set the preferred action (open in Firefox, open with PVF Viewer, or save).
3. **handlers.json**: Firefox stores MIME handler preferences in the profile directory. An entry for PVF looks like:

```json
{
  "mimeTypes": {
    "application/vnd.vertifile.pvf": {
      "action": 0,
      "extensions": ["pvf"],
      "ask": true
    }
  }
}
```

Where `action: 0` means "save to disk", `action: 2` means "use system default", and `action: 4` means "open in browser".

### Safari Handling

Safari defers to macOS UTI declarations for file handling. Once `com.vertifile.pvf` is registered as a UTI (see Section 3), Safari will:

1. Recognize `.pvf` files served with `Content-Type: application/vnd.vertifile.pvf`
2. Render them inline if the UTI conforms to `public.html`
3. Delegate to PVF Viewer if set as the default handler in macOS

### Edge Handling

Microsoft Edge (Chromium-based) follows the same behavior as Chrome, using OS-level MIME associations on Windows and macOS. The Windows registry entries in Section 4 enable Edge to recognize and route `.pvf` files to PVF Viewer.

---

## References

- **RFC 6838** - Media Type Specifications and Registration Procedures
  https://www.rfc-editor.org/rfc/rfc6838

- **IANA Media Types Registry**
  https://www.iana.org/assignments/media-types/media-types.xhtml

- **IANA Media Types Registration Form**
  https://www.iana.org/form/media-types

- **PVF Format Specification v1.0**
  https://github.com/zur2525-star/vertifile/blob/main/spec/PVF-FORMAT-SPEC-v1.0.md

- **Apple Uniform Type Identifiers Overview**
  https://developer.apple.com/documentation/uniformtypeidentifiers

- **freedesktop.org Shared MIME Info Specification**
  https://specifications.freedesktop.org/shared-mime-info-spec/latest/

- **W3C Media Type Registration**
  https://www.w3.org/2020/01/registering-mediatypes
