'use strict';
/* Simulação de acordo: lista, tela de simulação, PDF e Excel */

const TIPO_VALOR = tipo => `<option value="pct" ${tipo === 'pct' ? 'selected' : ''}>%</option><option value="valor" ${tipo !== 'pct' ? 'selected' : ''}>R$</option>`;
const fmtCfg = cfg => cfg?.tipo === 'pct' ? fmtPct(cfg.valor) + '%' : fmtMoeda(cfg?.valor || 0);

/* ================= Lista de simulações ================= */
function telaAcordos() {
  const lista = [];
  for (const c of Object.values(D.calculos)) for (const a of c.acordos || []) lista.push({ c, a });
  lista.sort((x, y) => comparar(y.a.data, x.a.data) || comparar(devedoresCurto(x.c), devedoresCurto(y.c)));
  const calcs = Object.values(D.calculos).filter(c => (c.situacao || 'ativo') === 'ativo').sort(ordemCalculo);
  $('#conteudo').innerHTML = cabecalho('Acordos', 'Simulações de acordo sobre os débitos calculados: desconto, sinal e parcelamento.') + `
    <div class="cartao"><h2>Nova simulação</h2>
      <div class="barra-filtros"><select id="acCalc"><option value="">— escolha o débito (cálculo) —</option>
        ${calcs.map(c => `<option value="${c.id}">${esc(devedoresCurto(c))} - ${esc(nomeCredor(c))}${c.titulo ? ' (' + esc(c.titulo) + ')' : ''}${c.processo ? ' · ' + esc(c.processo) : ''}</option>`).join('')}</select>
        <button class="bt primario" id="acNova">Simular acordo</button></div></div>
    <div class="cartao"><h2>Simulações salvas (${lista.length})</h2>
      ${lista.length ? `<div class="rolagem"><table class="tabela clicavel"><thead><tr><th>Data</th><th>Devedor(es) / credor</th><th>Simulação</th><th class="num">Débito</th><th class="num">Com desconto</th><th>Parcelamento</th></tr></thead><tbody>
        ${lista.map(({ c, a }) => { let ra = null; try { ra = calcularAcordo(c, a); } catch { /* cálculo incompleto */ }
          return `<tr data-c="${c.id}" data-a="${a.id}"><td>${fmtData(a.data)}</td><td>${esc(devedoresCurto(c))}<div class="dica">${esc(nomeCredor(c))}</div></td><td>${esc(a.nome || '—')}</td>
          <td class="num">${ra ? fmtNum(ra.debito) : '—'}</td><td class="num">${ra ? fmtNum(ra.comDesconto) : '—'}</td>
          <td>${ra ? (ra.sinal ? `Sinal ${fmtMoeda(ra.sinal)} + ` : '') + (ra.n ? `${ra.n} × ${fmtMoeda(ra.parcela)}` : 'à vista') : ''}</td></tr>`; }).join('')}</tbody></table></div>`
      : '<p class="vazio">Nenhuma simulação salva.</p>'}</div>`;
  $('#acNova').addEventListener('click', () => executar(() => {
    const id = $('#acCalc').value;
    if (!id) throw new Error('Escolha o débito (cálculo).');
    location.hash = `#/acordo/${id}/novo`;
  }));
  $$('tr[data-a]').forEach(tr => tr.addEventListener('click', () => { location.hash = `#/acordo/${tr.dataset.c}/${tr.dataset.a}`; }));
}

