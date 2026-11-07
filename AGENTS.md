# AGENTS.md: setting up Shelfmark for a user

These are instructions for an AI assistant, browser agent or coding agent asked to "set up Shelfmark for me." Follow them in order. The user's data lives in **their own** Firebase project, and auto-fetch runs on **their own** Cloudflare Worker.

## 0. Decide the path (ask the user if it's unclear)
- **Hosted (default):** the user opens `https://itsmegarvi.github.io/shelfmark/`. Nothing to deploy for the app itself.
- **Fork:** pick this only if the user wants to change the code. Fork `itsmegarvi/shelfmark`, then enable GitHub Pages: Settings → Pages → *Deploy from a branch*, `main`, `/ (root)`. The app URL becomes `https://<user>.github.io/shelfmark/`.

Below, `APP_ORIGIN` means `https://itsmegarvi.github.io` (hosted) or `https://<user>.github.io` (fork). `APP_URL` means `APP_ORIGIN + /shelfmark/`.

## Steps the user must do themselves
Agents must not create accounts or type passwords for the user. Ask the user to:
1. Sign in to (or sign up for) a **Google account** at console.firebase.google.com.
2. Sign in to (or sign up for) a free **Cloudflare account** at dash.cloudflare.com.
3. Sign in to **GitHub**, for the fork path only.
4. Tap **Sign in with Google** inside Shelfmark at the end.

Once the user is signed in, you can do everything else in their browser session or CLI.

## 1. Firebase project (console.firebase.google.com)
| # | Action | Where |
|---|---|---|
| 1 | Create a project named `shelfmark` with Google Analytics **off**. Note the project ID (`PROJECT_ID`). | Console home → *Create a project* |
| 2 | Enable the **Google** sign-in provider (support email = the user's email). Optionally enable **Email/Password**. | `/project/PROJECT_ID/authentication/providers` |
| 3 | Add `itsmegarvi.github.io` (hosted) or `<user>.github.io` (fork) to **Authorized domains**. | Authentication → *Settings* → *Authorized domains* |
| 4 | Create **Cloud Firestore** (not Realtime Database) in production mode, with a region near the user. | Build → *Firestore Database* → *Create database* |
| 5 | Replace the Firestore rules with the contents of [`firestore.rules`](firestore.rules) and click **Publish**. | Firestore → *Rules* tab |
| 6 | Register a **Web app** (`</>`) named `shelfmark` and skip Hosting. Copy the `firebaseConfig` object (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`). | ⚙ *Project settings* → *General* → *Your apps* |

Don't go to *Service accounts* and don't generate a private key. The app only needs the public web config.

**CLI alternative.** Use this if you have a shell and the user has run `firebase login`:
```sh
firebase projects:create shelfmark-<suffix> --display-name shelfmark
firebase firestore:databases:create "(default)" --location=asia-south1 --project shelfmark-<suffix>
firebase apps:create web shelfmark --project shelfmark-<suffix>
firebase apps:sdkconfig web --project shelfmark-<suffix>        # prints firebaseConfig
echo '{"firestore":{"rules":"firestore.rules"}}' > firebase.json
firebase deploy --only firestore:rules --project shelfmark-<suffix>
```
Steps 2 and 3 (the Google provider and Authorized domains) still need the console.

## 2. Cloudflare Worker for auto-fetch (optional but recommended)
1. In dash.cloudflare.com, go to Workers & Pages → *Create* → *Start with Hello World*. Name it `shelfmark-fetch` and deploy it.
2. Click *Edit code* and replace everything with [`worker.js`](worker.js). Use the raw file: `https://raw.githubusercontent.com/itsmegarvi/shelfmark/main/worker.js`.
   - **Hosted:** no change needed, because `https://itsmegarvi.github.io` is already in `ALLOWED_ORIGINS`.
   - **Fork:** add `'https://<user>.github.io'` to `ALLOWED_ORIGINS` (line 16).
3. Deploy it, and note the URL as `WORKER_URL`, e.g. `https://shelfmark-fetch.<subdomain>.workers.dev`.
4. Check it: `GET WORKER_URL` should return JSON with a `service` field.

**CLI alternative.** Use this after the user runs `npx wrangler login`:
```sh
curl -sLo worker.js https://raw.githubusercontent.com/itsmegarvi/shelfmark/main/worker.js
npx wrangler deploy worker.js --name shelfmark-fetch --compatibility-date 2024-09-01
```

## 3. Connect the app with a single setup link (no typing in the app)
Build this URL and open it in the browser the user will use Shelfmark in, usually Chrome on their phone:
```
APP_URL#setup=<SETUP>&fetcher=<encodeURIComponent(WORKER_URL)>
```
where `SETUP = encodeURIComponent(base64(utf8(JSON.stringify(firebaseConfig))))`.

In JavaScript:
```js
const setup = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(firebaseConfig)))));
const link = `${APP_URL}#setup=${setup}&fetcher=${encodeURIComponent(WORKER_URL)}`;
```
On load, the app saves the config to `localStorage['shelfmark:fbconfig']` and the Worker URL to `settings.fetcherUrl` in `localStorage['shelfmark:v1']`. It then clears the hash and shows the toast "Auto-fetch set up from link". Either parameter can be left out.

Give the user this link too. It's how they set up their other devices.

**Manual alternative (UI).** Open `APP_URL` and tap the **Settings** tab (`nav.tabbar button[data-view="settings"]`). Then:
- Paste the config into `#cfgInput` and click `#cfgSave` (the page reloads).
- Enter `WORKER_URL` in `#fetcherUrl`, click `#saveFetcher`, then `#testFetcher`. A toast says "Worker is reachable ✓".

## 4. Hand over to the user
Ask the user to:
1. Tap **Sign in with Google** (`#settingsSignIn`). The dot in the header turns green when sync is on.
2. In Chrome, tap **⋮ → Install app** to add it to the home screen.

## 5. Check that it worked
- **Settings** shows "Connected to Firebase project <PROJECT_ID>", and after sign-in, "Signed in as <email>".
- **Settings → Auto-fetch → Test** says the Worker is reachable.
- Add a novel, paste a link (e.g. a WuxiaWorld novel page), and tap **⤓ Fetch info**. The title, cover and chapter count should fill in.
- The version is shown at the bottom of Settings (currently 1.5.1).

## Troubleshooting
| Symptom | Fix |
|---|---|
| `auth/unauthorized-domain` on sign-in | Add the app's domain to Firebase Authorized domains (step 1.3). |
| Firestore `permission-denied` | The rules weren't published, or they were pasted into Realtime Database. Redo step 1.5 in Cloud Firestore. |
| Fetch info fails with "origin not allowed" | Add `APP_ORIGIN` to `ALLOWED_ORIGINS` in the Worker and redeploy. |
| Details are fetched but there's no word average | The site needs JavaScript or has a bot check. The user can type in the words per chapter. |
| Old version still showing | Close and reopen the installed app. The service worker updates on the next load. |

## Don't
- Don't put the user's config into `firebase-config.js` in `itsmegarvi/shelfmark`. That would send every hosted user to their project. It's fine in a fork.
- Don't create GitHub, Google or Cloudflare accounts, or enter passwords, for the user.
- Don't use the app owner's Worker or Firebase project for another user.
