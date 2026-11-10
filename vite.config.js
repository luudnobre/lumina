import { defineConfig, loadEnv } from "vite";
import { isPublicKey } from "./src/config.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (key && !isPublicKey(key)) {
    throw new Error(
      "Use a chave publicável (sb_publishable_...) ou a anon legada do Supabase.",
    );
  }
  return {};
});
