import {
  TYPES, emptyFinance, normalizeFinance, validateFinance, parseMoney, money, moneyInput,
  firstBillMonth, addMonths, schedules, billAmounts, accountBalances, cardBalances,
  investmentBalances, debtBalances, monthStats, overview, goalProgress, budgetUsage,
} from "./finance-core.js";

const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const label = (value) => escapeHtml(value);
const today = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const monthLabel = (month) => new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" })
  .format(new Date(month + "-01T12:00:00"));
const shortDate = (date) => date ? date.slice(8, 10) + "/" + date.slice(5, 7) + "/" + date.slice(0, 4) : "Sem data";
const names = {
  account: "conta", card: "cartão", investment: "investimento", debt: "dívida",
  asset: "bem", goal: "meta", budget: "limite", transaction: "lançamento",
};
const sections = {
  overview: "Visão geral", transactions: "Lançamentos", accounts: "Contas e cartões",
  investments: "Investimentos e patrimônio", debts: "Dívidas", goals: "Metas",
};
const lists = { account: "accounts", card: "cards", investment: "investments", debt: "debts", asset: "assets", goal: "goals", budget: "budgets", transaction: "transactions" };

export function createFinance({ getState, save, toast, confirm, uid }) {
  let section = "overview";
  let selectedMonth = today().slice(0, 7);
  let editing = null;
  let autoInvoice = true;
  const root = $("#financeContent");
  const dialog = $("#financeDialog");
  const body = $("#financeDialogBody");

  const current = () => getState().finance;
  const readable = (description) => label(description || "Sem descrição");
  const financeButton = (kind, text, extra = "") =>
    '<button type="button" class="secondary" data-fin-add="' + label(kind) + '" ' + extra + '>' + label(text) + '</button>';
  const actions = (kind, id) =>
    '<div class="fin-card-actions"><button type="button" class="link-btn" data-fin-edit="' + label(kind) + '" data-id="' + label(id) + '">Editar</button>' +
    '<button type="button" class="link-btn fin-delete" data-fin-delete="' + label(kind) + '" data-id="' + label(id) + '">Excluir</button></div>';
  const blank = (title, detail = "") =>
    '<div class="fin-empty"><strong>' + label(title) + '</strong>' + (detail ? '<span>' + label(detail) + '</span>' : "") + '</div>';
  const stat = (title, value, sub = "", accent = "") =>
    '<div class="fin-stat ' + accent + '"><span>' + label(title) + '</span><strong>' + money(value) + '</strong>' +
    (sub ? '<small>' + label(sub) + '</small>' : "") + '</div>';
  const card = (content) => '<article class="fin-card">' + content + '</article>';
  const dateMonth = (value) => value ? monthLabel(value) : "—";
  const finToday = () => today();

  function heading(title, subtitle, button = "") {
    return '<div class="fin-section-head"><div><h3>' + label(title) + '</h3>' +
      (subtitle ? '<p>' + label(subtitle) + '</p>' : "") + '</div>' + button + '</div>';
  }
  function progressBar(percent, warning = false) {
    const width = Math.max(0, Math.min(100, percent));
    return '<div class="fin-progress' + (warning ? ' warning' : '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + width + '">' +
      '<span style="width:' + width + '%"></span></div>';
  }
  function renderBudget(finance, budget) {
    const used = budgetUsage(finance, budget);
    const percentage = budget.limitCents ? Math.round(used / budget.limitCents * 100) : 0;
    const diff = budget.limitCents - used;
    return card('<div class="fin-row"><div><small>' + (budget.category ? 'CATEGORIA' : 'MÊS COMPLETO') + '</small><h4>' +
      label(budget.category || "Orçamento geral") + '</h4></div><span class="fin-badge ' + (diff < 0 ? 'bad' : '') + '">' + percentage + '%</span></div>' +
      progressBar(percentage, diff < 0) + '<p class="fin-card-detail">' + money(used) + ' de ' + money(budget.limitCents) + '</p>' +
      '<p class="' + (diff < 0 ? 'fin-warning' : 'fin-muted') + '">' +
      (diff < 0 ? 'Ultrapassou ' + money(-diff) : 'Restam ' + money(diff)) + '</p>' + actions("budget", budget.id));
  }
  function dashboard(finance) {
    const metrics = overview(finance, finToday());
    const monthly = monthStats(finance, selectedMonth);
    const budgets = finance.budgets.filter((entry) => entry.month === selectedMonth);
    const warnings = [];
    for (const account of metrics.accounts) {
      if (account.balance < 0) warnings.push(account.name + " está no cheque especial em " + money(-account.balance) + ".");
      if (account.overdraftCents && -account.balance > account.overdraftCents) warnings.push(account.name + " ultrapassou o limite do cheque especial.");
    }
    for (const cardData of metrics.cards) {
      if (cardData.available < 0) warnings.push(cardData.name + " ultrapassou o limite em " + money(-cardData.available) + ".");
      else if (cardData.limitCents > 0 && cardData.used >= cardData.limitCents * .8) warnings.push(cardData.name + " já usou pelo menos 80% do limite.");
    }
    for (const budget of budgets) {
      const spent = budgetUsage(finance, budget);
      if (spent > budget.limitCents) warnings.push((budget.category || "Orçamento do mês") + " ultrapassou o limite em " + money(spent - budget.limitCents) + ".");
    }
    for (const debt of metrics.debts) {
      if (debt.remaining > 0 && debt.dueDate && debt.dueDate < finToday()) warnings.push(debt.name + " está com o prazo vencido.");
    }
    if (finance.accounts.length && metrics.available < 0) warnings.push("O saldo disponível após reservar cartões está negativo em " + money(-metrics.available) + ".");
    const bills = billAmounts(finance).filter((bill) => bill.month === selectedMonth && bill.charges > 0);
    const categoryTotals = new Map();
    for (const tx of finance.transactions) {
      if (tx.type === "expense" && tx.status === "confirmed" && tx.date.startsWith(selectedMonth)) {
        const key = tx.category.trim() || "Sem categoria";
        categoryTotals.set(key, (categoryTotals.get(key) || 0) + tx.amountCents);
      }
    }
    for (const part of schedules(finance)) if (part.status === "confirmed" && part.month === selectedMonth) {
      const key = part.category.trim() || "Sem categoria";
      categoryTotals.set(key, (categoryTotals.get(key) || 0) + part.amountCents);
    }
    const categories = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]);
    return '<div class="fin-section-head fin-main-head"><div><span class="eyebrow">SEU DINHEIRO, COM CLAREZA</span><h2>Meu financeiro</h2><p>Acompanhe o mês e veja seus compromissos.</p></div>' +
      '<button class="primary" type="button" data-fin-add="transaction">＋ Novo lançamento</button></div>' +
      '<div class="fin-metric-grid">' + stat("Entradas do mês", monthly.income, "Entradas confirmadas") +
      stat("Saídas das contas", monthly.cashOut, "Pagamentos e aplicações") +
      stat("Gastos do mês", monthly.spending, "Saídas + parcelas das faturas") +
      stat("Investido no mês", monthly.contributions, "Aplicações registradas") +
      stat("Saldo das contas", metrics.cash, "Hoje, após movimentações", "featured") + '</div>' +
      '<div class="fin-available glass"><div><small>DISPONÍVEL APÓS CARTÕES</small><strong>' + money(metrics.available) + '</strong><p>Saldo das contas menos compras de cartão ainda não pagas.</p></div>' +
      '<div><span>Cartões comprometidos</span><strong>' + money(metrics.cardOwed) + '</strong><small>Inclui parcelas futuras de compras já feitas</small></div></div>' +
      (warnings.length ? '<div class="fin-alert" role="status"><strong>Atenção aos seus limites</strong><ul>' + warnings.map(w => '<li>' + label(w) + '</li>').join("") + '</ul></div>' : '') +
      '<div class="fin-two-columns"><section class="glass fin-panel">' + heading("Para pagar neste mês", "Faturas separadas por cartão.", financeButton("transaction", "Pagar fatura", 'data-preset="card_payment"')) +
      (bills.length ? bills.map((bill) => {
        const linked = finance.cards.find(c => c.id === bill.cardId);
        return '<div class="fin-line"><div><strong>' + label(linked?.name || "Cartão") + '</strong><small>Fatura ' + label(dateMonth(bill.month)) + ' · Pago ' + money(bill.payments) + '</small></div><strong>' + money(bill.remaining) + '</strong></div>';
      }).join("") : blank("Nenhuma fatura neste mês", "Cadastre uma compra no cartão para acompanhar.")) +
      '</section><section class="glass fin-panel">' + heading("Gastos por categoria", "Saídas e parcelas que pertencem ao mês.") +
      (categories.length ? categories.map(([category, total]) => '<div class="fin-line"><span>' + label(category) + '</span><strong>' + money(total) + '</strong></div>').join("") : blank("Sem gastos registrados", "Seus lançamentos aparecem aqui.")) +
      '</section></div>' +
      '<section class="fin-subsection">' + heading("Orçamentos do mês", "Defina um limite geral ou por categoria.", financeButton("budget", "＋ Novo orçamento")) +
      '<div class="fin-card-grid">' + (budgets.length ? budgets.map(b => renderBudget(finance, b)).join("") : blank("Você ainda não definiu limites", "Crie um orçamento para acompanhar o quanto ainda pode gastar.")) + '</div></section>';
  }

  function transactionView(finance) {
    const transactions = [...finance.transactions].filter(t => t.date.startsWith(selectedMonth)).sort((a, b) => b.date.localeCompare(a.date));
    const stats = monthStats(finance, selectedMonth);
    const lookup = (type, id) => finance[type].find((item) => item.id === id)?.name || "—";
    return heading("Lançamentos", "Entradas e saídas por data. As compras parceladas aparecem nas faturas de cada mês.", '<button class="primary" data-fin-add="transaction" type="button">＋ Novo lançamento</button>') +
      '<div class="fin-inline-summary"><span>Entradas e resgates <strong>' + money(stats.cashIn) + '</strong></span><span>Saídas das contas <strong>' + money(stats.cashOut) + '</strong></span><span>Faturas pagas <strong>' + money(stats.cardPaid) + '</strong></span><span>Planejados <strong>' + stats.planned + '</strong></span></div>' +
      '<div class="glass fin-panel">' + (transactions.length ? '<div class="fin-ledger">' + transactions.map((tx) => {
        const source = tx.type === "card_purchase" || tx.type === "card_payment" ? lookup("cards", tx.cardId) :
          tx.type === "investment_adjustment" ? lookup("investments", tx.investmentId) : lookup("accounts", tx.accountId);
        const sign = ["income", "investment_withdrawal"].includes(tx.type) ? "+" :
          tx.type === "investment_adjustment" ? (tx.amountCents < 0 ? "−" : "+") : "−";
        const suffix = tx.type === "card_purchase" ? ' · ' + tx.installments + 'x · 1ª fatura ' + dateMonth(tx.firstMonth) :
          tx.type === "card_payment" ? ' · Fatura ' + dateMonth(tx.billMonth) : '';
        return '<article class="fin-entry"><div class="fin-entry-icon">' + (tx.type === "income" ? "＋" : tx.type === "card_purchase" ? "◫" : "•") + '</div>' +
          '<div class="fin-entry-main"><strong>' + readable(tx.description || TYPES[tx.type]) + '</strong><small>' + label(shortDate(tx.date) + ' · ' + TYPES[tx.type] + ' · ' + source + suffix) +
          (tx.category ? ' · ' + label(tx.category) : '') + (tx.status === "planned" ? ' · Planejado' : '') + '</small></div>' +
          '<div class="fin-entry-value"><strong>' + sign + money(Math.abs(tx.amountCents)) + '</strong>' + actions("transaction", tx.id) + '</div></article>';
      }).join("") + '</div>' : blank("Nenhum lançamento neste mês", "Adicione uma entrada, uma saída ou uma movimentação.")) + '</div>';
  }
  function accountsView(finance) {
    const now = finToday();
    const accounts = accountBalances(finance, now), cards = cardBalances(finance, now);
    const installments = schedules(finance);
    const bills = billAmounts(finance).filter((b) => b.month === selectedMonth && b.charges > 0);
    return '<section class="fin-subsection">' + heading("Contas e cheque especial", "O saldo considera entradas e saídas confirmadas até hoje.", financeButton("account", "＋ Nova conta")) +
      '<div class="fin-card-grid">' + (accounts.length ? accounts.map(a => card(
        '<div class="fin-row"><div><small>CONTA</small><h4>' + label(a.name) + '</h4></div><span class="fin-symbol">◈</span></div>' +
        '<p class="fin-amount">' + money(a.balance) + '</p><p class="fin-muted">Cheque especial cadastrado ' + money(a.overdraftCents) + '</p>' +
        (a.balance < 0 ? '<p class="fin-warning">Utilizado ' + money(-a.balance) + '</p>' : '') + actions("account", a.id)
      )).join("") : blank("Nenhuma conta cadastrada", "Comece pelo saldo que você tem hoje.")) + '</div></section>' +
      '<section class="fin-subsection">' + heading("Cartões", "Limite usado inclui todas as parcelas de compras já realizadas.", financeButton("card", "＋ Novo cartão")) +
      '<div class="fin-card-grid">' + (cards.length ? cards.map(c => {
        const pct = c.limitCents ? Math.max(0, Math.round(c.used / c.limitCents * 100)) : 0;
        const b = bills.find(x => x.cardId === c.id);
        return card('<div class="fin-row"><div><small>CARTÃO</small><h4>' + label(c.name) + '</h4></div><span class="fin-symbol">◫</span></div>' +
          '<p class="fin-card-detail">Limite disponível</p><p class="fin-amount">' + money(c.available) + '</p>' +
          progressBar(pct, c.available < 0) + '<p class="fin-muted">' + money(c.used) + ' usado de ' + money(c.limitCents) + '</p>' +
          '<p class="fin-muted">Fecha dia ' + c.closeDay + ' · Vence dia ' + c.dueDay + '</p>' +
          '<p class="fin-card-detail">Fatura ' + label(dateMonth(selectedMonth)) + ': <strong>' + money(b?.remaining || 0) + '</strong></p>' +
          financeButton("transaction", "Registrar compra", 'data-preset="card_purchase" data-card="' + label(c.id) + '"') + ' ' +
          financeButton("transaction", "Pagar fatura", 'data-preset="card_payment" data-card="' + label(c.id) + '"') + actions("card", c.id));
      }).join("") : blank("Nenhum cartão cadastrado", "Inclua limite, dia de fechamento e vencimento.")) + '</div></section>' +
      '<section class="glass fin-panel fin-subsection">' + heading("Parcelas da fatura", "Valores previstos para " + dateMonth(selectedMonth) + ".") +
      (() => { const entries = installments.filter(p => p.month === selectedMonth && p.status === "confirmed");
        return entries.length ? entries.map(p => '<div class="fin-line"><div><strong>' + readable(p.description) + '</strong><small>' +
          label(finance.cards.find(c => c.id === p.cardId)?.name || "Cartão") + ' · ' + p.part + '/' + p.totalParts + '</small></div><strong>' + money(p.amountCents) + '</strong></div>').join("") :
          blank("Nenhuma parcela neste mês"); })() + '</section>';
  }
  function investmentView(finance) {
    const info = overview(finance, finToday());
    const groups = [
      ["Contas positivas", info.accounts.reduce((n, a) => n + Math.max(0, a.balance), 0), "#9f83b6"],
      ["Investimentos", info.investments.reduce((n, i) => n + Math.max(0, i.balance), 0), "#7cae9d"],
      ["Bens", info.assets, "#d7a27e"],
    ].filter((part) => part[1] > 0);
    const total = groups.reduce((n, x) => n + x[1], 0);
    let offset = 0;
    const parts = groups.map(g => {
      const start = offset; offset += g[1] / total * 100;
      return g[2] + ' ' + start + '% ' + offset + '%';
    });
    const negativeAccounts = info.accounts.reduce((n, a) => n + Math.min(0, a.balance), 0);
    const negativeInvestments = info.investments.reduce((n, i) => n + Math.min(0, i.balance), 0);
    return '<section class="glass fin-panel fin-subsection">' + heading("Seu patrimônio", "Posição de hoje com os valores que você registrou.") +
      '<div class="fin-worth"><div class="fin-pie" role="img" aria-label="' + label(groups.length ? 'Composição dos bens: ' + groups.map(g => g[0] + ' ' + money(g[1])).join(", ") : "Nenhum patrimônio registrado") + '" style="background:' +
      (parts.length ? 'conic-gradient(' + parts.join(",") + ')' : 'var(--soft)') + '"><div><small>BRUTO POSITIVO</small><strong>' + money(total) + '</strong></div></div>' +
      '<div class="fin-worth-text"><p>Patrimônio líquido</p><strong>' + money(info.netWorth) + '</strong>' +
      '<small>Contas + investimentos + bens − cartões e dívidas.</small><div class="fin-legend">' +
      (groups.length ? groups.map(g => '<div><span><i style="background:' + g[2] + '"></i>' + label(g[0]) + '</span><strong>' + money(g[1]) + '</strong></div>').join("") : '<p class="fin-muted">Cadastre contas, investimentos ou bens.</p>') +
      (negativeAccounts < 0 ? '<div><span>Contas negativas</span><strong>' + money(negativeAccounts) + '</strong></div>' : '') +
      (negativeInvestments < 0 ? '<div><span>Investimentos negativos</span><strong>' + money(negativeInvestments) + '</strong></div>' : '') +
      '<div><span>Cartões em aberto</span><strong>− ' + money(info.cardOwed) + '</strong></div><div><span>Dívidas</span><strong>− ' + money(info.debtOwed) + '</strong></div></div></div></div></section>' +
      '<section class="fin-subsection">' + heading("Investimentos", "Registre aportes, resgates e atualizações de rendimento.", financeButton("investment", "＋ Novo investimento")) +
      '<div class="fin-card-grid">' + (info.investments.length ? info.investments.map(inv => card(
        '<div class="fin-row"><div><small>INVESTIMENTO</small><h4>' + label(inv.name) + '</h4></div><span class="fin-symbol">✳</span></div>' +
        '<p class="fin-amount">' + money(inv.balance) + '</p><p class="fin-muted">' + label(inv.category || "Sem categoria") + '</p>' +
        financeButton("transaction", "Movimentar", 'data-preset="investment_contribution" data-investment="' + label(inv.id) + '"') + actions("investment", inv.id)
      )).join("") : blank("Nenhum investimento registrado", "Informe o saldo atual e acompanhe suas movimentações.")) + '</div></section>' +
      '<section class="fin-subsection">' + heading("Outros bens", "Inclua bens pelo valor que você informar.", financeButton("asset", "＋ Novo bem")) +
      '<div class="fin-card-grid">' + (finance.assets.length ? finance.assets.map(a => card(
        '<div class="fin-row"><div><small>BEM</small><h4>' + label(a.name) + '</h4></div><span class="fin-symbol">◇</span></div>' +
        '<p class="fin-amount">' + money(a.valueCents) + '</p><p class="fin-muted">' + label(a.category || "Outros") + '</p>' + actions("asset", a.id)
      )).join("") : blank("Nenhum bem cadastrado")) + '</div></section>';
  }
  function debtView(finance) {
    const debts = debtBalances(finance, finToday());
    return heading("Dívidas", "Cadastre o saldo que falta pagar e registre cada pagamento.", financeButton("debt", "＋ Nova dívida")) +
      '<div class="fin-card-grid">' + (debts.length ? debts.map(d => card(
        '<div class="fin-row"><div><small>DÍVIDA</small><h4>' + label(d.name) + '</h4></div><span class="fin-badge ' + (d.remaining === 0 ? "good" : "") + '">' +
        (d.remaining === 0 ? 'Quitada' : 'Em aberto') + '</span></div><p class="fin-amount">' + money(d.remaining) + '</p>' +
        '<p class="fin-muted">Saldo cadastrado ' + money(d.openingCents) + (d.dueDate ? ' · Vence ' + shortDate(d.dueDate) : '') + '</p>' +
        (d.notes ? '<p class="fin-card-detail">' + label(d.notes) + '</p>' : '') +
        financeButton("transaction", "Registrar pagamento", 'data-preset="debt_payment" data-debt="' + label(d.id) + '"') + actions("debt", d.id)
      )).join("") : blank("Nenhuma dívida cadastrada", "Registre os valores que você deseja acompanhar.")) + '</div>';
  }
  function goalView(finance) {
    return heading("Metas financeiras", "Defina quanto já guardou e quanto pretende guardar por mês.", financeButton("goal", "＋ Nova meta")) +
      '<div class="fin-card-grid">' + (finance.goals.length ? finance.goals.map(g => {
        const progress = goalProgress(g, finToday().slice(0, 7));
        return card('<div class="fin-row"><div><small>META FINANCEIRA</small><h4>' + label(g.name) + '</h4></div><span class="fin-badge ' +
          (progress.remaining === 0 ? 'good' : '') + '">' + progress.percent + '%</span></div><p class="fin-amount">' + money(g.savedCents) +
          '<small> de ' + money(g.targetCents) + '</small></p>' + progressBar(progress.percent) +
          '<div class="fin-goal-info"><span>Falta <strong>' + money(progress.remaining) + '</strong></span><span>Por mês <strong>' + money(g.monthlyCents) + '</strong></span></div>' +
          '<p class="fin-card-detail">' + (progress.remaining === 0 ? 'Meta alcançada.' :
          progress.months ? 'Estimativa: ' + progress.months + (progress.months === 1 ? ' mês' : ' meses') + (progress.estimatedMonth ? ' · ' + label(monthLabel(progress.estimatedMonth)) : '') : 'Informe quanto pretende guardar por mês para ver uma estimativa.') + '</p>' +
          (g.deadline ? '<p class="fin-muted">Data desejada: ' + shortDate(g.deadline) + '</p>' : '') +
          (g.notes ? '<p class="fin-muted">' + label(g.notes) + '</p>' : '') + actions("goal", g.id));
      }).join("") : blank("Nenhuma meta financeira", "Dê um nome ao que quer construir e defina um valor.")) + '</div>' +
      '<p class="fin-footnote">O valor guardado em cada meta é informado por você. A estimativa usa o valor mensal cadastrado e considera o mês atual como o primeiro.</p>';
  }
  const views = { overview: dashboard, transactions: transactionView, accounts: accountsView, investments: investmentView, debts: debtView, goals: goalView };

  function render() {
    if (!$("#financeView").classList.contains("active")) return;
    const f = current();
    root.innerHTML = '<div class="fin-topline"><nav class="fin-tabs" aria-label="Seções financeiras">' +
      Object.entries(sections).map(([key, title]) => '<button type="button" data-fin-section="' + key + '" class="' + (section === key ? 'active' : '') +
        '"' + (section === key ? ' aria-current="page"' : '') + '>' + label(title) + '</button>').join("") +
      '</nav><label class="fin-month-label">Mês <input type="month" id="financeMonth" value="' + label(selectedMonth) + '" min="1900-01" max="9994-12"></label></div>' +
      views[section](f) + '<p class="fin-footnote">Registros manuais em reais. Confira os valores com suas contas e faturas.</p>';
  }

  function field(name, title, value = "", options = {}) {
    const { type = "text", required = false, hint = "", attrs = "" } = options;
    return '<label class="fin-field">' + label(title) + '<input name="' + label(name) + '" type="' + label(type) +
      '" value="' + label(value) + '" ' + (required ? 'required ' : '') + attrs + '>' +
      (hint ? '<small>' + label(hint) + '</small>' : '') + '</label>';
  }
  function amountField(name, title, value, hint = "") {
    return field(name, title, moneyInput(value ?? 0), { required: true, hint, attrs: 'inputmode="decimal" maxlength="24" placeholder="0,00"' });
  }
  function choose(name, title, entries, selected = "", hint = "") {
    return '<label class="fin-field">' + label(title) + '<select name="' + label(name) + '">' +
      '<option value="">Selecione</option>' + entries.map(([id, name]) => '<option value="' + label(id) + '"' +
      (id === selected ? ' selected' : '') + '>' + label(name) + '</option>').join("") + '</select>' +
      (hint ? '<small>' + label(hint) + '</small>' : '') + '</label>';
  }
  function commonName(record) {
    return field("name", "Nome", record?.name || "", { required: true, attrs: 'maxlength="80" placeholder="Como você quer chamar?"' });
  }
  function formFields(kind, record, preset = {}) {
    const f = current();
    const openDate = record?.openingDate || finToday();
    const notes = field("notes", "Observações", record?.notes || "", { attrs: 'maxlength="300" placeholder="Opcional"' });
    if (kind === "account") return commonName(record) +
      '<div class="form-grid two">' + amountField("openingCents", "Saldo da conta na data", record?.openingCents, "Pode ser negativo se já estiver usando o cheque especial.") +
      field("openingDate", "Data do saldo informado", openDate, { type: "date", required: true }) + '</div>' +
      amountField("overdraftCents", "Limite do cheque especial", record?.overdraftCents, "Deixe zero se não houver.");
    if (kind === "card") return commonName(record) +
      amountField("limitCents", "Limite total do cartão", record?.limitCents) +
      '<div class="form-grid two">' + field("closeDay", "Dia de fechamento", record?.closeDay || 1, { type: "number", required: true, attrs: 'min="1" max="31"' }) +
      field("dueDay", "Dia de vencimento", record?.dueDay || 10, { type: "number", required: true, attrs: 'min="1" max="31"' }) + '</div>' +
      '<p class="fin-form-hint">A primeira fatura é sugerida pelo fechamento. Confira a fatura do banco ao cadastrar a compra.</p>';
    if (kind === "investment") return commonName(record) +
      field("category", "Tipo de investimento", record?.category || "", { attrs: 'maxlength="60" placeholder="Ex.: renda fixa, ações"' }) +
      '<div class="form-grid two">' + amountField("openingCents", "Valor já investido na data", record?.openingCents) +
      field("openingDate", "Data do saldo informado", openDate, { type: "date", required: true }) + '</div>';
    if (kind === "asset") return commonName(record) +
      field("category", "Tipo de bem", record?.category || "", { attrs: 'maxlength="60" placeholder="Ex.: veículo, imóvel"' }) +
      amountField("valueCents", "Valor estimado", record?.valueCents);
    if (kind === "debt") return commonName(record) +
      '<div class="form-grid two">' + amountField("openingCents", "Saldo a pagar na data", record?.openingCents) +
      field("openingDate", "Data do saldo informado", openDate, { type: "date", required: true }) + '</div>' +
      field("dueDate", "Vencimento ou data desejada", record?.dueDate || "", { type: "date" }) + notes +
      '<p class="fin-form-hint">Use este cadastro para dívidas que não estejam nas faturas já registradas.</p>';
    if (kind === "goal") return commonName(record) +
      '<div class="form-grid two">' + amountField("targetCents", "Valor da meta", record?.targetCents) +
      amountField("savedCents", "Quanto já guardou", record?.savedCents) +
      amountField("monthlyCents", "Quanto planeja guardar por mês", record?.monthlyCents) +
      field("deadline", "Data desejada", record?.deadline || "", { type: "date" }) + '</div>' + notes +
      '<p class="fin-form-hint">A meta é um acompanhamento: o valor guardado é atualizado manualmente e não altera o saldo das contas.</p>';
    if (kind === "budget") return field("month", "Mês", record?.month || selectedMonth, { type: "month", required: true, attrs: 'min="1900-01" max="9994-12"' }) +
      field("category", "Categoria", record?.category || "", { attrs: 'maxlength="60" placeholder="Vazio = todas as categorias"', hint: "Para uma categoria, use o mesmo nome dos lançamentos." }) +
      amountField("limitCents", "Limite de gastos no mês", record?.limitCents);
    const txType = record?.type || preset.preset || "expense";
    const txDate = record?.date || finToday();
    const types = Object.entries(TYPES);
    const typeSelect = choose("type", "Tipo de lançamento", types, txType);
    const accountSelect = choose("accountId", "Conta", f.accounts.map(x => [x.id, x.name]), record?.accountId || "");
    const cardSelect = choose("cardId", "Cartão", f.cards.map(x => [x.id, x.name]), record?.cardId || preset.card || "");
    const investSelect = choose("investmentId", "Investimento", f.investments.map(x => [x.id, x.name]), record?.investmentId || preset.investment || "");
    const debtSelect = choose("debtId", "Dívida", f.debts.map(x => [x.id, x.name]), record?.debtId || preset.debt || "");
    return typeSelect +
      field("description", "Descrição", record?.description || "", { required: true, attrs: 'maxlength="120" placeholder="Ex.: salário, mercado, fatura..."' }) +
      '<div class="form-grid two">' + field("date", "Data", txDate, { type: "date", required: true }) +
      amountField("amountCents", "Valor em reais", record?.amountCents, "Para perda no investimento, use um valor negativo.") + '</div>' +
      choose("status", "Situação", [["confirmed", "Confirmado"], ["planned", "Planejado"]], record?.status || "confirmed", "Planejados não alteram saldos nem limites.") +
      '<div data-fin-group="account">' + accountSelect + '</div>' +
      '<div data-fin-group="card">' + cardSelect + '</div>' +
      '<div data-fin-group="investment">' + investSelect + '</div>' +
      '<div data-fin-group="debt">' + debtSelect + '</div>' +
      '<div data-fin-group="category">' + field("category", "Categoria", record?.category || "", { attrs: 'maxlength="60" placeholder="Ex.: alimentação, transporte"' }) + '</div>' +
      '<div data-fin-group="purchase"><div class="form-grid two">' +
      field("installments", "Número de parcelas", record?.installments || 1, { type: "number", attrs: 'min="1" max="60"' }) +
      field("firstMonth", "Mês da primeira fatura", record?.firstMonth || selectedMonth, { type: "month", attrs: 'min="1900-01" max="9994-12"' }) +
      '</div><p class="fin-form-hint">Confira o mês sugerido com seu banco. O total da compra compromete o limite hoje.</p></div>' +
      '<div data-fin-group="payment">' + field("billMonth", "Mês da fatura que está pagando", record?.billMonth || selectedMonth, { type: "month", attrs: 'min="1900-01" max="9994-12"' }) +
      '<p class="fin-form-hint">O pagamento desconta da conta e diminui o valor comprometido do cartão, sem criar outro gasto.</p></div>';
  }

  function toggleTransactionFields() {
    if (editing?.kind !== "transaction") return;
    const form = $("#financeForm", dialog);
    const type = form.elements.type.value;
    const groups = {
      account: ["income", "expense", "card_payment", "debt_payment", "investment_contribution", "investment_withdrawal"],
      card: ["card_purchase", "card_payment"],
      investment: ["investment_contribution", "investment_withdrawal", "investment_adjustment"],
      debt: ["debt_payment"], category: ["income", "expense", "card_purchase"],
      purchase: ["card_purchase"], payment: ["card_payment"],
    };
    for (const box of dialog.querySelectorAll("[data-fin-group]")) {
      const visible = groups[box.dataset.finGroup].includes(type);
      box.hidden = !visible;
      for (const control of box.querySelectorAll("input,select")) {
        control.disabled = !visible;
        if (control.tagName === "SELECT" || ["firstMonth", "billMonth", "installments"].includes(control.name)) control.required = visible;
      }
    }
    if (type === "card_purchase" && autoInvoice) {
      const card = current().cards.find(c => c.id === form.elements.cardId.value);
      const date = form.elements.date.value;
      if (card && date) {
        try { form.elements.firstMonth.value = firstBillMonth(date, card.closeDay, card.dueDay); }
        catch { /* The form will request a valid date. */ }
      }
    }
  }
  function openForm(kind, record = null, preset = {}) {
    if (!lists[kind]) return;
    editing = { kind, id: record?.id || "" };
    autoInvoice = !record;
    const feminine = ["account", "debt", "goal"].includes(kind);
    const title = (record ? "Editar " : feminine ? "Nova " : "Novo ") + names[kind];
    body.innerHTML = '<form id="financeForm" class="dialog glass"><div class="dialog-head"><div><small>MEU FINANCEIRO</small><h3>' +
      label(title) + '</h3></div><button type="button" data-fin-close aria-label="Fechar">×</button></div>' +
      formFields(kind, record, preset) + '<p class="fin-form-error" id="financeError" role="alert" hidden></p>' +
      '<div class="actions end"><button type="button" class="ghost" data-fin-close>Cancelar</button><button type="submit" class="primary">Salvar</button></div></form>';
    if (!dialog.open) dialog.showModal();
    toggleTransactionFields();
  }
  function readRecord(form, kind, existingId) {
    const data = new FormData(form);
    const get = (key) => String(data.get(key) || "").trim();
    const cash = (name, signed = false) => parseMoney(get(name), { signed });
    const id = existingId || uid("fin");
    const name = get("name");
    if (kind !== "transaction" && kind !== "budget" && !name) throw new Error("Informe um nome.");
    if (kind === "account") return { id, name, openingCents: cash("openingCents", true), openingDate: get("openingDate"), overdraftCents: cash("overdraftCents") };
    if (kind === "card") return { id, name, limitCents: cash("limitCents"), closeDay: Number(get("closeDay")), dueDay: Number(get("dueDay")) };
    if (kind === "investment") return { id, name, category: get("category"), openingCents: cash("openingCents"), openingDate: get("openingDate") };
    if (kind === "asset") return { id, name, category: get("category"), valueCents: cash("valueCents") };
    if (kind === "debt") return { id, name, openingCents: cash("openingCents"), openingDate: get("openingDate"), dueDate: get("dueDate"), notes: get("notes") };
    if (kind === "goal") {
      const targetCents = cash("targetCents");
      if (!targetCents) throw new Error("Informe um valor maior que zero para a meta.");
      return { id, name, targetCents, savedCents: cash("savedCents"), monthlyCents: cash("monthlyCents"), deadline: get("deadline"), notes: get("notes") };
    }
    if (kind === "budget") {
      const limitCents = cash("limitCents");
      if (!limitCents) throw new Error("Informe um limite maior que zero.");
      return { id, month: get("month"), category: get("category"), limitCents };
    }
    const type = get("type");
    if (!get("description")) throw new Error("Informe a descrição.");
    if (get("status") === "confirmed" && get("date") > finToday()) throw new Error("Para data futura, selecione a situação Planejado. Confirme quando a movimentação acontecer.");
    return { id, type, date: get("date"), amountCents: cash("amountCents", type === "investment_adjustment"),
      description: get("description"), status: get("status"), category: get("category"), accountId: get("accountId"),
      cardId: get("cardId"), investmentId: get("investmentId"), debtId: get("debtId"), firstMonth: get("firstMonth"),
      billMonth: get("billMonth"), installments: type === "card_purchase" ? Number(get("installments")) : 1 };
  }
  async function submit(event) {
    event.preventDefault();
    if (!editing) return;
    const form = event.target;
    const error = $("#financeError", dialog);
    error.hidden = true;
    try {
      const { kind, id } = editing;
      const record = readRecord(form, kind, id);
      const candidate = structuredClone(current());
      const entries = candidate[lists[kind]];
      const index = id ? entries.findIndex(e => e.id === id) : -1;
      if (id && index < 0) throw new Error("Este registro não está mais disponível. Atualize a página.");
      if (kind === "budget" && entries.some(e => e.id !== id && e.month === record.month && e.category.toLocaleLowerCase("pt-BR") === record.category.toLocaleLowerCase("pt-BR"))) {
        throw new Error("Já existe um orçamento para essa categoria neste mês. Edite o orçamento existente.");
      }
      if (index >= 0) entries[index] = record; else entries.push(record);
      const valid = normalizeFinance(candidate);
      validateFinance(valid);
      getState().finance = valid;
      dialog.close();
      editing = null;
      const saved = await save();
      toast(saved ? "Registro financeiro salvo." : "Alteração pendente de sincronização.", saved ? "" : "warn");
    } catch (err) {
      error.textContent = err.message || "Confira os campos e tente novamente.";
      error.hidden = false;
      error.scrollIntoView({ block: "nearest" });
    }
  }
  async function remove(kind, id) {
    if (!lists[kind]) return;
    const snapshot = getState();
    const target = current()[lists[kind]].find(x => x.id === id);
    if (!target) return;
    if (!(await confirm("Excluir " + names[kind] + "?", "Esta ação remove este registro. Contas e cartões vinculados a lançamentos não podem ser excluídos."))) return;
    if (getState() !== snapshot) return;
    try {
      const candidate = structuredClone(current());
      candidate[lists[kind]] = candidate[lists[kind]].filter(x => x.id !== id);
      validateFinance(candidate);
      getState().finance = candidate;
      const saved = await save();
      toast(saved ? "Registro excluído." : "Alteração pendente de sincronização.", saved ? "" : "warn");
    } catch (err) {
      toast("Não foi possível excluir: " + err.message, "error");
    }
  }
  function bind() {
    root.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.finSection && sections[button.dataset.finSection]) { section = button.dataset.finSection; render(); }
      if (button.dataset.finAdd) openForm(button.dataset.finAdd, null, button.dataset);
      if (button.dataset.finEdit && lists[button.dataset.finEdit]) {
        const record = current()[lists[button.dataset.finEdit]].find(e => e.id === button.dataset.id);
        if (record) openForm(button.dataset.finEdit, record);
      }
      if (button.dataset.finDelete) void remove(button.dataset.finDelete, button.dataset.id);
    });
    root.addEventListener("change", (event) => {
      if (event.target.id === "financeMonth" && /^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) {
        selectedMonth = event.target.value; render();
      }
    });
    dialog.addEventListener("click", (event) => { if (event.target.closest("[data-fin-close]")) dialog.close(); });
    dialog.addEventListener("submit", submit);
    dialog.addEventListener("change", (event) => {
      if (editing?.kind !== "transaction") return;
      if (event.target.name === "firstMonth") autoInvoice = false;
      toggleTransactionFields();
    });
    dialog.addEventListener("close", () => { editing = null; });
  }
  function reset() {
    section = "overview"; selectedMonth = today().slice(0, 7); editing = null;
    root.replaceChildren();
  }
  return { render, bind, reset };
}
