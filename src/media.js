import { id, validDataImage } from "./state.js";

const STORE = "photos";
const MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const EXT_TO_MIME = Object.fromEntries(
  Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime]),
);

async function openPhotoDb(name) {
  if (!globalThis.indexedDB)
    throw new Error("Este navegador não abriu o armazenamento de fotos.");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Feche a outra aba do LUMINA e tente novamente."));
  });
}

function runPhotoTransaction(db, mode, callback) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    let request;
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onabort = () =>
      reject(
        transaction.error || new Error("O navegador não concluiu a operação."),
      );
    transaction.onerror = () =>
      reject(
        transaction.error || new Error("Não foi possível acessar as fotos."),
      );
    try {
      request = callback(transaction.objectStore(STORE));
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

export async function openDemoPhotos() {
  const db = await openPhotoDb("lumina_demo_media_v2");
  return {
    list: () => runPhotoTransaction(db, "readonly", (store) => store.getAll()),
    put: (photo) =>
      runPhotoTransaction(db, "readwrite", (store) => store.put(photo)),
    delete: (photoId) =>
      runPhotoTransaction(db, "readwrite", (store) => store.delete(photoId)),
    replace: (photos) =>
      runPhotoTransaction(db, "readwrite", (store) => {
        store.clear();
        for (const photo of photos) store.put(photo);
      }),
    close: () => db.close(),
  };
}

export async function legacyPhotos() {
  const db = await openPhotoDb("lumina_media_v1");
  try {
    return await runPhotoTransaction(db, "readonly", (store) => store.getAll());
  } finally {
    db.close();
  }
}

export function dataImageBlob(dataUrl) {
  if (!validDataImage(dataUrl)) throw new Error("Formato de imagem inválido.");
  const separator = dataUrl.indexOf(",");
  const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
  const bytes = Uint8Array.from(
    atob(dataUrl.slice(separator + 1)),
    (character) => character.charCodeAt(0),
  );
  if (bytes.length > 5 * 1024 * 1024) throw new Error("A imagem excede 5 MB.");
  return new Blob([bytes], { type: mime });
}

export function asDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function compressImage(file) {
  if (
    !file.type.startsWith("image/") ||
    file.type === "image/svg+xml" ||
    file.size > 20 * 1024 * 1024
  ) {
    throw new Error("Escolha uma imagem JPG, PNG, WebP ou GIF de até 20 MB.");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () =>
        reject(new Error("Não foi possível abrir esta imagem."));
      image.src = url;
    });
    const scale = Math.min(
      1600 / image.naturalWidth,
      1600 / image.naturalHeight,
      1,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.83);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function cloudPhotos(bucket, userId) {
  const owns = (path) =>
    typeof path === "string" &&
    path.startsWith(userId + "/") &&
    /^[A-Za-z0-9_-]+\.(jpg|png|webp|gif)$/.test(path.slice(userId.length + 1));
  return {
    async put(photo) {
      const { dataUrl, ...meta } = photo;
      const image = dataImageBlob(dataUrl);
      const path = userId + "/" + id("image") + "." + MIME_TO_EXT[image.type];
      const { error } = await bucket.upload(path, image, {
        contentType: image.type,
        upsert: false,
      });
      if (error) throw error;
      return { ...meta, path };
    },
    async get(path) {
      if (!owns(path)) throw new Error("Foto fora desta conta.");
      const { data, error } = await bucket.download(path);
      if (error) throw error;
      const mime = EXT_TO_MIME[path.split(".").at(-1)];
      return new Blob([data], { type: mime });
    },
    async remove(paths) {
      const valid = [...new Set(paths.filter(owns))];
      for (let index = 0; index < valid.length; index += 100) {
        const { error } = await bucket.remove(valid.slice(index, index + 100));
        if (error) throw error;
      }
    },
  };
}