/* ================= Tela da simulação ================= */
function telaAcordo(calcId, acordoId) {
  const original = D.calculos[calcId];
  if (!original) throw new Error('Cálculo não encontrado.');
  const nova = !acordoId || acordoId === 'novo';
  const salvo = nova ? null : (original.acordos || []).find(x => x.id === acordoId);
  if (!nova && !salvo) throw new Error('Simulação não encontrada.');
  const a = nova ? novoAcordo(hoje()) : structuredClone(salvo);
  a.desconto.itens = a.desconto.itens || {};
  const c = structuredClone(original);
  garantirIndices().then(() => { if (document.body.contains($('#acResumo'))) recalcular(); });

  $('#conteudo').innerHTML = cabecalho(nova ? 'Nova simulação de acordo' : 'Simulação de acordo' + (a.nome ? ': ' + a.nome : ''),
    `${esc(devedoresCurto(c))} - ${esc(nomeCredor(c))}${c.processo ? ' · ' + esc(c.processo) : ''}`, '', '#/calculo/' + c.id) + `
  <div class="cartao"><h2>Acordo</h2><div class="grade-form">
    ${campo('Nome da simulação (opcional)', `<input id="acNome" value="${esc(a.nome || '')}" placeholder="Ex.: Proposta do devedor, contraproposta">`, 'w2')}
    ${campo('Data do acordo', `<input type="date" id="acData" value="${esc(a.data)}">`, '', 'O débito é atualizado até esta data.')}
  </div></div>

  <div class="cartao"><h2>Débito e desconto</h2>
    <div class="grade-form">
      <div class="campo w2"><label>Desconto</label><div class="segmentado">
        <label><input type="radio" name="acDescModo" value="total" ${a.desconto.modo !== 'itens' ? 'checked' : ''}> Sobre o total</label>
        <label><input type="radio" name="acDescModo" value="itens" ${a.desconto.modo === 'itens' ? 'checked' : ''}> Verba por verba</label></div></div>
      <div class="campo desc-total"><label>Desconto sobre o total</label><div class="valor-tipo"><input id="acDescValor" inputmode="decimal" class="num" value="${a.desconto.valor ? esc(fmtPct(a.desconto.valor)) : ''}"><select id="acDescTipo">${TIPO_VALOR(a.desconto.tipo)}</select></div></div>
    </div>
    <div class="rolagem"><table class="tabela tabela-edit"><thead><tr><th>Item</th><th class="num">Débito na data</th><th class="desc-itens">Desconto</th><th class="num">Desconto (R$)</th><th class="num">Com desconto</th></tr></thead><tbody id="acItens"></tbody></table></div></div>

  <div class="cartao"><h2>Sinal e parcelamento</h2><div class="grade-form">
    <div class="campo"><label>Sinal (na data do acordo)</label><div class="valor-tipo"><input id="acSinalValor" inputmode="decimal" class="num" value="${a.sinal.valor ? esc(fmtPct(a.sinal.valor)) : ''}"><select id="acSinalTipo">${TIPO_VALOR(a.sinal.tipo)}</select></div>
      <small>Em %: sobre o valor com desconto.</small></div>
    <div class="campo w2"><label>Calcular</label><div class="segmentado">
      <label><input type="radio" name="acModo" value="numero" ${a.parcelas.modo !== 'valor' ? 'checked' : ''}> O valor da parcela</label>
      <label><input type="radio" name="acModo" value="valor" ${a.parcelas.modo === 'valor' ? 'checked' : ''}> O número de parcelas</label></div></div>
    ${campo('Número de parcelas', `<input id="acN" type="number" min="1" max="600" value="${esc(a.parcelas.n || 12)}">`, 'modo-numero')}
    ${campo('Valor da parcela (R$)', `<input id="acParcela" inputmode="decimal" class="num" value="${a.parcelas.valor ? esc(fmtNum(a.parcelas.valor)) : ''}">`, 'modo-valor')}
    ${campo('Juros (% ao mês)', `<input id="acTaxa" inputmode="decimal" value="${esc(fmtPct(a.parcelas.taxa ?? 0))}">`, '', 'Tabela Price. Zero: parcelas iguais, sem juros.')}
    ${campo('Vencimento da 1ª parcela', `<input type="date" id="acPrimeiro" value="${esc(a.parcelas.primeiro || '')}">`, '', 'As demais vencem no mesmo dia dos meses seguintes.')}
    <div class="campo w2"><label class="inline" style="white-space:normal;margin-top:22px"><input type="checkbox" id="acJuros1" ${a.parcelas.jurosAte1 !== false ? 'checked' : ''}> Juros desde a data do acordo até o 1º vencimento</label>
      <small>Desmarcado: o saldo não rende juros até o 1º vencimento, e a 1ª parcela não tem juros.</small></div>
    ${campo('Correção das parcelas', `<select id="acIndice">${INDICES.map(x => `<option ${(a.parcelas.indice || 'IPCA') === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`, '', 'As parcelas ficam em valores da data do acordo e são corrigidas até cada pagamento.')}
  </div></div>

  <div class="cartao destaque"><h2>Resultado</h2>
    <div class="colunas2"><div id="acResumo" class="resumo"></div><div><p id="acDesc" class="dica"></p><div id="acAvisos"></div></div></div>
    <h3 class="sec">Cronograma</h3><div id="acCrono" class="rolagem"></div>
    <h3 class="sec">Valor corrigido de uma parcela</h3>
    <div class="acoes-linha"><label class="inline">Parcela nº <input type="number" id="acCorrK" min="1" value="1" style="width:80px"></label>
      <label class="inline">paga em <input type="date" id="acCorrData" value="${hoje()}"></label><span id="acCorrRes" class="dica"></span></div>
    <div class="acoes-linha" style="margin-top:12px"><button class="bt" id="acVer">Visualizar PDF</button><button class="bt" id="acPdf">Salvar PDF</button><button class="bt" id="acXlsx">Salvar Excel</button></div>
  </div>

  <div class="barra-salvar"><span id="estadoSalvar"></span>${nova ? '' : '<button class="bt perigo" id="acExcluir">Excluir</button><button class="bt" id="acDuplicar">Duplicar</button>'}<button class="bt primario" id="acSalvar">Salvar simulação</button></div>`;

  let ra = null;
  const alterado = () => { marcarSujo(); recalcular(); };
  const ler = () => {
    a.nome = $('#acNome').value.trim();
    a.data = $('#acData').value;
    a.desconto.modo = $('input[name=acDescModo]:checked').value;
    a.desconto.tipo = $('#acDescTipo').value;
    a.desconto.valor = parseValor($('#acDescValor').value);
    a.sinal = { tipo: $('#acSinalTipo').value, valor: parseValor($('#acSinalValor').value) };
    a.parcelas = { modo: $('input[name=acModo]:checked').value, n: Math.max(1, +$('#acN').value || 1), valor: r2(parseValor($('#acParcela').value)),
      taxa: parseValor($('#acTaxa').value), primeiro: $('#acPrimeiro').value, jurosAte1: $('#acJuros1').checked, indice: $('#acIndice').value };
  };
  const mostrar = () => {
    $$('.desc-total').forEach(e => { e.hidden = a.desconto.modo === 'itens'; });
    $$('.desc-itens').forEach(e => { e.hidden = a.desconto.modo !== 'itens'; });
    $$('.modo-numero').forEach(e => { e.hidden = a.parcelas.modo === 'valor'; });
    $$('.modo-valor').forEach(e => { e.hidden = a.parcelas.modo !== 'valor'; });
  };

  function desenharItens() {
    const itens = ra?.itens || [];
    $('#acItens').innerHTML = itens.map(it => {
      const cfg = a.desconto.itens[it.itemId] || { tipo: 'pct', valor: 0 };
      return `<tr data-item="${esc(it.itemId)}"><td>${esc(it.rotulo)}${ehHonorario(it) ? ' <span class="chip neutro">honorários</span>' : ''}</td><td class="num">${fmtNum(it.total)}</td>
        <td class="desc-itens"><div class="valor-tipo"><input class="num" inputmode="decimal" data-iv value="${cfg.valor ? esc(fmtPct(cfg.valor)) : ''}"><select data-it>${TIPO_VALOR(cfg.tipo)}</select></div></td>
        <td class="num">${fmtNum(it.desconto)}</td><td class="num">${fmtNum(it.liquido)}</td></tr>`;
    }).join('') + (itens.length ? `<tr class="subtotal"><td>Total</td><td class="num">${fmtNum(ra.debito)}</td><td class="desc-itens"></td><td class="num">${fmtNum(ra.desconto)}</td><td class="num">${fmtNum(ra.comDesconto)}</td></tr>`
      : '<tr><td colspan="5" class="vazio">Nenhum valor devido nesta data.</td></tr>');
    $$('#acItens tr[data-item]').forEach(tr => {
      const id = tr.dataset.item;
      const ler1 = () => { a.desconto.itens[id] = { tipo: $('[data-it]', tr).value, valor: parseValor($('[data-iv]', tr).value) }; marcarSujo(); recalcular(false); };
      $('[data-iv]', tr).addEventListener('change', ler1);
      $('[data-it]', tr).addEventListener('change', ler1);
    });
    mostrar();
  }

  function recalcular(redesenharItens = true) {
    if (!ehData(a.data)) return;
    ra = calcularAcordo(c, a);
    if (redesenharItens || a.desconto.modo !== 'itens') desenharItens();
    else {
      // Atualiza só os valores, sem perder o campo em edição
      $$('#acItens tr[data-item]').forEach(tr => {
        const it = ra.itens.find(x => x.itemId === tr.dataset.item);
        if (it) { tr.children[3].textContent = fmtNum(it.desconto); tr.children[4].textContent = fmtNum(it.liquido); }
      });
      const tot = $('#acItens tr.subtotal');
      if (tot) { tot.children[3].textContent = fmtNum(ra.desconto); tot.children[4].textContent = fmtNum(ra.comDesconto); }
    }
    $('#acResumo').innerHTML = itensResumoAcordo(ra).map(([rot, v, e]) => `<div class="res-l ${e === 'f' ? 'final' : e === 'b' ? 'dest' : ''}"><span>${esc(rot)}</span><b>${typeof v === 'number' ? fmtMoeda(v) : esc(v)}</b></div>`).join('');
    $('#acDesc').textContent = descParcelamento(ra);
    $('#acAvisos').innerHTML = ra.avisos.map(n => `<p class="alerta">${esc(n)}</p>`).join('');
    const hon = ra.honorariosLiquidos > 0;
    $('#acCrono').innerHTML = ra.cronograma.length || ra.sinal ? `<table class="tabela"><thead><tr><th>Nº</th><th>Vencimento</th><th class="num">Valor</th><th class="num">Juros</th><th class="num">Amortização</th><th class="num">Saldo</th>${hon ? '<th class="num">Credor</th><th class="num">Honorários</th>' : ''}</tr></thead><tbody>
      ${ra.sinal ? `<tr><td>Sinal</td><td>${fmtData(ra.data)}</td><td class="num">${fmtNum(ra.sinal)}</td><td class="num">—</td><td class="num">${fmtNum(ra.sinal)}</td><td class="num">${fmtNum(ra.saldo)}</td>${hon ? `<td class="num">${fmtNum(ra.sinalRateio.credor)}</td><td class="num">${fmtNum(ra.sinalRateio.honorarios)}</td>` : ''}</tr>` : ''}
      ${ra.cronograma.map(x => `<tr><td>${x.k}</td><td>${fmtData(x.vencimento)}</td><td class="num">${fmtNum(x.valor)}</td><td class="num">${fmtNum(x.juros)}</td><td class="num">${fmtNum(x.amortizacao)}</td><td class="num">${fmtNum(x.saldo)}</td>${hon ? `<td class="num">${fmtNum(x.credor)}</td><td class="num">${fmtNum(x.honorarios)}</td>` : ''}</tr>`).join('')}
      <tr class="subtotal"><td>Total</td><td></td><td class="num">${fmtNum(ra.totalPago)}</td><td class="num">${fmtNum(ra.totalJuros)}</td><td></td><td></td>${hon ? `<td class="num">${fmtNum(r2(ra.totalPago - somaHon(ra)))}</td><td class="num">${fmtNum(somaHon(ra))}</td>` : ''}</tr></tbody></table>`
      : '<p class="vazio">Nada a parcelar.</p>';
    corrigirParcela();
  }

  function corrigirParcela() {
    const k = +$('#acCorrK').value, d = $('#acCorrData').value, x = ra?.cronograma[k - 1];
    if (!x || !ehData(d)) { $('#acCorrRes').textContent = ''; return; }
    const pc = parcelaCorrigida(ra, x.valor, d);
    $('#acCorrRes').textContent = ra.indice === 'Nenhum' ? `Parcela ${k}: ${fmtMoeda(x.valor)} (sem correção).`
      : `Parcela ${k}: ${fmtMoeda(x.valor)} × fator ${fmtFator(pc.fator)} (${ra.indice} desde ${fmtData(ra.data)}) = ${fmtMoeda(pc.valor)}` + (pc.faltando.length ? ` (índice ainda não divulgado: ${pc.faltando.join(', ')})` : '') + '.';
  }

  $$('#conteudo input, #conteudo select').forEach(el => {
    if (el.closest('#acItens') || el.id === 'acCorrK' || el.id === 'acCorrData') return;
    el.addEventListener('change', () => { ler(); mostrar(); alterado(); });
  });
  $('#acParcela').addEventListener('change', e => { e.target.value = a.parcelas.valor ? fmtNum(a.parcelas.valor) : ''; });
  ['acCorrK', 'acCorrData'].forEach(id => $('#' + id).addEventListener('change', corrigirParcela));
  ler(); mostrar(); recalcular();

  const exportar = formato => executar(async () => {
    ler();
    if (!ehData(a.data)) throw new Error('Informe a data do acordo.');
    await garantirIndices();
    ra = calcularAcordo(c, a);
    const nome = nomeArquivo('Acordo', devedoresCurto(c).slice(0, 40), fmtData(a.data).replace(/\//g, '-'));
    if (formato === 'xlsx') return salvarPlanilha(gerarXLSXAcordo(ra), nome + '.xlsx');
    const pdf = gerarPDFAcordo(ra, nome);
    return formato === 'ver' ? visualizarPDF(pdf) : salvarPDF(pdf);
  });
  $('#acVer').addEventListener('click', () => exportar('ver'));
  $('#acPdf').addEventListener('click', () => exportar('pdf'));
  $('#acXlsx').addEventListener('click', () => exportar('xlsx'));

  // A simulação fica guardada no próprio cálculo
  const gravar = async mudar => {
    const reg = structuredClone(D.calculos[c.id]);
    reg.acordos = reg.acordos || [];
    mudar(reg.acordos);
    await salvarRegistro('calculos', reg);
    sujo = false;
  };
  $('#acSalvar').addEventListener('click', () => executar(async () => {
    ler();
    if (!ehData(a.data)) throw new Error('Informe a data do acordo.');
    if (!ehData(a.parcelas.primeiro)) throw new Error('Informe o vencimento da 1ª parcela.');
    a.alteradoEm = new Date().toISOString();
    await gravar(l => { const i = l.findIndex(x => x.id === a.id); if (i >= 0) l[i] = a; else l.push(a); });
    aviso('Simulação salva.');
    if (nova) { ignorarHash = true; location.hash = `#/acordo/${c.id}/${a.id}`; hashAnterior = location.hash; }
  }));
  $('#acExcluir')?.addEventListener('click', () => executar(async () => {
    if (!confirm('Excluir esta simulação de acordo?')) return;
    await gravar(l => { const i = l.findIndex(x => x.id === a.id); if (i >= 0) l.splice(i, 1); });
    location.hash = '#/calculo/' + c.id;
  }));
  $('#acDuplicar')?.addEventListener('click', () => executar(async () => {
    if (sujo) throw new Error('Salve as alterações antes de duplicar.');
    const copia = { ...structuredClone(a), id: novoId(), nome: (a.nome || 'Simulação') + ' (cópia)' };
    await gravar(l => l.push(copia));
    location.hash = `#/acordo/${c.id}/${copia.id}`;
  }));
}

