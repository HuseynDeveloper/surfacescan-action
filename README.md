# SurfaceScan GitHub Action

[![SurfaceScan](https://surfacescan.uk/badge/surfacescan.uk.svg)](https://surfacescan.uk)

Run passive external domain security posture checks in your CI/CD pipeline using the **[SurfaceScan](https://surfacescan.uk)** REST API.

No agents, no invasive port scans, and no DNS changes required — verifies TLS certificates, HTTPS redirects, HTTP security headers (`HSTS`, `CSP`, `X-Frame-Options`, `COOP`, `Permissions-Policy`), cookie flags, CORS wildcards, third-party SRI hashes, `SPF`/`DKIM`/`DMARC`, `DNSSEC`, `CAA`, and dangling subdomain takeover risks.

---

## Quick Start

Add `.github/workflows/security-posture.yml` to any repository:

```yaml
name: Domain Security Posture

on:
  push:
    branches: [main]
  schedule:
    - cron: '0 9 * * 1' # Every Monday at 09:00 UTC

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - name: Run SurfaceScan Audit
        uses: YOUR_USERNAME/surfacescan-action@v1
        with:
          domain: 'example.com'
          fail-under: 'B'
```

Every run writes a formatted breakdown directly to the **GitHub Actions Job Summary** and outputs `grade` and `score` (`0-100`).

---

## Using an API Key & Uploading SARIF to GitHub Security

Anonymous API usage allows up to **8 scans/min (60/day)** per IP. For higher CI volume (**30 req/min Free** or **120 req/min Pro**), generate a personal API key at **[surfacescan.uk/profile](https://surfacescan.uk/profile)** and store it as a repository secret (`SURFACESCAN_API_KEY`):

```yaml
name: Security Posture + SARIF

on:
  workflow_dispatch:
  schedule:
    - cron: '0 8 * * *'

jobs:
  surfacescan:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      contents: read
    steps:
      - name: Audit Production Domain
        id: scan
        uses: YOUR_USERNAME/surfacescan-action@v1
        with:
          domain: 'yourdomain.com'
          api-key: ${{ secrets.SURFACESCAN_API_KEY }}
          fail-under: 'A'
          sarif-file: 'surfacescan.sarif'

      - name: Upload SARIF to GitHub Security tab
        if: always() && steps.scan.outputs.sarif-file != ''
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: ${{ steps.scan.outputs.sarif-file }}
```

---

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `domain` | Yes | — | Domain name to audit passively (e.g. `example.com`) |
| `api-key` | No | `''` | Personal `X-API-Key` from [surfacescan.uk/profile](https://surfacescan.uk/profile) |
| `fail-under` | No | `'B'` | Minimum acceptable grade (`A+`, `A`, `B+`, `B`, `C`, `D`, `F`), or `'none'` |
| `sarif-file` | No | `''` | Output path for SARIF v2.1.0 report (e.g. `surfacescan.sarif`) |
| `write-summary` | No | `'true'` | Write Markdown summary table to `$GITHUB_STEP_SUMMARY` |
| `lang` | No | `'en'` | API response language (`en` or `az`) |
| `api-url` | No | `'https://surfacescan.uk'` | SurfaceScan API base URL |

## Outputs

| Output | Description |
|---|---|
| `grade` | Letter grade returned (`A+` through `F`) |
| `score` | Numeric score (`0` to `100`) |
| `sarif-file` | Path to generated SARIF report (when `sarif-file` is set) |

---

## Live Security Badge for Your README

Embed a live grade badge for your domain in any repository `README.md`:

```markdown
[![SurfaceScan Security Grade](https://surfacescan.uk/badge/yourdomain.com.svg)](https://surfacescan.uk)
```

---

## Direct API, Interactive Tools & Telegram Bot

- **Web Scanner:** [surfacescan.uk](https://surfacescan.uk)
- **Live API Tester & Security Builders (CSP, SPF/DMARC, security.txt):** [surfacescan.uk/tools#api](https://surfacescan.uk/tools#api)
- **cURL Quick Test:** `curl "https://surfacescan.uk/api/scan?domain=example.com"`
- **Telegram Bot:** [@surfacescan_bot](https://t.me/surfacescan_bot)

*Authorization note: Run scans only against domains you own or are authorized to evaluate. Domain owners can publish `_surfacescan.<domain> TXT "optout"` to decline automated external checks.*

## License

MIT — This repository contains the GitHub Action client wrapper for the hosted SurfaceScan API at [surfacescan.uk](https://surfacescan.uk).
