# Telemetry detail access

Session, question, feedback and error detail views require the Keycloak **realm role** `telemetry-detail-viewer`. The role is checked independently in the dashboard and on the service using the verified JWT's `realm_access.roles` claim.

`super-admin` alone does not grant detail access. A user with both roles can open details because they explicitly hold `telemetry-detail-viewer`. Existing report access and evaluation administration retain their existing permissions. Error reports are also available to detail viewers so they can navigate to individual errors.

## Keycloak setup

Create `telemetry-detail-viewer` as a realm role in the realm used by this deployment, and explicitly assign it only to approved users or a dedicated group. Do not add it to `super-admin` as an associated/composite role or to the realm's default roles. Otherwise Keycloak can include it in users' tokens through inheritance, and the application will treat it as granted.

After assignment, obtain a fresh login/access token and verify that `realm_access.roles` contains `telemetry-detail-viewer`. Dashboard Keycloak configuration and the service's `KEYCLOAK_ISSUER_URL` must reference the same deployment realm. The code does not create or assign the role in Keycloak.

## Protected service endpoints

All paths use the `/v1` prefix and require the existing Keycloak authentication plus the new role. Valid authenticated users without the role receive HTTP 403, including users with only `super-admin`.

- `GET /sessions/:sessionId`
- `GET /questions/:id`
- `GET /feedback/id/:id`
- `GET /errors/id/:id`
- `GET /questions/session/:sessionId`
- `GET /feedback/session/:sessionId`
- `GET /errors/session/:sessionId`

The dashboard guards the matching detail routes before mounting detail components and hides clickable detail links from users without the role. Question details, session timelines, and their question counts include only completed question/answer records (`answertext IS NOT NULL AND answertext <> ''`). This excludes the initial question-only telemetry event without merging legitimate repeated questions. Session details preserve rating-only feedback and errors, and load every page of feedback and errors. API failures are surfaced rather than silently producing a partial timeline.

## Verification

Run `npm test` in both repositories, and `npm run build` in the dashboard. Tests cover super-admin denial, explicit-role access, service route wiring, rendering all four views with service-shaped data, and multi-page session loading. Live Keycloak and database verification is still required after deployment.

Implementation validation: 10 dashboard tests and 32 service tests passed; the dashboard production build passed. The dashboard TypeScript check reports the same three existing errors as an untouched `origin/mh-main` snapshot (ServiceSection, Evaluation and HealthMonitor). The repository ESLint configuration is incompatible with the installed ESLint version; the new role helper, detail API helper, detail link and recovered pages passed a focused lint check using a temporary compatible configuration.
