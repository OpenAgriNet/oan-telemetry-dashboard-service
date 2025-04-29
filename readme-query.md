# Telemetry Query Service

A NodeJS microservice that provides a REST API to query processed telemetry data from the database, secured with Keycloak authentication.

## Features

- RESTful API for querying telemetry data
- Endpoints for users, sessions, questions, feedback, and metrics
- Pagination support for large datasets
- Filtering and reporting capabilities
- **Keycloak token verification** for secure authentication
- Role-based access control
- Comprehensive error handling
- Cross-Origin Resource Sharing (CORS) support
- Security best practices with Helmet middleware

## API Endpoints

### Users
- `GET /api/users` - Retrieve all users (paginated)
  - Query params: page, pageSize

### Sessions
- `GET /api/sessions` - Retrieve all sessions (paginated)
  - Query params: page, pageSize
- `GET /api/sessions/report` - Generate a sessions report with optional filters (paginated)
  - Query params: page, pageSize, userId, startDate, endDate
- `GET /api/sessions/{sessionId}/events` - Retrieve all events for a specific session

### Questions
- `GET /api/questions` - Retrieve all questions (paginated)
  - Query params: page, pageSize
- `GET /api/questions/report` - Generate a questions report with optional filters (paginated)
  - Query params: page, pageSize, userId, sessionId, startDate, endDate, searchText

### Metrics
- `GET /api/metrics/daily` - Retrieve daily metrics

### Feedback
- `GET /api/feedback` - Retrieve all feedback entries (paginated)
  - Query params: page, pageSize
- `GET /api/feedback/{feedbackId}` - Retrieve specific feedback by ID

### Health Check
- `GET /health` - Service health check endpoint (non-authenticated)

## Prerequisites

- Node.js (v14+)
- PostgreSQL database (with telemetry data processed by the telemetry processor service)
- Keycloak server (for authentication)

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/telemetry-query-service.git
   cd telemetry-query-service
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file from the example:
   ```
   cp .env.example .env
   ```

4. Update the `.env` file with your database credentials, Keycloak settings, and other configuration options.

## Configuration

Edit the `.env` file to configure the service:

```
# Server Configuration
PORT=4000                # Service port
LOG_LEVEL=info           # Logging level
NODE_ENV=production      # Environment (production/development)

# Database Configuration
DB_USER=postgres         # Database user
DB_PASSWORD=postgres     # Database password
DB_HOST=localhost        # Database host
DB_PORT=5432             # Database port
DB_NAME=telemetry        # Database name

# CORS Configuration (comma-separated list of allowed origins)
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com

# Keycloak Authentication Configuration
AUTH_ENABLED=true                          # Enable/disable authentication
KEYCLOAK_JWKS_URI=http://localhost:8080/auth/realms/master/protocol/openid-connect/certs
KEYCLOAK_ISSUER=http://localhost:8080/auth/realms/master
KEYCLOAK_CLIENT_ID=telemetry-client       # Client ID registered in Keycloak
REQUIRED_ROLE=telemetry-user              # Role required for access (optional)
REQUIRED_SCOPE=telemetry-api              # Scope required for access (optional)
```

## Authentication

The service uses Keycloak for authentication and authorization:

- All API endpoints under `/api/*` require a valid Keycloak JWT token
- The token must be provided in the `Authorization` header as `Bearer <token>`
- The service verifies the token signature using Keycloak's public key (JWKS)
- Optional role and scope requirements can be configured

For detailed authentication setup and configuration, see [Authentication.md](Authentication.md).

## Running the Service

### Development Mode

```
npm run dev
```

### Production Mode

```
npm start
```

### Using Docker

Build and run with Docker Compose:
```
docker-compose up -d
```

## API Usage Examples

### Retrieving Users

```bash
# Get all users (first page, 10 items per page)
curl -X GET "http://localhost:4000/api/users" \
  -H "Authorization: Bearer <your_token_here>"
```

Example response:
```json
{
  "data": [
    {
      "id": "user@example.com",
      "lastActivity": "2023-10-15T14:30:45.123Z",
      "sessionCount": 5,
      "questionCount": 42,
      "feedbackCount": 3
    },
    ...
  ],
  "pagination": {
    "total": 126,
    "page": 1,
    "pageSize": 10,
    "totalPages": 13
  }
}
```

