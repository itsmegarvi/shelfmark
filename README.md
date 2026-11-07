# Shelfmark

A Goodreads-style tracker for web novels, light novels and AO3. Log chapters, get word estimates, and see recaps of what you read. It's a PWA: install it on Android, use it offline, and sync across devices with Google sign-in.

**Live app:** https://itsmegarvi.github.io/shelfmark/

## Choose how to use it

| | **A. Use the hosted app** (recommended) | **B. Fork the repo** |
|---|---|---|
| Who it's for | You just want to track your reading | You want to change the code or the look |
| App address | `itsmegarvi.github.io/shelfmark` | `<you>.github.io/shelfmark` |
| Your data | In **your own** Firebase project. The app's owner can't see it. | In your own Firebase project |
| Auto-fetch | Your own Cloudflare Worker, pasted as-is | Your own Worker, plus one line added to `ALLOWED_ORIGINS` |
| Updates | Automatic | Tap **Sync fork → Update branch** |
| Setup time | About 15 minutes | About 20 minutes |

Both use the same steps for Firebase and Cloudflare. The only differences are where the app lives and the one `ALLOWED_ORIGINS` line.

**Setting it up with an AI assistant?** Point it at [`AGENTS.md`](AGENTS.md). That file has step-by-step instructions it can follow, and lists the steps you have to do yourself, such as signing in.

## What it does (v1.5.1)
- **Library:** novels with a cover, source, status, rating, tags and notes. Search, sort, and filter by status or source.
- **Logging:** tap **+1** after a chapter. Tap **▾** next to it to log 2, 3, 5, 10, 15, 20, 25 or 50 at once, or **Custom / up to chapter… / other date** for anything else. Every log can be undone from the toast.
- **Word estimates:** chapters × average words per chapter. AO3 uses the exact total word count.
- **Recap:** chapters, words, reading days, streaks, top novels and sources for any period (week, month, year, all time, or custom).
- **Auto-fetch (optional):** paste a novel link and tap **⤓ Fetch info** to fill in the cover, title, author, genres, chapter count and a word average.
- **Any site:** AsuraNovels, WebNovel, LightWebNovelReads, NovelCodex, WuxiaWorld, AO3, Royal Road and ScribbleHub are built in. Paste a link from any other site and its domain is added to your sources. You can also edit the list in **Settings → Defaults → Sources**.
- **Look:** dark and light follow your phone. Status chips are coloured (Reading blue, Plan purple, Completed green, On hold yellow, Dropped red). Pick an accent in **Settings → Theme colour**.
- **Sync:** sign in with Google or email to keep phone and laptop in sync. Without sign-in, everything stays on the device.
- **Backup:** Export JSON or CSV, and Import JSON (merges by newest edit).

# Setup (phone-only, Android)

You need Chrome on Android and a Google account. You also need a free Cloudflare account for Auto-fetch, and a GitHub account if you're forking. You don't need a laptop. In Chrome, turn on **⋮ → Desktop site** for the GitHub, Firebase and Cloudflare consoles.

## 1. Get the app

**Option A: Hosted.** Open https://itsmegarvi.github.io/shelfmark/. That's it. The app already works, saving to your phone only. Continue with step 2 for sign-in and sync.

**Option B: Fork.**
1. Sign in to github.com, open **github.com/itsmegarvi/shelfmark**, and tap **Fork → Create fork**.
2. In your fork, go to **Settings → Pages**. Set Source to **Deploy from a branch**, set Branch to `main` with folder `/ (root)`, and tap **Save**.
3. After about a minute your app is at `https://<your-username>.github.io/shelfmark/`.
4. To get new versions later, tap **Sync fork → Update branch**.

## 2. Create your Firebase project (login + cloud storage)
Use console.firebase.google.com. It's on the free Spark plan, so you don't need a card.
1. Tap **Create a project**, name it `shelfmark`, and turn off Google Analytics.
2. Open **Build → Authentication → Get started**.
   - Under **Sign-in method**, enable **Google**. Pick your support email and save.
   - Optionally, also enable **Email/Password** as a fallback.
   - Under **Settings → Authorized domains**, tap **Add domain** and enter the app's domain:
     - **A:** `itsmegarvi.github.io`
     - **B:** `<your-username>.github.io`
3. Open **Build → Firestore Database → Create database**. Pick a region near you (e.g. `asia-south1`) and **production mode**.
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
   Use **Firestore Database**, not **Realtime Database**. The Realtime Database rules editor expects JSON and shows a parse error for these rules.
