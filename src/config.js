export function isPublicKey(key) {
  if (typeof key !== "string") return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  try {
    const parts = key.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return payload.role === "anon";
  } catch {
    return false;
  }
}

export function readCloudConfig(rawUrl, rawKey) {
  const key = rawKey?.trim();
  try {
    const url = new URL(rawUrl?.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      /seu-projeto/i.test(url.hostname) ||
      !isPublicKey(key) ||
      key === "sb_publishable_SUA_CHAVE_PUBLICA"
    )
      return null;
    return { url: url.origin, key };
  } catch {
    return null;
  }
}
