# LUMINA — Sistema de Mapeamento Pessoal

## Arquivos
- `index.html`
- `styles.css`
- `app.js`
- `manifest.json`
- `sw.js`

## Recursos
- Áreas da vida personalizáveis
- Gráfico radar
- Metas com etapas e progresso
- Hábitos, sequência e mapa de calor
- Personagem animada que evolui por XP
- Missões, moedas internas e níveis
- Diário com fato, interpretação e postura prática
- Energia e humor
- Fotos salvas no navegador
- Modo foco
- Relatórios para salvar em PDF
- Backup e restauração
- Layout responsivo
- PWA e funcionamento offline

## Como abrir
Clique duas vezes em `index.html`.

## Como ativar instalação e offline
Na pasta do projeto, execute:

```bash
python3 -m http.server 8080
```

Depois abra:

```text
http://localhost:8080
```

## Como gerar PDF
Abra a aba Relatórios, escolha o tipo e clique em Gerar relatório. Na nova janela, use “Salvar como PDF / Imprimir”.

## Armazenamento
- Dados textuais: LocalStorage
- Fotografias: IndexedDB
- Nenhum dado é enviado para servidor externo
