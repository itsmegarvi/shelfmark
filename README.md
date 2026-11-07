# Shelfmark

A Goodreads-style tracker for web novels, light novels and AO3. Log chapters, get word estimates, and see recaps of what you read. It's a PWA: install it on Android, use it offline, and sync across devices with Google sign-in.

## What it does (v1.5.0)
- **Library:** novels with a cover, source, status, rating, tags and notes. Search, sort, and filter by status or source.
- **Logging:** tap **+1** after a chapter. Tap **▾** next to it to log 2, 3, 5, 10, 15, 20, 25 or 50 at once, or **Custom / up to chapter… / other date** for anything else. Every log can be undone from the toast.
- **Word estimates:** chapters × average words per chapter. AO3 uses the exact total word count.
- **Recap:** chapters, words, reading days, streaks, top novels and sources for any period (week, month, year, all time, or custom).
- **Auto-fetch (optional):** paste a novel link and tap **⤓ Fetch info** to fill in the cover, title, author, genres, chapter count and a word average. See *Auto-fetch* below.
- **Any site:** AsuraNovels, WebNovel, LightWebNovelReads, NovelCodex, WuxiaWorld, AO3, Royal Road and ScribbleHub are built in. Paste a link from any other site and its domain is added to your sources. You can also edit the list in **Settings → Defaults → Sources**.
- **Look:** dark and light follow your phone. Status chips are coloured (Reading blue, Plan purple, Completed green, On hold yellow, Dropped red). Pick an accent in **Settings → Theme colour**.
- **Sync:** sign in with Google or email to keep phone and laptop in sync. Without sign-in, everything stays on the device.
- **Backup:** Export JSON or CSV, and Import JSON (merges by newest edit).

# Phone-only setup (Android)

You need about 15 minutes, Chrome on Android, a GitHub account and a Google account. You don't need a laptop.

## 1. Fork the repo and turn on GitHub Pages (hosting)
1. In Chrome, sign in to github.com. Tap ⋮ and check **Desktop site**.
2. Open **github.com/itsmegarvi/shelfmark** and tap **Fork**, then **Create fork**. You now have your own copy at `github.com/<your-username>/shelfmark`.
3. In your fork, go to **Settings → Pages**. Set Source to **Deploy from a branch**, set Branch to `main` with folder `/ (root)`, and tap **Save**.
4. Wait about a minute. Your app is at `https://<your-username>.github.io/shelfmark/`.

To get new versions later, open your fork and tap **Sync fork → Update branch**.

The app already works now, saving to your phone only. To sign in and sync, continue with the steps below.

## 2. Create Firebase (login + cloud storage)
Use console.firebase.google.com in Chrome. Desktop site mode helps here too.
1. Tap **Create a project**, name it `shelfmark`, and turn off Analytics.
2. Open **Build**, then **Authentication**, then **Get started**.
   - Under **Sign-in method**, enable **Google**. Pick your support email and save.
   - Optionally, also enable **Email/Password** as a fallback.
   - Under the **Settings** tab, go to **Authorized domains**, tap **Add domain**, and enter `<your-github-username>.github.io`.
3. Open **Build**, then **Firestore Database**, then **Create database**. Choose region `asia-south1` and **production mode**.
   On the **Rules** tab, replace everything with the following and tap **Publish**:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
   Use **Firestore Database**, not **Realtime Database**. The Realtime Database rules editor takes JSON and will show a parse error for these rules.
4. Tap the ⚙ icon and open **Project settings**, then the **General** tab. Under **Your apps**, tap the **</>** (Web) icon, enter the nickname `shelfmark`, and register. Skip Firebase Hosting.
   Copy the whole `const firebaseConfig = { … }` block.
   Don't use **Service accounts** or **Generate new private key**. That key is a real secret and the app doesn't need it.

## 3. Connect the app
1. Open `https://<your-github-username>.github.io/shelfmark/` and tap **Set up sync** at the top right.
2. Paste the config and tap **Save & connect**.
3. Tap **Sign in with Google**.
4. Tap ⋮ in Chrome and choose **Install app** (or **Add to Home screen**). Shelfmark now opens like a normal app and works offline.

