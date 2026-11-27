# Security

Last updated: 26 November 2026

This page has two parts: the Windows app, and the phone app with its website, which the Windows app connects to.

## Pocket Theater for Windows

### Supported versions

Only the latest release (see the repository's Releases) gets fixes. Please update before reporting.

### Reporting a vulnerability

Please report problems privately, not in a public issue.

1. Open the repository's **Security** tab and choose **Report a vulnerability**.
2. Say what you found, the steps to repeat it, the app version (Account page, at the bottom) and your Windows version.

If you do not see that button, open a public issue that only asks for a private way to get in touch. Leave out all details of the problem. This is a personal project, so replies are best effort.

### What is protected

- **The phone's certificate is pinned.** The first time you add a phone, the app shows its certificate fingerprint and you compare it with the one on the phone (Profile > Settings > Connection). After you trust it, the app only talks to a server showing that exact certificate. A different certificate is refused before anything, such as your password, is sent. There are no click-through certificate warnings.
- **Saved passwords are encrypted.** A remembered password is encrypted with Windows' own protection (through Electron's safe storage), is only kept if you ask, and is not kept at all if Windows cannot encrypt it. If a remembered password stops working, the app forgets it and does not keep retrying, so it cannot get your account blocked.
- **The video address on your PC is private.** The small server that feeds the video player listens only on 127.0.0.1, needs a random key that changes every start, turns away requests that arrive under another host name, and serves nothing except the files and subtitles of the phone you are connected to.
- **The window is locked down.** It runs sandboxed with no access to files or programs. It can only ask the app for a fixed list of things, cannot open other web pages or navigate away, is not given the camera, location or similar permissions, and only runs scripts that ship with the app.
- **Files that can run programs are never opened for you.** Files such as `.exe`, `.bat`, `.ps1`, `.msi`, `.lnk` and `.js` can be saved but the app will not open them. File names from the phone are cleaned before they are used as Windows file names.
- **Outside players get a link to your own PC.** Never the phone's address and never your password.
- **Terms first.** The app does not connect to anything until you accept the Terms of Use. If you decline, it closes.

### Known limits

- **The app is not signed.** Windows may say the publisher is unknown. Only download the app from your own repository's Releases, where GitHub shows a SHA-256 checksum for each file.
- **Trust starts with you.** The fingerprint check only helps if you really compare it. If you continue without comparing, someone on your network could pretend to be the phone.
- **Plain HTTP is still possible.** If a phone runs without HTTPS, the app warns you and your password crosses the network unprotected.
- **Other programs running as you.** Windows protects a saved password from other Windows users and from someone copying the disk, but not from other programs running under your own account.
- **Programs you open from here are outside this app.** Video players and the program Windows uses to open a file have their own security.
- **No automatic updates.** Install new releases yourself.

### Build and release

- The app is built by GitHub Actions from this repository. The tests run first, then a Windows machine builds the app, and the result is published to Releases.
- The app is not signed with a code-signing certificate yet.

# The phone app and its website

This part is the security policy of the Pocket Theater phone app, which the Windows app connects to.

## Supported versions

