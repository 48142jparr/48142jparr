# OAuth & Authentication Flow Documentation

This document explains the OAuth flow and authentication process implemented in `AllExt.js` for GoTo API integration.

## Overview
The OAuth flow allows secure authentication with GoTo, enabling the backend to obtain access tokens for API requests. The process includes CSRF protection, token persistence, and debug output for troubleshooting.

---

## Step-by-Step Process

### 1. Environment Setup
- Loads environment variables from `.env`.
- Sets up Express for HTTP endpoints.
- Uses Axios for API requests.
- Manages token storage in memory and in `tokens.json` for persistence.

### 2. Authorization URL Generation (`/auth` endpoint)
- When a user visits `/auth`, the server generates an OAuth authorization URL using `getAuthUrl(SCOPE)`.
- A random `state` value is generated and stored for CSRF protection.
- Responds with an HTML link for the user to authorize the app with GoTo.
- Prints the authorization URL to the terminal for user convenience.

### 3. OAuth Redirect Handling (`/login/oauth2/code/goto` endpoint)
- After the user authorizes, GoTo redirects back to this endpoint with a code and state.
- The server checks that the returned state matches the expected value (CSRF protection).
- Exchanges the code for an access token using `getToken`.
- Stores the access and refresh tokens in memory and writes them to `tokens.json` for persistence.
- Prints the tokens and expiry info to the terminal for debugging.

### 4. Token Retrieval (`/api/latest-access-token` endpoint)
- Allows the frontend to fetch the latest access token for API calls or field prepopulation.

---

## Security Features
- **CSRF Protection:** Uses a random `state` value to prevent cross-site request forgery.
- **Token Persistence:** Stores tokens in `tokens.json` to avoid repeated authentication.
- **Debug Output:** Prints key steps and token info to the terminal for troubleshooting.

---

## Usage Summary
- Start the server and visit `/auth` to begin OAuth.
- Authorize the app in the browser.
- The server receives and stores tokens, enabling authenticated API requests.
- Frontend can fetch the latest token via `/api/latest-access-token`.

---

## References
- [GoTo API Documentation](https://developer.goto.com/)
- [OAuth 2.0 RFC](https://datatracker.ietf.org/doc/html/rfc6749)

---

For further details, see the code in `AllExt.js` and supporting modules.
