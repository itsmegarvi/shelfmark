# Shelfmark: phone-only setup (Android)

You need about 15 minutes, Chrome on Android, a GitHub account and a Google account. You don't need a laptop.

## 1. Put the files on GitHub Pages (hosting)
1. Download `webnovel-tracker.zip`. In the **Files** app, tap it, then tap **Extract**.
2. In Chrome, go to github.com and sign in. Tap ⋮ and check **Desktop site**, because the upload button only shows in desktop mode.
3. Tap **+**, then **New repository**. Name it `shelfmark`, make it **Public**, and tick **Add a README**. Create it.
4. Tap **Add file**, then **Upload files**, then **choose your files**. Select all 11 files from the extracted folder:
   `index.html app.js styles.css firebase-config.js sw.js manifest.webmanifest icon.svg icon-192.png icon-512.png firestore.rules README.md`
   Then tap **Commit changes**.
5. Open repo **Settings**, then **Pages**. Set Source to **Deploy from a branch**, set Branch to `main` with folder `/ (root)`, and tap **Save**.
6. Wait about a minute. Your app is at `https://<your-github-username>.github.io/shelfmark/`.

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
4. Tap the ⚙ icon and open **Project settings**. Under **Your apps**, tap the **</>** (Web) icon, enter the nickname `shelfmark`, and register. Skip Firebase Hosting.
   Copy the whole `const firebaseConfig = { … }` block.

## 3. Connect the app
1. Open `https://<your-github-username>.github.io/shelfmark/` and tap **Set up sync** at the top right.
2. Paste the config and tap **Save & connect**.
3. Tap **Sign in with Google**.
4. Tap ⋮ in Chrome and choose **Install app** (or **Add to Home screen**). Shelfmark now opens like a normal app and works offline.

**Another device:** go to Settings and tap **Copy setup link**, then open that link on the other device and sign in. You don't need to paste the config again.

## Notes
- The Firebase `apiKey` isn't a secret. The Firestore rules are what keep your data private to your account.
- If Google sign-in fails inside the installed app, sign in once in a normal Chrome tab, or use Email/Password.
- **Updating the app later:** upload the changed files to the repo, then change `CACHE` in `sw.js` (e.g. `v1.1.1`).
- **Backup:** Settings has Export JSON and Export CSV.

## Auto-fetch: cover, chapters and word count (optional, free)
A small Cloudflare Worker (`worker.js` in this repo) reads a novel's page and returns:

- the cover, title, author, genres, total chapters and status
- an average words-per-chapter, worked out by counting the first 10–30 chapters (you set how many)

Chapter text is never saved.

Supported sites:

- **Asura**: everything, including the word average
- **NovelCodex**: cover and details only. It's a tracker site with no chapter text to count.
- **AO3**: exact word count

### Set it up from your phone (about 5 min)
1. Go to dash.cloudflare.com and sign up for free.
2. Open **Compute (Workers)** → **Create** → **Start with Hello World**. Name it `shelfmark-fetch` and tap **Deploy**.
3. Tap **Edit code** and delete everything in the editor.
4. Open `worker.js` in this repo, tap **Raw**, select all and copy. Paste it into the editor and tap **Deploy**.
5. Copy the Worker URL, e.g. `https://shelfmark-fetch.<you>.workers.dev`.
6. In Shelfmark, go to **Settings → Auto-fetch**, paste the URL and tap **Save**, then **Test**.
7. Add a novel: paste its link, tap **⤓ Fetch info**, then **Save**.

If you host Shelfmark somewhere other than `itsmegarvi.github.io`, add that address to `ALLOWED_ORIGINS` at the top of `worker.js`.
To support another site, add it to `ALLOWED_HOSTS`. Generic chapter links (`.../chapter-12`) work on many sites.
The free plan allows 100,000 requests a day. Sampling 20 chapters uses 5 requests.
