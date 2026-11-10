const SHELL = "lumina-shell-v2";

function controllerIsSafe() {
  const worker = navigator.serviceWorker.controller;
  if (!worker) return Promise.resolve(true);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (result) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(result);
    };
    const timer = setTimeout(() => finish(false), 500);
    channel.port1.onmessage = (event) => finish(event.data === SHELL);
    try {
      worker.postMessage("lumina-shell-version", [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

export async function prepareShell() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const registration = navigator.serviceWorker.register("/sw.js", {
    updateViaCache: "none",
  });
  if (!navigator.serviceWorker.controller || (await controllerIsSafe())) {
    void registration.catch(() => {});
    return;
  }

  // The older worker cached all GET requests. Open the cloud connection only
  // after the controlling worker has switched to the public-shell allowlist.
  const update = await registration;
  await new Promise((resolve, reject) => {
    const verify = async () => {
      if (await controllerIsSafe()) finish();
    };
    const finish = (error) => {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", verify);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error("A atualização precisa de uma recarga.")),
      12000,
    );
    navigator.serviceWorker.addEventListener("controllerchange", verify);
    void update.update().catch(() => {});
    void verify();
  });
}
