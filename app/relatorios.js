'use strict';
/* Planilhas de cálculo em PDF e Excel (memória de cálculo nos termos do art. 524 do CPC) */

// Credores do cálculo: o principal (credorId, de onde vêm os critérios sugeridos) e os demais
const credoresDoCalculo = c => [...new Set([c.credorId, ...(c.outrosCredores || [])].filter(Boolean))];
const nomeCredor = c => credoresDoCalculo(c).map(id => D.credores[id]?.nome).filter(Boolean).join('; ') || '—';
const nomeCredorCurto = c => { const l = credoresDoCalculo(c); return (D.credores[l[0]]?.nome || '—') + (l.length > 1 ? ' e outros' : ''); };
const credoresTexto = c => credoresDoCalculo(c).map(id => D.credores[id]).filter(Boolean)
  .map(cr => cr.nome + (cr.documento ? ` (${rotuloDoc(cr.documento)} ${fmtDoc(cr.documento)})` : '')).join('; ') || '—';
const devedoresTexto = c => (c.devedores || []).filter(d => d.nome).map(d => d.nome + (d.documento ? ` (${rotuloDoc(d.documento)} ${fmtDoc(d.documento)})` : '')).join('; ') || '—';
const devedoresCurto = c => (c.devedores || []).filter(d => d.nome).map(d => d.nome).join('; ') || '—';
const descProcesso = c => c.tipo === 'judicial'
  ? 'Cobrança judicial' + (c.processo ? ' - Processo nº ' + c.processo : '') + (c.juizo ? ' - ' + c.juizo : '')
  : 'Cobrança extrajudicial';

function linhasInfo(c) {
  const l = [
    `Credor${credoresDoCalculo(c).length > 1 ? 'es' : ''}: ${credoresTexto(c)}`,
    `Devedor${(c.devedores || []).filter(d => d.nome).length > 1 ? 'es' : ''}: ${devedoresTexto(c)}`,
    descProcesso(c),
  ];
  if (c.titulo) l.splice(2, 0, 'Objeto: ' + c.titulo);
  if (c.tipo === 'judicial' && c.valorCausa?.valor) l.push(`Valor da causa: ${fmtMoeda(c.valorCausa.valor)}${c.valorCausa.data ? ' (ajuizamento em ' + fmtData(c.valorCausa.data) + ')' : ''}`);
  return l;
}

// Resumo (rótulo, valor, estilo) usado no PDF e na tela
function itensResumo(r) {
  const itens = r.grupos.map(g => [g.nome, g.total]);
  if (r.pctContr && r.honContr) itens.push(['Honorários advocatícios contratuais (' + fmtPct(r.pctContr) + '%)', r.honContr]);
  if (itens.length) itens.push(['Total devido', r.total, 'f']);
  return itens;
}

const taxaTxt = it => it.taxaJuros ? fmtPct(Math.round(it.taxaJuros * 1e6) / 1e4) + '%' : '—';
const descTitulo = c => c.tipo === 'judicial' ? 'Demonstrativo de débito' : 'Planilha de débito';
function textoArt523(r) {
  if (!r.r523) return '';
  const a = r.c.art523 || {};
  const base = ['verbas da condenação', a.baseHonorarios && 'honorários sucumbenciais', a.baseCustas && 'custas e despesas', a.baseMultas && 'multas processuais'].filter(Boolean);
  const lista = base.length > 1 ? base.slice(0, -1).join(', ') + ' e ' + base[base.length - 1] : base[0];
  const q = r.r523;
  const oque = [q.multaPct && `multa de ${fmtPct(q.multaPct)}%`, q.honPct && `honorários de ${fmtPct(q.honPct)}%`].filter(Boolean).join(' e ');
  const prazo = (r.c.amortizacoes || []).some(x => x.noPrazo);
  return `Art. 523, § 1º, do CPC: ${oque} sobre o débito atualizado até a data do cálculo (base: ${lista}; ${fmtMoeda(q.baseFinal)})`
    + (prazo ? ', descontados os pagamentos feitos no prazo (§ 2º).' : '. Os pagamentos posteriores ao prazo não reduzem a base.');
}

