const express = require('express');
const { getClientIP } = require('../middleware/auth');
const logger = require('../services/logger');
const { verifySignature } = require('../services/pvf-generator');

const router = express.Router();

// Gateway intake — receive a .pvf file, verify it, extract original doc
router.post('/intake', (req, res, next) => {
  req.app.get('authenticateApiKey')(req, res, next);
}, (req, res, next) => {
  const upload = req.app.get('upload');
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large'
        : err.code === 'LIMIT_FILE_COUNT' ? 'Too many files'
        : err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Unexpected file field'
        : 'File upload failed';
      return res.status(400).json({ success: false, error: msg });
    }
    next();
  });
}, async (req, res) => {
  try {
    const db = req.app.get('db');
    const { fireWebhooks } = require('./webhooks');

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const pvfContent = req.file.buffer.toString('utf-8');

    // Extract hash and signature from the PVF HTML
    const hashMatch = pvfContent.match(/var\s+HASH\s*=\s*"([a-f0-9]{64})"/);
    const sigMatch = pvfContent.match(/var\s+SIG\s*=\s*"([a-f0-9]{64})"/);

    if (!hashMatch || !sigMatch) {
      await db.log('gateway_intake', { orgId: req.org.orgId, ip: getClientIP(req), result: 'invalid_pvf' });
      return res.status(400).json({ success: false, error: 'Invalid PVF file — could not extract hash/signature' });
    }

    const hash = hashMatch[1];
    const signature = sigMatch[1];

    // Verify against database
    const doc = await db.getDocument(hash);
    if (!doc) {
      await db.log('gateway_intake', { orgId: req.org.orgId, hash, ip: getClientIP(req), result: 'not_found' });
      return res.json({
        success: true,
        verified: false,
        reason: 'Document not registered in Vertifile'
      });
    }

    // Verify HMAC signature
    let signatureValid = false;
    try {
      signatureValid = verifySignature(hash, signature);
    } catch (e) {
      signatureValid = false;
    }

    if (!signatureValid) {
      await db.log('gateway_intake', { orgId: req.org.orgId, hash, ip: getClientIP(req), result: 'invalid_signature' });
      return res.json({
        success: true,
        verified: false,
        reason: 'Signature mismatch — document may have been tampered with'
      });
    }

    // Extract the embedded file content from PVF
    let extractedFile = null;
    const imgMatch = pvfContent.match(/src="data:[^;]+;base64,([A-Za-z0-9+/=]+)"/);
    const pdfMatch = pvfContent.match(/src="data:application\/pdf;base64,([A-Za-z0-9+/=]+)"/);
    const textMatch = pvfContent.match(/<div class="text-doc">([\s\S]*?)<\/div>/);

    if (imgMatch) {
      const b64 = imgMatch[1];
      if (/^[A-Za-z0-9+/=]+$/.test(b64)) {
        extractedFile = b64;
      }
    } else if (pdfMatch) {
      const b64 = pdfMatch[1];
      if (/^[A-Za-z0-9+/=]+$/.test(b64)) {
        extractedFile = b64;
      }
    } else if (textMatch) {
      const cleanText = textMatch[1].trim().replace(/<[^>]*>/g, '');
      extractedFile = Buffer.from(cleanText).toString('base64');
    }

    await db.log('gateway_intake', { orgId: req.org.orgId, hash, ip: getClientIP(req), result: 'verified', issuedBy: doc.orgName });

    // Fire webhooks for the receiving org
    fireWebhooks(db, req.org.orgId, 'verification.success', {
      hash,
      originalName: doc.originalName,
      issuedBy: doc.orgName,
      verifiedAt: new Date().toISOString()
    });

    res.json({
      success: true,
      verified: true,
      document: {
        hash: doc.hash,
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        fileSize: doc.fileSize,
        issuedAt: doc.timestamp,
        issuedBy: doc.orgName,
        orgId: doc.orgId
      },
      extractedFile,
      verifiedAt: new Date().toISOString()
    });

  } catch (error) {
    logger.error('[GATEWAY] Intake error:', error.message);
    res.status(500).json({ success: false, error: 'Gateway processing error' });
  }
});

// Gateway batch — verify multiple PVF files at once
router.post('/batch', (req, res, next) => {
  req.app.get('authenticateApiKey')(req, res, next);
}, (req, res, next) => {
  const upload = req.app.get('upload');
  upload.array('files', 50)(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large'
        : err.code === 'LIMIT_FILE_COUNT' ? 'Too many files'
        : err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Unexpected file field'
        : 'File upload failed';
      return res.status(400).json({ success: false, error: msg });
    }
    next();
  });
}, async (req, res) => {
  try {
    const db = req.app.get('db');

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }

    const results = await Promise.all(req.files.map(async (file, index) => {
      try {
        const pvfContent = file.buffer.toString('utf-8');
        const hashMatch = pvfContent.match(/var\s+HASH\s*=\s*"([a-f0-9]{64})"/);
        const sigMatch = pvfContent.match(/var\s+SIG\s*=\s*"([a-f0-9]{64})"/);

        if (!hashMatch || !sigMatch) {
          return { index, filename: file.originalname, verified: false, reason: 'invalid_pvf' };
        }

        const hash = hashMatch[1];
        const signature = sigMatch[1];
        const doc = await db.getDocument(hash);

        if (!doc) {
          return { index, filename: file.originalname, verified: false, reason: 'not_found', hash };
        }

        let signatureValid = false;
        try { signatureValid = verifySignature(hash, signature); } catch (e) {}

        if (!signatureValid) {
          return { index, filename: file.originalname, verified: false, reason: 'invalid_signature', hash };
        }

        return {
          index,
          filename: file.originalname,
          verified: true,
          document: {
            hash: doc.hash,
            originalName: doc.originalName,
            mimeType: doc.mimeType,
            issuedAt: doc.timestamp,
            issuedBy: doc.orgName
          }
        };
      } catch (e) {
        return { index, filename: file.originalname, verified: false, reason: 'processing_error' };
      }
    }));

    const verified = results.filter(r => r.verified).length;
    const failed = results.length - verified;

    await db.log('gateway_batch', {
      orgId: req.org.orgId,
      ip: getClientIP(req),
      total: results.length,
      verified,
      failed
    });

    res.json({ success: true, total: results.length, verified, failed, results });

  } catch (error) {
    logger.error('[GATEWAY] Batch error:', error.message);
    res.status(500).json({ success: false, error: 'Batch processing error' });
  }
});

module.exports = router;
