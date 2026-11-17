# Galaxy OPS: LCARS-style home screen for Samsung Galaxy

A full-screen, LCARS-inspired interface for Galaxy phones and tablets. It's a single
HTML file with no build step and no dependencies. It installs to the home screen as a
web app, opens with no browser bars, and works offline after the first load.

## Panels

| Panel | What it does |
|-------|--------------|
| **01 OPS** | Big clock, stardate, battery, network, uptime, quick-launch pills, RED ALERT, full screen |
| **02 COMMS** | Phone, SMS, email, contacts and messaging app launchers, plus a "hail" box to call, text or email any number or address |
| **03 SYSTEMS** | Live battery and charging status, CPU cores, RAM, display, storage, network type, downlink, latency, FPS bar graph |
| **04 NAV** | Compass from the phone's sensors, GPS position, and a button to open the position in Maps |
| **05 LOG** | Personal log with stardates (voice dictation supported), saved on the device |
| **06 CONFIG** | Chirp sounds, haptics, keep-screen-awake, colour schemes (Classic, Azure, Bronze), and add/remove quick-launch slots |

Every button chirps and vibrates. RED ALERT turns the whole frame red, flashes it, and
sounds a repeating klaxon.

## Android app (APK): real launcher

`android/` is a native Android app that wraps the same `index.html` in a
full-screen WebView and adds launcher powers:

- **Set as your Home screen.** Pressing Home opens the LCARS screen.
- **07 APPS panel** lists every installed app, with search. Turn on **PIN MODE**
  and tap an app to add it to OPS quick launch.
- Quick-launch and COMMS buttons open apps directly, including `tel:`, `sms:`,
  `intent://` and `app:<package>` links.
- Native GPS, vibration, battery, keep-awake and voice dictation for the log.
- Back returns to OPS. As the home screen it never exits.

### Get the APK

GitHub Actions builds it on every push that touches this folder
(`.github/workflows/lcars-galaxy-apk.yml`):

1. On your phone, open the repo's **Releases** page and find the newest **Galaxy OPS 1.0.N**.
2. Tap `GalaxyOPS-1.0.N.apk`. When Android asks, allow your browser to install unknown apps.
3. Open Galaxy OPS, go to **06 CONFIG → LAUNCHER → SET AS HOME SCREEN**, pick Galaxy OPS, and tap Home.

To go back to Samsung's launcher: Settings → Apps → Choose default apps → Home app → One UI Home.

The APK is also attached to each Actions run as the `GalaxyOPS-apk` artifact.

### Signing

Builds are signed with `android/app/galaxyops-debug.keystore`, a sideload-only key
committed on purpose (password `android`). Because every build uses the same key, a
new APK installs over the old one and keeps your log and settings. That key is public,
so don't use it for anything you publish to the Play Store.

To sign with your own private key instead, add these repo secrets. The workflow
picks them up automatically:
`GOPS_KEYSTORE_BASE64` (output of `base64 -w0 your.keystore`), `GOPS_KEYSTORE_PASSWORD`,
`GOPS_KEY_ALIAS`, `GOPS_KEY_PASSWORD`. Switching keys means uninstalling the old
build once.

### Build locally

Needs JDK 17 and the Android SDK (Android Studio installs both):

```bash
cd projects/lcars-galaxy/android
gradle assembleRelease      # APK in app/build/outputs/apk/release/
```

Or open the `android/` folder in Android Studio and press Run.

## Put it on your Galaxy as a web app

The app needs HTTPS to install (localhost also works for testing). The easiest free
option is GitHub Pages:

1. Host this folder (GitHub Pages, Netlify, or any HTTPS web server).
2. On the phone, open the URL in **Samsung Internet** or **Chrome**.
3. Open the menu, then **Add page to → Home screen** (Samsung Internet) or **Install app** (Chrome).
   You can also use the **Install to home screen** button under CONFIG.
4. Launch it from the new icon. It opens full screen.

### Make it feel like the real launcher
- Drag the icon onto the dock or the first home-screen page.
- Settings → Display → Navigation bar → **Swipe gestures** gives you more room for the frame.
- Use a black wallpaper so it blends in during app transitions.
- CONFIG → **Keep screen awake** turns it into a bridge console on a charging stand or a Galaxy Tab.

A web app can't replace One UI Home as the system launcher. The APK above can.

## Quick-launch links

Each slot is just a link, so anything works:

- `tel:`, `sms:`, `mailto:`, `geo:0,0?q=coffee`
- `https://` (any website or web app)
- Android intents, for example
  `intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.APP_CALENDAR;end`
  or a specific app by package:
  `intent://#Intent;package=com.sec.android.app.camera;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;end`

How intent links behave depends on the browser and the app. If one won't open, swap
in the app's package name or an `https://` link.

## Run locally

```bash
cd projects/lcars-galaxy
python3 -m http.server 8080   # then open http://localhost:8080
```

## Next steps (optional)
- Show notification counts and widgets in the APK.
- Add weather, calendar or notification panels.

Visual style is a fan homage to the LCARS look. No logos or other assets are included.
