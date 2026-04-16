/**
 * Shared helpers for repository modules.
 *
 * Row mappers and utility functions used across multiple repos live here
 * to avoid duplication. Each repo imports only the helpers it needs.
 */

// Escape LIKE/ILIKE wildcard characters to prevent pattern injection.
// Callers building LIKE patterns from user input MUST wrap the raw
// string through this helper before concatenating the leading/trailing %.
function escapeLike(str) {
  return str.replace(/[%_\\]/g, '\\$&');
}

function mapDocRow(row) {
  if (!row) return null;
  return {
    hash: row.hash,
    signature: row.signature,
    originalName: row.original_name,
    mimeType: row.mime_type,
    fileSize: row.file_size != null ? Number(row.file_size) : null,
    timestamp: row.created_at,
    token: row.token,
    tokenCreatedAt: row.token_created_at != null ? Number(row.token_created_at) : null,
    orgId: row.org_id,
    orgName: row.org_name,
    recipient: row.recipient || null,
    recipientHash: row.recipient_hash || null,
    shareId: row.share_id || undefined,
    // Integrity + owner columns -- required by /api/verify and the
    // Layer 2 dual-hash fallback for stamp overrides.
    code_integrity: row.code_integrity || null,
    chained_token: row.chained_token || null,
    user_id: row.user_id || null,
    // Ed25519 dual-signature columns (Phase 2A -- null until Phase 2B activates signing)
    ed25519_signature: row.ed25519_signature || null,
    ed25519_key_id: row.ed25519_key_id || null,
    // Zero-knowledge columns (PVF 2.0)
    slug: row.slug || null,
    encrypted: !!row.encrypted,
    iv: row.iv || null,
    pvf_version: row.pvf_version || '1.0',
  };
}

function mapKeyRow(row) {
  if (!row) return null;
  return {
    orgId: row.org_id,
    orgName: row.org_name,
    plan: row.plan,
    created: row.created_at,
    documentsCreated: Number(row.documents_created),
    active: Number(row.active) === 1,
    rateLimit: Number(row.rate_limit),
    allowedIPs: row.allowed_ips
      ? (() => { try { return JSON.parse(row.allowed_ips); } catch (_) { return []; } })()
      : undefined,
  };
}

function mapKeyListRow(row) {
  return {
    apiKey: row.api_key,
    orgId: row.org_id,
    orgName: row.org_name,
    plan: row.plan,
    created: row.created_at,
    documentsCreated: Number(row.documents_created),
    active: Number(row.active) === 1,
    rateLimit: Number(row.rate_limit),
  };
}

function mapAuditRow(row) {
  return {
    id: row.id,
    timestamp: row.timestamp,
    event: row.event,
    details: row.details
      ? (() => { try { return JSON.parse(row.details); } catch (_) { return {}; } })()
      : {},
  };
}

function mapWebhookRow(row) {
  return {
    id: row.id,
    url: row.url,
    events: (() => { try { return JSON.parse(row.events); } catch (_) { return []; } })(),
    secret: row.secret,
    createdAt: row.created_at,
  };
}

function mapAllWebhookRow(row) {
  return {
    id: row.id,
    orgId: row.org_id,
    url: row.url,
    events: typeof row.events === 'string'
      ? (() => { try { return JSON.parse(row.events); } catch (_) { return []; } })()
      : row.events,
    active: !!Number(row.active),
    createdAt: row.created_at,
  };
}

function mapAllDocRow(row) {
  return {
    hash: row.hash,
    originalName: row.original_name,
    mimeType: row.mime_type,
    fileSize: row.file_size != null ? Number(row.file_size) : null,
    createdAt: row.created_at,
    orgId: row.org_id,
    orgName: row.org_name,
    recipient: row.recipient,
    recipientHash: row.recipient_hash,
  };
}

module.exports = {
  escapeLike,
  mapDocRow,
  mapKeyRow,
  mapKeyListRow,
  mapAuditRow,
  mapWebhookRow,
  mapAllWebhookRow,
  mapAllDocRow,
};
