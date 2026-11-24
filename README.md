# LUMINA · Atualização Meu financeiro

Esta é a atualização de um projeto LUMINA que **já está conectado** ao Supabase e à Vercel. Abra `COMECE-AQUI.html` no navegador para um passo a passo com detalhes. O guia anterior de primeira instalação está em `GUIA-PRIMEIRA-INSTALACAO.md`; ele se aplica apenas a quem ainda precisa criar toda a infraestrutura.

## Atualizar o LUMINA existente

1. No LUMINA atual, abra **Configurações → Exportar backup** e guarde o arquivo JSON em lugar seguro. Espere o indicador **Na nuvem**. Feche as outras abas do aplicativo até atualizar, inclusive em outros aparelhos.
2. Extraia o ZIP. No VS Code, abra a **pasta existente do projeto**, a que contém `package.json`. Copie para ela **o conteúdo** da pasta extraída e aceite substituir os arquivos de mesmo nome. Copie as subpastas `src`, `public`, `supabase` e `tests` junto com os arquivos da raiz. Confira se `src/finance-core.js` e `src/finance-ui.js` chegaram na pasta correta.
3. Preserve a pasta `.git` e o arquivo `.env.local` que já existem no seu projeto. O ZIP não contém sua senha nem seu `.env.local`. O projeto continua usando as mesmas variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Não suba backups, senhas ou `.env.local` para o GitHub.
4. No terminal do projeto, rode `npm run build`. Se os pacotes ainda não estiverem instalados, rode `npm ci` antes. Para testar localmente use `npm run dev`; pare e reinicie o servidor quando mudar o `.env.local`.
5. Confira com `git status` se são as alterações esperadas. Envie os arquivos à mesma branch que publica o projeto na Vercel, conforme seu fluxo de GitHub. Por exemplo, se ela for a sua branch atual:

```bash
git add .
git commit -m "Adiciona controle financeiro"
git push
```

6. Na Vercel, abra o **projeto do LUMINA**, entre em **Deployments** e aguarde o novo deploy ficar **Ready**. Se a conta não usar GitHub para publicar, atualize pelo mesmo método que você usou antes; por exemplo, o comando `npx vercel --prod` depois de vincular a pasta ao projeto certo. Após editar variáveis da Vercel, gere um novo deploy para o build recebê-las.
7. Abra o endereço publicado, recarregue, entre com a **mesma conta** e confira as áreas, metas e registros antigos. Acesse **Meu financeiro** no menu lateral ou, no celular, **Mais → Meu financeiro**. Crie um lançamento simples, aguarde **Na nuvem** e confira em outro navegador com a mesma conta.

Se o Supabase e as variáveis já são os usados pelo aplicativo anexado, **não é necessário criar projeto, criar usuário, executar outro SQL nem refazer as variáveis**. Esta versão guarda o novo módulo no documento individual que já existe. Caso apareça uma tela pedindo a conexão, confira as duas variáveis acima em **Environment Variables**, no ambiente **Production**, e faça novo deploy depois de corrigir.

## Como os cálculos funcionam

- Cadastre primeiro cada **conta** com seu saldo e a data desse saldo; depois, seus **cartões** com limite e dias de fechamento e vencimento. Cadastre também investimentos e dívidas com seus saldos reais na data informada. Não cadastre novamente uma dívida que já esteja dentro de uma fatura.
- Uma compra confirmada no cartão reserva **o valor total**, inclusive parcelas futuras, no limite e no indicador **Disponível após cartões** no dia da compra. O saldo real da conta só muda quando você registra o pagamento. Ao pagar, escolha a conta e o mês da fatura; a mesma compra não vira outro gasto. A primeira fatura é sugerida pelo fechamento, mas deve ser conferida e pode ser alterada. Juros, taxas, estornos e diferenças devem ser conferidos e ajustados manualmente; não há integração com a fatura do banco.
- **Gastos do mês** somam saídas diretas e parcelas com vencimento naquele mês. **Saídas das contas** incluem despesas diretas, pagamento de cartões e dívidas e aplicações no mês. Aplicações e resgates também mudam o valor do investimento. Valores marcados **Planejado** não alteram saldo ou limite até serem editados para **Confirmado** na data em que ocorrerem.
- O gráfico de pizza mostra a composição positiva de contas, investimentos e bens. O patrimônio líquido é contas + investimentos + bens − cartões em aberto − dívidas; contas negativas e dívidas aparecem separadas. Use valores atualizados. Não há cotação ou integração bancária automática.
- Metas financeiras têm valor alvo, valor já guardado, valor mensal e prazo opcional. O tempo é uma estimativa simples com base no valor mensal, iniciada no mês atual, sem juros. O saldo da meta é preenchido e atualizado manualmente; a meta não movimenta a conta e não é um bem adicional.
- Para alerta por categoria, use exatamente o mesmo nome no lançamento e no orçamento do mês. Cheque especial pertence às contas e aparece como limite; ele não é somado como saldo disponível.

## Backups, privacidade e versões

As finanças usam o mesmo login, armazenamento e políticas de acesso por usuário do projeto LUMINA. Dados financeiros são manuais: o programa **não se conecta ao banco**, não paga contas e não movimenta dinheiro real. Consulte os extratos e as faturas para conferir os registros.

A versão do documento passa para 3, e versões anteriores do LUMINA não entendem esse formato. Feche e recarregue todas as abas depois do deploy; não use uma aba antiga para resolver conflitos com **Enviar minha versão**, pois ela pode substituir dados mais recentes. Ao importar um backup, ele **substitui o conteúdo atual inteiro**, inclusive as finanças: não importe um backup anterior depois de cadastrar valores sem antes exportar o estado atual e entender a substituição. Nunca coloque o JSON do backup no GitHub.

Se duas abas editarem ao mesmo tempo, o indicador pode pedir revisão de versões. **Carregar da nuvem** ou **Enviar minha versão** substitui uma das versões; faça um backup antes de escolher. Aguarde **Na nuvem** depois de editar. O modo de demonstração salva dados apenas no navegador e não os envia para sua conta.

## Testes

Rode `npm test` para verificar cálculos financeiros, migração de backups, proteção por usuário no banco simulado e sincronização. Rode `npm run build` para compilar. O pacote não inclui credenciais nem se conecta à sua produção durante esses testes.
