// Amounts use integer centavos. The account balance changes only when money
// actually moves. Card purchases reserve money immediately as unpaid invoices.
export const TYPES = {
  income: "Entrada",
  expense: "Saída",
  card_purchase: "Compra no cartão",
  card_payment: "Pagamento de fatura",
  debt_payment: "Pagamento de dívida",
  investment_contribution: "Aplicação",
  investment_withdrawal: "Resgate",
  investment_adjustment: "Rendimento ou perda",
};
export const FINANCE_VERSION = 1;

export function emptyFinance() {
  return { version: FINANCE_VERSION, accounts: [], cards: [], investments: [], debts: [], assets: [], goals: [], budgets: [], transactions: [] };
}
const safeId = /^[a-zA-Z0-9_-]{1,100}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const monthPattern = /^\d{4}-\d{2}$/;

export function validDate(value) {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function validMonth(value) {
  return typeof value === "string" && monthPattern.test(value) &&
    Number(value.slice(5, 7)) >= 1 && Number(value.slice(5, 7)) <= 12 &&
    Number(value.slice(0, 4)) >= 1900 && Number(value.slice(0, 4)) <= 9999;
}
export function addMonths(month, offset) {
  if (!validMonth(month) || !Number.isInteger(offset)) throw new Error("Mês inválido.");
  const year = Number(month.slice(0, 4)), zeroMonth = Number(month.slice(5)) - 1 + offset;
  const targetYear = year + Math.floor(zeroMonth / 12);
  const targetMonth = ((zeroMonth % 12) + 12) % 12 + 1;
  if (targetYear < 1900 || targetYear > 9999) throw new Error("Mês fora do intervalo.");
  return String(targetYear).padStart(4, "0") + "-" + String(targetMonth).padStart(2, "0");
}
export function firstBillMonth(date, closing, due) {
  if (!validDate(date)) throw new Error("Data inválida.");
  const month = date.slice(0, 7), day = Number(date.slice(8, 10));
  return addMonths(month, (day > closing ? 1 : 0) + (due <= closing ? 1 : 0));
}
export function parseMoney(input, { signed = false } = {}) {
  const value = String(input ?? "").trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!value) throw new Error("Informe um valor.");
  if (!/^-?(?:(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?|\d+\.\d{1,2})$/.test(value))
    throw new Error("Informe o valor em reais, por exemplo 125,50.");
  let normalized = value;
  if (value.includes(",")) normalized = value.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(value)) normalized = value.replace(/\./g, "");
  const negative = normalized.startsWith("-");
  const [whole, fraction = ""] = normalized.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_000) throw new Error("Valor fora do limite.");
  if (negative && !signed) throw new Error("O valor deve ser positivo.");
  return negative ? -cents : cents;
}
export function money(cents) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
export function moneyInput(cents) {
  const abs = Math.abs(cents);
  return (cents < 0 ? "-" : "") + Math.floor(abs / 100) + "," + String(abs % 100).padStart(2, "0");
}
export function splitCents(total, installments) {
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isInteger(installments) || installments < 1 || installments > 60 || total < installments)
    throw new Error("Informe um valor e uma quantidade válida de parcelas.");
  const base = Math.floor(total / installments), remainder = total % installments;
  return Array.from({ length: installments }, (_, index) => base + (index < remainder ? 1 : 0));
}
function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " inválido.");
  return value;
}
function identity(value) {
  if (typeof value !== "string" || !safeId.test(value)) throw new Error("Identificador financeiro inválido.");
  return value;
}
function optionalId(value) { return value ? identity(value) : ""; }
function text(value, max = 200) { return typeof value === "string" ? value.slice(0, max) : ""; }
function cents(value, { signed = false } = {}) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > 100_000_000_000 || (!signed && value < 0))
    throw new Error("Valor financeiro inválido.");
  return value;
}
function dateField(value, optional = false) {
  if (optional && !value) return "";
  if (!validDate(value)) throw new Error("Data financeira inválida.");
  return value;
}
function monthField(value) {
  if (!validMonth(value)) throw new Error("Mês da fatura inválido.");
  return value;
}
function oneOf(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }
function entries(value, mapper) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Lista financeira inválida.");
  const seen = new Set();
  return value.map((entry) => {
    const result = mapper(requireObject(entry, "Registro"));
    if (seen.has(result.id)) throw new Error("Registro financeiro duplicado.");
    seen.add(result.id);
    return result;
  });
}
export function normalizeFinance(raw) {
  if (raw === undefined || raw === null) return emptyFinance();
  const f = requireObject(raw, "Finanças");
  if (f.version !== FINANCE_VERSION) throw new Error("Versão financeira incompatível.");
  const result = {
    version: FINANCE_VERSION,
    accounts: entries(f.accounts, (x) => ({
      id: identity(x.id), name: text(x.name, 80), openingCents: cents(x.openingCents, { signed: true }),
      openingDate: dateField(x.openingDate), overdraftCents: cents(x.overdraftCents),
    })),
    cards: entries(f.cards, (x) => ({
      id: identity(x.id), name: text(x.name, 80), limitCents: cents(x.limitCents),
      closeDay: integer(x.closeDay, 1, 31), dueDay: integer(x.dueDay, 1, 31),
    })),
    investments: entries(f.investments, (x) => ({
      id: identity(x.id), name: text(x.name, 80), category: text(x.category, 60),
      openingCents: cents(x.openingCents), openingDate: dateField(x.openingDate),
    })),
    debts: entries(f.debts, (x) => ({
      id: identity(x.id), name: text(x.name, 80), openingCents: cents(x.openingCents),
      openingDate: dateField(x.openingDate), dueDate: dateField(x.dueDate, true), notes: text(x.notes, 300),
    })),
    assets: entries(f.assets, (x) => ({ id: identity(x.id), name: text(x.name, 80), category: text(x.category, 60), valueCents: cents(x.valueCents) })),
    goals: entries(f.goals, (x) => ({
      id: identity(x.id), name: text(x.name, 100), targetCents: cents(x.targetCents),
      savedCents: cents(x.savedCents), monthlyCents: cents(x.monthlyCents),
      deadline: dateField(x.deadline, true), notes: text(x.notes, 300),
    })),
    budgets: entries(f.budgets, (x) => ({
      id: identity(x.id), month: monthField(x.month), category: text(x.category, 60), limitCents: cents(x.limitCents),
    })),
    transactions: entries(f.transactions, (x) => {
      if (!Object.hasOwn(TYPES, x.type)) throw new Error("Tipo de lançamento inválido.");
      const r = {
        id: identity(x.id), type: x.type, date: dateField(x.date),
        amountCents: cents(x.amountCents, { signed: x.type === "investment_adjustment" }),
        description: text(x.description, 120), category: text(x.category, 60),
        status: x.status === undefined ? "confirmed" : oneOf(x.status, ["confirmed", "planned"], "invalid"),
        accountId: optionalId(x.accountId), cardId: optionalId(x.cardId),
        investmentId: optionalId(x.investmentId), debtId: optionalId(x.debtId),
        billMonth: x.billMonth ? monthField(x.billMonth) : "",
        firstMonth: x.firstMonth ? monthField(x.firstMonth) : "",
        installments: x.installments === undefined ? 1 : integer(x.installments, 1, 60),
      };
      if (r.amountCents === 0) throw new Error("Lançamento sem valor.");
      if (r.status === "invalid") throw new Error("Situação do lançamento inválida.");
      return r;
    }),
  };
  return result;
}
function integer(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error("Número financeiro inválido.");
  return value;
}
export function schedules(finance) {
  const result = [];
  for (const transaction of finance.transactions) {
    if (transaction.type !== "card_purchase") continue;
    const parts = splitCents(transaction.amountCents, transaction.installments);
    parts.forEach((amountCents, index) => result.push({
      transactionId: transaction.id, cardId: transaction.cardId, status: transaction.status,
      purchaseDate: transaction.date, description: transaction.description, category: transaction.category,
      month: addMonths(transaction.firstMonth, index), amountCents, part: index + 1, totalParts: parts.length,
    }));
  }
  return result;
}
export function billAmounts(finance) {
  const bills = new Map();
  function get(cardId, month) {
    const key = cardId + "|" + month;
    if (!bills.has(key)) bills.set(key, { cardId, month, charges: 0, payments: 0 });
    return bills.get(key);
  }
  for (const part of schedules(finance)) if (part.status === "confirmed") get(part.cardId, part.month).charges += part.amountCents;
  for (const t of finance.transactions) if (t.type === "card_payment" && t.status === "confirmed") get(t.cardId, t.billMonth).payments += t.amountCents;
  return [...bills.values()].map((bill) => ({ ...bill, remaining: bill.charges - bill.payments }));
}
export function validateFinance(finance) {
  const find = (list, id, label) => {
    const value = list.find((entry) => entry.id === id);
    if (!value) throw new Error("Selecione " + label + " válido.");
    return value;
  };
  for (const t of finance.transactions) {
    if (["income", "expense", "card_payment", "debt_payment", "investment_contribution", "investment_withdrawal"].includes(t.type)) {
      const account = find(finance.accounts, t.accountId, "uma conta");
      if (t.date < account.openingDate) throw new Error("A data do lançamento é anterior ao saldo inicial da conta.");
    }
    if (t.type === "card_purchase") {
      find(finance.cards, t.cardId, "um cartão");
      if (!validMonth(t.firstMonth) || t.firstMonth < t.date.slice(0, 7)) throw new Error("O primeiro mês da fatura precisa ser igual ou posterior ao mês da compra.");
      splitCents(t.amountCents, t.installments);
      addMonths(t.firstMonth, t.installments - 1);
    }
    if (t.type === "card_payment") {
      find(finance.cards, t.cardId, "um cartão");
      monthField(t.billMonth);
    }
    if (["investment_contribution", "investment_withdrawal", "investment_adjustment"].includes(t.type)) {
      const inv = find(finance.investments, t.investmentId, "um investimento");
      if (t.date < inv.openingDate) throw new Error("O lançamento é anterior ao saldo inicial do investimento.");
    }
    if (t.type === "debt_payment") {
      const debt = find(finance.debts, t.debtId, "uma dívida");
      if (t.date < debt.openingDate) throw new Error("O pagamento é anterior ao saldo inicial da dívida.");
    }
  }
  for (const bill of billAmounts(finance)) if (bill.remaining < 0) {
    throw new Error("Uma fatura ficaria com pagamento maior que o valor das compras. Revise o pagamento ou a compra.");
  }
  const parts = schedules(finance).filter(p => p.status === "confirmed");
  const payments = finance.transactions.filter(t => t.type === "card_payment" && t.status === "confirmed")
    .sort((a, b) => a.date.localeCompare(b.date));
  const paidByBill = new Map();
  for (const payment of payments) {
    const key = payment.cardId + "|" + payment.billMonth;
    const paid = (paidByBill.get(key) || 0) + payment.amountCents;
    const available = parts.filter(p => p.cardId === payment.cardId && p.month === payment.billMonth && p.purchaseDate <= payment.date)
      .reduce((sum, p) => sum + p.amountCents, 0);
    if (paid > available) throw new Error("O pagamento da fatura é anterior às compras ou excede o valor registrado até a data.");
    paidByBill.set(key, paid);
  }
  for (const debt of finance.debts) {
    const paid = finance.transactions.filter(t => t.type === "debt_payment" && t.debtId === debt.id && t.status === "confirmed")
      .reduce((sum, t) => sum + t.amountCents, 0);
    if (paid > debt.openingCents) throw new Error("O pagamento excede o valor registrado para a dívida " + debt.name + ".");
  }
  return true;
}
export function accountBalances(finance, asOf) {
  return finance.accounts.map((account) => {
    let balance = account.openingDate <= asOf ? account.openingCents : 0;
    for (const t of finance.transactions) {
      if (t.status !== "confirmed" || t.accountId !== account.id || t.date > asOf || t.date < account.openingDate) continue;
      if (["income", "investment_withdrawal"].includes(t.type)) balance += t.amountCents;
      if (["expense", "investment_contribution", "card_payment", "debt_payment"].includes(t.type)) balance -= t.amountCents;
    }
    return { ...account, balance };
  });
}
export function investmentBalances(finance, asOf) {
  return finance.investments.map((investment) => {
    let balance = investment.openingDate <= asOf ? investment.openingCents : 0;
    for (const t of finance.transactions) {
      if (t.status !== "confirmed" || t.investmentId !== investment.id || t.date > asOf || t.date < investment.openingDate) continue;
      if (["investment_contribution", "investment_adjustment"].includes(t.type)) balance += t.amountCents;
      if (t.type === "investment_withdrawal") balance -= t.amountCents;
    }
    return { ...investment, balance };
  });
}
export function debtBalances(finance, asOf) {
  return finance.debts.map((debt) => ({
    ...debt,
    remaining: (debt.openingDate <= asOf ? debt.openingCents : 0) -
      finance.transactions.filter(t => t.type === "debt_payment" && t.status === "confirmed" && t.debtId === debt.id && t.date <= asOf)
        .reduce((sum, t) => sum + t.amountCents, 0),
  }));
}
export function cardBalances(finance, asOf) {
  const charges = schedules(finance).filter(p => p.status === "confirmed" && p.purchaseDate <= asOf);
  return finance.cards.map((card) => {
    const spent = charges.filter(p => p.cardId === card.id).reduce((sum, p) => sum + p.amountCents, 0);
    const paid = finance.transactions.filter(t => t.type === "card_payment" && t.status === "confirmed" && t.cardId === card.id && t.date <= asOf)
      .reduce((sum, t) => sum + t.amountCents, 0);
    return { ...card, used: spent - paid, available: card.limitCents - (spent - paid) };
  });
}
export function monthStats(finance, month) {
  const transactions = finance.transactions.filter(t => t.date.slice(0, 7) === month && t.status === "confirmed");
  const sum = (kind) => transactions.filter(t => t.type === kind).reduce((n, t) => n + t.amountCents, 0);
  const installments = schedules(finance).filter(p => p.month === month && p.status === "confirmed");
  const cardCharges = installments.reduce((n, part) => n + part.amountCents, 0);
  return {
    income: sum("income"), directExpense: sum("expense"), cardCharges,
    spending: sum("expense") + cardCharges, cardPaid: sum("card_payment"),
    debtPaid: sum("debt_payment"), contributions: sum("investment_contribution"),
    withdrawals: sum("investment_withdrawal"),
    cashIn: sum("income") + sum("investment_withdrawal"),
    cashOut: sum("expense") + sum("card_payment") + sum("debt_payment") + sum("investment_contribution"),
    planned: finance.transactions.filter(t => t.date.startsWith(month) && t.status === "planned").length,
  };
}
export function budgetUsage(finance, budget) {
  const category = budget.category.trim().toLocaleLowerCase("pt-BR");
  const matches = (item) => !category || item.category.trim().toLocaleLowerCase("pt-BR") === category;
  const direct = finance.transactions.filter(t => t.type === "expense" && t.status === "confirmed" && t.date.startsWith(budget.month) && matches(t))
    .reduce((total, entry) => total + entry.amountCents, 0);
  const card = schedules(finance).filter(p => p.status === "confirmed" && p.month === budget.month && matches(p))
    .reduce((total, entry) => total + entry.amountCents, 0);
  return direct + card;
}
export function overview(finance, asOf) {
  const accounts = accountBalances(finance, asOf), investments = investmentBalances(finance, asOf);
  const cards = cardBalances(finance, asOf), debts = debtBalances(finance, asOf);
  const cash = accounts.reduce((n, a) => n + a.balance, 0);
  const invested = investments.reduce((n, a) => n + a.balance, 0);
  const cardOwed = cards.reduce((n, c) => n + c.used, 0);
  const debtOwed = debts.reduce((n, d) => n + d.remaining, 0);
  const assets = finance.assets.reduce((n, a) => n + a.valueCents, 0);
  return { accounts, investments, cards, debts, cash, invested, assets, cardOwed, debtOwed,
    available: cash - cardOwed, netWorth: cash + invested + assets - cardOwed - debtOwed };
}
export function goalProgress(goal, month) {
  const remaining = Math.max(0, goal.targetCents - goal.savedCents);
  const months = remaining && goal.monthlyCents > 0 ? Math.ceil(remaining / goal.monthlyCents) : null;
  const percent = goal.targetCents > 0 ? Math.min(100, Math.round(goal.savedCents / goal.targetCents * 100)) : 0;
  let estimatedMonth = null;
  if (months) {
    try { estimatedMonth = addMonths(month, months - 1); }
    catch { /* A very distant projection does not have a representable date. */ }
  }
  return { remaining, months, percent, estimatedMonth };
}
