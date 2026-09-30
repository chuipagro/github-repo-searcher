# Epitech Repo Search

A Chrome extension (Manifest V3) for quickly fuzzy-searching your Epitech GitHub repositories and browsing their files from a popup, without leaving the keyboard.

## Features

- **Fuzzy search** across every Epitech repo your token can see. `cpe 100` or `mysh` both find what you're looking for, and hits in the repo name rank above hits in the org name.
- **Automatic org discovery**: indexes your own repos, repos you collaborate on, and every repo of the orgs you belong to whose name matches the owner filter (`^Epitech` by default). You can also list extra orgs to scan.
- **File browser**: step into a repo and move through its folders, with a filter for the current directory and breadcrumb navigation.
- **Clone commands**: copy `git clone` with the SSH or HTTPS URL in one keystroke.
- **Local cache**: repos are stored in extension storage and refreshed automatically after a configurable delay, or on demand with the ⟳ button.
- **Remembers your last search**, and follows your system's light or dark theme.

## Installation

1. Clone this repository:
   ```sh
   git clone git@github.com:chuipagro/github-repo-searcher.git
   ```
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the cloned folder.
4. (Optional) Pin the extension to the toolbar.

It works in any Chromium-based browser (Chrome, Edge, Brave, Arc…).

## Setup

1. Open the extension's settings (the ⚙ button in the popup, or right-click the icon → **Options**).
2. [Create a **classic** personal access token](https://github.com/settings/tokens/new?scopes=repo,read:org&description=Epitech%20Repo%20Search) with the `repo` and `read:org` scopes.
   - Fine-grained tokens (`github_pat_…`) only see one owner's repos. Use a classic `ghp_…` token.
   - If an Epitech org enforces SSO, click **Configure SSO** next to the token on GitHub and authorize it for that org.
3. Paste the token and click **Save & sync**.

### Settings

| Setting | Default | Description |
| --- | --- | --- |
| GitHub personal access token | — | Stored only in your browser's local extension storage. |
| Owner filter (regex) | `^Epitech` | Only repos whose owner matches are kept. Use `.*` to keep everything. |
| Organizations to scan | *(empty)* | Extra orgs to index in full, separated by spaces or commas (e.g. `EpitechPromo2027 EpitechPromo2028`). |
| Auto-refresh after (minutes) | `60` | How long the repo cache stays valid before a background refresh. |

The **Diagnose** button shows your token type and scopes, the orgs you belong to, how many repos are visible per owner, and SSO or access errors for each org you've listed. Start there if repos are missing.

## Usage

Open the popup with **Alt+Shift+E** (change it at `chrome://extensions/shortcuts`) or by clicking the toolbar icon, then start typing.

### Search mode

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move the selection |
| `Enter` | Open the repo on GitHub |
| `Shift+Enter` | Open the repo in a background tab |
| `→` / `Tab` | Browse the repo's files |
| `Ctrl+Enter` (`⌘+Enter` on macOS) | Copy `git clone <ssh url>` |
| `Alt+Enter` | Copy `git clone <https url>` |
| `Esc` | Clear the search |

### Browse mode

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move the selection |
| `Enter` / `→` | Open the folder, or open the file on GitHub |
| `Shift+Enter` | Open the file in a background tab |
| `←` / `Backspace` | Go up one folder (from the repo root, back to search) |
| `Ctrl+Enter` | Open the current folder on GitHub |
| `Esc` | Clear the filter, or return to search |

Typing filters the current folder. Ctrl/⌘-click opens any row in a background tab.

## Project structure

```
manifest.json   Extension manifest (MV3): permissions, popup, options, shortcut
github.js       Shared helpers: settings, GitHub API calls, repo discovery and cache
popup.html/js   Search and file-browsing UI
popup.css       Popup styles (light and dark)
options.html/js Settings page and token diagnostics
icons/          Extension icons
```

There's no build step. Edit the files, then click the reload button on the extension card in `chrome://extensions`.

## Permissions and privacy

- `storage`: holds your settings, the repo cache and the last query.
- `https://api.github.com/*`: the only host the extension talks to.

Your token stays in `chrome.storage.local` and is only sent to the GitHub API. There's no telemetry and no third-party server.