### Generating a Sessions Report

```bash
# Generate a sessions report for a specific user in a date range
curl -X GET "http://localhost:4000/api/sessions/report?userId=user@example.com&startDate=2023-10-01&endDate=2023-10-31&page=1&pageSize=20" \
  -H "Authorization: Bearer <your_token_here>"
```

Example response:
```json
{
  "data": [
    {
      "sessionId": "5b313508-b857-4f01-816d-f7c26be444c3",
      "userId": "user@example.com",
      "startTime": "2023-10-15T14:30:45.123Z",
      "endTime": "2023-10-15T15:45:12.456Z",
      "durationMinutes": 74.5,
      "questionsCount": 12,
      "feedbackCount": 1,
      "avgAnswerLength": 245.3
    },
    ...
  ],
  "filters": {
    "userId": "user@example.com",
    "startDate": "2023-10-01",
    "endDate": "2023-10-31"
  },
  "pagination": {
    "total": 5,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  }
}
```

### Retrieving Session Events

```bash
# Get all events for a specific session
curl -X GET "http://localhost:4000/api/sessions/5b313508-b857-4f01-816d-f7c26be444c3/events" \
  -H "Authorization: Bearer <your_token_here>"
```

Example response:
```json
{
  "sessionId": "5b313508-b857-4f01-816d-f7c26be444c3",
  "userId": "user@example.com",
  "startTime": "2023-10-15T14:30:45.123Z",
  "endTime": "2023-10-15T15:45:12.456Z",
  "durationSeconds": 4467,
  "eventCount": 13,
  "events": [
    {
      "event_type": "OE_ITEM_RESPONSE",
      "id": 1,
      "uid": "user@example.com",
      "sid": "5b313508-b857-4f01-816d-f7c26be444c3",
      "question_text": "What is PESA in Jharkhand?",
      "answer": "The Panchayats (Extension to Scheduled Areas) Act...",
      "created_at": "2023-10-15T14:30:45.123Z"
    },
    {
      "event_type": "Feedback",
      "id": 2,
      "uid": "user@example.com",
      "sid": "5b313508-b857-4f01-816d-f7c26be444c3",
      "feedback_type": "positive",
      "feedback_text": "Great answer!",
      "created_at": "2023-10-15T14:32:10.789Z"
    },
    ...
  ]
}
```

### Retrieving Questions Report

```bash
# Generate a questions report with search filter
curl -X GET "http://localhost:4000/api/questions/report?searchText=PESA&page=1&pageSize=10" \
  -H "Authorization: Bearer <your_token_here>"
```

Example response:
```json
{
  "data": [
    {
      "id": 1,
      "uid": "user@example.com",
      "sid": "5b313508-b857-4f01-816d-f7c26be444c3",
      "question_text": "What is PESA in Jharkhand?",
      "question_source": "USER",
      "answer": "The Panchayats (Extension to Scheduled Areas) Act...",
      "created_at": "2023-10-15T14:30:45.123Z",
      "has_answer": true,
      "answer_length": 245
    },
    ...
  ],
  "metrics": {
    "totalQuestions": 15,
    "answeredQuestions": 14,
    "answerRate": 93.33,
    "avgAnswerLength": 220,
    "firstQuestionTime": "2023-09-22T10:15:32.456Z",
    "lastQuestionTime": "2023-10-29T18:45:21.789Z",
    "uniqueUsers": 8,
    "uniqueSessions": 12
  },
  "filters": {
    "userId": null,
    "sessionId": null,
    "startDate": null,
    "endDate": null,
    "searchText": "PESA"
  },
  "pagination": {
    "total": 15,
    "page": 1,
    "pageSize": 10,
    "totalPages": 2
  }
}
```

### Retrieving Daily Metrics

```bash
# Get daily metrics for the last 30 days
curl -X GET "http://localhost:4000/api/metrics/daily" \
  -H "Authorization: Bearer <your_token_here>"
```

