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
