# Bed Divider

A small web page that splits the occupied beds in a unit evenly among the staff on shift. It is one self-contained HTML file (styles and scripts inline, no build step, no server), so it runs on GitHub Pages and works on phones.

## How it works

1. **Rooms and beds.** The rooms come from [`rooms.json`](rooms.json) (see below). The page shows every room in one column with a block for each bed. Every bed starts out occupied (orange); tap the empty ones to clear them.
2. **Workers.** Below the rooms, enter how many people are working. Names are optional.
3. **Assignments.** Only the occupied beds are divided, in order, regardless of room:
   - Each worker gets a **continuous run of occupied beds**, and patient counts differ by **at most one** (the first workers get the extra patient).
   - A room can be shared: if one worker's range ends on 29B, the next starts on 29C.
   - Each worker's line shows their range (for example *Beds 1A – 9A*) and any empty beds inside it to skip.

Everything is saved in the browser's local storage on that device only. Nothing is sent anywhere.

## Changing the rooms

Edit `rooms.json` on GitHub (open it, click the pencil, commit). The calculator itself doesn't change. Each room is one line, in hallway order:

```json
{ "room": "12", "beds": 2 },
{ "room": "14", "beds": 3 },
{ "room": "40", "beds": ["A", "B", "Window"] }
```

- `beds` is the number of beds (labelled A, B, C...), or a list of your own labels.
- To add a room, copy a line and change the number. Every line except the last needs a comma.
- If the file has a mistake, the page shows a red note saying what's wrong and uses its built-in copy of the room list until it's fixed.
- GitHub Pages can take a few minutes to pick up a change.

## Shared bed list (optional)

With the small Cloudflare Worker in [`worker/`](worker/README.md) set up, the room layout and the occupied beds are shared by everyone who opens the page. Staff with the passcode can tap beds and use **Edit beds** to add or remove beds (up to 3 per room), and every change saves for everyone. Without it, the page works as before: rooms come from `rooms.json`, and taps stay on that device.

## Run locally

Opening `index.html` straight from disk works, but browsers block it from reading `rooms.json` that way, so it uses the built-in room list. To use `rooms.json` locally, run `python3 -m http.server` in this folder and open http://localhost:8000. To run the tests of the splitting logic (Node 18+):

```sh
node --test tests/*.test.js tests/*.test.mjs
```

## Publish on GitHub Pages

1. In the repository, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose the `main` branch and the `/ (root)` folder, then **Save**.
4. After a minute the site is live at `https://<your-username>.github.io/facility_divider/`.

## Files

- `index.html` – the whole app
- `rooms.json` – the room and bed list
- `worker/` – the optional Cloudflare Worker for a shared bed list
- `tests/divide.test.js` – tests for the splitting logic, read straight out of `index.html`
