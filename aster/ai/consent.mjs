// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
// Opt-in AI request policy: provider configuration checks, redaction,
// per-request preview, explicit consent bound to the exact payload, and
// provenance labels for generated text. This module contains no network
// code; a future request broker must call authorizeSend() immediately
// before transmitting and send exactly the payload it authorized.
import {clean, cleanMultiline, assertId, isPlainObject, canonicalJson, sha256Hex, randomId, fail} from '../common/util.mjs';

export const AI_PURPOSES = Object.freeze(['explain', 'summarize', 'feedback', 'brainstorm', 'quiz', 'translate', 'other']);
export const AI_LIMITS = Object.freeze({items: 16, characters: 200000, instructions: 4000, ttlMs: 5 * 60 * 1000, log: 500});

export const ACADEMIC_NOTICE = 'AI-generated assistance, not your original work. Check it, and acknowledge AI use as your school or IB guidance requires.';

// Provider settings never contain a secret. The credential is a reference to
// an OS keychain item that only the privileged broker can resolve.
export function validateProviderConfig(input) {
  if (!isPlainObject(input)) fail('invalid_provider', 'Provider configuration must be an object');
  const id = assertId(input.id, 'provider ID');
  const name = clean(input.name, 80) || fail('invalid_provider', 'Provider name is required');
  let endpoint;
  try { endpoint = new URL(input.endpoint); } catch { fail('invalid_provider', 'Endpoint must be a URL'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) {
    fail('invalid_provider', 'Endpoint must be HTTPS without credentials or fragments');
  }
  if ([...endpoint.searchParams.keys()].some(key => /key|token|secret|auth|password/i.test(key))) {
    fail('invalid_provider', 'Do not put secrets in the endpoint URL; use the keychain');
  }
  const model = clean(input.model, 128) || fail('invalid_provider', 'Model is required');
  const credential = input.credential;
  if (!isPlainObject(credential) || Object.keys(credential).length !== 1 || typeof credential.keychainRef !== 'string'
      || !/^aster-ai\/[a-zA-Z0-9_-]{1,64}$/.test(credential.keychainRef)) {
    fail('invalid_provider', 'Credential must be a keychain reference such as {keychainRef: "aster-ai/provider"}');
  }
  return {id, name, endpoint: endpoint.href, model, credential: {keychainRef: credential.keychainRef}};
}

const REDACTIONS = [
  ['api_key', /\b(?:sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abpr]-[A-Za-z0-9-]{10,})\b/g],
  ['bearer_token', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi],
  ['email', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
  ['card_number', /\b(?:\d[ -]?){12,18}\d\b/g],
  ['phone', /(?<![\w+])\+?\d[\d ().-]{7,}\d\b/g],
];

const luhn = digits => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
};

// Removes common secrets and personal contact details. This is a safety net,
// not a guarantee; the preview still shows the user everything that will be sent.
export function redactSensitive(text) {
  let result = String(text ?? '');
  const counts = {};
  for (const [kind, pattern] of REDACTIONS) {
    result = result.replace(pattern, match => {
      if (kind === 'card_number') {
        const digits = match.replace(/\D/g, '');
        if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return match;
      }
      if (kind === 'phone') {
        const digits = match.replace(/\D/g, '').length; // E.164 numbers have at most 15 digits
        if (digits < 9 || digits > 15 || /^\d{4}-\d{2}-\d{2}/.test(match)) return match;
      }
      counts[kind] = (counts[kind] || 0) + 1;
      return `[redacted ${kind.replace('_', ' ')}]`;
    });
  }
  return {text: result, redactions: Object.entries(counts).map(([kind, count]) => ({kind, count}))};
}

// The exact body a broker may send. Hashing it binds consent to the content.
export function buildPayload(preview) {
  return {
    provider: preview.provider.id, model: preview.provider.model, purpose: preview.purpose,
    instructions: preview.instructions, items: preview.items.map(item => ({label: item.label, text: item.text})),
  };
}

