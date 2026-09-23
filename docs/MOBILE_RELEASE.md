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

1. Sign up at <https://play.google.com/console/signup> as an **Organization** with the D-U-N-S number.
2. Tell Claude when it's approved. The next steps are a signed release build from GitHub and the answers for Play's forms. Those forms cover the **Data safety** section (location is collected for app functionality and is not sold or shared) and the **foreground service** declaration (location while clocked in). Play asks for a short video of the clock-in flow for the latter.

## 4. Both stores need a privacy policy page

The app reads location, so both listings require a public privacy-policy URL. It should cover what's collected (location while on the clock, hours), who sees it (the employer's office), how long it's kept (the company's trail retention, 90 days by default), and how to ask for deletion. Claude can add it as a public page on the CRM site.

## Already done

- The app, background location, and the "On the clock" notification (`mobile/`).
- The app icon and splash screen from the AI Build Pros logo (`mobile/assets/`, generated with `npx capacitor-assets generate`).
- An installable Android test build on every PR that touches `mobile/`: the **Android App (test build)** check.
