import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyFinance, normalizeFinance, validateFinance, parseMoney, splitCents, firstBillMonth,
  accountBalances, cardBalances, investmentBalances, debtBalances, monthStats, budgetUsage,
  overview, goalProgress, billAmounts,
} from '../src/finance-core.js';
import { initialState, normalizeState, parseBackup } from '../src/state.js';

function fixture() {
  const f = emptyFinance();
  f.accounts.push({ id:'a', name:'Conta', openingCents:100000, openingDate:'2026-01-01', overdraftCents:30000 });
  f.cards.push({ id:'c', name:'Cartão', limitCents:50000, closeDay:20, dueDay:10 });
  f.investments.push({ id:'i', name:'Poupança', category:'Renda fixa', openingCents:20000, openingDate:'2026-01-01' });
  f.debts.push({ id:'d', name:'Empréstimo', openingCents:30000, openingDate:'2026-01-01', dueDate:'', notes:'' });
  f.transactions.push({ id:'p', type:'card_purchase', date:'2026-01-15', amountCents:12000, description:'Mercado', category:'Alimentação', status:'confirmed', accountId:'', cardId:'c', investmentId:'', debtId:'', billMonth:'', firstMonth:'2026-02', installments:3 });
  return normalizeFinance(f);
}
const tx = (overrides) => ({ id:'t', type:'expense', date:'2026-01-20', amountCents:1000, description:'Teste', category:'Alimentação', status:'confirmed', accountId:'a', cardId:'', investmentId:'', debtId:'', billMonth:'', firstMonth:'', installments:1, ...overrides });

test('formato brasileiro de moeda e divisão de parcelas preservam os centavos', () => {
  assert.equal(parseMoney('1.234,56'), 123456);
  assert.equal(parseMoney('1.234'), 123400);
  assert.equal(parseMoney('125.50'), 12550);
  assert.equal(parseMoney('-15,99', { signed:true }), -1599);
  assert.throws(() => parseMoney('15,999'));
  assert.deepEqual(splitCents(10000,3), [3334,3333,3333]);
  assert.equal(firstBillMonth('2026-01-20',20,10),'2026-02');
  assert.equal(firstBillMonth('2026-01-21',20,10),'2026-03');
});

test('compra compromete saldo e limite integralmente; pagar fatura não conta duas vezes', () => {
  const f = fixture();
  assert.equal(validateFinance(f), true);
  let o = overview(f, '2026-01-31');
  assert.equal(o.cash, 100000);
  assert.equal(o.cardOwed, 12000);
  assert.equal(o.available, 88000);
  assert.equal(cardBalances(f,'2026-01-31')[0].available, 38000);
  assert.equal(monthStats(f,'2026-02').spending, 4000);
  assert.equal(monthStats(f,'2026-03').spending, 4000);
  f.transactions.push(tx({id:'pag', type:'card_payment', date:'2026-02-02', amountCents:4000, cardId:'c', billMonth:'2026-02'}));
  assert.equal(validateFinance(f), true);
  o = overview(f, '2026-02-03');
  assert.equal(o.cash, 96000);
  assert.equal(o.cardOwed, 8000);
  assert.equal(o.available, 88000);
  assert.equal(monthStats(f,'2026-02').spending, 4000);
  assert.equal(monthStats(f,'2026-02').cashOut, 4000);
  assert.equal(billAmounts(f).find(b=>b.month==='2026-02').remaining, 0);
});

test('impede pagar fatura antes da compra ou acima dos valores registrados', () => {
  const before = fixture();
  before.transactions.push(tx({id:'pag', type:'card_payment', date:'2026-01-10', amountCents:1000, cardId:'c', billMonth:'2026-02'}));
  assert.throws(() => validateFinance(before), /anterior às compras/);
  const over = fixture();
  over.transactions.push(tx({id:'pag', type:'card_payment', date:'2026-01-20', amountCents:4001, cardId:'c', billMonth:'2026-02'}));
  assert.throws(() => validateFinance(over), /maior que/);
});

test('transferências, dívidas, orçamento e planejamentos têm efeitos distintos', () => {
  const f=fixture();
  f.transactions.push(tx({id:'inv', type:'investment_contribution', amountCents:5000, investmentId:'i'}));
  f.transactions.push(tx({id:'debt', type:'debt_payment', amountCents:7000, debtId:'d'}));
  f.transactions.push(tx({id:'out', type:'expense', amountCents:3000}));
  f.transactions.push(tx({id:'planned', type:'expense', amountCents:90000, status:'planned'}));
  validateFinance(f);
  assert.equal(accountBalances(f,'2026-01-31')[0].balance,85000);
  assert.equal(investmentBalances(f,'2026-01-31')[0].balance,25000);
  assert.equal(debtBalances(f,'2026-01-31')[0].remaining,23000);
  assert.equal(monthStats(f,'2026-01').cashOut,15000);
  assert.equal(monthStats(f,'2026-01').spending,3000);
  assert.equal(monthStats(f,'2026-01').planned,1);
  assert.equal(budgetUsage(f,{month:'2026-02',category:'alimentação'}),4000);
  assert.equal(overview(f,'2026-01-31').netWorth,75000);
});

