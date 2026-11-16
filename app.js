import {
  CURRENCIES,
  deleteCheck,
  deletePhoto,
  exportData,
  getCheck,
  getPhoto,
  getSettings,
  importData,
  listChecks,
  saveCheck,
  savePhoto,
  saveSettings,
} from "./db.js";
import { BASES, UNITS, basisSummary, unitById, unitPrice } from "./units.js";

const app = document.querySelector("#app");
const toolbar = document.querySelector("#toolbar");
const COLLAPSE_KEY = "vspt-collapsed";
const SORT_KEY = "vspt-sort";
const SORT_KEYS = ["item", "price", "store", "checkedAt", "unitPrice"];
const DEFAULT_DIR = {
  item: "asc",
  store: "asc",
  price: "asc",
  checkedAt: "desc",
  unitPrice: "asc",
};

let settings = null;
let query = "";
let storeFilter = "all";
let storeQuery = "";
let sort = loadSort();
let draft = null;
let session = null;
let routeToken = 0;
let homeToken = 0;
const photoUrls = new Map();

function loadSort() {
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_KEY) || "null");
    if (saved && SORT_KEYS.includes(saved.key) && (saved.dir === "asc" || saved.dir === "desc")) return saved;
  } catch {
    /* keep default */
  }
  return { key: "checkedAt", dir: "desc" };
}

function saveSort() {
  localStorage.setItem(SORT_KEY, JSON.stringify(sort));
}

function loadCollapsed() {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function isCollapsed(key) {
  return Boolean(loadCollapsed()[key]);
}

function applyFoldState(key, collapsed) {
  const groups = loadCollapsed();
  groups[key] = collapsed;
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(groups));
  const block = app.querySelector(`[data-collapse="${key}"]`);
  if (!block) return;
  block.classList.toggle("collapsed", collapsed);
  const head = block.querySelector(".fold-head");
  if (head) head.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function collapseControls(keys) {
  return `<div class="fold-actions">
    <button type="button" class="ghost compact" data-collapse-all="${keys.join(",")}">Collapse all</button>
    <button type="button" class="ghost compact" data-expand-all="${keys.join(",")}">Expand all</button>
  </div>`;
}

function fold(key, title, body) {
  const collapsed = isCollapsed(key);
  return `<section class="fold ${collapsed ? "collapsed" : ""}" data-collapse="${key}">
    <button type="button" class="fold-head" data-toggle="${key}" aria-expanded="${collapsed ? "false" : "true"}">
      <span class="section-title">${escapeHtml(title)}</span>
      <span class="fold-chevron" aria-hidden="true">▾</span>
    </button>
    <div class="fold-body">${body}</div>
  </section>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function todayIso() {
  const date = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${z(date.getMonth() + 1)}-${z(date.getDate())}`;
}

function prettyDate(iso) {
  if (!iso) return "—";
  const [year, month, day] = String(iso).split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(year, month - 1, day)
  );
}

function normName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function formatMoney(amount, currency) {
  const symbol = { JPY: "¥", PHP: "₱", USD: "$" }[currency] || "";
  const number = Number(amount);
  if (!Number.isFinite(number)) return "—";
  const text = new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(number);
  return `${symbol}${text}`;
}

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  if (settings) settings.theme = next;
  document.documentElement.dataset.theme = next;
  localStorage.setItem("vspt-theme", next);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = next === "dark" ? "#16130f" : "#9a4b1f";
}

function parseHash() {
  const parts = (location.hash || "#/").replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!parts.length) return { name: "home" };
  if (parts[0] === "settings") return { name: "settings" };
  if (parts[0] === "new") return { name: "form" };
  if (parts[0] === "edit" && parts[1]) return { name: "form", id: decodeURIComponent(parts[1]) };
  return { name: "home" };
}

function go(hash) {
  const next = hash.startsWith("#") ? hash : `#${hash}`;
  if ((location.hash || "#/") === next) {
    route();
    return;
  }
  location.hash = next;
}

function logoSvg() {
  return `<img class="logo" src="./icons/icon.svg" alt="" />`;
}

