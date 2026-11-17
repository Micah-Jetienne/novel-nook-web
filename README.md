# Novel Nook Web App

This folder is a static, installable web version of Novel Nook. It does not include the Mac library data. Each browser keeps its own copy in local storage.

## Put it online

Host the contents of this folder on any static web host that provides HTTPS. Publish only this folder; do not add novels.json or a personal backup file. The app needs no server-side database for separate device copies.

## Install on iPhone

The phone layout uses a five-tab navigation bar for Home, My Books, Reading, Plan, and More. More contains the remaining sections plus dropdown-list management and JSON/CSV/XLSX/XLSM import and export. The mobile layout keeps the same library, editing, reading, planning, and recommendation features as the desktop-width web app.


1. Open the hosted URL in Safari.
2. Tap Share, then Add to Home Screen.
3. Turn on Open as Web App, then tap Add.
4. Open Novel Nook and choose Import library in More. Select a JSON backup, CSV file, or .xlsx/.xlsm workbook from Files.

On the Mac, export a full JSON backup from Novel Nook and AirDrop it to the iPhone. Changes made on the iPhone stay in that browser; export a backup from the phone to move them back to the Mac.

JSON and CSV imports and exports are supported. The web app also imports .xlsx and .xlsm workbooks directly in the browser; macros are not run. Workbook import requires Safari 16.4 or later (or a browser with equivalent ZIP decompression support).

## Updated interface and recovery

Publish the complete folder, including `NovelTrackerUI.js` and `NovelTrackerUI.css`. The interface shares the desktop form, modal, filter, notification and accessibility foundations.

Importing a full backup offers two distinct choices: merge its book records while retaining current settings/history, or restore the complete backup. Restoration creates a local recovery copy first. Open More → Settings & shortcuts → Recover previous library to review that copy. Export a full backup when you need a separate file outside browser storage.

## iPhone 11 layout

The web-only mobile stylesheet supports 414 × 896 portrait and 896 × 414 landscape, with safe-area spacing for the notch and home indicator, 16px form text to prevent focus zoom, and 44px minimum primary touch targets. Navigation remains available in both orientations. Dialogs use the available viewport height and scroll internally; wide charts and tables scroll inside their own containers. Page zoom remains available.

The current web release includes the parchment theme, consolidated Stats and recommendation portfolio/lifecycle. Device libraries stay in browser storage and are not published with the app. After an update, close and reopen the Home Screen app or refresh Safari to load the new cached version.
