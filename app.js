import "@fontsource-variable/dm-sans/wght.css";
import "@fontsource-variable/fraunces/wght.css";
import "./styles.css";
import { bindAccount, cloudMessage } from "./src/account.js";
import {
  supabase,
  startSupabase,
  documentRemote,
  sessionDraft,
  PHOTO_BUCKET,
} from "./src/cloud.js";
import { prepareShell } from "./src/shell.js";
import { DocumentSync } from "./src/sync.js";
import {
  LEGACY_KEY,
  DEMO_KEY,
  DREAM_STATUSES,
  DEFAULT_ACCENT,
  id as uid,
  initialState,
  normalizeState,
  parseBackup,
  validDataImage,
  documentFits,
} from "./src/state.js";
import {
  openDemoPhotos,
  legacyPhotos,
  cloudPhotos,
  compressImage,
  asDataUrl,
} from "./src/media.js";

(() => {
  "use strict";
  const STAGES = [
    ["Semente", 0],
    ["Despertar", 120],
    ["Aprendiz", 300],
    ["Exploradora", 650],
    ["Criadora", 1100],
    ["Estrategista", 1800],
    ["Mestra", 2800],
  ];
  const $ = (s, r = document) => r.querySelector(s),
    $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const today = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  };
  const ago = (n) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const esc = (v) =>
    String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
  const fmt = (iso, year = true) =>
    iso
      ? new Intl.DateTimeFormat("pt-BR", {
          day: "2-digit",
          month: "short",
          year: year ? "numeric" : undefined,
        }).format(new Date(`${iso.slice(0, 10)}T12:00:00`))
      : "Sem prazo";
  const rgb = (hex) => {
    let h = hex.replace("#", "");
    if (h.length === 3)
      h = h
        .split("")
        .map((x) => x + x)
        .join("");
    let n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const empty = (a, b) =>
    `<div class="empty"><strong>${esc(a)}</strong>${esc(b)}</div>`;

  let state = initialState();
  let activeUser = null;
  let docSync = null;
  let photosApi = null;
  let demoMedia = null;
  let ready = false;
  let workspaceGeneration = 0;
  let workspaceBusy = false;
  let pendingPhoto = null;
  let confirmResolve = null;
  let focusTimer = null;
  let focusLeft = 1500;
  let focusRunning = false;
  let installPrompt = null;
  let audioCtx = null;
  let galleryRender = 0;
  let galleryObserver = null;
  const galleryUrls = new Set();
  const reports = new Set();

  function save(render = true) {
    if (!ready) return Promise.resolve(false);
    let result;
    if (docSync) {
      result = docSync.queue(state);
    } else {
      try {
        localStorage.setItem(DEMO_KEY, JSON.stringify(state));
        result = Promise.resolve(true);
      } catch {
        toast(
          "O navegador não salvou esta alteração. Exporte um backup.",
          "error",
        );
        result = Promise.resolve(false);
      }
    }
    if (render) renderAll();
    return result;
  }

  function localValue(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function reflectSync({ kind, updatedAt, error }) {
    const captions = {
      local: "Demonstração local",
      connected: "Nuvem conectada",
      pending: "Pendente",
      saving: "Salvando…",
      saved: "Na nuvem",
      error: "Sincronizar",
      conflict: "Revisar versões",
    };
    $("#syncBtn").dataset.status = kind;
    $("#syncBtn").disabled = kind === "local";
    $("#syncLabel").textContent = captions[kind];
    $("#syncBtn").title = updatedAt
      ? "Último salvamento às " +
        new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(
          new Date(updatedAt),
        )
      : "Atualizar sincronização";
    const conflict = kind === "conflict";
    $("#syncNotice").hidden = !conflict && kind !== "error";
    $("#conflictActions").hidden = !conflict;
    $("#syncRetry").hidden = conflict;
    $("#syncNoticeTitle").textContent = conflict
      ? "Há uma edição em outro navegador."
      : "Sincronização em espera";
    $("#syncNoticeText").textContent = conflict
      ? "A nuvem tem uma versão diferente. Escolha qual usar ou baixe a cópia desta aba antes de decidir."
      : cloudMessage(error) +
        (docSync?.pending
          ? " Suas alterações continuam pendentes nesta aba."
          : "");
  }

  function canRefresh() {
    return (
      ready &&
      !workspaceBusy &&
      !document.querySelector("dialog[open]") &&
      !document.activeElement?.closest("#profileForm")
    );
  }

  async function syncNow() {
    if (!docSync || !ready || workspaceBusy) return;
    if (docSync.pending) await docSync.flush();
    else await docSync.refresh(canRefresh);
  }

  function openWorkspace(documentState) {
    state = documentState;
    ready = true;
    $("#workspaceRoot").hidden = false;
    $("#workspaceRoot").inert = false;
    $("#migrationNotice").hidden =
      !activeUser ||
      !localValue(LEGACY_KEY) ||
      localValue("lumina_migrated_v2:" + activeUser.id) === "1";
    renderAll();
    setView("dashboard");
    resetFocus();
  }

  async function unlockCloud(user, isCurrent) {
    const media = cloudPhotos(supabase.storage.from(PHOTO_BUCKET), user.id);
    const sync = new DocumentSync({
      remote: documentRemote(supabase, user.id),
      draft: sessionDraft(user.id),
      onStatus: (status) => {
        if (isCurrent()) reflectSync(status);
      },
      onApply: (documentState) => {
        if (!isCurrent()) return;
        state = documentState;
        renderAll();
      },
      onCommit: (previous, current) => {
        if (!isCurrent() || !previous) return;
        const retained = new Set(
          [...current.photos, ...state.photos].map((p) => p.path),
        );
        const removed = previous.photos
          .map((p) => p.path)
          .filter((path) => !retained.has(path));
        if (removed.length)
          void media.remove(removed).catch(() => {
            if (isCurrent())
              toast(
                "O registro foi salvo. Uma foto antiga não pôde ser removida do armazenamento.",
                "warn",
              );
          });
      },
    });
    let documentState;
    try {
      documentState = await sync.start(initialState());
    } catch (error) {
      sync.close();
      throw error;
    }
    if (!isCurrent()) {
      sync.close();
      return;
    }
    activeUser = user;
    photosApi = media;
    docSync = sync;
    openWorkspace(documentState);
    void sync.flush();
  }

  async function unlockDemo() {
    let demo = initialState();
    try {
      const previous = localValue(DEMO_KEY);
      if (previous) demo = normalizeState(JSON.parse(previous));
    } catch {
      toast("A cópia de demonstração não pôde ser lida.", "warn");
    }
    try {
      demoMedia = await openDemoPhotos();
    } catch {
      toast("A demonstração abriu sem o armazenamento de fotos.", "warn");
    }
    reflectSync({ kind: "local" });
    openWorkspace(demo);
  }

  function lockWorkspace() {
    workspaceGeneration += 1;
    const hadWorkspace = ready;
    ready = false;
    workspaceBusy = false;
    $("#workspaceRoot").hidden = true;
    $("#workspaceRoot").inert = false;
    $("#workspaceRoot").removeAttribute("aria-busy");
    docSync?.close();
    demoMedia?.close();
    activeUser = null;
    docSync = null;
    photosApi = null;
    demoMedia = null;
    clearInterval(focusTimer);
    focusRunning = false;
    pendingPhoto = null;
    $("#photoPreview").removeAttribute("src");
    $("#photoGrid").replaceChildren();
    releaseGallery();
    for (const report of reports) if (!report.closed) report.close();
    reports.clear();
    $$("dialog[open]").forEach((dialog) => dialog.close("cancel"));
    $$("#workspaceRoot form, dialog form").forEach((form) => form.reset());
    for (const selector of ["#photoTitle", "#photoNote", "#goalSearch"])
      $(selector).value = "";
    $("#toastBox").replaceChildren();
    state = initialState();
    if (hadWorkspace) renderAll();
  }

  async function canSignOut() {
    if (workspaceBusy) {
      toast("Aguarde a transferência em andamento.", "warn");
      return false;
    }
    if (!docSync?.pending) return true;
    if (navigator.onLine && (await docSync.flush())) return true;
    return confirm(
      "Sair com edição pendente?",
      "Se sair agora, a cópia pendente fica nesta aba. Entre novamente na mesma aba para tentar sincronizar ou baixe um backup antes de sair.",
    );
  }

  async function resolveSync(choice) {
    const sync = docSync;
    if (!sync?.conflict) return;
    const approved = await confirm(
      choice === "local"
        ? "Enviar a versão desta aba?"
        : "Carregar a versão da nuvem?",
      choice === "local"
        ? "A versão desta aba vai substituir o documento mais recente da sua conta."
        : "As alterações pendentes desta aba serão descartadas. Você pode baixar um backup antes de continuar.",
    );
    if (approved && sync === docSync)
      await sync.resolve(choice, initialState());
  }

  function stage(xp = state.xp) {
    let i = 0;
    for (let n = 0; n < STAGES.length; n++) if (xp >= STAGES[n][1]) i = n;
    return {
      index: i + 1,
      name: STAGES[i][0],
      min: STAGES[i][1],
      next: STAGES[i + 1]?.[1] ?? null,
    };
  }
  function levelProgress() {
    const s = stage();
    if (!s.next) return 100;
    return clamp(
      Math.round(((state.xp - s.min) / (s.next - s.min)) * 100),
      0,
      100,
    );
  }
  function area(id) {
    return state.areas.find((x) => x.id === id);
  }
  function goalProgress(g) {
    if (!g.steps?.length) return g.completedAt ? 100 : 0;
    return Math.round(
      (g.steps.filter((x) => x.done).length / g.steps.length) * 100,
    );
  }
  function goalStatus(g) {
    const p = goalProgress(g);
    if (p === 100 || g.completedAt) return "done";
    if (g.due && g.due < today()) return "late";
    return "active";
  }
  function eventAdd(type, title, description = "") {
    state.events.unshift({
      id: uid("event"),
      type,
      title,
      description,
      date: new Date().toISOString(),
    });
    state.events = state.events.slice(0, 150);
  }
  function toast(msg, type = "") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    $("#toastBox").append(el);
    setTimeout(() => el.remove(), 3200);
  }
  function tone(freq = 550, dur = 0.12) {
    if (!state.profile.sound) return;
    try {
      audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(),
        g = audioCtx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.08, audioCtx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + dur + 0.03);
    } catch {}
  }
  function reward(xp, coins, label) {
    const old = stage();
    state.xp += xp;
    state.coins += coins;
    const now = stage();
    if (now.index > old.index) {
      eventAdd(
        "level",
        `Você alcançou ${now.name}`,
        "Sua personagem ganhou uma nova forma.",
      );
      toast(`Novo estágio: ${now.name}!`);
      tone(760, 0.25);
    } else if (label) toast(`${label}: +${xp} XP e +${coins} lúmens`);
  }
  function streakHabit(h) {
    const logs = new Set(h.logs || []);
    let n = 0,
      d = new Date();
    d.setHours(12, 0, 0, 0);
    if (!logs.has(today())) d.setDate(d.getDate() - 1);
    while (logs.has(d.toISOString().slice(0, 10))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }
  function overallStreak() {
    const dates = new Set();
    state.journal.forEach((x) => dates.add(x.date));
    state.habits.forEach((h) => (h.logs || []).forEach((x) => dates.add(x)));
    state.events.forEach((e) => dates.add(e.date.slice(0, 10)));
    let n = 0,
      d = new Date();
    d.setHours(12, 0, 0, 0);
    if (!dates.has(today())) d.setDate(d.getDate() - 1);
    while (dates.has(d.toISOString().slice(0, 10))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }
  function reality() {
    const steps = state.goals.flatMap((g) => g.steps || []),
      done = steps.filter((x) => x.done).length;
    const logs = state.habits.reduce(
      (s, h) => s + (h.logs || []).filter((d) => d >= ago(6)).length,
      0,
    );
    const expected = state.habits.reduce(
      (s, h) => s + Math.min(+h.target || 1, 7),
      0,
    );
    const missions = state.missions.length,
      mdone = state.missions.filter((m) => m.done).length;
    const rates = [];
    if (steps.length) rates.push(done / steps.length);
    if (state.habits.length) rates.push(Math.min(logs / expected, 1));
    if (missions) rates.push(mdone / missions);
    const score = rates.length
      ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100)
      : 0;
    const areaExec = state.areas.map((a) => {
      const gs = state.goals.filter((g) => g.areaId === a.id),
        hs = state.habits.filter((h) => h.areaId === a.id);
      let arr = [];
      if (gs.length)
        arr.push(gs.reduce((s, g) => s + goalProgress(g), 0) / gs.length);
      if (hs.length)
        arr.push(
          hs.reduce(
            (s, h) =>
              s +
              Math.min(
                (h.logs || []).filter((d) => d >= ago(6)).length /
                  (+h.target || 1),
                1,
              ) *
                100,
            0,
          ) / hs.length,
        );
      return {
        a,
        execution: arr.length
          ? Math.round(arr.reduce((x, y) => x + y, 0) / arr.length)
          : 0,
      };
    });
    return {
      score,
      goalRate: steps.length ? Math.round((done / steps.length) * 100) : 0,
      habitRate: expected ? Math.round(Math.min(logs / expected, 1) * 100) : 0,
      missionRate: missions ? Math.round((mdone / missions) * 100) : 0,
      areaExec,
    };
  }
  function applyTheme() {
    const theme = state.profile.theme;
    const accent = state.profile.accent || DEFAULT_ACCENT;
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-rgb", rgb(accent).join(","));
    const themes = { linho: "#f5f1ed", lavanda: "#f2edf8", noite: "#211b2c" };
    $('meta[name="theme-color"]').content = themes[theme];
  }

  function setView(name) {
    if (!ready || !document.getElementById(name + "View")) return;
    if (name !== "gallery" && $("#galleryView").classList.contains("active")) {
      releaseGallery();
      $("#photoGrid").replaceChildren();
    }
    $$(".view").forEach((view) =>
      view.classList.toggle("active", view.id === name + "View"),
    );
    $$(".nav[data-view],.mobile[data-view]").forEach((button) => {
      const active = button.dataset.view === name;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    $("#pageTitle").textContent = document.getElementById(
      name + "View",
    ).dataset.title;
    window.scrollTo({ top: 0 });
    if (name === "gallery") void renderGallery();
    if (name === "dashboard") {
      drawRadar();
      drawEnergy();
    }
  }

  function renderAll() {
    applyTheme();
    renderProfile();
    renderSelects();
    renderDashboard();
    renderAreas();
    renderGoals();
    renderHabits();
    renderJournal();
    renderSpirit();
    renderFocus();
    renderSnapshot();
    renderSettings();
    if (ready) void renderGallery();
  }

  function chartColor(token) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(token)
      .trim();
  }
  function renderProfile() {
    const s = stage();
    $("#profileName").textContent = state.profile.name;
    $("#avatarName").textContent = state.profile.avatar;
    $("#avatarStage").textContent = s.name;
    $("#heroLevel").textContent = s.index;
    $("#heroCoins").textContent = state.coins;
    $("#heroStreak").textContent = overallStreak();
    $("#sideLevel").textContent = `Nível ${s.index}`;
    $("#sideStage").textContent = s.name;
    $("#sideXp").textContent = `${state.xp} XP`;
    $("#xpBar").style.width = `${levelProgress()}%`;
    $("#character").className = `character stage-${s.index}`;
    $(".character-world").hidden = !state.profile.showCompanion;
    $(".hero-stats").hidden = !state.profile.showCompanion;
    $(".level-box").hidden = !state.profile.showCompanion;
    $(".hero").classList.toggle("quiet", !state.profile.showCompanion);
    $(".reality").hidden = !state.profile.showScore;
    $(".hero-grid").classList.toggle("single", !state.profile.showScore);
    $("#soundBtn").textContent = state.profile.sound ? "♫" : "♩";
    $("#soundBtn").setAttribute("aria-pressed", String(state.profile.sound));
  }
  function renderDashboard() {
    const r = reality();
    let insight = "Registre ações reais para fazer seu universo crescer.";
    if (r.score >= 75)
      insight =
        "Sua execução está consistente. Proteja o ritmo sem aumentar metas por impulso.";
    else if (r.score >= 45)
      insight =
        "Existe movimento real. Agora reduza dispersão e fortaleça a prioridade.";
    else if (state.goals.length || state.habits.length)
      insight =
        "Você planejou mais do que executou. Escolha um próximo passo pequeno.";
    $("#heroInsight").textContent = state.profile.greeting || insight;
    renderReality();
    drawRadar();
    renderMissions();
    renderHeat();
    drawEnergy();
    renderTimeline();
  }
  function renderReality() {
    const r = reality();
    $("#realityScore").textContent = `${r.score}%`;
    $("#scoreRing").style.setProperty("--score", `${r.score * 3.6}deg`);
    let t = "Comece concluindo uma etapa.",
      s = "O sistema compara o que foi planejado com o que foi feito.";
    if (r.score >= 75) {
      t = "Sua execução está coerente com suas prioridades.";
      s = "Mantenha constância sem sobrecarregar o sistema.";
    } else if (r.score >= 45) {
      t = "Você está avançando, mas ainda existe dispersão.";
      s = "Priorize menos movimentos e conclua mais.";
    } else if (state.goals.length || state.habits.length) {
      t = "Sua intenção está maior que sua execução.";
      s = "Use isso como informação, não como culpa.";
    }
    $("#realityText").textContent = t;
    $("#realitySub").textContent = s;
    let rows = [
      ["Etapas de metas", `${r.goalRate}%`],
      ["Hábitos da semana", `${r.habitRate}%`],
      ["Missões concluídas", `${r.missionRate}%`],
    ];
    const weak = [...r.areaExec]
      .filter((x) => x.a.importance >= 4)
      .sort((a, b) => a.execution - b.execution)[0];
    if (weak && weak.execution < 40)
      rows.push([`Atenção: ${weak.a.name}`, `${weak.execution}%`]);
    $("#realityList").innerHTML = rows
      .map(
        (x) => `<div><span>${esc(x[0])}</span><strong>${x[1]}</strong></div>`,
      )
      .join("");
  }
  function resizeCanvas(c, h) {
    const dpr = devicePixelRatio || 1,
      w = c.clientWidth || 560;
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.height = `${h}px`;
    const x = c.getContext("2d");
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [x, w, h];
  }
  function drawRadar() {
    const c = $("#radarCanvas"),
      [x, w, h] = resizeCanvas(c, 340);
    x.clearRect(0, 0, w, h);
    const arr = state.areas.slice(0, 10);
    if (arr.length < 3) {
      x.fillStyle = chartColor("--muted");
      x.textAlign = "center";
      x.fillText("Adicione pelo menos três áreas.", w / 2, h / 2);
      return;
    }
    const cx = w / 2,
      cy = h / 2 + 7,
      r = Math.min(w, h) * 0.34,
      n = arr.length,
      step = (Math.PI * 2) / n,
      start = -Math.PI / 2;
    for (let l = 1; l <= 5; l++) {
      x.beginPath();
      arr.forEach((a, i) => {
        const an = start + i * step,
          rr = (r * l) / 5,
          px = cx + Math.cos(an) * rr,
          py = cy + Math.sin(an) * rr;
        i ? x.lineTo(px, py) : x.moveTo(px, py);
      });
      x.closePath();
      x.strokeStyle = chartColor("--chart-grid");
      x.stroke();
    }
    arr.forEach((a, i) => {
      const an = start + i * step;
      x.beginPath();
      x.moveTo(cx, cy);
      x.lineTo(cx + Math.cos(an) * r, cy + Math.sin(an) * r);
      x.strokeStyle = chartColor("--chart-grid");
      x.stroke();
      const lr = r + 23,
        lx = cx + Math.cos(an) * lr,
        ly = cy + Math.sin(an) * lr;
      x.fillStyle = chartColor("--muted");
      x.font = "600 11px system-ui";
      x.textAlign = lx < cx - 8 ? "right" : lx > cx + 8 ? "left" : "center";
      x.fillText(a.name.slice(0, 15), lx, ly);
    });
    function poly(k, stroke, fill) {
      x.beginPath();
      arr.forEach((a, i) => {
        const an = start + i * step,
          rr = (r * clamp(+a[k] || 0, 0, 10)) / 10,
          px = cx + Math.cos(an) * rr,
          py = cy + Math.sin(an) * rr;
        i ? x.lineTo(px, py) : x.moveTo(px, py);
      });
      x.closePath();
      x.fillStyle = fill;
      x.strokeStyle = stroke;
      x.lineWidth = 2;
      x.fill();
      x.stroke();
    }
    const col = state.profile.accent,
      rr = rgb(col);
    poly("target", chartColor("--chart-target"), "transparent");
    poly("current", col, `rgba(${rr.join(",")},.20)`);
    $("#radarLegend").innerHTML =
      `<span><i style="background:${col}"></i>Atual</span><span><i style="background:var(--chart-target)"></i>Desejada</span>`;
  }
  function renderMissions() {
    const c = $("#missionList");
    if (!state.missions.length) {
      c.innerHTML = empty(
        "Nenhuma missão",
        "Crie um movimento pequeno para hoje.",
      );
      return;
    }
    c.innerHTML = [...state.missions]
      .sort((a, b) => +a.done - +b.done)
      .slice(0, 6)
      .map(
        (m) =>
          `<div class="mission ${m.done ? "done" : ""}"><button class="check ${m.done ? "done" : ""}" data-toggle-mission="${m.id}">✓</button><div><strong>${esc(m.title)}</strong><small>${esc(area(m.areaId)?.name || "Missão livre")}</small></div><button class="x-btn" data-delete-mission="${m.id}">×</button></div>`,
      )
      .join("");
  }
  function renderHeat() {
    const ds = Array.from({ length: 14 }, (_, i) => ago(13 - i)),
      total = Math.max(state.habits.length, 1);
    $("#heatmap").innerHTML = ds
      .map((d) => {
        const n = state.habits.filter((h) => (h.logs || []).includes(d)).length,
          r = n / total,
          l = n === 0 ? 0 : r <= 0.25 ? 1 : r <= 0.5 ? 2 : r < 1 ? 3 : 4;
        return `<i class="l${l}" title="${fmt(d)} — ${n} hábitos"></i>`;
      })
      .join("");
    const possible = state.habits.length * 14,
      done = state.habits.reduce(
        (s, h) => s + (h.logs || []).filter((d) => d >= ds[0]).length,
        0,
      ),
      rate = possible ? Math.round((done / possible) * 100) : 0;
    $("#habitRateBadge").textContent = `${rate}%`;
    const top = state.habits
      .map((h) => {
        const n = (h.logs || []).filter((d) => d >= ds[0]).length;
        return { h, p: Math.round((n / 14) * 100) };
      })
      .sort((a, b) => b.p - a.p)
      .slice(0, 3);
    $("#topHabits").innerHTML = top.length
      ? top
          .map(
            (o) =>
              `<div class="mini-progress"><span>${esc(o.h.title)}</span><div class="bar"><i style="width:${o.p}%"></i></div><strong>${o.p}%</strong></div>`,
          )
          .join("")
      : empty("Sem hábitos", "Cadastre hábitos para visualizar a constância.");
  }
  function drawEnergy() {
    const c = $("#energyCanvas"),
      [x, w, h] = resizeCanvas(c, 230);
    x.clearRect(0, 0, w, h);
    const arr = [...state.journal]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14);
    if (!arr.length) {
      x.fillStyle = chartColor("--muted");
      x.textAlign = "center";
      x.fillText(
        "Registre energia no diário para gerar o gráfico.",
        w / 2,
        h / 2,
      );
      $("#energyStats").innerHTML =
        "<div><small>Média</small><strong>—</strong></div><div><small>Maior</small><strong>—</strong></div><div><small>Registros</small><strong>0</strong></div>";
      return;
    }
    const pad = { l: 28, r: 18, t: 20, b: 30 },
      ww = w - pad.l - pad.r,
      hh = h - pad.t - pad.b;
    for (let i = 0; i <= 5; i++) {
      const y = pad.t + (hh / 5) * i;
      x.beginPath();
      x.moveTo(pad.l, y);
      x.lineTo(w - pad.r, y);
      x.strokeStyle = chartColor("--chart-grid");
      x.stroke();
    }
    const pts = arr.map((e, i) => ({
        x: pad.l + (arr.length === 1 ? ww / 2 : (ww / (arr.length - 1)) * i),
        y: pad.t + hh - (clamp(+e.energy || 0, 0, 10) / 10) * hh,
        v: +e.energy || 0,
      })),
      col = state.profile.accent,
      rr = rgb(col),
      g = x.createLinearGradient(0, pad.t, 0, h - pad.b);
    g.addColorStop(0, `rgba(${rr.join(",")},.35)`);
    g.addColorStop(1, `rgba(${rr.join(",")},0)`);
    x.beginPath();
    pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
    x.lineTo(pts.at(-1).x, h - pad.b);
    x.lineTo(pts[0].x, h - pad.b);
    x.closePath();
    x.fillStyle = g;
    x.fill();
    x.beginPath();
    pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
    x.strokeStyle = col;
    x.lineWidth = 3;
    x.stroke();
    pts.forEach((p) => {
      x.beginPath();
      x.arc(p.x, p.y, 4, 0, Math.PI * 2);
      x.fillStyle = "#fff";
      x.fill();
    });
    const vals = pts.map((p) => p.v);
    $("#energyStats").innerHTML =
      `<div><small>Média</small><strong>${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)}/10</strong></div><div><small>Maior</small><strong>${Math.max(...vals)}/10</strong></div><div><small>Registros</small><strong>${vals.length}</strong></div>`;
  }
  function renderTimeline() {
    const items = [
      ...state.events.map((e) => ({
        date: e.date,
        title: e.title,
        description: e.description,
      })),
      ...state.journal.map((j) => ({
        date: `${j.date}T12:00:00`,
        title: "Registro de realidade",
        description: j.fact,
      })),
    ]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8);
    $("#timeline").innerHTML = items.length
      ? items
          .map(
            (i) =>
              `<div class="timeline-item"><div class="timeline-date">${fmt(i.date, false)}</div><div class="timeline-dot"></div><div class="timeline-copy"><strong>${esc(i.title)}</strong><span>${esc(i.description || "")}</span></div></div>`,
          )
          .join("")
      : empty(
          "Linha do tempo vazia",
          "Conclua uma ação ou escreva um registro.",
        );
  }
  function renderAreas() {
    const avg = state.areas.length
        ? state.areas.reduce((s, a) => s + (+a.current || 0), 0) /
          state.areas.length
        : 0,
      gap = state.areas.length
        ? state.areas.reduce(
            (s, a) => s + Math.max(a.target - a.current, 0),
            0,
          ) / state.areas.length
        : 0;
    $("#areaSummary").innerHTML =
      `<div><small>Áreas mapeadas</small><strong>${state.areas.length}</strong></div><div><small>Média atual</small><strong>${avg.toFixed(1)}/10</strong></div><div><small>Prioritárias</small><strong>${state.areas.filter((a) => a.importance >= 4).length}</strong></div><div><small>Distância média</small><strong>${gap.toFixed(1)}</strong></div>`;
    $("#areasGrid").innerHTML = state.areas.length
      ? state.areas
          .map((a, index) => {
            const gs = state.goals.filter((g) => g.areaId === a.id).length,
              hs = state.habits.filter((h) => h.areaId === a.id).length;
            return `<article class="area-card" style="--area:${esc(a.color)}"><div class="area-top"><span class="area-icon">${esc(a.icon || "✦")}</span><div class="area-actions"><button type="button" aria-label="Mover área para cima" title="Mover para cima" data-move-area="${a.id}" data-direction="-1" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" aria-label="Mover área para baixo" title="Mover para baixo" data-move-area="${a.id}" data-direction="1" ${index === state.areas.length - 1 ? "disabled" : ""}>↓</button><button type="button" aria-label="Editar área" data-edit-area="${a.id}">✎</button><button type="button" aria-label="Excluir área" data-delete-area="${a.id}">×</button></div></div><h3>${esc(a.name)}</h3><p>${esc(a.description || "Sem descrição.")}</p><div class="rating"><div class="rating-head"><span>Situação atual</span><strong>${a.current}/10 → ${a.target}/10</strong></div><div class="scale"><i class="current" style="width:${a.current * 10}%"></i><i class="target" style="left:${a.target * 10}%"></i></div></div><div class="area-foot"><span>${gs} metas · ${hs} hábitos</span><span>Importância ${a.importance}/5</span></div></article>`;
          })
          .join("")
      : empty("Nenhuma área", "Crie sua primeira área de vida.");
  }
  function renderGoals() {
    const af = $("#goalAreaFilter").value || "all",
      sf = $("#goalStatusFilter").value || "all",
      q = $("#goalSearch").value.trim().toLowerCase();
    let arr = state.goals
      .filter((g) => af === "all" || g.areaId === af)
      .filter((g) => sf === "all" || goalStatus(g) === sf)
      .filter((g) => !q || g.title.toLowerCase().includes(q));
    if (!arr.length) {
      $("#goalsList").innerHTML = empty(
        state.goals.length ? "Nenhuma meta encontrada" : "Nenhuma meta",
        "Crie uma meta e divida em etapas.",
      );
      return;
    }
    $("#goalsList").innerHTML = arr
      .map((g) => {
        const p = goalProgress(g),
          st = goalStatus(g),
          sl =
            st === "done"
              ? "Concluída"
              : st === "late"
                ? "Atrasada"
                : "Em andamento";
        return `<article class="goal-card"><div class="goal-head"><div><div class="goal-meta"><span class="tag ${st}">${sl}</span><span class="tag">${esc(area(g.areaId)?.name || "Sem área")}</span>${g.due ? `<span class="tag">Prazo: ${fmt(g.due)}</span>` : ""}</div><h3>${esc(g.title)}</h3><p>${esc(g.why || "Sem justificativa registrada.")}</p></div><div class="goal-progress"><strong>${p}%</strong><small>${(g.steps || []).filter((x) => x.done).length}/${(g.steps || []).length} etapas</small></div></div><div class="goal-bar"><i style="width:${p}%"></i></div><div class="stack">${g.steps?.length ? g.steps.map((s) => `<div class="goal-step ${s.done ? "done" : ""}"><button class="check ${s.done ? "done" : ""}" data-toggle-step="${g.id}:${s.id}">✓</button><span>${esc(s.text)}</span></div>`).join("") : empty("Sem etapas", "Edite a meta para adicionar etapas.")}</div><div class="goal-actions"><button data-edit-goal="${g.id}">Editar</button><button data-delete-goal="${g.id}">Excluir</button></div></article>`;
      })
      .join("");
  }
  function renderHabits() {
    const t = today(),
      done = state.habits.filter((h) => (h.logs || []).includes(t)).length,
      best = state.habits.length
        ? Math.max(...state.habits.map(streakHabit))
        : 0,
      days = Array.from({ length: 7 }, (_, i) => ago(6 - i)),
      possible = state.habits.length * 7,
      total = state.habits.reduce(
        (s, h) => s + (h.logs || []).filter((d) => days.includes(d)).length,
        0,
      );
    $("#activeHabits").textContent = state.habits.length;
    $("#todayHabits").textContent = done;
    $("#bestStreak").textContent = `${best} dias`;
    $("#sevenRate").textContent =
      `${possible ? Math.round((total / possible) * 100) : 0}%`;
    const labels = ["D", "S", "T", "Q", "Q", "S", "S"];
    $("#habitsList").innerHTML = state.habits.length
      ? state.habits
          .map((h) => {
            const on = (h.logs || []).includes(t);
            return `<article class="habit-card"><button class="habit-check ${on ? "done" : ""}" data-toggle-habit="${h.id}">✓</button><div class="habit-main"><strong>${esc(h.title)}</strong><small>${esc(area(h.areaId)?.name || "Sem área")} · ${esc({ daily: "Todos os dias", weekdays: "Segunda a sexta", "3x": "3 vezes por semana", weekly: "1 vez por semana" }[h.frequency] || h.frequency)}</small><div class="habit-week">${days.map((d) => `<i class="day ${(h.logs || []).includes(d) ? "done" : ""}">${labels[new Date(`${d}T12:00:00`).getDay()]}</i>`).join("")}</div></div><div class="habit-side"><div class="streak"><strong>${streakHabit(h)}</strong><small>sequência</small></div><button class="x-btn" data-edit-habit="${h.id}">✎</button><button class="x-btn" data-delete-habit="${h.id}">×</button></div></article>`;
          })
          .join("")
      : empty("Nenhum hábito", "Cadastre um comportamento que deseja repetir.");
  }
  function renderJournal() {
    const arr = [...state.journal].sort((a, b) => b.date.localeCompare(a.date)),
      e = arr.length
        ? arr.reduce((s, x) => s + (+x.energy || 0), 0) / arr.length
        : 0,
      m = arr.length
        ? arr.reduce((s, x) => s + (+x.mood || 0), 0) / arr.length
        : 0,
      month = today().slice(0, 7);
    $("#journalSummary").innerHTML =
      `<div><small>Energia média</small><strong>${arr.length ? e.toFixed(1) : "—"}/10</strong></div><div><small>Humor médio</small><strong>${arr.length ? m.toFixed(1) : "—"}/5</strong></div><div><small>Registros no mês</small><strong>${arr.filter((x) => x.date.startsWith(month)).length}</strong></div><div><small>Total de registros</small><strong>${arr.length}</strong></div>`;
    $("#journalList").innerHTML = arr.length
      ? arr
          .map(
            (j) =>
              `<article class="journal-card"><div class="journal-head"><div><strong>${fmt(j.date)}</strong></div><div class="signals"><span class="signal">Humor ${j.mood}/5</span><span class="signal">Energia ${j.energy}/10</span><button class="x-btn" data-delete-journal="${j.id}">×</button></div></div><div class="journal-sections"><div class="journal-section"><small>O QUE É FATO</small><p>${esc(j.fact)}</p></div><div class="journal-section"><small>INTERPRETAÇÃO</small><p>${esc(j.interpretation || "Não registrada.")}</p></div><div class="journal-section"><small>POSTURA EFICAZ</small><p>${esc(j.action || "Não registrada.")}</p></div></div></article>`,
          )
          .join("")
      : empty(
          "Nenhum registro",
          "Separe um acontecimento em fato, interpretação e ação.",
        );
  }
  function renderSelects() {
    const opts = state.areas
      .map(
        (a) =>
          `<option value="${a.id}">${esc(a.icon || "✦")} ${esc(a.name)}</option>`,
      )
      .join("");
    ["#goalArea", "#habitArea", "#missionArea", "#photoArea"].forEach((s) => {
      const el = $(s),
        v = el.value;
      el.innerHTML =
        (s === "#missionArea" || s === "#photoArea"
          ? '<option value="">Sem área específica</option>'
          : "") + opts;
      if ([...el.options].some((o) => o.value === v)) el.value = v;
    });
    ["#goalAreaFilter", "#galleryAreaFilter"].forEach((s) => {
      const el = $(s),
        v = el.value;
      el.innerHTML = '<option value="all">Todas as áreas</option>' + opts;
      el.value = [...el.options].some((o) => o.value === v) ? v : "all";
    });
  }
  function renderFocus() {
    const el = $("#focusGoal"),
      v = el.value;
    el.innerHTML =
      '<option value="">Sessão livre</option>' +
      state.goals
        .filter((g) => goalStatus(g) !== "done")
        .map((g) => `<option value="${g.id}">${esc(g.title)}</option>`)
        .join("");
    if ([...el.options].some((o) => o.value === v)) el.value = v;
    const arr = [...state.focusSessions]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 12);
    $("#focusHistory").innerHTML = arr.length
      ? arr
          .map(
            (s) =>
              `<div class="focus-history-item"><strong>${esc(state.goals.find((g) => g.id === s.goalId)?.title || s.label || "Sessão livre")}</strong><small>${s.minutes} minutos · ${fmt(s.date)}</small></div>`,
          )
          .join("")
      : empty("Nenhuma sessão", "Inicie uma sessão para registrar tempo real.");
  }
  function renderSnapshot() {
    $("#reportSnapshot").innerHTML =
      `<div><small>Estágio atual</small><strong>${stage().name}</strong></div><div><small>Metas concluídas</small><strong>${state.goals.filter((g) => goalStatus(g) === "done").length}</strong></div><div><small>Etapas concluídas</small><strong>${state.goals.flatMap((g) => g.steps || []).filter((s) => s.done).length}</strong></div><div><small>Hábitos hoje</small><strong>${state.habits.filter((h) => (h.logs || []).includes(today())).length}/${state.habits.length}</strong></div>`;
  }
  function renderSettings() {
    $("#settingsName").value = state.profile.name;
    $("#settingsAvatar").value = state.profile.avatar;
    $("#settingsAccent").value = state.profile.accent;
    $("#settingsGreeting").value = state.profile.greeting;
    $("#settingsTheme").value = state.profile.theme;
    $("#settingsCompanion").checked = state.profile.showCompanion;
    $("#settingsScore").checked = state.profile.showScore;
    $("#settingsSound").checked = state.profile.sound;
    $("#accountInfo").textContent = activeUser
      ? "Conectada como " +
        activeUser.email +
        ". Suas alterações são sincronizadas automaticamente."
      : "Demonstração local. Os dados de teste ficam neste navegador.";
    $("#settingsSync").hidden = !activeUser;
    $("#signOutBtn").hidden = !activeUser;
    $("#legacyTransfer").hidden = !activeUser;
    $("#clearDescription").textContent = activeUser
      ? "Retorna o espaço desta conta aos dados iniciais."
      : "Retorna a demonstração deste navegador aos dados iniciais.";
    $("#storageDetails").innerHTML = [
      ["Áreas", state.areas.length],
      ["Metas", state.goals.length],
      ["Hábitos", state.habits.length],
      ["Registros no diário", state.journal.length],
      ["Registros em Espírito → Matéria", state.dreams.length],
      ["Sessões de foco", state.focusSessions.length],
    ]
      .map((x) => `<div><span>${x[0]}</span><strong>${x[1]}</strong></div>`)
      .join("");
  }
  function open(id) {
    const d = $(`#${id}`);
    if (!d.open) d.showModal();
  }
  function close(id) {
    const d = $(`#${id}`);
    if (d.open) d.close();
  }
  function confirm(title, text) {
    if (confirmResolve) return Promise.resolve(false);
    $("#confirmDialog").returnValue = "cancel";
    $("#confirmTitle").textContent = title;
    $("#confirmText").textContent = text;
    open("confirmDialog");
    return new Promise((r) => (confirmResolve = r));
  }
  function openArea(a = null) {
    $("#areaForm").reset();
    $("#areaId").value = a?.id || "";
    $("#areaDialogTitle").textContent = a ? "Editar área" : "Nova área";
    $("#areaName").value = a?.name || "";
    $("#areaIcon").value = a?.icon || "✦";
    $("#areaColor").value = a?.color || state.profile.accent;
    $("#areaImportance").value = a?.importance || 3;
    $("#areaDescription").value = a?.description || "";
    $("#areaCurrent").value = a?.current ?? 5;
    $("#areaTarget").value = a?.target ?? 8;
    $("#currentValue").textContent = $("#areaCurrent").value;
    $("#targetValue").textContent = $("#areaTarget").value;
    open("areaDialog");
  }
  function openGoal(g = null) {
    if (!state.areas.length) {
      toast("Crie uma área primeiro.", "warn");
      openArea();
      return;
    }
    $("#goalForm").reset();
    $("#goalId").value = g?.id || "";
    $("#goalDialogTitle").textContent = g ? "Editar meta" : "Nova meta";
    $("#goalTitle").value = g?.title || "";
    $("#goalArea").value = g?.areaId || state.areas[0].id;
    $("#goalDue").value = g?.due || "";
    $("#goalPriority").value = g?.priority || "medium";
    $("#goalWhy").value = g?.why || "";
    $("#goalSteps").value = g?.steps?.map((s) => s.text).join("\n") || "";
    open("goalDialog");
  }
  function openHabit(h = null) {
    if (!state.areas.length) {
      toast("Crie uma área primeiro.", "warn");
      openArea();
      return;
    }
    $("#habitForm").reset();
    $("#habitId").value = h?.id || "";
    $("#habitDialogTitle").textContent = h ? "Editar hábito" : "Novo hábito";
    $("#habitTitle").value = h?.title || "";
    $("#habitArea").value = h?.areaId || state.areas[0].id;
    $("#habitFrequency").value = h?.frequency || "daily";
    $("#habitTarget").value = h?.target || 7;
    open("habitDialog");
  }
  function openJournal() {
    $("#journalForm").reset();
    $("#journalDate").value = today();
    $("#journalMood").value = 3;
    $("#journalEnergy").value = 6;
    open("journalDialog");
  }
  function openMission() {
    $("#missionForm").reset();
    open("missionDialog");
  }
  function releaseGallery() {
    galleryRender += 1;
    galleryObserver?.disconnect();
    galleryObserver = null;
    for (const url of galleryUrls) URL.revokeObjectURL(url);
    galleryUrls.clear();
  }

  async function getPhotos(
    documentState,
    { from = "", limit = Infinity, skipMissing = false } = {},
  ) {
    const media = photosApi;
    const stored = media
      ? documentState.photos
      : (await demoMedia?.list()) || [];
    const rows = stored
      .filter((photo) => photo.createdAt.slice(0, 10) >= from)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
    if (!media) return rows.filter((photo) => validDataImage(photo.dataUrl));

    const photos = [];
    for (const photo of rows) {
      try {
        const { path, ...metadata } = photo;
        photos.push({
          ...metadata,
          dataUrl: await asDataUrl(await media.get(path)),
        });
      } catch (error) {
        if (!skipMissing) throw error;
      }
    }
    return photos;
  }

  async function renderGallery() {
    if (!ready || !$("#galleryView").classList.contains("active")) return;
    releaseGallery();
    const run = galleryRender;
    const media = photosApi;
    const grid = $("#photoGrid");
    try {
      const stored = media ? state.photos : (await demoMedia?.list()) || [];
      if (run !== galleryRender || !ready) return;
      const filter = $("#galleryAreaFilter").value;
      const photos = stored
        .filter(
          (p) =>
            (filter === "all" || p.areaId === filter) &&
            (media || validDataImage(p.dataUrl)),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      $("#galleryInfo").textContent =
        photos.length + (photos.length === 1 ? " imagem" : " imagens");
      grid.innerHTML = photos.length
        ? photos
            .map(
              (p) =>
                '<article class="photo-card"><div class="photo-frame"><img ' +
                (media
                  ? 'data-path="' + esc(p.path) + '"'
                  : 'src="' + esc(p.dataUrl) + '"') +
                ' loading="lazy" alt="' +
                esc(p.title || "Evidência") +
                '"></div>' +
                '<button class="photo-delete" aria-label="Excluir foto" data-delete-photo="' +
                esc(p.id) +
                '">×</button>' +
                '<div class="photo-info"><strong>' +
                esc(p.title || "Evidência") +
                "</strong><small>" +
                esc(area(p.areaId)?.name || "Sem área") +
                " · " +
                fmt(p.createdAt) +
                "</small>" +
                (p.note ? "<p>" + esc(p.note) + "</p>" : "") +
                "</div></article>",
            )
            .join("")
        : empty(
            "Nenhuma evidência",
            "Adicione fotos de conquistas e resultados.",
          );
      if (!media) return;

      const load = async (image) => {
        try {
          const blob = await media.get(image.dataset.path);
          if (run !== galleryRender || !image.isConnected) return;
          const url = URL.createObjectURL(blob);
          galleryUrls.add(url);
          image.src = url;
        } catch {
          if (run === galleryRender && image.isConnected) {
            const status = document.createElement("span");
            status.className = "photo-unavailable";
            status.textContent = "Imagem indisponível. Tente sincronizar.";
            image.replaceWith(status);
          }
        }
      };
      const images = $$("img[data-path]", grid);
      if ("IntersectionObserver" in window) {
        galleryObserver = new IntersectionObserver(
          (entries) => {
            for (const entry of entries)
              if (entry.isIntersecting) {
                galleryObserver?.unobserve(entry.target);
                void load(entry.target);
              }
          },
          { rootMargin: "180px" },
        );
        for (const image of images) galleryObserver.observe(image);
      } else {
        for (const image of images) void load(image);
      }
    } catch {
      if (run === galleryRender)
        grid.innerHTML = empty(
          "Fotos indisponíveis",
          "Tente abrir a galeria novamente.",
        );
    }
  }

  async function preparePhoto(file) {
    $("#photoInput").value = "";
    if (!file || workspaceBusy || !ready) return;
    const run = workspaceGeneration;
    try {
      const dataUrl = await compressImage(file);
      if (run !== workspaceGeneration || !ready) return;
      pendingPhoto = {
        id: uid("photo"),
        dataUrl,
        createdAt: new Date().toISOString(),
      };
      $("#photoPreview").src = dataUrl;
      $("#photoTitle").value = file.name.replace(/\.[^.]+$/, "").slice(0, 80);
      $("#photoArea").value = "";
      $("#photoNote").value = "";
      open("photoDialog");
    } catch (error) {
      toast(error.message || "Não foi possível processar a imagem.", "error");
    }
  }

  async function savePhoto() {
    if (!pendingPhoto || workspaceBusy || !ready) return;
    const media = photosApi;
    const run = workspaceGeneration;
    const photo = {
      ...pendingPhoto,
      title: $("#photoTitle").value.trim() || "Evidência",
      areaId: $("#photoArea").value,
      note: $("#photoNote").value.trim(),
    };
    workspaceBusy = true;
    $("#savePhotoBtn").disabled = true;
    $("#savePhotoBtn").textContent = "Salvando…";
    try {
      if (media) {
        const metadata = await media.put(photo);
        if (run !== workspaceGeneration) {
          await media.remove([metadata.path]).catch(() => {});
          return;
        }
        state.photos.unshift(metadata);
      } else {
        if (!demoMedia) throw new Error("Armazenamento de fotos indisponível.");
        await demoMedia.put(photo);
      }
      if (run !== workspaceGeneration) return;
      reward(8, 2, "Evidência registrada");
      eventAdd("photo", "Nova evidência", photo.title);
      pendingPhoto = null;
      $("#photoPreview").removeAttribute("src");
      close("photoDialog");
      await save();
    } catch {
      if (run === workspaceGeneration)
        toast(
          "A foto não foi salva. Confira a conexão e tente novamente.",
          "error",
        );
    } finally {
      $("#savePhotoBtn").disabled = false;
      $("#savePhotoBtn").textContent = "Salvar evidência";
      if (run === workspaceGeneration) workspaceBusy = false;
    }
  }

  async function deletePhoto(photoId) {
    const run = workspaceGeneration;
    if (
      !(await confirm(
        "Excluir imagem",
        "A imagem será removida da sua galeria.",
      )) ||
      run !== workspaceGeneration ||
      !ready
    )
      return;
    try {
      if (photosApi) {
        state.photos = state.photos.filter((p) => p.id !== photoId);
        await save();
      } else {
        await demoMedia?.delete(photoId);
        void renderGallery();
      }
    } catch {
      toast("A imagem não pôde ser removida.", "error");
    }
  }

  function resetFocus() {
    clearInterval(focusTimer);
    focusRunning = false;
    focusLeft = (+$("#focusDuration").value || 25) * 60;
    updateFocus();
  }
  function updateFocus() {
    $("#timerText").textContent =
      `${String(Math.floor(focusLeft / 60)).padStart(2, "0")}:${String(focusLeft % 60).padStart(2, "0")}`;
    $("#timerStatus").textContent = focusRunning
      ? "Sessão em andamento"
      : "Pronta para começar";
  }
  function startFocus() {
    if (focusRunning) return;
    if (focusLeft <= 0) resetFocus();
    focusRunning = true;
    updateFocus();
    focusTimer = setInterval(() => {
      focusLeft--;
      updateFocus();
      if (focusLeft <= 0) finishFocus();
    }, 1000);
  }
  function pauseFocus() {
    focusRunning = false;
    clearInterval(focusTimer);
    $("#timerStatus").textContent = "Sessão pausada";
  }
  function finishFocus() {
    clearInterval(focusTimer);
    focusRunning = false;
    const minutes = +$("#focusDuration").value || 25,
      gid = $("#focusGoal").value,
      g = state.goals.find((x) => x.id === gid);
    state.focusSessions.push({
      id: uid("focus"),
      goalId: gid,
      label: g?.title || "Sessão livre",
      minutes,
      date: new Date().toISOString(),
    });
    reward(
      Math.max(8, Math.round(minutes / 2)),
      Math.max(2, Math.round(minutes / 10)),
      "Sessão concluída",
    );
    eventAdd(
      "focus",
      "Sessão de foco concluída",
      `${minutes} minutos em ${g?.title || "sessão livre"}.`,
    );
    save();
    resetFocus();
    tone(780, 0.3);
  }
  async function report(type) {
    if (!ready) return;
    const w = window.open("", "_blank");
    if (!w) {
      toast("Libere pop-ups para gerar o relatório.", "warn");
      return;
    }
    w.opener = null;
    reports.add(w);
    const run = workspaceGeneration;
    const snapshot = structuredClone(state);
    const reportArea = (id) => snapshot.areas.find((entry) => entry.id === id);
    const reportStage = stage().name;
    const label = {
      weekly: "Relatório Semanal",
      monthly: "Relatório Mensal",
      complete: "Livro da Evolução",
    }[type];
    const start =
      type === "weekly"
        ? ago(6)
        : type === "monthly"
          ? today().slice(0, 7) + "-01"
          : "0000-01-01";
    const journ = snapshot.journal.filter((entry) => entry.date >= start);
    const sessions = snapshot.focusSessions.filter(
      (entry) => entry.date.slice(0, 10) >= start,
    );
    const r = reality();
    const focus = sessions.reduce((sum, entry) => sum + entry.minutes, 0);
    w.document.body.textContent = "Preparando o relatório…";
    let photos = [];
    try {
      photos = await getPhotos(snapshot, {
        from: start,
        limit: type === "complete" ? 18 : 8,
        skipMissing: true,
      });
    } catch {
      if (run === workspaceGeneration)
        toast("O relatório abriu sem as fotos indisponíveis.", "warn");
    }
    if (run !== workspaceGeneration || w.closed) return;
    w.document.write(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${label}</title><style>@page{size:A4;margin:16mm}*{box-sizing:border-box}body{margin:0;color:#172033;font-family:Arial,sans-serif}.bar{position:sticky;top:0;padding:12px;text-align:right;background:#11162b}.bar button{padding:10px 16px;border:0;border-radius:10px;color:white;background:${snapshot.profile.accent};font-weight:700}.report{max-width:860px;margin:auto;padding:34px}.cover{padding:38px;border-radius:24px;color:white;background:linear-gradient(135deg,${snapshot.profile.accent},#202b57)}.cover h1{font-size:38px;margin:13px 0}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0 28px}.metric{padding:15px;border:1px solid #dfe3ed;border-radius:14px}.metric span,.metric strong{display:block}.metric span{color:#6a7387;font-size:12px}.metric strong{margin-top:5px;font-size:21px}h2{margin-top:30px;padding-bottom:8px;border-bottom:2px solid #e7eaf1}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:10px;border-bottom:1px solid #e7eaf1;text-align:left}th{background:#f6f7fa}.entry{padding:14px;margin:10px 0;border:1px solid #e1e5ed;border-radius:14px;break-inside:avoid}.photos{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.photos img{width:100%;max-height:280px;object-fit:cover;border-radius:14px}@media print{.bar{display:none}.report{padding:0}.cover{print-color-adjust:exact;-webkit-print-color-adjust:exact}}@media(max-width:700px){.metrics{grid-template-columns:repeat(2,1fr)}.photos{grid-template-columns:1fr}}</style></head><body><div class="bar"><button onclick="print()">Salvar como PDF / Imprimir</button></div><main class="report"><section class="cover"><small>LUMINA · MEU UNIVERSO</small><h1>${label}</h1><p>${esc(snapshot.profile.name)}, este documento registra movimentos reais. Gerado em ${fmt(today())}.</p></section><section class="metrics"><div class="metric"><span>Estágio</span><strong>${reportStage}</strong></div><div class="metric"><span>Execução</span><strong>${r.score}%</strong></div><div class="metric"><span>Foco</span><strong>${focus} min</strong></div><div class="metric"><span>Registros</span><strong>${journ.length}</strong></div></section><h2>Áreas da vida</h2><table><thead><tr><th>Área</th><th>Atual</th><th>Desejada</th><th>Execução</th></tr></thead><tbody>${snapshot.areas.map((a) => `<tr><td>${esc(a.icon)} ${esc(a.name)}</td><td>${a.current}/10</td><td>${a.target}/10</td><td>${r.areaExec.find((x) => x.a.id === a.id)?.execution || 0}%</td></tr>`).join("")}</tbody></table><h2>Metas</h2><table><thead><tr><th>Meta</th><th>Área</th><th>Progresso</th><th>Prazo</th></tr></thead><tbody>${snapshot.goals.map((g) => `<tr><td>${esc(g.title)}</td><td>${esc(reportArea(g.areaId)?.name || "Sem área")}</td><td>${goalProgress(g)}%</td><td>${g.due ? fmt(g.due) : "Sem prazo"}</td></tr>`).join("") || '<tr><td colspan="4">Nenhuma meta.</td></tr>'}</tbody></table><h2>Diário</h2>${journ.map((j) => `<div class="entry"><strong>${fmt(j.date)} — Energia ${j.energy}/10</strong><p><b>Fato:</b> ${esc(j.fact)}</p>${j.interpretation ? `<p><b>Interpretação:</b> ${esc(j.interpretation)}</p>` : ""}${j.action ? `<p><b>Próxima postura:</b> ${esc(j.action)}</p>` : ""}</div>`).join("") || "<p>Nenhum registro no período.</p>"}<h2>Evidências</h2><div class="photos">${photos.map((p) => `<figure><img src="${esc(p.dataUrl)}"><figcaption>${esc(p.title || "Evidência")}</figcaption></figure>`).join("")}</div></main></body></html>`,
    );
    w.document.close();
    eventAdd("report", label, "Relatório gerado para impressão ou PDF.");
    save();
  }
  async function exportBackup() {
    if (!ready) return;
    const run = workspaceGeneration;
    const snapshot = structuredClone(state);
    try {
      const photos = await getPhotos(snapshot);
      if (run !== workspaceGeneration) return;
      const blob = new Blob(
        [
          JSON.stringify(
            {
              app: "LUMINA",
              exportedAt: new Date().toISOString(),
              state: { ...snapshot, photos: [] },
              photos,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "lumina-backup-" + today() + ".json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Backup exportado.");
    } catch {
      if (run === workspaceGeneration)
        toast(
          "Não foi possível reunir todas as fotos para o backup. Tente novamente.",
          "error",
        );
    }
  }

  async function restoreBackup(backup) {
    if (workspaceBusy || !ready) return false;
    if (!documentFits(backup.state))
      throw new Error("O backup tem mais texto do que cabe neste espaço.");
    const sync = docSync;
    const media = photosApi;
    const run = workspaceGeneration;
    const uploaded = [];
    let assigned = false;
    workspaceBusy = true;
    $("#workspaceRoot").inert = true;
    $("#workspaceRoot").setAttribute("aria-busy", "true");
    try {
      if (sync && !(await sync.flush()))
        throw new Error(
          "Resolva a sincronização pendente antes da transferência.",
        );
      if (run !== workspaceGeneration) return false;
      if (media) {
        for (const photo of backup.photos) {
          if (run !== workspaceGeneration) return false;
          uploaded.push(await media.put(photo));
        }
      } else if (demoMedia) {
        await demoMedia.replace(backup.photos);
      } else if (backup.photos.length) {
        throw new Error("Este navegador não abriu o armazenamento de fotos.");
      }
      if (run !== workspaceGeneration) return false;
      const restored = { ...backup.state, photos: uploaded };
      if (!documentFits(restored))
        throw new Error(
          "O backup ultrapassa o limite de armazenamento de texto.",
        );
      state = restored;
      assigned = true;
      return await save();
    } finally {
      if (!assigned && uploaded.length)
        await media.remove(uploaded.map((p) => p.path)).catch(() => {});
      if (run === workspaceGeneration) {
        workspaceBusy = false;
        $("#workspaceRoot").inert = false;
        $("#workspaceRoot").removeAttribute("aria-busy");
      }
    }
  }

  async function importBackup(file) {
    const run = workspaceGeneration;
    try {
      if (file.size > 150 * 1024 * 1024)
        throw new Error("Selecione um backup de até 150 MB.");
      const backup = parseBackup(JSON.parse(await file.text()));
      if (run !== workspaceGeneration) return;
      if (
        !(await confirm(
          "Restaurar este backup?",
          "O backup vai substituir os registros e fotos do espaço atual. Exporte uma cópia antes, se quiser preservá-los.",
        )) ||
        run !== workspaceGeneration
      )
        return;
      if (await restoreBackup(backup)) toast("Backup restaurado.");
    } catch (error) {
      toast(
        error instanceof SyntaxError
          ? "O arquivo JSON não é um backup válido."
          : error?.message || "Não foi possível restaurar o backup.",
        "error",
      );
    } finally {
      $("#importInput").value = "";
    }
  }

  async function migrateLegacy() {
    const user = activeUser;
    const run = workspaceGeneration;
    if (!user || !docSync) return;
    try {
      const raw = localValue(LEGACY_KEY);
      const photos = await legacyPhotos();
      if (run !== workspaceGeneration) return;
      if (!raw && !photos.length) {
        toast(
          "Nenhum dado antigo neste endereço. Você pode importar o backup do navegador antigo.",
          "warn",
        );
        return;
      }
      const backup = parseBackup({
        state: raw ? JSON.parse(raw) : initialState(),
        photos,
      });
      if (
        !(await confirm(
          "Trazer seus dados para a nuvem?",
          "A cópia deste navegador vai substituir os registros e fotos desta conta. Os dados antigos continuarão neste navegador.",
        )) ||
        run !== workspaceGeneration
      )
        return;
      toast("Transferindo seus registros e fotos…");
      if (await restoreBackup(backup)) {
        try {
          localStorage.setItem("lumina_migrated_v2:" + user.id, "1");
        } catch {
          /* optional reminder */
        }
        $("#migrationNotice").hidden = true;
        toast("Dados transferidos para a sua conta.");
      }
    } catch (error) {
      toast(
        error?.message ||
          "Não foi possível transferir os dados. Você pode usar um backup JSON.",
        "error",
      );
    }
  }

  async function resetWorkspace() {
    if (
      !(await confirm(
        "Recomeçar seu espaço?",
        "Os registros e fotos do espaço atual serão substituídos pelos dados iniciais. Exporte um backup para preservar sua história.",
      ))
    )
      return;
    try {
      if (await restoreBackup({ state: initialState(), photos: [] }))
        toast("Seu espaço foi reiniciado.");
    } catch (error) {
      toast(error?.message || "Não foi possível recomeçar.", "error");
    }
  }

  function renderSpirit() {
    const filter = $("#dreamFilter").value;
    const list = state.dreams
      .filter((entry) => filter === "all" || entry.status === filter)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    $("#dreamCount").textContent =
      list.length + (list.length === 1 ? " registro" : " registros");
    $("#spiritHomeText").textContent = state.dreams.length
      ? "Seu caderno reúne " +
        state.dreams.length +
        (state.dreams.length === 1 ? " registro." : " registros.")
      : "Dê nome ao sonho, perceba a sensação e escolha um gesto concreto.";
    const container = $("#dreamTable");
    if (!list.length) {
      container.innerHTML =
        '<div class="dream-empty"><span class="spirit-mark" aria-hidden="true">✧</span>' +
        "<h3>" +
        (state.dreams.length
          ? "Nenhum registro nesta etapa"
          : "Seu primeiro sonho começa aqui.") +
        "</h3>" +
        "<p>" +
        (state.dreams.length
          ? "Escolha outro filtro para rever o caderno."
          : "Escreva o que você quer viver e o que pode fazer agora.") +
        "</p>" +
        (state.dreams.length
          ? ""
          : '<button class="primary" type="button" data-open-dream>Escrever meu primeiro registro</button>') +
        "</div>";
      return;
    }

    const field = (value) =>
      '<p class="dream-writing">' +
      (value ? esc(value) : '<span class="muted">A preencher</span>') +
      "</p>";
    container.innerHTML =
      '<table aria-label="Caderno Espírito → Matéria"><thead><tr>' +
      '<th scope="col">Sonho</th><th scope="col">Sensação</th><th scope="col">Visão</th><th scope="col">Matéria</th>' +
      "</tr></thead><tbody>" +
      list
        .map(
          (entry) =>
            '<tr><td data-label="Sonho"><span class="tag dream-status ' +
            entry.status +
            '">' +
            DREAM_STATUSES[entry.status] +
            "</span>" +
            "<h3>" +
            esc(entry.dream) +
            '</h3><div class="dream-actions">' +
            '<button class="link-btn" type="button" data-edit-dream="' +
            entry.id +
            '">Editar</button>' +
            '<button class="link-btn muted" type="button" data-delete-dream="' +
            entry.id +
            '">Excluir</button></div></td>' +
            '<td data-label="Sensação"><small class="eyebrow">HOJE</small>' +
            field(entry.feelingNow) +
            '<small class="eyebrow">AO REALIZAR</small>' +
            field(entry.feelingRealized) +
            "</td>" +
            '<td data-label="Visão">' +
            field(entry.vision) +
            "</td>" +
            '<td data-label="Matéria">' +
            field(entry.matter) +
            (entry.nextDate
              ? '<small class="dream-date">Próximo passo em ' +
                fmt(entry.nextDate) +
                "</small>"
              : "") +
            "</td></tr>",
        )
        .join("") +
      "</tbody></table>";
  }

  function openDream(entry = null) {
    $("#dreamForm").reset();
    $("#dreamDialogTitle").textContent = entry
      ? "Editar registro"
      : "Novo registro";
    $("#dreamId").value = entry?.id || "";
    $("#dreamTitle").value = entry?.dream || "";
    $("#dreamNow").value = entry?.feelingNow || "";
    $("#dreamThen").value = entry?.feelingRealized || "";
    $("#dreamVision").value = entry?.vision || "";
    $("#dreamMatter").value = entry?.matter || "";
    $("#dreamStatus").value = entry?.status || "ideia";
    $("#dreamDate").value = entry?.nextDate || "";
    open("dreamDialog");
  }

  function saveDream(event) {
    event.preventDefault();
    const title = $("#dreamTitle").value.trim();
    if (!title) {
      $("#dreamTitle").focus();
      toast("Escreva o nome do sonho.", "warn");
      return;
    }
    const entry = state.dreams.find(
      (dream) => dream.id === $("#dreamId").value,
    );
    const now = new Date().toISOString();
    const fields = {
      id: entry?.id || uid("dream"),
      dream: title,
      feelingNow: $("#dreamNow").value.trim(),
      feelingRealized: $("#dreamThen").value.trim(),
      vision: $("#dreamVision").value.trim(),
      matter: $("#dreamMatter").value.trim(),
      status: $("#dreamStatus").value,
      nextDate: $("#dreamDate").value,
      createdAt: entry?.createdAt || now,
      updatedAt: now,
    };
    if (entry) Object.assign(entry, fields);
    else state.dreams.unshift(fields);
    $("#dreamFilter").value = "all";
    close("dreamDialog");
    void save();
    toast(entry ? "Registro atualizado." : "Sonho registrado.");
  }

  function moveArea(areaId, direction) {
    const index = state.areas.findIndex((entry) => entry.id === areaId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= state.areas.length) return;
    [state.areas[index], state.areas[next]] = [
      state.areas[next],
      state.areas[index],
    ];
    void save();
  }

  function bind() {
    $$(".nav[data-view],.mobile[data-view]").forEach(
      (b) => (b.onclick = () => setView(b.dataset.view)),
    );
    document.addEventListener("click", async (e) => {
      const t = e.target.closest("button,[data-go]");
      if (!t || !ready) return;
      if (t.dataset.go) setView(t.dataset.go);
      if (t.dataset.close) close(t.dataset.close);
      if (t.dataset.quick) {
        close("quickDialog");
        ({
          area: openArea,
          goal: openGoal,
          habit: openHabit,
          journal: openJournal,
          dream: openDream,
          mission: openMission,
          photo: () => $("#photoInput").click(),
        })[t.dataset.quick]?.();
      }
      if (t.hasAttribute("data-open-dream")) openDream();
      if (t.dataset.editDream)
        openDream(
          state.dreams.find((entry) => entry.id === t.dataset.editDream),
        );
      if (t.dataset.deleteDream) {
        const run = workspaceGeneration;
        if (
          (await confirm(
            "Excluir registro",
            "Este registro sairá do caderno.",
          )) &&
          run === workspaceGeneration
        ) {
          state.dreams = state.dreams.filter(
            (entry) => entry.id !== t.dataset.deleteDream,
          );
          void save();
        }
      }
      if (t.dataset.moveArea)
        moveArea(t.dataset.moveArea, Number(t.dataset.direction));
      if (t.dataset.editArea)
        openArea(state.areas.find((x) => x.id === t.dataset.editArea));
      if (t.dataset.deleteArea) {
        const a = area(t.dataset.deleteArea);
        if (
          await confirm(
            "Excluir área",
            `Excluir "${a?.name}"? Metas e hábitos ficarão sem área.`,
          )
        ) {
          state.areas = state.areas.filter(
            (x) => x.id !== t.dataset.deleteArea,
          );
          state.goals.forEach(
            (g) => g.areaId === t.dataset.deleteArea && (g.areaId = ""),
          );
          for (const collection of [
            state.habits,
            state.missions,
            state.photos,
          ]) {
            for (const record of collection)
              if (record.areaId === t.dataset.deleteArea) record.areaId = "";
          }
          save();
        }
      }
      if (t.dataset.editGoal)
        openGoal(state.goals.find((x) => x.id === t.dataset.editGoal));
      if (t.dataset.deleteGoal) {
        const g = state.goals.find((x) => x.id === t.dataset.deleteGoal);
        if (await confirm("Excluir meta", `Excluir "${g?.title}"?`)) {
          state.goals = state.goals.filter(
            (x) => x.id !== t.dataset.deleteGoal,
          );
          save();
        }
      }
      if (t.dataset.toggleStep) {
        const [g, s] = t.dataset.toggleStep.split(":"),
          goal = state.goals.find((x) => x.id === g),
          step = goal?.steps.find((x) => x.id === s);
        if (step) {
          const was = step.done;
          step.done = !step.done;
          step.completedAt = step.done ? new Date().toISOString() : null;
          goal.completedAt =
            goalProgress(goal) === 100 ? new Date().toISOString() : null;
          if (!was && step.done) {
            reward(18, 4, "Etapa concluída");
            eventAdd("goal", "Etapa concluída", `${goal.title}: ${step.text}`);
            tone(620);
          }
          save();
        }
      }
      if (t.dataset.editHabit)
        openHabit(state.habits.find((x) => x.id === t.dataset.editHabit));
      if (t.dataset.deleteHabit) {
        const h = state.habits.find((x) => x.id === t.dataset.deleteHabit);
        if (
          await confirm(
            "Excluir hábito",
            `Excluir "${h?.title}" e seu histórico?`,
          )
        ) {
          state.habits = state.habits.filter(
            (x) => x.id !== t.dataset.deleteHabit,
          );
          save();
        }
      }
      if (t.dataset.toggleHabit) {
        const h = state.habits.find((x) => x.id === t.dataset.toggleHabit);
        h.logs ??= [];
        const i = h.logs.indexOf(today());
        if (i >= 0) h.logs.splice(i, 1);
        else {
          h.logs.push(today());
          reward(10, 2, "Hábito registrado");
          eventAdd("habit", "Hábito realizado", h.title);
          tone(540);
        }
        save();
      }
      if (t.dataset.toggleMission) {
        const m = state.missions.find((x) => x.id === t.dataset.toggleMission),
          was = m.done;
        m.done = !m.done;
        m.completedAt = m.done ? new Date().toISOString() : null;
        if (!was && m.done) {
          reward(12, 3, "Missão concluída");
          eventAdd("mission", "Missão concluída", m.title);
          tone(700);
        }
        save();
      }
      if (t.dataset.deleteMission) {
        state.missions = state.missions.filter(
          (x) => x.id !== t.dataset.deleteMission,
        );
        save();
      }
      if (
        t.dataset.deleteJournal &&
        (await confirm("Excluir registro", "O registro será removido."))
      ) {
        state.journal = state.journal.filter(
          (x) => x.id !== t.dataset.deleteJournal,
        );
        save();
      }
      if (t.dataset.deletePhoto) void deletePhoto(t.dataset.deletePhoto);
    });
    $("#addDreamBtn").onclick = () => openDream();
    $("#dreamFilter").onchange = renderSpirit;
    $("#dreamForm").onsubmit = saveDream;
    $("#mobileMore").onclick = () => open("mobileDialog");
    $("#syncBtn").onclick = syncNow;
    $("#settingsSync").onclick = syncNow;
    $("#syncRetry").onclick = syncNow;
    $("#useCloudVersion").onclick = () => resolveSync("cloud");
    $("#useLocalVersion").onclick = () => resolveSync("local");
    $("#saveDraftBackup").onclick = exportBackup;
    $("#migrateBtn").onclick = migrateLegacy;
    $("#quickAddBtn").onclick = () => open("quickDialog");
    $("#addAreaBtn").onclick = () => openArea();
    $("#addGoalBtn").onclick = () => openGoal();
    $("#addHabitBtn").onclick = () => openHabit();
    $("#addJournalBtn").onclick = openJournal;
    $("#newMissionBtn").onclick = openMission;
    $("#areaCurrent").oninput = (e) =>
      ($("#currentValue").textContent = e.target.value);
    $("#areaTarget").oninput = (e) =>
      ($("#targetValue").textContent = e.target.value);
    $("#areaForm").onsubmit = (e) => {
      e.preventDefault();
      const id = $("#areaId").value,
        old = state.areas.find((x) => x.id === id),
        p = {
          id: id || uid("area"),
          name: $("#areaName").value.trim(),
          icon: $("#areaIcon").value.trim() || "✦",
          color: $("#areaColor").value,
          importance: +$("#areaImportance").value,
          description: $("#areaDescription").value.trim(),
          current: +$("#areaCurrent").value,
          target: +$("#areaTarget").value,
          createdAt: old?.createdAt || new Date().toISOString(),
        };
      old
        ? Object.assign(old, p)
        : (state.areas.push(p), reward(8, 2, "Área criada"));
      eventAdd("area", old ? "Área atualizada" : "Nova área criada", p.name);
      close("areaDialog");
      save();
    };
    $("#goalForm").onsubmit = (e) => {
      e.preventDefault();
      const id = $("#goalId").value,
        old = state.goals.find((x) => x.id === id),
        texts = $("#goalSteps")
          .value.split("\n")
          .map((x) => x.trim())
          .filter(Boolean),
        remaining = [...(old?.steps || [])],
        steps = texts.map((text) => {
          const previous = remaining.findIndex(
            (step) => step.text.toLowerCase() === text.toLowerCase(),
          );
          if (previous >= 0)
            return { ...remaining.splice(previous, 1)[0], text };
          return { id: uid("step"), text, done: false };
        });
      const p = {
        id: id || uid("goal"),
        title: $("#goalTitle").value.trim(),
        areaId: $("#goalArea").value,
        due: $("#goalDue").value,
        priority: $("#goalPriority").value,
        why: $("#goalWhy").value.trim(),
        steps,
        completedAt:
          steps.length && steps.every((s) => s.done)
            ? new Date().toISOString()
            : null,
        createdAt: old?.createdAt || new Date().toISOString(),
      };
      old
        ? Object.assign(old, p)
        : (state.goals.push(p), reward(12, 3, "Meta criada"));
      eventAdd("goal", old ? "Meta atualizada" : "Nova meta criada", p.title);
      close("goalDialog");
      save();
    };
    $("#habitForm").onsubmit = (e) => {
      e.preventDefault();
      const id = $("#habitId").value,
        old = state.habits.find((x) => x.id === id),
        p = {
          id: id || uid("habit"),
          title: $("#habitTitle").value.trim(),
          areaId: $("#habitArea").value,
          frequency: $("#habitFrequency").value,
          target: +$("#habitTarget").value,
          logs: old?.logs || [],
          createdAt: old?.createdAt || new Date().toISOString(),
        };
      old
        ? Object.assign(old, p)
        : (state.habits.push(p), reward(8, 2, "Hábito criado"));
      eventAdd(
        "habit",
        old ? "Hábito atualizado" : "Novo hábito criado",
        p.title,
      );
      close("habitDialog");
      save();
    };
    $("#journalForm").onsubmit = (e) => {
      e.preventDefault();
      const j = {
        id: uid("journal"),
        date: $("#journalDate").value,
        mood: +$("#journalMood").value,
        energy: +$("#journalEnergy").value,
        fact: $("#journalFact").value.trim(),
        interpretation: $("#journalInterpretation").value.trim(),
        action: $("#journalAction").value.trim(),
        createdAt: new Date().toISOString(),
      };
      state.journal.push(j);
      reward(14, 3, "Registro concluído");
      eventAdd(
        "journal",
        "Revisão de realidade registrada",
        j.fact.slice(0, 120),
      );
      close("journalDialog");
      save();
    };
    $("#missionForm").onsubmit = (e) => {
      e.preventDefault();
      const title = $("#missionTitle").value.trim();
      state.missions.push({
        id: uid("mission"),
        title,
        areaId: $("#missionArea").value,
        done: false,
        createdAt: new Date().toISOString(),
      });
      eventAdd("mission", "Nova missão criada", title);
      close("missionDialog");
      save();
    };
    $("#goalAreaFilter").onchange = renderGoals;
    $("#goalStatusFilter").onchange = renderGoals;
    $("#goalSearch").oninput = renderGoals;
    $("#galleryAreaFilter").onchange = renderGallery;
    $("#photoInput").onchange = (e) => preparePhoto(e.target.files[0]);
    $("#savePhotoBtn").onclick = savePhoto;
    $("#startFocus").onclick = startFocus;
    $("#pauseFocus").onclick = pauseFocus;
    $("#resetFocus").onclick = resetFocus;
    $("#focusDuration").onchange = resetFocus;
    $$(".reportBtn").forEach(
      (b) => (b.onclick = () => report(b.dataset.report)),
    );
    $("#profileForm").onsubmit = (e) => {
      e.preventDefault();
      state.profile.name = $("#settingsName").value.trim() || "Ludzinha";
      state.profile.avatar = $("#settingsAvatar").value.trim() || "Lumi";
      state.profile.accent = $("#settingsAccent").value;
      state.profile.greeting = $("#settingsGreeting").value.trim();
      state.profile.theme = $("#settingsTheme").value;
      state.profile.showCompanion = $("#settingsCompanion").checked;
      state.profile.showScore = $("#settingsScore").checked;
      state.profile.sound = $("#settingsSound").checked;
      save();
      toast("Preferências atualizadas.");
    };
    $("#soundBtn").onclick = () => {
      state.profile.sound = !state.profile.sound;
      $("#soundBtn").textContent = state.profile.sound ? "♫" : "♩";
      save();
      toast(state.profile.sound ? "Som ativado." : "Som desativado.");
    };
    $("#exportBtn").onclick = exportBackup;
    $("#importInput").onchange = (e) =>
      e.target.files[0] && importBackup(e.target.files[0]);
    $("#clearBtn").onclick = resetWorkspace;
    $("#confirmDialog").addEventListener("close", () => {
      confirmResolve?.($("#confirmDialog").returnValue === "confirm");
      confirmResolve = null;
    });
    $("#installBtn").onclick = async () => {
      if (installPrompt) {
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        $("#installBtn").hidden = true;
      }
    };
    addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      installPrompt = e;
      $("#installBtn").hidden = false;
    });
    addEventListener("resize", () => {
      if (!ready) return;
      clearTimeout(window._rz);
      window._rz = setTimeout(() => {
        drawRadar();
        drawEnergy();
      }, 180);
    });
  }
  async function init() {
    $("#todayLabel").textContent = new Intl.DateTimeFormat("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
    })
      .format(new Date())
      .toUpperCase();
    bind();
    try {
      await prepareShell();
    } catch {
      $("#authHeading").textContent = "Atualize o LUMINA.";
      $("#authDescription").textContent =
        "Recarregue para concluir a atualização desta versão.";
      $("#retryConnection").hidden = false;
      $("#retryConnection").textContent = "Recarregar";
      $("#retryConnection").onclick = () => location.reload();
      return;
    }
    startSupabase();
    bindAccount({ unlockCloud, unlockDemo, lock: lockWorkspace, canSignOut });

    const whenVisible = () => {
      if (!document.hidden && canRefresh()) void syncNow();
    };
    document.addEventListener("visibilitychange", whenVisible);
    addEventListener("focus", whenVisible);
    addEventListener("online", whenVisible);
    setInterval(whenVisible, 30_000);
    addEventListener("beforeunload", (event) => {
      if (!docSync?.pending && !workspaceBusy) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }
  init();
})();