Example response:
```json
{
  "dailyMetrics": [
    {
      "date": "2023-10-01",
      "totalQuestions": 45,
      "uniqueQuestionUsers": 12,
      "uniqueQuestionSessions": 15,
      "answeredQuestions": 42,
      "avgAnswerLength": 180,
      "totalFeedback": 8,
      "uniqueFeedbackUsers": 5,
      "uniqueFeedbackSessions": 6,
      "positiveFeedback": 6,
      "negativeFeedback": 2,
      "dailyActiveUsers": 14,
      "dailySessions": 18
    },
    ...
  ],
  "aggregatedMetrics": {
    "totalDays": 30,
    "totalQuestions": 1245,
    "totalFeedback": 215,
    "totalAnsweredQuestions": 1180,
    "avgQuestionsPerDay": 41.5,
    "avgFeedbackPerDay": 7.2,
    "avgActiveUsersPerDay": 18.3,
    "avgSessionsPerDay": 22.5,
    "answerRate": 94.8
  },
  "period": {
    "startDate": "2023-10-01",
    "endDate": "2023-10-30",
    "days": 30
  }
}
```

## Project Structure

```
telemetry-query-service/
├── middleware/               # Express middleware
│   ├── auth.js               # Keycloak authentication middleware
│   └── validation.js         # Request validation middleware
├── routes/                   # API route handlers
│   ├── users.js              # Users endpoints
│   ├── sessions.js           # Sessions endpoints
│   ├── questions.js          # Questions endpoints
│   ├── metrics.js            # Metrics endpoints
│   └── feedback.js           # Feedback endpoints
├── .env.example              # Environment variables template
├── Authentication.md         # Authentication setup documentation
├── Dockerfile                # Docker configuration
├── docker-compose.yml        # Docker Compose configuration
├── index.js                  # Main application file
├── logger.js                 # Winston logger configuration
├── package.json              # Node.js dependencies and scripts
└── README.md                 # Documentation
```

## Error Handling

The service implements consistent error handling with appropriate HTTP status codes and structured error responses:

```json
{
  "error": {
    "message": "Invalid page parameter. Must be a positive integer.",
    "code": "INVALID_PAGINATION"
  }
}
```

Common error codes include:
- `INVALID_PAGINATION` - Invalid pagination parameters
- `INVALID_DATE_RANGE` - Invalid date range parameters
- `SESSION_NOT_FOUND` - Session not found
- `FEEDBACK_NOT_FOUND` - Feedback not found
- `INTERNAL_ERROR` - Internal server error

Authentication error codes:
- `NO_TOKEN` - Missing token
- `INVALID_TOKEN` - Invalid token
- `TOKEN_EXPIRED` - Expired token
- `INSUFFICIENT_ROLE` - Missing required role
- `INSUFFICIENT_SCOPE` - Missing required scope

## Security Considerations

The service implements several security best practices:
- Keycloak token verification for authentication
- Role-based access control
- CORS protection with configurable allowed origins
- Helmet middleware for securing HTTP headers
- Input validation to prevent injection attacks
- Parameterized queries to prevent SQL injection
- Environment variables for sensitive configuration

## Logging

Logs are written to:
- Console (with colorization in development)
- `error.log` (errors only)
- `combined.log` (all logs)

## License

MIT# Telemetry Query Service

A NodeJS microservice that provides a REST API to query processed telemetry data from the database.

## Features

- RESTful API for querying telemetry data
- Endpoints for users, sessions, questions, feedback, and metrics
- Pagination support for large datasets
- Filtering and reporting capabilities
- Comprehensive error handling
- Cross-Origin Resource Sharing (CORS) support
- Security best practices with Helmet middleware

## API Endpoints

### Users
- `GET /api/users` - Retrieve all users (paginated)
  - Query params: page, pageSize

### Sessions
- `GET /api/sessions` - Retrieve all sessions (paginated)
  - Query params: page, pageSize
- `GET /api/sessions/report` - Generate a sessions report with optional filters (paginated)
  - Query params: page, pageSize, userId, startDate, endDate
- `GET /api/sessions/{sessionId}/events` - Retrieve all events for a specific session

### Questions
- `GET /api/questions` - Retrieve all questions (paginated)
  - Query params: page, pageSize
- `GET /api/questions/report` - Generate a questions report with optional filters (paginated)
  - Query params: page, pageSize, userId, sessionId, startDate, endDate, searchText