const somaHon = ra => r2(ra.sinalRateio.honorarios + ra.cronograma.reduce((s, x) => s + cent(x.honorarios), 0) / 100);

function itensResumoAcordo(ra) {
  const l = [['Débito atualizado em ' + fmtData(ra.data), ra.debito]];
  if (ra.desconto) l.push(['(-) Desconto', ra.desconto], ['(=) Valor com desconto', ra.comDesconto, 'b']);
  if (ra.sinal) l.push(['(-) Sinal', ra.sinal]);
  l.push(['(=) Saldo a parcelar', ra.saldo, 'b']);
  if (ra.n) {
    l.push([`Parcelas: ${ra.n} × (1ª em ${fmtData(ra.primeiro)})`, ra.parcela]);
    if (ra.totalJuros) l.push(['Juros do parcelamento', ra.totalJuros]);
  }
  l.push(['Total a pagar (sinal + parcelas)', ra.totalPago, 'f']);
  return l;
}

/* ================= PDF ================= */
function gerarPDFAcordo(ra, nome) {
  const c = ra.c;
  const P = novoDocumento(true);
  P.cab();
  tituloPDF(P, 'Simulação de acordo', [[(ra.a.nome ? ra.a.nome + ' · ' : '') + 'Data do acordo: ' + fmtData(ra.data) + '.', 9, 'normal', COR_SUAVE]]);
  blocoInfoPDF(P, nomeCredorCurto(c) + ' x ' + devedoresCurto(c), linhasInfo(c));
  subtituloPDF(P, 'Débito na data do acordo');
  tabelaPDF(P, [{ t: 'Item', w: 120 }, { t: 'Débito atualizado', w: 30, a: 'r' }, { t: 'Desconto', w: 30, a: 'r' }, { t: 'Valor com desconto', w: 30, a: 'r' }], [
    ...ra.itens.map(it => ({ c: [it.rotulo, fmtNum(it.total), fmtNum(it.desconto), fmtNum(it.liquido)] })),
    { c: ['Total', fmtNum(ra.debito), fmtNum(ra.desconto), fmtNum(ra.comDesconto)], total: true },
  ], 8);
  P.espaco(80); // o título não fica sozinho no fim da página
  subtituloPDF(P, 'Resumo');
  resumoPDF(P, itensResumoAcordo(ra), 150);
  paragrafoPDF(P, descParcelamento(ra), 8, 'normal', COR_SUAVE);
  P.y += 3;
  if (ra.cronograma.length || ra.sinal) {
    subtituloPDF(P, 'Cronograma de pagamentos');
    const hon = ra.honorariosLiquidos > 0;
    tabelaPDF(P, [{ t: 'Nº', w: 12 }, { t: 'Vencimento', w: 20, nw: true }, { t: 'Valor', w: 22, a: 'r' }, { t: 'Juros', w: 20, a: 'r' }, { t: 'Amortização', w: 22, a: 'r' }, { t: 'Saldo', w: 24, a: 'r' },
      ...(hon ? [{ t: 'Credor', w: 22, a: 'r' }, { t: 'Honorários advocatícios', w: 22, a: 'r' }] : [])], [
      ...(ra.sinal ? [{ c: ['Sinal', fmtData(ra.data), fmtNum(ra.sinal), '—', fmtNum(ra.sinal), fmtNum(ra.saldo), ...(hon ? [fmtNum(ra.sinalRateio.credor), fmtNum(ra.sinalRateio.honorarios)] : [])] }] : []),
      ...ra.cronograma.map(x => ({ c: [String(x.k), fmtData(x.vencimento), fmtNum(x.valor), fmtNum(x.juros), fmtNum(x.amortizacao), fmtNum(x.saldo), ...(hon ? [fmtNum(x.credor), fmtNum(x.honorarios)] : [])] })),
      { c: ['Total', '', fmtNum(ra.totalPago), fmtNum(ra.totalJuros), '', '', ...(hon ? [fmtNum(r2(ra.totalPago - somaHon(ra))), fmtNum(somaHon(ra))] : [])], total: true },
    ], 8);
  }
  ra.avisos.forEach(t => { paragrafoPDF(P, t, 7.5, 'normal', COR_SUAVE); P.y += 1; });
  paragrafoPDF(P, 'Débito calculado conforme o demonstrativo de débito do mesmo cálculo, na data do acordo. ' + NOTA_METODO, 7.5, 'normal', COR_SUAVE);
  rodapePDF(P);
  return { doc: P.doc, nome: nome + '.pdf' };
}

