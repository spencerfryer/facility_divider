# Bed Divider

A small web page that splits the occupied beds in a unit evenly among the staff on shift. It is one self-contained HTML file (styles and scripts inline, no build step, no server), so it runs on GitHub Pages and works on phones.

## How it works

1. **Rooms and beds.** The rooms come from [`rooms.json`](rooms.json) (see below). The page shows every room in one column with a block for each bed. Every bed starts out occupied (orange); tap the empty ones to clear them.
2. **Workers.** Below the rooms, enter how many people are working. Names are optional (under **More options**).
3. **Assignments.** The page lists each worker's bed range (for example *Beds 1A – 8B*) with their patient count. Rooms are divided into one block per person:
   - **A room is never split between people**, and each person gets a **contiguous run of rooms**, so assignments stay geographically together.
   - Among all such splits, the calculator picks the one with the **most even patient counts**. Because rooms can't be split, counts may differ by a couple of patients.
   - Each person's **open beds** are listed too, so everyone knows which admissions are theirs.
   - Under **More options**, tick **Allow a room's beds to be split between workers** to divide bed by bed instead. Counts then differ by at most one, but roommates can end up with different staff.

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
- If the file has a mistake, the page shows a red note saying what's wrong and uses its built-in list (37 rooms, 1 to 38 without 13, 2 beds each) until it's fixed.
- GitHub Pages can take a few minutes to pick up a change.

## Run locally

Opening `index.html` straight from disk works, but browsers block it from reading `rooms.json` that way, so it uses the built-in room list. To use `rooms.json` locally, run `python3 -m http.server` in this folder and open http://localhost:8000. To run the tests of the splitting logic (Node 18+):

```sh
node --test tests/*.test.js
```

## Publish on GitHub Pages

1. In the repository, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose the `main` branch and the `/ (root)` folder, then **Save**.
4. After a minute the site is live at `https://<your-username>.github.io/facility_divider/`.

## Files

- `index.html` – the whole app
- `rooms.json` – the room and bed list
- `tests/divide.test.js` – tests for the splitting logic, read straight out of `index.html`