test('metas, versão anterior e backup da versão financeira', () => {
  const progress=goalProgress({targetCents:120000,savedCents:20000,monthlyCents:10000},'2026-01');
  assert.equal(progress.remaining,100000);
  assert.equal(progress.months,10);
  assert.equal(progress.estimatedMonth,'2026-10');
  assert.equal(goalProgress({targetCents:100000000000,savedCents:0,monthlyCents:1},'2026-01').estimatedMonth,null);
  const previous=initialState(); previous.version=2; delete previous.finance; previous.profile.name='Ludzinha';
  const migrated=normalizeState(previous);
  assert.equal(migrated.version,3);
  assert.equal(migrated.profile.name,'Ludzinha');
  assert.deepEqual(migrated.finance,emptyFinance());
  migrated.finance=fixture();
  assert.deepEqual(parseBackup({state:migrated,photos:[]}).state.finance,migrated.finance);
  assert.throws(()=>normalizeState({...migrated,version:4}),/incompatível/);
});

test('as seções financeiras exibem dados e escapam nomes inseridos', async () => {
  const { createFinance } = await import('../src/finance-ui.js');
  const f=fixture(); f.accounts[0].name='<img src=x onerror=alert(1)>';
  const handlers = {};
  const root = { innerHTML:'', addEventListener:(name,cb)=>{handlers[name]=cb}, replaceChildren(){} };
  const body = { innerHTML:'' };
  const dialog = { open:false, addEventListener(){}, showModal(){this.open=true}, querySelectorAll(){return []} };
  const view = { classList:{contains:()=>true} };
  const previousDocument=globalThis.document;
  globalThis.document={querySelector:(s)=>({'#financeContent':root,'#financeDialog':dialog,'#financeDialogBody':body,'#financeView':view})[s]};
  try {
    const controller=createFinance({getState:()=>({finance:f}),save:async()=>true,toast(){},confirm:async()=>true,uid:()=> 'new'});
    controller.bind(); controller.render();
    assert.match(root.innerHTML,/Meu financeiro/);
    handlers.click({target:{closest:()=>({dataset:{finSection:'accounts'}})}});
    assert.match(root.innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(root.innerHTML,/<img src=x/);
    for (const section of ['transactions','investments','debts','goals','overview']) {
      handlers.click({target:{closest:()=>({dataset:{finSection:section}})}});
      assert.ok(root.innerHTML.length > 200,section);
    }
    handlers.click({target:{closest:()=>({dataset:{finAdd:'goal'}})}});
    assert.match(body.innerHTML,/Valor da meta/);
    assert.equal(dialog.open,true);
  } finally {globalThis.document=previousDocument;}
});

test('o cadastro salva uma conta e rejeita um lançamento confirmado com data futura', async () => {
  const {createFinance}=await import('../src/finance-ui.js');
  const state={finance:emptyFinance()}, rootHandlers={}, dialogHandlers={};
  const root={innerHTML:'',addEventListener:(name,fn)=>rootHandlers[name]=fn,replaceChildren(){}};
  const body={innerHTML:''};
  const error={hidden:true,textContent:'',scrollIntoView(){}};
  const form={values:{},elements:{type:{value:'expense'},cardId:{value:''},date:{value:''}}};
  const dialog={open:false,showModal(){this.open=true},close(){this.open=false},addEventListener:(name,fn)=>dialogHandlers[name]=fn,
    querySelector:(s)=>s==='#financeForm'?form:s==='#financeError'?error:null,querySelectorAll:()=>[]};
  const originalDocument=globalThis.document, OriginalFormData=globalThis.FormData;
  globalThis.document={querySelector:(s)=>({'#financeContent':root,'#financeDialog':dialog,'#financeDialogBody':body,'#financeView':{classList:{contains:()=>true}}})[s]};
  globalThis.FormData=class {constructor(target){this.data=target.values}get(k){return this.data[k] ?? null}};
  try {
    let saved=0;
    const ui=createFinance({getState:()=>state,save:async()=>{saved++;return true},toast(){},confirm:async()=>true,uid:()=> 'new_id'});
    ui.bind();
    rootHandlers.click({target:{closest:()=>({dataset:{finAdd:'account'}})}});
    form.values={name:'Conta teste',openingCents:'1.000,00',openingDate:'2026-01-01',overdraftCents:'100,00'};
    await dialogHandlers.submit({preventDefault(){},target:form});
    assert.equal(saved,1); assert.equal(state.finance.accounts[0].openingCents,100000);
    rootHandlers.click({target:{closest:()=>({dataset:{finAdd:'transaction'}})}});
    form.values={type:'expense',description:'Compra futura',date:'9994-01-01',amountCents:'10,00',status:'confirmed',accountId:'new_id'};
    await dialogHandlers.submit({preventDefault(){},target:form});
    assert.equal(saved,1); assert.equal(error.hidden,false); assert.match(error.textContent,/Planejado/);
  } finally {globalThis.document=originalDocument; globalThis.FormData=OriginalFormData;}
});