// Linhas abatidas de um pagamento; as prestações de cada série mensal saem somadas numa linha
function linhasImputadas(a, c) {
  const out = [];
  for (const l of a.imputado) {
    if (!l.serie) { out.push(l); continue; }
    let g = out.find(x => x.grupoSerie === l.serie);
    if (!g) { g = { grupoSerie: l.serie, nome: (c?.series || []).find(s => s.id === l.serie)?.descricao || 'Prestações', n: 0, juros: 0, multa: 0, principal: 0 }; out.push(g); }
    g.n++; g.juros += l.juros; g.multa += l.multa; g.principal += l.principal;
  }
  out.forEach(g => { if (g.grupoSerie) g.rotulo = `${g.nome} (${g.n} ${g.n > 1 ? 'prestações' : 'prestação'})`; });
  return out;
}

const textoImputado = (a, c) => linhasImputadas(a, c).map(l => `${l.rotulo}: ${[l.juros > 0.004 ? 'juros ' + fmtNum(l.juros) : '', l.multa > 0.004 ? 'multa ' + fmtNum(l.multa) : '', l.principal > 0.004 ? 'principal ' + fmtNum(l.principal) : ''].filter(Boolean).join(', ')}`).join('; ')
  + (a.sobra ? `; excedente ${fmtNum(a.sobra)}` : '');
const descImputacao = a => (a.a.imputacao === 'principal' ? 'principal primeiro' : 'juros primeiro (art. 354 do CC)');

/* ================= PDF ================= */
function blocoInfoPDF(P, titulo, linhas) {
  const { doc } = P;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const partes = linhas.flatMap(l => doc.splitTextToSize(l, P.larg - 8));
  const h = 8 + partes.length * 3.9 + 2;
  P.espaco(h + 30);
  doc.setFillColor(...COR_FUNDO); doc.rect(P.M, P.y, P.larg, h, 'F');
  doc.setFillColor(...COR_PRI); doc.rect(P.M, P.y, 1.2, h, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...COR_PRI);
  doc.text(titulo, P.M + 4, P.y + 5.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...COR_TEXTO);
  partes.forEach((l, i) => doc.text(l, P.M + 4, P.y + 10 + i * 3.9));
  P.y += h + 4;
}

// Soma de uma lista de itens (subtotais por mês ou por série)
const somaItens = (l, k) => l.reduce((s, it) => s + cent(it[k]), 0) / 100;

