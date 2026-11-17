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

## Put it on your Galaxy

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

A web app can't replace One UI Home as the system launcher. That would need a native
Android APK; see "Next steps" below.

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
- Wrap it in a native Android "Home" app (a WebView with the `HOME` intent category) so
  it can be set as the default launcher and list installed apps.
- Add weather, calendar or notification panels.

Visual style is a fan homage to the LCARS look. No logos or other assets are included.
