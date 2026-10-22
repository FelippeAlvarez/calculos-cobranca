# Cálculos de Cobrança

Planilhas de cálculo para cobrança judicial e extrajudicial (PDF e Excel), com memória de cálculo nos termos do art. 524 do CPC.

- **Rubricas** com valor, termo inicial de correção e de juros e critérios próprios por período (ex.: até 29/08/2024 UFIR-RJ e 1% a.m.; depois IPCA e taxa legal, Lei 14.905/2024).
- **Índices**: UFIR-RJ (SEFAZ-RJ), IPCA, IGP-M, INPC, IPCA-E; **juros**: percentual ao mês, taxa legal (art. 406 do CC, Res. CMN 5.171/2024), SELIC (correção e juros), simples ou capitalizados.
- **Custas**, **honorários sucumbenciais** (sobre a condenação, sobre o valor da causa ou fixos), **multas processuais** (fixas, % da causa ou astreintes), **multa e honorários do art. 523, § 1º**, honorários contratuais (extrajudicial).
- **Amortizações** com imputação em juros primeiro (art. 354 do CC) ou no principal, e escolha dos itens abatidos.

## Uso

Abrir `app/index.html` (ou o endereço publicado) e escolher onde ficam os dados: pasta no Dropbox (pela internet), pasta do computador (Chrome/Edge) ou teste local.

## Desenvolvimento

- Servidor de teste: `_desenvolvimento/servidor-teste.ps1` (porta 8769, serve a pasta do projeto: `/app/` e `/_desenvolvimento/testes.html`).
- `_desenvolvimento/testes.html`: conferências do motor de cálculo contra contas feitas à mão.
- Ao alterar a lista de arquivos do app, mudar o nome do cache em `app/sw.js`.
