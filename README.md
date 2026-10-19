# Finad

Finad reads stock-market and world news, works out which stocks each story helps or hurts, and turns that into signals:

- **Sell alerts:** stocks near their **52-week high** while the news turns **against** them.
- **Buy ideas:** stocks near their **52-week low** while the news turns **in their favour**.
- **Avoid** (near the low, news still negative: falling knives) and **Hold** (near the high, news still supportive: momentum).

It is a Windows desktop app that starts with Windows and works from the system tray, with an Android app for alerts.
Website and downloads: **https://shamoug.github.io/finad/**

## Install

**Windows:** download `Finad-Installer.zip` from the [download page](https://shamoug.github.io/finad/download.html), unzip it and double-click
`install.bat`. No admin rights are needed. The installer:

- downloads the app runtime (Electron, checked against its SHA-256);
- installs Finad to `%LOCALAPPDATA%\Programs\Finad`;
- adds Start Menu and Desktop shortcuts and lists Finad in Settings > Apps.

Finad then starts with Windows, in the tray. From this project folder, `install.bat` installs the same way.

**Android:** download `Finad-Android.apk` from the same page. In Finad on the computer, open **Phone**, turn on the phone link,
and scan its QR code in the app.

**Developing:** `node server.js` runs Finad in the browser at http://localhost:4747 (Node 18+, no npm packages).

## How it works

```
 20 RSS feeds (CNBC, MarketWatch, WSJ, FT, NYT, BBC, Al Jazeera, Fed, Google News...)
 + Yahoo Finance headlines for each stock you hold or follow
        │  every 15 min; each story is processed as it arrives (Live newsroom)
        ▼
 COMPANY   companies named (190 stocks + yours) and the tone of each mention
 WORLD     30 macro themes and their direction (oil ↑, rates ↓, tariffs, war/ceasefire, AI capex...) mapped
           to the stocks exposed to them
 LOCAL AI  optional (Ollama): reads headlines and adds first-order effects; it refines the rules but never overrides them
 WEIGH     source credibility × recency; a theme's pull saturates
 PRICES    Yahoo Finance 1-year chart → 52-week high/low and position in the range
 SIGNAL    news impact × 52-week zone → SELL / BUY / AVOID / HOLD + conviction 0–100
 ALERT     a stock that newly turns SELL/BUY (or a holding that turns against you) → Windows notification
           + phone feed
```

## Phone link (free JSON store)

After each update, the desktop app writes a compact feed (signals, alerts, world drivers, headlines) to
[textdb.dev](https://textdb.dev), a free public JSON store with no account. It writes under a secret key that only the
computer knows. The phone gets that store's **read-only** id through the QR code. The Android app checks it about
every 15 minutes (WorkManager) and notifies new alerts. Share counts and costs are never sent.

## Updates

- **Desktop:** `docs/downloads/desktop.json` on the website gives the newest version, the address of `Finad-app.zip`,
  and its SHA-256. The installed app checks every 6 hours, downloads and verifies the package, unpacks it over its
  files and restarts.
- **Android:** `docs/downloads/android.json` gives the newest version, its address and its SHA-256. The workflow
  `.github/workflows/android.yml` builds, signs and publishes the app whenever `android/` changes.

### Releasing a desktop version

1. Raise `version` in `package.json`.
2. Run `powershell -ExecutionPolicy Bypass -File scripts\pack.ps1 -Notes "what changed"`. It writes
   `docs/downloads/Finad-Installer.zip`, `Finad-app.zip` and `desktop.json`.
3. Commit and push. GitHub Pages publishes it, and installed copies update themselves.

### Android signing

The signing key is kept outside the project (`%USERPROFILE%\.finad-signing\`). It is stored in the repository's
secrets as `ANDROID_KEYSTORE_B64` and `ANDROID_KEYSTORE_PASSWORD`. Keep that key safe: an app signed with another key
cannot install over the existing one.

## Project layout

| Path | What it is |
|---|---|
| `server.js` | Pipeline, API, live events (SSE), alerts, phone sync, update check |
| `lib/` | feeds, quotes, universe (stocks and tags), themes (world drivers), analyze (scoring), ollama, phone, updater, store |
| `public/` | Desktop UI (vanilla JS; QR code via the vendored qrcode-generator, MIT) |
| `desktop/main.js` | Electron shell: window, tray, Start with Windows, notifications |
| `scripts/` | install / uninstall / pack / make-icons / selftest |
| `android/` | Android app (WebView UI in `assets/index.html`, Java for feed, notifications and updates) |
| `docs/` | Website (GitHub Pages) and `downloads/` |

Data lives in `%USERPROFILE%\.finad` (articles, prices, settings, holdings, alerts). Delete it to reset.

## Disclaimer

Finad produces automated, algorithmic signals from public news headlines. It is not a licensed financial adviser,
and its output is not personalised investment advice. Check the linked sources before you trade.