### Metrics
- `GET /api/metrics/daily` - Retrieve daily metrics

### Feedback
- `GET /api/feedback` - Retrieve all feedback entries (paginated)
  - Query params: page, pageSize
- `GET /api/feedback/{feedbackId}` - Retrieve specific feedback by ID

### Health Check
- `GET /health` - Service health check endpoint

## Prerequisites

- Node.js (v14+)
- PostgreSQL database (with telemetry data processed by the telemetry processor service)

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/telemetry-query-service.git
   cd telemetry-query-service
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file from the example:
   ```
   cp .env.example .env
   ```

4. Update the `.env` file with your database credentials and other configuration options.

## Configuration

Edit the `.env` file to configure the service:

```
# Server Configuration
PORT=4000                # Service port
LOG_LEVEL=info           # Logging level
NODE_ENV=production      # Environment (production/development)

# Database Configuration
DB_USER=postgres         # Database user
DB_PASSWORD=postgres     # Database password
DB_HOST=localhost        # Database host
DB_PORT=5432             # Database port
DB_NAME=telemetry        # Database name

# CORS Configuration (comma-separated list of allowed origins)
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
```

## Running the Service

### Development Mode

```
npm run dev
```

### Production Mode

```
npm start
```

### Using Docker

Build and run with Docker Compose:
```
docker-compose up -d
```

## API Usage Examples

### Retrieving Users

```bash
# Get all users (first page, 10 items per page)
curl -X GET "http://localhost:4000/api/users?page=1&pageSize=10"
```

Example response:
```json
{
  "data": [
    {
      "id": "user@example.com",
      "lastActivity": "2023-10-15T14:30:45.123Z",
      "sessionCount": 5,
      "questionCount": 42,
      "feedbackCount": 3
    },
    ...
  ],
  "pagination": {
    "total": 126,
    "page": 1,
    "pageSize": 10,
    "totalPages": 13
  }
}
```

### Generating a Sessions Report

```bash
# Generate a sessions report for a specific user in a date range
curl -X GET "http://localhost:4000/api/sessions/report?userId=user@example.com&startDate=2023-10-01&endDate=2023-10-31&page=1&pageSize=20"
```

Example response:
```json
{
  "data": [
    {
      "sessionId": "5b313508-b857-4f01-816d-f7c26be444c3",
      "userId": "user@example.com",
      "startTime": "2023-10-15T14:30:45.123Z",
      "endTime": "2023-10-15T15:45:12.456Z",
      "durationMinutes": 74.5,
      "questionsCount": 12,
      "feedbackCount": 1,
      "avgAnswerLength": 245.3
    },
    ...
  ],
  "filters": {
    "userId": "user@example.com",
    "startDate": "2023-10-01",
    "endDate": "2023-10-31"
  },
  "pagination": {
    "total": 5,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  }
}
```

### Retrieving Session Events

```bash
# Get all events for a specific session
curl -X GET "http://localhost:4000/api/sessions/5b313508-b857-4f01-816d-f7c26be444c3/events"
```

Example response:
```json
{
  "sessionId": "5b313508-b857-4f01-816d-f7c26be444c3",
  "userId": "user@example.com",
  "startTime": "2023-10-15T14:30:45.123Z",
  "endTime": "2023-10-15T15:45:12.456Z",
  "durationSeconds": 4467,
  "eventCount": 13,
  "events": [
    {
      "event_type": "OE_ITEM_RESPONSE",
      "id": 1,
      "uid": "user@example.com",
      "sid": "5b313508-b857-4f01-816d-f7c26be444c3",
      "question_text": "What is PESA in Jharkhand?",
      "answer": "The Panchayats (Extension to Scheduled Areas) Act...",
      "created_at": "2023-10-15T14:30:45.123Z"
    },
    {
      "event_type": "Feedback",
      "id": 2,
      "uid": "user@example.com",
      "sid": "5b313508-b857-4f01-816d-f7c26be444c3",
      "feedback_type": "positive",
      "feedback_text": "Great answer!",
      "created_at": "2023-10-15T14:32:10.789Z"
    },
    ...
  ]
}
```

### Retrieving Questions Report