Only the latest build from the `main` branch (see the repository's Releases) gets fixes. Please update before reporting.

## Reporting a vulnerability

Please report problems privately, not in a public issue.

1. Open the repository's **Security** tab and choose **Report a vulnerability**.
2. Say what you found, the steps to repeat it, the app version, and the phone model and Android version.

If you do not see that button, open a public issue that only asks for a private way to get in touch. Leave out all details of the problem. This is a personal project, so replies are best effort.

## What is protected

- **Encryption.** The website uses HTTPS (TLS 1.2 or 1.3) with a certificate the phone makes for itself. Its private key lives in Android's key store and cannot be read out. The old plain port (8080) only sends visitors to the secure one (8443). After the theater starts, the app opens a test connection to itself, and if the secure handshake does not work it falls back to plain HTTP and shows a warning on the Dashboard. Session cookies are marked Secure while HTTPS is on.
- **Admin website (off by default).** If you turn it on in Settings, you can open admin tools (stats, sign-up requests, accounts, devices) in a browser on another device. On the website you tap Admin sign-in and it shows a QR code. You scan that code with the scanner built into the app and type the admin password on the phone, and the website then opens as admin by itself. (You can also start from the phone: pick the device in Settings and its screen shows the code.) The phone shows which device and account the code belongs to before it asks for the password. The password and the code are only ever checked on the phone, never over the network, so there is nothing for a stranger to guess. It works only over HTTPS, only for that one browser, closes after 30 minutes without use (4 hours at most), and can be ended from the phone at any time. It cannot change shared folders, settings, the PIN or the certificate, and it cannot change your own account.
- **Accounts.** Nobody gets in until the admin approves them on the phone. Approving, turning off, deleting and password resets are done on the phone, or on the admin website described next, which only the phone can open.
- **Passwords.** Stored only as a salted PBKDF2-SHA256 hash (310,000 rounds for new passwords, 120,000 for older ones). Very common passwords, one repeated character and a password equal to the username are refused. Sign-in sessions are random cookies (HttpOnly, SameSite=Strict) that last up to 14 days and end when the theater closes. Resetting a password, turning an account off, deleting it, or "Sign everyone out" ends the affected sessions at once.
- **Guessing.** After 8 wrong sign-in tries from one device, it must wait 10 minutes. Sign-up requests are limited per device, and at most 20 can be waiting.
- **Files.** Read-only. Only folders picked with Android's folder picker are reachable, and `..` paths and hidden files are refused. File names are shown as plain text on the page. Web pages and scripts inside a shared folder (`.html`, `.xml`, `.js` and similar) are only ever offered as a download and never run on the site, and an SVG picture gets no scripts when opened on its own.
- **Page rules.** Every page carries a Content-Security-Policy that only allows scripts, styles and media from the site itself, and cannot be put in a frame from another site.
- **App lock.** An optional 4 to 6 digit PIN, stored scrambled, with a growing wait after every 5 wrong tries. An option hides the app in recent apps and blocks screenshots.
- **Backups.** Android backup is off, so secrets are not copied to cloud backups.

More detail is in [the phone app's threat model](https://github.com/OrewaTokyo/Pocket-Theater/blob/main/docs/security/threat-model.md).

## Known limits

- **The certificate is self-signed.** Browsers warn the first time, and again whenever the phone's address changes, because the phone cannot get a certificate from a public authority for a private address. The warning is only useful if you compare the fingerprint shown in the browser with the one in Profile > Settings > Connection (or in the QR code window), and continue only when they match. If you click through without checking, someone on your network could pretend to be the phone.
- **Plain HTTP is still possible.** If you turn HTTPS off, or it cannot start, the theater runs without encryption and the sign-in page says so. Do not reuse a password from anywhere else.
- **The PIN is a door lock, not encryption.** It stops someone who picks up your phone. It does not protect against someone who copies the phone's storage.
- **The admin is whoever holds the unlocked phone.** Keep the PIN on and the phone locked.
- **The admin website opens the admin tools to a browser.** While it is open, anyone using that browser can approve people, reset passwords and delete accounts. Only pair your own device, and end it when you are done. Anyone signed in can make the website show a QR code, so look at the device and account the phone names before you type the password, and refuse if it is not yours. The scanner is built into the app and uses the camera only while its screen is open; if the camera is not allowed, type the code instead.
- **Approved people see every shared folder.** There are no per-person permissions yet.
- **No hard limit on connections.** A device on your network that opens many connections at once could slow the phone down. Requests nobody answered for a week are dropped so sign-up places do not stay full.
- **Password resets are handed over by you.** The phone shows the new password and you pass it on.

## Staying safe

- Give your hotspot a strong WPA2 or WPA3 password.
- Compare the certificate fingerprint the first time you connect from a new device.
- Never forward ports 8080 or 8443 on your router to the internet. The theater is meant for your own network only.
- Approve only people you know, and turn off new sign-ups in Settings when you do not need them.
- Share only the folders people need.
- Turn on the PIN lock.

## Build and release

- APKs are built by GitHub Actions from this repository as release (not debug) builds and published with a SHA-256 checksum file. The Kotlin and JavaScript tests run first. Only install APKs from your own repository's Releases.
- Every build is signed with one permanent key, so updates install over each other. The key is kept in the repository's secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`) and must never be committed.
- Before a build is published, a check confirms the APK's package name, version, permissions, that it is not debuggable, and that it is signed with that exact key.
- If you think the phone's HTTPS certificate was copied, use Make a new certificate in Settings.
- If the app signing key ever leaks, make a new one. After that, each phone has to uninstall the app once.

## Out of scope

Attacks that need an unlocked phone, a rooted phone, or the admin's own approval. Weaknesses in Android itself. Problems that only exist on a network you do not control.
