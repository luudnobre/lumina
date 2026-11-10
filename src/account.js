import { supabase } from "./cloud.js";

export function cloudMessage(error) {
  const code = error?.code;
  if (["42P01", "PGRST205", "PGRST202", "42501"].includes(code)) {
    return "Confira a estrutura do banco. Execute o arquivo supabase/01-estrutura.sql no mesmo projeto do Supabase.";
  }
  if (code === "23514" || code === "54000") {
    return "O espaço atingiu o limite de texto. Exporte um backup antes de reduzir os registros.";
  }
  if (error?.message === "Failed to fetch" || !navigator.onLine)
    return "Sem conexão com a nuvem. Tente novamente ao voltar à internet.";
  return "Não foi possível conectar ao Supabase. Confira a URL, a chave publicável e a conexão.";
}

const messages = {
  loading: ["Conectando seu espaço.", "Estamos abrindo seus registros."],
  login: ["Bem-vinda de volta.", "Entre com o e-mail e a senha da sua conta."],
  reset: [
    "Recupere sua senha.",
    "Informe o e-mail da sua conta para solicitar um link de recuperação.",
  ],
  password: [
    "Escolha uma nova senha.",
    "Use uma senha de pelo menos oito caracteres.",
  ],
  demo: [
    "Experimente o LUMINA.",
    "Esta é uma demonstração local. Seus testes ficam neste navegador.",
  ],
  setup: [
    "Conecte seu Supabase.",
    "Abra o guia do ZIP e configure as duas variáveis do projeto na Vercel.",
  ],
  error: [
    "Seu espaço ainda não abriu.",
    "Confira a conexão ou a configuração do Supabase.",
  ],
};

export function bindAccount({ unlockCloud, unlockDemo, lock, canSignOut }) {
  const find = (id) => document.getElementById(id);
  const gate = find("authGate");
  const form = find("authForm");
  const email = find("authEmail");
  const emailLabel = email.closest("label");
  const password = find("authPassword");
  const passwordLabel = find("authPasswordLabel");
  const switchMode = find("authSwitch");
  const submit = find("authSubmit");
  const retry = find("retryConnection");
  const signOutButton = find("gateLogout");
  const notice = find("authMessage");
  let mode = "loading";
  let currentSession = null;
  let openingUser = null;
  let generation = 0;
  let recovering = false;
  let busy = false;

  function message(text = "") {
    notice.textContent = text;
    notice.hidden = !text;
  }

  function show(next, text = "") {
    mode = next;
    gate.hidden = false;
    find("authEyebrow").textContent =
      next === "demo" ? "MODO LOCAL" : "LUMINA NA NUVEM";
    [find("authHeading").textContent, find("authDescription").textContent] =
      messages[next];
    form.hidden = !["login", "reset", "password"].includes(next);
    emailLabel.hidden = next === "password";
    email.required = !emailLabel.hidden;
    passwordLabel.hidden = next === "reset";
    password.required = !passwordLabel.hidden;
    password.autocomplete =
      next === "password" ? "new-password" : "current-password";
    password.minLength = next === "password" ? 8 : 0;
    submit.textContent =
      next === "reset"
        ? "Enviar link"
        : next === "password"
          ? "Salvar nova senha"
          : "Entrar";
    switchMode.hidden = !["login", "reset", "password"].includes(next);
    switchMode.textContent =
      next === "login" ? "Esqueci minha senha" : "Voltar ao login";
    find("demoStart").hidden = next !== "demo";
    retry.hidden = next !== "error";
    signOutButton.hidden = next !== "error" || !currentSession;
    message(text);
  }

  function lockGate(next, text = "") {
    generation += 1;
    openingUser = null;
    lock();
    show(next, text);
  }

  async function open(session, force = false) {
    currentSession = session;
    if (!session?.user) {
      lockGate("login");
      return;
    }
    if (recovering || (!force && openingUser === session.user.id)) return;
    lockGate("loading");
    openingUser = session.user.id;
    const run = generation;
    try {
      await unlockCloud(session.user, () => run === generation);
      if (run !== generation) return;
      gate.hidden = true;
      password.value = "";
      message();
    } catch (error) {
      if (run !== generation) return;
      openingUser = null;
      show("error", cloudMessage(error));
    }
  }

  async function signOut() {
    if (!supabase || busy || !(await canSignOut()) || busy) return;
    busy = true;
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      recovering = false;
      currentSession = null;
      email.value = "";
      password.value = "";
      lockGate("login");
    } catch {
      if (gate.hidden) {
        const status = find("syncLabel");
        status.textContent = "Tente sair novamente";
      } else {
        message("Não foi possível sair da conta. Tente novamente.");
      }
    } finally {
      busy = false;
    }
  }

  retry.onclick = () => open(currentSession, true);
  signOutButton.onclick = signOut;
  find("signOutBtn").onclick = signOut;
  switchMode.onclick = () => {
    password.value = "";
    if (mode === "password") signOut();
    else show(mode === "reset" ? "login" : "reset");
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy || !supabase) return;
    busy = true;
    submit.disabled = true;
    switchMode.disabled = true;
    message();
    const action = mode;
    try {
      if (action === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.value.trim(),
          {
            redirectTo: location.origin + "/",
          },
        );
        if (error) throw error;
        message("Solicitação enviada. Confira o e-mail e a caixa de spam.");
      } else if (action === "password") {
        const { error } = await supabase.auth.updateUser({
          password: password.value,
        });
        if (error) throw error;
        recovering = false;
        await open(currentSession, true);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.value.trim(),
          password: password.value,
        });
        if (error) throw error;
        await open(data.session);
      }
    } catch (error) {
      const rate = error?.status === 429;
      message(
        rate
          ? "Aguarde um pouco antes de tentar novamente."
          : action === "login"
            ? "Confira o e-mail e a senha criados no Supabase."
            : action === "reset"
              ? "Não foi possível enviar o link. Confira o envio de e-mails no Supabase."
              : "Não foi possível alterar a senha. Solicite um novo link de recuperação.",
      );
    } finally {
      submit.disabled = false;
      switchMode.disabled = false;
      busy = false;
    }
  };

  find("demoStart").onclick = async () => {
    if (!import.meta.env.DEV || supabase || busy) return;
    busy = true;
    try {
      await unlockDemo();
      gate.hidden = true;
    } catch {
      message("Não foi possível abrir a demonstração neste navegador.");
    } finally {
      busy = false;
    }
  };

  if (!supabase) {
    show(import.meta.env.DEV ? "demo" : "setup");
    return;
  }

  show("loading");
  supabase.auth.onAuthStateChange((event, session) => {
    // Supabase serializes auth events. Database calls must run after the callback.
    setTimeout(() => {
      currentSession = session;
      if (event === "PASSWORD_RECOVERY") {
        recovering = true;
        lockGate("password");
      } else if (event === "SIGNED_OUT") {
        recovering = false;
        email.value = "";
        password.value = "";
        lockGate("login");
      } else if (
        ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"].includes(event)
      ) {
        void open(session);
      }
    }, 0);
  });
}
