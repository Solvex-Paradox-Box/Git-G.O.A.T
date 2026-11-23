import { createHash, timingSafeEqual } from 'node:crypto';
import type { Finding, ScanReport } from '../shared/contracts.js';

export type RegistryAssessment = {
  correlation_id: string;
  repository: { url: string; commit_sha: string };
  scanned_at: string;
  scanner: { name: string; version: string };
  result: {
    status: 'PASS' | 'FAIL' | 'BLOCKED' | 'PARTIAL';
    summary: string;
    evidence: Array<{
      check_id: string;
      status: 'PASS' | 'FAIL' | 'BLOCKED';
      description: string;
      source: string;
      content_sha256: string;
    }>;
  };
};

type RegistryRecord = {
  assessment_id: string;
  correlation_id: string;
  record_digest: string;
  created_at?: string;
  assessment?: RegistryAssessment;
};

export type SharedAssessmentResult = {
  status: 'REGISTRY_READBACK_VERIFIED';
  assessment_id: string;
  correlation_id: string;
  record_digest: string;
  registry_verified_at: string;
  full_build_verification: 'BLOCKED';
  note: string;
};

export class AssessmentShareError extends Error {
  constructor(message: string, readonly httpStatus = 503) {
    super(message);
    this.name = 'AssessmentShareError';
  }
}

/** Canonical JSON used for local SHA-256 integrity checks (sorted object keys, ordered arrays). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('Value is not representable as canonical JSON.');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function evidenceStatus(status: Finding['status']): 'PASS' | 'FAIL' | 'BLOCKED' {
  // Current G.O.A.T. checks establish repository-artifact presence, not operational
  // effectiveness or execution. Preserve the finding but do not call it PASS.
  if (status === 'VERIFIED_COMPLETE') return 'BLOCKED';
  if (status === 'REMEDIATION_REQUIRED') return 'FAIL';
  // BLOCKED, NOT RUN, and NOT_REQUIRED are never promoted to PASS.
  return 'BLOCKED';
}

function resultStatus(findings: Finding[]): RegistryAssessment['result']['status'] {
  if (findings.length === 0) return 'BLOCKED';
  if (findings.some(finding => finding.status === 'BLOCKED')) return 'BLOCKED';
  if (findings.some(finding => finding.status === 'NOT RUN' || finding.status === 'NOT_REQUIRED')) return 'PARTIAL';
  if (findings.some(finding => finding.status === 'REMEDIATION_REQUIRED')) return 'FAIL';
  return 'PASS';
}

export function toRegistryAssessment(report: ScanReport): RegistryAssessment {
  const evidence = report.findings.map(finding => {
    const description = `${finding.title}: ${finding.detail} Evidence: ${finding.evidence.join(' | ')}`;
    return {
      check_id: finding.id,
      status: evidenceStatus(finding.status),
      description,
      source: `GIT G.O.A.T. scan ${report.id}, finding ${finding.id}`,
      content_sha256: createHash('sha256').update(description, 'utf8').digest('hex'),
    };
  });
  const status = resultStatus(report.findings);
  const summary = `Read-only assessment of ${report.repository} at commit ${report.commit}: ${report.findings.length} findings; ${report.files} Git blobs inventoried; ${report.coverage.contentInspected} text files inspected; repository code execution ${report.coverage.executionStatus}.`;
  return {
    correlation_id: report.id,
    repository: { url: report.repository, commit_sha: report.commit },
    scanned_at: report.scannedAt,
    scanner: { name: 'GIT G.O.A.T.', version: process.env.npm_package_version || '0.1.0' },
    result: { status, summary, evidence },
  };
}

function secureEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function registryConfig(): { baseUrl: URL; token: string } {
  const rawBase = process.env.AUTONOMOUS_REGISTRY_BASE_URL?.trim();
  const token = process.env.AUTONOMOUS_REGISTRY_SERVICE_TOKEN?.trim();
  if (!rawBase || !token) {
    throw new AssessmentShareError('BLOCKED: Autonomous-Registry URL and service authentication are not configured.');
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBase);
  } catch {
    throw new AssessmentShareError('BLOCKED: Autonomous-Registry base URL is invalid.');
  }
  const localHttp = baseUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname);
  if (baseUrl.protocol !== 'https:' && !localHttp) {
    throw new AssessmentShareError('BLOCKED: Autonomous-Registry must use HTTPS.');
  }
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new AssessmentShareError('BLOCKED: Autonomous-Registry base URL must not contain credentials, query parameters, or a fragment.');
  }
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}/`;
  return { baseUrl, token };
}

async function requestJson(url: URL, token: string, method: 'POST' | 'GET', body?: RegistryAssessment, idempotencyKey?: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch {
      throw new AssessmentShareError('BLOCKED: Autonomous-Registry returned a non-JSON response.');
    }
  }
  return { status: response.status, body: parsed };
}

function parseRecord(value: unknown): RegistryRecord {
  if (!value || typeof value !== 'object') throw new AssessmentShareError('BLOCKED: Registry response has no assessment record.');
  const record = value as Partial<RegistryRecord>;
  if (typeof record.assessment_id !== 'string' || !record.assessment_id ||
      typeof record.correlation_id !== 'string' || !record.correlation_id ||
      typeof record.record_digest !== 'string' || !/^[a-f0-9]{64}$/.test(record.record_digest)) {
    throw new AssessmentShareError('BLOCKED: Registry response is missing a valid assessment ID, correlation ID, or SHA-256 digest.');
  }
  return record as RegistryRecord;
}

/**
 * Writes to the configured Autonomous-Registry API, then independently reads by
 * correlation ID and verifies both the exact payload and its digest. No local
 * success state is created when config, auth, persistence, or readback is absent.
 */
