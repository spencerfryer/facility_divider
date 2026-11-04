# Bed Divider

A small web page that splits the occupied beds in a unit evenly among the staff on shift. It is one self-contained HTML file (styles and scripts inline, no build step, no server), so it runs on GitHub Pages and works on phones.

## How it works

1. **Beds.** List the beds in the order they sit on the unit (for example `1-20`, or `A1-A12, B1-B8`, or one name per line). Tap a bed to mark it occupied or empty.
2. **Staff.** Set how many people are working. Names are optional.
3. **Assignments.** Occupied beds are divided into one block per person:
   - Each person gets a **contiguous run** of beds in list order, so assignments stay geographically together.
   - Patient counts differ by **at most one**. When it doesn't divide evenly, the first people in the list get the extra patient.
   - Each **empty bed** is listed with the person whose block it sits in (beds before the first patient go to the first person), so everyone knows which open beds are theirs for admissions.

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
