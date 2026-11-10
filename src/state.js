export const LEGACY_KEY = "lumina_state_v1";
export const DEMO_KEY = "lumina_demo_v2";
export const DEFAULT_ACCENT = "#79578b";
export const THEMES = ["linho", "lavanda", "noite"];
export const DREAM_STATUSES = {
  ideia: "Em cultivo",
  movimento: "Em movimento",
  realizado: "Realizado",
};

export function id(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return prefix + "_" + crypto.randomUUID();
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2)
  );
}

export function initialState() {
  const now = new Date().toISOString();
  const areas = [
    [
      "espiritualidade",
      "Espiritualidade",
      "✦",
      "#8b71aa",
      5,
      7,
      9,
      "Fé, presença, oração e alinhamento interior.",
    ],
    [
      "saude",
      "Saúde",
      "♡",
      "#578e7d",
      5,
      6,
      9,
      "Sono, alimentação, energia e cuidado do corpo.",
    ],
    [
      "financas",
      "Finanças",
      "◈",
      "#b5884d",
      4,
      5,
      8,
      "Organização, segurança e construção patrimonial.",
    ],
    [
      "trabalho",
      "Trabalho",
      "⌘",
      "#5f80ab",
      4,
      7,
      9,
      "Carreira, projetos, liderança e impacto.",
    ],
    [
      "estudos",
      "Estudos",
      "⌁",
      "#ac688d",
      4,
      6,
      8,
      "Leitura, idiomas e desenvolvimento intelectual.",
    ],
    [
      "relacoes",
      "Relacionamentos",
      "∞",
      "#b97666",
      4,
      7,
      9,
      "Família, amizades, vínculos e presença.",
    ],
  ].map(
    ([key, name, icon, color, importance, current, target, description]) => ({
      id: "area_" + key,
      name,
      icon,
      color,
      importance,
      current,
      target,
      description,
      createdAt: now,
    }),
  );
  return {
    version: 2,
    profile: {
      name: "Ludzinha",
      avatar: "Lumi",
      accent: DEFAULT_ACCENT,
      theme: "linho",
      sound: true,
      greeting: "",
      showCompanion: true,
      showScore: true,
    },
    xp: 40,
    coins: 12,
    areas,
    goals: [],
    habits: [],
    missions: [],
    journal: [],
    focusSessions: [],
    achievements: [],
    dreams: [],
    photos: [],
    events: [
      {
        id: id("event"),
        type: "system",
        title: "Seu universo foi criado",
        description:
          "Um espaço para cultivar o que importa e acompanhar seus movimentos.",
        date: now,
      },
    ],
  };
}

const safeId = /^[a-zA-Z0-9_-]{1,100}$/;
const safeColor = /^#[0-9a-f]{6}$/i;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const pathPattern =
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[A-Za-z0-9_-]{1,120}\.(jpg|png|webp|gif)$/i;