function renderToolbar(route) {
  const isForm = route.name === "form";
  const isSettings = route.name === "settings";
  toolbar.innerHTML = `
    <nav class="app-toolbar-inner" aria-label="App">
      ${
        route.name === "home"
          ? ""
          : `<button class="icon-btn" type="button" data-go="#/" aria-label="Back" title="Back">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>
            </button>`
      }
      <button class="toolbar-brand" type="button" data-go="#/" aria-label="VS Price Tracker">
        ${logoSvg()}
        <span class="toolbar-brand-text">
          <span class="eyebrow">Prices</span>
          <span class="toolbar-title">VS Price Tracker</span>
        </span>
      </button>
      ${
        isForm || isSettings
          ? `<button class="primary compact" type="submit" form="${isForm ? "priceForm" : "settingsForm"}">Save</button>`
          : ""
      }
      <span class="toolbar-spacer"></span>
      <button class="icon-btn" type="button" data-go="#/settings" ${isSettings ? "disabled" : ""} aria-label="Settings" title="Settings">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.77 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.89 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.69.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.26.12.55.02.69-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z"/>
        </svg>
      </button>
      <button class="primary compact" type="button" data-go="#/new" ${isForm && !route.id ? "disabled" : ""}>Add price</button>
    </nav>
  `;
}

async function photoUrl(id) {
  if (!id) return null;
  if (photoUrls.has(id)) return photoUrls.get(id);
  const blob = await getPhoto(id);
  const url = blob ? URL.createObjectURL(blob) : null;
  photoUrls.set(id, url);
  return url;
}

function clearPhotoCache() {
  for (const url of photoUrls.values()) {
    if (url) URL.revokeObjectURL(url);
  }
  photoUrls.clear();
}

