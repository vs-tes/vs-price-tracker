import {
  CURRENCIES,
  DEFAULT_CATEGORIES,
  DEFAULT_COL_WIDTHS,
  deleteCheck,
  deletePhoto,
  exportData,
  getCheck,
  getPhoto,
  getSettings,
  importData,
  listChecks,
  renameItem,
  saveCheck,
  savePhoto,
  saveSettings,
} from "./db.js";
import { BASES, UNITS, basisSummary, unitById, unitPrice } from "./units.js";

const app = document.querySelector("#app");
const toolbar = document.querySelector("#toolbar");
const filterbar = document.querySelector("#filterbar");
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
let categoryFilter = "all";
let storeQuery = "";
let categoryQuery = "";
let sort = loadSort();
let draft = null;
let session = null;
let routeToken = 0;
let homeToken = 0;
let homeMeta = { hasPrices: false, storeNames: [], categoryNames: [] };
const CUSTOM_VALUE = "__custom__";
const COL_KEYS = ["item", "price", "store", "checkedAt", "unitPrice"];
const photoUrls = new Map();
let resizing = null;

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

function neighborCol(key) {
  const index = COL_KEYS.indexOf(key);
  if (index < 0) return null;
  return COL_KEYS[index === COL_KEYS.length - 1 ? index - 1 : index + 1];
}

