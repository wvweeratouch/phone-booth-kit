# GUIDE · give this file to your AI

Phone Booth workshop, 2026-11-16. Paste this file into your AI (Claude, ChatGPT, Gemini), attach a photo of the surface, and say in one sentence what you want the light to do.

## What you are making

One file, `index.html`, saved next to `sense.js` and `map.js` from this kit. It is opened by double-clicking it in Chrome. There is no server, no npm and no build step. It will be projected onto real surfaces in a dark bar.

## Rules

1. **Do not edit `sense.js` or `map.js`.** Load them at the end of `<body>`:
   `<script src="sense.js"></script>` then `<script src="map.js"></script>`, then your own `<script>`.
2. **The background is pure black `#000`.** On a projector, black means no light: only what you draw lands on the wall.
3. **Each physical face in the photo becomes one element with `data-surface="name"`.** Give it `position:absolute`, a starting `left`/`top`, and a `width`/`height` in that face's proportions as seen in the photo. A box seen from the corner has 2 or 3 faces, so it gets 2 or 3 surfaces. In the room, `map.js` lets the person drag each surface's 4 corners onto the real face (key M). Write these elements in the HTML itself rather than creating them with JavaScript, because `map.js` looks for them once, when the page loads.
4. **Draw inside each surface** with a `<canvas>` whose pixel size equals the element size, or with SVG. A `<video autoplay loop muted>` or `<img>` placed directly inside a surface fills it by itself, but the surface still needs its width and height set. p5.js is allowed only in instance mode, from a CDN with an exact version (for example `https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js`).
5. **Design from the photo.** Use the surface's edges, corners, seams and texture. Light reads best as lines, outlines, edges and thin moving shapes. Avoid big flat white areas: they wash out the room and dazzle people.
6. **At the top of `index.html`, write the loop as a comment:**
   ```
   SENSE: what the machine perceives (pick from the table below)
   DO:    what changes, on which surface
   FOR:   why, and for whom   ← ask the person, do not invent this line
   ```
7. **Use the lowest sensing level that does the job.** Level 0 works offline and copes best with a dark room.
8. **Sound is optional.** Use Web Audio and start it on the first click or key press, because browsers block audio until the user does something.
9. Keep everything in one file. Do not use the keys M, F or D for anything else; the kit uses them.

## sense.js

```js
sense.start({ level: 0 });   // 0 motion · 1 + hands · 2 + people. Optional: mirror (default true), debug
```

Read these values on every frame:

| value | level | meaning |
|---|---|---|
| `sense.motion` | 0+ | 0..1, how much is moving in front of the camera |
| `sense.where` | 0+ | `{x, y}` 0..1, centre of the movement |
| `sense.swipe` | 0+ | `'left' 'right' 'up' 'down'` on the frame a swipe happens, otherwise `null` |
| `sense.hands` | 1 | `[{x, y, gesture, speed, points}]`, `points` = 21 hand landmarks (0 wrist, 4 thumb tip, 8 index tip, 12 middle tip) |
| `sense.hands[i].gesture` | 1 | `none fist open point thumb_up thumb_down victory love` |
| `sense.people` | 2 | `[{x, y, speed, points}]`, `points` = 33 body landmarks (0 nose, 15/16 wrists, 27/28 ankles), up to 4 people |
| `sense.count` | 2 | number of people, held steady so it does not flicker |
| `sense.speed` | 2 | 0..1, average body speed |
| `sense.ready` `sense.status` `sense.error` | all | state; when level 1 or 2 cannot load its model, sense falls back to level 0 and sets `error` |

Events, which fire once and are better than polling for one-off moments:

```js
sense.on('swipe',   dir => {});            // 'left' 'right' 'up' 'down'
sense.on('gesture', (name, hand) => {});   // level 1, when the first hand's gesture changes
sense.on('enter',   count => {});          // level 2, someone arrived
sense.on('leave',   count => {});          // level 2, someone left
sense.on('ready',   () => {});
```

Coordinates: `x` goes 0..1 from left to right as people see themselves (the camera image is mirrored), and `y` goes 0..1 from top to bottom. To place something on a surface, multiply by that surface's width and height.

## Keys in the room

| key | what it does |
|---|---|
| M | map mode: drag corners 1-4 onto the real face; drag the name tag to move the whole surface |
| F | fullscreen. Move the window to the projector screen first, press F, then map |
| D | show what the camera sees, with the values |
| Shift+R | forget the mapping |
| + media / × media | in map mode, under each surface's name tag: put an image or video on that surface, or take it off |
| drop a file | drag an image or video file onto a surface to put it there |

The mapping and any media added by hand are remembered in this browser.

## Media from code

```js
mapMedia('wall', 'clip.mp4');   // image or video file next to index.html, or a URL
mapMedia('wall', null);         // take it off
```

Media covers the surface's own drawing. Video plays muted and loops. A file the person dropped in by hand wins over media set in code.

## Workflow

1. Stand where the projector stands and photograph the surface.
2. Give the photo, this GUIDE and your one sentence to your AI. Ask for `index.html`.
3. Put `index.html` in the kit folder and double-click it. Allow the camera.
4. Press D to check what the camera sees, then F for fullscreen on the projector, then M to map.
5. Point the camera at the people, not at the projection. If the camera sees its own light changing, it counts that as movement.