function annotate(checks) {
  const rows = checks.map((row) => ({
    ...row,
    compared: unitPrice(row.price, row.quantity, row.unit, settings),
  }));
  const groups = new Map();
  for (const row of rows) {
    if (!row.compared) continue;
    const key = `${normName(row.item)}|${row.compared.family}|${row.currency || settings.currency}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const list of groups.values()) {
    list.sort(
      (a, b) =>
        String(a.checkedAt || "").localeCompare(String(b.checkedAt || "")) ||
        String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
    );
    list.forEach((row, index) => {
      const prev = index > 0 ? list[index - 1] : null;
      if (!prev || !(prev.compared.value > 0)) return;
      const diff = row.compared.value - prev.compared.value;
      const pct = (diff / prev.compared.value) * 100;
      if (Math.abs(pct) < 0.05) {
        row.delta = { kind: "flat", pct: 0, date: prev.checkedAt };
        return;
      }
      row.delta = { kind: diff < 0 ? "down" : "up", pct, date: prev.checkedAt };
    });
    if (list.length < 2) continue;
    const min = Math.min(...list.map((row) => row.compared.value));
    for (const row of list) row.lowest = row.compared.value === min;
  }
  return rows;
}

function sizeLabel(row) {
  const unit = unitById(row.unit);
  if (!(Number(row.quantity) > 0) || !unit) return "";
  const qty = new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(Number(row.quantity));
  return `${qty} ${unit.label}`;
}

function compareRows(a, b) {
  const dir = sort.dir === "asc" ? 1 : -1;
  let result = 0;
  if (sort.key === "item") result = a.item.localeCompare(b.item, undefined, { sensitivity: "base" });
  else if (sort.key === "store") result = String(a.store || "").localeCompare(String(b.store || ""), undefined, { sensitivity: "base" });
  else if (sort.key === "price") result = Number(a.price) - Number(b.price);
  else if (sort.key === "checkedAt") {
    result = String(a.checkedAt || "").localeCompare(String(b.checkedAt || ""));
  } else if (sort.key === "unitPrice") {
    const av = a.compared ? a.compared.value : null;
    const bv = b.compared ? b.compared.value : null;
    if (av == null && bv == null) result = 0;
    else if (av == null) return 1;
    else if (bv == null) return -1;
    else result = av - bv;
  }
  if (result === 0) {
    result = String(b.checkedAt || "").localeCompare(String(a.checkedAt || "")) || a.item.localeCompare(b.item);
    return result;
  }
  return result * dir;
}

function matchesQuery(row, q) {
  if (!q) return true;
  const size = sizeLabel(row).toLowerCase();
  const haystack = [row.item, row.store, row.notes, size].join(" ").toLowerCase();
  return haystack.includes(q);
}

function sortMark(key) {
  const on = sort.key === key;
  const glyph = on ? (sort.dir === "asc" ? "↑" : "↓") : "↕";
  return `<span class="sort-mark ${on ? "on" : ""}">${glyph}</span>`;
}

function ariaSort(key) {
  if (sort.key !== key) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}

function deltaHtml(row) {
  if (!row.delta || row.delta.kind === "flat") return "";
  const arrow = row.delta.kind === "down" ? "▼" : "▲";
  const pct = Math.abs(row.delta.pct);
  const digits = pct >= 10 ? 0 : 1;
  const text = `${arrow} ${pct.toFixed(digits)}%`;
  return `<span class="delta ${row.delta.kind}" title="Versus ${escapeAttr(prettyDate(row.delta.date))}">${text}</span>`;
}

function knownStores(checks) {
  const seen = new Set();
  const names = [];
  for (const name of [...(settings.stores || []), ...checks.map((row) => row.store)]) {
    const trimmed = String(name || "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(trimmed);
  }
  return names;
}

async function renderHome({ keepScroll = false, partial = false } = {}) {
  const token = ++homeToken;
  const routeAtStart = routeToken;
  const y = keepScroll ? window.scrollY : 0;
  const checks = annotate(await listChecks());
  if (token !== homeToken || routeAtStart !== routeToken) return;
  const q = query.trim().toLowerCase();
  const filtered = checks.filter((row) => {
    if (storeFilter !== "all" && String(row.store || "") !== storeFilter) return false;
    return matchesQuery(row, q);
  });
  filtered.sort(compareRows);
  const storeNames = knownStores(checks).sort((a, b) => a.localeCompare(b));
  const thumbs = new Map();
  await Promise.all(
    filtered.map(async (row) => {
      thumbs.set(row.id, await photoUrl(row.id));
    })
  );
  if (token !== homeToken || routeAtStart !== routeToken) return;

  const head = (key, label, numeric = false) =>
    `<th class="${numeric ? "num" : ""} ${key === "item" ? "sticky" : ""}" scope="col" aria-sort="${ariaSort(key)}">
      <button type="button" data-sort="${key}">${label} ${sortMark(key)}</button>
    </th>`;

  const body = filtered.length
    ? filtered
        .map((row) => {
          const currency = row.currency || settings.currency;
          const thumb = thumbs.get(row.id);
          const size = sizeLabel(row);
          const noteHit = q && row.notes && String(row.notes).toLowerCase().includes(q);
          return `<tr data-edit="${escapeAttr(row.id)}" class="${row.lowest ? "is-lowest" : ""}" ${row.notes ? `title="${escapeAttr(row.notes)}"` : ""}>
            <td class="sticky">
              <div class="item-cell">
                ${
                  thumb
                    ? `<img class="thumb" src="${thumb}" alt="" />`
                    : `<span class="thumb-fallback" aria-hidden="true">¥</span>`
                }
                <div class="item-copy">
                  <a class="item-link" href="#/edit/${encodeURIComponent(row.id)}">${escapeHtml(row.item)}</a>
                  ${size ? `<span class="meta">${escapeHtml(size)}</span>` : `<span class="meta">Size not set</span>`}
                  ${row.lowest ? `<span class="badge">Lowest</span>` : ""}
                  ${noteHit ? `<span class="meta">${escapeHtml(row.notes)}</span>` : ""}
                </div>
              </div>
            </td>
            <td class="num">${formatMoney(row.price, currency)}</td>
            <td>${row.store ? escapeHtml(row.store) : "—"}</td>
            <td>${prettyDate(row.checkedAt)}</td>
            <td class="num unit">
              ${
                row.compared
                  ? `<div class="unit-price"><strong>${formatMoney(row.compared.value, currency)}</strong><span class="per">/ ${escapeHtml(row.compared.short)}</span>${deltaHtml(row)}</div>`
                  : `<span class="meta">Add a size</span>`
              }
            </td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="5">${checks.length ? "No prices match." : ""}</td></tr>`;

  const countText =
    filtered.length === checks.length
      ? `${checks.length} price${checks.length === 1 ? "" : "s"}`
      : `${filtered.length} of ${checks.length}`;
  const rowsEl = app.querySelector("#priceRows");
  const countEl = app.querySelector("#countLine");
  if (partial && rowsEl && countEl) {
    rowsEl.innerHTML = body;
    countEl.textContent = countText;
    return;
  }

  const showing = checks.length === 0 ? "" : `<p class="count-line" id="countLine">${countText}</p>`;

  app.innerHTML = checks.length
    ? `
      <h1 class="page-title">Price list</h1>
      <input class="search" id="search" type="search" placeholder="Search items, stores, notes" value="${escapeAttr(query)}" autocomplete="off" />
      ${
        storeNames.length
          ? `<div class="filters" role="tablist">${["all", ...storeNames]
              .map(
                (name) =>
                  `<button type="button" class="chip ${storeFilter === name ? "active" : ""}" data-store-filter="${escapeAttr(name)}">${name === "all" ? "All stores" : escapeHtml(name)}</button>`
              )
              .join("")}</div>`
          : ""
      }
      <p class="basis-note">Unit price uses the pack size. Basis: ${escapeHtml(basisSummary(settings))}.</p>
      ${showing}
      <div class="table-wrap">
        <table class="prices">
          <thead>
            <tr>
              ${head("item", "Item")}
              ${head("price", "Price", true)}
              ${head("store", "Store")}
              ${head("checkedAt", "Date checked")}
              ${head("unitPrice", "Unit price", true)}
            </tr>
          </thead>
          <tbody id="priceRows">${body}</tbody>
        </table>
      </div>
    `
    : `
      <section class="empty">
        <h1>No prices yet</h1>
        <p>Add the price you paid, the store, and the pack size. A 350 g bag and a 1 kg bag of the same item are compared per 100 g (or whatever basis you pick in Settings).</p>
        <button class="primary" type="button" data-go="#/new">Add price</button>
      </section>
    `;
  window.scrollTo(0, y);
}

function currencyOptions(selected) {
  return CURRENCIES.map(
    (code) => `<option value="${code}" ${selected === code ? "selected" : ""}>${code}</option>`
  ).join("");
}

function unitOptions(selected) {
  return UNITS.map(
    (unit) => `<option value="${unit.id}" ${selected === unit.id ? "selected" : ""}>${unit.label}</option>`
  ).join("");
}

function basisOptions(family, selected) {
  return (BASES[family] || [])
    .map((basis) => `<option value="${basis.id}" ${selected === basis.id ? "selected" : ""}>${escapeHtml(basis.label)}</option>`)
    .join("");
}

function showFormError(message) {
  const el = app.querySelector("#formError");
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || "";
}

async function renderForm(route) {
  const stamp = routeToken;
  const existing = route.id ? await getCheck(route.id) : null;
  if (stamp !== routeToken) return;
  if (route.id && !existing) {
    go("#/");
    return;
  }
  const fromDraft = !route.id && draft ? draft : null;
  if (session?.previewUrl && session.previewOwned) URL.revokeObjectURL(session.previewUrl);
  let previewUrl = null;
  let previewOwned = false;
  if (fromDraft?.photoBlob) {
    previewUrl = URL.createObjectURL(fromDraft.photoBlob);
    previewOwned = true;
  } else if (existing) {
    previewUrl = await photoUrl(existing.id);
  }
  session = {
    id: existing?.id || null,
    photoBlob: fromDraft?.photoBlob || null,
    removePhoto: false,
    previewUrl,
    previewOwned,
    record: existing,
  };
  const value = fromDraft || existing || {};
  draft = null;
  const checks = await listChecks();
  if (stamp !== routeToken) return;
  const itemNames = [...new Set(checks.map((row) => row.item).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  const stores = knownStores(checks).sort((a, b) => a.localeCompare(b));
  const currency = value.currency || settings.currency;
  const unit = value.unit || "g";

  app.innerHTML = `
    <h1 class="page-title">${existing ? "Edit price" : "Add price"}</h1>
    <form id="priceForm" class="form">
      <p id="formError" class="form-error" hidden></p>
      <div class="photo-picker">
        ${
          previewUrl
            ? `<img id="photoPreview" src="${previewUrl}" alt="Price photo" />`
            : `<div class="photo-fallback" id="photoPreview">No photo</div>`
        }
        <div class="footer-links">
          <label class="ghost file-btn">Add image<input id="photoInput" type="file" accept="image/*" /></label>
          <button class="ghost" type="button" id="removePhoto" ${previewUrl ? "" : "hidden"}>Remove image</button>
        </div>
      </div>
      <label>Item
        <input name="item" list="itemNames" required value="${escapeAttr(value.item || "")}" placeholder="Coffee beans" autocomplete="off" />
      </label>
      <datalist id="itemNames">
        ${itemNames.map((name) => `<option value="${escapeAttr(name)}"></option>`).join("")}
      </datalist>
      <div class="row">
        <label>Price
          <input name="price" type="number" inputmode="decimal" min="0" step="any" required value="${value.price ?? ""}" />
        </label>
        <label>Currency
          <select name="currency">${currencyOptions(currency)}</select>
        </label>
      </div>
      <label>Store
        <input name="store" list="storeNames" value="${escapeAttr(value.store || "")}" placeholder="Market" autocomplete="off" />
      </label>
      <datalist id="storeNames">
        ${stores.map((name) => `<option value="${escapeAttr(name)}"></option>`).join("")}
      </datalist>
      <label>Date checked
        <input name="checkedAt" type="date" required value="${escapeAttr(value.checkedAt || todayIso())}" />
      </label>
      <div class="row">
        <label>Pack size
          <input name="quantity" type="number" inputmode="decimal" min="0" step="any" value="${value.quantity ?? ""}" placeholder="350" />
        </label>
        <label>Unit
          <select name="unit">${unitOptions(unit)}</select>
        </label>
      </div>
      <p class="hint">Pack size is how the unit price is calculated. 350 g at the per 100 g basis, 2 m at the per meter basis. Use the same item name each time you check that product.</p>
      <label>Notes
        <textarea name="notes" placeholder="Optional">${escapeHtml(value.notes || "")}</textarea>
      </label>
      <div class="form-actions">
        <button class="primary" type="submit">Save</button>
        ${existing ? `<button class="ghost" type="button" id="logAgain">Log again</button>` : ""}
        ${existing ? `<button class="danger" type="button" id="deleteCheck">Delete</button>` : ""}
      </div>
    </form>
  `;
  window.scrollTo(0, 0);
}

async function rememberStore(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return;
  if ((settings.stores || []).some((store) => store.toLowerCase() === trimmed.toLowerCase())) return;
  settings.stores = [...(settings.stores || []), trimmed];
  settings = await saveSettings(settings);
}

function readPriceForm(form) {
  const data = new FormData(form);
  const quantityRaw = String(data.get("quantity") ?? "").trim();
  const quantity = quantityRaw === "" ? null : Number(quantityRaw);
  return {
    item: String(data.get("item") || "").trim(),
    price: Number(data.get("price")),
    currency: String(data.get("currency") || settings.currency),
    store: String(data.get("store") || "").trim(),
    checkedAt: String(data.get("checkedAt") || todayIso()),
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
    unit: String(data.get("unit") || "g"),
    notes: String(data.get("notes") || "").trim(),
  };
}

async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  const max = 1280;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("Could not read that image");
  return blob;
}

function setPreview(url) {
  const slot = app.querySelector("#photoPreview");
  const remove = app.querySelector("#removePhoto");
  if (!slot) return;
  if (!url) {
    const fallback = document.createElement("div");
    fallback.className = "photo-fallback";
    fallback.id = "photoPreview";
    fallback.textContent = "No photo";
    slot.replaceWith(fallback);
    if (remove) remove.hidden = true;
    return;
  }
  const img = document.createElement("img");
  img.id = "photoPreview";
  img.alt = "Price photo";
  img.src = url;
  slot.replaceWith(img);
  if (remove) remove.hidden = false;
}

async function renderSettings() {
  const storeItems = (settings.stores || []).map((name, index) => ({ name, index }));
  const keys = ["settings:theme", "settings:currency", "settings:basis", "settings:stores", "settings:backup"];
  app.innerHTML = `
    <h1 class="page-title">Settings</h1>
    <p class="hint">Saved on this device. Export a backup to copy prices and photos to another phone or computer.</p>
    ${collapseControls(keys)}
    <form id="settingsForm" class="form">
      ${fold(
        "settings:theme",
        "Theme",
        `<p class="hint">Light or dark on this device.</p>
        <div class="theme-row">
          <button type="button" class="chip ${settings.theme === "light" ? "active" : ""}" data-theme-pick="light">Light</button>
          <button type="button" class="chip ${settings.theme === "dark" ? "active" : ""}" data-theme-pick="dark">Dark</button>
        </div>`
      )}
      ${fold(
        "settings:currency",
        "Currency",
        `<p class="hint">Default for new prices. A price you already saved keeps its own currency. Changing this does not convert old numbers.</p>
        <label>Default currency
          <select name="currency" id="defaultCurrency">${currencyOptions(settings.currency)}</select>
        </label>`
      )}
      ${fold(
        "settings:basis",
        "Unit price",
        `<p class="hint">The last column divides the price by the pack size, then scales it to the basis you pick here. Weight, volume, length, and pieces each have their own basis.</p>
        <label>Weight
          <select name="weightBasis" id="weightBasis">${basisOptions("weight", settings.weightBasis)}</select>
        </label>
        <label>Volume
          <select name="volumeBasis" id="volumeBasis">${basisOptions("volume", settings.volumeBasis)}</select>
        </label>
        <label>Length
          <select name="lengthBasis" id="lengthBasis">${basisOptions("length", settings.lengthBasis)}</select>
        </label>
        <p class="hint">Pieces are always compared per piece.</p>`
      )}
      ${fold(
        "settings:stores",
        "Stores",
        `<p class="hint">Stores you add here show up while logging a price. Renaming a store updates prices that use it.</p>
        <input class="search" id="storeSearch" type="search" placeholder="Search stores" value="${escapeAttr(storeQuery)}" />
        <ul class="edit-list" id="storeList">
          ${
            storeItems.length
              ? storeItems
                  .map(
                    ({ name, index }) => `<li>
                      <input data-store-index="${index}" value="${escapeAttr(name)}" />
                      <button type="button" class="danger compact" data-del-store="${index}">Delete</button>
                    </li>`
                  )
                  .join("")
              : `<li class="hint">No stores yet. You can also type a new store when you add a price.</li>`
          }
          <li class="hint" id="storeEmpty" hidden>No stores match.</li>
        </ul>
        <div class="add-row">
          <input id="newStore" placeholder="New store" />
          <button type="button" class="primary" id="addStore">Add</button>
        </div>`
      )}
      ${fold(
        "settings:backup",
        "Backup",
        `<p class="hint">Export backup includes photos. Import replaces prices on this device. CSV is the table only, without photos.</p>
        <div class="footer-links">
          <button class="ghost" type="button" id="exportBtn">Export backup</button>
          <button class="ghost" type="button" id="exportCsv">Export CSV</button>
          <label class="ghost file-btn">Import backup<input id="importFile" type="file" accept="application/json" /></label>
        </div>`
      )}
      <div class="form-actions">
        <button class="primary" type="submit">Save settings</button>
      </div>
    </form>
  `;
  filterStoreList();
}

function filterStoreList() {
  const q = storeQuery.trim().toLowerCase();
  let shown = 0;
  app.querySelectorAll("#storeList [data-store-index]").forEach((input) => {
    const li = input.closest("li");
    const match = !q || input.value.toLowerCase().includes(q);
    if (li) li.hidden = !match;
    if (match) shown += 1;
  });
  const empty = app.querySelector("#storeEmpty");
  if (empty) empty.hidden = shown !== 0 || !(settings.stores || []).length;
}

function restoreCaret(id, start) {
  const el = app.querySelector(`#${id}`);
  if (!el) return;
  el.focus();
  if (typeof start === "number") {
    try {
      el.setSelectionRange(start, start);
    } catch {
      /* date and number inputs */
    }
  }
}

function readBasisForm(form) {
  const data = new FormData(form);
  settings.currency = String(data.get("currency") || settings.currency);
  settings.weightBasis = String(data.get("weightBasis") || settings.weightBasis);
  settings.volumeBasis = String(data.get("volumeBasis") || settings.volumeBasis);
  settings.lengthBasis = String(data.get("lengthBasis") || settings.lengthBasis);
}

async function persistSettingsFromForm(form) {
  if (form) readBasisForm(form);
  settings = await saveSettings(settings);
  applyTheme(settings.theme);
}

function download(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

async function exportCsv() {
  const rows = annotate(await listChecks()).sort((a, b) =>
    String(b.checkedAt || "").localeCompare(String(a.checkedAt || ""))
  );
  const header = ["item", "price", "currency", "store", "date checked", "quantity", "unit", "unit price", "unit basis", "notes"];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.item,
        row.price,
        row.currency || settings.currency,
        row.store || "",
        row.checkedAt || "",
        row.quantity ?? "",
        unitById(row.unit)?.label || "",
        row.compared ? row.compared.value.toFixed(4) : "",
        row.compared ? row.compared.short : "",
        row.notes || "",
      ]
        .map(csvCell)
        .join(",")
    );
  }
  download(`vs-price-tracker-${todayIso()}.csv`, new Blob([lines.join("\n")], { type: "text/csv" }));
}

