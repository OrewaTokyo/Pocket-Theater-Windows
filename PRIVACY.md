# Privacy

Last updated: 26 November 2026

This page has two parts: the Windows app, and the phone app with its website, which the Windows app connects to. Both apply when you use the Windows app.

## Pocket Theater for Windows

**The Windows app talks only to your own phone.** There is no online account, no analytics, no ads and no tracking. The app sends nothing to the developer or to any online service.

### What the Windows app stores on your PC

| What | Details |
| --- | --- |
| Saved phones | The name you give each phone, its address on your network, and its certificate fingerprint, so the app can recognise it again. |
| Remembered sign-in | Only if you tick "Keep me signed in on this PC": your username and your password. The password is encrypted with Windows' own protection (through Electron's safe storage), so it can only be read by your Windows account. If Windows cannot encrypt it, the password is not kept at all. |
| Settings | The video player you chose, and that you accepted the Terms of Use, Privacy Policy and Security Policy, and when. |
| Where you stopped | For videos, the file name and the place where you stopped, so you can carry on later and see "Continue watching". It is kept for each phone, in the app's own storage on this PC. |
| Temporary files | "Open in Windows" saves the file to a temporary folder first. The app deletes that folder when it closes. Files you save with Save go where you choose. |

The app keeps these in its data folder for your Windows account (`%APPDATA%\Pocket Theater`). Remove a phone in the app to delete its saved sign-in. To remove everything, uninstall the app and delete that folder.

The phone's sign-in cookie is kept in memory only and is gone when you close the app.

### What leaves your PC

Only requests to the phone you chose, over your own network. When the phone uses HTTPS, the app checks that it shows the exact certificate you trusted before it sends anything, such as your password. No internet service is involved.

The app also runs a small server on your own PC (address 127.0.0.1) so the video player can read files from the phone. Only programs on this PC can reach it, and it needs a random key that changes every time the app starts.

The "Get VLC (free)" button opens the VideoLAN website in your browser, and only when you press it. If you pick an outside video player, the app gives it a link to that small server on your PC, never the phone's address or your password.

### Your controls in the Windows app

- Sign out (Account page): forgets the remembered password.
- Remove this phone (Account page or the phone list): forgets the phone and its sign-in.
- Back to automatic (Account page): forgets your chosen video player.

### Changes

If this changes, the new version replaces this file and the date above changes. The app asks you to accept the changed terms again the next time you open it.

# The phone app and its website

This part is the privacy policy of the Pocket Theater phone app, which the Windows app connects to.

**Pocket Theater keeps everything on your phone.** There is no online account, no analytics, no ads and no tracking. The app sends nothing to the developer or to any online service.

## What the app stores on your phone

| What | Details |
| --- | --- |
| Accounts | Each person's username, whether they are approved or turned off, when they asked to join, and when they accepted the Terms of Use and Privacy Policy. Passwords are never stored. Only a salted, scrambled form (PBKDF2-SHA256) is kept, and it cannot be turned back into the password. |
| Admin password | If you turn on the admin website, a scrambled form of the password you choose, and a counter of wrong tries. |
| PIN lock | If you turn it on, a scrambled form of the PIN and a counter of wrong tries. |
| Shared folders | The folder's name, the shelf you put it under (Series, Anime, Movies, Gaming and so on), and Android's permission link to the folder. The app does not copy your files. |
| HTTPS certificate | A certificate and key the phone makes for itself. The private key stays in Android's key store. |
| Settings | The switches and choices in Profile > Settings. |
| Dashboard totals | Three running numbers: total data sent, total requests, and total time awake. They hold no file names, no usernames and no addresses. |

These live only in memory and disappear when the theater closes or the app stops: who is signed in (with each browser's type, such as "Chrome on Windows", and its address on your network, which the Devices list shows you), who was active in the last 3 minutes, the hourly traffic chart, and the counters that slow down password guessing (which use a device's address on your network).

## What the app can see

Only the folders you pick with Android's folder picker, and only to read them. The app never uploads, edits, renames or deletes your files.

## What other people can see

- Someone you approve can browse and play everything in the folders you share. There are no separate permissions per person, so approve only people you trust.
- As the admin, you see usernames and sign-up requests on the phone. You never see anyone's password. A reset gives them a new one.
- People signed in to the website cannot see each other.

## What leaves the phone

Files and pages are sent to the devices of approved people over your own Wi-Fi or hotspot. No internet service is involved, and the website loads no outside fonts, scripts or trackers. The connection is encrypted with HTTPS, using a certificate the phone makes itself, so browsers warn the first time. If you turn HTTPS off, or it cannot start, the connection is plain HTTP and the sign-in page says so. See [SECURITY.md](SECURITY.md).

## Permissions, in plain words

| Permission | Why |
| --- | --- |
| Internet | Android requires it for any app that opens a network port. It is used only to run the website on your local network. |
| Wi-Fi state and network state | To find the phone's address for the link on the Dashboard. |
| Wake lock | To keep the theater running while people are watching. |
| Foreground service | To stay open with a notification, so Android does not close it. |
| Notifications | For the "theater is open" notice and sign-up request alerts. You can turn the alerts off in Settings. |
| Ignore battery optimisation | Only to ask Android to leave the theater alone. Android shows its own question and you decide. |

## Problem reports

If the app closes unexpectedly, or hits an error it recovers from, it saves a short report on the phone: the error text, the phone model and the Android version. It holds no files, usernames or passwords. The next time you open the app it offers to copy the report so you can send it yourself. It is never sent anywhere automatically.

## The camera and the QR scanner

If you use the admin website, the app opens the phone's camera to scan the QR code that the website shows. The scanner is built into the app: it runs on the phone, does not use Google Play services, and no picture or video is taken, saved or sent anywhere. The camera is only on while the scanner screen is open. Android asks for the camera permission the first time, and you can say no and type the code printed under the QR code instead.

## Cookies

The website sets one cookie, `pt_session`. It keeps you signed in for up to 14 days, can't be read by page scripts (HttpOnly), is not sent from other sites (SameSite=Strict), and is only sent over HTTPS when HTTPS is on (Secure). There are no tracking or advertising cookies.

## Backups

Android backup is turned off for this app, so accounts, the PIN and settings are not copied into cloud backups.

## Your controls

- Delete an account, turn it off, or reset its password: Profile > Admin tools > Accounts.
- Sign everyone out, or reset the Dashboard totals: Profile > Settings.
- Stop sharing a folder: Folders tab > tap the folder > Stop sharing. You can also move it to another shelf or rename it there.
- Turn off the PIN lock: Profile > Settings > Privacy and data.
- Make a new HTTPS certificate: Profile > Settings > Connection.
- Turn off the admin website, change its password, or end an open admin session: Profile > Settings > Admin website.
- Remove everything: clear the app's data in Android settings, or uninstall the app. This also removes the PIN, the accounts and the folder list.

## Changes

If this changes, the new version replaces this file and the date above changes.

## Questions

Open an issue on the project's GitHub page for anything that is not a security problem. For security problems, follow [SECURITY.md](SECURITY.md).
