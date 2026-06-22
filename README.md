# JWT Auth Demo

A learning project that combines Express, MySQL, Redis, JWT access tokens, HttpOnly refresh-token cookies, login verification challenges, and protected post routes.

The app runs as two servers:

- `server.js` on port `3000`: browser UI and protected post API
- `authServer.js` on port `4000`: registration, login, verification, token refresh, and logout

## Features

- Register with a unique username, unique email, and bcrypt-hashed password
- Log in with either username or email
- Complete a six-digit verification challenge before receiving tokens
- Store verification challenges and cooldown state in Redis
- Limit failed verification attempts and apply a five-minute cooldown
- Use short-lived JWT access tokens for protected post routes
- Store refresh-token sessions in Redis by a SHA-256 token hash
- Deliver refresh tokens in HttpOnly cookies instead of exposing them to browser JavaScript
- Restore the shared browser login state in newly opened tabs
- Revoke the current refresh session on logout
- Store users and posts in MySQL
- Create, list, and delete posts owned by the authenticated user

## Project Structure

```text
.
|-- authServer.js       # Authentication routes and refresh sessions
|-- server.js           # Protected post routes and static UI hosting
|-- db.js               # MySQL connection pool
|-- redisClient.js      # Redis connection
|-- public/
|   |-- index.html      # Browser test UI
|   |-- app.js
|   `-- styles.css
|-- requests.rest       # VS Code REST Client examples
|-- .env.example
|-- package.json
`-- package-lock.json
```

## Install

```bash
npm install
```

## Environment Variables

Copy `.env.example` to `.env` and fill in the secrets and database credentials:

```env
ACCESS_TOKEN_SECRET=replace_with_access_token_secret
REFRESH_TOKEN_SECRET=replace_with_refresh_token_secret
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=jwt_auth_demo
REDIS_URL=redis://localhost:6380
```

Generate JWT secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Do not commit `.env`. It is ignored by Git.

## Redis Setup

The Docker Redis container uses host port `6380` so it does not conflict with another local Redis installation:

```bash
docker run --name jwt-auth-redis -p 6380:6379 -d redis:7
```

If the container already exists:

```bash
docker start jwt-auth-redis
```

Verify it:

```bash
docker exec jwt-auth-redis redis-cli ping
```

Expected output:

```text
PONG
```

Redis uses key prefixes to separate data types:

```text
login_challenge:<challengeId>
login_cooldown:<userId>
refresh_token:<sha256(refreshToken)>
```

Challenge values contain the user id, username, hashed verification code, failure count, and creation time. Refresh-session values contain user metadata; the raw refresh token is not stored in Redis.

Inspect refresh sessions with:

```powershell
docker exec jwt-auth-redis redis-cli --scan --pattern "refresh_token:*"
```

## MySQL Setup

Create the database and tables:

```sql
CREATE DATABASE IF NOT EXISTS jwt_auth_demo;
USE jwt_auth_demo;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Posts reference the stable numeric user id, so they remain attached to the same user if a username or email changes.

## Run

Start Redis and MySQL first. Then start the resource server:

```bash
npm run devStart
```

Start the authentication server in a second terminal:

```bash
npm run devStartAuth
```

Open the browser UI at:

```text
http://localhost:3000
```

The auth server must be available at `http://localhost:4000`.

## Authentication Flow

1. `POST /login` validates the identifier and password and creates a Redis challenge.
2. The local verification code is printed in the auth-server terminal.
3. `POST /login/verify` validates the code and returns an access token.
4. The same response sets the refresh token as an HttpOnly cookie.
5. The browser sends that cookie automatically to `POST /token` and `DELETE /logout`.
6. `POST /token` checks the Redis refresh-session key before issuing a new access token.
7. `DELETE /logout` deletes that Redis key and clears the cookie.

Access tokens are kept in per-tab `sessionStorage` and sent in the `Authorization` header. Refresh tokens cannot be read by application JavaScript.

The refresh cookie is shared by tabs on the same browser profile. A newly opened tab silently calls `/token` and restores the existing browser session. Use another browser profile or an incognito window to test two accounts at the same time.

## API Summary

### Register

```http
POST http://localhost:4000/register
Content-Type: application/json

{
  "username": "Alice",
  "email": "alice@example.com",
  "password": "password123"
}
```

### Start Login

```http
POST http://localhost:4000/login
Content-Type: application/json

{
  "identifier": "Barry",
  "password": "password123"
}
```

The response contains a `challengeId`. The identifier may be a username or email.

### Verify Login

```http
POST http://localhost:4000/login/verify
Content-Type: application/json

{
  "challengeId": "<challengeId>",
  "verificationCode": "123456"
}
```

The JSON response contains only the access token:

```json
{
  "accessToken": "..."
}
```

The refresh token is delivered separately through a `Set-Cookie` response header with `HttpOnly` enabled.

### Refresh Access Token

```http
POST http://localhost:4000/token
```

The request has no token body. The client must include the refresh cookie.

### Logout

```http
DELETE http://localhost:4000/logout
```

Logout revokes the current Redis refresh session and clears the refresh cookie. Already-issued access tokens remain valid until their 20-minute expiration.

### Protected Posts

```http
GET http://localhost:3000/posts
Authorization: Bearer <accessToken>
```

```http
POST http://localhost:3000/posts
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "title": "My Post from MySQL"
}
```

```http
DELETE http://localhost:3000/posts/<postId>
Authorization: Bearer <accessToken>
```

The server derives `user_id` from the verified access token. Delete queries match both the post id and authenticated user id.

## Testing with requests.rest

The VS Code REST Client keeps cookies returned by the auth server in its cookie jar. Run requests in this order:

1. Start login.
2. Copy the returned challenge id into `@challengeId`.
3. Copy the terminal verification code into `@verificationCode`.
4. Verify login; REST Client stores the refresh cookie.
5. Copy the returned access token into `@accessToken`.
6. Test the protected post routes.
7. Run `POST /token` without a body.
8. Run `DELETE /logout` without a body.
9. Run `POST /token` again and expect `401 Unauthorized` because the cookie was cleared.

Keep only placeholders in `requests.rest`; do not commit real access tokens or verification codes.

## Security Notes

- Passwords are stored as bcrypt hashes.
- Verification codes are stored as SHA-256 hashes and expire automatically.
- Refresh tokens include a unique JWT ID (`jti`) so simultaneous logins create separate sessions.
- Redis keys contain only a SHA-256 hash of each refresh token.
- Refresh JWTs, Redis session keys, and cookies all expire after seven days.
- The local cookie uses `secure: false` because development runs over HTTP. Production cookies must use HTTPS and `secure: true`.
- The verification code is printed to the terminal only for local development.
- This project demonstrates authentication concepts and is not production-ready.