function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Formato de registro inválido.");
  }
  return value;
}
function str(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
function num(value, fallback, min, max) {
  if (value === "" || value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function key(value, optional = false) {
  if (optional && !value) return "";
  if (typeof value !== "string" || !safeId.test(value))
    throw new Error("Identificador inválido no backup.");
  return value;
}
function color(value, fallback = DEFAULT_ACCENT) {
  return typeof value === "string" && safeColor.test(value) ? value : fallback;
}
function date(value, fallback = "") {
  if (typeof value !== "string" || !dateOnly.test(value.slice(0, 10)))
    return fallback;
  return Number.isFinite(Date.parse(value)) ? value : fallback;
}
function day(value) {
  return date(value).slice(0, 10);
}
function list(value, map, repairRepeatedIds = false) {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error("Uma das listas do backup está inválida.");
  const seen = new Set();
  return value.map((entry, index) => {
    const normalized = map(record(entry));
    if (seen.has(normalized.id)) {
      if (!repairRepeatedIds)
        throw new Error("Há registros duplicados no backup.");
      // The version 1 editor could reuse a step ID for identical step texts.
      const prefix = normalized.id.slice(0, 75) + "_step_" + index;
      let suffix = 0;
      do {
        normalized.id = prefix + "_" + suffix++;
      } while (seen.has(normalized.id));
    }
    seen.add(normalized.id);
    return normalized;
  });
}
function photoFields(entry) {
  return {
    id: key(entry.id),
    title: str(entry.title, "Evidência"),
    areaId: key(entry.areaId, true),
    note: str(entry.note),
    createdAt: date(entry.createdAt, new Date().toISOString()),
  };
}

export function normalizeState(raw) {
  const value = record(raw);
  if (value.version !== undefined && ![1, 2].includes(value.version)) {
    throw new Error("Versão do arquivo incompatível.");
  }
  const fallback = initialState();
  const p = value.profile === undefined ? {} : record(value.profile);
  const now = new Date().toISOString();
  const created = (entry) => date(entry.createdAt, now);
  return {
    version: 2,
    profile: {
      name: str(p.name, fallback.profile.name) || fallback.profile.name,
      avatar: str(p.avatar, fallback.profile.avatar) || fallback.profile.avatar,
      accent: color(p.accent),
      theme: THEMES.includes(p.theme) ? p.theme : "linho",
      sound: p.sound !== false,
      greeting: str(p.greeting),
      showCompanion: p.showCompanion !== false,
      showScore: p.showScore !== false,
    },
    xp: Math.floor(num(value.xp, 40, 0, 1e9)),
    coins: Math.floor(num(value.coins, 12, 0, 1e9)),
    areas:
      value.areas === undefined
        ? fallback.areas
        : list(value.areas, (a) => ({
            id: key(a.id),
            name: str(a.name, "Área"),
            icon: str(a.icon, "✦"),
            color: color(a.color),
            importance: num(a.importance, 3, 1, 5),
            current: num(a.current, 5, 0, 10),
            target: num(a.target, 8, 0, 10),
            description: str(a.description),
            createdAt: created(a),
          })),
    goals: list(value.goals, (g) => ({
      id: key(g.id),
      title: str(g.title),
      areaId: key(g.areaId, true),
      due: day(g.due),
      priority: ["low", "medium", "high"].includes(g.priority)
        ? g.priority
        : "medium",
      why: str(g.why),
      createdAt: created(g),
      completedAt: date(g.completedAt) || null,
      steps: list(
        g.steps,
        (s) => ({
          id: key(s.id),
          text: str(s.text),
          done: s.done === true,
          completedAt: date(s.completedAt) || null,
        }),
        value.version === 1,
      ),
    })),
    habits: list(value.habits, (h) => ({
      id: key(h.id),
      title: str(h.title),
      areaId: key(h.areaId, true),
      createdAt: created(h),
      frequency: ["daily", "weekdays", "3x", "weekly"].includes(h.frequency)
        ? h.frequency
        : "daily",
      target: Math.round(num(h.target, 7, 1, 7)),
      logs: Array.isArray(h.logs)
        ? [...new Set(h.logs.map(day).filter(Boolean))]
        : [],
    })),
    missions: list(value.missions, (m) => ({
      id: key(m.id),
      title: str(m.title),
      areaId: key(m.areaId, true),
      createdAt: created(m),
      done: m.done === true,
      completedAt: date(m.completedAt) || null,
    })),
    journal: list(value.journal, (j) => ({
      id: key(j.id),
      date: day(j.date) || created(j).slice(0, 10),
      createdAt: created(j),
      mood: num(j.mood, 3, 1, 5),
      energy: num(j.energy, 6, 0, 10),
      fact: str(j.fact),
      interpretation: str(j.interpretation),
      action: str(j.action),
    })),
    focusSessions: list(value.focusSessions, (s) => ({
      id: key(s.id),
      goalId: key(s.goalId, true),
      label: str(s.label, "Sessão livre"),
      minutes: num(s.minutes, 0, 0, 1440),
      date: date(s.date, now),
    })),
    events: list(value.events, (e) => ({
      id: key(e.id),
      type: str(e.type, "system"),
      title: str(e.title),
      description: str(e.description),
      date: date(e.date, now),
    })),
    achievements: Array.isArray(value.achievements) ? value.achievements : [],
    dreams: list(value.dreams, (d) => ({
      id: key(d.id),
      dream: str(d.dream),
      feelingNow: str(d.feelingNow),
      feelingRealized: str(d.feelingRealized),
      vision: str(d.vision),
      matter: str(d.matter),
      status: Object.hasOwn(DREAM_STATUSES, d.status) ? d.status : "ideia",
      nextDate: day(d.nextDate),
      createdAt: created(d),
      updatedAt: date(d.updatedAt, created(d)),
    })),
    photos: list(value.photos, (p) => {
      if (typeof p.path !== "string" || !pathPattern.test(p.path)) {
        throw new Error("Caminho de foto inválido.");
      }
      return { ...photoFields(p), path: p.path };
    }),
  };
}

export function validDataImage(value) {
  return (
    typeof value === "string" &&
    value.length <= 7_000_000 &&
    /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(
      value,
    )
  );
}

export function parseBackup(raw) {
  const box = record(raw);
  const value = record(box.state ?? box);
  if (![1, 2].includes(value.version) || !Array.isArray(value.areas)) {
    throw new Error("Selecione um backup JSON gerado pelo LUMINA.");
  }
  const photos = list(box.state ? box.photos : undefined, (p) => {
    if (!validDataImage(p.dataUrl))
      throw new Error("Uma das imagens do backup é inválida ou muito grande.");
    return { ...photoFields(p), dataUrl: p.dataUrl };
  });
  // The portable backup carries the image bytes, not account-specific paths.
  return { state: normalizeState({ ...value, photos: [] }), photos };
}

export function documentFits(state) {
  return new TextEncoder().encode(JSON.stringify(state)).length <= 3_800_000;
}
