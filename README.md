# ReturnPoint

**Pick up where you left off.**

ReturnPoint is a Chrome extension for saving a webpage's reading position and an optional note. Click **Resume** once to open the page in a new tab, return to approximately the saved position, and view your note in the side panel.

Saved URLs, positions, and notes stay in your browser profile. No account or backend is required.

## Preview

![ReturnPoint interface preview 1](screenshots/return-point%20ss1.png)

![ReturnPoint interface preview 2](screenshots/return-point%20ss2.png)

![ReturnPoint interface preview 3](screenshots/return-point%20ss3.png)

## Features

- Save reading progress and notes manually, with one entry per exact URL.
- Resume in one click, with visible loading, success, and error states.
- Browse Active and Completed entries, sorted by most recent update.
- Edit notes and update progress from the matching active webpage.
- Complete, reactivate, or delete entries with a deletion confirmation.
- Keep saved entries across panel closures, tab closures, and browser restarts.

## Technology

Vanilla TypeScript, HTML, and CSS; Chrome Extensions Manifest V3; the Side Panel, Tabs, Scripting, and Storage APIs; Vite for builds; and Vitest for unit tests. The extension has no runtime dependencies.

## Getting started

Use **Node.js 24** for development and **Chrome 116 or later** to load the extension.

From the repository root:

```sh
npm ci
npm run build
```

On Windows PowerShell, use `npm.cmd` if the execution policy blocks `npm.ps1`.

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the generated `dist/` folder.
3. Pin ReturnPoint from the Extensions menu, then click its toolbar icon to open the panel.

The build checks TypeScript, bundles the extension, and verifies the manifest's entry points and panel assets. After changes, rebuild, reload the extension on `chrome://extensions`, and reopen the panel.

## Usage

1. Open an ordinary HTML article or documentation page and scroll to a stopping point.
2. Click **Save Reading Position** in ReturnPoint and allow access to that website if prompted.
3. Add an optional note and click **Save ReturnPoint**. The position is captured again on this final click.
4. Return to the library later and click **Resume**. A new tab opens, the global side panel remains available, and the note appears beside the page.
5. Click **Update Progress** after reading further. The active tab must have the exact saved URL, including its query string and fragment. Notes can be edited without opening the saved page.
6. Use **Mark Completed**, **Move to Active**, or **Delete** to manage the entry.

Saving the same URL updates its existing entry and returns it to Active. Saving and updating are always manual.

## Architecture

The side panel handles the interface; a Manifest V3 service worker coordinates commands, navigation, and storage writes.

When Resume is clicked, the worker creates a blank tab and records the pending operation in `chrome.storage.session` before navigating. A `tabs.onUpdated` listener waits for load completion, and a tab re-check handles pages that load immediately. Session records allow a restarted worker to recover pending operations.

The injected restore function calculates the target from the saved progress ratio and the current scrollable height. It makes up to six layout checks before reporting success or failure. Library mutations are serialized to prevent concurrent saves from losing entries or creating duplicates.

## Permissions and privacy

| Permission | Purpose |
| --- | --- |
| `sidePanel` | Display the global reading library and saved notes beside webpages. |
| `storage` | Persist entries in `storage.local` and pending resumes in `storage.session`. |
| `tabs` | Read page titles and URLs, open tabs, and detect load completion. |
| `scripting` | Capture and restore the document's scroll position on demand. |
| Optional `http://*/*`, `https://*/*` | Request access to the individual website being saved or resumed. |

Website access is checked before use and requested from a button click when needed. The optional host patterns grant no website access on installation; a requested grant covers that scheme and host, including its paths and ports. Denied or revoked access produces a visible error.

The extension does not automatically record browsing activity or scroll changes. Notes and titles are rendered as text. The extension has no analytics or cloud sync. Local storage is restricted to trusted extension contexts. Uninstalling the extension or deleting its browser profile removes the library; deleting an entry does not revoke its website grant.

## Project structure

```text
public/manifest.json       Extension configuration and permissions
sidepanel.html             Side panel entry point
src/
  background.ts            Chrome listeners and command handling
  chrome-api.ts            Tab access, permissions, and script injection
  messages.ts              Typed panel/worker messages
  models.ts                Entry types, validation, and sorting
  storage.ts               Local library operations
  urls.ts                  URL validation and host patterns
  scroll.ts                Scroll calculations
  page-scripts.ts          Injected capture and restore functions
  resume.ts                Resume state and navigation recovery
  sidepanel.ts             Library, save/edit, and resume views
  styles.css               Panel styles
tests/                     Unit tests and Chrome API mocks
demo/                      Scrollable local article
scripts/                   Build verification and browser smoke test
vite.config.ts             Extension build configuration
vitest.config.ts           Unit test configuration
tsconfig.json              Strict TypeScript settings
package.json               Commands and dependency declarations
package-lock.json          Locked dependency versions
dist/                      Generated extension; excluded from Git
```

## Development and testing

| Command | Purpose |
| --- | --- |
| `npm run build` | Type-check, build, and verify the extension output. |
| `npm run typecheck` | Check source and test types without emitting files. |
| `npm test` | Run the Vitest unit suite. |
| `npm run test:watch` | Run unit tests in watch mode. |
| `npm run demo` | Serve and open the local demo article. |
| `npm run test:browser` | Run the optional browser smoke test after building. |

Unit tests cover scroll geometry, layout retries, exact-URL updates, notes, status changes, deletion, storage errors, permissions, navigation races, and recovery from worker restarts using mocked Chrome APIs.

The browser smoke test uses an isolated profile, a local article, and a copy of the extension with a test-only localhost grant. It checks the UI and actual scroll restoration, plus progress updates, completion, and deletion. On Windows it defaults to Microsoft Edge; set `RETURNPOINT_BROWSER` to another compatible browser executable to override it. Screenshots and test profiles are written to the ignored `.browser-test/` directory.

The automated smoke test has passed in headless Microsoft Edge. It opens the panel document in a tab, so native side-panel persistence, permission prompts, and persistence across a full browser restart still require manual testing in Chrome.

### Manual workflow

Run `npm run demo` and open [the local article](http://127.0.0.1:5173/demo/). Keep the demo server running throughout the test.

1. Build and load the extension, scroll to roughly chapter five, and save a note and position.
2. Close the article and restart Chrome. Open ReturnPoint and confirm the entry remains in Active.
3. Click **Resume once**. Check that a new tab opens near the saved chapter, the panel stays open, and the full note appears.
4. Scroll further and update progress. Switch to a different URL and check that updating is disabled with an explanation.
5. Edit the note, mark the entry Completed, and move it back to Active.
6. Try both cancelling and confirming deletion. Also check denied website access and an unsupported URL such as `chrome://settings`.

## Limitations

- Restoration is approximate. Changed content or late layout shifts may move the original reading location.
- Only ordinary HTML pages that scroll in the main document are supported. PDFs, browser pages, local files, incognito pages, infinite feeds, nested scroll containers, and complex single-page apps are outside the MVP.
- A redirect to another website requires access to that destination before restoration can succeed.
- Pending resume state resets on extension reload or browser restart. Saved entries remain; click Resume again if navigation was interrupted.
- Data is local to one browser profile and subject to Chrome's storage quota. There is no export, backup, or cross-device sync.

## Future improvements

Text anchors for changed pages, library search, and optional export/import.