async function route() {
  const token = ++routeToken;
  const current = parseHash();
  renderToolbar(current);
  try {
    if (!settings) settings = await getSettings();
    if (token !== routeToken) return;
    applyTheme(settings.theme || localStorage.getItem("vspt-theme") || "light");
    if (current.name === "home") await renderHome();
    else if (current.name === "settings") await renderSettings();
    else await renderForm(current);
  } catch (error) {
    console.error(error);
    if (token !== routeToken) return;
    app.innerHTML = `<section class="empty"><h1>Could not open the price list</h1><p>Reload the page. Prices stay on this device unless browser data was cleared.</p></section>`;
  }
}

document.querySelector("#shell").addEventListener("click", async (event) => {
  const theme = event.target.closest("[data-theme-pick]")?.dataset.themePick;
  if (theme) {
    applyTheme(theme);
    settings.theme = theme === "dark" ? "dark" : "light";
    settings = await saveSettings(settings);
    renderToolbar(parseHash());
    await renderSettings();
    return;
  }

  const toggle = event.target.closest("[data-toggle]")?.dataset.toggle;
  if (toggle) {
    applyFoldState(toggle, !isCollapsed(toggle));
    return;
  }
  const collapseAll = event.target.closest("[data-collapse-all]")?.dataset.collapseAll;
  if (collapseAll) {
    collapseAll.split(",").forEach((key) => applyFoldState(key, true));
    return;
  }
  const expandAll = event.target.closest("[data-expand-all]")?.dataset.expandAll;
  if (expandAll) {
    expandAll.split(",").forEach((key) => applyFoldState(key, false));
    return;
  }

  const sortKey = event.target.closest("[data-sort]")?.dataset.sort;
  if (sortKey) {
    if (sort.key === sortKey) sort.dir = sort.dir === "asc" ? "desc" : "asc";
    else {
      sort.key = sortKey;
      sort.dir = DEFAULT_DIR[sortKey] || "asc";
    }
    saveSort();
    await renderHome({ keepScroll: true });
    return;
  }

  const storeName = event.target.closest("[data-store-filter]")?.dataset.storeFilter;
  if (storeName) {
    storeFilter = storeFilter === storeName && storeName !== "all" ? "all" : storeName;
    await renderHome({ keepScroll: true });
    return;
  }

  if (event.target.id === "addStore") {
    const input = app.querySelector("#newStore");
    const name = input?.value.trim();
    if (!name) return;
    if ((settings.stores || []).some((store) => store.toLowerCase() === name.toLowerCase())) {
      input.value = "";
      return;
    }
    settings.stores = [...(settings.stores || []), name];
    settings = await saveSettings(settings);
    storeQuery = "";
    await renderSettings();
    return;
  }

  const delStore = event.target.closest("[data-del-store]")?.dataset.delStore;
  if (delStore !== undefined) {
    const index = Number(delStore);
    const name = settings.stores[index];
    if (!name) return;
    if (!confirm(`Remove “${name}” from the store list? Prices keep that store name until you edit them.`)) return;
    settings.stores = settings.stores.filter((_, i) => i !== index);
    if (storeFilter === name) storeFilter = "all";
    settings = await saveSettings(settings);
    await renderSettings();
    return;
  }

  if (event.target.id === "removePhoto" && session) {
    session.removePhoto = true;
    session.photoBlob = null;
    if (session.previewOwned && session.previewUrl) URL.revokeObjectURL(session.previewUrl);
    session.previewUrl = null;
    session.previewOwned = false;
    setPreview(null);
    return;
  }

  if (event.target.id === "logAgain") {
    const form = app.querySelector("#priceForm");
    if (!form || !session) return;
    const data = readPriceForm(form);
    let blob = session.photoBlob;
    if (!blob && !session.removePhoto && session.id) blob = await getPhoto(session.id);
    if (session.removePhoto) blob = null;
    draft = { ...data, price: "", checkedAt: todayIso(), photoBlob: blob };
    if (session.previewOwned && session.previewUrl) URL.revokeObjectURL(session.previewUrl);
    session = null;
    go("#/new");
    return;
  }

  if (event.target.id === "deleteCheck" && session?.id) {
    const name = app.querySelector("#priceForm")?.item?.value?.trim() || "this price";
    if (!confirm(`Delete “${name}”?`)) return;
    await deleteCheck(session.id);
    photoUrls.delete(session.id);
    session = null;
    go("#/");
    return;
  }

  if (event.target.id === "exportBtn") {
    const data = await exportData();
    download(
      `vs-price-tracker-backup-${todayIso()}.json`,
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    );
    return;
  }

  if (event.target.id === "exportCsv") {
    await exportCsv();
    return;
  }

  const editId = event.target.closest("[data-edit]")?.dataset.edit;
  if (editId && !event.target.closest("a, button, input, select, textarea, label")) {
    go(`#/edit/${encodeURIComponent(editId)}`);
    return;
  }

  const href = event.target.closest("[data-go]")?.dataset.go;
  if (href) go(href);
});