function gerarPDFCalculo(c, dataCalc, nome, opcoes = {}) {
  const r = calcular(c, dataCalc);
  const P = novoDocumento(true);
  P.cab();
  tituloPDF(P, descTitulo(c), c.tipo === 'judicial' ? [['Memória de cálculo (art. 524 do CPC). Valores atualizados até ' + fmtData(dataCalc) + '.', 9, 'normal', COR_SUAVE]]
    : [['Valores atualizados até ' + fmtData(dataCalc) + '.', 9, 'normal', COR_SUAVE]]);
  blocoInfoPDF(P, nomeCredorCurto(c) + ' x ' + devedoresCurto(c), linhasInfo(c));
  const pg = r.temPagamento;
  let n = 0;
  for (const g of r.grupos) {
    subtituloPDF(P, g.nome);
    const notas = [];
    tabelaPDF(P, [
      { t: 'Item', w: 46 }, { t: 'Valor originário', w: 20, a: 'r' }, { t: 'Correção desde', w: 17, nw: true }, { t: 'Fator de correção', w: 17, a: 'r' },
      { t: pg ? 'Principal corrigido (saldo)' : 'Valor corrigido', w: 21, a: 'r' }, { t: 'Juros desde', w: 17, nw: true }, { t: 'Juros acumulados', w: 15, a: 'r' },
      { t: 'Juros', w: 19, a: 'r' }, { t: 'Multa', w: 17, a: 'r' }, ...(pg ? [{ t: 'Pago (nominal)', w: 19, a: 'r' }] : []), { t: 'Total', w: 21, a: 'r' },
    ], [
      // Verbas: as prestações mensais saem por mês ou por rubrica, com subtotais; a nota de cada série sai uma vez só
      ...(g.grupo === 'rubrica' ? linhasVerbasOrdenadas(g.itens, c, opcoes.ordem) : g.itens.map(it => ({ it }))).map(({ it, subtotal, itens }) => {
        if (subtotal) return { c: [subtotal, fmtNum(somaItens(itens, 'original')), '', '', fmtNum(somaItens(itens, 'principal')), '', '', fmtNum(somaItens(itens, 'juros')), fmtNum(somaItens(itens, 'multa')), ...(pg ? [''] : []), fmtNum(somaItens(itens, 'total'))], italico: true };
        const u = it.parcelas[0];
        let rot = it.rotulo;
        if (!it.serie) {
          rot = `(${++n}) ${it.rotulo}`;
          notas.push(`${rot}: ${descItem(it)}${c.rubricas.find(x => x.id === it.itemId)?.obs ? ' ' + c.rubricas.find(x => x.id === it.itemId).obs : ''}`);
        }
        return { c: [rot, fmtNum(it.original), u.sombra ? 'da base' : fmtData(u.corrDesde) || '—', it.fator ? fmtFator(it.fator) : '—', fmtNum(it.principal),
          u.sombra ? 'da base' : fmtData(u.jurosDesde) || '—', taxaTxt(it), fmtNum(it.juros), fmtNum(it.multa), ...(pg ? [it.pago ? fmtNum(it.pago) : ''] : []), fmtNum(it.total)] };
      }),
      { c: ['Subtotal', fmtNum(g.original), '', '', fmtNum(g.principal), '', '', fmtNum(g.juros), fmtNum(g.multa), ...(pg ? [''] : []), fmtNum(g.total)], total: true },
    ], 8);
    if (g.grupo === 'rubrica') (c.series || []).filter(s => g.itens.some(it => it.serie === s.id)).forEach(s => notas.push(descSerie(s)));
    notas.forEach(t => { paragrafoPDF(P, t, 7.5, 'normal', COR_SUAVE); P.y += 0.6; });
    if (g.grupo === 'art523') paragrafoPDF(P, textoArt523(r), 7.5, 'normal', COR_SUAVE);
    P.y += 3;
  }
  if (r.amort.length) {
    subtituloPDF(P, 'Amortizações (pagamentos parciais)');
    tabelaPDF(P, [{ t: 'Data', w: 16, nw: true }, { t: 'Valor pago', w: 18, a: 'r' }, { t: 'Débito atualizado na data', w: 22, a: 'r' },
      { t: 'Imputação', w: 26 }, { t: 'Valores abatidos (atualizados na data)', w: 110 }, { t: 'Saldo após o pagamento', w: 22, a: 'r' }],
    r.amort.map(a => ({ c: [fmtData(a.data) + (a.a.descricao ? ' - ' + a.a.descricao : ''), fmtNum(a.valor), fmtNum(a.antes), descImputacao(a), textoImputado(a, c), fmtNum(a.depois)] })), 7.5);
    paragrafoPDF(P, 'Em cada pagamento, o débito foi atualizado até a data do pagamento e o valor foi abatido conforme a imputação indicada; o saldo remanescente segue atualizado pelos mesmos critérios até a data do cálculo.', 7.5, 'normal', COR_SUAVE);
    P.y += 3;
  }
  subtituloPDF(P, 'Resumo');
  resumoPDF(P, itensResumo(r), 150);
  [NOTA_METODO, ...notasCalculo(r)].forEach(t => { paragrafoPDF(P, t, 7.5, 'normal', COR_SUAVE); P.y += 1; });
  rodapePDF(P);
  return { doc: P.doc, nome: nome + '.pdf' };
}

/* ================= Excel ================= */
// Itens sem pagamentos, sem capitalização e com uma só parcela: fórmulas completas; os demais saem com os valores
const itemComFormula = it => !it.pago && it.parcelas.length === 1 && !it.parcelas[0].sombra && !it.parcelas[0].regimes.some(g => g.capitalizar);

