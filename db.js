/**
 * Local price checks (IndexedDB).
 * Photos and prices stay on this device. Records use UUIDs and updatedAt
 * so a later sync layer can wrap these functions without changing screens.
 */

const DB_NAME = "vs-price-tracker";
const DB_VERSION = 1;

export const CURRENCIES = ["JPY", "PHP", "USD"];

export const DEFAULT_SETTINGS = {
  theme: "light",
  currency: "JPY",
  weightBasis: "100g",
  volumeBasis: "100ml",
  lengthBasis: "1m",
  stores: [],
};

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("checks")) {
        db.createObjectStore("checks", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("photos")) {
        db.createObjectStore("photos", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Database transaction aborted"));
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listChecks() {
  const db = await openDb();
  const tx = db.transaction("checks", "readonly");
  const rows = (await requestToPromise(tx.objectStore("checks").getAll())) || [];
  await txDone(tx);
  return rows;
}

export async function getCheck(id) {
  const db = await openDb();
  const tx = db.transaction("checks", "readonly");
  const row = (await requestToPromise(tx.objectStore("checks").get(id))) || null;
  await txDone(tx);
  return row;
}

export async function saveCheck(check) {
  const row = { ...check, updatedAt: new Date().toISOString() };
  const db = await openDb();
  const tx = db.transaction("checks", "readwrite");
  tx.objectStore("checks").put(row);
  await txDone(tx);
  return row;
}

export async function deleteCheck(id) {
  const db = await openDb();
  const tx = db.transaction(["checks", "photos"], "readwrite");
  tx.objectStore("checks").delete(id);
  tx.objectStore("photos").delete(id);
  await txDone(tx);
}

export async function savePhoto(id, blob) {
  const db = await openDb();
  const tx = db.transaction("photos", "readwrite");
  tx.objectStore("photos").put({ id, blob });
  await txDone(tx);
}

export async function getPhoto(id) {
  const db = await openDb();
  const tx = db.transaction("photos", "readonly");
  const row = await requestToPromise(tx.objectStore("photos").get(id));
  await txDone(tx);
  return row?.blob || null;
}

export async function deletePhoto(id) {
  const db = await openDb();
  const tx = db.transaction("photos", "readwrite");
  tx.objectStore("photos").delete(id);
  await txDone(tx);
}

function cleanSettings(next) {
  const currency = CURRENCIES.includes(next?.currency) ? next.currency : DEFAULT_SETTINGS.currency;
  const stores = Array.isArray(next?.stores)
    ? next.stores.map((name) => String(name).trim()).filter(Boolean)
    : [];
  return {
    id: "app",
    theme: next?.theme === "dark" ? "dark" : "light",
    currency,
    weightBasis: next?.weightBasis || DEFAULT_SETTINGS.weightBasis,
    volumeBasis: next?.volumeBasis || DEFAULT_SETTINGS.volumeBasis,
    lengthBasis: next?.lengthBasis || DEFAULT_SETTINGS.lengthBasis,
    stores,
    updatedAt: new Date().toISOString(),
  };
}

export async function getSettings() {
  const db = await openDb();
  const tx = db.transaction("settings", "readonly");
  const row = (await requestToPromise(tx.objectStore("settings").get("app"))) || null;
  await txDone(tx);
  return { ...DEFAULT_SETTINGS, ...(row || {}), stores: row?.stores || [] };
}

export async function saveSettings(next) {
  const row = cleanSettings(next);
  const db = await openDb();
  const tx = db.transaction("settings", "readwrite");
  tx.objectStore("settings").put(row);
  await txDone(tx);
  return row;
}

async function listPhotosEncoded() {
  const db = await openDb();
  const tx = db.transaction("photos", "readonly");
  const photos = (await requestToPromise(tx.objectStore("photos").getAll())) || [];
  await txDone(tx);
  return Promise.all(
    photos.map(
      (row) =>
        new Promise((resolve) => {
          if (!row?.blob) {
            resolve(null);
            return;
          }
          const reader = new FileReader();
          reader.onload = () => resolve({ id: row.id, dataUrl: reader.result });
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(row.blob);
        })
    )
  ).then((rows) => rows.filter(Boolean));
}

export async function exportData() {
  const checks = await listChecks();
  const settings = await getSettings();
  const photos = await listPhotosEncoded();
  return {
    app: "vs-price-tracker",
    version: 1,
    exportedAt: new Date().toISOString(),
    checks,
    photos,
    settings: {
      theme: settings.theme,
      currency: settings.currency,
      weightBasis: settings.weightBasis,
      volumeBasis: settings.volumeBasis,
      lengthBasis: settings.lengthBasis,
      stores: settings.stores || [],
    },
  };
}

export async function importData(payload) {
  if (payload?.app !== "vs-price-tracker" || !Array.isArray(payload.checks)) {
    throw new Error("Invalid backup file");
  }
  const db = await openDb();
  const tx = db.transaction(["checks", "photos"], "readwrite");
  tx.objectStore("checks").clear();
  tx.objectStore("photos").clear();
  for (const row of payload.checks) {
    if (row?.id) tx.objectStore("checks").put(row);
  }
  await txDone(tx);
  for (const photo of payload.photos || []) {
    if (!photo?.id || !photo?.dataUrl) continue;
    const blob = await (await fetch(photo.dataUrl)).blob();
    await savePhoto(photo.id, blob);
  }
  if (payload.settings) return saveSettings(payload.settings);
  return getSettings();
}