export async function prepareRequest({requestId, provider, purpose, instructions = '', items, offTheRecord = false, redact = true}) {
  if (offTheRecord) fail('private_profile', 'AI requests are disabled in private windows');
  assertId(requestId, 'request ID');
  const config = validateProviderConfig(provider);
  if (!AI_PURPOSES.includes(purpose)) fail('invalid_request', 'Unknown purpose');
  if (!Array.isArray(items) || !items.length || items.length > AI_LIMITS.items) fail('invalid_request', `Include 1–${AI_LIMITS.items} items`);
  const redactionTotals = new Map();
  const warnings = [];
  const prepared = items.map((item, index) => {
    if (!isPlainObject(item)) fail('invalid_request', 'Invalid item');
    const original = cleanMultiline(item.text, AI_LIMITS.characters + 1);
    if (!original) fail('invalid_request', 'Items cannot be empty');
    const {text, redactions} = redact ? redactSensitive(original) : {text: original, redactions: []};
    for (const {kind, count} of redactions) redactionTotals.set(kind, (redactionTotals.get(kind) || 0) + count);
    let origin = '';
    if (item.origin) {
      try { origin = new URL(item.origin).origin; } catch { fail('invalid_request', 'Item origin must be a URL'); }
    }
    return {label: clean(item.label, 80) || `Item ${index + 1}`, origin, text, characters: text.length};
  });
  const totalCharacters = prepared.reduce((total, item) => total + item.characters, 0);
  if (totalCharacters > AI_LIMITS.characters) fail('limit_exceeded', 'Too much content for one request');
  const origins = new Set(prepared.map(item => item.origin).filter(Boolean));
  if (origins.size > 1) warnings.push(`Content comes from ${origins.size} different websites.`);
  if (!redact) warnings.push('Redaction is off; personal details will be sent as shown.');
  if (['feedback', 'brainstorm', 'summarize'].includes(purpose)) warnings.push(ACADEMIC_NOTICE);
  const preview = {
    requestId, purpose, instructions: cleanMultiline(instructions, AI_LIMITS.instructions),
    provider: {id: config.id, name: config.name, host: new URL(config.endpoint).host, model: config.model},
    items: prepared, totalCharacters, warnings,
    redactions: [...redactionTotals].map(([kind, count]) => ({kind, count})),
  };
  preview.digest = await sha256Hex(canonicalJson(buildPayload(preview)));
  return preview;
}

// Records decisions and issues single-use, short-lived grants. Only
// metadata is logged, never request content.
export class ConsentBroker {
  #grants = new Map();
  #log = [];
  #now;
  #ttl;

  constructor({now = () => Date.now(), ttlMs = AI_LIMITS.ttlMs} = {}) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 60 * 60 * 1000) fail('invalid_config', 'ttlMs must be 1 s – 1 h');
    this.#now = now;
    this.#ttl = ttlMs;
  }

  #record(preview, decision) {
    this.#log.push({requestId: preview.requestId, decision, at: new Date(this.#now()).toISOString(),
      provider: preview.provider.id, purpose: preview.purpose, characters: preview.totalCharacters, digest: preview.digest});
    if (this.#log.length > AI_LIMITS.log) this.#log.shift();
  }

  approve(preview) {
    if (!isPlainObject(preview) || typeof preview.digest !== 'string' || !/^[0-9a-f]{64}$/.test(preview.digest)) {
      fail('invalid_preview', 'Approve a preview returned by prepareRequest');
    }
    const grantId = randomId();
    const expiresAt = this.#now() + this.#ttl;
    this.#grants.set(grantId, {digest: preview.digest, requestId: preview.requestId, expiresAt});
    this.#record(preview, 'approved');
    return {grantId, expiresAt: new Date(expiresAt).toISOString()};
  }

  deny(preview) { this.#record(preview, 'denied'); }

  // Call immediately before sending. Succeeds once, and only for the exact
  // payload that was previewed and approved.
  async authorizeSend(grantId, payload) {
    const grant = this.#grants.get(grantId);
    if (!grant) fail('no_consent', 'No consent for this request, or it was already used');
    this.#grants.delete(grantId);
    if (this.#now() > grant.expiresAt) fail('consent_expired', 'Consent expired; preview the request again');
    if (await sha256Hex(canonicalJson(payload)) !== grant.digest) fail('payload_changed', 'Request content changed after consent');
    return {requestId: grant.requestId};
  }

  revokeAll() { this.#grants.clear(); }
  get log() { return this.#log.map(entry => ({...entry})); }
}

export function labelGeneratedText(text, {provider, model, generatedAt}) {
  if (typeof generatedAt !== 'string' || Number.isNaN(Date.parse(generatedAt))) fail('invalid_timestamp', 'generatedAt is required');
  return {
    text: cleanMultiline(text, 200000),
    provenance: {generatedBy: 'ai', provider: clean(provider, 80), model: clean(model, 128), generatedAt, notice: ACADEMIC_NOTICE},
  };
}