4. Tap **⚙ → Project settings → General**. Under **Your apps**, tap **</>** (Web), enter the nickname `shelfmark`, and register. Skip Firebase Hosting.
   Copy the whole `const firebaseConfig = { … }` block.
   Don't use **Service accounts → Generate new private key**. That key is a real secret, and the app doesn't need it.

## 3. Create your Auto-fetch Worker (optional, about 5 min)
1. Go to dash.cloudflare.com and sign up for free.
2. Open **Compute (Workers) → Create → Start with Hello World**. Name it `shelfmark-fetch` and tap **Deploy**.
3. Tap **Edit code** and delete everything in the editor.
4. Open [`worker.js`](worker.js) and tap **Raw**. Select all, copy, and paste it into the editor.
   - **A:** don't change anything. `itsmegarvi.github.io` is already allowed.
   - **B:** add `'https://<your-username>.github.io'` to `ALLOWED_ORIGINS` on line 16.
5. Tap **Deploy**, then copy the Worker URL, e.g. `https://shelfmark-fetch.<you>.workers.dev`.

## 4. Connect the app
1. Open the app and go to **Settings**.
2. Under **Cloud sync setup**, paste the config and tap **Save & connect**.
3. Under **Auto-fetch**, paste the Worker URL and tap **Save**, then **Test**.
4. Tap **Sign in with Google**. The dot at the top turns green when sync is on.
5. In Chrome, tap **⋮ → Install app** (or **Add to Home screen**). Shelfmark now opens like a normal app and works offline.

**Another device:** go to **Settings** and tap **Copy setup link**, then open the link on the other device and sign in. The link carries both your Firebase config and your Worker URL.

**One link for everything:** you can also build the setup link by hand:
```
https://itsmegarvi.github.io/shelfmark/#setup=<base64 of the firebaseConfig JSON>&fetcher=<Worker URL>
```
Either part is optional. The page saves both on the device, then removes them from the address bar.

**Fork only: skip the paste step.** Put your config into `firebase-config.js` in your fork:
```js
export const firebaseConfig = { apiKey: "…", authDomain: "…", projectId: "…", storageBucket: "…", messagingSenderId: "…", appId: "…" };
```
Every device then goes straight to **Sign in with Google**. Don't do this on the hosted repo: every user would end up on your Firebase project.

## Auto-fetch details
- **Tuned for:**
  - Asura: everything, including the word average.
  - WuxiaWorld: follows "Next chapter" links to sample chapters.
  - AO3: the exact word count.
  - NovelCodex: cover and details only. It's a tracker site, so there's no chapter text to count.
- **Any other site:**
  - The Worker reads the page's preview tags for the title and cover.
  - It then finds the chapter list or a "Start reading" link and follows "Next chapter" to count words.
  - If a site hides its chapters behind JavaScript or a bot check, you'll get the details but not the word average.
- **Privacy:** the Worker only ever returns details and word counts, never chapter text. To keep a site out, add it to `BLOCKED_HOSTS`.
- **Limits:** the free plan allows 100,000 requests a day. Sampling 20 chapters uses 5 requests.
- **Updating the Worker:** go to Cloudflare → **Edit code**, select all, paste the new `worker.js`, then tap **Deploy**.

## Notes
- The Firebase `apiKey` isn't a secret. The Firestore rules are what keep your data private to your account.
- **Sign-in problems:** if Google sign-in fails inside the installed app, sign in once in a normal Chrome tab, or use Email/Password. Also check that the app's domain is in **Authorized domains**.
- **Old version showing:** close the installed app fully and reopen it once or twice. **Settings** shows the version at the bottom.
- **Shipping changes on a fork:** bump `VERSION` in `app.js` and `CACHE` in `sw.js` so phones fetch the new files.
- **Deploy stuck (fork):** if **Actions** shows a failed *pages build and deployment* run that says another deployment is in progress:
  1. Open **Settings → Pages** and unpublish the site.
  2. Set Source back to `main` / `/ (root)`.
  3. Commit any small change, such as editing `.nojekyll`, to trigger a fresh deploy.

## Changelog
- **1.5.1:** the setup link also carries the Worker URL (`&fetcher=`). Added the hosted-vs-fork guide and `AGENTS.md`.
- **1.5.0:** a **▾** next to **+1** logs several chapters at once.
- **1.4.0:** works with any site, WuxiaWorld support, and new sources are added automatically.
- **1.3.0:** coloured status chips and links, plus a theme colour picker.
- **1.2.x:** auto-fetch with covers, and the setup link for new devices.
- **1.0:** library, logging, recap, history, Firebase sync and backup.
