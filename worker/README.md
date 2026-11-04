# Shared bed list (Cloudflare Worker)

This Worker stores the room layout and bed states, so everyone who opens the calculator sees the same rooms, bed counts, and occupied beds. That covers both edits made with **Edit beds** and beds tapped occupied or empty. Changes need the staff passcode. Anyone can view.

It saves one JSON document in Cloudflare KV, under the key `state`:

```json
{
  "version": 12,
  "updatedAt": "2026-11-04T03:55:00Z",
  "rooms": [
    { "room": "1", "beds": [ { "label": "A", "occupied": true }, { "label": "B", "occupied": false } ] }
  ]
}
```

Nothing is stored until the first change. That first save starts from `rooms.json`. After that, the Worker's copy is the source of truth, and `rooms.json` only matters if the Worker can't be reached.

## Deploy it (Cloudflare dashboard, about 10 minutes, free plan is fine)

1. **Create the storage.** In the Cloudflare dashboard, go to **Storage & Databases → KV → Create**. Name it `bed-divider`.
2. **Create the Worker.** Go to **Workers & Pages → Create → Create Worker**. Name it `bed-divider` and click **Deploy**.
3. **Paste the code.** Open the Worker, click **Edit code**, replace everything with the contents of [`worker.js`](worker.js), and click **Deploy**.
4. **Connect the storage.** On the Worker, go to **Settings → Bindings → Add → KV namespace**. Set **Variable name** to `BEDS` and choose `bed-divider`.
5. **Set the passcode.** Under **Settings → Variables and Secrets → Add**, choose type **Secret**, set **Name** to `PASSCODE`, and set **Value** to the code staff will use. Keep it out of this repo, because the repo is public.
6. **Copy the Worker's address.** It's shown on the Worker's page, for example `https://bed-divider.yourname.workers.dev`.
7. **Point the page at it.** In `index.html`, find `const WORKER_URL = '';` and put the address between the quotes. Commit the change. GitHub Pages updates within a minute or two.

To check it, open `https://<your worker>/state`. Before the first change it shows `{"error":"nothing saved yet"}`, which is expected.

## Using it

- Tap beds as usual. Each change saves for everyone, and other open copies of the page pick it up within about 20 seconds.
- **Edit beds** (top right of the Rooms panel) shows a **+** in the next empty bed slot of each room to add a bed, and a **−** outside each room to remove its last bed. Each room can have 1 to 3 beds. New beds start out occupied.
- The first change on a phone or computer asks for the passcode once. That device then remembers it. A wrong code is forgotten, and the page goes back to the last saved version.

## Starting over

To reset to `rooms.json`, delete the `state` key in the KV namespace (**KV → bed-divider → state → Delete**).
