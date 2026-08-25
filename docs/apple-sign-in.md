# Sign in with Apple

Backend endpoints mirror Google:

| Client             | Method | Path                                              |
| ------------------ | ------ | ------------------------------------------------- |
| iOS / Apple JS     | `POST` | `/v1/auth/apple`                                  |
| Web redirect start | `GET`  | `/v1/auth/apple/web`                              |
| Web callback       | `POST` | `/v1/auth/apple/web/callback` (Apple `form_post`) |

Success (mobile / Apple JS): same shape as Google — `{ data: { user, token } }`.  
Web redirect: `{APPLE_FRONTEND_REDIRECT_URL}?token=<jwt>`.

---

## 1. Apple Developer Portal

1. **App ID** (iOS): enable **Sign In with Apple**.
2. **Services ID** (web): enable Sign In with Apple; set:
   - Domains (API host, e.g. `api.yourdomain.com`)
   - Return URL: `https://<api-host>/v1/auth/apple/web/callback`
3. **Key**: create a Sign in with Apple key → download `.p8` once → note **Key ID** and **Team ID**.
4. Record **Bundle ID** (iOS `aud`) and **Services ID** (web `client_id` / `aud`).

## 2. Environment variables

```bash
APPLE_BUNDLE_ID=com.bluebeep.app
APPLE_SERVICES_ID=com.bluebeep.web
APPLE_TEAM_ID=XXXXXXXXXX
APPLE_KEY_ID=YYYYYYYYYY
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
APPLE_CALLBACK_URL=https://api.yourdomain.com/v1/auth/apple/web/callback
APPLE_FRONTEND_REDIRECT_URL=https://app.yourdomain.com/auth/callback
```

Never commit the `.p8` file. Use `\n` escapes when storing the PEM in a single-line env var.

## 3. iOS client

1. Enable **Sign in with Apple** in Xcode.
2. Use `ASAuthorizationAppleIDProvider` (or Flutter/RN wrapper).
3. Request scopes: email + full name.
4. `POST /v1/auth/apple` with:

```json
{
  "identityToken": "<JWT from Apple>",
  "firstName": "optional — only on first consent",
  "lastName": "optional — only on first consent"
}
```

5. Store `data.token` as `Authorization: Bearer …` (same as Google).

**App Store:** if Google Sign-In is offered on iOS, Apple Sign-In must be offered as an equivalent option.

## 4. Web client

**Option A — redirect (recommended, matches Google web):**

1. Navigate to `GET {API}/v1/auth/apple/web`.
2. After Apple + backend callback, read `token` from the frontend redirect query string.

**Option B — Apple JS:**

1. Register the frontend domain on the Services ID.
2. Obtain an identity token via Apple JS.
3. `POST /v1/auth/apple` with `{ identityToken }` (same as mobile).

## 5. Account linking notes

- Users are keyed by Apple `sub` (`users.apple_id`), not email alone.
- Email may be a private relay and is often only present on the **first** authorization.
- If an account already exists for that email, Apple login attaches `apple_id` and logs in.
- Name is only returned by Apple on first consent — send it from the client when available.
