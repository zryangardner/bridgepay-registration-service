# BridgePay Registration Service

> Authentication, user profiles, and social graph for the BridgePay platform.

A portfolio project handling user registration, JWT authentication, friend relationships, and account balances for the BridgePay suite. Built to demonstrate backend engineering in TypeScript, Node.js, Express, and PostgreSQL — with planned SQS integration for event-driven balance transfers.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Runtime | Node.js 20 |
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

This service is the identity and social layer of the BridgePay suite. It issues JWTs that are validated by `bridgepay-payment-processor` on every payment request. Planned: consumes `PaymentCreatedEvent` from SQS to perform atomic balance transfers, then publishes `PaymentProcessedEvent` or `PaymentFailedEvent` back to the payment processor.

```
HTTP Request
     │
     ▼
Auth / Users / Friends Router
     │
     ▼
Controllers         (auth, users, friends)
     │
     ├──▶ pg Pool       (PostgreSQL — users, refresh_tokens, friendships)
     │
     └──▶ JWT Utilities (Access: 15m · Refresh: 7d, HttpOnly cookie, DB-backed rotation)

[Planned]
SQS Consumer ──▶ Balance Transfer Logic ──▶ SQS Publisher
(PaymentCreatedEvent)                    (PaymentProcessedEvent / PaymentFailedEvent)
```

---

## API Endpoints

### Auth
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | None | Register — email, password, username, full_name (optional), avatar_color (optional) |
| `POST` | `/api/auth/login` | None | Login — returns accessToken + full user profile |
| `POST` | `/api/auth/refresh` | Cookie | Rotate refresh token, receive new access token |
| `POST` | `/api/auth/logout` | Bearer | Revoke refresh token and clear cookie |

### Users
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/users/me` | Bearer | Get current user profile |
| `PATCH` | `/api/users/me` | Bearer | Update username, full_name, avatar_color |
| `GET` | `/api/users/search?q=` | Bearer | Search users by username or full name (excludes self) |

### Friends
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/friends/request` | Bearer | Send friend request by username |
| `GET` | `/api/friends` | Bearer | Get accepted friends list |
| `GET` | `/api/friends/requests` | Bearer | Get incoming pending requests |
| `PATCH` | `/api/friends/request/:id` | Bearer | Accept or decline a request |
| `DELETE` | `/api/friends/:id` | Bearer | Unfriend by user ID |

---

## Database Schema

```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  username        TEXT UNIQUE NOT NULL,
  full_name       TEXT,
  password_hash   TEXT NOT NULL,
  avatar_color    TEXT NOT NULL DEFAULT 'ocean',
  account_balance DECIMAL(12,2) NOT NULL DEFAULT 1000.00,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE friendships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);
```

---

## Security Design

| Concern | Implementation |
|---|---|
| Password storage | bcryptjs — plaintext never persisted |
| Access token lifetime | 15 minutes — short window limits exposure |
| Refresh token storage | HttpOnly cookie — inaccessible to JavaScript |
| Refresh token rotation | Old token revoked on every use |
| Refresh token revocation | DB-backed — invalidatable server-side at any time |
| JWT secrets | Environment variables — never hardcoded |

---

## Running Locally

### Prerequisites
- Docker Desktop

### Start all services
```bash
docker-compose up --build
```

The registration service retries the DB connection up to 10 times with a 3-second delay — handles postgres startup lag automatically.

### Environment variables (docker-compose sets these automatically)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Access token signing secret |
| `JWT_REFRESH_SECRET` | Refresh token signing secret |
| `ACCESS_TOKEN_EXPIRY` | Access token lifetime (default: `15m`) |
| `REFRESH_TOKEN_EXPIRY` | Refresh token lifetime (default: `7d`) |
| `PORT` | Service port (default: `3000`) |
| `NODE_ENV` | Environment (`development` / `production`) |
| `CORS_ORIGIN` | Allowed origin (default: `http://localhost:5173`) |

---

## Project Structure

```
src/
├── controllers/
│   ├── authController.ts      # register, login, refresh, logout
│   └── friendsController.ts   # friend requests, search, unfriend
├── db/
│   ├── pool.ts                # pg.Pool singleton
│   └── migrate.ts             # Schema migration — runs on startup
├── middleware/
│   └── authenticateToken.ts   # Bearer token verification
├── models/
│   └── user.ts                # User, Friendship, PublicUser interfaces
├── routes/
│   ├── auth.ts                # /api/auth
│   ├── users.ts               # /api/users
│   └── friends.ts             # /api/friends
└── index.ts                   # Express app — startup with DB retry loop
```

---

## Roadmap

### Completed
- [x] Auth endpoints — register, login, refresh token rotation, logout
- [x] User profiles — username, full name, avatar color, account balance
- [x] Friends system — request, accept, decline, unfriend, search
- [x] JWT authentication middleware
- [x] Refresh token rotation and revocation
- [x] Docker + docker-compose local dev setup
- [x] DB retry loop for container startup sequencing

### Planned
- [ ] SQS consumer for `PaymentCreatedEvent` — friendship validation + atomic balance transfer
- [ ] SQS publisher for `PaymentProcessedEvent` / `PaymentFailedEvent`
- [ ] GitHub Actions CI/CD pipeline
- [ ] Deploy to AWS ECS Fargate via Terraform
- [ ] K6 load tests

---

## Related Projects

| Repo | Stack | Description |
|---|---|---|
| `bridgepay-payment-processor` | Java 21 / Spring Boot / AWS SQS / PostgreSQL | Core payment lifecycle API |
| `bridgepay-notification-service` | Kotlin / Spring Boot / AWS SQS | Lifecycle notification dispatcher |
| `bridgepay-dashboard` | React / Vite / TypeScript | Frontend — social feed, payments, friends, account |
| `bridgepay-terraform` | Terraform | AWS infrastructure for all services |

---

## Author

Zachary Gardner — [LinkedIn](https://linkedin.com/in/zryangardner) · [GitHub](https://github.com/zryangardner)