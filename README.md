# JWT Auth Demo

This is a small Node.js and Express demo project that shows how to use JSON Web Tokens (JWT) for authentication.

The project is split into two servers:

- `server.js`: resource server on port `3000`
- `authServer.js`: authentication server on port `4000`

## Features

- Login with a username
- Generate an access token
- Generate a refresh token
- Protect routes with JWT middleware
- Refresh an expired access token
- Logout by invalidating a refresh token

## Project Structure

```text
.
├── authServer.js      # Authentication routes: login, token refresh, logout
├── server.js          # Protected resource route: posts
├── requests.rest      # Example API requests
├── package.json       # Scripts and dependencies
├── package-lock.json
└── .env               # JWT secrets
```

## Install

```bash
npm install
```

## Environment Variables

Create a `.env` file in the project root:

```env
ACCESS_TOKEN_SECRET=your_access_token_secret
REFRESH_TOKEN_SECRET=your_refresh_token_secret
```

You can generate secrets with Node:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
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

- Resource server: `http://localhost:3000`
- Auth server: `http://localhost:4000`

## API Endpoints

### Login

```http
POST http://localhost:4000/login
Content-Type: application/json

{
  "username": "Barry"
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

Returns `204 No Content` when the refresh token is removed.

## Notes

- Access tokens currently expire after `20s`.
- Refresh tokens are stored in memory, so they disappear when the auth server restarts.
- The login route is only a demo and does not verify a password.
- This project is for learning JWT concepts, not production use.