function gerarXLSXCalculo(c, dataCalc, opcoes = {}) {
  const r = calcular(c, dataCalc);
  const LARG = [44, 15, 13, 13, 16, 13, 12, 14, 13, 14, 16], cab = cabecalhoXLSX(LARG);
  const mesclar = [];
  const L = [...cab.linhas, [{ v: descTitulo(c), s: 'tit' }], ...linhasInfo(c).map(t => [t]), [{ v: 'Data do cálculo', s: 'b' }, { v: dataCalc, s: 'd' }], null];
  const vz = { v: '', s: 'bt' };
  const subtotais = [];
  for (const g of r.grupos) {
    L.push([{ v: g.nome, s: 'b' }]);
    L.push({ c: ['Item', 'Valor originário', 'Correção desde', 'Fator de correção', r.temPagamento ? 'Principal corrigido (saldo)' : 'Valor corrigido', 'Juros desde', 'Juros acumulados',
      'Juros', 'Multa', 'Pago (nominal)', 'Total'].map(v => ({ v, s: 'cab' })), altura: 30 });
    const ini = L.length + 1;
    // Subtotais internos (por mês ou por série) usam SUBTOTAL, que o subtotal do grupo ignora
    let bloco = L.length + 1;
    for (const { it, subtotal, inicio } of (g.grupo === 'rubrica' ? linhasVerbasOrdenadas(g.itens, c, opcoes.ordem) : g.itens.map(it => ({ it })))) {
      if (subtotal) {
        const a = bloco, b = L.length, st = col => ({ f: `SUBTOTAL(9,${col}${a}:${col}${b})`, s: 'mt' });
        L.push([{ v: subtotal, s: 'bt' }, st('B'), vz, vz, st('E'), vz, vz, st('H'), st('I'), vz, st('K')]);
        continue;
      }
      if (inicio) bloco = L.length + 1;
      const u = it.parcelas[0], n = L.length + 1, f = itemComFormula(it);
      const pct = Number(u.multaPct) || 0;
      L.push([it.rotulo, { v: it.original, s: 'm' }, { v: u.sombra ? '' : u.corrDesde || '', s: 'd' }, { v: it.fator ?? '', s: 'f' },
        f ? { f: `ROUND(B${n}*D${n},2)`, v: it.principal, s: 'm' } : { v: it.principal, s: 'm' },
        { v: u.sombra ? '' : u.jurosDesde || '', s: 'd' }, { v: it.taxaJuros || 0, s: 'p' },
        f ? { f: `ROUND(B${n}*D${n}*G${n},2)`, v: it.juros, s: 'm' } : { v: it.juros, s: 'm' },
        f && pct ? { f: `ROUND(B${n}*D${n}*${pct / 100},2)`, v: it.multa, s: 'm' } : { v: it.multa, s: 'm' },
        { v: it.pago || '', s: 'm' }, { f: `E${n}+H${n}+I${n}`, v: it.total, s: 'm' }]);
    }
    const fim = L.length, soma = (col, v) => ({ f: `SUBTOTAL(9,${col}${ini}:${col}${fim})`, v, s: 'mt' });
    L.push([{ v: 'Subtotal', s: 'bt' }, soma('B', g.original), vz, vz, soma('E', g.principal), vz, vz, soma('H', g.juros), soma('I', g.multa), vz, soma('K', g.total)]);
    subtotais.push({ nome: g.nome, ref: 'K' + L.length, v: g.total });
    if (g.grupo === 'art523') { L.push({ c: [{ v: textoArt523(r), s: 'tq' }], altura: 28 }); mesclar.push(`A${L.length}:K${L.length}`); }
    L.push(null);
  }
  if (r.amort.length) {
    L.push([{ v: 'Amortizações (pagamentos parciais)', s: 'b' }]);
    L.push({ c: ['Data', 'Valor pago', 'Débito na data', 'Imputação', 'Valores abatidos (atualizados na data)', null, null, null, null, null, 'Saldo após'].map(v => v === null ? { v: '', s: 'cab' } : { v, s: 'cab' }), altura: 30 });
    mesclar.push(`E${L.length}:J${L.length}`);
    for (const a of r.amort) {
      L.push({ c: [{ v: a.data, s: 'd' }, { v: a.valor, s: 'm' }, { v: a.antes, s: 'm' }, descImputacao(a), { v: textoImputado(a, c), s: 'tq' }, null, null, null, null, null, { v: a.depois, s: 'm' }], altura: Math.max(15, Math.ceil(textoImputado(a, c).length / 90) * 13) });
      mesclar.push(`E${L.length}:J${L.length}`);
    }
    L.push(null);
  }
  L.push([{ v: 'Resumo', s: 'b' }]);
  const linhaRes = (rotulo, cel, total) => { L.push([{ v: rotulo, s: total ? 'bt' : 'b' }, ...Array(9).fill(total ? vz : null), { ...cel, s: total ? 'mt' : 'm' }]); return 'K' + L.length; };
  const refs = subtotais.map(s => linhaRes(s.nome, { f: s.ref, v: s.v }));
  if (r.pctContr && r.honContr) refs.push(linhaRes(`Honorários advocatícios contratuais (${fmtPct(r.pctContr)}%)`, { f: `ROUND((${refs.join('+')})*${r.pctContr / 100},2)`, v: r.honContr }));
  if (refs.length) linhaRes('Total devido', { f: refs.join('+'), v: r.total }, true);
  L.push(null);
  [...notasItens(r), NOTA_METODO, ...notasCalculo(r),
    'Nos itens sem pagamentos e sem capitalização, os valores são calculados por fórmulas a partir do valor originário, do fator de correção e dos juros acumulados. Nos demais (com amortizações, capitalização ou honorários sobre a condenação), os valores vêm do cálculo do programa.']
    .forEach(t => { L.push({ c: [{ v: t, s: 'tq' }], altura: Math.ceil(t.length / 170) * 13 + 2 }); mesclar.push(`A${L.length}:K${L.length}`); });
  return gerarXLSX([{ nome: 'Cálculo', linhas: L, larguras: LARG, imagem: cab.imagem, mesclar }]);
}

