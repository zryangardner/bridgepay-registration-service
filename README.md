# BridgePay Registration Service

> JWT authentication and user registration service built on TypeScript, Node.js, and Express.

A portfolio project providing secure authentication for the BridgePay platform — handling user registration, login, and session management via JWT access and refresh token rotation. Built to demonstrate backend engineering skills in TypeScript, Node.js, secure auth patterns, and AWS cloud infrastructure.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Runtime | Node.js |
| Framework | Express |
| Database (local) | PostgreSQL — Docker |
| Database (production) | PostgreSQL — AWS RDS |
| Auth | JWT (access + refresh token rotation) |
| Password Hashing | bcryptjs |
| Cloud | AWS — ECS Fargate, RDS, ECR, ALB |
| Containerization | Docker |
| Build | tsc |

---

## Architecture

```
HTTP Request
     │
     ▼
Auth Router                (/api/auth)
     │
     ▼
Auth Controller            (Business logic — registration, login, token rotation)
     │
     ├──▶ pg Pool              (PostgreSQL — users, refresh_tokens tables)
     │
     └──▶ JWT Utilities        (Access token: 15m · Refresh token: 7d, HttpOnly cookie)
               │
               ▼
          Token Rotation       (Old refresh token revoked on every use)
```

---

## Auth Flow

```
POST /api/auth/register
     │
     ▼
Hash password (bcryptjs) → Insert user → Issue access token + refresh token
     │                                          │
     ▼                                          ▼
201 Created + accessToken              HttpOnly cookie (refreshToken)

POST /api/auth/login
     │
     ▼
Verify password → Issue access token + refresh token
     │                      │
     ▼                      ▼
200 OK + accessToken   HttpOnly cookie (refreshToken)

POST /api/auth/refresh
     │
     ▼
Validate refresh token → Revoke old token → Issue new access + refresh tokens
     │                                              │
     ▼                                              ▼
200 OK + new accessToken                  HttpOnly cookie (new refreshToken)

POST /api/auth/logout
     │
     ▼
Delete refresh token from DB → Clear cookie → 200 OK
```

---

## AWS Infrastructure

| Component | Service | Details |
|---|---|---|
| Container Registry | Amazon ECR | Stores Docker image |
| Container Host | Amazon ECS Fargate | Runs containerized Node.js app |
| Database | Amazon RDS PostgreSQL | Production persistence |
| Load Balancer | Application Load Balancer | Public-facing HTTP endpoint |

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register a new user |
| `POST` | `/api/auth/login` | Login and receive tokens |
| `POST` | `/api/auth/refresh` | Rotate refresh token, receive new access token |
| `POST` | `/api/auth/logout` | Revoke refresh token and clear cookie |

### Register — Example Request
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@bridgepay.com", "password": "SecurePassword123"}'
```

### Example Response
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "03f022be-18a1-4292-80e5-e3da5799fc60",
    "email": "user@bridgepay.com",
    "created_at": "2026-03-20T23:22:26.235Z"
  }
}
```

### Login — Example Request
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"email": "user@bridgepay.com", "password": "SecurePassword123"}'
```

### Refresh — Example Request
```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -b cookies.txt \
  -c cookies.txt
```

### Logout — Example Request
```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -b cookies.txt
```

---

## Security Design

| Concern | Implementation |
|---|---|
| Password storage | bcryptjs hashing — plaintext never persisted |
| Access token lifetime | 15 minutes — short window limits exposure |
| Refresh token storage | HttpOnly cookie — inaccessible to JavaScript |
| Refresh token rotation | Old token revoked on every use — stolen tokens invalidated after one use |
| Refresh token revocation | Stored in DB — can be invalidated server-side at any time |
| JWT secrets | Environment variables — never hardcoded or committed |

---

## Project Structure

```
src/
├── controllers/
│   └── authController.ts    # register, login, refresh, logout — bcrypt, JWT, token rotation
├── db/
│   ├── pool.ts              # pg.Pool singleton using DATABASE_URL
│   └── migrate.ts           # CREATE TABLE IF NOT EXISTS — users, refresh_tokens
├── middleware/
│   └── authenticateToken.ts # Bearer token verification — attaches req.user
├── models/
│   └── user.ts              # User, RegisterRequest, LoginRequest, AuthTokenPayload interfaces
├── routes/
│   └── auth.ts              # POST /register, /login, /refresh, /logout
└── index.ts                 # Express app entry point — mounts /api/auth router
```

---

## Running Locally

### Prerequisites

- Node.js 20+
- Docker (for local PostgreSQL)

### 1. Start local PostgreSQL

```bash
docker run --name bridgepay-registration-db \
  -e POSTGRES_USER=bridgepay_admin \
  -e POSTGRES_PASSWORD=localpassword \
  -e POSTGRES_DB=bridgepay_registration \
  -p 5432:5432 \
  -d postgres:16
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Local Value |
|---|---|
| `DATABASE_URL` | `postgresql://bridgepay_admin:localpassword@localhost:5432/bridgepay_registration` |
| `JWT_ACCESS_SECRET` | Any long random string |
| `JWT_REFRESH_SECRET` | Different long random string |
| `ACCESS_TOKEN_EXPIRY` | `15m` |
| `REFRESH_TOKEN_EXPIRY` | `7d` |
| `PORT` | `3000` |
| `NODE_ENV` | `development` |

Generate JWT secrets:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. Run database migration

```bash
npm run migrate
```

### 4. Start the dev server

```bash
npm run dev
```

The app starts on `http://localhost:3000`.

---

## Running Tests

```bash
npm test
```

---

## Docker

### Build the image
```bash
docker build -t bridgepay-registration-service .
```

### Run the container
```bash
docker run -p 3000:3000 \
  -e DATABASE_URL=<your-rds-url> \
  -e JWT_ACCESS_SECRET=<secret> \
  -e JWT_REFRESH_SECRET=<secret> \
  -e ACCESS_TOKEN_EXPIRY=15m \
  -e REFRESH_TOKEN_EXPIRY=7d \
  -e NODE_ENV=production \
  bridgepay-registration-service
```

---

## Roadmap

### Completed
- [x] User registration with bcryptjs password hashing
- [x] Login with JWT access token issuance
- [x] Refresh token rotation — HttpOnly cookie, DB-backed revocation
- [x] Logout with server-side token invalidation
- [x] PostgreSQL schema — users and refresh_tokens tables
- [x] JWT middleware for protecting downstream routes

### Planned
- [ ] Dockerfile and containerization
- [ ] GitHub Actions CI/CD pipeline — build, test, push to ECR
- [ ] Deploy to AWS ECS Fargate with Application Load Balancer (via Terraform)
- [ ] Integration with payment-processor — JWT validation on payment endpoints
- [ ] Integration tests

---

## Related Projects

| Repo | Stack | Description |
|---|---|---|
| `bridgepay-payment-processor` | Java 21 / Spring Boot / AWS SQS | Core payment lifecycle API |
| `bridgepay-notification-service` | Kotlin / Spring Boot / AWS SQS | Lifecycle notification dispatcher |
| `bridgepay-dashboard` | React | Frontend — payment status, transaction history, onboarding |

---

## Author

Zachary Gardner — [LinkedIn](https://linkedin.com/in/zryangardner) · [GitHub](https://github.com/zryangardner)