**Another device:** go to Settings and tap **Copy setup link**, then open that link on the other device and sign in. You don't need to paste the config again.

**Skip the paste step entirely (optional):** put your config into `firebase-config.js` in the repo:
```js
export const firebaseConfig = { apiKey: "…", authDomain: "…", projectId: "…", storageBucket: "…", messagingSenderId: "…", appId: "…" };
```
Every device that opens the site then goes straight to **Sign in with Google**.

## Notes
- The Firebase `apiKey` isn't a secret. The Firestore rules are what keep your data private to your account.
- If Google sign-in fails inside the installed app, sign in once in a normal Chrome tab, or use Email/Password.
- **Updating the app later:** on a fork, tap **Sync fork → Update branch**. Otherwise, upload the changed files to the repo. Bump `VERSION` in `app.js` and `CACHE` in `sw.js` (e.g. `1.5.1`) so phones pick up the change. Then close and reopen the installed app once or twice. **Settings** shows the running version at the bottom.
- **Deploy stuck?** If **Actions** shows a failed *pages build and deployment* run that says another deployment is in progress, open **Settings → Pages**, unpublish the site, and set Source back to `main` / `/ (root)`. Then commit any small change, such as editing `.nojekyll`, to trigger a fresh deploy.
- **Backup:** Settings has Export JSON and Export CSV.

## Auto-fetch: cover, chapters and word count (optional, free)
A small Cloudflare Worker (`worker.js` in this repo) reads a novel's page and returns:

- the cover, title, author, genres, total chapters and status
- an average words-per-chapter, worked out by counting the first 10–30 chapters (you set how many)

Chapter text is never saved.

It works with **any novel site**: paste a link and tap **⤓ Fetch info**.

- **Tuned for:** Asura (everything, including the word average), WuxiaWorld (follows "Next chapter" links to sample), AO3 (exact word count) and NovelCodex (cover and details only; it's a tracker site with no chapter text).
- **Any other site:** the Worker reads the page's preview tags for the title and cover, then looks for the chapter list or a "Start reading" link and follows "Next chapter" to count words. Most sites work. If a site hides its chapters behind JavaScript or a bot check, you'll get the details but not the word average.
- **New sites** are added to your Sources list automatically, named after the domain.

### Set it up from your phone (about 5 min)
1. Go to dash.cloudflare.com and sign up for free.
2. Open **Compute (Workers)** → **Create** → **Start with Hello World**. Name it `shelfmark-fetch` and tap **Deploy**.
3. Tap **Edit code** and delete everything in the editor.
4. Open `worker.js` in this repo, tap **Raw**, select all and copy. Paste it into the editor and tap **Deploy**.
5. Copy the Worker URL, e.g. `https://shelfmark-fetch.<you>.workers.dev`.
6. In Shelfmark, go to **Settings → Auto-fetch**, paste the URL and tap **Save**, then **Test**.
7. Add a novel: paste its link, tap **⤓ Fetch info**, then **Save**.

**If you forked the repo:** after pasting `worker.js` into the Cloudflare editor (step 4), and before tapping **Deploy**, add your own site to `ALLOWED_ORIGINS` on line 16, e.g. `'https://<your-username>.github.io'`. Otherwise the Worker will refuse requests from your app.
The Worker only ever returns details and word counts, never chapter text, so leaving it open to any site is safe. To keep a site out, add it to `BLOCKED_HOSTS`.
**Updating the Worker:** open it in Cloudflare → **Edit code**, select all, paste the new `worker.js`, then **Deploy**.
The free plan allows 100,000 requests a day. Sampling 20 chapters uses 5 requests.

## Changelog
- **1.5.0:** a **▾** next to **+1** logs several chapters at once.
- **1.4.0:** works with any site, WuxiaWorld support, and new sources are added automatically.
- **1.3.0:** coloured status chips and links, plus a theme colour picker.
- **1.2.x:** auto-fetch with covers, and the setup link for new devices.
- **1.0:** library, logging, recap, history, Firebase sync and backup.
