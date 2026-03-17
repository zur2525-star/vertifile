# Protected Verified File (PVF) Format Specification

**Version 1.0**

**Draft Specification**

**March 2026**

---

## Abstract

The Protected Verified File (PVF) format is a self-contained document
packaging format that provides cryptographic integrity verification for
arbitrary digital documents. A PVF file encapsulates an original document
(such as a PDF, image, or other binary payload) within an HTML5
container that includes a SHA-256 content hash, an HMAC-SHA256 issuer
signature, and an embedded verification engine capable of performing
offline integrity checks without reliance on external services. The
format is designed for tamper-proof document distribution where
recipients must be able to independently verify that a document has not
been altered after issuance, while the issuing server operates under a
blind processing model in which it never inspects the document content.

---

## Status of This Document

This document specifies the PVF file format version 1.0 and is
published as a draft specification by Vertifile Ltd. This specification
is intended for review by implementors, standards bodies, and security
auditors. It is subject to revision. Distribution of this document is
unlimited.

This document is not yet an Internet Standards Track specification. It is
published for examination, experimental implementation, and evaluation.

Feedback on this specification should be directed to Vertifile Ltd.

---

## Copyright Notice

Copyright (c) 2025-2026 Vertifile Ltd / Zur Halfon. All rights reserved.

This document and the PVF format specification contained herein are the
intellectual property of Vertifile Ltd. Permission is granted to
reproduce this document in whole or in part for the purposes of
developing implementations of the PVF format, provided that the above
copyright notice and this permission notice appear in all copies.

---

## Table of Contents

