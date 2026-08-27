# API Documentation

This document provides an overview of the available API endpoints.

## Feedback API (`controllers/feedback.controller.js`)

### 1. Get All Feedback
*   **Endpoint:** `GET /feedback`
*   **Description:** Retrieves a paginated list of all feedback entries. Supports searching and filtering by date range.
*   **Query Parameters:**
    *   `page` (optional, number): The page number for pagination (default: 1).
    *   `limit` (optional, number): The number of items per page (default: 10, max: 100).
    *   `search` (optional, string): A search term to filter feedback by text, question text, or answer text.
    *   `startDate` (optional, string): The start date for filtering (ISO date string YYYY-MM-DD or Unix timestamp in milliseconds).
    *   `endDate` (optional, string): The end date for filtering (ISO date string YYYY-MM-DD or Unix timestamp in milliseconds).
*   **Responses:**
    *   `200 OK`: Returns a JSON object containing the feedback data, pagination details, and applied filters.
    *   `400 Bad Request`: If search term is too long, date format is invalid, or start date is after end date.
    *   `500 Internal Server Error`: If there is an error fetching feedback data.

## Sessions API (`controllers/sessions.controller.js`)

### 1. Get All Sessions
*   **Endpoint:** `GET /sessions`
*   **Description:** Retrieves a paginated list of all user sessions. Supports searching and filtering by date range.
*   **Query Parameters:**
    *   `page` (optional, number): The page number for pagination (default: 1).
    *   `limit` (optional, number): The number of items per page (default: 10, max: 100).
    *   `search` (optional, string): A search term to filter sessions by session ID or user ID.
    *   `startDate` (optional, string): The start date for filtering (ISO date string YYYY-MM-DD or Unix timestamp in milliseconds).
    *   `endDate` (optional, string): The end date for filtering (ISO date string YYYY-MM-DD or Unix timestamp in milliseconds).
*   **Responses:**
    *   `200 OK`: Returns a JSON object with `success: true`, session data, pagination details, and applied filters.
    *   `400 Bad Request`: If search term is too long, date format is invalid, or start date is after end date.
    *   `500 Internal Server Error`: If there is an error fetching sessions data.

### 2. Get Sessions by User ID
*   **Endpoint:** `GET /sessions/user/:userId`
*   **Description:** Retrieves a paginated list of sessions for a specific user ID. Supports date filtering.
*   **Path Parameters:**
    *   `userId` (required, string): The ID of the user.
*   **Query Parameters:**
    *   `page` (optional, number): The page number for pagination (default: 1).
    *   `limit` (optional, number): The number of items per page (default: 10, max: 100).
    *   `startDate` (optional, string): The start date for filtering (ISO date string YYYY-MM-DD or Unix timestamp in milliseconds).
    *   `endDate` (optional, string): The end date for filtering (ISO date string YYYY-MM-DD or Unix timestamp in milliseconds).
*   **Responses:**
    *   `200 OK`: Returns a JSON object with `success: true`, user's session data, pagination details, and applied filters.
    *   `400 Bad Request`: If `userId` is invalid, date format is invalid.
    *   `500 Internal Server Error`: If there is an error fetching user sessions.

## Questions API (`controllers/questions.controller.js`)

### 1. Get All Questions
*   **Endpoint:** `GET /questions`
*   **Description:** Retrieves a paginated list of all questions. Supports searching (question text, answer text, user ID, channel) and filtering by date range.
*   **Query Parameters:**
    *   `page` (optional, number): The page number for pagination (default: 1).
    *   `limit` (optional, number): The number of items per page (default: 10, max: 100).
    *   `search` (optional, string): A search term.
    *   `startDate` (optional, string): The start date for filtering (ISO date string YYYY-MM-DD or Unix timestamp in milliseconds).
    *   `endDate` (optional, string): The end date for filtering (ISO date string YYYY-MM-DD or Unix timestamp in milliseconds).
*   **Responses:**
    *   `200 OK`: Returns a JSON object with `success: true`, question data, pagination details, and applied filters.
    *   `400 Bad Request`: If search term is too long, date format is invalid, or start date is after end date.
    *   `500 Internal Server Error`: If there is an error fetching questions.

### 2. Get Questions by User ID
*   **Endpoint:** `GET /questions/user/:userId`
*   **Description:** Retrieves a paginated list of questions for a specific user ID. Supports date filtering.
*   **Path Parameters:**
    *   `userId` (required, string): The ID of the user.
*   **Query Parameters:**
    *   `page` (optional, number): The page number for pagination (default: 1).
    *   `limit` (optional, number): The number of items per page (default: 10, max: 100).
    *   `startDate` (optional, string): The start date for filtering (ISO date string YYYY-MM-DD or Unix timestamp in milliseconds).
    *   `endDate` (optional, string): The end date for filtering (ISO date string YYYY-MM-DD or Unix timestamp in milliseconds).
*   **Responses:**
    *   `200 OK`: Returns a JSON object with `success: true`, user's question data, pagination details, and applied filters.
    *   `400 Bad Request`: If `userId` is invalid, date format is invalid.
    *   `500 Internal Server Error`: If there is an error fetching user questions.

## Users API (`controllers/user.controller.js`)

### 1. Get All Users
*   **Endpoint:** `GET /users`
*   **Description:** Retrieves a paginated list of all users with their statistics. Supports searching by user ID and filtering by date range.
*   **Query Parameters:**
    *   `page` (optional, number): The page number for pagination (default: 1).
    *   `limit` (optional, number): The number of items per page (default: 10, max: 100).
    *   `search` (optional, string): A search term to filter users by user ID.
    *   `startDate` (optional, string): The start date for filtering user activity (ISO date string YYYY-MM-DD or Unix timestamp in milliseconds).
    *   `endDate` (optional, string): The end date for filtering user activity (ISO date string YYYY-MM-DD or Unix timestamp in milliseconds).
