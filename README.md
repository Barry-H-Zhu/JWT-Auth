# JWT Auth Demo

A small Node.js and Express project for learning JWT authentication with MySQL, bcrypt password hashing, Redis-backed login verification challenges, refresh tokens, and protected post routes.

The app is split into two servers:

- `server.js`: resource server on port `3000`
- `authServer.js`: authentication server on port `4000`

The auth server registers users with username, email, and password, then starts a Redis-backed verification challenge when users log in with either username or email. The resource server reads, creates, and deletes posts in MySQL using the authenticated user's JWT payload.

## Features

- Register users with `username`, `email`, and `password`
- Log in with either username or email
- Require a verification code before issuing JWTs
- Store login challenges in Redis by `challengeId`
- Track verification failures and apply a 5-minute cooldown
- Store users and posts in MySQL
- Store password hashes with bcrypt
- Generate access tokens and refresh tokens
- Include `id` and `name` in JWT payloads
- Protect `GET /posts`, `POST /posts`, and `DELETE /posts/:id` with JWT middleware
- Create posts for the currently logged-in user
- Delete posts owned by the currently logged-in user
- Refresh expired access tokens with a refresh token
- Logout by invalidating the refresh token in memory
- Test APIs with `requests.rest`
- Test registration, login, post creation/deletion, refresh, and logout in a browser UI

## Project Structure

```text
.
|-- authServer.js       # Register, login, token refresh, logout
|-- server.js           # Protected post routes and static UI hosting
|-- db.js               # MySQL connection pool
|-- redisClient.js      # Redis client connection
|-- public/             # Browser auth test UI
|   |-- index.html
|   |-- app.js
|   `-- styles.css
|-- requests.rest       # REST Client request examples
|-- .env.example        # Example environment variables
|-- package.json
`-- package-lock.json
```

## Install

```bash
npm install
```

## Environment Variables

Copy `.env.example` to `.env`, then fill in your local values:

```env
ACCESS_TOKEN_SECRET=replace_with_access_token_secret
REFRESH_TOKEN_SECRET=replace_with_refresh_token_secret
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=jwt_auth_demo
REDIS_URL=redis://localhost:6379
```

Generate JWT secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Do not commit `.env`. It is ignored by Git.

## Redis Setup

For local development, run Redis with Docker:

```bash
docker run --name jwt-auth-redis -p 6379:6379 -d redis:7
```

If the container already exists but is stopped:

```bash
docker start jwt-auth-redis
```

Verify Redis:

```bash
docker exec jwt-auth-redis redis-cli ping
```

Expected:

```text
PONG
```

The auth server uses Redis for login challenges:

```text
login_challenge:<challengeId>
```

Each challenge stores the user id, username, hashed verification code, failure count, and creation time. Challenge keys expire automatically.

## MySQL Setup

Create the database:

```sql
CREATE DATABASE IF NOT EXISTS jwt_auth_demo;

USE jwt_auth_demo;
```

Create the `users` table:

```sql
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Create the `posts` table:

```sql
CREATE TABLE IF NOT EXISTS posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

The `username` and `email` columns are unique, so either value can identify one user row. Posts use `user_id`, which points to `users.id`, so posts stay tied to the same user even if a username or email changes later.

If you already created `users` before adding email support, migrate it with:

```sql
ALTER TABLE users
ADD COLUMN email VARCHAR(255) NULL AFTER username;

UPDATE users
SET email = 'barry@example.com'
WHERE username = 'Barry';

UPDATE users
SET email = 'wenqi@example.com'
WHERE username = 'Wenqi';

ALTER TABLE users
MODIFY email VARCHAR(255) NOT NULL,
ADD UNIQUE KEY users_email_unique (email);
```

## Run the App

Start the resource server:

```bash
npm run devStart
```

Start the authentication server in a second terminal:

```bash
npm run devStartAuth
```

The auth server connects to Redis before listening on port `4000`. If Redis is not running, `authServer.js` exits instead of starting in a broken state.

The servers run at:

- Resource server and browser UI: `http://localhost:3000`
- Auth server: `http://localhost:4000`

## Browser Test UI

Open:

```text
http://localhost:3000
```

Use the UI to:

- register a new user
- log in with username or email
- enter the verification code printed by the auth server
- view the current access token and refresh token
- fetch the logged-in user's posts
- create a post title for the logged-in user
- delete a post by id
- refresh the access token
- log out
- clear locally saved tokens

The browser stores tokens in `localStorage` for testing convenience.

## API Endpoints

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

Returns:

