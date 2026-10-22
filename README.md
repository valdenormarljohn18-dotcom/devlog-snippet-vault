# DevLog & Snippet Vault

A local-first code and note vault. Entries are saved in the current browser on the current device. The app does not sync entries to a server.

## Publish on GitHub Pages

1. Create a GitHub repository. If your account does not include Pages for private repositories, make it public.
2. Upload the project files and folders to the repository root. Keep `index.html`, `script.js`, `style.css`, `manifest.webmanifest`, `sw.js`, `icons/`, and `.github/workflows/deploy-pages.yml` in their current relative locations.
3. Push the files to the `main` branch. The included GitHub Actions workflow deploys the static app automatically.
4. In the repository, open **Settings → Pages** and confirm the source is **GitHub Actions**.
5. When the workflow finishes, open the Pages URL shown in the workflow or Pages settings.
6. On Android, open that HTTPS URL in Chrome, tap **⋮ → Install app** (or **Add to Home screen**).

The app can also share a JSON vault backup through the device's share sheet. On Android, select Bluetooth if it is offered; import the JSON file on the receiving device using **Backup → Import JSON backup**.

## Local development

Open `index.html` in a browser for local use. To test PWA installation and offline shell behavior, serve the folder from `localhost` or an HTTPS host; service workers are not available from `file://` pages. Python and TypeScript runtimes download from a CDN when first run.
