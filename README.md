# Telemetry Dashboard Service

Express API for the telemetry dashboard. See [API documentation](API_DOCUMENTATION.md)
and [technical documentation](TECHNICAL_DOCUMENTATION.md) for existing endpoints
and deployment configuration.

## Service Check

Each API row includes separate `errorTypes` and `rejectedTypes` arrays, scoped to
the selected date range and state. Rejection labels are derived from recognized
message patterns after removing the `rejected:` prefix. Unmatched or missing
messages are grouped as `unknown`, even when a stored rejection type exists.
This works on existing outcome records without a migration.

Rejection labels are shortened before grouping: `No Record Found for this (...)`
becomes `No Record Found`, duplicate-grievance messages become
`Grievance already registered.`, and exception messages keep only their class
(for example, `System.IndexOutOfRangeException`), not the stack trace. Variants
share one count per API. Other reasons, including invalid registration/OTP
messages and rejection codes such as `http_401`, contribute to `unknown`.
Raw messages and identifiers are not displayed.
The separate error types and counts are unchanged.

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
