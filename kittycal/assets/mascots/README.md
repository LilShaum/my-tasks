# Your own mascot artwork

Anything you put in this folder is **gitignored** — it stays on your machine and
never gets committed or pushed. Kittycal ships original mascot art for every
theme, so this folder is entirely optional.

## Two ways to use your own pictures

### 1. From your phone (easiest, recommended)

Settings → Themes → tap a theme → **Use your own picture**. Pick an image from
your camera roll, crop it, done. It's stored in your browser's local database on
that device only. Nothing touches this folder, nothing touches git, nothing
leaves the phone.

This is the one to use. It works on the device where you actually use the app.

### 2. From a computer (this folder)

Put your images in this folder, then add a `manifest.json` next to them listing
which file belongs to which theme:

```json
{
  "hellokitty": "kitty.png",
  "kuromi": "kuromi.webp",
  "cinnamoroll": "cinna.png"
}
```

Only include the themes you have art for — anything missing falls back to the
built-in emblem. The manifest exists so the app makes one request to find out
what you have, instead of guessing at a dozen filenames per theme and filling
your console with 404s.

The valid theme ids are:

```
hellokitty  mymelody   kuromi     cinnamoroll  keroppi
gudetama    twinstars  badtzmaru  chococat     pompompurin
aggretsuko  pochacco   hangyodon  plain
```

`.png`, `.webp`, `.jpg`, `.gif` and `.svg` all work. Square images around
512×512 look best, and a transparent PNG looks far better than a photo with a
background. Files here only apply to the copy of the app served from this
folder, so option 1 is still the better choice for her phone.

## A note on where art comes from

Kittycal's built-in mascots are original artwork. If you add third-party
character art here, that's a personal-use copy on your own device — keep it that
way. Don't commit it, don't push it, and don't redistribute the folder. That's
why this directory is gitignored by default, and why it should stay that way.
