<img src="assets/icon.svg" width="64" height="64" alt="">

# SPECIES.IO

A place to share your games. Paste a play link from **Spawn, GDevelop, Gear Zero, Unity, Godot, Playdrop, Ludo.ai, Tesana, Rosebud.ai, Refybe** (or anywhere else), or upload a web build, and it shows up as a playable card.

Plain HTML/CSS/JS — no build step, no backend.

## Run locally

```bash
python -m http.server 8000   # then open http://localhost:8000
```

(Serve over http — don't open `index.html` by double-click, or uploads and the catalog won't work.)

## Share a game

- **Paste a link** — the platform is auto-detected from the URL. Some platforms block embedding; the player has an "Open in new tab" button for those.
- **Upload a build** — a single `.html` file or a `.zip` web export containing `index.html`. Builds are stored in your browser (IndexedDB) and served by a service worker (`sw.js`).

## Publish on Git (so everyone sees it)

Games you add in the browser are private to you until you publish them. Click **Publish** on a game card:

- *Links:* add the generated entry to `data/games.json`.
- *Uploads:* download the package, unzip it into the repo (it lands in `games/<slug>/`), and add the entry to `data/games.json`.

Then `git add . && git commit && git push`.

### Host it on GitHub Pages

1. Push this repo to GitHub (branch `main`).
2. Repo **Settings → Pages → Source: Deploy from a branch → `main` / root**.
3. Set `repo` in `config.js` (`"owner/name"`) so the Publish dialog links straight to your repo.

## Catalog entry format

```json
{
  "id": "my-game",
  "title": "My Game",
  "platform": "godot",
  "type": "link",
  "url": "https://example.com/play/my-game",
  "author": "you",
  "description": "One or two sentences.",
  "cover": "https://example.com/cover.png",
  "added": "2026-11-15"
}
```

`type` is `link` (external URL) or `hosted` (a build in `games/<slug>/`). `platform` is one of `spawn, gdevelop, gearzero, unity, godot, playdrop, ludo, tesana, rosebud, refybe, other`.

## Notes

- Uploaded/hosted games run in a sandboxed iframe but on the site's origin, so only publish builds you trust.
- Created in [T3 Code](https://t3.codes).