/* ================= Excel (com fórmulas no parcelamento) ================= */
function gerarXLSXAcordo(ra) {
  const c = ra.c;
  const LARG = [40, 16, 16, 16, 16, 16, 16, 16], cab = cabecalhoXLSX(LARG);
  const L = [...cab.linhas, [{ v: 'Simulação de acordo', s: 'tit' }], ...linhasInfo(c).map(t => [t]), null];
  L.push([{ v: 'Débito na data do acordo', s: 'b' }]);
  L.push({ c: ['Item', 'Débito atualizado', 'Desconto', 'Valor com desconto'].map(v => ({ v, s: 'cab' })), altura: 30 });
  const ini = L.length + 1;
  ra.itens.forEach(it => { const n = L.length + 1; L.push([it.rotulo, { v: it.total, s: 'm' }, { v: it.desconto, s: 'm' }, { f: `B${n}-C${n}`, v: it.liquido, s: 'm' }]); });
  const fim = L.length;
  const linhaHon = ra.itens.map((it, k) => ehHonorario(it) ? `D${ini + k}` : null).filter(Boolean);
  L.push([{ v: 'Total', s: 'bt' }, { f: `SUM(B${ini}:B${fim})`, v: ra.debito, s: 'mt' }, { f: `SUM(C${ini}:C${fim})`, v: ra.desconto, s: 'mt' }, { f: `SUM(D${ini}:D${fim})`, v: ra.comDesconto, s: 'mt' }]);
  const TOT = 'D' + L.length;
  L.push(null);
  const param = (rot, cel) => { L.push([{ v: rot, s: 'b' }, cel]); return '$B$' + L.length; };
  const DATA = param('Data do acordo', { v: ra.data, s: 'd' });
  const SINAL = param('Sinal', { v: ra.sinal, s: 'm' });
  const SALDO = param('Saldo a parcelar', { f: `${TOT}-${SINAL}`, v: ra.saldo, s: 'm' });
  const TAXA = param('Juros ao mês (Tabela Price)', { v: ra.taxa, s: 'p' });
  const PRIM = param('Vencimento da 1ª parcela', { v: ra.primeiro, s: 'd' });
  const J1 = param('Juros até o 1º vencimento (1 = sim, 0 = não)', { v: ra.jurosAte1 ? 1 : 0, s: 'i' });
  const SV = param('Saldo no 1º vencimento', { f: `ROUND(IF(${J1}=1,${SALDO}*(1+${TAXA})^((${PRIM}-${DATA})/30),${SALDO}),2)`, v: ra.SV, s: 'm' });
  const N = param('Número de parcelas', { v: ra.n, s: 'i' });
  const PARC = param('Valor da parcela', ra.a.parcelas?.modo === 'valor' ? { v: ra.parcela, s: 'm' }
    : { f: `ROUND(IF(${TAXA}=0,${SV}/${N},${SV}*${TAXA}/((1-(1+${TAXA})^-${N})*(1+${TAXA}))),2)`, v: ra.parcela, s: 'm' });
  const PHON = param('Parte de honorários advocatícios em cada pagamento', { f: linhaHon.length ? `IF(${TOT}=0,0,(${linhaHon.join('+')})/${TOT})` : '0', v: ra.pctHon, s: 'p' });
  param('Correção das parcelas', ra.indice === 'Nenhum' ? 'Sem correção' : `${ra.indice}, desde a data do acordo até cada pagamento`);
  L.push(null, [{ v: 'Cronograma de pagamentos', s: 'b' }]);
  L.push({ c: ['Nº', 'Vencimento', 'Valor', 'Juros', 'Amortização', 'Saldo', 'Credor', 'Honorários'].map(v => ({ v, s: 'cab' })), altura: 30 });
  const cr0 = L.length + 1;
  if (ra.sinal) { const n = L.length + 1; L.push(['Sinal', { f: DATA, v: ra.data, s: 'd' }, { f: SINAL, v: ra.sinal, s: 'm' }, { v: 0, s: 'm' }, { f: `C${n}`, v: ra.sinal, s: 'm' }, { f: SALDO, v: ra.saldo, s: 'm' }, { f: `C${n}-H${n}`, v: ra.sinalRateio.credor, s: 'm' }, { f: `ROUND(C${n}*${PHON},2)`, v: ra.sinalRateio.honorarios, s: 'm' }]); }
  ra.cronograma.forEach((x, k) => {
    const n = L.length + 1, ant = k === 0 ? SALDO : `F${n - 1}`;
    const juros = k === 0 ? `ROUND(${SV}-${SALDO},2)` : `ROUND(${ant}*${TAXA},2)`;
    L.push([{ v: x.k, s: 'i' }, { v: x.vencimento, s: 'd' },
      { f: k === ra.cronograma.length - 1 ? `${ant}+D${n}` : `MIN(${PARC},${ant}+D${n})`, v: x.valor, s: 'm' },
      { f: juros, v: x.juros, s: 'm' }, { f: `C${n}-D${n}`, v: x.amortizacao, s: 'm' }, { f: `${ant}-E${n}`, v: x.saldo, s: 'm' },
      { f: `C${n}-H${n}`, v: x.credor, s: 'm' }, { f: `ROUND(C${n}*${PHON},2)`, v: x.honorarios, s: 'm' }]);
  });
  const crF = L.length;
  if (crF >= cr0) L.push([{ v: 'Total', s: 'bt' }, { v: '', s: 'bt' }, ...['C', 'D', 'E'].map(col => ({ f: `SUM(${col}${cr0}:${col}${crF})`, s: 'mt' })), { v: '', s: 'bt' }, ...['G', 'H'].map(col => ({ f: `SUM(${col}${cr0}:${col}${crF})`, s: 'mt' }))]);
  L.push(null);
  const mesclar = [];
  [descParcelamento(ra), ...ra.avisos, 'Alterando a taxa, o número de parcelas ou o vencimento inicial, a parcela, os juros e o cronograma são recalculados (as datas de vencimento e o número de linhas do cronograma não mudam).']
    .forEach(t => { L.push({ c: [{ v: t, s: 'tq' }], altura: Math.ceil(t.length / 150) * 13 + 2 }); mesclar.push(`A${L.length}:H${L.length}`); });
  return gerarXLSX([{ nome: 'Acordo', linhas: L, larguras: LARG, imagem: cab.imagem, mesclar }]);
}
