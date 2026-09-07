# My Girlfriend is Curious

### —about what I listen to on Spotify!

My girlfriend wants to know what I'm listening to, but I don't like Spotify displaying my activity on their app to everyone. I made this small server that returns my current listening activity so that she can check my current playback whenever she's curious.

The server turns my current Spotify activity into a public JSON API. It runs on Cloudflare Workers and works with anything that can make an HTTP request. The repo also includes a plain HTML widget that can be used as a basic example of how to use the API.

## Overview

- `/current` returns the configured account's current track.
- The Worker refreshes and stores Spotify tokens in a Durable Object.
- A ten-second cache lets multiple clients share one request to Spotify.
- An IFTTT webhook supplies a private sign-in link when the Spotify account needs authorization.

## Deployment

### Requirements

You need:

- A Cloudflare account
- A Spotify developer account with Spotify Premium
- An IFTTT Pro or Pro+ account

### I. Set up the Worker

1. Sign in to Cloudflare:

   ```sh
   npx wrangler login
   ```

2. Set `name` to a unique Worker name in `wrangler.jsonc`.
3. Find your account subdomain under **Build** → **Compute** → **Workers & Pages** in the Cloudflare dashboard.
4. Set `PUBLIC_BASE_URL` in `wrangler.jsonc` to the full URL of the Worker. A Worker named `mgic` would normally use:

   ```text
   https://mgic.<YOUR-SUBDOMAIN>.workers.dev
   ```

5. Make a copy of `.dev.vars.example` and name it `.dev.vars`.

### II. Create a Spotify app

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app.
2. Give it a name and description.
3. Set the redirect URI, for example:

   ```text
   https://mgic.<YOUR-SUBDOMAIN>.workers.dev/callback
   ```

4. Select **Web API** when Spotify asks which API you will use.
5. Agree to the terms of service and guidelines.
6. Click **Save**.
7. Copy the app's client ID to `SPOTIFY_CLIENT_ID` in `wrangler.jsonc`.
8. Copy the app's client secret to `SPOTIFY_CLIENT_SECRET` in `.dev.vars`. Keep this key private.

### III. Find the Spotify account ID

1. Open the Spotify profile that this server will target and examine its profile link. Use the last section of the URL as `SPOTIFY_USER_ID`.
   - For example, the account ID in `https://open.spotify.com/user/abc123` is `abc123`.
2. Copy this ID to `SPOTIFY_USER_ID` in `wrangler.jsonc`.

### IV. Create the IFTTT recovery notification

1. Create a new IFTTT applet with:
   - **If This:** Webhooks → **Receive a web request**
     - **Event Name:** `spotify_reauthorization`
   - **Then That:** Notifications → **Send a rich notification from the IFTTT app**
     - **Title:** `Spotify reauthorization required` (or whatever you want)
     - **Message:** `Spotify server requires reauthorization. {{Value2}}`
     - **Link URL:** `{{Value1}}`
     - **High priority:** `Yes` (optional)
2. Copy the Webhooks key to `IFTTT_KEY` in `.dev.vars`. Keep this key private.

### V. Verify Worker Configuration

Verify the following values in the `vars` section of `wrangler.jsonc` have been set correctly:

```jsonc
"vars": {
  "PUBLIC_BASE_URL": "https://mgic.<YOUR-SUBDOMAIN>.workers.dev",
  "SPOTIFY_CLIENT_ID": "<YOUR_SPOTIFY_CLIENT_ID>",
  "SPOTIFY_USER_ID": "<YOUR_SPOTIFY_ACCOUNT_ID>",
  "IFTTT_EVENT": "spotify_reauthorization",
  "ALLOWED_ORIGINS": "https://<EXAMPLE-ORIGIN>.com,https://www.<EXAMPLE-ORIGIN>.com"
}
```

`ALLOWED_ORIGINS` accepts a comma-separated list of exact browser origins. Include the scheme and hostname, but no page path or trailing slash. Use an empty string if no browser will call the API directly.

### VI. Test and deploy

1. Run:

   ```sh
   npm run types
   npm run check
   npm test
   npm run build
   npm run deploy
   ```

