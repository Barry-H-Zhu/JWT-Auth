# JWT Auth Demo

A small Node.js and Express project for learning JWT authentication with a real MySQL-backed login flow.

The app is split into two servers:

- `server.js`: resource server on port `3000`
- `authServer.js`: authentication server on port `4000`

The auth server verifies users from MySQL with `username` and `password`, stores password hashes with bcrypt, and issues JWT access and refresh tokens.

## Features

- Login with `username` and `password`
- Store users in MySQL
- Store password hashes with bcrypt
- Generate access tokens and refresh tokens
- Include `id` and `name` in JWT payloads
- Protect `/posts` with JWT middleware
- Refresh expired access tokens with a refresh token
- Logout by invalidating the refresh token in memory
- Test APIs with `requests.rest`
- Test the flow in a browser UI served from `public/`

## Project Structure

```text
.
|-- authServer.js       # Login, token refresh, logout
|-- server.js           # Protected posts route and static UI hosting
|-- db.js               # MySQL connection pool
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
```

Generate JWT secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Do not commit `.env`. It is ignored by Git.

## MySQL Setup

Create the database and users table:

```sql
CREATE DATABASE IF NOT EXISTS jwt_auth_demo;

USE jwt_auth_demo;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

The `username` column is unique, so one username maps to one user row. The `id` column is the stable database identifier used inside JWT payloads.

## Create a Test User

Generate a bcrypt hash for a test password:

```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('password123', 10).then(console.log);"
```

Insert the user into MySQL:

```sql
USE jwt_auth_demo;

INSERT INTO users (username, password_hash)
VALUES ('Barry', '<paste_bcrypt_hash_here>');
```

Verify:

```sql
SELECT id, username, LEFT(password_hash, 7) AS hash_prefix, created_at
FROM users;
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

The servers run at:

- Resource server and browser UI: `http://localhost:3000`
- Auth server: `http://localhost:4000`

## Browser Test UI

Open:

```text
http://localhost:3000
```

Use the UI to:

- log in
- view the current access token and refresh token
- request `GET /posts`
- refresh the access token
- log out
- clear locally saved tokens

The browser stores tokens in `localStorage` for testing convenience.

## API Endpoints

### Login

```http
POST http://localhost:4000/login
Content-Type: application/json

{
  "username": "Barry",
  "password": "password123"
}
```

Returns:

```json
{
  "accessToken": "...",
  "refreshToken": "..."
}
```

### Get Protected Posts

```http
GET http://localhost:3000/posts
Authorization: Bearer <accessToken>
```

Returns posts that belong to the authenticated user.

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

1. Run `POST /login`.
2. Copy the returned `accessToken` into `@accessToken`.
3. Copy the returned `refreshToken` into `@refreshToken`.
4. Run `GET /posts`.
5. Run `POST /token` to refresh the access token.
6. Run `DELETE /logout`.
7. Try `POST /token` again and expect `403 Forbidden`.

Do not commit real tokens. Keep placeholders like:

```http
@accessToken = paste_access_token_here
@refreshToken = paste_refresh_token_here
```

## Notes

- Refresh tokens are currently stored in memory, so they disappear when `authServer.js` restarts.
- A production app should store refresh tokens or sessions in a database and support token revocation more carefully.
- This project is for learning JWT concepts, not production use.