- [1. Introduction](#1-introduction)
  - [1.1 Purpose](#11-purpose)
  - [1.2 Scope](#12-scope)
  - [1.3 Terminology](#13-terminology)
- [2. File Identification](#2-file-identification)
  - [2.1 File Extension](#21-file-extension)
  - [2.2 MIME Type](#22-mime-type)
  - [2.3 Magic Bytes / File Signature](#23-magic-bytes--file-signature)
  - [2.4 Uniform Type Identifier (UTI)](#24-uniform-type-identifier-uti)
- [3. File Structure](#3-file-structure)
  - [3.1 Overall Structure](#31-overall-structure)
  - [3.2 Magic Bytes Header](#32-magic-bytes-header)
  - [3.3 HTML Container](#33-html-container)
  - [3.4 Metadata Elements](#34-metadata-elements)
  - [3.5 Document Payload](#35-document-payload)
  - [3.6 Verification Engine](#36-verification-engine)
  - [3.7 Visual Stamp](#37-visual-stamp)
- [4. Cryptographic Operations](#4-cryptographic-operations)
  - [4.1 Document Hashing](#41-document-hashing)
  - [4.2 Signature Generation](#42-signature-generation)
  - [4.3 Blind Processing Model](#43-blind-processing-model)
  - [4.4 Recipient Binding](#44-recipient-binding)
  - [4.5 Blockchain Anchoring](#45-blockchain-anchoring)
- [5. Verification Process](#5-verification-process)
  - [5.1 Offline Verification](#51-offline-verification)
  - [5.2 Online Verification](#52-online-verification)
  - [5.3 Verification States](#53-verification-states)
- [6. Security Considerations](#6-security-considerations)
  - [6.1 Threat Model](#61-threat-model)
  - [6.2 Integrity Protection](#62-integrity-protection)
  - [6.3 Anti-Tampering Measures](#63-anti-tampering-measures)
  - [6.4 Code Obfuscation](#64-code-obfuscation)
  - [6.5 Screen Recording Prevention](#65-screen-recording-prevention)
  - [6.6 Limitations](#66-limitations)
- [7. MIME Type Registration](#7-mime-type-registration)
- [8. Interoperability](#8-interoperability)
  - [8.1 Browser Compatibility](#81-browser-compatibility)
  - [8.2 Operating System Support](#82-operating-system-support)
  - [8.3 Viewer Requirements](#83-viewer-requirements)
- [9. Examples](#9-examples)
  - [9.1 Minimal PVF File](#91-minimal-pvf-file)
  - [9.2 PVF with Recipient Binding](#92-pvf-with-recipient-binding)
- [10. References](#10-references)
  - [10.1 Normative References](#101-normative-references)
  - [10.2 Informative References](#102-informative-references)
- [Appendix A: Complete Metadata Reference](#appendix-a-complete-metadata-reference)
- [Appendix B: Verification API](#appendix-b-verification-api)

---

## 1. Introduction

### 1.1 Purpose

The Protected Verified File (PVF) format addresses the need for a
universally accessible, tamper-evident document container that does not
depend on proprietary viewer software or persistent network connectivity
for integrity verification. Traditional approaches to document integrity
(such as detached digital signatures, PKI-based signing within PDF, or
server-side document management) require either specialized software,
certificate infrastructure, or continuous access to a verification
authority.

PVF takes a fundamentally different approach: it packages the original
document, its cryptographic integrity proof, and a complete verification
engine into a single self-contained HTML file. Any device with a modern
web browser can open, render, and verify a PVF file without installing
additional software.

The format is designed around the principle of blind processing: the
issuing authority cryptographically binds itself to the document without
ever reading or interpreting the document contents. This provides strong
privacy guarantees while maintaining verifiable provenance.

### 1.2 Scope

This specification defines:

- The file structure and byte-level layout of a PVF file
- Required and optional metadata elements
- Cryptographic algorithms and procedures for hashing and signing
- The verification model, both offline and online
- The MIME media type for PVF files
- Interoperability requirements for conforming implementations

This specification does NOT define:

- The server-side implementation of the PVF issuance service
- Key management procedures for HMAC signing keys
- User interface requirements beyond the verification stamp
- The internal format of embedded documents (those are opaque payloads)

### 1.3 Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this document are to be interpreted as described in BCP 14
[RFC 2119] [RFC 8174] when, and only when, they appear in all capitals,
as shown here.

The following terms are used throughout this specification:

**PVF file** -- A file conforming to this specification.

**Issuer** -- The entity that creates and signs the PVF file. The issuer
operates the PVF issuance server.

**Recipient** -- The intended receiver of a PVF file. A PVF file MAY be
bound to a specific recipient.

**Payload** -- The original document (PDF, image, or other file)
embedded within the PVF file.

**Document hash** -- The SHA-256 digest of the raw payload bytes,
encoded as a lowercase hexadecimal string.

**Signature** -- The HMAC-SHA256 value computed over the document hash,
proving the document was registered by an authorized issuer.

**Verification engine** -- The JavaScript code embedded within the PVF
file that performs self-verification of the payload integrity.

**Verification stamp** -- The visual indicator rendered within the PVF
file that communicates verification status to the viewer.

**Blind processing** -- The operational model in which the issuer
computes cryptographic values over raw document bytes without parsing,
interpreting, or storing the document content.

---

## 2. File Identification

### 2.1 File Extension

PVF files MUST use the file extension `.pvf`.

Implementations MAY also recognize the extension `.pvf.html` as a PVF
file, as the underlying format is valid HTML5. However, the canonical
extension is `.pvf` and SHOULD be used when saving or distributing PVF
files.

When a PVF file is served over HTTP, the file extension in the URL
SHOULD be `.pvf`.

### 2.2 MIME Type

The MIME media type for PVF files is:

```
application/vnd.vertifile.pvf
```

This type is registered under the vendor tree as defined in [RFC 6838],
Section 3.2. See [Section 7](#7-mime-type-registration) for the complete
IANA registration template.

When a PVF file is served over HTTP, the `Content-Type` header SHOULD be
set to `application/vnd.vertifile.pvf`. Implementations MAY fall back to
`text/html` for compatibility with systems that do not recognize the PVF
MIME type, but this is NOT RECOMMENDED as it prevents proper file type
association.

### 2.3 Magic Bytes / File Signature

Every conforming PVF file MUST begin with the following 15-byte
sequence, encoded in US-ASCII:

```
<!--PVF:1.0-->
```

This is the PVF file signature (magic bytes). Its purpose is analogous
to `%PDF-1.7` in PDF files or the 8-byte signature in PNG files. The
magic bytes serve the following functions:

1. **File type identification** -- Allows tools and operating systems to
   identify a PVF file by inspecting the first bytes, without relying on
   the file extension.
2. **Version identification** -- The `1.0` component identifies the
   specification version.
3. **HTML compatibility** -- The sequence is a valid HTML comment, so it
   does not interfere with HTML parsing.

The magic bytes MUST appear at byte offset 0 of the file. There MUST NOT
be any bytes (including byte order marks, whitespace, or newlines) before
the magic bytes.

The magic bytes MUST be followed by a newline character (U+000A) before
the HTML doctype declaration.

**Format of the magic bytes:**

| Offset | Length | Value (hex)                                          | Value (ASCII)     |
|--------|--------|------------------------------------------------------|-------------------|
| 0      | 4      | `3C 21 2D 2D`                                        | `<!--`            |
| 4      | 4      | `50 56 46 3A`                                        | `PVF:`            |
| 8      | 3      | `31 2E 30`                                           | `1.0`             |
| 11     | 3      | `2D 2D 3E`                                           | `-->`             |
| 14     | 1      | `0A`                                                 | (newline)         |

Future versions of this specification MAY use different version numbers
(e.g., `<!--PVF:1.1-->` or `<!--PVF:2.0-->`). Implementations SHOULD
check the version number and refuse to process versions they do not
support.

### 2.4 Uniform Type Identifier (UTI)

On Apple platforms (macOS, iOS, iPadOS), the PVF file type is identified
by the following Uniform Type Identifier:

```
com.vertifile.pvf
```

The UTI declaration conforms to the following hierarchy:

```
com.vertifile.pvf
    conforms to: public.html
    conforms to: public.data
```

Implementations on Apple platforms SHOULD register this UTI in their
`Info.plist` with the following properties:

| Property                        | Value                            |
|---------------------------------|----------------------------------|
| UTTypeIdentifier                | `com.vertifile.pvf`              |
| UTTypeDescription               | Protected Verified File          |
| UTTypeConformsTo                | `public.html`, `public.data`     |
| UTTypeTagSpecification.public.filename-extension | `pvf`           |
| UTTypeTagSpecification.public.mime-type | `application/vnd.vertifile.pvf` |

---

## 3. File Structure

### 3.1 Overall Structure

A PVF file is a UTF-8 encoded text file that is simultaneously a valid
HTML5 document and a cryptographically signed container. The file
consists of the following structural regions, which MUST appear in the
order specified:

```
+------------------------------------------------------+
| Magic Bytes: <!--PVF:1.0-->                          |
+------------------------------------------------------+
| HTML5 Doctype: <!DOCTYPE html>                       |
+------------------------------------------------------+
| <html> element                                       |
|   +--------------------------------------------------+
|   | <head>                                           |
|   |   Metadata elements (<meta> tags)                |
|   |   CSS styles for verification stamp              |
|   +--------------------------------------------------+
|   | <body>                                           |
|   |   Document payload (base64, in <script>)         |
|   |   Verification engine (JavaScript)               |
|   |   Visual stamp container (HTML/CSS)              |
|   +--------------------------------------------------+
| </html>                                              |
+------------------------------------------------------+
```

The entire file MUST be valid HTML5 as defined by the WHATWG HTML Living
Standard. Implementations that generate PVF files MUST produce output
that passes HTML5 validation with no errors (warnings are acceptable).

The file encoding MUST be UTF-8. A byte order mark (BOM) MUST NOT be
present, as the magic bytes MUST occupy byte offset 0.

### 3.2 Magic Bytes Header

The file MUST begin with the magic bytes as defined in
[Section 2.3](#23-magic-bytes--file-signature). Immediately following the
magic bytes and their trailing newline, the HTML5 doctype declaration
MUST appear:

```html
<!--PVF:1.0-->
<!DOCTYPE html>
```

There MUST NOT be any content between the magic bytes trailing newline
and the doctype declaration other than optional whitespace.

### 3.3 HTML Container

The HTML container consists of a standard `<html>` element with `<head>`
and `<body>` children.

The `<html>` element MUST include a `lang` attribute. The value SHOULD
be `en` unless the PVF file is localized for a different language:

```html
<html lang="en">
```

The `<head>` element MUST contain, at minimum:

1. A `<meta charset="UTF-8">` declaration as the first child element
2. All required PVF metadata elements (see [Section 3.4](#34-metadata-elements))
3. A `<title>` element

The `<head>` element SHOULD contain:

1. A viewport meta tag for responsive rendering
2. Embedded CSS for the verification stamp

The `<body>` element MUST contain:

1. The document payload (see [Section 3.5](#35-document-payload))
2. The verification engine (see [Section 3.6](#36-verification-engine))
3. The visual stamp container (see [Section 3.7](#37-visual-stamp))

### 3.4 Metadata Elements

PVF metadata is conveyed through HTML `<meta>` elements in the `<head>`
section. All PVF-specific metadata uses the `name` attribute with the
prefix `pvf:`.

#### 3.4.1 Required Metadata

The following metadata elements MUST be present in every conforming PVF
file:

| Meta Name              | Content Format          | Description                                |
|------------------------|-------------------------|--------------------------------------------|
| `pvf:version`          | Semantic version string | Specification version. MUST be `1.0` for this version. |
| `pvf:hash`             | 64-char lowercase hex   | SHA-256 digest of the raw payload bytes.   |
| `pvf:signature`        | 64-char lowercase hex   | HMAC-SHA256 signature of the document hash.|
| `pvf:issuer`           | UTF-8 string            | Human-readable name of the issuing organization. |
| `pvf:created`          | ISO 8601 timestamp      | Date and time of PVF file creation.        |
| `pvf:original-name`    | UTF-8 string            | Original filename of the embedded document.|
| `pvf:mime-type`        | MIME type string         | MIME type of the embedded document.        |

**Example of required metadata:**

```html
<meta name="pvf:version" content="1.0">
<meta name="pvf:hash" content="a3f2b8c91d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a">
<meta name="pvf:signature" content="1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b">
<meta name="pvf:issuer" content="Vertifile Ltd">
<meta name="pvf:created" content="2026-03-18T14:30:00Z">
<meta name="pvf:original-name" content="contract.pdf">
<meta name="pvf:mime-type" content="application/pdf">
```

#### 3.4.2 Optional Metadata

The following metadata elements are OPTIONAL:

| Meta Name              | Content Format          | Description                                |
|------------------------|-------------------------|--------------------------------------------|
| `pvf:recipient-hash`   | 64-char lowercase hex   | SHA-256 digest of the recipient identifier (see [Section 4.4](#44-recipient-binding)). |
| `pvf:blockchain-tx`    | Hex string (variable)   | Transaction hash of the blockchain anchor (see [Section 4.5](#45-blockchain-anchoring)). |
| `pvf:blockchain-network` | String                | Blockchain network identifier (e.g., `polygon-mainnet`). |
| `pvf:document-id`      | UUID v4 string          | Unique identifier assigned to this document by the issuer. |
| `pvf:expiry`           | ISO 8601 timestamp      | Expiration date after which the PVF file SHOULD be considered invalid. |
| `pvf:issuer-url`       | URL string              | URL of the issuing organization or verification endpoint. |

#### 3.4.3 Metadata Ordering

PVF metadata elements SHOULD appear in the `<head>` section in the order
listed above (required elements first, then optional elements).
However, implementations MUST NOT depend on metadata ordering for
correct operation.

#### 3.4.4 Metadata Integrity

All metadata values are covered by the file-level integrity of the PVF
format. If any metadata value is modified after issuance, the
verification engine will detect the tampering during online verification
(see [Section 5.2](#52-online-verification)). The document hash
(`pvf:hash`) and signature (`pvf:signature`) are the primary integrity
anchors.

### 3.5 Document Payload

The original document is embedded within the PVF file as a base64-
encoded string inside a `<script>` block. This approach ensures the
payload is not interpreted by the HTML parser and remains inert until
explicitly decoded by the verification engine.

#### 3.5.1 Encoding

The payload MUST be encoded using standard base64 encoding as defined in
[RFC 4648], Section 4. The base64 alphabet consists of the characters
`A-Z`, `a-z`, `0-9`, `+`, and `/`, with `=` used for padding.

Line breaks within the base64 string are OPTIONAL. If present, they
MUST use the newline character (U+000A). Implementations MUST accept
base64 strings with or without line breaks.

#### 3.5.2 Payload Container

The base64-encoded payload MUST be assigned to a JavaScript variable
named `__pvf_payload` within a `<script>` element. The script element
MUST have the attribute `type="text/javascript"` or no `type` attribute
(defaulting to JavaScript):

```html
<script>
var __pvf_payload = "JVBERi0xLjcKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwov...";
</script>
```

The variable name `__pvf_payload` is REQUIRED and MUST NOT be changed.
The double-underscore prefix indicates that this is a PVF internal
variable.

#### 3.5.3 Payload Metadata Container

In addition to the payload itself, a separate JavaScript variable MUST
contain metadata about the embedded document:

```html
<script>
var __pvf_meta = {
  hash: "a3f2b8c91d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a",
  signature: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
  issuer: "Vertifile Ltd",
  created: "2026-03-18T14:30:00Z",
  originalName: "contract.pdf",
  mimeType: "application/pdf"
};
</script>
```

This duplication of metadata in JavaScript scope allows the verification
engine to access these values programmatically without DOM queries. The
values in `__pvf_meta` MUST be identical to the corresponding `<meta>`
tag values.

#### 3.5.4 Payload Size

There is no specification-defined upper limit on payload size. However,
implementations SHOULD be aware that very large payloads (exceeding
approximately 100 MB after base64 encoding) may cause performance issues
in browser-based viewers due to memory constraints. Implementations MAY
impose their own size limits and SHOULD document them.

### 3.6 Verification Engine

The verification engine is JavaScript code embedded within the PVF file
that performs self-verification of the payload integrity. It MUST be
contained within one or more `<script>` elements in the `<body>` of the
document.

#### 3.6.1 Required Capabilities

A conforming verification engine MUST implement the following:

1. **Base64 decoding** -- Decode the `__pvf_payload` variable from
   base64 to a binary `Uint8Array`.

2. **SHA-256 computation** -- Compute the SHA-256 digest of the decoded
   binary payload using the Web Cryptography API
   (`crypto.subtle.digest`).

3. **Hash comparison** -- Compare the computed SHA-256 digest (as a
   lowercase hexadecimal string) against the value stored in
   `__pvf_meta.hash`.

4. **Status reporting** -- Update the visual stamp (see
   [Section 3.7](#37-visual-stamp)) to reflect the verification result.

5. **Document rendering** -- Render the decoded payload in the browser
   using an appropriate method based on the MIME type (e.g., an
   `<iframe>` for PDF, an `<img>` element for images).

#### 3.6.2 Verification Procedure

The verification engine MUST execute the following procedure on page
load:

```
PROCEDURE VerifyDocument:
  1. READ __pvf_payload from script scope
  2. READ __pvf_meta from script scope
  3. DECODE __pvf_payload from base64 to binary bytes B
  4. COMPUTE H = SHA-256(B), encode as lowercase hex string
  5. IF H equals __pvf_meta.hash:
       SET verification_state = VERIFIED
     ELSE:
       SET verification_state = TAMPERED
  6. UPDATE visual stamp to reflect verification_state
  7. RENDER document from B according to __pvf_meta.mimeType
```

#### 3.6.3 Web Cryptography API Usage

The verification engine MUST use the W3C Web Cryptography API for all
cryptographic operations. Specifically:

```javascript
async function computeHash(bytes) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
```

Implementations MUST NOT use custom SHA-256 implementations when the
Web Cryptography API is available. Fallback to a JavaScript SHA-256
implementation is OPTIONAL and MAY be provided for environments where
`crypto.subtle` is not available (e.g., file:// origins in some
browsers).

#### 3.6.4 Document Rendering

The verification engine MUST render the payload according to its MIME
type. The following rendering methods are REQUIRED for a conforming
implementation:

| MIME Type              | Rendering Method                              |
|------------------------|-----------------------------------------------|
| `application/pdf`      | `<iframe>` or `<embed>` with data URI or Blob URL |
| `image/png`            | `<img>` with data URI or Blob URL             |
| `image/jpeg`           | `<img>` with data URI or Blob URL             |
| `image/gif`            | `<img>` with data URI or Blob URL             |
| `image/webp`           | `<img>` with data URI or Blob URL             |
| `image/svg+xml`        | `<img>` with data URI (NOT inline SVG)        |
| `text/plain`           | `<pre>` element with text content             |

For MIME types not listed above, the verification engine SHOULD attempt
to render using an `<iframe>` with a Blob URL and MAY offer a download
link as a fallback.

SVG documents MUST NOT be rendered as inline SVG to prevent script
injection. They MUST be rendered via `<img>` elements which do not
execute embedded scripts.

### 3.7 Visual Stamp

The visual stamp is a CSS-rendered element that communicates the
verification status to the viewer. It provides an immediate visual
indication of whether the document integrity check passed or failed.

#### 3.7.1 Stamp Container

The stamp MUST be rendered as a fixed-position HTML element overlaid on
the document view. The stamp container MUST have the CSS class
`pvf-stamp` and MUST be positioned using `position: fixed`.

The default position SHOULD be the bottom-right corner of the viewport:

```css
.pvf-stamp {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483647;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
               Helvetica, Arial, sans-serif;
  font-size: 14px;
  padding: 12px 20px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
}
```

#### 3.7.2 Stamp States

The stamp MUST reflect one of the three verification states defined in
[Section 5.3](#53-verification-states):

**Verified state:**
```css
.pvf-stamp.verified {
  background-color: #e8f5e9;
  border: 2px solid #4caf50;
  color: #2e7d32;
}
```

**Tampered state:**
```css
.pvf-stamp.tampered {
  background-color: #ffebee;
  border: 2px solid #f44336;
  color: #c62828;
}
```

**Unknown state:**
```css
.pvf-stamp.unknown {
  background-color: #fff3e0;
  border: 2px solid #ff9800;
  color: #e65100;
}
```

#### 3.7.3 Stamp Content

The stamp MUST display at minimum:

1. A textual status indicator (e.g., "Verified", "Tampered", "Unknown")
2. The issuer name
3. The creation timestamp

The stamp SHOULD also display:

1. The original filename
2. A visual icon or symbol indicating the verification state

#### 3.7.4 Stamp Interactivity

The stamp MAY be interactive, allowing the viewer to click or hover for
additional verification details. If interactive, the stamp SHOULD expand
to show:

- The full document hash
- The verification timestamp
- Issuer information
- A link to online verification (if `pvf:issuer-url` is present)

---

## 4. Cryptographic Operations

### 4.1 Document Hashing

#### 4.1.1 Algorithm

The PVF format uses SHA-256 (Secure Hash Algorithm 256-bit) as defined
in [FIPS 180-4] for document integrity verification. SHA-256 produces a
256-bit (32-byte) digest.

#### 4.1.2 Hash Input

The hash MUST be computed over the raw bytes of the original document,
before any encoding transformation. Specifically:

```
hash_input = original_document_bytes
```

The hash MUST NOT be computed over:
- The base64-encoded form of the document
- Any wrapper, header, or metadata added by the PVF format
- A subset or transformation of the document bytes

#### 4.1.3 Hash Output Format

The SHA-256 digest MUST be encoded as a lowercase hexadecimal string of
exactly 64 characters:

```
hash_output = lowercase_hex(SHA-256(hash_input))
```

Example:
```
a3f2b8c91d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a
```

Implementations MUST use lowercase hexadecimal characters (`0-9`, `a-f`).
Uppercase hexadecimal MUST NOT be used.

### 4.2 Signature Generation

#### 4.2.1 Algorithm

The PVF format uses HMAC-SHA256 (Hash-based Message Authentication Code
with SHA-256) as defined in [RFC 2104] and [FIPS 198-1] for issuer
authentication.

#### 4.2.2 Signature Input

The HMAC is computed over the document hash (the hexadecimal string
output of [Section 4.1](#41-document-hashing)), NOT over the raw
document bytes:

```
signature = HMAC-SHA256(key, hash_hex_string)
```

Where:
- `key` is the issuer's secret HMAC key (see [Section 4.2.3](#423-key-requirements))
- `hash_hex_string` is the 64-character lowercase hexadecimal SHA-256
  digest of the document

Computing the HMAC over the hash string rather than the raw document
ensures that the signing server never needs to receive or process the
full document content, supporting the blind processing model (see
[Section 4.3](#43-blind-processing-model)).

#### 4.2.3 Key Requirements

The HMAC signing key:

- MUST be at least 256 bits (32 bytes) in length
- SHOULD be generated using a cryptographically secure random number
  generator
- MUST be kept secret and MUST NOT be embedded in PVF files
- SHOULD be rotated periodically according to the issuer's key
  management policy

The PVF format does not specify a key distribution mechanism. Key
management is the responsibility of the issuer.

#### 4.2.4 Signature Output Format

The HMAC-SHA256 output MUST be encoded as a lowercase hexadecimal string
of exactly 64 characters, following the same encoding rules as the
document hash ([Section 4.1.3](#413-hash-output-format)).

### 4.3 Blind Processing Model

The blind processing model is a fundamental design principle of the PVF
format. It ensures that the issuing server can create valid PVF files
without accessing the content of the embedded documents.

#### 4.3.1 Model Description

In the blind processing model:

1. The client (document owner) computes the SHA-256 hash of the document
   locally.
2. The client sends ONLY the hash to the issuing server.
3. The server computes the HMAC-SHA256 signature over the received hash.
4. The server returns the signature to the client.
5. The client assembles the PVF file locally, embedding the original
   document, the hash, and the signature.

At no point does the server receive, store, or process the original
document bytes. The server's only input is a 64-character hexadecimal
hash string.

#### 4.3.2 Privacy Guarantee

The blind processing model provides the following privacy guarantee: the
issuing server learns nothing about the document content beyond its
SHA-256 hash. Given the preimage resistance of SHA-256, the hash reveals
no information about the document content.

#### 4.3.3 Verification Without Blind Processing

For offline verification ([Section 5.1](#51-offline-verification)), the
verifier recomputes the SHA-256 hash locally and compares it against the
embedded hash. This does not require the HMAC key and thus does not
involve the server.

For online verification ([Section 5.2](#52-online-verification)), the
verifier sends the hash to the server, which confirms whether it has a
record of that hash. Again, the document content is not transmitted.

### 4.4 Recipient Binding

Recipient binding is an OPTIONAL feature that associates a PVF file with
a specific intended recipient.

#### 4.4.1 Binding Mechanism

The recipient binding is implemented as a SHA-256 hash of the
recipient's email address:

```
recipient_hash = lowercase_hex(SHA-256(lowercase(email_address)))
```

The email address MUST be converted to lowercase before hashing to
ensure consistent results regardless of the original case.

The resulting hash is stored in the `pvf:recipient-hash` metadata
element.

#### 4.4.2 Verification of Recipient Binding

To verify that a PVF file is bound to a specific recipient, the verifier
computes the SHA-256 hash of the claimed recipient's email address (in
lowercase) and compares it against the `pvf:recipient-hash` value. If
the values match, the binding is confirmed.

#### 4.4.3 Privacy Considerations

The recipient hash does not reveal the recipient's email address due to
the preimage resistance of SHA-256. However, an attacker with a list of
candidate email addresses could compute hashes and compare them against
the recipient hash (a dictionary attack). Implementors SHOULD be aware
of this limitation.

### 4.5 Blockchain Anchoring

Blockchain anchoring is an OPTIONAL feature that records the document
hash on a public blockchain for additional tamper evidence and
timestamping.

#### 4.5.1 Supported Networks

This version of the specification defines blockchain anchoring for the
Polygon network. Future versions MAY add support for additional
networks.

| Network            | Identifier         | Chain ID |
|--------------------|--------------------|----------|
| Polygon Mainnet    | `polygon-mainnet`  | 137      |
| Polygon Amoy Testnet | `polygon-amoy`  | 80002    |

#### 4.5.2 Anchoring Data

The blockchain transaction MUST store the document hash (as defined in
[Section 4.1](#41-document-hashing)) in the transaction data field. The
exact method of encoding the hash within the transaction is determined
by the smart contract implementation and is outside the scope of this
specification.

#### 4.5.3 Metadata

When blockchain anchoring is used, the following metadata elements MUST
be present:

- `pvf:blockchain-tx` -- The full transaction hash (with `0x` prefix for
  EVM-based chains)
- `pvf:blockchain-network` -- The network identifier from the table above

#### 4.5.4 Verification

Blockchain anchoring provides an independent, immutable record that the
document hash existed at the time the transaction was mined. Verifiers
MAY query the blockchain to confirm the anchor independently of the PVF
issuer.

---

## 5. Verification Process

### 5.1 Offline Verification

Offline verification is the primary verification method and MUST be
supported by every conforming PVF file. It operates entirely within the
browser without any network requests.

#### 5.1.1 Procedure

```
PROCEDURE OfflineVerification:
  INPUT: PVF file opened in a web browser
  OUTPUT: Verification state (VERIFIED or TAMPERED)

  1. Parse __pvf_payload from the script scope
  2. Parse __pvf_meta.hash from the script scope
  3. Decode __pvf_payload from base64 to binary byte array B
  4. Compute H = lowercase_hex(SHA-256(B)) using Web Cryptography API
  5. Compare H with __pvf_meta.hash:
     a. If H == __pvf_meta.hash: return VERIFIED
     b. If H != __pvf_meta.hash: return TAMPERED
```

#### 5.1.2 Scope of Offline Verification

Offline verification confirms that the embedded document has not been
modified since the PVF file was created. It does NOT verify:

- That the HMAC signature is valid (this requires the server's key)
- That the issuer is who they claim to be
- That the document was not modified before PVF creation
- That the metadata (issuer name, creation date, etc.) is accurate

These additional verifications require online verification (see
[Section 5.2](#52-online-verification)).

### 5.2 Online Verification

Online verification extends offline verification by contacting the
issuer's server to validate the HMAC signature and confirm the
document's registration.

#### 5.2.1 Procedure

```
PROCEDURE OnlineVerification:
  INPUT: PVF file opened in a web browser with network access
  OUTPUT: Verification state (VERIFIED, TAMPERED, or UNKNOWN)

  1. Perform OfflineVerification (Section 5.1.1)
  2. If OfflineVerification returns TAMPERED:
       return TAMPERED (no server contact needed)
  3. Read pvf:issuer-url from metadata (if present)
  4. Send HTTP POST to issuer verification endpoint:
       POST {issuer-url}/api/verify
       Content-Type: application/json
       Body: { "hash": __pvf_meta.hash }
  5. Parse server response:
     a. If server confirms hash is registered and signature is valid:
          return VERIFIED
     b. If server does not recognize the hash:
          return UNKNOWN
     c. If server indicates the signature is invalid:
          return TAMPERED
  6. If network request fails (timeout, DNS error, etc.):
       Fall back to offline verification result
```

#### 5.2.2 Verification Endpoint

The issuer's verification endpoint MUST accept HTTP POST requests with
a JSON body. The request and response formats are defined in
[Appendix B](#appendix-b-verification-api).

#### 5.2.3 Network Failure Handling

If the online verification request fails for any reason (network
unavailable, server down, timeout, etc.), the verification engine MUST
fall back to the offline verification result. The verification state
SHOULD be reported as the offline result with an indication that online
verification was not possible.

### 5.3 Verification States

The PVF format defines three verification states:

#### 5.3.1 VERIFIED

The document has passed integrity verification. The SHA-256 hash of the
embedded payload matches the hash recorded in the PVF metadata. If
online verification was performed, the server has confirmed the
document's registration and the validity of the signature.

Visual indicator: Green stamp with "Verified" text.

#### 5.3.2 TAMPERED

The document has failed integrity verification. The SHA-256 hash of the
embedded payload does NOT match the hash recorded in the PVF metadata,
or the server has indicated that the signature is invalid.

Visual indicator: Red stamp with "Tampered" or "Integrity Check Failed"
text.

This state indicates that the PVF file has been modified after issuance.
The embedded document, the metadata, or both have been altered.

#### 5.3.3 UNKNOWN

The verification engine was unable to determine the document's integrity
status. This MAY occur when:

- The Web Cryptography API is not available
- A required metadata element is missing or malformed
- Online verification was required but the network was unavailable
- The PVF version is not supported

Visual indicator: Orange or amber stamp with "Unknown" or "Verification
Unavailable" text.

---

## 6. Security Considerations

### 6.1 Threat Model

The PVF format is designed to protect against the following threats:

1. **Post-issuance document modification** -- An attacker modifies the
   embedded document after the PVF file has been created. The hash
   comparison detects this modification.

2. **Metadata falsification** -- An attacker modifies the metadata (e.g.,
   changing the issuer name or creation date). Online verification
   detects this by comparing against the server's records.

3. **Signature forgery** -- An attacker attempts to create a valid
   signature for a modified document. Without the HMAC key, this is
   computationally infeasible.

4. **Replay attacks** -- An attacker presents a valid PVF file in a
   context where it should not be valid (e.g., after expiration or to
   the wrong recipient). Recipient binding and expiration metadata
   mitigate this.

The PVF format does NOT protect against:

- Compromise of the issuer's HMAC signing key
- Modification of the document before PVF creation
- Social engineering attacks where a victim is tricked into trusting a
  PVF file from an untrusted issuer
- Screen capture of the rendered document

### 6.2 Integrity Protection

Document integrity is protected by two independent mechanisms:

1. **SHA-256 hash** -- Provides tamper detection. Any modification to
   the payload will result in a different hash.

2. **HMAC-SHA256 signature** -- Provides issuer authentication. The
   signature proves that the hash was registered by an entity possessing
   the HMAC key.

The combination of these mechanisms ensures that an attacker cannot
modify the document and update the hash to match, because they cannot
forge a valid HMAC signature for the new hash without the secret key.

### 6.3 Anti-Tampering Measures

#### 6.3.1 JavaScript Integrity

The verification engine JavaScript code is part of the PVF file and
could theoretically be modified by an attacker to bypass verification
checks. The following countermeasures SHOULD be employed:

1. **Code obfuscation** -- The verification engine SHOULD be obfuscated
   to increase the difficulty of targeted modification (see
   [Section 6.4](#64-code-obfuscation)).

2. **Redundant checks** -- The verification engine SHOULD perform the
   hash comparison in multiple locations within the code to make it
   harder to bypass all checks.

3. **Online verification** -- Server-side verification provides an
   independent check that does not rely on the embedded JavaScript.

#### 6.3.2 HTML Structure Integrity

Implementations SHOULD minify and compress the HTML output to reduce the
attack surface for targeted modifications.

### 6.4 Code Obfuscation

The verification engine JavaScript code SHOULD be obfuscated before
embedding in the PVF file. Obfuscation increases the effort required for
an attacker to understand and modify the verification logic.

Recommended obfuscation techniques include:

1. **Variable name mangling** -- Replace meaningful variable names with
   short, random identifiers.
2. **Control flow flattening** -- Transform linear control flow into
   switch-based dispatch to obscure program logic.
3. **String encoding** -- Encode string literals and decode them at
   runtime.
4. **Dead code insertion** -- Insert non-functional code paths that
   appear relevant to confuse analysis.

Obfuscation is a defense-in-depth measure and MUST NOT be relied upon as
the sole protection mechanism. It SHOULD be combined with online
verification for robust tamper detection.

### 6.5 Screen Recording Prevention

PVF implementations MAY include measures to discourage unauthorized
screen recording or capture of the rendered document. Such measures
are inherently limited in effectiveness and SHOULD be considered as
deterrents rather than absolute protections.

Possible measures include:

1. **CSS-based overlay protection** -- Using CSS properties to interfere
   with screenshot tools.
2. **Visibility API monitoring** -- Detecting when the page is not
   visible (e.g., screen sharing) and obscuring content.
3. **Watermarking** -- Embedding visible or invisible watermarks in the
   rendered document.

These measures are OPTIONAL and their effectiveness varies across
browsers and operating systems.

### 6.6 Limitations

Implementors and users of the PVF format SHOULD be aware of the
following limitations:

1. **Client-side verification is advisory** -- Since the verification
   engine runs in the user's browser, a sufficiently sophisticated
   attacker can modify the verification result display. Online
   verification mitigates but does not eliminate this risk.

2. **No content encryption** -- The PVF format provides integrity
   protection, not confidentiality. The embedded document can be
   extracted by anyone who opens the PVF file.

3. **Base64 overhead** -- Base64 encoding increases the file size by
   approximately 33% compared to the original document.

4. **Browser dependency** -- The verification engine requires a modern
   web browser with JavaScript support and the Web Cryptography API.

5. **Hash algorithm agility** -- This version of the specification is
   fixed to SHA-256. If SHA-256 is ever found to be insecure, a new
   version of the specification will be required.

6. **HMAC key compromise** -- If the issuer's HMAC key is compromised,
   an attacker can forge valid signatures. The PVF format does not
   provide a mechanism for key revocation within existing files.

---

## 7. MIME Type Registration

The following IANA registration template is provided per [RFC 6838]:

```
Type name: application

Subtype name: vnd.vertifile.pvf

Required parameters: N/A

Optional parameters: N/A

Encoding considerations:
  PVF files are UTF-8 encoded text files that are also valid HTML5
  documents. They begin with the ASCII magic bytes "<!--PVF:1.0-->".
  Binary content (the document payload) is base64-encoded within the
  file. The file itself is 8-bit text and should be transferred using
  appropriate text encoding (UTF-8).

Security considerations:
  PVF files contain embedded JavaScript that executes when the file is
  opened in a web browser. The JavaScript implements document integrity
  verification using the Web Cryptography API. PVF files may also
  initiate network requests for online verification. The embedded
  JavaScript is sandboxed within the browser's standard security model.
  See Section 6 of the PVF Format Specification v1.0 for detailed
  security considerations.

Interoperability considerations:
  PVF files are valid HTML5 documents and can be opened in any modern
  web browser that supports ECMAScript 2017 (ES8) and the W3C Web
  Cryptography API. See Section 8 of the PVF Format Specification v1.0
  for detailed interoperability considerations.

Published specification:
  PVF Format Specification v1.0
  https://vertifile.com/spec/pvf-v1.0

Applications which use this media type:
  Vertifile document protection platform, PVF-compatible document
  viewers and verification tools.

Fragment identifier considerations: N/A

Restrictions on usage: N/A

Additional information:
  Deprecated alias names for this type: N/A
  Magic number(s): 3C 21 2D 2D 50 56 46 3A 31 2E 30 2D 2D 3E
                   (ASCII: "<!--PVF:1.0-->")
  File extension(s): .pvf
  Macintosh file type code: N/A
  Object Identifier(s) or OID(s): N/A

Person to contact for further information:
  Name: Zur Halfon
  Email: zur@vertifile.com

Intended usage: COMMON

Author/Change controller:
  Vertifile Ltd
  zur@vertifile.com
```

---

## 8. Interoperability

### 8.1 Browser Compatibility

A conforming PVF viewer requires a web browser that supports:

1. **HTML5** -- As defined by the WHATWG HTML Living Standard
2. **ECMAScript 2017 (ES8)** -- For `async`/`await` syntax used in the
   verification engine
3. **Web Cryptography API** -- For `crypto.subtle.digest('SHA-256', ...)`
4. **Blob URLs** -- For `URL.createObjectURL()` used in document
   rendering
5. **Base64 decoding** -- For `atob()` or equivalent

The following browsers meet these requirements:

| Browser               | Minimum Version | Release Date |
|-----------------------|-----------------|--------------|
| Google Chrome         | 60+             | July 2017    |
| Mozilla Firefox       | 57+             | Nov 2017     |
| Apple Safari          | 11+             | Sep 2017     |
| Microsoft Edge        | 79+ (Chromium)  | Jan 2020     |
| Opera                 | 47+             | Aug 2017     |

Implementations SHOULD test with the current stable versions of these
browsers. The minimum versions listed are for reference; older versions
are NOT RECOMMENDED.

### 8.2 Operating System Support

PVF files are platform-independent. They SHOULD function correctly on
any operating system that has a supported web browser, including:

- Windows 10 and later
- macOS 10.13 (High Sierra) and later
- Ubuntu 18.04 and later (and other modern Linux distributions)
- iOS 11 and later
- Android 8.0 (Oreo) and later
- ChromeOS

### 8.3 Viewer Requirements

A PVF file can be opened by:

1. **Direct browser opening** -- Double-clicking the `.pvf` file or
   opening it via `File > Open` in a browser. For this to work, the
   operating system must be configured to associate `.pvf` files with a
   web browser, or the user must manually select a browser.

2. **Dedicated PVF viewer application** -- A native application that
   embeds a web view component (e.g., Electron, WebView2, WKWebView) to
   render the PVF file.

3. **Web-based viewer** -- A web application that loads and renders PVF
   files uploaded by the user.

For method (1), the `file://` protocol origin SHOULD support the Web
Cryptography API. Most modern browsers support `crypto.subtle` on
`file://` origins, but some may require the use of a fallback SHA-256
implementation.

---

## 9. Examples

### 9.1 Minimal PVF File

The following is a minimal conforming PVF file. The base64 payload and
hash values are illustrative and do not correspond to a real document.

```html
<!--PVF:1.0-->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="pvf:version" content="1.0">
  <meta name="pvf:hash"
    content="b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9">
  <meta name="pvf:signature"
    content="f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8">
  <meta name="pvf:issuer" content="Vertifile Ltd">
  <meta name="pvf:created" content="2026-03-18T14:30:00Z">
  <meta name="pvf:original-name" content="hello.txt">
  <meta name="pvf:mime-type" content="text/plain">
  <title>PVF: hello.txt</title>
  <style>
    /* ... verification stamp styles ... */
    .pvf-stamp {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                   Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .pvf-stamp.verified {
      background-color: #e8f5e9;
      border: 2px solid #4caf50;
      color: #2e7d32;
    }
    .pvf-stamp.tampered {
      background-color: #ffebee;
      border: 2px solid #f44336;
      color: #c62828;
    }
  </style>
</head>
<body>
  <div id="pvf-document"></div>
  <div id="pvf-stamp" class="pvf-stamp"></div>

  <script>
    var __pvf_payload = "aGVsbG8gd29ybGQ=";
    var __pvf_meta = {
      hash: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      signature: "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
      issuer: "Vertifile Ltd",
      created: "2026-03-18T14:30:00Z",
      originalName: "hello.txt",
      mimeType: "text/plain"
    };
  </script>

  <script>
    (async function() {
      // Decode payload
      var raw = atob(__pvf_payload);
      var bytes = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
      }

      // Compute SHA-256
      var hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
      var hashArray = new Uint8Array(hashBuffer);
      var hashHex = Array.from(hashArray)
        .map(function(b) { return b.toString(16).padStart(2, '0'); })
        .join('');

      // Verify
      var stamp = document.getElementById('pvf-stamp');
      if (hashHex === __pvf_meta.hash) {
        stamp.className = 'pvf-stamp verified';
        stamp.textContent = 'Verified — ' + __pvf_meta.issuer;
      } else {
        stamp.className = 'pvf-stamp tampered';
        stamp.textContent = 'TAMPERED — Integrity Check Failed';
      }

      // Render document
      var container = document.getElementById('pvf-document');
      if (__pvf_meta.mimeType === 'text/plain') {
        var pre = document.createElement('pre');
        pre.textContent = new TextDecoder().decode(bytes);
        container.appendChild(pre);
      }
    })();
  </script>
</body>
</html>
```

### 9.2 PVF with Recipient Binding

The following example demonstrates a PVF file with recipient binding.
Only the `<head>` section is shown; the body follows the same structure
as Section 9.1.

```html
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="pvf:version" content="1.0">
  <meta name="pvf:hash"
    content="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855">
  <meta name="pvf:signature"
    content="d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592">
  <meta name="pvf:issuer" content="Vertifile Ltd">
  <meta name="pvf:created" content="2026-03-18T15:00:00Z">
  <meta name="pvf:original-name" content="contract-final.pdf">
  <meta name="pvf:mime-type" content="application/pdf">
  <meta name="pvf:recipient-hash"
    content="2c6ee24b09816a6cb7f5f82d867518b5b14a6d51aee05cc38cd9a1fb5b7ab2c4">
  <meta name="pvf:blockchain-tx"
    content="0x3a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b">
  <meta name="pvf:blockchain-network" content="polygon-mainnet">
  <meta name="pvf:document-id" content="f47ac10b-58cc-4372-a567-0e02b2c3d479">
  <meta name="pvf:issuer-url" content="https://api.vertifile.com">
  <title>PVF: contract-final.pdf</title>
  <!-- ... styles ... -->
</head>
```

In this example:
- The recipient binding hash corresponds to the SHA-256 of the
  recipient's lowercased email address.
- The blockchain transaction hash references a Polygon mainnet
  transaction that anchors the document hash.
- The document ID and issuer URL enable online verification via the
  Vertifile API.

---

## 10. References

### 10.1 Normative References

**[RFC 2104]** Krawczyk, H., Bellare, M., and R. Canetti, "HMAC:
Keyed-Hashing for Message Authentication", RFC 2104,
DOI 10.17487/RFC2104, February 1997,
<https://www.rfc-editor.org/info/rfc2104>.

**[RFC 2119]** Bradner, S., "Key words for use in RFCs to Indicate
Requirement Levels", BCP 14, RFC 2119, DOI 10.17487/RFC2119, March 1997,
<https://www.rfc-editor.org/info/rfc2119>.

**[RFC 4648]** Josefsson, S., "The Base16, Base32, and Base64 Data
Encodings", RFC 4648, DOI 10.17487/RFC4648, October 2006,
<https://www.rfc-editor.org/info/rfc4648>.

**[RFC 6838]** Freed, N., Klensin, J., and T. Hansen, "Media Type
Specifications and Registration Procedures", BCP 13, RFC 6838,
DOI 10.17487/RFC6838, January 2013,
<https://www.rfc-editor.org/info/rfc6838>.

**[RFC 8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in
RFC 2119 Key Words", BCP 14, RFC 8174, DOI 10.17487/RFC8174,
May 2017, <https://www.rfc-editor.org/info/rfc8174>.

**[FIPS 180-4]** National Institute of Standards and Technology,
"Secure Hash Standard (SHS)", FIPS PUB 180-4,
DOI 10.6028/NIST.FIPS.180-4, August 2015,
<https://csrc.nist.gov/publications/detail/fips/180/4/final>.

**[FIPS 198-1]** National Institute of Standards and Technology,
"The Keyed-Hash Message Authentication Code (HMAC)", FIPS PUB 198-1,
DOI 10.6028/NIST.FIPS.198-1, July 2008,
<https://csrc.nist.gov/publications/detail/fips/198/1/final>.

**[HTML Living Standard]** WHATWG, "HTML Living Standard",
<https://html.spec.whatwg.org/multipage/>.

**[Web Cryptography API]** W3C, "Web Cryptography API", W3C
Recommendation, January 2017,
<https://www.w3.org/TR/WebCryptoAPI/>.

### 10.2 Informative References

**[RFC 3174]** Eastlake 3rd, D. and P. Jones, "US Secure Hash
Algorithm 1 (SHA1)", RFC 3174, DOI 10.17487/RFC3174, September 2001,
<https://www.rfc-editor.org/info/rfc3174>.

**[RFC 6234]** Eastlake 3rd, D. and T. Hansen, "US Secure Hash
Algorithms (SHA and SHA-based HMAC and HKDF)", RFC 6234,
DOI 10.17487/RFC6234, May 2011,
<https://www.rfc-editor.org/info/rfc6234>.

**[ISO 8601]** International Organization for Standardization,
"Date and time -- Representations for information interchange",
ISO 8601:2019.

---

## Appendix A: Complete Metadata Reference

This appendix provides a consolidated reference of all PVF metadata
elements.

### A.1 Required Metadata Elements

| Meta Name           | Type     | Format                 | Description                          | Example                              |
|---------------------|----------|------------------------|--------------------------------------|--------------------------------------|
| `pvf:version`       | String   | Semantic version       | PVF spec version                     | `1.0`                                |
| `pvf:hash`          | String   | 64-char lowercase hex  | SHA-256 of payload bytes             | `b94d27b9934d3e08...`                |
| `pvf:signature`     | String   | 64-char lowercase hex  | HMAC-SHA256 of hash                  | `f7bc83f430538424...`                |
| `pvf:issuer`        | String   | UTF-8 text             | Issuing organization name            | `Vertifile Ltd`                      |
| `pvf:created`       | String   | ISO 8601 with timezone | Creation timestamp                   | `2026-03-18T14:30:00Z`              |
| `pvf:original-name` | String   | UTF-8 filename         | Original document filename           | `contract.pdf`                       |
| `pvf:mime-type`     | String   | MIME type              | Original document MIME type          | `application/pdf`                    |

### A.2 Optional Metadata Elements

| Meta Name               | Type     | Format                 | Description                          | Example                              |
|-------------------------|----------|------------------------|--------------------------------------|--------------------------------------|
| `pvf:recipient-hash`    | String   | 64-char lowercase hex  | SHA-256 of recipient email           | `2c6ee24b09816a6c...`                |
| `pvf:blockchain-tx`     | String   | Hex with 0x prefix     | Blockchain transaction hash          | `0x3a1b2c3d4e5f...`                  |
| `pvf:blockchain-network`| String   | Network identifier     | Blockchain network name              | `polygon-mainnet`                    |
| `pvf:document-id`       | String   | UUID v4                | Unique document identifier           | `f47ac10b-58cc-4372-a567-0e02b2c3d479` |
| `pvf:expiry`            | String   | ISO 8601 with timezone | Expiration timestamp                 | `2027-03-18T14:30:00Z`              |
| `pvf:issuer-url`        | String   | HTTPS URL              | Issuer verification endpoint base URL| `https://api.vertifile.com`          |

### A.3 Custom Metadata

Implementations MAY define additional metadata elements using the
`pvf:x-` prefix for vendor-specific extensions:

```html
<meta name="pvf:x-department" content="Legal">
<meta name="pvf:x-classification" content="Confidential">
```

Custom metadata elements MUST use the `pvf:x-` prefix. Implementations
MUST ignore any `pvf:x-` prefixed metadata elements that they do not
recognize.

---

## Appendix B: Verification API

This appendix defines the HTTP API for online verification of PVF files.

### B.1 Verify Document

Verify the registration and signature of a document by its hash.

**Request:**

```
POST {issuer-url}/api/verify
Content-Type: application/json

{
  "hash": "<64-char lowercase hex SHA-256 hash>"
}
```

**Successful Response (document registered and valid):**

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "verified",
  "hash": "<64-char lowercase hex SHA-256 hash>",
  "issuer": "<issuer name>",
  "created": "<ISO 8601 timestamp>",
  "documentId": "<UUID v4>",
  "recipientBound": <boolean>,
  "blockchainAnchored": <boolean>,
  "blockchainTx": "<transaction hash or null>",
  "blockchainNetwork": "<network identifier or null>"
}
```

**Response when document is not found:**

```
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "status": "unknown",
  "hash": "<64-char lowercase hex SHA-256 hash>",
  "message": "No document registered with this hash."
}
```

**Response when signature is invalid:**

```
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "status": "tampered",
  "hash": "<64-char lowercase hex SHA-256 hash>",
  "message": "Document hash found but signature verification failed."
}
```

### B.2 Verify Recipient Binding

Verify that a PVF file is bound to a specific recipient.

**Request:**

```
POST {issuer-url}/api/verify/recipient
Content-Type: application/json

{
  "hash": "<64-char lowercase hex SHA-256 document hash>",
  "recipientHash": "<64-char lowercase hex SHA-256 of recipient email>"
}
```

**Successful Response (binding confirmed):**

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "confirmed",
  "hash": "<document hash>",
  "recipientHash": "<recipient hash>",
  "bound": true
}
```

**Response when binding does not match:**

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "mismatch",
  "hash": "<document hash>",
  "recipientHash": "<recipient hash>",
  "bound": false,
  "message": "Recipient binding does not match the registered recipient."
}
```

### B.3 Error Responses

All API endpoints MUST return standard HTTP error codes for exceptional
conditions:

| Status Code | Condition                                     |
|-------------|-----------------------------------------------|
| 400         | Malformed request (missing or invalid hash)   |
| 401         | Authentication required (if API is protected) |
| 429         | Rate limit exceeded                           |
| 500         | Internal server error                         |
| 503         | Service temporarily unavailable               |

Error responses MUST include a JSON body:

```json
{
  "error": "<error code>",
  "message": "<human-readable error message>"
}
```

### B.4 Rate Limiting

Verification endpoints SHOULD implement rate limiting to prevent abuse.
When a rate limit is exceeded, the server MUST respond with HTTP 429 and
SHOULD include a `Retry-After` header indicating the number of seconds
the client should wait before retrying.

### B.5 CORS

Verification endpoints MUST support Cross-Origin Resource Sharing (CORS)
to allow PVF files opened from `file://` origins and other domains to
make verification requests. The server MUST include the following
response headers:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

---

*End of PVF Format Specification v1.0*
