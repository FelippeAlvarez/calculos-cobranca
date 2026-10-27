'use strict';
/*
  Séries mensais de verbas (aluguéis, cotas condominiais, IPTU, alimentos, honorários de partido…).
  Cada série tem uma descrição, critérios de correção e juros, multa e a forma dos juros (desde cada vencimento,
  desde uma data única ou sem juros); os meses ficam em s.meses = [{ id, competencia, vencimento, valor, pago }].
  O mesmo mês pode ter várias séries (aluguel, condomínio e IPTU de março, por exemplo).
  Reajuste: ao lançar os meses, o valor pode ser reajustado a cada aniversário pela variação do índice nos 12 meses
  anteriores (UFIR-RJ: valor do ano dividido pelo do ano anterior); os valores ficam editáveis mês a mês.
*/

function novaSerie(descricao, crit) {
  return { id: novoId(), descricao: descricao || '', crit: { ...crit }, multa: 0, juros: 'vencimento', jurosData: '', reajuste: { ativo: false, indice: 'IGP-M', mes: 1 }, meses: [] };
}

// Fator de reajuste num aniversário (mês "ym"): variação do índice nos 12 meses anteriores
function fatorReajuste(indice, ym, faltando) {
  const ini = addMes(ym, -12);
  return fatorTrecho(indice, ini + '-01', ym + '-01', ini, ym, faltando, false);
}

/*
  Valores dos meses de "de" a "ate", partindo de "valor" na competência "de".
  Com reajuste, o valor muda a cada aniversário (mês "mes" de cada ano) posterior à competência inicial.
  Devolve { valores: { 'AAAA-MM': valor }, faltando, aniversarios: [{ ym, fator, valor }] }.
*/
function valoresDaSerie(de, ate, valor, reajuste) {
  const valores = {}, faltando = new Set(), aniversarios = [];
  let atual = Number(valor) || 0;
  for (let m = de; m <= ate; m = addMes(m, 1)) {
    if (reajuste?.ativo && m > de && +m.slice(5) === +reajuste.mes) {
      const variacao = fatorReajuste(reajuste.indice, m, faltando);
      // "Não reduzir": com índice acumulado negativo, o valor fica como está
      const f = reajuste.naoReduzir && variacao < 1 ? 1 : variacao;
      atual = r2(atual * f);
      aniversarios.push({ ym: m, fator: f, variacao, valor: atual, mantido: f !== variacao });
    }
    valores[m] = atual;
  }
  return { valores, faltando: [...faltando], aniversarios };
}

const periodoSerie = s => {
  const l = (s.meses || []).map(m => m.competencia).filter(Boolean).sort();
  return l.length ? (l[0] === l[l.length - 1] ? mesNum(l[0]) : `${mesNum(l[0])} a ${mesNum(l[l.length - 1])}`) : '—';
};

// Texto da série para a memória de cálculo
function descSerie(s) {
  const p = [`${s.descricao}: prestações mensais (${periodoSerie(s)}), com correção monetária desde cada vencimento`];
  p.push(s.juros === 'data' ? `e juros de mora desde ${fmtData(s.jurosData)}` : s.juros === 'nenhum' ? 'e sem juros de mora' : 'e juros de mora desde cada vencimento');
  let t = p.join(' ') + '. Critérios: ' + descRegimes(regimesDeCrit(s.crit || critPadrao()), s.juros !== 'nenhum') + '.';
  if (Number(s.multa)) t += ` Multa de ${fmtPct(s.multa)}% sobre o valor corrigido de cada prestação.`;
  if (s.reajuste?.ativo) t += ` Valores reajustados anualmente em ${MESES[(+s.reajuste.mes || 1) - 1].toLowerCase()} ${pelo(s.reajuste.indice)} acumulado dos 12 meses anteriores${s.reajuste.naoReduzir ? ', sem redução quando o índice acumulado for negativo' : ''}.`;
  const pagos = (s.meses || []).filter(m => m.pago).length;
  if (pagos) t += ` ${pagos} mês(es) marcado(s) como pago(s), não incluído(s).`;
  return t;
}

