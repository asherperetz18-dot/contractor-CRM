# Getting the phone app into the App Store and Google Play

The app itself lives in `mobile/` (decision #074). What's left for the stores is two developer accounts, which only the owner can open: they need the company's identity and payment. After that, the builds run on GitHub. **No Mac is needed**: GitHub's Mac machines can build and upload the iPhone app.

## 1. Before either account: a D-U-N-S number (free)

Both stores want one to list the app under the company, **AI Build Pros LLC**, instead of a personal name. Look it up or request it at <https://developer.apple.com/enroll/duns-lookup/>. It's free, but it can take up to two weeks to arrive, so start here.

A personal account skips this step, but then the store shows your own name as the developer. And a new *personal* Google Play account must run a closed test with 12 testers for 14 days before it may publish. Organization accounts don't have to.

## 2. Apple Developer Program ($99 / year)

1. Enroll at <https://developer.apple.com/programs/enroll/> as an **Organization** with the D-U-N-S number. Approval takes a day to a couple of weeks.
2. Once approved, in **App Store Connect → Users and Access → Integrations → App Store Connect API**, create a key with the **App Manager** role. Download the `.p8` file (it can only be downloaded once) and note the **Key ID** and **Issuer ID**.
3. Add them as GitHub secrets. In the repo, go to **Settings → Secrets and variables → Actions → New repository secret**:
   - `APP_STORE_CONNECT_KEY_ID`
   - `APP_STORE_CONNECT_ISSUER_ID`
   - `APP_STORE_CONNECT_KEY`: the whole text of the `.p8` file
   - `APPLE_TEAM_ID`: from **Membership details** on developer.apple.com

   Never paste these into a chat or a PR.
4. Tell Claude it's done. The next step is a GitHub workflow that builds the iPhone app and sends it to **TestFlight**, Apple's test app, for installing on your iPhone before release.

## 3. Google Play Console ($25 once)

The account is open (2026-09-27). Everything below happens in Play Console, in the repo's GitHub settings, or on GitHub's Actions tab. You don't need Android Studio, Java, or a command line.

### 3a. Create the app in Play Console

**All apps → Create app.** Name: *AI Build Pros CRM*. Default language: English (US). Type: App. Free. Tick both declarations. The package name that gets locked in on the first upload is `com.aibuildpros.crm`, and it can never change.

### 3b. Make the upload key (once, ever)

Play accepts an update only if it is signed with the same key as the first upload, so this key is made one time. The repo is public, and anyone signed in to GitHub can download a workflow run's files and read its logs. So the key is locked with your password before it leaves GitHub's machine, and it is only ever stored locked.

1. **Make up a password of at least 20 characters.** Four or more random words works. Save it in your password manager: it is the only way to unlock the key.
2. **GitHub → the repo → Settings → Secrets and variables → Actions → New repository secret.** Name: `ANDROID_UPLOAD_KEYSTORE_PASSWORD`. Value: the password.
3. **Actions tab → "Android upload key (create once)" → Run workflow.**
4. When it's green, open the run and download **android-upload-key-locked** under *Artifacts*. Unzip it, open `ANDROID_UPLOAD_KEYSTORE.txt`, copy **all** of its text, and save it as a second secret named `ANDROID_UPLOAD_KEYSTORE`.
5. **Keep that zip with the password** (for example, attach it to the password-manager entry). The two together are the key's backup. Then **delete the artifact** on the run page (trash icon). It is locked, but it shouldn't stay public.

Never paste the password or the text file into a chat or a PR. If the key is ever lost, Play support can reset the upload key. Run the workflow again with *Replace* ticked only after they have. Without that tick, the workflow refuses to overwrite a key that already exists.

### 3c. Build a release

**Actions tab → "Android App (Play release)" → Run workflow**, on `main`. It builds from `main` only. When it's green, download **ai-build-pros-crm-play-N** from the run's *Artifacts*. The `.aab` file inside is what Play takes. Each run numbers the build itself (version code N, version 1.0.N), so Play never sees the same number twice.

You only need a new build when something *native* changes: a plugin, a permission, the icon, the Android version targeted. Ordinary CRM updates reach the app on their own, because the app opens the live site (decision #074).

### 3d. Upload it

**Test and release → Testing → Internal testing → Create new release.** On the first upload, Play offers **Play App Signing**: accept it. Google then keeps the key that signs what phones install, and our key only proves an upload came from us. Upload the `.aab`, add yourself as a tester, and install it from the opt-in link.

- **Personal account:** Play requires a *closed* test with at least 12 testers, opted in for 14 days in a row, before you can apply for production. Field staff with Android phones are the natural testers.
- **Organization account:** you can go to production once the test build looks right.

### 3e. Before sending it for review

These must be done first, or review is likely to fail:

1. **Hide signup and payment inside the app.** The login page's "Start an account" leads to a Stripe checkout for the CRM subscription. Google Play requires apps to sell their own subscriptions through Google Play Billing, so inside the phone app these links must not appear. The website keeps them. *(Not built yet. Ask Claude.)*
2. **Privacy policy page** (section 4). *(Not built yet. It needs a contact email to publish.)*
3. **Account deletion link.** Play asks every app with accounts for a web page where someone can ask to have their account and data deleted. It can be a section of the privacy page.
4. **A reviewer login.** The whole app is behind sign-in, so under *App content → App access* give Play a working login. Make it a Field-role user in a demo company with sample data, never a real account.

### 3f. Answers for Play's *App content* forms

- **Ads:** No.
- **Target audience:** 18 and over. It's a work tool.
- **Content rating:** fill in the questionnaire as a business/productivity app, with no violence, sexual content, gambling, or user-to-user sharing with the public.
- **Data safety**, as the app stands:
  - *Location, precise:* collected while clocked in, for app functionality. Not shared, not sold. Required for tracked roles.
  - *Personal info (name, email, phone):* collected for account management and app functionality.
  - *Photos and files:* collected when a user uploads job photos or documents, for app functionality.
  - Data is encrypted in transit: yes. Users can ask for deletion: yes (the page in 3e).
- **Location permissions:** the app asks for location only while in use and keeps it running through a foreground service (the "On the clock" notification). It never asks for "Allow all the time", so no *background location* declaration is needed.
- **Foreground service:** type *location*. Purpose: sharing the crew member's location with their employer while they are clocked in. Play asks for a short video: clock in, show the notification, clock out.

## 4. Both stores need a privacy policy page

The app reads location, so both listings require a public privacy-policy URL. It should cover what's collected (location while on the clock, hours), who sees it (the employer's office), how long it's kept (the company's trail retention, 90 days by default), and how to ask for deletion. Claude can add it as a public page on the CRM site.

## Already done

- The app, background location, and the "On the clock" notification (`mobile/`).
- The app icon and splash screen from the AI Build Pros logo (`mobile/assets/`, generated with `npx capacitor-assets generate`).
- An installable Android test build on every PR that touches `mobile/`: the **Android App (test build)** check. It also compiles the release bundle, so a PR can't break the Play build unnoticed.
- The signed Play build (**Android App (Play release)**) and the one-time key workflow (**Android upload key (create once)**), decision #086.
- The app targets Android 16 (API 36), which Play has required for new apps since 31 Aug 2026. On Android 15 and later, the CRM starts below the status bar instead of under it.
