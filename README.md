# Bed Divider

A small web page that splits the occupied beds in a unit evenly among the staff on shift. It is one self-contained HTML file (styles and scripts inline, no build step, no server), so it runs on GitHub Pages and works on phones.

## How it works

1. **Rooms and beds.** The default layout is 37 rooms numbered 1 to 38 with no room 13 (`1-12, 14-38`), 2 beds each (A, B). Use **Edit layout** to rename rooms (ranges like `101-138` work) and tap a room's name to switch it between 2 and 3 beds. List rooms in hallway order. The first screen shows every room in one column with a block for each bed: tap a bed to fill it orange (occupied) or clear it (empty), then tap **Divide beds**.
2. **Staff.** On the second screen, set how many people are working. Names are optional.
3. **Assignments.** Rooms are divided into one block per person:
   - **A room is never split between people**, and each person gets a **contiguous run of rooms**, so assignments stay geographically together.
   - Among all such splits, the calculator picks the one with the **most even patient counts**. Because rooms can't be split, counts may differ by a couple of patients.
   - Each person's **open beds** are listed too, so everyone knows which admissions are theirs.
   - Tick **Allow a room's beds to be split between people** to divide bed by bed instead. Counts then differ by at most one, but roommates can end up with different staff.

Everything is saved in the browser's local storage on that device only. Nothing is sent anywhere.

## Run locally

Open `index.html` in a browser. To run the tests of the splitting logic (Node 18+):

```sh
node --test tests/*.test.js
```

## Publish on GitHub Pages

1. In the repository, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose the `main` branch and the `/ (root)` folder, then **Save**.
4. After a minute the site is live at `https://<your-username>.github.io/facility_divider/`.

## Files

- `index.html` – the whole app. You can also just email or copy this one file and open it anywhere.
- `tests/divide.test.js` – tests for the splitting logic, read straight out of `index.html`