// Inclui meses numa série, sem repetir competências já lançadas; devolve quantos entraram
function incluirMeses(s, meses) {
  const ja = new Set(s.meses.map(m => m.competencia));
  let n = 0;
  for (const m of meses) {
    if (m.competencia && ja.has(m.competencia)) continue;
    s.meses.push({ id: novoId(), competencia: m.competencia, vencimento: m.vencimento, valor: r2(m.valor), pago: false });
    if (m.competencia) ja.add(m.competencia);
    n++;
  }
  s.meses.sort((a, b) => comparar(a.vencimento, b.vencimento) || comparar(a.competencia, b.competencia));
  return n;
}

// Série com a mesma descrição (para acrescentar meses a ela) ou uma nova
function serieDe(c, descricao, critBase) {
  let s = c.series.find(x => normalizar(x.descricao) === normalizar(descricao));
  if (!s) { s = novaSerie(descricao, critBase); c.series.push(s); }
  return s;
}

/* ================= Lançar meses em sequência ================= */
function janelaSequencia(c, critBase, depois) {
  const hojeM = mesAtual();
  abrirModal(`<div class="modal-cab"><h2>Lançar meses em sequência</h2><button class="bt-x" data-fechar>&times;</button></div>
    <form id="fSeq" class="form-modal" autocomplete="off">
    <p class="dica">Lança uma prestação por mês (aluguel, cota condominial, IPTU, alimentos…). Para várias rubricas no mesmo período, lance uma de cada vez: os meses de cada rubrica formam uma série, e o mesmo mês pode ter várias séries.</p>
    <div class="grade-form">
      ${campo('Rubrica *', `<input id="sqDesc" list="dlRubricas" required placeholder="Ex.: Aluguel, Cota condominial, IPTU">`, 'w2', '<span id="sqExiste"></span>')}
      ${campo('Da competência', `<input type="month" id="sqDe" value="${addMes(hojeM, -12)}">`)}
      ${campo('Até a competência', `<input type="month" id="sqAte" value="${addMes(hojeM, -1)}">`)}
      ${campo('Dia do vencimento', `<input type="number" id="sqDia" min="1" max="31" value="10">`)}
      ${campo('Vencimento', `<select id="sqMes"><option value="0">No mês da competência</option><option value="1">No mês seguinte</option></select>`)}
      ${campo('Valor mensal (R$) *', `<input id="sqValor" inputmode="decimal" class="num">`, '', 'Na competência inicial; com reajuste, muda a cada aniversário.')}
      ${campo('Multa (%)', `<input id="sqMulta" inputmode="decimal" placeholder="0">`, '', 'Sobre o valor corrigido de cada prestação.')}
      ${campo('Juros de mora desde', `<select id="sqJuros"><option value="vencimento">Cada vencimento (art. 397 do CC)</option><option value="data">Uma data única (ex.: citação)</option><option value="nenhum">Sem juros</option></select>`)}
      ${campo('Data dos juros', `<input type="date" id="sqJurosData">`, 'sq-jdata')}
    </div>
    <h3 class="sec" style="margin-top:12px">Critérios de correção e juros da série</h3><div id="sqCrit"></div>
    <h3 class="sec" style="margin-top:12px">Reajuste anual do valor</h3>
    <div class="grade-form">
      <div class="campo w2"><label class="inline" style="white-space:normal;margin-top:22px"><input type="checkbox" id="sqReaj"> Reajustar o valor a cada aniversário pelo índice acumulado dos 12 meses anteriores</label></div>
      ${campo('Índice do reajuste', `<select id="sqReajIndice">${INDICES.filter(i => i !== 'Nenhum').map(i => `<option ${i === 'IGP-M' ? 'selected' : ''}>${i}</option>`).join('')}</select>`, 'sq-reaj')}
      ${campo('Mês do aniversário', `<select id="sqReajMes">${MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select>`, 'sq-reaj', 'Ex.: contrato de locação de março: reajuste a partir da competência de março de cada ano.')}
      <div class="campo w2 sq-reaj"><label class="inline" style="white-space:normal;margin-top:22px"><input type="checkbox" id="sqNaoReduzir" checked> Não reduzir o valor quando o índice acumulado for negativo</label></div>
    </div>
    <p id="sqPrevia" class="dica"></p>
    <div class="barra-form"><button class="bt primario">Lançar</button><button type="button" class="bt" data-fechar>Cancelar</button></div></form>`, 'modal-item');
  let crit = { ...critBase };
  const desenharCrit = () => { $('#sqCrit').innerHTML = critFormulario(crit); ligarCrit($('#sqCrit'), crit, previa); };
  const existente = () => c.series.find(x => normalizar(x.descricao) === normalizar($('#sqDesc').value));
  const mostrar = () => {
    $$('.sq-jdata').forEach(e => { e.hidden = $('#sqJuros').value !== 'data'; });
    $$('.sq-reaj').forEach(e => { e.hidden = !$('#sqReaj').checked; });
  };
  function previa() {
    mostrar();
    const de = $('#sqDe').value, ate = $('#sqAte').value, valor = parseValor($('#sqValor').value);
    if (!ehMes(de) || !ehMes(ate) || de > ate || !(valor > 0)) { $('#sqPrevia').textContent = ''; return; }
    const r = valoresDaSerie(de, ate, valor, { ativo: $('#sqReaj').checked, indice: $('#sqReajIndice').value, mes: +$('#sqReajMes').value, naoReduzir: $('#sqNaoReduzir').checked });
    const qtd = Object.keys(r.valores).length, total = Object.values(r.valores).reduce((s, v) => s + cent(v), 0) / 100;
    $('#sqPrevia').innerHTML = `${qtd} mês(es), total originário ${fmtMoeda(total)}.` + r.aniversarios.map(a => a.mantido
      ? `<br>Reajuste em ${mesNum(a.ym)}: índice negativo (fator ${fmtFator(a.variacao)}), valor mantido em ${fmtMoeda(a.valor)}.`
      : `<br>Reajuste em ${mesNum(a.ym)}: fator ${fmtFator(a.fator)}, novo valor ${fmtMoeda(a.valor)}.`).join('')
      + (r.faltando.length ? `<br><b>Índice não disponível para ${esc(r.faltando.join(', '))}: o reajuste desses meses fica incompleto (corrija o valor depois, mês a mês).</b>` : '');
  }
  // Rubrica já lançada: os meses vão para a série existente, com os critérios dela
  $('#sqDesc').addEventListener('change', () => {
    const s = existente();
    $('#sqExiste').textContent = s ? `Já existe a série "${s.descricao}" (${s.meses.length} meses): os novos meses serão acrescentados a ela, e os critérios abaixo passam a valer para a série inteira.` : '';
    if (s) {
      crit = { ...s.crit }; desenharCrit();
      $('#sqMulta').value = s.multa ? fmtPct(s.multa) : '';
      $('#sqJuros').value = s.juros || 'vencimento'; $('#sqJurosData').value = s.jurosData || '';
      const u = [...s.meses].sort((a, b) => comparar(a.competencia, b.competencia)).pop();
      if (u) {
        $('#sqDe').value = addMes(u.competencia, 1);
        $('#sqDia').value = +u.vencimento.slice(8);
        $('#sqMes').value = u.vencimento.slice(0, 7) > u.competencia ? '1' : '0';
        $('#sqValor').value = fmtNum(u.valor);
      }
    }
    previa();
  });
  desenharCrit();
  $$('#fSeq input, #fSeq select').forEach(el => { if (!el.closest('#sqCrit')) el.addEventListener('change', previa); });
  mostrar();
  $('#fSeq').addEventListener('submit', e => { e.preventDefault(); executar(() => {
    const desc = $('#sqDesc').value.trim(), de = $('#sqDe').value, ate = $('#sqAte').value, valor = parseValor($('#sqValor').value);
    if (!desc) throw new Error('Informe a rubrica.');
    if (!ehMes(de) || !ehMes(ate) || de > ate) throw new Error('Confira as competências inicial e final.');
    if (!(valor > 0)) throw new Error('Informe o valor mensal.');
    if ($('#sqJuros').value === 'data' && !ehData($('#sqJurosData').value)) throw new Error('Informe a data dos juros.');
    const reajuste = { ativo: $('#sqReaj').checked, indice: $('#sqReajIndice').value, mes: +$('#sqReajMes').value, naoReduzir: $('#sqNaoReduzir').checked };
    const { valores } = valoresDaSerie(de, ate, valor, reajuste);
    const s = serieDe(c, desc, crit);
    Object.assign(s, { crit: { ...crit }, multa: parseValor($('#sqMulta').value), juros: $('#sqJuros').value, jurosData: $('#sqJurosData').value });
    if (reajuste.ativo) s.reajuste = reajuste;
    const dia = +$('#sqDia').value || 10, desloc = +$('#sqMes').value;
    const n = incluirMeses(s, Object.entries(valores).map(([m, v]) => ({ competencia: m, vencimento: diaDoMes(addMes(m, desloc), dia), valor: v })));
    fecharModal();
    depois();
    aviso(`${n} mês(es) lançado(s) em "${s.descricao}"${n < Object.keys(valores).length ? ' (competências já lançadas não foram repetidas)' : ''}. Confira e clique em Salvar.`);
  }); });
}

/* ================= Critérios de uma série ================= */
function janelaCriteriosSerie(s, depois) {
  const crit = { ...(s.crit || critPadrao()) };
  abrirModal(`<div class="modal-cab"><h2>Série: ${esc(s.descricao)}</h2><button class="bt-x" data-fechar>&times;</button></div>
    <form id="fSerie" class="form-modal" autocomplete="off"><div class="grade-form">
      ${campo('Rubrica', `<input id="srDesc" list="dlRubricas" value="${esc(s.descricao)}" required>`, 'w2')}
      ${campo('Multa (%)', `<input id="srMulta" inputmode="decimal" value="${s.multa ? esc(fmtPct(s.multa)) : ''}">`)}
      ${campo('Juros de mora desde', `<select id="srJuros"><option value="vencimento">Cada vencimento (art. 397 do CC)</option><option value="data" ${s.juros === 'data' ? 'selected' : ''}>Uma data única (ex.: citação)</option><option value="nenhum" ${s.juros === 'nenhum' ? 'selected' : ''}>Sem juros</option></select>`)}
      ${campo('Data dos juros', `<input type="date" id="srJurosData" value="${esc(s.jurosData || '')}">`, 'sr-jdata')}
    </div>
    <h3 class="sec" style="margin-top:12px">Critérios de correção e juros (valem para todos os meses)</h3><div id="srCrit">${critFormulario(crit)}</div>
    <div class="barra-form"><button class="bt primario">Aplicar</button><button type="button" class="bt" data-fechar>Cancelar</button></div></form>`, 'modal-item');
  ligarCrit($('#srCrit'), crit, () => {});
  const mostrar = () => { $$('.sr-jdata').forEach(e => { e.hidden = $('#srJuros').value !== 'data'; }); };
  $('#srJuros').addEventListener('change', mostrar); mostrar();
  $('#fSerie').addEventListener('submit', e => { e.preventDefault(); executar(() => {
    if (!$('#srDesc').value.trim()) throw new Error('Informe a rubrica.');
    if ($('#srJuros').value === 'data' && !ehData($('#srJurosData').value)) throw new Error('Informe a data dos juros.');
    Object.assign(s, { descricao: $('#srDesc').value.trim(), crit, multa: parseValor($('#srMulta').value), juros: $('#srJuros').value, jurosData: $('#srJurosData').value });
    fecharModal();
    depois();
  }); });
}

/* ================= Quadro das séries (tela do cálculo) ================= */
function desenharSeries(el, c, { alterado, mudouEstrutura, abertas }) {
  el.innerHTML = c.series.map((s, i) => {
    const abertos = s.meses.filter(m => !m.pago && Number(m.valor) > 0);
    const total = abertos.reduce((t, m) => t + cent(m.valor), 0) / 100;
    const pagos = s.meses.length - abertos.length;
    const aberta = abertas.has(s.id);
    return `<div class="quadro-serie" data-s="${i}">
      <div class="serie-cab"><button type="button" class="bt-link" data-abrir>${aberta ? '▾' : '▸'} <b>${esc(s.descricao || 'Série sem nome')}</b></button>
        <span class="dica">${s.meses.length} mês(es), ${periodoSerie(s)} · em aberto ${fmtMoeda(total)}${pagos ? ` · ${pagos} pago(s)` : ''} · ${esc(descRegimes(regimesDeCrit(s.crit || critPadrao()), s.juros !== 'nenhum'))}${s.multa ? ` · multa ${fmtPct(s.multa)}%` : ''}</span>
        <span class="acoes"><button type="button" class="bt pequeno" data-crit>Critérios</button><button type="button" class="bt pequeno perigo" data-excluir>Excluir série</button></span></div>
      ${aberta ? `<div class="rolagem"><table class="tabela tabela-edit"><thead><tr><th>Competência</th><th>Vencimento</th><th class="num">Valor (R$)</th><th class="cen">Pago</th><th></th></tr></thead><tbody>
        ${s.meses.map((m, k) => `<tr data-m="${k}" class="${m.pago ? 'excluido' : ''}"><td><input type="month" data-k="competencia" value="${esc(m.competencia || '')}"></td>
          <td><input type="date" data-k="vencimento" value="${esc(m.vencimento || '')}"></td>
          <td><input data-k="valor" class="num" inputmode="decimal" value="${m.valor ? fmtNum(m.valor) : ''}"></td>
          <td class="cen"><input type="checkbox" data-k="pago" ${m.pago ? 'checked' : ''}></td><td><button type="button" class="bt-x" title="Remover mês">&times;</button></td></tr>`).join('')}
      </tbody></table></div><div class="acoes-linha"><button type="button" class="bt pequeno" data-mais>+ Mês</button></div>` : ''}</div>`;
  }).join('');
  $$('.quadro-serie', el).forEach(q => {
    const s = c.series[+q.dataset.s];
    $('[data-abrir]', q).addEventListener('click', () => { abertas.has(s.id) ? abertas.delete(s.id) : abertas.add(s.id); desenharSeries(el, c, { alterado, mudouEstrutura, abertas }); });
    $('[data-crit]', q).addEventListener('click', () => janelaCriteriosSerie(s, () => { mudouEstrutura(); alterado(); }));
    $('[data-excluir]', q).addEventListener('click', () => {
      if (!confirm(`Excluir a série "${s.descricao}" e os seus ${s.meses.length} mês(es)?`)) return;
      c.series.splice(+q.dataset.s, 1); mudouEstrutura(); alterado();
    });
    $('[data-mais]', q)?.addEventListener('click', () => {
      const u = s.meses[s.meses.length - 1];
      const comp = u ? addMes(u.competencia, 1) : mesAtual();
      s.meses.push({ id: novoId(), competencia: comp, vencimento: u ? diaDoMes(addMes(u.vencimento.slice(0, 7), 1), +u.vencimento.slice(8)) : diaDoMes(comp, 10), valor: u?.valor || 0, pago: false });
      desenharSeries(el, c, { alterado, mudouEstrutura, abertas }); alterado();
    });
    $$('tr[data-m]', q).forEach(tr => {
      const m = s.meses[+tr.dataset.m];
      $$('[data-k]', tr).forEach(inp => inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', () => {
        const k = inp.dataset.k;
        if (k === 'valor') m.valor = r2(parseValor(inp.value)); else if (k === 'pago') { m.pago = inp.checked; tr.classList.toggle('excluido', m.pago); } else m[k] = inp.value;
        alterado();
      }));
      $('[data-k=valor]', tr).addEventListener('change', e => { e.target.value = m.valor ? fmtNum(m.valor) : ''; });
      $('.bt-x', tr).addEventListener('click', () => { s.meses.splice(+tr.dataset.m, 1); desenharSeries(el, c, { alterado, mudouEstrutura, abertas }); alterado(); });
    });
  });
}

