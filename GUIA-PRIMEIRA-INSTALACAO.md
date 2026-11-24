# LUMINA · Meu Universo

Abra **COMECE-AQUI.html** com dois cliques. O guia visual acompanha a configuração do Supabase, a atualização do seu projeto da Vercel e a transferência dos dados da versão antiga.

## O que você pode personalizar

- **Áreas da Vida**: crie, edite, reorganize e exclua áreas. Cada área tem nome, símbolo, cor, descrição, importância e notas atual e desejada.
- **Configurações**: escolha Linho rosado, Lavanda ou Noite suave. Edite sua frase inicial, nome, personagem, cor, sons e a exibição do painel de execução.
- **Espírito → Matéria**: registre Sonho, Sensação, Visão e Matéria. Sensação separa o que você sente hoje do que imagina sentir ao realizar. Matéria recebe o próximo gesto concreto. A etapa e a data são opcionais para acompanhamento.
- **Rotina**: metas, etapas, hábitos, missões, diário, evidências, foco e relatórios continuam disponíveis. No celular, as seções adicionais ficam em **Mais**.

## 1. Salve sua cópia antiga

No LUMINA que você já usa, abra **Configurações → Exportar backup** antes de publicar a atualização. Guarde o JSON com seus registros e fotos. Esse arquivo é pessoal. Mantenha-o fora do GitHub e da Vercel.

A versão antiga guardava os dados no navegador e no endereço em que você os criou. Se você atualizar o mesmo domínio na Vercel e usar o mesmo navegador, a versão nova também oferece **Configurações → Trazer dados deste navegador**. Se mudar de endereço ou aparelho, use **Importar backup**. As duas opções pedem confirmação para substituir os registros e fotos da conta atual. Faça a transferência uma vez antes de começar a editar na nuvem.

## 2. Prepare o Supabase

1. Crie um projeto chamado `lumina` ou selecione o projeto que separou para o aplicativo. Mantenha a Data API habilitada.
2. No **SQL Editor**, abra uma consulta nova. Cole todo o conteúdo de `supabase/01-estrutura.sql` e clique em **Run**. O arquivo pode ser executado novamente e preserva os registros existentes.
3. Em **Authentication → Users**, use **Add user → Create new user**. Informe seu e-mail, defina uma senha exclusiva e confirme a conta pelo painel. Se aparecer **Auto confirm user**, pode usá-lo para sua própria conta.
4. Em **Authentication → Sign In / Providers**, mantenha o provedor **Email** habilitado e desligue **Allow new users to sign up**. A tela do LUMINA tem entrada e recuperação de senha. Você cria a conta pelo Supabase.
5. Em **Connect** ou **Project Settings → API Keys**, copie a **Project URL** e a **Publishable key**. A chave pública começa com `sb_publishable_`. A chave pública `anon` legada também funciona.

A senha do banco, a chave `service_role` e a chave `sb_secret_` ficam fora do navegador. O build rejeita uma chave de tipo diferente do esperado.

## 3. Experimente no VS Code

Instale o Node.js 22.12+ da série 22, ou Node.js 24. Abra a pasta `lumina-nuvem` no VS Code. No terminal:

```bash
npm ci
npm run dev
```

Abra a URL **Local** indicada pelo terminal. Sem configuração, aparece a demonstração local, com dados separados da versão antiga. O HTML de instalação pode ser aberto com dois cliques. Para executar o app, use o endereço exibido pelo Vite.

Para testar com sua conta real, copie `.env.example` para `.env.local` na raiz e preencha:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_SUA_CHAVE_PUBLICA
```

Pare o Vite com **Control+C** e rode `npm run dev` novamente. O arquivo `.env.local` fica fora do Git.

## 4. Atualize o mesmo projeto na Vercel

1. Na Vercel, abra o **projeto do LUMINA que já existe**. Em **Environment Variables**, crie as duas variáveis da tabela. Escolha **Production** e **Config** se o painel oferecer a escolha entre Config e Secret.
2. Em **Settings → Build and Deployment**, confira o preset **Vite**, a versão de Node.js compatível e a **Root Directory**. Ela precisa apontar para a pasta com `package.json`. O `vercel.json` define `npm ci`, `npm run build` e a saída `dist`.
3. No repositório já conectado à Vercel, copie **o conteúdo** da pasta `lumina-nuvem` do ZIP para a raiz usada pelo projeto. Preserve a pasta `.git`. O `sw.js` e o `manifest.json` desta versão ficam em `public/`. Se os dois arquivos antigos estiverem na raiz, retire-os da raiz para evitar confusão.
4. Faça commit e push na branch de produção. Se estiver usando o Git no terminal, confira `git status` e os arquivos antes de confirmar:

```bash
git add .
git commit -m "Atualiza LUMINA para a nuvem"
git push
```

5. Em **Deployments**, aguarde o status **Ready**. Se criou ou editou variáveis depois de um deploy, faça **Redeploy** para o build ler os novos valores.

| Key na Vercel | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Project URL inteira, com `https://` e sem `/rest/v1` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key do mesmo projeto |

