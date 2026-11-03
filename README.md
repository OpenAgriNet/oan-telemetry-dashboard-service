# Telemetry Dashboard Service

Express API for the telemetry dashboard. See [API documentation](API_DOCUMENTATION.md)
and [technical documentation](TECHNICAL_DOCUMENTATION.md) for existing endpoints
and deployment configuration.

## Service Check

Each API row includes separate `errorTypes` and `rejectedTypes` arrays, scoped to
the selected date range and state. Rejection labels use the recorded rejection
message (for example, "Grievance already registered" or "Registration number
wrong"), with the `rejected:` prefix removed and identifiers masked using the
existing PII helper. Counts are combined per API after masking. Missing messages
fall back to the stored type or `unknown`; reasons are never inferred from status
alone. This works on existing outcome records without a migration.

`GET /v1/service-check` returns registered services, including PM-KISAN and
**Voice**, using `ext_api_calls`. It requires the existing bearer authentication
and authorized `x-telemetry-state` header. Optional filters: `startDate`,
`endDate`, and `service` (for example, `voice`).

Voice has one API row, `voice_chat_completions` (Chat Completions). Each recorded
voice HTTP request contributes one call, including streaming and non-streaming:
completed 2xx responses are successful, completed 4xx responses are rejected,
and server failures or interrupted streams are errors. Failed = rejected +
error. Counts, success rate, latency, last call, and error types use the existing
Service Check response shape. The `toolCalls` field counts request event IDs for
Voice, not sessions, SSE chunks, or model retries.

The Voice row appears with zeros when no events exist. Accurate outcome counts
require the updated voice API and telemetry processor; old voice-turn telemetry
cannot backfill failed/rejected requests. Deploy the processor before the voice
API. No database migration is required.

```sh
node --test test/service-check.test.js
```