/* ================= Importação de planilha (Excel, CSV ou PDF) ================= */
const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const anoCompleto = a => { a = +a; return a < 100 ? (a < 70 ? 2000 + a : 1900 + a) : a; };

// Data: 'AAAA-MM-DD' (já convertida da planilha), dd/mm/aaaa, dd-mm-aa…
function lerData(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return v > 20000 && v < 80000 ? isoDeSerial(v) : '';
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return ehData(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : '';
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) { const d = `${anoCompleto(m[3])}-${p2(m[2])}-${p2(m[1])}`; return ehData(d) ? d : ''; }
  return '';
}

// Competência: mm/aaaa, mm/aa, jan/24, janeiro/2024, aaaa-mm, data completa
function lerCompetencia(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return v > 20000 && v < 80000 ? isoDeSerial(v).slice(0, 7) : '';
  const s = normalizar(v);
  let m = s.match(/^(\d{4})-(\d{2})/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2]}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) return `${anoCompleto(m[3])}-${p2(m[2])}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{2,4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${anoCompleto(m[2])}-${p2(m[1])}`;
  m = s.match(/^([a-zç]{3,})\.?\s*[\/.\- ]?\s*(?:de\s+)?(\d{2,4})$/);
  if (m) { const i = MESES_ABREV.indexOf(m[1].slice(0, 3)); if (i >= 0) return `${anoCompleto(m[2])}-${p2(i + 1)}`; }
  return '';
}

