# Pocket Theater for Windows

A Windows app for [Pocket Theater](https://github.com/OrewaTokyo/Pocket-Theater). It does what the phone's
website does (browse the shared folders, play videos with subtitles, view pictures and PDFs, sign in or ask for
access, open the admin page), and adds what a website cannot do. The phone does not change: this app talks to the
same server the website uses.

**Status: prototype (0.3).** It has the website's features plus the extras below. It has not been run on a real
Windows PC yet, only tested against a pretend phone (see Tests).

## What the app adds over the website

| | Website | This app |
|---|---|---|
| Certificate warning on every browser | yes | **never**: the app remembers the phone's exact certificate |
| Signing in | each time the session ends | **stays signed in** (password stored with Windows' own encryption) and signs in again by itself |
| Several phones | one address per tab | a saved list of phones |
| Videos the browser can't play (HEVC, many MKV/AC3) | stuck | **Play in player**: finds VLC, MPC-HC, PotPlayer, mpv and others installed on the PC and lists them (or browse for one) |
| Saving files | browser downloads | save dialog, progress, cancel, "Show in folder" |
| Documents and other files | download only | **Open in Windows** (uses the program Windows picks) |
| Continue where you stopped | no | yes, and "Continue watching" on the home page |
| Next episode | no | plays the next one automatically |
| Connection drops | page breaks | the app asks the phone for the rest from the same byte, so playback and downloads carry on; a banner shows only if the phone is really gone |
| Smooth playback | none | a 96 MB read-ahead buffer absorbs Wi-Fi dips; press **I** in the viewer for details (Wi-Fi speed vs what the video needs, buffer, dropped frames) |

## Terms, privacy and security

The first time the app opens (and again whenever these documents change) it asks you to accept the
[Terms of Use](TERMS.md), which include the [Privacy Policy](PRIVACY.md) and the [Security Policy](SECURITY.md).
**Accept** opens the app. **Decline** closes it, and it asks again next time. Nothing else in the app works
until you accept, and that is enforced in the engine, not only in the window.

The documents are copied from the phone app and extended with a "Pocket Theater for Windows" section that says
what the Windows app stores and protects. They are in this repository ([TERMS.md](TERMS.md),
[PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), [AUTHOR.md](AUTHOR.md)) and are shipped inside the app
(Account page, About and legal).

## How it connects

1. You type the phone's address (for example `192.168.1.20`). The app finds the phone's secure port.
2. It shows the certificate **fingerprint**. You compare it with the one on the phone
   (Profile, Settings, Certificate fingerprint). If it matches, you trust it once.
3. From then on the app only talks to a server that shows that exact certificate. A different certificate is
   refused **before** anything, such as your password, is sent. If you renew the certificate on the phone, remove
   the phone in the app and add it again.
4. Videos, pictures and PDFs reach the player through a tiny local address (`127.0.0.1`, only on this PC, with a
   random key that changes on every start), so the player never needs to know about certificates or sign-in.

The window itself can only ask the app for a fixed list of things (see `src/preload/preload.js`), has no access
to files or programs, and cannot open other web pages. Files that can run programs (`.exe`, `.bat`, `.ps1` ...)
can be saved but are never opened by the app.

## Get the Windows program (no PC needed)

Everything is built by GitHub, the same way as the Android app.

1. Create a new repository, for example `Pocket-Theater-Windows`.
2. Add the two workflow files by hand (GitHub: Add file, Create new file, type the path, paste, commit):
   - `.github/workflows/unpack-app.yml`
   - `.github/workflows/build-windows.yml`
3. Upload `app.zip` to the root of the repository. It is unpacked automatically and the build starts.
4. After a few minutes the **Releases** page has two programs:
   - `PocketTheater-Portable-0.3.0.exe`: one file, runs without installing.
   - `PocketTheater-Setup-0.3.0.exe`: installs like a normal program.

Windows may say "unknown publisher" the first time, because the app is not signed with a paid certificate.
Choose More info, then Run anyway.

## Run it from source (on a PC)

```
npm install
npm start          # the app
npm run mock       # a pretend phone to try it without a real one (demo / theater-demo-1)
npm test           # tests the engine
npm run dist       # builds the Windows programs into dist/
```

## Project layout

```
src/main/        the engine (Node): connection.js (pinned TLS, session, monitor), proxy.js, handlers.js,
                 store.js, files.js, players.js, main.js (Electron)
src/preload/     the only door between the window and the engine
src/renderer/    the window: index.html, styles.css, js/ (connect, shell, pages, viewer, admin, account ...)
tests/           run-tests.js (engine), ui-smoke.js (whole window, needs Playwright), mock-phone.js
```

## Tests

`npm test` runs 48 checks of the engine against a pretend phone that speaks the same web API: certificate
pinning (an impostor with another certificate gets no request at all), sign-in, automatic re-sign-in, Range
streaming, recovery from dropped connections (playback and downloads), cancelling, finding installed players, the Terms of Use gate, the connection monitor, admin pairing, and safety rules.
`node tests/ui-smoke.js` drives the real window in a headless browser and saves screenshots.

## Next steps

- Find the phone by itself on the Wi-Fi (the phone could announce itself; today you type the address).
- Sign the program so Windows does not warn.
- Move more work into the app and trim the server: playlists, search across folders and watch history can all
  live in the app. The server then only needs sign-in, the folder list, the file stream and the admin actions.
- Optional one-line phone change: `DeviceLabel.kt` could recognise `PocketTheaterWindows` so the admin's Devices
  list says "Pocket Theater app" instead of "Browser on Windows".

Licensed under Apache-2.0, like the phone app.
