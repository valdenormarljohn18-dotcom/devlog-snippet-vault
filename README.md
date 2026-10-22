# DevLog & Snippet Vault

A local-first code and note vault. Entries are saved in the current browser on the current device. The app does not sync entries to a server. The optional online analyzer sends only code explicitly submitted for analysis to Google Gemini through the user's configured Cloudflare Worker.

The first empty vault includes an editable HTML webpage example. Open **Quick guide** in the app for a short tour of entries, previews, organization, search, and backups. Deleting the example does not cause it to be added again.

## Publish on GitHub Pages

1. Create a GitHub repository. If your account does not include Pages for private repositories, make it public.
2. Upload the project files and folders to the repository root. Keep `index.html`, `script.js`, `style.css`, `manifest.webmanifest`, `sw.js`, `icons/`, and `.github/workflows/deploy-pages.yml` in their current relative locations.
3. Push the files to the `main` branch. The included GitHub Actions workflow deploys the static app automatically.
4. In the repository, open **Settings → Pages** and confirm the source is **GitHub Actions**.
5. When the workflow finishes, open the Pages URL shown in the workflow or Pages settings.
6. On Android, open that HTTPS URL in Chrome, tap **⋮ → Install app** (or **Add to Home screen**).

The app can also share a JSON vault backup through the device's share sheet. On Android, select Bluetooth if it is offered; import the JSON file on the receiving device using **Backup → Import JSON backup**.

## Online code analyzer

The analyzer reviews C++, Python, Java, HTML, CSS, and JavaScript code. It does not execute the code. Analysis is optional: only the code submitted with **Analyze code** is sent to the configured Cloudflare Worker and Google Gemini; saved vault entries stay in browser storage. Do not submit credentials, private keys, personal data, or code you are not allowed to share. AI suggestions may be inaccurate and should be reviewed.

The Gemini API key stays as a Cloudflare Worker secret and is never placed in the static app:

1. Install Node.js and npm, then create a Cloudflare account and obtain a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Edit `cloudflare/wrangler.jsonc` and set `ALLOWED_ORIGINS` to your app's origin, for example `https://valdenormarljohn18-dotcom.github.io`. Keep the origin list narrow; the localhost entry is only for local development.
3. Open a terminal in the `cloudflare` folder. Run `npx wrangler login`, then `npx wrangler secret put GEMINI_API_KEY`; paste the key only into the Wrangler prompt, never into this repository or the app.
4. Run `npx wrangler deploy`. The included Wrangler config applies a per-IP limit of five analyses per minute; this limit is approximate. Set usage quotas/budget alerts for the Gemini API key as an additional cost safeguard. CORS is not authentication, so the rate limiter and provider quota are important.
5. In the app's code entry editor, paste your deployed `https://...workers.dev` URL under **Gemini analyzer Worker URL** and choose **Save URL**. Then select one of the supported languages and choose **Analyze code**.

The Worker validates the language and request size, does not log submitted source code, applies rate limiting, and calls Gemini server-side. Gemini's own data handling and usage terms apply to code submitted for analysis.

## Local development

Open `index.html` in a browser for local use. To test PWA installation and offline shell behavior, serve the folder from `localhost` or an HTTPS host; service workers are not available from `file://` pages. Python and TypeScript runtimes download from a CDN when first run.