const CAMPOS_SERIE = [['competencia', 'Competência (mês de referência)'], ['vencimento', 'Vencimento'], ['valor', 'Valor *'], ['descricao', 'Rubrica (aluguel, condomínio…)']];
const PISTAS = { competencia: /compet|refer|m[eê]s|per[ií]odo/, vencimento: /venc/, valor: /valor|quantia|r\$/, descricao: /descri|hist[oó]rico|tipo|natureza|rubrica|verba/ };
const NAO_DATA = /meses|dias|qtd|quant|\bn[ºo°]?\b|numero/;
const textoCel = v => v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : String(v).trim();
const mostrarCel = v => typeof v === 'number' ? fmtNum(v).replace(/,00$/, '') : /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? fmtData(v) : textoCel(v);
const ehValorCel = v => typeof v === 'number' ? v > 0 : /^-?\(?R?\$?\s*\d{1,3}(\.?\d{3})*,\d{2}\)?$/.test(String(v ?? '').trim());
const TESTES_COL = { competencia: v => !!lerCompetencia(v), vencimento: v => !!lerData(v), valor: ehValorCel };

// Linha de títulos provável: a primeira, entre as 30 primeiras, com 2+ textos que lembram os campos
function sugerirCabecalho(linhas) {
  for (let i = 0; i < Math.min(30, linhas.length); i++) {
    const textos = (linhas[i] || []).filter(v => typeof v === 'string' && v.trim());
    if (textos.filter(t => Object.values(PISTAS).some(re => re.test(normalizar(t)))).length >= 2) return i;
  }
  return 0;
}

