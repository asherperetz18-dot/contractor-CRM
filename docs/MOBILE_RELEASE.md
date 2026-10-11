# Getting the phone app into the App Store and Google Play

The app itself lives in `mobile/` (decision #074). Both developer accounts are open. The builds run on GitHub. **No Mac is needed**: GitHub's Mac machines build and upload the iPhone app.

## 1. Before either account: a D-U-N-S number (free)

Both stores want one to list the app under the company, **AI Build Pros LLC**, instead of a personal name. Look it up or request it at <https://developer.apple.com/enroll/duns-lookup/>. It's free, but it can take up to two weeks to arrive, so start here.

A personal account skips this step, but then the store shows your own name as the developer. And a new *personal* Google Play account must run a closed test with 12 testers for 14 days before it may publish. Organization accounts don't have to.

## 2. Apple Developer Program ($99 / year)

The account is open as an **Organization: AI Build Pros LLC** (team ID `7U97978GD3`). The bundle ID `com.aibuildpros.crm` is registered and the app exists in App Store Connect. Everything below happens on developer.apple.com, App Store Connect, the repo's GitHub settings, or GitHub's Actions tab. You don't need a Mac or Xcode.

### 2a. The API key ✅

Done: an App Store Connect **Team** API key with the **App Manager** role (*Users and Access → Integrations → App Store Connect API*), saved as four repository secrets (*Settings → Secrets and variables → Actions*):

- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_KEY`: the whole text of the `.p8` file, including the `BEGIN`/`END` lines
- `APPLE_TEAM_ID`: `7U97978GD3`

Never paste these into a chat or a PR. App Manager is enough: the workflows sign the app themselves instead of using Xcode's "cloud" signing, which would need an **Admin** key (decision #171).

### 2b. Make the signing certificate (once a year)

Every iPhone build is signed with an **Apple Distribution certificate**. GitHub makes it, Apple issues it, and it is stored locked with your password, the same way as the Android key.

1. **Make up a password of at least 20 characters** (four or more random words works) and save it in your password manager.
2. **GitHub → Settings → Secrets and variables → Actions → New repository secret.** Name: `IOS_SIGNING_PASSWORD`. Value: the password.
3. **Actions tab → "iPhone signing certificate (create once)" → Run workflow.**
4. When it's green, open the run and download **ios-distribution-certificate-locked** under *Artifacts*. Unzip it, open `IOS_DISTRIBUTION_CERTIFICATE.txt`, copy **all** of its text, and save it as a secret named `IOS_DISTRIBUTION_CERTIFICATE`.
5. **Keep that zip with the password** in your password manager, then **delete the artifact** on the run page (trash icon).

The certificate lasts a year. It shows in developer.apple.com → *Certificates* as "Apple Distribution", with the serial number in the zip's `certificate.txt`. When it expires, or if it is ever revoked, revoke the old one there and run the workflow again with **Replace** ticked. Without that tick the workflow refuses to make a second one, because Apple allows only a few per team. If a run fails after Apple issued the certificate but before the artifact was saved, revoke that certificate in developer.apple.com before running it again.

### 2c. Send a build to TestFlight

**Actions tab → "iPhone App (TestFlight)" → Run workflow**, on `main`. It builds from `main` only, and takes roughly 15 to 30 minutes. It:

1. installs the app's packages and syncs the Capacitor project,
2. unlocks the certificate into a keychain of its own,
3. reuses (or makes) the App Store profile **AI Build Pros CRM App Store** for `com.aibuildpros.crm`,
4. builds and signs the app (version **1.0.N**, build **N**, where N is the run number, so Apple never sees the same build twice),
5. uploads it to App Store Connect, and removes the keychain and key file.

It never submits anything for App Store review. If a secret is missing, the first step names it and stops.

Like Android, you only need a new build when something *native* changes: a plugin, a permission, the icon. Ordinary CRM updates reach the app on their own (decision #074).

### 2d. Install it from TestFlight

1. After the run is green, Apple processes the build for **5 to 30 minutes**, and emails the account when it's ready.
2. **App Store Connect → Apps → AI Build Pros CRM → TestFlight.** The build appears under *iOS Builds*.
3. **Internal testing** (no Apple review): under *Internal Testing* click **+**, make a group (for example *Team*), and add testers. Internal testers must be users of the App Store Connect account (*Users and Access*), up to 100. Turn on automatic distribution so each new build reaches the group.
4. Each tester installs **TestFlight** from the App Store on their iPhone, opens the invitation email (or the TestFlight app) with the same Apple ID, and taps **Install**. A TestFlight build works for 90 days.
5. *External testing* (people outside the account, up to 10,000 by link) needs a short Apple beta review of the first build and the test information Apple asks for. Not needed to start.

### 2e. Before the App Store (not yet)

- **A reviewer login**, same as Play (3e.4): a Field user in a demo company with sample data.
- **Background location:** Apple reviews `Always` location closely. The reason shown on the iPhone ("While you're clocked in, your location keeps being shared with the phone locked...") must match what the reviewer sees: clock in, lock the phone, and the Team Map keeps the dot moving.
- **Privacy:** App Store Connect's *App Privacy* answers are the same data as Play's Data safety (3f). The privacy policy and account deletion pages in section 4 cover Apple's rules too.
- **iPad:** the app runs on iPad too, so the listing needs iPad screenshots as well as iPhone ones.
- **Speaker button:** on iPhone the dialer has no Speaker button yet (decision #171); it needs a small Swift plugin like Android's. Test calls on the TestFlight build to see how the audio routes.

## 3. Google Play Console ($25 once)

The account is open (2026-09-27), as an **Organization: AI Build Pros LLC**. Everything below happens in Play Console, in the repo's GitHub settings, or on GitHub's Actions tab. You don't need Android Studio, Java, or a command line.

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

The account is an Organization, so Play's 12-tester, 14-day closed test (a rule for new *personal* accounts) doesn't apply. You can go to production once the test build looks right on a phone.

### 3e. Before sending it for review

1. ✅ **Signup and payment are hidden inside the app** (decision #087). Google Play requires apps to sell their own subscriptions through Google Play Billing. So inside the phone app, the sign-in page has no "Start an account", the lock screen has no "Renew subscription", and *Settings › Subscription* has no "Manage billing". The website keeps all three.
2. ✅ **Privacy policy:** <https://crm.aibuildpros.com/privacy>. Paste it into *App content → Privacy policy*.
3. ✅ **Account deletion:** <https://crm.aibuildpros.com/delete-account>. Paste it into *App content → Data deletion*. Deletion requests arrive at info@aibuildpros.com, and **the page promises they're done within 30 days**: deleting the person's sign-in, profile, and location trail. Work records stay with their company.
4. **A reviewer login.** *(Still to do.)* The whole app is behind sign-in, so under *App content → App access* give Play a working login. Make it a Field-role user in a demo company with sample data, never a real account.

### 3f. Answers for Play's *App content* forms

- **Ads:** No.
- **Target audience:** 18 and over. It's a work tool.
- **Content rating:** fill in the questionnaire as a business/productivity app, with no violence, sexual content, gambling, or user-to-user sharing with the public.
- **Data safety**, as the app stands:
  - *Location, precise:* collected while clocked in, for app functionality. Not shared, not sold. Required for tracked roles.
  - *Personal info (name, email, phone):* collected for account management and app functionality.
  - *Photos and files:* collected when a user uploads job photos or documents, for app functionality.
  - *Audio:* call recordings of calls made through the CRM, for app functionality.
  - *Messages:* texts and emails sent through the CRM, for app functionality.
  - *App activity (app interactions):* pages opened and active time, shown to the company's admins, for analytics.
  - *Device or other IDs:* a random device ID the CRM makes to tell a person's devices apart, for analytics.
  - *App info and performance (crash logs):* error reports, for app functionality.
  - Data is encrypted in transit: yes. Users can ask for deletion: yes (the page in 3e).
  - QuickBooks (DECISIONS #192) changes none of these. A company that connects its own QuickBooks has data sent there because it asked for that: customers' names, contact details and addresses, vendors, bills and lender fees (as expenses) with their receipt photos or PDFs, invoices and payments. No new kind of data is collected. The privacy page says so.
- **Location permissions:** the app asks for location only while in use and keeps it running through a foreground service (the "On the clock" notification). It never asks for "Allow all the time", so no *background location* declaration is needed.
- **Foreground service:** type *location*. Purpose: sharing the crew member's location with their employer while they are clocked in. Play asks for a short video: clock in, show the notification, clock out.

## 4. Both stores need a privacy policy page

✅ Built: <https://crm.aibuildpros.com/privacy>, with account deletion at <https://crm.aibuildpros.com/delete-account>. Both open without signing in, and they are linked from the sign-in page and the sidebar. The contact email and the 30-day promise live in `src/lib/app-store/legal.ts`. The location-retention default is read from the time-clock settings code, so the page can't drift from it. **When what the CRM collects changes, update the page and the Data safety answers in 3f together.**

## Already done

- The app, background location, and the "On the clock" notification (`mobile/`).
- The app icon and splash screen from the AI Build Pros logo (`mobile/assets/`, generated with `npx capacitor-assets generate`).
- The iPhone TestFlight workflow, the one-time certificate workflow, and an unsigned **iPhone App (test build)** check on every PR that touches `mobile/` (decision #171).
- An installable Android test build on every PR that touches `mobile/`: the **Android App (test build)** check. It also compiles the release bundle, so a PR can't break the Play build unnoticed.
- The signed Play build (**Android App (Play release)**) and the one-time key workflow (**Android upload key (create once)**), decision #086.
- The app needs Android 7 (API 24) or newer, which Play's automatic protection requires; it refused the first upload at API 23.
- The app targets Android 16 (API 36), which Play has required for new apps since 31 Aug 2026. On Android 15 and later, the CRM starts below the status bar instead of under it.
- The microphone, for calls from the CRM's dialer (decision #109). Android asks once, on the first call. The iPhone app says why it wants it. **Builds made before 2026-10-04 can't place calls: run a new Play release and upload it.**
- The dialer's Speaker button (decision #111), from the app's own `CallAudio` plugin. Builds made before 2026-10-05 simply don't show the button.