*   **Responses:**
    *   `200 OK`: Returns a JSON object with `success: true`, user data, pagination details, and applied filters.
    *   `400 Bad Request`: If search term is too long, date format is invalid, or start date is after end date.
    *   `500 Internal Server Error`: If there is an error fetching users.

### 2. Get User by Username
*   **Endpoint:** `GET /users/:username`
*   **Description:** Retrieves detailed information and statistics for a specific user by their username. Supports date filtering for user activity.
*   **Path Parameters:**
    *   `username` (required, string): The username of the user.
*   **Query Parameters:**
    *   `startDate` (optional, string): The start date for filtering user activity (ISO date string YYYY-MM-DD or Unix timestamp in milliseconds).
    *   `endDate` (optional, string): The end date for filtering user activity (ISO date string YYYY-MM-DD or Unix timestamp in milliseconds).
*   **Responses:**
    *   `200 OK`: Returns a JSON object with `success: true`, detailed user data, and applied filters.
    *   `400 Bad Request`: If `username` is invalid, date format is invalid.
    *   `404 Not Found`: If no user is found for the given username and date range.
    *   `500 Internal Server Error`: If there is an error fetching user data.

### 3. Get User Statistics
*   **Endpoint:** `GET /users/stats`
*   **Description:** Retrieves overall user statistics and activity summary. Supports date filtering.
*   **Query Parameters:**
    *   `startDate` (optional, string): The start date for filtering statistics (ISO date string YYYY-MM-DD or Unix timestamp in milliseconds).
    *   `endDate` (optional, string): The end date for filtering statistics (ISO date string YYYY-MM-DD or Unix timestamp in milliseconds).
*   **Responses:**
    *   `200 OK`: Returns a JSON object with `success: true`, overall user statistics, daily activity, and applied filters.
    *   `400 Bad Request`: If date format is invalid.
    *   `500 Internal Server Error`: If there is an error fetching user statistics.

# Continuous Evaluation API

Evaluation read endpoints use the same bearer-token/Keycloak authentication as the rest of the dashboard API. Langfuse credentials are server-side only.

## Dashboard endpoints

- `GET /v1/evaluations/runs` — list recent evaluation runs.
- `GET /v1/evaluations/runs/{runId}/summary` — return four dimension averages, the overall score, pass/failure counts, and all 18 metric averages.
- `GET /v1/evaluations/runs/{runId}/items` — page and filter evaluated conversations.
- `GET /v1/evaluations/runs/{runId}/items/{itemId}` — return the question, answer, evidence, 18 scores, and evaluator comments.
- `POST /v1/evaluations/runs/{runId}/sync` — refresh the normalized dashboard cache from run-scoped Langfuse scores.

The following endpoints require a valid Keycloak token whose realm roles include `super-admin`:

- `GET /v1/evaluations/judge-models` — list the judge models configured by the evaluation worker.
- `GET|POST /v1/evaluations/judge-endpoints` — list or create encrypted OpenAI, Cerebras, vLLM, or other OpenAI-compatible judge connections.
- `PATCH|DELETE /v1/evaluations/judge-endpoints/{endpointId}` — edit, enable, or disable a connection.
- `POST /v1/evaluations/judge-endpoints/{endpointId}/test` — call the provider's `/models` endpoint without running an evaluation.
- `GET|POST /v1/evaluations/schedules` — list or create daily IST schedules.
- `PATCH|DELETE /v1/evaluations/schedules/{scheduleId}` — change, pause, or remove a schedule.
- `POST /v1/evaluations/runs` — create and start an asynchronous evaluation run. Body: `{ "judge_endpoint_id": "uuid", "population_limit": 1000, "sampling_mode": "percent", "sampling_value": 10 }`. Use `sampling_mode: "count"` for a fixed number of traces.
- `POST /v1/evaluations/runs/{runId}/sync` — manually recover dashboard data from scores already present in Langfuse.

`POST /v1/evaluations/runs` returns `202 Accepted` with the generated run ID. The run is persisted before the worker is called, so it is immediately queryable through the run list and summary endpoints.

Provider API keys are encrypted with AES-256-GCM using `EVALUATION_CREDENTIALS_KEY`; API responses expose only `has_api_key`. Optionally restrict configurable destinations with `EVALUATION_JUDGE_ALLOWED_HOSTS`.

## Evaluation-worker endpoints

These endpoints require `x-evaluation-service-key`.

- `PUT /v1/internal/evaluations/runs/{runId}` — create or update run metadata.
- `PUT /v1/internal/evaluations/runs/{runId}/manifest` — register the immutable selected trace manifest.
- `GET /v1/internal/evaluations/runs/{runId}/manifest` — return run metadata and selected traces for `LLM_eval`.
- `POST /v1/internal/evaluations/runs/{runId}/sync` — synchronize Langfuse scores after a scorer run.
- `GET /v1/internal/evaluations/feedback-candidates` — obtain feedback-bearing questions for the selection window.
- `PUT /v1/internal/evaluations/runs/{runId}/items/{traceId}` — publish one normalized evaluated conversation immediately after its Langfuse scores are written.
- `PATCH /v1/internal/evaluations/runs/{runId}/traces/{traceId}` — record a per-trace scoring failure and refresh run progress.

Manifest request example:

```json
{
  "traces": [
    {
      "trace_id": "langfuse-trace-id",
      "selection_source": "feedback",
      "feedback_types": ["dislike"],
      "feedback_count": 1,
      "feedback_comment_present": true
    }
  ]
}
```