function sugerirColunas(linhas, cab) {
  const titulos = (linhas[cab] || []).map(textoCel), amostra = linhas.slice(cab + 1, cab + 16);
  const usados = new Set(), mapa = {};
  for (const [k] of CAMPOS_SERIE) {
    const j = titulos.findIndex((t, j) => !usados.has(j) && PISTAS[k].test(normalizar(t)) && !(k === 'vencimento' && NAO_DATA.test(normalizar(t)))
      && (!TESTES_COL[k] || amostra.some(l => TESTES_COL[k](l[j]))));
    if (j >= 0) { mapa[k] = j; usados.add(j); }
  }
  return mapa;
}

function janelaImportarSeries(c, critBase, depois) {
  const st = { planilha: null, folha: 0, cab: 0, mapa: {}, dia: 10, desc: '' };
  abrirModal(`<div class="modal-cab"><h2>Importar prestações mensais</h2><button class="bt-x" data-fechar>&times;</button></div>
    <p class="dica">Aceita Excel (.xlsx), CSV e PDF com texto (PDF escaneado, que é só imagem, não pode ser lido). Confira a linha dos títulos e a coluna de cada informação. Com uma coluna de rubrica, cada rubrica vira uma série (aluguel, condomínio, IPTU…); sem ela, informe a rubrica abaixo. Linhas sem valor ou de totais são ignoradas.</p>
    <div class="campo-arquivo"><input type="file" id="impArq" accept=".xlsx,.xlsm,.csv,.txt,.xls,.pdf"></div>
    <div id="impCorpo"></div>`, 'modal-grande');
  $('#impArq').addEventListener('change', e => executar(async () => {
    const f = e.target.files[0];
    if (!f) return;
    $('#impCorpo').innerHTML = '<p class="carregando">Lendo o arquivo…</p>';
    try { st.planilha = await lerPlanilha(f); } catch (err) { $('#impCorpo').innerHTML = ''; throw err; }
    st.folha = Math.max(0, st.planilha.folhas.findIndex(x => x.linhas.some(l => l.length)));
    prepararFolha();
  }));

  function prepararFolha() {
    const linhas = st.planilha.folhas[st.folha].linhas;
    st.cab = sugerirCabecalho(linhas);
    st.mapa = sugerirColunas(linhas, st.cab);
    desenhar();
  }

  function convertidas() {
    const linhas = st.planilha.folhas[st.folha].linhas.slice(st.cab + 1);
    const pegar = (l, k) => st.mapa[k] === undefined || st.mapa[k] === '' ? null : l[st.mapa[k]];
    const saida = [], ign = { valor: [], data: [], desc: [], total: [] };
    linhas.forEach((l, i) => {
      if (!l.some(v => textoCel(v))) return;
      const n = st.cab + i + 2;
      if (l.some(v => typeof v === 'string' && /^\s*(sub[\s-]?)?tota(l|is)\b/i.test(v))) { ign.total.push(n); return; }
      const valor = r2(parseValor(pegar(l, 'valor')));
      if (!(valor > 0)) { ign.valor.push(n); return; }
      let venc = lerData(pegar(l, 'vencimento')), comp = lerCompetencia(pegar(l, 'competencia'));
      if (!comp && venc) comp = venc.slice(0, 7);
      if (!venc && comp) venc = diaDoMes(comp, st.dia);
      if (!venc) { ign.data.push(n); return; }
      const desc = textoCel(pegar(l, 'descricao')) || st.desc.trim();
      if (!desc) { ign.desc.push(n); return; }
      saida.push({ descricao: desc, competencia: comp, vencimento: venc, valor });
    });
    return { saida, ign };
  }

  function desenhar() {
    const pl = st.planilha, linhas = pl.folhas[st.folha].linhas;
    const ncol = Math.max(1, ...linhas.slice(0, 300).map(l => l.length));
    const titulos = Array.from({ length: ncol }, (_, j) => textoCel((linhas[st.cab] || [])[j]));
    const opcoesCol = sel => '<option value="">— não usar —</option>' + titulos.map((t, j) => `<option value="${j}" ${String(sel) === String(j) ? 'selected' : ''}>${colunaXLSX(j)}${t ? ': ' + esc(t.slice(0, 40)) : ''}</option>`).join('');
    const prev = linhas.slice(0, 60).map((l, i) => `<tr class="${i === st.cab ? 'grupo' : i < st.cab ? 'excluido' : ''}"><td class="dica">${i + 1}</td>${Array.from({ length: ncol }, (_, j) => `<td>${esc(mostrarCel(l[j]))}</td>`).join('')}</tr>`).join('');
    const { saida, ign } = convertidas();
    const series = [...new Set(saida.map(x => x.descricao))];
    const total = saida.reduce((s, x) => s + cent(x.valor), 0) / 100;
    const lista = (n, rot) => n.length ? `${n.length} ${rot} (linha${n.length > 1 ? 's' : ''} ${n.slice(0, 10).join(', ')}${n.length > 10 ? '…' : ''})` : '';
    const ignTxt = [lista(ign.valor, 'sem valor'), lista(ign.data, 'sem competência ou vencimento reconhecível'), lista(ign.desc, 'sem rubrica'), lista(ign.total, 'de totais')].filter(Boolean).join('; ');
    $('#impCorpo').innerHTML = `<div class="grade-form">
        ${pl.folhas.length > 1 ? `<div class="campo"><label>Folha</label><select id="impFolha">${pl.folhas.map((f, i) => `<option value="${i}" ${i === st.folha ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}</select></div>` : ''}
        <div class="campo"><label>Linha dos títulos</label><input type="number" id="impCab" min="1" value="${st.cab + 1}"></div>
        ${CAMPOS_SERIE.map(([k, r]) => `<div class="campo"><label>${r}</label><select data-mapa="${k}">${opcoesCol(st.mapa[k])}</select></div>`).join('')}
        <div class="campo"><label>Rubrica (se não houver coluna)</label><input id="impDesc" list="dlRubricas" value="${esc(st.desc)}" placeholder="Ex.: Aluguel"></div>
        <div class="campo"><label>Dia do vencimento (se não houver coluna)</label><input type="number" id="impDia" min="1" max="31" value="${st.dia}"></div>
      </div>
      <p class="${saida.length ? 'dica' : 'alerta'}" style="margin-top:12px"><b>${saida.length}</b> mês(es) serão importados, total de <b>${fmtMoeda(total)}</b>${series.length ? `, em ${series.length} série(s): ${esc(series.join(', '))}` : ''}.
        ${ignTxt ? 'Ignoradas: ' + esc(ignTxt) + '.' : ''}
        ${!saida.length && (st.mapa.valor === undefined || st.mapa.valor === '') ? '<br><b>Escolha a coluna do valor.</b>' : ''}
        ${ign.desc.length && !saida.length ? '<br><b>Indique a coluna da rubrica ou digite a rubrica acima.</b>' : ''}</p>
      <p class="dica">Rubricas já lançadas recebem os novos meses na série existente (sem repetir competências). As séries novas usam os critérios sugeridos e juros desde cada vencimento: confira em "Critérios" depois de importar.</p>
      <div class="acoes-linha"><button class="bt primario" id="impOk" ${saida.length ? '' : 'disabled'}>Importar</button><button class="bt" data-fechar>Cancelar</button></div>
      <h3 style="margin:14px 0 6px;font-size:13px">Prévia (${Math.min(60, linhas.length)} primeiras linhas)</h3>
      <div class="rolagem previa-imp"><table class="tabela tabela-imp"><thead><tr><th></th>${titulos.map((_, j) => `<th>${colunaXLSX(j)}</th>`).join('')}</tr></thead><tbody>${prev}</tbody></table></div>`;
    $('#impFolha')?.addEventListener('change', e => { st.folha = +e.target.value; prepararFolha(); });
    $('#impCab').addEventListener('change', e => { st.cab = Math.max(0, (+e.target.value || 1) - 1); st.mapa = sugerirColunas(linhas, st.cab); desenhar(); });
    $('#impDia').addEventListener('change', e => { st.dia = +e.target.value || 10; desenhar(); });
    $('#impDesc').addEventListener('change', e => { st.desc = e.target.value; desenhar(); });
    $$('[data-mapa]').forEach(s => s.addEventListener('change', () => { st.mapa[s.dataset.mapa] = s.value === '' ? '' : +s.value; desenhar(); }));
    $('#impOk').addEventListener('click', () => executar(() => {
      const grupos = {};
      for (const x of convertidas().saida) (grupos[normalizar(x.descricao)] = grupos[normalizar(x.descricao)] || []).push(x);
      let n = 0;
      for (const l of Object.values(grupos)) n += incluirMeses(serieDe(c, l[0].descricao, critBase), l);
      fecharModal();
      depois();
      aviso(`${n} mês(es) importado(s) em ${Object.keys(grupos).length} série(s). Confira os critérios de cada série e clique em Salvar.`);
    }));
  }
}

/* ================= Ordem das verbas nas planilhas ================= */
/*
  Linhas da tabela de verbas: por mês (ordem de vencimento, com subtotal de cada competência que tiver mais de um item)
  ou por rubrica (verbas avulsas e depois cada série, com subtotal). Devolve [{ it } | { subtotal: rótulo, itens }].
*/
function linhasVerbasOrdenadas(itens, c, ordem) {
  if (!itens.some(it => it.serie)) return itens.map(it => ({ it }));
  const out = [];
  // "inicio" marca o primeiro item de cada bloco (o subtotal do Excel soma do início do bloco até ele)
  const bloco = (l, rotulo) => {
    l.forEach((it, k) => out.push({ it, inicio: k === 0 }));
    if (rotulo) out.push({ subtotal: rotulo, itens: l });
  };
  if (ordem === 'rubrica') {
    const avulsas = itens.filter(it => !it.serie);
    if (avulsas.length) bloco(avulsas);
    for (const s of c.series || []) {
      const l = itens.filter(it => it.serie === s.id);
      if (l.length) bloco(l, `Subtotal ${s.descricao}`);
    }
    return out;
  }
  // Por mês (do vencimento): os itens do mesmo mês juntos, com subtotal quando houver mais de um
  const porMes = {};
  for (const it of itens) (porMes[(it.data || '').slice(0, 7)] = porMes[(it.data || '').slice(0, 7)] || []).push(it);
  for (const ym of Object.keys(porMes).sort()) {
    const l = porMes[ym];
    bloco(l, l.length > 1 && l.some(it => it.serie) ? `Subtotal (vencimentos de ${mesNum(ym)})` : '');
  }
  return out;
}
