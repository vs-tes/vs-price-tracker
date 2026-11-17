# VS Price Tracker

A private price list that runs in the browser on iPhone, iPad, Android, and computers. There is **no login** and **no Apple fee** — this is a web app, like [Bochog Kakei](https://github.com/vs-tes/bochog-kakei) and [Bochog Plant Care](https://github.com/vs-tes/bochog-plant-care).

Prices, photos, and stores stay **on this device** (IndexedDB). They are not stored in the git repository.

## Features

- Table of item, price, store, category, date checked, and unit price
- Unit price is calculated from the pack size (350 g, 2 m, 1 L, …)
- Settings choose the comparison basis: per 100 g or per 1 kg, per 100 ml or per 1 L, per 1 m or per 10 cm, and per piece
- Same item name is compared across stores. The lowest unit price is marked, and each later check shows the change versus the previous one
- Store and category menus stay under the top bar, like Kakei, so they stay on screen while you scroll
- Rename an item from Edit or from its history page; every saved check with that name is updated
- Clone a price from Edit to start a copy you can save
- Instant search across item, store, category, and notes, with an × to clear the field
- Price history for one item, grouped by month, with the price paid drawn over time
- Optional target price. The row is marked when the price paid goes under it
- Categories such as Groceries, Hardware, and Household. Add or rename them in Settings
- Sort by any column
- Photo on each price (shelf, tag, or product)
- Light and dark theme, currency (JPY, PHP, USD), editable store list
- Export / import backup (JSON, photos included) and CSV
- Works offline after the first load, including from the iPhone Home Screen

## iPhone or desktop

Open this in Safari on iPhone, or in any browser on a computer:

https://vs-tes.github.io/vs-price-tracker/

On iPhone, use Safari (not Chrome), then Share → **Add to Home Screen**. Open **Prices** from the new icon.

## GitHub Pages

Hosted from branch `main` at the repository root, the same way as Kakei and Plant Care:

https://vs-tes.github.io/vs-price-tracker/

## Run locally

```bash
python3 -m http.server 8791 --bind 0.0.0.0
```

Open `http://localhost:8791` on this computer.

On an iPhone on the same Wi-Fi, open `http://YOUR-MAC-IP:8791` in Safari, then Share → **Add to Home Screen**.

## Use it

1. **Add price** — item, what you paid, store, date, and the pack size (for example 350 g).
2. Use the **same item name** when you check that product again. The unit-price column is how a 350 g pack and a 1 kg pack are compared.
3. Store and Category at the top of the list filter the table. Tap a column heading to sort. Search filters as you type; tap × to clear it.
4. **Edit** can rename the item on every check, clone it, or log another price.
5. **Settings** — theme, currency, unit-price basis, stores, categories, and backup.
6. Open an item name to see that item’s checks month by month. Rename lives there too.

## Phone and this Mac

Prices stay in the browser you saved them in. To copy them to your phone, or back to this Mac, use **Settings → Phone and Mac → Export backup**, then import that file on the other device.

Live sync is not connected. Kakei and Plant Care sync through a separate server that does not include this price list. Each price already has an id and an edit time so a sync step can be added later without changing the screens.

Changing the currency symbol does not convert numbers you already saved. Each price keeps the currency you picked when you logged it.

## Project structure

```
vs-price-tracker/
  index.html              App shell
  styles.css              Layout and theme
  app.js                  Table, form, settings
  db.js                   IndexedDB
  units.js                Unit-price math
  sw.js                   Offline cache
  manifest.webmanifest    Home Screen metadata
  icons/                  App icons
```

## Ideas not built yet

- Currency conversion (the way Kakei converts JPY, PHP, and USD)
- Live sync between phone and Mac