export async function shareAssessment(report: ScanReport): Promise<SharedAssessmentResult> {
  const { baseUrl, token } = registryConfig();
  const assessment = toRegistryAssessment(report);
  const expectedDigest = sha256Canonical(assessment);
  const writeUrl = new URL('api/v1/assessments', baseUrl);
  let created: RegistryRecord;
  try {
    const response = await requestJson(writeUrl, token, 'POST', assessment, report.id);
    if (response.status !== 201 && response.status !== 200) {
      if (response.status === 401 || response.status === 403) throw new AssessmentShareError('BLOCKED: Autonomous-Registry rejected the service identity.', 503);
      if (response.status === 409) throw new AssessmentShareError('BLOCKED: Registry rejected an idempotency or correlation conflict.', 409);
      throw new AssessmentShareError(`BLOCKED: Registry write was not confirmed (HTTP ${response.status}).`);
    }
    created = parseRecord(response.body);
  } catch (error) {
    if (error instanceof AssessmentShareError) throw error;
    throw new AssessmentShareError('BLOCKED: Registry write failed or timed out; persistence is unverified.');
  }
  if (created.correlation_id !== report.id || !secureEqual(created.record_digest, expectedDigest)) {
    throw new AssessmentShareError('BLOCKED: Registry write response correlation ID or digest did not match the submitted assessment.');
  }

  const readUrl = new URL(`api/v1/assessments/by-correlation/${encodeURIComponent(report.id)}`, baseUrl);
  let persisted: RegistryRecord;
  try {
    const response = await requestJson(readUrl, token, 'GET');
    if (response.status !== 200) throw new AssessmentShareError(`BLOCKED: Independent registry readback failed (HTTP ${response.status}).`);
    persisted = parseRecord(response.body);
  } catch (error) {
    if (error instanceof AssessmentShareError) throw error;
    throw new AssessmentShareError('BLOCKED: Registry readback failed or timed out.');
  }
  if (persisted.assessment_id !== created.assessment_id ||
      persisted.correlation_id !== report.id ||
      !secureEqual(persisted.record_digest, expectedDigest) ||
      !persisted.assessment ||
      !secureEqual(sha256Canonical(persisted.assessment), expectedDigest)) {
    throw new AssessmentShareError('BLOCKED: Persisted registry assessment failed exact payload, ID, correlation, or hash verification.');
  }
  return {
    status: 'REGISTRY_READBACK_VERIFIED',
    assessment_id: persisted.assessment_id,
    correlation_id: persisted.correlation_id,
    record_digest: persisted.record_digest,
    registry_verified_at: new Date().toISOString(),
    full_build_verification: 'BLOCKED',
    note: 'Registry persistence and readback were verified by GIT G.O.A.T.; independent Full-Build retrieval is not yet implemented or verified.',
  };
}
