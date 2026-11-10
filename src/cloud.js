import { createClient } from "@supabase/supabase-js";
import { readCloudConfig } from "./config.js";
import { normalizeState } from "./state.js";

export let supabase = null;

export function startSupabase() {
  const settings = readCloudConfig(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );
  if (settings && !supabase) {
    supabase = createClient(settings.url, settings.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
}

export const PHOTO_BUCKET = "lumina-private-photos";

export function documentRemote(client, userId) {
  return {
    async read() {
      const { data, error } = await client
        .from("lumina_documents")
        .select("document, revision, updated_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        state: normalizeState(data.document),
        revision: Number(data.revision),
        updatedAt: data.updated_at,
      };
    },
    async write(state, revision) {
      const { data, error } = await client.rpc("lumina_save_document", {
        p_user_id: userId,
        p_document: state,
        p_expected_revision: revision,
      });
      if (error) throw error;
      return data?.[0]
        ? { revision: Number(data[0].revision), updatedAt: data[0].updated_at }
        : null;
    },
  };
}

export function sessionDraft(userId) {
  const key = "lumina_pending_v2:" + userId;
  return {
    read() {
      try {
        const draft = JSON.parse(sessionStorage.getItem(key));
        if (
          !draft ||
          !Number.isSafeInteger(draft.revision) ||
          draft.revision < 0
        )
          return null;
        return { revision: draft.revision, state: normalizeState(draft.state) };
      } catch {
        return null;
      }
    },
    write(revision, state) {
      try {
        sessionStorage.setItem(key, JSON.stringify({ revision, state }));
      } catch {
        /* keep the draft in memory */
      }
    },
    clear() {
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* private browsing may block storage */
      }
    },
  };
}