2. If no errors come back, add both secrets through Wrangler's secret command:

   ```sh
   npx wrangler secret put SPOTIFY_CLIENT_SECRET
   npx wrangler secret put IFTTT_KEY
   ```

### VII. Connect Spotify

1. Request the health route to test the Worker is working (it should return `{"ok":true}`):

   ```sh
   curl https://mgic.<YOUR-SUBDOMAIN>.workers.dev/health
   ```

2. Then request current playback:

   ```sh
   curl https://mgic.<YOUR-SUBDOMAIN>.workers.dev/current
   ```

3. The first request will return `503` with `spotify_reauthorization_required` and trigger the IFTTT notification. Open the link, sign in with the configured Spotify account, and approve access.
   - The link expires after 24 hours; the authorization page expires ten minutes after you open it.
4. Start playback in Spotify and request `/current` again. A successful response has HTTP status `200`.

## Use the API

### Browser JavaScript

```js
const response = await fetch("https://mgic.<YOUR-SUBDOMAIN>.workers.dev/current");

if (!response.ok) {
  throw new Error(`Playback request failed: ${response.status}`);
}

const playback = await response.json();

if (playback.playing) {
  console.log(`${playback.track.name} by ${playback.track.artists.names.join(", ")}`);
}
```

### `GET /current` response

```json
{
  "playing": true,
  "device": {"name": "Living Room", "type": "Speaker"},
  "player": {
    "vol": 42,
    "shuffle": false,
    "repeat": "off",
    "progress": 0.36
  },
  "track": {
    "context": {
      "name": "Example Album",
      "type": "album",
      "url": "https://open.spotify.com/album/..."
    },
    "artists": {
      "names": ["Example Artist"],
      "url": "https://open.spotify.com/artist/..."
    },
    "contentType": "track",
    "name": "Example Track",
    "image": "https://i.scdn.co/image/...",
    "explicit": false,
    "url": "https://open.spotify.com/track/..."
  }
}
```

- `player.progress` ranges from `0` to `1`
- `contentType` is `track` or `episode`
- Context can be an album, show, playlist, artist, or `null`

Paused playback, private sessions, ads, missing items, and unsupported item types return:

```json
{
  "playing": false,
  "device": {},
  "player": {},
  "track": {
    "context": null,
    "artists": {"names": []}
  }
}
```

Clients should honor `Retry-After` on `429` and `503` responses. During a short Spotify outage or rate limit, the server may return a playback result up to 30 seconds old with `X-Playback-Stale: true`.

## Example widget

[`docs/index.html`](docs/index.html) shows an example of how to render the API response in a web page. Set its `data-endpoint` to your `/current` endpoint:

```html
<spotify-widget data-endpoint="https://mgic.<YOUR-SUBDOMAIN>.workers.dev/current"></spotify-widget>
```

## Routes

| Route                   | Result                                                           |
| ----------------------- | ---------------------------------------------------------------- |
| `GET /health`           | Returns `200 { "ok": true }` if the Worker is running.           |
| `GET /current`          | Returns current playback.                                        |
| `OPTIONS /current`      | Returns a CORS preflight response.                               |
| `GET /missingAlbum.svg` | Returns the fallback artwork for when Spotify supplies no image. |
| `GET /login?ticket=...` | Redirects to Spotify login during authorization.                 |
| `GET /callback`         | Callback after Spotify authorization.                            |

## Authorization

The Worker can connect to IFTTT via a webhook when it has no valid token, to alert the user that authorization is required. After the initial authorization, it will require reauthorization once every few months.

The Worker triggers reauthorization on a `/current` request if its token has expired. If the triggered webhook fails or goes ignored, additional alerts can be sent with a new `/current` request after 10 minutes.

In the webhook, the Worker generates a reauthorization link that expires completely after 24 hours. Clicking the link will redirect to Spotify login, where you can authorize the Worker to access your account.

## Local development

Copy `.dev.vars.example` to `.dev.vars` to use local secrets. To start a development server, run:

```sh
npm run dev
```