```json
{
  "message": "User registered",
  "user": {
    "id": 2,
    "username": "Alice",
    "email": "alice@example.com"
  }
}
```

If the username or email already exists, the server returns `409 Conflict`.

### Login

```http
POST http://localhost:4000/login
Content-Type: application/json

{
  "identifier": "Barry",
  "password": "password123"
}
```

The `identifier` can be either a username or an email:

```json
{
  "identifier": "barry@example.com",
  "password": "password123"
}
```

Returns:

```json
{
  "challengeId": "...",
  "message": "Verification code sent"
}
```

For local testing, the verification code is printed in the auth server terminal:

```text
Verification code for Barry: 123456
```

### Verify Login

```http
POST http://localhost:4000/login/verify
Content-Type: application/json

{
  "challengeId": "<challengeId>",
  "verificationCode": "123456"
}
```

Returns JWTs when the challenge id exists and the verification code is correct:

```json
{
  "accessToken": "...",
  "refreshToken": "..."
}
```

If the code is wrong, the server increments the challenge failure count. After 3 failed attempts, the challenge is deleted and a 5-minute cooldown key is created for that user. During cooldown, login returns `429 Too Many Requests`.

### Get Protected Posts

```http
GET http://localhost:3000/posts
Authorization: Bearer <accessToken>
```

Returns posts that belong to the authenticated user:

```json
[
  {
    "id": 1,
    "title": "My First Post",
    "created_at": "..."
  }
]
```

### Create Post

```http
POST http://localhost:3000/posts
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "title": "My Post from MySQL"
}
```

Returns:

```json
{
  "id": 2,
  "title": "My Post from MySQL",
  "user_id": 1
}
```

The client does not send `user_id`. The server gets it from `req.user.id`, which comes from the verified access token.

### Delete Post

```http
DELETE http://localhost:3000/posts/<postId>
Authorization: Bearer <accessToken>
```

Returns:

```http
204 No Content
```

The delete query checks both the post id and the current user's id:

```sql
DELETE FROM posts WHERE id = ? AND user_id = ?
```

This prevents one user from deleting another user's post. If the post does not exist or does not belong to the logged-in user, the server returns `404 Not Found`.

### Refresh Access Token

```http
POST http://localhost:4000/token
Content-Type: application/json

{
  "token": "<refreshToken>"
}
```

Returns a new access token:

```json
{
  "accessToken": "..."
}
```

### Logout

```http
DELETE http://localhost:4000/logout
Content-Type: application/json

{
  "token": "<refreshToken>"
}
```

Returns:

```http
204 No Content
```

Logout removes the refresh token from the auth server's in-memory token list.

## Token Behavior

- Access tokens are signed with `ACCESS_TOKEN_SECRET`.
- Refresh tokens are signed with `REFRESH_TOKEN_SECRET`.
- Access token payloads include `id` and `name`.
- Current access token expiration is set in `generateAccessToken` in `authServer.js`.
- Logout invalidates the refresh token, not already-issued access tokens.
- An access token can still be used until it expires.
- After logout, `POST /token` with the old refresh token should return `403 Forbidden`.

## Testing with requests.rest

Use `requests.rest` with the VS Code REST Client extension:

1. Run `POST /register` to create a user with username, email, and password.
2. Run `POST /login` with either username or email as `identifier`.
3. Copy the returned `challengeId` into `@challengeId`.
4. Copy the printed terminal code into `@verificationCode`.
5. Run `POST /login/verify`.
6. Copy the returned `accessToken` into `@accessToken`.
7. Copy the returned `refreshToken` into `@refreshToken`.
8. Run `GET /posts`.
9. Run `POST /posts` to create a post.
10. Run `GET /posts` again to see the new post.
11. Copy a post id into `@postId`.
12. Run `DELETE /posts/{{postId}}` to delete that post.
13. Run `POST /token` to refresh the access token.
14. Run `DELETE /logout`.
15. Try `POST /token` again and expect `403 Forbidden`.

Do not commit real tokens. Keep placeholders like:

```http
@accessToken = paste_access_token_here
@refreshToken = paste_refresh_token_here
@postId = paste_post_id_here
@challengeId = paste_challenge_id_here
@verificationCode = paste_verification_code_here
```

## Notes

- Refresh tokens are currently stored in memory, so they disappear when `authServer.js` restarts.
- Posts are now stored in MySQL, but refresh tokens are not yet stored in MySQL.
- Login verification codes are printed to the server terminal for local testing instead of being sent by email.
- Redis stores temporary login challenges and cooldown state.
- A production app should store refresh tokens or sessions in a database and support token revocation more carefully.
- This project is for learning JWT concepts, not production use.
