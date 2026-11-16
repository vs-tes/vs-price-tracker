# VS Price Tracker

A private price list that runs in the browser on iPhone, iPad, Android, and computers. There is **no login** and **no Apple fee** — this is a web app, like [Bochog Kakei](https://github.com/vs-tes/bochog-kakei) and [Bochog Plant Care](https://github.com/vs-tes/bochog-plant-care).

Prices, photos, and stores stay **on this device** (IndexedDB). They are not stored in the git repository.

## Features

- Table of item, price, store, date checked, and unit price
- Unit price is calculated from the pack size (350 g, 2 m, 1 L, …)
- Settings choose the comparison basis: per 100 g or per 1 kg, per 100 ml or per 1 L, per 1 m or per 10 cm, and per piece
- Same item name is compared across stores. The lowest unit price is marked, and each later check shows the change versus the previous one
- Instant search across item, store, and notes
- Sort by any column
- Photo on each price (shelf, tag, or product)
- Light and dark theme, currency (JPY, PHP, USD), editable store list
- Export / import backup (JSON, photos included) and CSV
- Works offline after the first load, including from the iPhone Home Screen

## GitHub Pages

Hosted from branch `main` / root:

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
3. Tap a column heading to sort. Search filters the table as you type.
4. **Settings** — theme, currency, unit-price basis, stores, and backup.

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

- A sparkline of one item’s price over time
- A target price, with the row marked when a check goes under it
- Currency conversion (the way Kakei converts JPY, PHP, and USD)
- Categories such as groceries, hardware, and household
- Optional sync between phone and Mac
