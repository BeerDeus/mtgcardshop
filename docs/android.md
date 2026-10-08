# Mana Orbit sur Android (Capacitor)

The `android-app/` folder holds the Android app. It is a native shell that opens https://card.m2s-photo.fr and adds what a browser can't do:

- the native camera for scanning, smooth like Snapchat;
- later: AdMob ads, Firebase Cloud Messaging notifications, and the home-screen widget.

Every website update reaches the app instantly. You only rebuild the app when the native part changes (plugins, icons, permissions).

## 1. Install (once)

1. **Node.js 22 LTS**: https://nodejs.org (the "LTS" button, keep the default options).
2. **Git**: https://git-scm.com/download/win (default options).
3. **Android Studio**: already installed. On first launch, accept the SDK it suggests downloading.

Check in a terminal (Windows: "Terminal" or "PowerShell"):

```bash
node -v      # v22.x
git --version
```

## 2. Get the project

```bash
git clone https://github.com/BeerDeus/mtgcardshop.git
cd mtgcardshop/android-app
npm run setup          # installs Capacitor and its plugins, then prepares the Android project
npm run open           # opens the project in Android Studio
```

If `npm run open` can't find Android Studio: in Android Studio, use **File › Open** and choose the `mtgcardshop/android-app/android` folder.

The first Gradle sync takes a few minutes, because it downloads its dependencies.

## 3. Try it on your phone (Xiaomi 14)

1. On the phone: **Settings › About phone**, then tap **OS version** 7 times. This unlocks the developer options.
2. **Settings › Additional settings › Developer options**: turn on **USB debugging** and **Install via USB**. Xiaomi asks you to sign in to your Mi account for this.
3. Connect the phone over USB and accept the "Allow USB debugging" prompt.
4. In Android Studio, choose your phone in the device list at the top, then press **Run ▶**.

The app opens Mana Orbit. Scanning cards then uses the native camera, with text recognized on the phone by ML Kit. In a browser or the installed PWA, the scan works as it does today.

## 4. Publish on the Play Store

### Build the signed bundle

In Android Studio: **Build › Generate Signed App Bundle or APK › Android App Bundle**, then **Create new…** to create the signing key (keystore).

**Keep the `.jks` file and its passwords safe** (password manager, plus a backup copy). Without them, you can never update the app again.

Choose **release**. You get `android/app/release/app-release.aab`.

### Play Console (play.google.com/console)

1. **Create app**: name "Mana Orbit", app (not game), free.
2. **Store listing**:
   - short and full description;
   - 512×512 icon: `pwa/icons/icon-512.png`;
   - 1024×500 feature graphic;
   - at least 2 phone screenshots.
   - Don't put "Magic: The Gathering" in the title.
3. **App content**:
   - Privacy policy: `https://card.m2s-photo.fr/privacy`
   - Account deletion: `https://card.m2s-photo.fr/?delete-account`
   - Ads: "No" for now. Switch to "Yes" when AdMob is added.
   - Data safety:
     - email address (account, optional);
     - collection and decks (account, optional);
     - no data shared;
     - encrypted in transit;
     - deletion possible.
   - Target audience: 13 and over.
   - Content rating: fill in the questionnaire (no sensitive content).
4. **Tests › Internal testing**: upload the `.aab` and add your email address. You install the test version from the link Google gives you.
5. If your developer account is a **personal account created after November 2023**, Google requires a **closed test with at least 12 testers for 14 days** before production. Your testers sign up through a link.

### Updates

- **Website** (most changes): pushing to `main` is enough. The app shows the new version on its next launch.
- **Native part** (plugins, icons, permissions):
  1. In `android-app/android/app/build.gradle`, increase `versionCode` by 1 and update `versionName`.
  2. Run `npm run sync`.
  3. Build a new signed bundle and upload it to the Play Console.

## 5. Next native steps (already planned)

| Feature | Plugin | Notes |
| --- | --- | --- |
| Native scan | `@capacitor-community/camera-preview` + `@pantrist/capacitor-plugin-ml-kit-text-recognition` | installed; detected by the site (`Capacitor.isNativePlatform()`) |
| Ad banner | `@capacitor-community/admob` | AdMob account + app ID; consent (UMP) in Europe |
| Notifications | `@capacitor/push-notifications` | Firebase Cloud Messaging (`google-services.json` from the Firebase console) |
| Google sign-in | `@capacitor-firebase/authentication` | Google blocks its sign-in window inside apps; email/password works already |
| Widget (collection value) | native Kotlin code | reads the value that the app leaves for it |

## Option: let Claude do it on your PC

Claude Code can work directly on your computer: the desktop app (claude.ai/download) or the terminal (`npm install -g @anthropic-ai/claude-code`, then `claude` in the `mtgcardshop` folder).

A session opened there can run all of the commands above itself (npm, Gradle, emulator). You only approve each action. The phone connection (USB debugging) and signing in to the Play Console stay with you.