Se a instalação atual usa a CLI da Vercel, rode `npx vercel link` na pasta atualizada e selecione o projeto existente. Depois de configurar as variáveis de Production pelo painel, rode `npx vercel --prod`. Confira o projeto selecionado antes de publicar.

## 5. Entre e confira em dois navegadores

1. Abra o endereço publicado e faça login com o usuário que criou no Supabase.
2. Em **Configurações**, importe seu backup ou traga os dados do navegador antigo.
3. Crie um registro de teste em **Espírito → Matéria**. Aguarde o indicador **Na nuvem**.
4. Abra o mesmo endereço em outro navegador ou janela privativa, entre com a mesma conta e confira o registro. Você pode usar **Sincronizar agora** em Configurações.
5. Em **Authentication → URL Configuration** no Supabase, coloque a URL final na **Site URL** e adicione a URL exata com `/` nas **Redirect URLs**. Para recuperação local, adicione a URL que o Vite usa, como `http://localhost:5173/`. O envio do link de recuperação depende da configuração de e-mails do projeto Supabase.

## Como seus dados são gravados

Os registros, preferências e a tabela ficam em um documento por conta no Postgres. O SQL aplica políticas que limitam a leitura e a escrita ao dono. As fotos ficam no bucket privado `lumina-private-photos`, em pastas por conta. O backup JSON inclui as fotos para que possa ser restaurado em outro projeto.

O app salva após cada alteração e busca mudanças ao voltar à aba ou periodicamente enquanto estiver aberta. Se duas abas editarem a mesma revisão, o aplicativo oferece as opções **Carregar da nuvem**, **Enviar minha versão** e **Baixar backup**. A edição não confirmada fica pendente na aba. Aguarde **Na nuvem** antes de fechá-la. A entrada e a leitura dos dados na produção precisam de internet. Sessões de foco concluídas sincronizam, e o cronômetro em andamento fica na aba onde foi iniciado.

O service worker guarda apenas arquivos públicos da interface. Na primeira atualização a partir da versão antiga, pode ser preciso recarregar a página para ativar o worker novo. Use a opção **Recarregar** quando aparecer. Evite limpar os dados do site antes de transferir seu backup.

## Se algo não abrir

| O que aparece | O que conferir |
| --- | --- |
| Conecte seu Supabase | URL, tipo de chave, nomes das duas variáveis, ambiente Production e novo deploy |
| E-mail e senha não entram | Se o usuário foi criado e confirmado no Authentication do projeto certo |
| Estrutura do banco | Se o SQL inteiro rodou no projeto usado pelas variáveis |
| Página da versão anterior | Aguarde o deploy Ready e recarregue. Faça o backup no navegador antigo antes de mexer no armazenamento |
| Link de recuperação abre no endereço errado | Site URL, Redirect URLs e o envio de e-mail do Supabase |

## Arquivos e verificação

| Arquivo | Função |
| --- | --- |
| `index.html`, `app.js`, `styles.css` | Telas, interações e visual |
| `src/state.js`, `src/sync.js` | Formato de dados, migração e controle de revisões |
| `src/account.js`, `src/cloud.js`, `src/media.js` | Conta, sincronização e fotos privadas |
| `src/shell.js`, `public/sw.js` | Atualização da interface e cache de arquivos públicos |
| `supabase/01-estrutura.sql` | Tabela, políticas, gravação por revisão e bucket de fotos |
| `tests/` | Banco local, migração, conflitos e cache |

```bash
npm test
npm run build
```

O banco foi validado em Postgres local via PGlite, com duas contas fictícias e acesso anônimo. A demonstração foi conferida no navegador. Você fará o teste final de login e sincronização no seu Supabase e na sua Vercel.

Documentação: [chaves do Supabase](https://supabase.com/docs/guides/api/api-keys), [políticas de acesso do banco](https://supabase.com/docs/guides/database/postgres/row-level-security), [acesso às fotos](https://supabase.com/docs/guides/storage/security/access-control), [URLs de autenticação](https://supabase.com/docs/guides/auth/redirect-urls) e [Vite na Vercel](https://vercel.com/docs/frameworks/frontend/vite).
