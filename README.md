# QR Studio

A free, self-hosted QR code site: generator, dynamic codes with analytics, bulk tools, API, scanner, and a full admin console with user management. It is a single Node.js app (no tiers, no paywalls) built to run on [WebManager](https://github.com/coolguy1333/WebManager) app hosting.

## Features

| Area | What you get |
|---|---|
| **Types** | URL, text, email, phone, SMS, vCard, Wi-Fi, location, calendar event, app-store link (smart iOS/Android redirect), social media, payment (PayPal.Me, crypto, any link), PDF/file, landing page, link-in-bio page |
| **Static** | Content lives inside the code. No account needed. |
| **Dynamic** | Short link (`/abc1234`); change the destination after printing, expiry date, password, pause, custom slug, custom short domains |
| **Design** | Solid/linear/radial gradients for foreground and background, transparent background, 9 data-dot shapes, 5×5 eye shapes + eye colors, logo (with dot clearing), 5 frames with call-to-action text, L/M/Q/H error correction, margin control, brand templates |
| **Output** | PNG, JPG, SVG, PDF and EPS (PDF/EPS are true vector), 64–4096 px, print size in mm, copy to clipboard, live scan test with readability advice |
| **Analytics** | Scans, unique visitors, day/hour charts, country (and city behind a geo proxy), device, OS, browser, referrer, recent scans |
| **Organize** | Folders, campaigns (aggregate stats), multi-select actions, ZIP download |
| **Bulk** | Paste/upload CSV, column mapping, validation preview, up to 500 codes per run, ZIP of PNG/SVG/JPG/PDF/EPS |
| **API** | REST API with keys (`/api/v1`), public image URL (`/api/render`), signed scan webhooks (works with Zapier/Make/n8n; Canva via SVG/PNG or image URL) |
| **Scanner** | Camera or image upload, runs entirely in the browser |
| **Admin** | Overview, users (approve, suspend, roles, per-user limits, password reset, sign-out-everywhere, delete), all codes (block/delete), abuse reports, site-wide domains, settings (registration mode, limits, announcement, blocked destination hosts, retention), audit log |

The first account that registers becomes the administrator. Everything else is configured in **Admin → Settings**.

## Deploy on WebManager

1. Enable app hosting on the server (`sudo bash deploy/debian/enable-apps.sh` in WebManager) and make sure you have a deployment domain.
2. In WebManager add this repository under **Sources**, choose the folder, and click **Deploy as an app**.
3. Optionally set `SITE_NAME` and `ADMIN_EMAILS` on the **Variables** page.
4. Open the app's address and register: you are the administrator.

Data (SQLite database, uploaded files, signing key) lives in `/data`, which WebManager backs up before each restart.

**Custom short domains:** add the hostname as a domain alias of the app in WebManager, then add it under **Admin → Domains** (site-wide) or let users add their own (TXT-record verified). On those hostnames only short links resolve; the dashboard and API stay on the main address.

**Location analytics:** country is resolved from the visitor IP with a bundled database, or from CDN headers (`CF-IPCountry` etc.) when present. City needs a geo-aware proxy such as Cloudflare with "Add visitor location headers".

## Run locally

```bash
npm install
npm start          # http://localhost:8080, data in ./data
npm test
```

Requires Node ≥ 22.13 (uses the built-in `node:sqlite`). Server-side PNG/JPG rendering uses `@resvg/resvg-js` (optional; the API falls back to SVG/PDF/EPS if unavailable).

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `DATA_DIR` | `./data` | Persistent storage |
| `PUBLIC_URL` | derived | Public base URL used inside dynamic QR codes |
| `TRUST_PROXY` | `false` | Trust `X-Real-IP` / `X-Forwarded-*` (set by WebManager) |
| `SITE_NAME` | `QR Studio` | Default site name |
| `ADMIN_EMAILS` | – | Emails that become admin on registration |

## Security notes

- Passwords: scrypt. Sessions: random tokens stored hashed, `HttpOnly; SameSite=Lax`. State-changing requests need a same-origin `X-Requested-With` header (API keys use `Authorization: Bearer`).
- Strict CSP (no inline scripts), user text is always escaped, only `http(s)`/`mailto`/`tel` links are accepted.
- Webhooks only call public `https` hosts (private/loopback ranges are refused).
- Scan IPs are stored only as a keyed hash; bots are not counted.
- Hosted files are served with `nosniff`; only PDFs and images render inline.

## API quick start

```bash
curl -X POST $URL/api/v1/codes -H "Authorization: Bearer qrs_…" -H "Content-Type: application/json" \
  -d '{"type":"url","dynamic":true,"name":"Menu","fields":{"url":"https://example.com/menu"}}'
curl -o qr.png "$URL/api/render?data=https://example.com&format=png&size=512&dots=rounded&fg=4f46e5"
```

Full reference is shown in the app under **API & integrations**.