```bash
# Generate a questions report with search filter
curl -X GET "http://localhost:4000/api/questions/report?searchText=PESA&page=1&pageSize=10"
```

Example response:
```json
{
  "data": [
    {
      "id": 1,
      "uid": "user@example.com",
      "sid": "5b313508-b857-4f01-816d-f7c26be444c3",
      "question_text": "What is PESA in Jharkhand?",
      "question_source": "USER",
      "answer": "The Panchayats (Extension to Scheduled Areas) Act...",
      "created_at": "2023-10-15T14:30:45.123Z",
      "has_answer": true,
      "answer_length": 245
    },
    ...
  ],
  "metrics": {
    "totalQuestions": 15,
    "answeredQuestions": 14,
    "answerRate": 93.33,
    "avgAnswerLength": 220,
    "firstQuestionTime": "2023-09-22T10:15:32.456Z",
    "lastQuestionTime": "2023-10-29T18:45:21.789Z",
    "uniqueUsers": 8,
    "uniqueSessions": 12
  },
  "filters": {
    "userId": null,
    "sessionId": null,
    "startDate": null,
    "endDate": null,
    "searchText": "PESA"
  },
  "pagination": {
    "total": 15,
    "page": 1,
    "pageSize": 10,
    "totalPages": 2
  }
}
```

### Retrieving Daily Metrics

```bash
# Get daily metrics for the last 30 days
curl -X GET "http://localhost:4000/api/metrics/daily"
```

Example response:
```json
{
  "dailyMetrics": [
    {
      "date": "2023-10-01",
      "totalQuestions": 45,
      "uniqueQuestionUsers": 12,
      "uniqueQuestionSessions": 15,
      "answeredQuestions": 42,
      "avgAnswerLength": 180,
      "totalFeedback": 8,
      "uniqueFeedbackUsers": 5,
      "uniqueFeedbackSessions": 6,
      "positiveFeedback": 6,
      "negativeFeedback": 2,
      "dailyActiveUsers": 14,
      "dailySessions": 18
    },
    ...
  ],
  "aggregatedMetrics": {
    "totalDays": 30,
    "totalQuestions": 1245,
    "totalFeedback": 215,
    "totalAnsweredQuestions": 1180,
    "avgQuestionsPerDay": 41.5,
    "avgFeedbackPerDay": 7.2,
    "avgActiveUsersPerDay": 18.3,
    "avgSessionsPerDay": 22.5,
    "answerRate": 94.8
  },
  "period": {
    "startDate": "2023-10-01",
    "endDate": "2023-10-30",
    "days": 30
  }
}
```

## Project Structure

```
telemetry-query-service/
├── middleware/               # Express middleware
│   └── validation.js         # Request validation middleware
├── routes/                   # API route handlers
│   ├── users.js              # Users endpoints
│   ├── sessions.js           # Sessions endpoints
│   ├── questions.js          # Questions endpoints
│   ├── metrics.js            # Metrics endpoints
│   └── feedback.js           # Feedback endpoints
├── .env.example              # Environment variables template
├── Dockerfile                # Docker configuration
├── docker-compose.yml        # Docker Compose configuration
├── index.js                  # Main application file
├── logger.js                 # Winston logger configuration
├── package.json              # Node.js dependencies and scripts
└── README.md                 # Documentation
```

## Error Handling

The service implements consistent error handling with appropriate HTTP status codes and structured error responses:

```json
{
  "error": {
    "message": "Invalid page parameter. Must be a positive integer.",
    "code": "INVALID_PAGINATION"
  }
}
```

Common error codes include:
- `INVALID_PAGINATION` - Invalid pagination parameters
- `INVALID_DATE_RANGE` - Invalid date range parameters
- `SESSION_NOT_FOUND` - Session not found
- `FEEDBACK_NOT_FOUND` - Feedback not found
- `INTERNAL_ERROR` - Internal server error

## Security Considerations

The service implements several security best practices:
- CORS protection with configurable allowed origins
- Helmet middleware for securing HTTP headers
- Input validation to prevent injection attacks
- Parameterized queries to prevent SQL injection
- Environment variables for sensitive configuration

## Logging

Logs are written to:
- Console (with colorization in development)
- `error.log` (errors only)
- `combined.log` (all logs)

## License

MIT