document.querySelector("#shell").addEventListener("submit", async (event) => {
  if (event.target.id === "settingsForm") {
    event.preventDefault();
    const pending = app.querySelector("#newStore")?.value.trim();
    if (pending && !(settings.stores || []).some((store) => store.toLowerCase() === pending.toLowerCase())) {
      settings.stores = [...(settings.stores || []), pending];
    }
    await persistSettingsFromForm(event.target);
    await renderSettings();
    const button = app.querySelector('#settingsForm button[type="submit"]');
    if (button) {
      button.textContent = "Saved";
      setTimeout(() => {
        if (button.isConnected) button.textContent = "Save settings";
      }, 1200);
    }
    return;
  }

  if (event.target.id !== "priceForm" || !session) return;
  event.preventDefault();
  const data = readPriceForm(event.target);
  if (!data.item) {
    showFormError("Add an item name.");
    return;
  }
  if (!Number.isFinite(data.price) || data.price < 0) {
    showFormError("Add a price of zero or more.");
    return;
  }
  const button = event.target.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    const now = new Date().toISOString();
    const id = session.id || crypto.randomUUID();
    await saveCheck({
      id,
      item: data.item,
      price: data.price,
      currency: CURRENCIES.includes(data.currency) ? data.currency : settings.currency,
      store: data.store,
      checkedAt: data.checkedAt || todayIso(),
      quantity: data.quantity,
      unit: unitById(data.unit) ? data.unit : "g",
      notes: data.notes,
      createdAt: session.record?.createdAt || now,
      updatedAt: now,
    });
    if (session.photoBlob) await savePhoto(id, session.photoBlob);
    else if (session.removePhoto) await deletePhoto(id);
    photoUrls.delete(id);
    await rememberStore(data.store);
    session = null;
    go("#/");
  } catch (error) {
    console.error(error);
    showFormError("Could not save that price.");
    if (button) button.disabled = false;
  }
});