function applyTableChrome() {
  const root = document.documentElement;
  root.dataset.freeze = settings?.freezeItemColumn ? "1" : "0";
  const widths = settings?.colWidths || DEFAULT_COL_WIDTHS;
  for (const key of COL_KEYS) {
    const value = Number(widths[key]);
    const pct = Number.isFinite(value) && value > 0 ? value : DEFAULT_COL_WIDTHS[key];
    root.style.setProperty(`--w-${key}`, `${pct}%`);
  }
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
  if (parts[0] === "about") return { name: "about" };
  if (parts[0] === "new") return { name: "form" };
  if (parts[0] === "edit" && parts[1]) return { name: "form", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "history" && parts[1]) return { name: "history", item: decodeURIComponent(parts[1]) };
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

function clearable(html, attrs = "") {
  return `<span class="clearable"${attrs ? ` ${attrs}` : ""}>${html}<button type="button" class="clear-btn" data-clear aria-label="Clear">×</button></span>`;
}

function itemFieldsHtml(value, itemNames) {
  const known = Boolean(value.item && itemNames.includes(value.item));
  return `
    <label>Item
      <select id="itemPick" data-item-pick>
        <option value="${CUSTOM_VALUE}" ${known ? "" : "selected"}>New item…</option>
        ${itemNames
          .map(
            (name) =>
              `<option value="${escapeAttr(name)}" ${value.item === name ? "selected" : ""}>${escapeHtml(name)}</option>`
          )
          .join("")}
      </select>
    </label>
    <label id="itemNameField" ${known ? "hidden" : ""}>Item name
      ${clearable(`<input name="item" value="${escapeAttr(value.item || "")}" placeholder="Coffee beans" autocomplete="off" />`)}
    </label>
    <p class="hint">This name is only for this check. Pick an existing name to group it with that product, or New item for another variety.</p>
  `;
}

function choiceOptions(names, selected, noneLabel, newLabel) {
  const known = names.some((name) => name === selected);
  const options = [`<option value="">${escapeHtml(noneLabel)}</option>`];
  for (const name of names) {
    options.push(
      `<option value="${escapeAttr(name)}" ${selected === name ? "selected" : ""}>${escapeHtml(name)}</option>`
    );
  }
  options.push(
    `<option value="${CUSTOM_VALUE}" ${selected && !known ? "selected" : ""}>${escapeHtml(newLabel)}</option>`
  );
  return options.join("");
}

function choiceCustomValue(names, selected) {
  const known = names.some((name) => name === selected);
  return selected && !known ? selected : "";
}

function choiceHidden(names, selected) {
  return selected && !names.some((name) => name === selected) ? "" : "hidden";
}

function resolveChoice(form, key) {
  const pick = String(form[`${key}Pick`]?.value || "");
  if (pick === CUSTOM_VALUE) return String(form[`${key}Custom`]?.value || "").trim();
  return pick.trim();
}

function toggleChoiceCustom(select) {
  const key = select.dataset.choice;
  if (!key) return;
  const custom = select.form?.querySelector(`[name="${key}Custom"]`);
  if (!custom) return;
  const isCustom = select.value === CUSTOM_VALUE;
  const wrap = custom.closest(".clearable");
  if (wrap) wrap.hidden = !isCustom;
  else custom.hidden = !isCustom;
  if (isCustom) custom.focus();
}

function renderToolbar(route) {
  const isForm = route.name === "form";
  const isSettings = route.name === "settings";
  const isAbout = route.name === "about";
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
      <button class="icon-btn" type="button" data-go="#/about" ${isAbout ? "disabled" : ""} aria-label="About" title="About">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 15.2a1.15 1.15 0 1 1 0-2.3 1.15 1.15 0 0 1 0 2.3Zm1.4-4.7-.4.2c-.5.3-.8.6-.8 1.2h-1.6v-.3c0-1 .5-1.7 1.2-2.2l.4-.2c.6-.4.9-.8.9-1.4 0-.8-.6-1.4-1.5-1.4s-1.5.5-1.7 1.3H8.3C8.6 7.9 10 6.7 12.1 6.7c2.1 0 3.5 1.3 3.5 3.2 0 1.2-.6 2-2.2 2.6Z"/>
        </svg>
      </button>
      <button class="icon-btn" type="button" data-go="#/settings" ${isSettings ? "disabled" : ""} aria-label="Settings" title="Settings">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.77 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.89 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.69.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.26.12.55.02.69-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z"/>
        </svg>
      </button>
      <button class="primary compact" type="button" data-go="#/new" ${isForm && !route.id ? "disabled" : ""}>Add price</button>
    </nav>
    ${route.name === "home" && homeMeta.hasPrices ? homeToolsHtml() : ""}
  `;
  renderFilterbar(route);
}

function homeToolsHtml() {
  return `<div class="home-tools">
    ${clearable(
      `<input class="search" id="search" type="search" placeholder="Search items, stores, categories, notes" value="${escapeAttr(query)}" autocomplete="off" />`
    )}
  </div>`;
}

function renderFilterbar(route) {
  const show = route.name === "home" && homeMeta.hasPrices;
  document.querySelector("#shell").classList.toggle("has-filterbar", show);
  if (!show) {
    filterbar.hidden = true;
    filterbar.innerHTML = "";
    return;
  }
  filterbar.hidden = false;
  filterbar.innerHTML = `
    <div class="filter-row">
      <div class="filter-field">
        <label for="storeFilter">Store</label>
        <select id="storeFilter">${selectOptions(homeMeta.storeNames, storeFilter, "All stores")}</select>
      </div>
      <div class="filter-field">
        <label for="categoryFilter">Category</label>
        <select id="categoryFilter">${selectOptions(homeMeta.categoryNames, categoryFilter, "All categories")}</select>
      </div>
    </div>
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

function photoOpenHtml(src, imgClass) {
  if (!src) return "";
  return `<button type="button" class="photo-open" data-photo-src="${escapeAttr(src)}" aria-label="View photo">
    <img class="${imgClass}" src="${escapeAttr(src)}" alt="" />
  </button>`;
}

function openLightbox(src) {
  const box = document.querySelector("#lightbox");
  const img = document.querySelector("#lightboxImg");
  if (!box || !img || !src) return;
  img.src = src;
  box.hidden = false;
  document.body.classList.add("has-lightbox");
}

function closeLightbox() {
  const box = document.querySelector("#lightbox");
  const img = document.querySelector("#lightboxImg");
  if (img) img.removeAttribute("src");
  if (box) box.hidden = true;
  document.body.classList.remove("has-lightbox");
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
  const haystack = [row.item, row.store, row.category, row.notes, size].join(" ").toLowerCase();
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

function knownNames(saved, extras) {
  const seen = new Set();
  const names = [];
  for (const name of [...(saved || []), ...(extras || [])]) {
    const trimmed = String(name || "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(trimmed);
  }
  return names;
}

function knownStores(checks) {
  return knownNames(settings.stores, checks.map((row) => row.store));
}

function knownCategories(checks) {
  const saved = Array.isArray(settings.categories) ? settings.categories : DEFAULT_CATEGORIES;
  return knownNames(saved, checks.map((row) => row.category));
}

function isUnderTarget(row) {
  const target = Number(row.targetPrice);
  const price = Number(row.price);
  return target > 0 && Number.isFinite(price) && price < target;
}

function sameName(a, b) {
  return normName(a) === normName(b);
}

function selectOptions(names, selected, allLabel) {
  const options = [
    `<option value="all" ${selected === "all" ? "selected" : ""}>${escapeHtml(allLabel)}</option>`,
  ];
  for (const name of names) {
    options.push(
      `<option value="${escapeAttr(name)}" ${selected === name ? "selected" : ""}>${escapeHtml(name)}</option>`
    );
  }
  return options.join("");
}

function monthKey(iso) {
  const text = String(iso || "");
  return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : "unknown";
}

function monthLabel(key) {
  if (key === "unknown") return "No date";
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function historyChart(points, target) {
  if (points.length < 2) {
    return `<p class="hint">${points.length ? "One check so far. Add another month to see the line." : "Nothing to chart in this currency yet."}</p>`;
  }
  const w = 640;
  const h = 168;
  const padX = 12;
  const padY = 16;
  const values = points.map((point) => point.y);
  if (target > 0) values.push(target);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xAt = (index) => padX + (index / (points.length - 1)) * (w - padX * 2);
  const yAt = (value) => padY + (1 - (value - min) / span) * (h - padY * 2);
  const line = points
    .map((point, index) => `${index ? "L" : "M"}${xAt(index).toFixed(1)} ${yAt(point.y).toFixed(1)}`)
    .join(" ");
  const dots = points
    .map((point, index) => {
      const label = `${prettyDate(point.date)} ${formatMoney(point.y, point.currency)}`;
      return `<circle cx="${xAt(index).toFixed(1)}" cy="${yAt(point.y).toFixed(1)}" r="4"><title>${escapeHtml(label)}</title></circle>`;
    })
    .join("");
  const targetLine =
    target > 0
      ? `<line class="target-line" x1="${padX}" x2="${w - padX}" y1="${yAt(target).toFixed(1)}" y2="${yAt(target).toFixed(1)}" />`
      : "";
  return `<svg class="history-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Price over time">${targetLine}<path d="${line}" />${dots}</svg>`;
}

async function renderHome({ keepScroll = false, partial = false } = {}) {
  const token = ++homeToken;
  const routeAtStart = routeToken;
  const y = keepScroll ? window.scrollY : 0;
  const checks = annotate(await listChecks());
  if (token !== homeToken || routeAtStart !== routeToken) return;
  const q = query.trim().toLowerCase();
  const storeNames = knownStores(checks).sort((a, b) => a.localeCompare(b));
  const categoryNames = knownCategories(checks).sort((a, b) => a.localeCompare(b));
  if (storeFilter !== "all" && !storeNames.includes(storeFilter)) storeFilter = "all";
  if (categoryFilter !== "all" && !categoryNames.includes(categoryFilter)) categoryFilter = "all";
  const filtered = checks.filter((row) => {
    if (storeFilter !== "all" && String(row.store || "") !== storeFilter) return false;
    if (categoryFilter !== "all" && String(row.category || "") !== categoryFilter) return false;
    return matchesQuery(row, q);
  });
  filtered.sort(compareRows);
  const thumbs = new Map();
  await Promise.all(
    filtered.map(async (row) => {
      thumbs.set(row.id, await photoUrl(row.id));
    })
  );
  if (token !== homeToken || routeAtStart !== routeToken) return;

  const head = (key, label, colClass, numeric = false) =>
    `<th class="${colClass} ${numeric ? "num" : ""}" scope="col" data-col="${key}" aria-sort="${ariaSort(key)}">
      <button type="button" data-sort="${key}">${label} ${sortMark(key)}</button>
      <span class="col-resizer" data-resize="${key}" aria-hidden="true"></span>
    </th>`;

  const body = filtered.length
    ? filtered
        .map((row) => {
          const currency = row.currency || settings.currency;
          const thumb = thumbs.get(row.id);
          const size = sizeLabel(row);
          const noteHit = q && row.notes && String(row.notes).toLowerCase().includes(q);
          const underTarget = isUnderTarget(row);
          const titleBits = [];
          if (row.notes) titleBits.push(row.notes);
          if (Number(row.targetPrice) > 0) titleBits.push(`Target ${formatMoney(row.targetPrice, currency)}`);
          const rowClass = [row.lowest ? "is-lowest" : "", underTarget ? "is-under-target" : ""].filter(Boolean).join(" ");
          return `<tr data-edit="${escapeAttr(row.id)}" class="${rowClass}" ${titleBits.length ? `title="${escapeAttr(titleBits.join(" · "))}"` : ""}>
            <td class="col-item">
              <div class="item-cell">
                ${thumb ? photoOpenHtml(thumb, "thumb") : ""}
                <div class="item-copy">
                  <a class="item-link" href="#/history/${encodeURIComponent(row.item)}">${escapeHtml(row.item)}</a>
                  ${underTarget ? `<span class="badge badge-target">Under target</span>` : ""}
                  ${row.lowest ? `<span class="badge">Lowest</span>` : ""}
                  ${noteHit ? `<span class="meta">${escapeHtml(row.notes)}</span>` : ""}
                </div>
              </div>
            </td>
            <td class="num col-price">
              <div class="cell-stack">
                <span>${formatMoney(row.price, currency)}</span>
                <span class="meta">${size ? escapeHtml(size) : "Size not set"}</span>
              </div>
            </td>
            <td class="col-store">
              <div class="cell-stack">
                <span>${row.store ? escapeHtml(row.store) : "—"}</span>
                ${row.category ? `<span class="meta">${escapeHtml(row.category)}</span>` : ""}
              </div>
            </td>
            <td class="col-date">${prettyDate(row.checkedAt)}</td>
            <td class="num unit col-unit">
              ${
                row.compared
                  ? `<div class="unit-price"><span class="unit-amount">${formatMoney(row.compared.value, currency)}</span><span class="per">/ ${escapeHtml(row.compared.short)}</span>${deltaHtml(row)}</div>`
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
    const label = countEl.querySelector("span");
    if (label) label.textContent = countText;
    else countEl.textContent = countText;
    return;
  }

  homeMeta = { hasPrices: checks.length > 0, storeNames, categoryNames };
  renderToolbar(parseHash());

  const showing =
    checks.length === 0
      ? ""
      : `<p class="count-line" id="countLine"><span>${countText}</span>
          <button class="ghost compact" type="button" id="freezeToggle">${settings.freezeItemColumn ? "Unfreeze" : "Freeze item"}</button>
        </p>`;

  app.innerHTML = checks.length
    ? `
      ${showing}
      <div class="table-wrap">
        <table class="prices">
          <thead>
            <tr>
              ${head("item", "Item", "col-item")}
              ${head("price", "Price", "col-price", true)}
              ${head("store", "Store", "col-store")}
              ${head("checkedAt", "Date checked", "col-date")}
              ${head("unitPrice", "Unit price", "col-unit", true)}
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
  applyTableChrome();
  window.scrollTo(0, y);
}

function renderAbout() {
  app.innerHTML = `
    <h1 class="page-title">Price list</h1>
    <p class="basis-note">Unit price uses the pack size. Basis: ${escapeHtml(basisSummary(settings))}. The item name opens its price history. A row is marked when the price paid is under that item’s target.</p>
    <div class="about-copy">
      <p>Store and Category at the bottom filter the table. Freeze item keeps the name in view when you scroll sideways. Search filters as you type.</p>
      <p>Prices stay on this device until you export a backup from Settings.</p>
    </div>
  `;
  window.scrollTo(0, 0);
}

async function renderHistory(route) {
  const stamp = routeToken;
  const label = String(route.item || "").trim();
  const checks = annotate(await listChecks())
    .filter((row) => sameName(row.item, label))
    .sort(
      (a, b) =>
        String(a.checkedAt || "").localeCompare(String(b.checkedAt || "")) ||
        String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
    );
  if (stamp !== routeToken) return;
  if (!checks.length) {
    app.innerHTML = `
      <section class="empty">
        <h1>No history for this item</h1>
        <p>Prices for “${escapeHtml(label) || "this item"}” are not on this device.</p>
        <button class="primary" type="button" data-go="#/">Back to the list</button>
      </section>`;
    window.scrollTo(0, 0);
    return;
  }
  const title = checks[checks.length - 1].item || label;
  const latestCurrency = checks[checks.length - 1].currency || settings.currency;
  const chartPoints = checks
    .filter((row) => (row.currency || settings.currency) === latestCurrency && Number.isFinite(Number(row.price)))
    .map((row) => ({ y: Number(row.price), date: row.checkedAt, currency: row.currency || settings.currency }));
  const targetValues = checks.map((row) => Number(row.targetPrice)).filter((value) => value > 0);
  const target = targetValues.length ? targetValues[targetValues.length - 1] : 0;
  const skipped = checks.length - chartPoints.length;
  const byMonth = new Map();
  for (const row of checks) {
    const key = monthKey(row.checkedAt);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(row);
  }
  const months = [...byMonth.keys()].sort((a, b) => b.localeCompare(a));
  const monthHtml = months
    .map((key) => {
      const rows = byMonth
        .get(key)
        .slice()
        .sort((a, b) => String(b.checkedAt || "").localeCompare(String(a.checkedAt || "")));
      const body = rows
        .map((row) => {
          const currency = row.currency || settings.currency;
          const under = isUnderTarget(row);
          return `<tr class="${under ? "is-under-target" : ""}">
            <td class="col-date">${prettyDate(row.checkedAt)}</td>
            <td class="col-store">${row.store ? escapeHtml(row.store) : "—"}</td>
            <td class="col-category">${row.category ? escapeHtml(row.category) : "—"}</td>
            <td class="num col-price">${formatMoney(row.price, currency)}${under ? `<span class="badge badge-target">Under target</span>` : ""}</td>
            <td class="num col-unit">${
              row.compared
                ? `${formatMoney(row.compared.value, currency)} <span class="per">/ ${escapeHtml(row.compared.short)}</span>`
                : "—"
            }</td>
            <td><a href="#/edit/${encodeURIComponent(row.id)}">Edit</a></td>
          </tr>`;
        })
        .join("");
      return `<h2 class="month-title">${escapeHtml(monthLabel(key))}</h2>
        <div class="table-wrap">
          <table class="prices history-table">
            <thead>
              <tr>
                <th class="col-date" scope="col">Date</th>
                <th class="col-store" scope="col">Store</th>
                <th class="col-category" scope="col">Category</th>
                <th class="num col-price" scope="col">Price</th>
                <th class="num col-unit" scope="col">Unit price</th>
                <th scope="col"><span class="visually-hidden">Edit</span></th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>`;
    })
    .join("");

  app.innerHTML = `
    <h1 class="page-title">${escapeHtml(title)}</h1>
    <div class="history-actions">
      <button class="ghost" type="button" id="renameItem" data-item-name="${escapeAttr(title)}">Rename all checks</button>
    </div>
    <p class="basis-note">${checks.length} check${checks.length === 1 ? "" : "s"}, newest first in each month. The line is the price paid in ${escapeHtml(latestCurrency)}.${
      target > 0 ? ` The dashed line is the target, ${escapeHtml(formatMoney(target, latestCurrency))}.` : ""
    }${skipped ? ` ${skipped} check${skipped === 1 ? "" : "s"} in another currency ${skipped === 1 ? "is" : "are"} in the table only.` : ""}</p>
    <div class="chart-card">${historyChart(chartPoints, target)}</div>
    ${monthHtml}
  `;
  window.scrollTo(0, 0);
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
  const categories = knownCategories(checks).sort((a, b) => a.localeCompare(b));
  const currency = value.currency || settings.currency;
  const unit = value.unit || "g";

  app.innerHTML = `
    <h1 class="page-title">${existing ? "Edit price" : "Add price"}</h1>
    <form id="priceForm" class="form">
      <p id="formError" class="form-error" hidden></p>
      <div class="photo-picker">
        <div id="photoPreview">
          ${previewUrl ? photoOpenHtml(previewUrl, "photo-frame") : `<div class="photo-fallback">No photo</div>`}
        </div>
        <div class="footer-links">
          <label class="ghost file-btn">Add image<input id="photoInput" type="file" accept="image/*" /></label>
          <button class="ghost" type="button" id="removePhoto" ${previewUrl ? "" : "hidden"}>Remove image</button>
        </div>
      </div>
      ${itemFieldsHtml(value, itemNames)}
      <div class="row">
        <label>Price
          ${clearable(`<input name="price" type="number" inputmode="decimal" min="0" step="any" required value="${value.price ?? ""}" />`)}
        </label>
        <label>Currency
          <select name="currency">${currencyOptions(currency)}</select>
        </label>
      </div>
      <div class="row">
        <div>
          <label class="field">Store
            <select name="storePick" data-choice="store">${choiceOptions(stores, value.store || "", "No store", "New store…")}</select>
          </label>
          ${clearable(
            `<input class="choice-custom" name="storeCustom" placeholder="New store" autocomplete="off" value="${escapeAttr(choiceCustomValue(stores, value.store || ""))}" />`,
            choiceHidden(stores, value.store || "")
          )}
        </div>
        <div>
          <label class="field">Category
            <select name="categoryPick" data-choice="category">${choiceOptions(categories, value.category || "", "No category", "New category…")}</select>
          </label>
          ${clearable(
            `<input class="choice-custom" name="categoryCustom" placeholder="New category" autocomplete="off" value="${escapeAttr(choiceCustomValue(categories, value.category || ""))}" />`,
            choiceHidden(categories, value.category || "")
          )}
        </div>
      </div>
      <label>Target price
        ${clearable(`<input name="targetPrice" type="number" inputmode="decimal" min="0" step="any" value="${value.targetPrice ?? ""}" placeholder="Optional" />`)}
      </label>
      <p class="hint">Optional. Shared by every check with this item name. The list marks a row when the price you paid goes under it.</p>
      <label>Date checked
        ${clearable(`<input name="checkedAt" type="date" required value="${escapeAttr(value.checkedAt || todayIso())}" />`)}
      </label>
      <div class="row">
        <label>Pack size
          ${clearable(`<input name="quantity" type="number" inputmode="decimal" min="0" step="any" value="${value.quantity ?? ""}" placeholder="350" />`)}
        </label>
        <label>Unit
          <select name="unit">${unitOptions(unit)}</select>
        </label>
      </div>
      <p class="hint">Pack size is how the unit price is calculated. 350 g at the per 100 g basis, 2 m at the per meter basis. Use the same item name each time you check that product.</p>
      <label>Notes
        ${clearable(`<textarea name="notes" placeholder="Optional">${escapeHtml(value.notes || "")}</textarea>`)}
      </label>
      <div class="form-actions">
        <button class="primary" type="submit">Save</button>
        ${existing ? `<a class="ghost" href="#/history/${encodeURIComponent(existing.item || "")}">Price history</a>` : ""}
        ${existing ? `<button class="ghost" type="button" id="cloneItem">Clone</button>` : ""}
        ${existing ? `<button class="ghost" type="button" id="logAgain">Check again</button>` : ""}
        ${existing ? `<button class="danger" type="button" id="deleteCheck">Delete</button>` : ""}
      </div>
      ${
        existing
          ? `<p class="hint">Check again starts a new price for this item, with today’s date and a blank amount — use it when you see the same product at another store. Clone copies this row as-is, including the amount.</p>`
          : ""
      }
    </form>
  `;
  window.scrollTo(0, 0);
}

async function rememberName(listKey, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return;
  const list = settings[listKey] || [];
  if (list.some((item) => item.toLowerCase() === trimmed.toLowerCase())) return;
  settings[listKey] = [...list, trimmed];
  settings = await saveSettings(settings);
}

async function rememberStore(name) {
  return rememberName("stores", name);
}

async function rememberCategory(name) {
  return rememberName("categories", name);
}

async function shareTarget(item, targetPrice) {
  const checks = await listChecks();
  for (const row of checks) {
    if (!sameName(row.item, item)) continue;
    const current = Number(row.targetPrice) > 0 ? Number(row.targetPrice) : null;
    if (current === targetPrice) continue;
    await saveCheck({ ...row, targetPrice });
  }
}

function readPriceForm(form) {
  const data = new FormData(form);
  const quantityRaw = String(data.get("quantity") ?? "").trim();
  const quantity = quantityRaw === "" ? null : Number(quantityRaw);
  const targetRaw = String(data.get("targetPrice") ?? "").trim();
  const targetNumber = targetRaw === "" ? null : Number(targetRaw);
  const itemPick = form.querySelector("#itemPick")?.value;
  const itemName =
    itemPick && itemPick !== CUSTOM_VALUE ? itemPick : String(data.get("item") || "").trim();
  return {
    item: itemName,
    price: Number(data.get("price")),
    currency: String(data.get("currency") || settings.currency),
    store: resolveChoice(form, "store"),
    category: resolveChoice(form, "category"),
    targetPrice: Number.isFinite(targetNumber) && targetNumber > 0 ? targetNumber : null,
    targetRaw,
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
    slot.innerHTML = `<div class="photo-fallback">No photo</div>`;
    if (remove) remove.hidden = true;
    return;
  }
  slot.innerHTML = photoOpenHtml(url, "photo-frame");
  if (remove) remove.hidden = false;
}

async function renderSettings() {
  const storeItems = (settings.stores || []).map((name, index) => ({ name, index }));
  const categoryItems = (settings.categories || []).map((name, index) => ({ name, index }));
  const keys = [
    "settings:theme",
    "settings:table",
    "settings:currency",
    "settings:basis",
    "settings:stores",
    "settings:categories",
    "settings:backup",
  ];
  app.innerHTML = `
    <h1 class="page-title">Settings</h1>
    <p class="hint">Saved in this browser. Prices stay on this device until you export a backup and import it on your phone or this Mac. Live sync is not connected.</p>
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
        "settings:table",
        "Table",
        `<p class="hint">The table uses a share of the screen width, so columns grow and shrink when you zoom. On a computer, drag the edge of a column heading to resize. On iPhone, freeze the item column if you scroll sideways.</p>
        <label class="check-row">
          <input id="freezeItemColumn" type="checkbox" ${settings.freezeItemColumn ? "checked" : ""} />
          Freeze item column
        </label>
        <div class="footer-links">
          <button class="ghost" type="button" id="resetColWidths">Reset column widths</button>
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
        ${clearable(`<input class="search" id="storeSearch" type="search" placeholder="Search stores" value="${escapeAttr(storeQuery)}" autocomplete="off" />`)}
        <ul class="edit-list" id="storeList">
          ${
            storeItems.length
              ? storeItems
                  .map(
                    ({ name, index }) => `<li>
                      ${clearable(`<input data-store-index="${index}" value="${escapeAttr(name)}" />`)}
                      <button type="button" class="danger compact" data-del-store="${index}">Delete</button>
                    </li>`
                  )
                  .join("")
              : `<li class="hint">No stores yet. You can also type a new store when you add a price.</li>`
          }
          <li class="hint" id="storeEmpty" hidden>No stores match.</li>
        </ul>
        <div class="add-row">
          ${clearable(`<input id="newStore" placeholder="New store" />`)}
          <button type="button" class="primary" id="addStore">Add</button>
        </div>`
      )}
      ${fold(
        "settings:categories",
        "Categories",
        `<p class="hint">These fill the category menu on the price list and on each price. Renaming a category updates prices that use it.</p>
        ${clearable(`<input class="search" id="categorySearch" type="search" placeholder="Search categories" value="${escapeAttr(categoryQuery)}" autocomplete="off" />`)}
        <ul class="edit-list" id="categoryList">
          ${
            categoryItems.length
              ? categoryItems
                  .map(
                    ({ name, index }) => `<li>
                      ${clearable(`<input data-category-index="${index}" value="${escapeAttr(name)}" />`)}
                      <button type="button" class="danger compact" data-del-category="${index}">Delete</button>
                    </li>`
                  )
                  .join("")
              : `<li class="hint">No categories yet.</li>`
          }
          <li class="hint" id="categoryEmpty" hidden>No categories match.</li>
        </ul>
        <div class="add-row">
          ${clearable(`<input id="newCategory" placeholder="New category" />`)}
          <button type="button" class="primary" id="addCategory">Add</button>
        </div>`
      )}
      ${fold(
        "settings:backup",
        "Phone and Mac",
        `<p class="hint">There is no live link between your phone and this Mac. Export a backup here, then import that file in the other browser. The backup includes photos. Import replaces prices on the device that imports it. CSV is the table only, without photos.</p>
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
  filterCategoryList();
}

function filterNamedList(listId, attr, emptyId, query, total) {
  const q = query.trim().toLowerCase();
  let shown = 0;
  app.querySelectorAll(`#${listId} [${attr}]`).forEach((input) => {
    const li = input.closest("li");
    const match = !q || input.value.toLowerCase().includes(q);
    if (li) li.hidden = !match;
    if (match) shown += 1;
  });
  const empty = app.querySelector(`#${emptyId}`);
  if (empty) empty.hidden = shown !== 0 || !total;
}

function filterStoreList() {
  filterNamedList("storeList", "data-store-index", "storeEmpty", storeQuery, (settings.stores || []).length);
}

function filterCategoryList() {
  filterNamedList(
    "categoryList",
    "data-category-index",
    "categoryEmpty",
    categoryQuery,
    (settings.categories || []).length
  );
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
  const freeze = form.querySelector("#freezeItemColumn");
  if (freeze) settings.freezeItemColumn = freeze.checked;
}

async function persistSettingsFromForm(form) {
  if (form) readBasisForm(form);
  settings = await saveSettings(settings);
  applyTheme(settings.theme);
  applyTableChrome();
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
  const header = [
    "item",
    "price",
    "currency",
    "store",
    "category",
    "target price",
    "date checked",
    "quantity",
    "unit",
    "unit price",
    "unit basis",
    "notes",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.item,
        row.price,
        row.currency || settings.currency,
        row.store || "",
        row.category || "",
        row.targetPrice ?? "",
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
  closeLightbox();
  const token = ++routeToken;
  const current = parseHash();
  renderToolbar(current);
  try {
    if (!settings) settings = await getSettings();
    if (token !== routeToken) return;
    applyTheme(settings.theme || localStorage.getItem("vspt-theme") || "light");
    applyTableChrome();
    if (current.name === "home") await renderHome();
    else if (current.name === "settings") await renderSettings();
    else if (current.name === "about") renderAbout();
    else if (current.name === "history") await renderHistory(current);
    else await renderForm(current);
  } catch (error) {
    console.error(error);
    if (token !== routeToken) return;
    app.innerHTML = `<section class="empty"><h1>Could not open the price list</h1><p>Reload the page. Prices stay on this device unless browser data was cleared.</p></section>`;
  }
}

async function handleRename(currentName) {
  const from = String(currentName || "").trim();
  if (!from) return;
  const next = prompt(`Rename every check named “${from}”? This changes the whole group. To rename one variety only, edit that price and pick New item.`, from);
  if (next == null) return;
  const name = next.trim();
  if (!name) return;
  if (sameName(name, from)) return;
  const existing = (await listChecks()).some((row) => sameName(row.item, name));
  if (existing && !confirm(`“${name}” already exists. Merge these checks into that item?`)) return;
  const count = await renameItem(from, name);
  if (!count) {
    alert("No checks used that name.");
    return;
  }
  const current = parseHash();
  if (current.name === "history") {
    go(`#/history/${encodeURIComponent(name)}`);
    return;
  }
  const input = app.querySelector("[name=item]");
  if (input) input.value = name;
  const button = app.querySelector("#renameItem");
  if (button) button.dataset.itemName = name;
  if (session?.record) session.record.item = name;
  const historyLink = app.querySelector('a.ghost[href^="#/history/"]');
  if (historyLink) historyLink.href = `#/history/${encodeURIComponent(name)}`;
}

document.querySelector("#shell").addEventListener("click", async (event) => {
  const photo = event.target.closest("[data-photo-src]");
  if (photo?.dataset.photoSrc) {
    event.preventDefault();
    openLightbox(photo.dataset.photoSrc);
    return;
  }

  const clearBtn = event.target.closest("[data-clear]");
  if (clearBtn) {
    event.preventDefault();
    const field = clearBtn.parentElement?.querySelector("input, textarea");
    if (field) {
      field.value = "";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      field.focus();
    }
    return;
  }

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

  if (event.target.id === "freezeToggle") {
    settings.freezeItemColumn = !settings.freezeItemColumn;
    settings = await saveSettings(settings);
    applyTableChrome();
    event.target.textContent = settings.freezeItemColumn ? "Unfreeze" : "Freeze item";
    const box = document.querySelector("#freezeItemColumn");
    if (box) box.checked = settings.freezeItemColumn;
    return;
  }

  if (event.target.id === "resetColWidths") {
    settings.colWidths = { ...DEFAULT_COL_WIDTHS };
    settings = await saveSettings(settings);
    applyTableChrome();
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

  if (event.target.id === "addCategory") {
    const input = app.querySelector("#newCategory");
    const name = input?.value.trim();
    if (!name) return;
    if ((settings.categories || []).some((category) => category.toLowerCase() === name.toLowerCase())) {
      input.value = "";
      return;
    }
    settings.categories = [...(settings.categories || []), name];
    settings = await saveSettings(settings);
    categoryQuery = "";
    await renderSettings();
    return;
  }

  const delCategory = event.target.closest("[data-del-category]")?.dataset.delCategory;
  if (delCategory !== undefined) {
    const index = Number(delCategory);
    const name = settings.categories[index];
    if (!name) return;
    if (!confirm(`Remove “${name}” from the category list? Prices keep that category until you edit them.`)) return;
    settings.categories = settings.categories.filter((_, i) => i !== index);
    if (categoryFilter === name) categoryFilter = "all";
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

  if (event.target.id === "renameItem") {
    await handleRename(event.target.dataset.itemName || app.querySelector("[name=item]")?.value);
    return;
  }

  if (event.target.id === "cloneItem") {
    const form = app.querySelector("#priceForm");
    if (!form || !session) return;
    const data = readPriceForm(form);
    let blob = session.photoBlob;
    if (!blob && !session.removePhoto && session.id) blob = await getPhoto(session.id);
    if (session.removePhoto) blob = null;
    draft = { ...data, photoBlob: blob };
    if (session.previewOwned && session.previewUrl) URL.revokeObjectURL(session.previewUrl);
    session = null;
    go("#/new");
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
    const pendingCategory = app.querySelector("#newCategory")?.value.trim();
    if (
      pendingCategory &&
      !(settings.categories || []).some((category) => category.toLowerCase() === pendingCategory.toLowerCase())
    ) {
      settings.categories = [...(settings.categories || []), pendingCategory];
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
  if (data.targetRaw && data.targetPrice == null) {
    showFormError("Target price needs to be a number above zero, or leave it blank.");
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
      category: data.category,
      targetPrice: data.targetPrice,
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
    await rememberCategory(data.category);
    await shareTarget(data.item, data.targetPrice);
    session = null;
    go("#/");
  } catch (error) {
    console.error(error);
    showFormError("Could not save that price.");
    if (button) button.disabled = false;
  }
});

document.querySelector("#shell").addEventListener("change", async (event) => {
  if (event.target.dataset.choice) {
    toggleChoiceCustom(event.target);
    return;
  }

  if (event.target.id === "itemPick" || event.target.dataset.itemPick !== undefined) {
    const select = event.target;
    const field = app.querySelector("#itemNameField");
    const input = app.querySelector("[name=item]");
    if (!input) return;
    if (select.value === CUSTOM_VALUE) {
      if (field) field.hidden = false;
      if (!input.value && session?.record?.item) input.value = session.record.item;
      input.focus();
      return;
    }
    input.value = select.value;
    if (field) field.hidden = true;
    return;
  }

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

  if (event.target.id === "storeFilter") {
    storeFilter = event.target.value || "all";
    await renderHome({ keepScroll: true, partial: true });
    return;
  }

  if (event.target.id === "categoryFilter") {
    categoryFilter = event.target.value || "all";
    await renderHome({ keepScroll: true, partial: true });
    return;
  }

  if (event.target.dataset.categoryIndex !== undefined) {
    const index = Number(event.target.dataset.categoryIndex);
    const prev = settings.categories[index];
    const next = event.target.value.trim();
    if (!next || next === prev) {
      event.target.value = prev || "";
      return;
    }
    if (settings.categories.some((category, i) => i !== index && category.toLowerCase() === next.toLowerCase())) {
      event.target.value = prev;
      alert("That category is already in the list.");
      return;
    }
    const checks = await listChecks();
    for (const row of checks) {
      if (row.category === prev) await saveCheck({ ...row, category: next });
    }
    settings.categories[index] = next;
    if (categoryFilter === prev) categoryFilter = next;
    settings = await saveSettings(settings);
    return;
  }

  if (event.target.id === "freezeItemColumn") {
    settings.freezeItemColumn = event.target.checked;
    settings = await saveSettings(settings);
    applyTableChrome();
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
    return;
  }
  if (event.target.id === "categorySearch") {
    categoryQuery = event.target.value;
    filterCategoryList();
  }
});

function applyResizeFromPointer(event) {
  if (!resizing) return;
  const sign = COL_KEYS.indexOf(resizing.key) < COL_KEYS.indexOf(resizing.other) ? 1 : -1;
  const delta = ((event.clientX - resizing.startX) / resizing.wrapW) * 100 * sign;
  let a = resizing.startA + delta;
  let b = resizing.startB - delta;
  const min = 10;
  if (a < min) {
    b -= min - a;
    a = min;
  }
  if (b < min) {
    a -= min - b;
    b = min;
  }
  settings.colWidths = { ...(settings.colWidths || DEFAULT_COL_WIDTHS), [resizing.key]: a, [resizing.other]: b };
  applyTableChrome();
}

async function endResize() {
  if (!resizing) return;
  resizing.wrap?.classList.remove("is-resizing");
  resizing = null;
  settings = await saveSettings(settings);
}

function cancelResize() {
  if (!resizing) return;
  resizing.wrap?.classList.remove("is-resizing");
  resizing = null;
}

document.querySelector("#shell").addEventListener("pointerdown", (event) => {
  const handle = event.target.closest("[data-resize]");
  if (!handle) return;
  const key = handle.dataset.resize;
  const other = neighborCol(key);
  const wrap = handle.closest(".table-wrap");
  if (!key || !other || !wrap || !settings) return;
  event.preventDefault();
  const widths = { ...(settings.colWidths || DEFAULT_COL_WIDTHS) };
  resizing = {
    key,
    other,
    startX: event.clientX,
    startA: Number(widths[key]) || DEFAULT_COL_WIDTHS[key],
    startB: Number(widths[other]) || DEFAULT_COL_WIDTHS[other],
    wrapW: wrap.clientWidth || 1,
    wrap,
    pointerId: event.pointerId,
  };
  handle.setPointerCapture?.(event.pointerId);
  wrap.classList.add("is-resizing");
});

window.addEventListener("resize", () => applyTableChrome());
window.visualViewport?.addEventListener("resize", () => applyTableChrome());
window.addEventListener("pointermove", applyResizeFromPointer);
window.addEventListener("pointerup", endResize);
window.addEventListener("pointercancel", cancelResize);

document.querySelector("#shell").addEventListener(
  "wheel",
  (event) => {
    if (event.target.type === "number" && document.activeElement === event.target) event.target.blur();
  },
  { passive: true }
);

document.querySelector("#lightbox")?.addEventListener("click", (event) => {
  if (event.target.id === "lightbox" || event.target.closest("[data-lightbox-close]") || event.target.id === "lightboxImg") {
    closeLightbox();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeLightbox();
});

window.addEventListener("hashchange", route);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

applyTheme(localStorage.getItem("vspt-theme") || "light");
route();
