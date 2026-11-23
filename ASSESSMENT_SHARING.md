# Assessment sharing: GIT G.O.A.T. writer contract

This branch implements the G.O.A.T. side of the proposed shared assessment flow. It does not implement or claim the Autonomous-Registry service or Full-Build reader. Until those services are implemented and configured, G.O.A.T. returns `BLOCKED` and keeps Full-Build verification `BLOCKED`.

## User action and endpoint

After a scan, the user can explicitly select **Share assessment**. G.O.A.T. then calls:

```http
POST /api/v1/scans/{scan_id}/share
```

The server loads the scan record and submits it to the configured Autonomous-Registry API. Missing URL/token, non-HTTPS configuration, rejected credentials, write failure, persistence/readback failure, ID mismatch, or digest mismatch returns a `BLOCKED` response. There is no local success record or process-memory substitute for registry persistence.

Required server-side environment variables (must be provisioned through protected secret setup, never the browser):

- `AUTONOMOUS_REGISTRY_BASE_URL`: HTTPS origin/base path of the deployed registry API.
- `AUTONOMOUS_REGISTRY_SERVICE_TOKEN`: least-privilege service credential; tenant ownership must be derived by the registry from this authenticated principal, not supplied by G.O.A.T.

No values are configured in this branch. Do not enable the action as connected until both are configured and exercised against the existing registry deployment.

## External API contract required by this client

`POST {base}/api/v1/assessments` with a bearer service identity, `Idempotency-Key: <scan_id>`, and the assessment body below. The registry must durably persist it, derive tenant/actor from authenticated identity, enforce tenant authorization, and return HTTP 201 (or idempotent HTTP 200) with `assessment_id`, `correlation_id`, and `record_digest`.

The client then independently requests:

```http
GET {base}/api/v1/assessments/by-correlation/{correlation_id}
```

The response must contain the same `assessment_id`, `correlation_id`, SHA-256 `record_digest`, and the persisted full `assessment` object. G.O.A.T. checks exact canonical-payload digest equality before returning `REGISTRY_READBACK_VERIFIED`. Canonical JSON is recursively sorted by object key; array order is preserved; SHA-256 is hex encoded. Registry and Full-Build must implement the identical canonicalization rule.

The submitted body contains repository URL, exact commit, scan timestamp, scanner identity/version, result status, and finding evidence. It does not include source-file contents or a client-supplied tenant ID. G.O.A.T.'s current `VERIFIED_COMPLETE` label establishes repository-artifact presence only, not operational effectiveness, so it is sent as `BLOCKED` rather than `PASS`. `BLOCKED`, `NOT RUN`, and `NOT_REQUIRED` findings are also never promoted to `PASS`. A scan can therefore remain `BLOCKED` or `PARTIAL` after sharing; sharing never upgrades its result.

## Verification boundary

`REGISTRY_READBACK_VERIFIED` means only that this G.O.A.T. server received a write acknowledgement and fetched the same durable record back from the Registry API with matching ID/correlation/digest. It is **not** Full-Build independent readback and does not prove tenant isolation on its own. The response explicitly keeps `full_build_verification: BLOCKED` until Full-Build's separately authenticated read endpoint and cross-tenant denial tests are implemented and exercised.

## Current unresolved prerequisites

- The API service endpoint and response envelope must be implemented in Autonomous-Registry.
- The registry must have durable existing-database persistence, service authentication, tenant derivation, and cross-tenant enforcement.
- Full-Build must implement its independent authenticated GET and digest verification.
- GitHub access for the connected account is read-only on Full-Build and Autonomous-Registry, so this branch cannot publish changes to those repositories.