document.querySelector("#shell").addEventListener("change", async (event) => {
  if (event.target.id === "photoInput" && session) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const blob = await compressImage(file).catch(() => file);
      session.photoBlob = blob;
      session.removePhoto = false;
      if (session.previewOwned && session.previewUrl) URL.revokeObjectURL(session.previewUrl);
      session.previewUrl = URL.createObjectURL(blob);
      session.previewOwned = true;
      setPreview(session.previewUrl);
    } catch (error) {
      console.error(error);
      showFormError("Could not read that image.");
    }
    return;
  }

  if (event.target.id === "importFile") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!confirm("Import replaces prices on this device. Continue?")) return;
    try {
      const payload = JSON.parse(await file.text());
      settings = await importData(payload);
      clearPhotoCache();
      applyTheme(settings.theme);
      go("#/");
    } catch (error) {
      console.error(error);
      alert("Could not import that backup. Use a VS Price Tracker JSON export.");
    }
    return;
  }

  if (event.target.dataset.storeIndex !== undefined) {
    const index = Number(event.target.dataset.storeIndex);
    const prev = settings.stores[index];
    const next = event.target.value.trim();
    if (!next || next === prev) {
      event.target.value = prev || "";
      return;
    }
    if (settings.stores.some((store, i) => i !== index && store.toLowerCase() === next.toLowerCase())) {
      event.target.value = prev;
      alert("That store is already in the list.");
      return;
    }
    const checks = await listChecks();
    for (const row of checks) {
      if (row.store === prev) await saveCheck({ ...row, store: next });
    }
    settings.stores[index] = next;
    if (storeFilter === prev) storeFilter = next;
    settings = await saveSettings(settings);
    return;
  }

  if (event.target.form?.id === "settingsForm" && ["defaultCurrency", "weightBasis", "volumeBasis", "lengthBasis"].includes(event.target.id)) {
    await persistSettingsFromForm(event.target.form);
  }
});

document.querySelector("#shell").addEventListener("input", (event) => {
  if (event.target.id === "search") {
    query = event.target.value;
    renderHome({ keepScroll: true, partial: true });
    return;
  }
  if (event.target.id === "storeSearch") {
    storeQuery = event.target.value;
    filterStoreList();
  }
});

document.querySelector("#shell").addEventListener(
  "wheel",
  (event) => {
    if (event.target.type === "number" && document.activeElement === event.target) event.target.blur();
  },
  { passive: true }
);

window.addEventListener("hashchange", route);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

applyTheme(localStorage.getItem("vspt-theme") || "light");
route();
