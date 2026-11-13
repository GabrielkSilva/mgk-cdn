# Adding assets

Everything under `assets/` is published as-is. The build never transforms files - it
only reads them and writes indexes. So the contract is: **if it is in `assets/`, it is
on the CDN.**

## Layout rules

```
assets/<group>/<category>/<file>
assets/<group>/<file>            # ok when a group has no subcategories
```

- `group` is the format family: `icons`, and later `models`, `audio`, `textures`, `fonts`.
  Do not mix formats in one group.
- `category` is the free-form subject folder (`Weapons`, `Town & City`, `UI`, ...).
  New folders are picked up on the next deploy, no config needed.
- Keep filenames human-readable. Spaces and accents are fine - the index emits
  percent-encoded URLs for you.

## Adding a new group (3D, audio, ...)

1. Create `assets/models/<category>/<file>.glb`.
2. Push to `main`.
3. Done. `index.json`, `manifest.json`, `llms.txt` and `AGENTS.md` are regenerated and
   list the new group automatically.

Only step that is not automatic: if the new format needs special guidance for agents
(camera conventions, scale units, animation names), write it in `site/AGENTS.extra.md`.
Its contents are appended verbatim to the generated `AGENTS.md`. Keep that file empty
while there is nothing to add.

## Conventions by format

### icons (png)

`<subject> [Flat Black|Flat White|Outline] [64|256].png`

- No variant suffix = base variant.
- `256` is the master, `64` is a downscale. Omitting the number means original size.
- All images have alpha.

### models (glb) - when you add them

Follow `assets/models/<category>/<subject>.glb`, Y-up, meters, no embedded textures
unless the file is self-contained. Document any deviation in `AGENTS.extra.md`.

## What not to do

- Do not commit build output (`_site/`) - it is generated.
- Do not hand-edit `manifest.json`, `index.json`, `index/`, `llms.txt` or the generated
  part of `AGENTS.md`; the next deploy overwrites them.
- Do not add `.url`, `.log` or OS metadata files.

## Licensing of the current icon set

The PNG icons are third-party commercial artwork (RhosGFX) licensed for use inside
products, not for redistribution as standalone files. Treat this repository as an
internal delivery channel: the URLs are unlisted but the files are not open source.