const notasItens = r => [...r.itens.filter(it => !it.serie).map(it => `${it.rotulo}: ${descItem(it)}`),
  ...(r.c.series || []).filter(s => r.itens.some(it => it.serie === s.id)).map(descSerie)];

// Logotipo no canto esquerdo das planilhas: tamanho em pixels e coluna onde começa o texto do cabeçalho
function logoXLSX(larguras) {
  const a = D.config.escritorio || {};
  if (!a.logo || !a.logoL || !a.logoA) return null;
  let h = 64, w = Math.round(h * a.logoL / a.logoA);
  if (w > 190) { w = 190; h = Math.round(w * a.logoA / a.logoL); }
  let col = 0, x = 0;
  while (x < w + 12 && col < larguras.length) x += Math.round((larguras[col++] || 9) * 7 + 5);
  return { imagem: { dados: a.logo, w, h }, col, linhas: Math.ceil((h + 8) / 17) };
}

// Dados do escritório no topo das planilhas (à direita do logotipo, se houver)
function cabecalhoXLSX(larguras = []) {
  const a = D.config.escritorio || {};
  const logo = logoXLSX(larguras);
  const textos = a.nome ? [{ v: a.nome, s: 'b' }, ...[[a.documento, a.oab].filter(Boolean).join('  ·  '), a.endereco, [a.telefone, a.email, a.site].filter(Boolean).join('  ·  ')].filter(Boolean)] : [];
  if (!textos.length && !logo) return { linhas: [], imagem: null };
  const pre = Array(logo ? logo.col : 0).fill(null);
  const linhas = textos.map(t => [...pre, t]);
  while (logo && linhas.length < logo.linhas) linhas.push([]);
  linhas.push(null);
  return { linhas, imagem: logo?.imagem || null };
}

async function exportarCalculo(formato, c, dataCalc, opcoes = {}) {
  const nome = nomeArquivo('Calculo', nomeCredorCurto(c).slice(0, 30), devedoresCurto(c).slice(0, 40), fmtData(dataCalc).replace(/\//g, '-'));
  if (formato === 'xlsx') return salvarPlanilha(gerarXLSXCalculo(c, dataCalc, opcoes), nome + '.xlsx');
  const pdf = gerarPDFCalculo(c, dataCalc, nome, opcoes);
  return formato === 'ver' ? visualizarPDF(pdf) : salvarPDF(pdf);
}
