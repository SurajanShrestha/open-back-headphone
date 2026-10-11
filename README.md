# Open-back headphone — an interactive anatomy

An isometric, interactive figure that shows how open-back headphones work: a headphone on a stand, with one ear cup that comes apart into its five layers.

- **Grab and drag ← →** to open or close the right cup.
- **Click a layer** (pad, baffle, driver, housing, grille) to read what it is and what it does.
- The diaphragms, the amplifier's level meter, the signal in the cable and the air ripples all follow one music level.
- Works on phones: the description opens as a bottom sheet.

## Run

Open `index.html` in a browser. It is one self-contained file with no dependencies.

## Build

```sh
node build.mjs   # regenerates index.html (Node 18+)
```

All geometry, text and behaviour live in `build.mjs`.

## Deploy

A static site. On Vercel, import the repository with no framework and no build command. `.vercelignore` limits the deployment to `index.html`.

## Built with Anatomy

Made with [Anatomy](https://skills.wheresryan.sh/anatomy/), a skill for crafting detailed, interactive isometric figures that explain an idea as a real physical object. The parts of its kit that this figure uses are in `kit/`.

## License

MIT. See `LICENSE`.

The Anatomy kit in `kit/` is a separate work under its own MIT License (© 2026 Ryan). See `kit/LICENSE`.
