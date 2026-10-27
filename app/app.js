'use strict';
/* Cálculos de Cobrança — dados, telas e editor dos cálculos */

const VERSAO = '1.6.1';

/* ================= Dados ================= */
const D = { config: null, indices: null, credores: {}, calculos: {}, carregadoEm: 0 };

const PADROES = { honContr: 10, ignorarNegativos: false };
const DESC_RUBRICAS = ['Danos morais', 'Danos materiais', 'Lucros cessantes', 'Restituição de valores pagos', 'Aluguéis em atraso',
  'Parcelas contratuais', 'Cláusula penal compensatória', 'Pensão mensal', 'Indenização', 'Diferenças devidas', 'Saldo devedor'];
const DESC_CUSTAS = ['Custas iniciais', 'Taxa judiciária', 'Custas de distribuição', 'Diligência de oficial de justiça', 'Custas recursais (preparo)',
  'Porte de remessa e retorno', 'Honorários periciais', 'Certidão', 'Registro / averbação', 'Publicação de edital', 'Postagem / AR', 'Outras despesas'];

function normalizarConfig(c) {
  c = c || {};
  c.escritorio = c.escritorio || {};
  c.padroes = { ...PADROES, ...(c.padroes || {}) };
  // Critérios sugeridos para as novas verbas (versões anteriores guardavam uma lista de períodos)
  c.padroes.crit = { ...CRIT_PADRAO, ...(c.padroes.crit || critDeRegimes(c.padroes.regimes) || {}) };
  delete c.padroes.regimes;
  // Sugestões de descrição nos campos de verbas e de despesas (editáveis em Configurações)
  if (!Array.isArray(c.descVerbas)) c.descVerbas = [...DESC_RUBRICAS];
  if (!Array.isArray(c.descCustas)) c.descCustas = [...DESC_CUSTAS];
  return c;
}

function atualizarSugestoes() {
  $('#dlRubricas').innerHTML = (D.config?.descVerbas || DESC_RUBRICAS).map(r => `<option value="${esc(r)}">`).join('');
  $('#dlCustas').innerHTML = (D.config?.descCustas || DESC_CUSTAS).map(r => `<option value="${esc(r)}">`).join('');
}

const linhasDeTexto = t => [...new Set(String(t || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean))];

// Edição rápida de uma lista de sugestões (verbas ou despesas), a partir da tela do cálculo
function editarSugestoes(chave, titulo) {
  if (!Auth.ehAdmin()) throw new Error('Só o administrador altera as listas de sugestões (em Configurações).');
  abrirModal(`<div class="modal-cab"><h2>${esc(titulo)}</h2><button class="bt-x" data-fechar>&times;</button></div>
    <p class="dica">Uma sugestão por linha. Elas aparecem como opções ao digitar a descrição; ainda é possível digitar qualquer outro texto. A lista vale para todos os cálculos desta base.</p>
    <textarea id="sugTexto" rows="14">${esc(D.config[chave].join('\n'))}</textarea>
    <div class="acoes-linha"><button class="bt primario" id="sugSalvar">Salvar a lista</button><button class="bt" data-fechar>Cancelar</button></div>`, 'modal-medio');
  $('#sugSalvar').addEventListener('click', () => executar(async () => {
    await salvarConfig({ ...structuredClone(D.config), [chave]: linhasDeTexto($('#sugTexto').value) });
    fecharModal();
    aviso('Lista de sugestões salva.');
  }));
}

const usuarioLocal = () => Auth.usuario?.nome || '';

async function lerJSON(caminho, padrao) {
  const t = await Armaz.ler(caminho);
  if (t === null || t === '') return padrao;
  try { return JSON.parse(t); } catch { throw new Error(`O arquivo ${caminho} está corrompido.`); }
}

async function carregarColecao(col) {
  const nomes = await Armaz.listar(col);
  const mapa = {};
  // No máximo 8 leituras ao mesmo tempo (no Dropbox, só baixa o que mudou desde a última leitura)
  const fila = [...nomes];
  await Promise.all(Array.from({ length: Math.min(8, fila.length) }, async () => {
    while (fila.length) {
      const n = fila.shift();
      try {
        const reg = JSON.parse(await Armaz.ler(`${col}/${n}`));
        if (reg?.id) mapa[reg.id] = reg;
      } catch (e) { console.warn('Arquivo ignorado', col, n, e); }
    }
  }));
  return mapa;
}

async function recarregarTudo() {
  Armaz.conflitos = [];
  const [config, indices, credores, calculos] = await Promise.all([
    lerJSON('config.json', null), lerJSON('indices.json', { series: {} }), carregarColecao('credores'), carregarColecao('calculos'),
  ]);
  D.config = normalizarConfig(config);
  D.indices = indices;
  D.credores = credores;
  D.calculos = calculos;
  D.carregadoEm = Date.now();
  atualizarSugestoes();
}

// Grava o registro conferindo se ninguém o alterou desde que foi lido
async function salvarRegistro(col, reg) {
  const caminho = `${col}/${reg.id}.json`;
  const noDisco = JSON.parse(await Armaz.ler(caminho) || 'null');
  if (noDisco && (noDisco.rev || 0) !== (reg.rev || 0)) {
    throw new ErroConflito(`Este registro foi alterado${noDisco.alteradoPor ? ' por ' + noDisco.alteradoPor : ''}${noDisco.alteradoEm ? ' em ' + new Date(noDisco.alteradoEm).toLocaleString('pt-BR') : ''} enquanto você editava. Os dados foram recarregados: confira e refaça a alteração.`);
  }
  const novo = { ...reg, rev: (reg.rev || 0) + 1, alteradoEm: new Date().toISOString(), alteradoPor: usuarioLocal() };
  if (!novo.criadoEm) { novo.criadoEm = novo.alteradoEm; novo.criadoPor = novo.alteradoPor; }
  await Armaz.gravar(caminho, JSON.stringify(novo, null, 1));
  D[col][novo.id] = novo;
  return novo;
}

async function excluirRegistro(col, id) {
  await Armaz.paraLixeira(`${col}/${id}.json`);
  delete D[col][id];
}

async function salvarConfig(c) {
  await Armaz.gravar('config.json', JSON.stringify(c, null, 1));
  D.config = normalizarConfig(c);
  atualizarSugestoes();
}

// Critérios do credor (em branco, os das Configurações)
const critCredor = id => {
  const p = D.credores[id]?.padroes || {};
  return { ...(p.crit || critDeRegimes(p.regimes) || D.config.padroes.crit) };
};
const honContrCredor = id => { const v = D.credores[id]?.padroes?.honContr; return vazio(v) ? D.config.padroes.honContr : v; };

function novoCalculo(credorId) {
  return { id: novoId(), credorId: credorId || '', titulo: '', tipo: 'judicial', situacao: 'ativo', processo: '', juizo: '', obs: '',
    devedores: [{ nome: '', documento: '', endereco: '' }], valorCausa: { valor: 0, data: '' },
    rubricas: [], custas: [], honorarios: [], multas: [], amortizacoes: [], honContr: honContrCredor(credorId),
    art523: { aplicar: false, incluirMulta: true, multa: 10, incluirHonorarios: true, honorarios: 10, baseHonorarios: true, baseCustas: false, baseMultas: true } };
}

/* ================= Navegação ================= */
let sujo = false, ignorarHash = false, hashAnterior = location.hash;

window.addEventListener('hashchange', () => {
  if (ignorarHash) { ignorarHash = false; return; }
  if (sujo && !confirm('Há alterações não salvas. Sair sem salvar?')) { ignorarHash = true; location.hash = hashAnterior; return; }
  sujo = false;
  hashAnterior = location.hash;
  rotear();
});
window.addEventListener('beforeunload', e => { if (sujo) { e.preventDefault(); e.returnValue = ''; } });

function marcarSujo() {
  sujo = true;
  const e = $('#estadoSalvar');
  if (e) e.textContent = 'Alterações não salvas';
}

function destacarMenu(rota) {
  $$('#menu a[data-rota]').forEach(a => a.classList.toggle('ativo', rota.startsWith(a.dataset.rota)));
  document.body.classList.remove('menu-aberto');
}

async function rotear() {
  const h = location.hash.replace(/^#\/?/, '') || 'inicio';
  const [rota, arg] = h.split('/');
  // Sobre, termos e privacidade abrem também antes de entrar
  if (rota === 'sobre') { destacarMenu(rota); window.scrollTo(0, 0); return telaSobre(arg); }
  if (rota === 'manual') { destacarMenu(rota); window.scrollTo(0, 0); return telaManual(); }
  if (!Armaz.modo) return telaConexao();
  if (!document.body.classList.contains('conectado')) return executar(conectado);
  const params = new URLSearchParams(h.split('?')[1] || '');
  destacarMenu(rota);
  window.scrollTo(0, 0);
  const tela = {
    inicio: telaInicio, credores: telaCredores, credor: () => telaCredor(arg?.split('?')[0]),
    calculo: () => telaCalculo(arg?.split('?')[0], params),
    acordos: telaAcordos, acordo: () => telaAcordo(...h.split('?')[0].split('/').slice(1, 3)),
    config: () => Auth.ehAdmin() ? telaConfig() : telaConta(), conta: telaConta,
    usuarios: () => Auth.ehAdmin() ? telaUsuarios() : telaConta(),
  }[rota] || telaInicio;
  await executar(tela);
}

const cabecalho = (titulo, sub = '', acoes = '', voltar = '') => `<div class="cab-pagina"><div>${voltar ? `<a class="voltar" href="${voltar}">&larr; Voltar</a>` : ''}<h1>${esc(titulo)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="acoes">${acoes}</div></div>`;
const optCredores = sel => Object.values(D.credores).sort((a, b) => comparar(a.nome, b.nome))
  .map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
const chipTipo = c => c.tipo === 'judicial' ? '<span class="chip pendente">Judicial</span>' : '<span class="chip aberto">Extrajudicial</span>';
const chipSit = c => (c.situacao || 'ativo') === 'ativo' ? '' : ' <span class="chip neutro">Encerrado</span>';
const ordemCalculo = (a, b) => comparar(nomeCredor(a), nomeCredor(b)) || comparar(devedoresCurto(a), devedoresCurto(b));

/* ================= Início ================= */
async function telaInicio() {
  garantirIndices();
  const data = hoje();
  const lista = Object.values(D.calculos).sort(ordemCalculo);
  const st = { busca: localStorage.getItem('ccb-busca') || '', cred: '', tipo: 'todos', sit: 'ativo' };
  const tot = {};
  const totalDe = c => (tot[c.id] = tot[c.id] ?? calcular(c, data).total);
  const filtrar = () => lista.filter(c => (!st.cred || credoresDoCalculo(c).includes(st.cred)) && (st.tipo === 'todos' || c.tipo === st.tipo)
    && (st.sit === 'todos' || (c.situacao || 'ativo') === st.sit)
    && (!st.busca || normalizar([nomeCredor(c), c.titulo, devedoresCurto(c), c.processo, ...(c.devedores || []).map(d => soDigitos(d.documento))].join(' ')).includes(normalizar(st.busca))));
  const ativos = lista.filter(c => (c.situacao || 'ativo') === 'ativo');
  const kpi = (r, v, s = '') => `<div class="kpi"><span>${r}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
  $('#conteudo').innerHTML = cabecalho('Cálculos', `Valores atualizados até hoje (${fmtData(data)}) com os critérios de cada cálculo.`,
    `<a class="bt primario" href="#/calculo/novo">Novo cálculo</a>`) +
    (Armaz.conflitos.length ? `<p class="alerta">O Dropbox criou cópias com conflito (duas pessoas alteraram o mesmo arquivo ao mesmo tempo). Elas não são lidas pelo programa. Confira e apague na pasta dos dados: ${Armaz.conflitos.map(esc).join(', ')}</p>` : '') +
    (!Object.keys(D.credores).length ? `<div class="cartao destaque"><h2>Primeiros passos</h2><ol>
      <li>Preencha os dados do escritório e os critérios padrão em <a href="#/config">Configurações</a>.</li>
      <li>Cadastre o credor (cliente) em <a href="#/credor/novo">Credores</a>.</li>
      <li>Crie o cálculo e lance as rubricas, custas, honorários, multas e amortizações.</li></ol></div>` : '') +
    `<div class="kpis">${kpi('Cálculos ativos', ativos.length, `${ativos.filter(c => c.tipo === 'judicial').length} judiciais · ${ativos.filter(c => c.tipo !== 'judicial').length} extrajudiciais`)}
      ${kpi('Total atualizado (ativos)', fmtMoeda(ativos.reduce((s, c) => s + cent(totalDe(c)), 0) / 100))}${kpi('Credores', Object.keys(D.credores).length)}</div>
    <div class="cartao"><div class="barra-filtros">
      <input type="search" id="fBusca" placeholder="Buscar credor, devedor, CPF, processo…" value="${esc(st.busca)}">
      <select id="fCred"><option value="">Todos os credores</option>${optCredores(st.cred)}</select>
      <select id="fTipo"><option value="todos">Judiciais e extrajudiciais</option><option value="judicial">Judiciais</option><option value="extrajudicial">Extrajudiciais</option></select>
      <select id="fSit"><option value="ativo">Ativos</option><option value="encerrado">Encerrados</option><option value="todos">Todos</option></select>
    </div><div id="lista"></div></div>`;
  const desenhar = () => {
    const l = filtrar();
    $('#lista').innerHTML = l.length ? `<div class="rolagem"><table class="tabela clicavel"><thead><tr><th>Credor</th><th>Devedor(es)</th><th>Cálculo</th><th class="num">Total atualizado</th></tr></thead><tbody>
      ${l.map(c => `<tr data-id="${c.id}"><td>${esc(nomeCredor(c))}</td><td>${esc(devedoresCurto(c))}${c.titulo ? `<div class="dica">${esc(c.titulo)}</div>` : ''}</td>
        <td>${chipTipo(c)}${chipSit(c)}${c.processo ? `<div class="dica">${esc(c.processo)}</div>` : ''}</td><td class="num">${fmtNum(totalDe(c))}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="vazio">Nenhum cálculo encontrado.</p>';
    $$('#lista tr[data-id]').forEach(tr => tr.addEventListener('click', () => { location.hash = '#/calculo/' + tr.dataset.id; }));
  };
  $('#fBusca').addEventListener('input', e => { st.busca = e.target.value; localStorage.setItem('ccb-busca', st.busca); desenhar(); });
  $('#fCred').addEventListener('change', e => { st.cred = e.target.value; desenhar(); });
  $('#fTipo').addEventListener('change', e => { st.tipo = e.target.value; desenhar(); });
  $('#fSit').addEventListener('change', e => { st.sit = e.target.value; desenhar(); });
  desenhar();
}

/* ================= Critérios de correção e juros (uma linha por verba) ================= */
// O valor "mensalcap" do campo de juros representa juros ao mês capitalizados
const OPCOES_JUROS = { mensal: '% ao mês (simples)', mensalcap: '% ao mês (capitalizados)', legal: 'Taxa legal (art. 406 CC)', selic: 'SELIC (correção + juros)', nenhum: 'Sem juros' };
const valorJuros = k => k.juros === 'mensal' && k.capitalizar ? 'mensalcap' : k.juros || 'nenhum';
const TITULO_LEI = 'A partir de 30/08/2024 (Lei 14.905/2024): correção pelo IPCA e juros pela taxa legal';
const CAB_CRIT = `<th>Índice de correção</th><th>Juros</th><th class="num">Taxa % a.m.</th><th class="cen" title="${TITULO_LEI}">Lei 14.905</th>`;

function critCelulas(k) {
  const selic = k.juros === 'selic';
  return `<td><select data-cr="indice" ${selic ? 'disabled' : ''}>${INDICES.map(x => `<option ${(selic ? 'Nenhum' : k.indice) === x ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
    <td><select data-cr="juros">${Object.entries(OPCOES_JUROS).map(([v, t]) => `<option value="${v}" ${valorJuros(k) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
    <td><input data-cr="taxa" class="num" inputmode="decimal" value="${k.juros === 'mensal' ? esc(fmtPct(k.taxa ?? 1)) : ''}" ${k.juros === 'mensal' ? '' : 'disabled'}></td>
    <td class="cen"><input type="checkbox" data-cr="lei14905" title="${TITULO_LEI}" ${k.lei14905 ? 'checked' : ''}></td>`;
}

// Os mesmos campos em formulário (credor, configurações, janelas)
function critFormulario(k) {
  const selic = k.juros === 'selic';
  return `<div class="grade-form">
    <div class="campo"><label>Índice de correção</label><select data-cr="indice" ${selic ? 'disabled' : ''}>${INDICES.map(x => `<option ${(selic ? 'Nenhum' : k.indice) === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
    <div class="campo"><label>Juros de mora</label><select data-cr="juros">${Object.entries(OPCOES_JUROS).map(([v, t]) => `<option value="${v}" ${valorJuros(k) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="campo"><label>Taxa (% ao mês)</label><input data-cr="taxa" inputmode="decimal" value="${k.juros === 'mensal' ? esc(fmtPct(k.taxa ?? 1)) : ''}" ${k.juros === 'mensal' ? '' : 'disabled'}></div>
    <div class="campo"><label class="inline" style="margin-top:22px;white-space:normal"><input type="checkbox" data-cr="lei14905" ${k.lei14905 ? 'checked' : ''}> Lei 14.905/2024</label>
      <small>${TITULO_LEI}.</small></div></div>`;
}

// Liga os campos [data-cr] de "raiz" ao objeto de critérios k
function ligarCrit(raiz, k, aoMudar) {
  $$('[data-cr]', raiz).forEach(el => el.addEventListener('change', () => {
    const f = el.dataset.cr;
    if (f === 'juros') {
      k.juros = el.value === 'mensalcap' ? 'mensal' : el.value;
      k.capitalizar = el.value === 'mensalcap';
      if (k.juros === 'mensal' && vazio(k.taxa)) k.taxa = 1;
      const taxa = $('[data-cr=taxa]', raiz), ind = $('[data-cr=indice]', raiz);
      taxa.disabled = k.juros !== 'mensal';
      taxa.value = k.juros === 'mensal' ? fmtPct(k.taxa) : '';
      ind.disabled = k.juros === 'selic';
      if (k.juros === 'selic') ind.value = 'Nenhum';
    } else if (f === 'taxa') k.taxa = parseValor(el.value);
    else if (f === 'lei14905') k.lei14905 = el.checked;
    else k[f] = el.value;
    aoMudar();
  }));
}

/* ================= Credores ================= */
function telaCredores() {
  const lista = Object.values(D.credores).sort((a, b) => comparar(a.nome, b.nome));
  const qtd = id => Object.values(D.calculos).filter(c => credoresDoCalculo(c).includes(id) && (c.situacao || 'ativo') === 'ativo').length;
  $('#conteudo').innerHTML = cabecalho('Credores (clientes)', '', '<a class="bt primario" href="#/credor/novo">Novo credor</a>') +
    `<div class="cartao">${lista.length ? `<div class="rolagem"><table class="tabela clicavel"><thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>Endereço</th><th class="num">Cálculos ativos</th></tr></thead><tbody>
      ${lista.map(c => `<tr data-id="${c.id}"><td>${esc(c.nome)}</td><td>${esc(fmtDoc(c.documento))}</td><td>${esc(c.endereco)}</td><td class="num">${qtd(c.id)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="vazio">Nenhum credor cadastrado.</p>'}</div>`;
  $$('tr[data-id]').forEach(tr => tr.addEventListener('click', () => { location.hash = '#/credor/' + tr.dataset.id; }));
}

function telaCredor(id) {
  const novo = !id || id === 'novo';
  const c = novo ? { id: novoId(), nome: '', documento: '', endereco: '', contato: '', obs: '', padroes: {} } : structuredClone(D.credores[id]);
  if (!c) throw new Error('Credor não encontrado.');
  c.padroes = c.padroes || {};
  const calcs = novo ? [] : Object.values(D.calculos).filter(x => credoresDoCalculo(x).includes(id)).sort(ordemCalculo);
  const proprio = c.padroes.crit || critDeRegimes(c.padroes.regimes);
  const crit = { ...(proprio || critPadrao()) };
  const data = hoje();
  $('#conteudo').innerHTML = cabecalho(novo ? 'Novo credor' : c.nome, novo ? '' : esc(fmtDoc(c.documento)), '', '#/credores') + `
    <form class="cartao" id="fCred" autocomplete="off">
      <h2>Dados do credor</h2>
      <div class="grade-form">
        <div class="campo w2"><label>Nome / razão social *</label><input name="nome" required value="${esc(c.nome)}"></div>
        <div class="campo"><label>CPF / CNPJ</label><input name="documento" value="${esc(fmtDoc(c.documento))}"></div>
        <div class="campo"><label>Contato</label><input name="contato" value="${esc(c.contato || '')}"></div>
        <div class="campo wfull"><label>Endereço</label><input name="endereco" value="${esc(c.endereco)}"></div>
        <div class="campo wfull"><label>Observações</label><textarea name="obs" rows="2">${esc(c.obs)}</textarea></div>
      </div>
      <h3 class="sec" style="margin-top:16px">Critérios sugeridos para as novas verbas deste credor</h3>
      <label class="inline"><input type="checkbox" id="credProprios" ${proprio ? 'checked' : ''}> Usar critérios próprios deste credor (desmarcado: os das Configurações)</label>
      <div id="credCrit" ${proprio ? '' : 'hidden'}>${critFormulario(crit)}</div>
      <div class="grade-form" style="margin-top:10px"><div class="campo"><label>Honorários contratuais (%), cobranças extrajudiciais</label>
        <input name="honContr" inputmode="decimal" value="${vazio(c.padroes.honContr) ? '' : esc(fmtPct(c.padroes.honContr))}" placeholder="${esc(fmtPct(D.config.padroes.honContr))} (padrão)"></div></div>
      <div class="barra-form"><button class="bt primario">Salvar</button>${novo || !Auth.ehAdmin() ? '' : '<button type="button" class="bt perigo" id="btExcluir">Excluir</button>'}</div>
    </form>
    ${novo ? '' : `<div class="cartao"><div class="cartao-cab"><h2>Cálculos (${calcs.length})</h2><div class="acoes">
      <a class="bt primario" href="#/calculo/novo?credor=${c.id}">Novo cálculo</a></div></div>
      ${calcs.length ? `<div class="rolagem"><table class="tabela clicavel"><thead><tr><th>Devedor(es)</th><th>Cálculo</th><th class="num">Total atualizado</th></tr></thead><tbody>
        ${calcs.map(x => `<tr data-id="${x.id}"><td>${esc(devedoresCurto(x))}${x.titulo ? `<div class="dica">${esc(x.titulo)}</div>` : ''}</td><td>${chipTipo(x)}${chipSit(x)}${x.processo ? `<div class="dica">${esc(x.processo)}</div>` : ''}</td><td class="num">${fmtNum(calcular(x, data).total)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="vazio">Nenhum cálculo.</p>'}</div>`}`;
  ligarCrit($('#credCrit'), crit, marcarSujo);
  $('#credProprios').addEventListener('change', e => { $('#credCrit').hidden = !e.target.checked; marcarSujo(); });
  $('#fCred').addEventListener('input', marcarSujo);
  $('#fCred').addEventListener('submit', e => { e.preventDefault(); executar(async () => {
    const f = new FormData(e.target);
    for (const k of ['nome', 'documento', 'endereco', 'obs', 'contato']) c[k] = String(f.get(k) || '').trim();
    if (!c.nome) throw new Error('Informe o nome do credor.');
    const hc = String(f.get('honContr') || '').trim();
    c.padroes = { crit: $('#credProprios').checked ? crit : null, honContr: hc === '' ? '' : parseValor(hc) };
    await salvarRegistro('credores', c);
    sujo = false;
    aviso('Credor salvo.');
    if (novo) location.hash = '#/credor/' + c.id; else rotear();
  }); });
  $('#btExcluir')?.addEventListener('click', () => executar(async () => {
    if (calcs.length) throw new Error('Este credor tem cálculos. Exclua ou transfira os cálculos antes.');
    if (!confirm(`Excluir o credor "${c.nome}"? O arquivo vai para a pasta "lixeira".`)) return;
    await excluirRegistro('credores', c.id);
    sujo = false;
    location.hash = '#/credores';
  }));
  $$('tr[data-id]').forEach(tr => tr.addEventListener('click', () => { location.hash = '#/calculo/' + tr.dataset.id; }));
}

/* ================= Cálculo ================= */
const campo = (rot, html, cls = '', dica = '') => `<div class="campo ${cls}"><label>${rot}</label>${html}${dica ? `<small>${dica}</small>` : ''}</div>`;
const inpData = (k, v) => `<input type="date" data-f="${k}" value="${esc(v || '')}">`;
const inpValor = (k, v) => `<input data-f="${k}" inputmode="decimal" class="num" value="${v ? esc(fmtNum(v)) : ''}">`;
const inpPct = (k, v) => `<input data-f="${k}" inputmode="decimal" value="${vazio(v) ? '' : esc(fmtPct(v))}">`;

// Lê os campos [data-f] de um formulário para o objeto (valores "num" e "pct" convertidos)
function lerCampos(raiz, obj) {
  $$('[data-f]', raiz).forEach(el => {
    const k = el.dataset.f;
    if (el.type === 'checkbox') obj[k] = el.checked;
    else if (el.inputMode === 'decimal') obj[k] = parseValor(el.value);
    else obj[k] = el.value.trim();
  });
  return obj;
}

// Cálculos de versões anteriores: critérios gerais ou por períodos passam para cada verba, numa linha
function migrarCalculo(c) {
  const geral = critDeRegimes(c.regimes) || critPadrao();
  const de = it => it.crit || critDeRegimes(it.regimes) || { ...geral };
  for (const it of c.rubricas) { it.crit = de(it); delete it.regimes; }
  for (const it of c.custas) {
    if (!it.crit) it.crit = it.corrigir === false ? { ...geral, indice: 'Nenhum', juros: geral.juros === 'selic' ? 'mensal' : geral.juros } : de(it);
    it.corrDesde = it.corrDesde || it.data || '';
    delete it.corrigir; delete it.data;
  }
  for (const it of [...c.multas, ...c.honorarios]) { it.crit = de(it); delete it.regimes; }
  for (const h of c.honorarios) {
    h.outras = h.outras || [];
    if (h.rubricas?.length) { h.fora = c.rubricas.filter(r => !h.rubricas.includes(r.id)).map(r => r.id); h.rubricas = []; }
    h.fora = h.fora || [];
  }
  c.series = c.series || [];
  delete c.regimes;
  if (c.art523) { delete c.art523.data; delete c.art523.base; delete c.art523.indice; }
}

// Janela de edição de um item (multa processual); "comCrit" mostra os critérios de correção e juros
function janelaItem(titulo, corpo, it, { comCrit, aoSalvar, aoMostrar }) {
  const crit = { ...(it.crit || critPadrao()) };
  abrirModal(`<div class="modal-cab"><h2>${esc(titulo)}</h2><button class="bt-x" data-fechar>&times;</button></div>
    <form id="fItem" class="form-modal" autocomplete="off">${corpo}
      ${comCrit ? `<h3 class="sec" style="margin-top:14px">Critérios de correção e juros</h3><div id="itCrit">${critFormulario(crit)}</div>` : ''}
      <div class="barra-form"><button class="bt primario">Aplicar</button><button type="button" class="bt" data-fechar>Cancelar</button></div></form>`, 'modal-item');
  if (comCrit) ligarCrit($('#itCrit'), crit, () => {});
  aoMostrar?.();
  $('#fItem').addEventListener('submit', e => { e.preventDefault(); executar(() => {
    lerCampos($('#fItem'), it);
    if (comCrit) it.crit = crit;
    aoSalvar(it);
    fecharModal();
  }); });
}

function telaCalculo(id, params) {
  const novo = !id || id === 'novo';
  const original = novo ? null : D.calculos[id];
  if (!novo && !original) throw new Error('Cálculo não encontrado.');
  if (!Object.keys(D.credores).length) {
    $('#conteudo').innerHTML = cabecalho('Novo cálculo', '', '', '#/inicio') + '<div class="cartao"><p>Cadastre antes o credor (cliente).</p><a class="bt primario" href="#/credor/novo">Novo credor</a></div>';
    return;
  }
  const c = novo ? novoCalculo(params.get('credor') || '') : structuredClone(original);
  for (const k of ['rubricas', 'custas', 'honorarios', 'multas', 'amortizacoes']) c[k] = c[k] || [];
  c.devedores = c.devedores?.length ? c.devedores : [{ nome: '', documento: '', endereco: '' }];
  c.valorCausa = c.valorCausa || { valor: 0, data: '' };
  c.outrosCredores = c.outrosCredores || [];
  c.art523 = c.art523 || novoCalculo().art523;
  migrarCalculo(c);
  garantirIndices().then(() => { if (document.body.contains($('#calcResumo'))) recalcular(); });
  // Critérios sugeridos para uma nova linha: os da última linha da lista, ou os do credor
  const critNovo = lista => ({ ...(lista[lista.length - 1]?.crit || critCredor(c.credorId)) });

  $('#conteudo').innerHTML = cabecalho(novo ? 'Novo cálculo' : `${devedoresCurto(c)} - ${nomeCredor(c)}`,
    novo ? '' : `${chipTipo(c)}${chipSit(c)} <span class="dica">${c.alteradoPor ? 'Alterado por ' + esc(c.alteradoPor) + ' em ' : 'Alterado em '}${new Date(c.alteradoEm).toLocaleString('pt-BR')}</span>`, '', '#/inicio') + `
  <div class="cartao"><h2>Dados do cálculo</h2>
    <div class="grade-form" id="dados">
      <div class="campo wfull"><label>Credor(es) *</label><div id="credoresCalc"></div>
        <div><button type="button" class="bt pequeno" id="btAddCred">+ Adicionar credor</button></div>
        <small>O primeiro é o credor principal: dele vêm os critérios sugeridos para as novas verbas e os honorários contratuais. Para cadastrar um credor novo, use "Credores (clientes)".</small></div>
      ${campo('Descrição (opcional)', `<input data-c="titulo" value="${esc(c.titulo || '')}" placeholder="Ex.: Indenização por danos morais e materiais">`, 'w2')}
      <div class="campo w2"><label>Tipo</label><div class="segmentado">
        <label><input type="radio" name="tipo" value="judicial" ${c.tipo === 'judicial' ? 'checked' : ''}> Judicial</label>
        <label><input type="radio" name="tipo" value="extrajudicial" ${c.tipo !== 'judicial' ? 'checked' : ''}> Extrajudicial</label></div></div>
      ${campo('Situação', `<select data-c="situacao"><option value="ativo">Ativo</option><option value="encerrado" ${c.situacao === 'encerrado' ? 'selected' : ''}>Encerrado</option></select>`)}
      ${campo('Processo nº', `<input data-c="processo" value="${esc(c.processo)}">`, 'so-judicial')}
      ${campo('Juízo / vara', `<input data-c="juizo" value="${esc(c.juizo)}">`, 'w2 so-judicial')}
      ${campo('Valor da causa (R$)', `<input id="causaValor" inputmode="decimal" class="num" value="${c.valorCausa.valor ? esc(fmtNum(c.valorCausa.valor)) : ''}">`, 'so-judicial', 'Base dos honorários e das multas sobre o valor da causa.')}
      ${campo('Data do ajuizamento', `<input type="date" id="causaData" value="${esc(c.valorCausa.data || '')}">`, 'so-judicial', 'Termo inicial da correção do valor da causa.')}
      ${campo('Observações internas (não saem na planilha)', `<textarea data-c="obs" rows="2">${esc(c.obs)}</textarea>`, 'wfull')}
    </div></div>

  <div class="cartao"><div class="cartao-cab"><h2>Devedores</h2><button class="bt pequeno" id="btAddDev">+ Adicionar devedor</button></div><div id="devedores"></div></div>

  <div class="cartao"><div class="cartao-cab"><h2>Verbas (condenação / débito)</h2><div class="acoes"><button class="bt pequeno" id="btAddRub">+ Adicionar verba</button><button class="bt pequeno" id="btSeq">Lançar meses em sequência</button><button class="bt pequeno" id="btImpSeries">Importar planilha</button></div></div>
    <p class="dica">Uma linha por verba, com os próprios termos iniciais e critérios. Ex.: danos morais com correção desde o arbitramento (Súmula 362 do STJ) e juros desde o evento danoso (Súmula 54 do STJ); danos materiais com correção desde o efetivo prejuízo (Súmula 43 do STJ). Juros desde em branco: sem juros.
      <b>Lei 14.905</b>: a partir de 30/08/2024, correção pelo IPCA e juros pela taxa legal. <a href="#" id="sugVerbas">Editar as sugestões de descrição</a></p>
    <div class="rolagem"><table class="tabela tabela-edit tabela-verbas"><thead><tr><th>Verba</th><th class="num">Valor (R$)</th><th>Correção desde</th><th>Juros desde</th>${CAB_CRIT}<th class="num">Multa %</th><th></th></tr></thead><tbody id="rubricas"></tbody></table></div>
    <div id="series"></div>
    <p class="dica">Prestações mensais (aluguel, cota condominial, IPTU, alimentos, honorários de partido…): use "Lançar meses em sequência" ou "Importar planilha". Cada rubrica forma uma série, e o mesmo mês pode ter várias séries.</p></div>

  <div class="cartao"><div class="cartao-cab"><h2>Custas e despesas</h2><button class="bt pequeno" id="btAddCus">+ Adicionar</button></div>
    <p class="dica">Uma linha por despesa: correção em geral desde o desembolso; juros só se indicar o termo inicial. Para não corrigir, escolha o índice "Nenhum".
      "Id. no processo" (opcional) indica onde está o comprovante nos autos e sai na planilha. <a href="#" id="sugCustas">Editar as sugestões de descrição</a></p>
    <div class="rolagem"><table class="tabela tabela-edit tabela-verbas"><thead><tr><th>Descrição</th><th class="num">Valor (R$)</th><th>Correção desde</th><th>Juros desde</th>${CAB_CRIT}<th>Id. no processo</th><th></th></tr></thead><tbody id="custas"></tbody></table></div></div>

  <div class="cartao so-judicial"><div class="cartao-cab"><h2>Honorários advocatícios sucumbenciais</h2><button class="bt pequeno" id="btAddHon">+ Adicionar</button></div>
    <p class="dica">Sobre a condenação: marque as verbas da base (os honorários acompanham a correção e os juros de cada uma) e, se houver, inclua outras bases, como o valor líquido de uma obrigação de fazer. Valor fixo ou sobre o valor da causa: juros desde o trânsito em julgado (art. 85, § 16, do CPC).</p>
    <div id="honorarios"></div></div>

  <div class="cartao so-judicial"><div class="cartao-cab"><h2>Multas processuais</h2><button class="bt pequeno" id="btAddMul">+ Adicionar</button></div>
    <p class="dica">Litigância de má-fé, embargos protelatórios, agravo interno, ato atentatório e astreintes: valor fixo, percentual do valor corrigido da causa ou multa diária.</p>
    <div id="multas"></div></div>

  <div class="cartao so-judicial" id="sec523"><h2>Multa e honorários do art. 523, § 1º, do CPC</h2>
    <label class="inline"><input type="checkbox" data-a="aplicar" ${c.art523.aplicar ? 'checked' : ''}> Incluir (débito não pago no prazo de 15 dias do cumprimento de sentença)</label>
    <div class="grade-form a523" style="margin-top:8px">
      <div class="campo"><label class="inline"><input type="checkbox" data-a="incluirMulta" ${c.art523.incluirMulta !== false ? 'checked' : ''}> Multa (%)</label>
        <input data-a="multa" inputmode="decimal" value="${esc(fmtPct(c.art523.multa))}"></div>
      <div class="campo"><label class="inline"><input type="checkbox" data-a="incluirHonorarios" ${c.art523.incluirHonorarios !== false ? 'checked' : ''}> Honorários (%)</label>
        <input data-a="honorarios" inputmode="decimal" value="${esc(fmtPct(c.art523.honorarios))}"></div>
      <div class="campo wfull"><label>A base de cálculo inclui, além das verbas:</label><div class="opcoes-linha">
        <label class="inline"><input type="checkbox" data-a="baseHonorarios" ${c.art523.baseHonorarios ? 'checked' : ''}> Honorários sucumbenciais da fase de conhecimento</label>
        <label class="inline"><input type="checkbox" data-a="baseCustas" ${c.art523.baseCustas ? 'checked' : ''}> Custas e despesas</label>
        <label class="inline"><input type="checkbox" data-a="baseMultas" ${c.art523.baseMultas ? 'checked' : ''}> Multas processuais</label></div></div>
    </div>
    <p class="dica a523">Calculados sobre o débito atualizado até a data do cálculo. Pagamento parcial feito no prazo: marque "No prazo do art. 523" na amortização, para reduzir a base (§ 2º). Desmarque a multa ou os honorários para incluir só um deles.</p></div>

  <div class="cartao so-extra"><h2>Honorários contratuais</h2>
    <div class="grade-form">${campo('Percentual sobre o débito atualizado (%)', `<input id="honContr" inputmode="decimal" value="${vazio(c.honContr) ? '' : esc(fmtPct(c.honContr))}">`)}</div></div>

  <div class="cartao"><div class="cartao-cab"><h2>Amortizações (pagamentos parciais)</h2><button class="bt pequeno" id="btAddAmo">+ Adicionar pagamento</button></div>
    <p class="dica">O débito é atualizado até a data de cada pagamento e o valor é abatido conforme a imputação escolhida. "Juros primeiro" segue o art. 354 do CC (juros e multa vencidos, depois o principal).
      Em "Abater de", escolha onde o pagamento recai: por exemplo, "Custas e despesas primeiro; depois as demais verbas". Se o item ou grupo escolhido for quitado, o que sobrar vai para os demais itens, dos mais antigos para os mais novos.</p>
    <div class="rolagem"><table class="tabela tabela-edit"><thead><tr><th>Data</th><th class="num">Valor pago</th><th>Imputação</th><th>Abater de</th><th class="cen col-prazo">No prazo do art. 523</th><th>Descrição</th><th></th></tr></thead><tbody id="amortizacoes"></tbody></table></div></div>

  <div class="cartao destaque"><div class="cartao-cab"><h2>Cálculo</h2><label class="inline">Atualizar até <input type="date" id="calcData" value="${hoje()}"></label></div>
    <div class="colunas2"><div id="calcResumo" class="resumo"></div><div id="calcAvisos"></div></div>
    <details class="detalhes"><summary>Ver o cálculo de cada item</summary><div id="calcDet"></div></details>
    <div class="acoes-linha"><label class="inline ordem-verbas">Prestações mensais <select id="ordemVerbas" style="width:auto"><option value="mes">por mês</option><option value="rubrica">por rubrica</option></select></label><button class="bt" id="expVer">Visualizar PDF</button><button class="bt" id="expPdf">Salvar PDF</button><button class="bt" id="expXlsx">Salvar Excel</button></div>
  </div>

  <div class="cartao"><div class="cartao-cab"><h2>Simulações de acordo</h2><button class="bt pequeno" id="btAcordo">Simular acordo</button></div>
    ${(original?.acordos || []).length ? `<div class="rolagem"><table class="tabela clicavel"><thead><tr><th>Data</th><th>Simulação</th><th class="num">Com desconto</th><th>Parcelamento</th></tr></thead><tbody>
      ${original.acordos.map(a => { let ra = null; try { ra = calcularAcordo(original, a); } catch { /* cálculo incompleto */ }
        return `<tr data-acordo="${a.id}"><td>${fmtData(a.data)}</td><td>${esc(a.nome || '—')}</td><td class="num">${ra ? fmtNum(ra.comDesconto) : '—'}</td>
          <td>${ra ? (ra.sinal ? `Sinal ${fmtMoeda(ra.sinal)} + ` : '') + (ra.n ? `${ra.n} × ${fmtMoeda(ra.parcela)}` : 'à vista') : ''}</td></tr>`; }).join('')}</tbody></table></div>`
      : '<p class="vazio">Nenhuma simulação. Use "Simular acordo" para calcular desconto, sinal e parcelamento sobre este débito.</p>'}</div>

  <div class="barra-salvar"><span id="estadoSalvar"></span>${novo ? '' : (Auth.ehAdmin() ? '<button class="bt perigo" id="btExcluir">Excluir</button>' : '') + '<button class="bt" id="btDuplicar">Duplicar</button>'}<button class="bt primario" id="btSalvar">Salvar</button></div>`;
  $('#btAcordo').addEventListener('click', () => executar(() => {
    if (novo || sujo) throw new Error('Salve o cálculo antes de simular o acordo.');
    location.hash = `#/acordo/${c.id}/novo`;
  }));
  $$('tr[data-acordo]').forEach(tr => tr.addEventListener('click', () => { location.hash = `#/acordo/${c.id}/${tr.dataset.acordo}`; }));

  const alterado = () => { marcarSujo(); recalcularLogo(); };

  // ---- Dados gerais
  $$('[data-c]').forEach(el => el.addEventListener('input', () => { c[el.dataset.c] = el.value; alterado(); }));

  // ---- Credores (o primeiro é o principal)
  function desenharCredores() {
    const ids = [c.credorId || '', ...(c.outrosCredores || [])];
    $('#credoresCalc').innerHTML = ids.map((id, i) => `<div class="linha-credor" data-i="${i}">
      <select data-cred>${i ? '' : '<option value="">— escolha —</option>'}${optCredores(id)}</select>
      ${i ? '<button type="button" class="bt-x" title="Remover credor">&times;</button>' : '<span class="dica">Principal</span>'}</div>`).join('');
    $$('#credoresCalc .linha-credor').forEach(l => {
      const i = +l.dataset.i;
      $('[data-cred]', l).addEventListener('change', e => {
        if (i === 0) {
          c.credorId = e.target.value;
          if (novo) { c.honContr = honContrCredor(c.credorId); $('#honContr').value = fmtPct(c.honContr); }
        } else c.outrosCredores[i - 1] = e.target.value;
        alterado();
      });
      $('.bt-x', l)?.addEventListener('click', () => { c.outrosCredores.splice(i - 1, 1); desenharCredores(); alterado(); });
    });
  }
  $('#btAddCred').addEventListener('click', () => {
    const usados = new Set([c.credorId, ...c.outrosCredores]);
    const livre = Object.values(D.credores).sort((a, b) => comparar(a.nome, b.nome)).find(x => !usados.has(x.id));
    if (!livre) return aviso('Todos os credores cadastrados já estão no cálculo. Cadastre outro em "Credores (clientes)".', 'erro');
    c.outrosCredores.push(livre.id);
    desenharCredores(); alterado();
  });
  desenharCredores();
  const mostrarTipo = () => {
    $$('.so-judicial').forEach(e => { e.hidden = c.tipo !== 'judicial'; });
    $$('.so-extra').forEach(e => { e.hidden = c.tipo === 'judicial'; });
  };
  $$('input[name=tipo]').forEach(r => r.addEventListener('change', () => { c.tipo = r.value; mostrarTipo(); desenharAmortizacoes(); alterado(); }));
  mostrarTipo();
  $('#causaValor').addEventListener('input', e => { c.valorCausa.valor = r2(parseValor(e.target.value)); alterado(); });
  $('#causaValor').addEventListener('change', e => { e.target.value = c.valorCausa.valor ? fmtNum(c.valorCausa.valor) : ''; });
  $('#causaData').addEventListener('input', e => { c.valorCausa.data = e.target.value; alterado(); });
  $('#honContr').addEventListener('input', e => { c.honContr = parseValor(e.target.value); alterado(); });

  // ---- Devedores
  function desenharDevedores() {
    $('#devedores').innerHTML = `<div class="dev-cab"><span>Nome</span><span>CPF/CNPJ</span><span>Endereço</span><span></span></div>` + c.devedores.map((d, i) => `<div class="dev-linha" data-i="${i}">
      <input data-d="nome" value="${esc(d.nome)}" placeholder="Nome completo"><input data-d="documento" value="${esc(fmtDoc(d.documento))}" placeholder="CPF ou CNPJ">
      <input data-d="endereco" value="${esc(d.endereco || '')}" placeholder="Endereço"><button class="bt-x" title="Remover" ${c.devedores.length < 2 ? 'disabled' : ''}>&times;</button></div>`).join('');
    $$('#devedores .dev-linha').forEach(l => {
      const d = c.devedores[+l.dataset.i];
      $$('[data-d]', l).forEach(inp => inp.addEventListener('input', () => { d[inp.dataset.d] = inp.value.trim(); alterado(); }));
      $('[data-d=documento]', l).addEventListener('change', e => { e.target.value = fmtDoc(e.target.value); });
      $('.bt-x', l).addEventListener('click', () => { c.devedores.splice(+l.dataset.i, 1); desenharDevedores(); alterado(); });
    });
  }
  $('#btAddDev').addEventListener('click', () => { c.devedores.push({ nome: '', documento: '', endereco: '' }); desenharDevedores(); marcarSujo(); });
  desenharDevedores();

  /*
    Linhas editáveis de verbas (rubricas, custas, outras bases dos honorários): descrição, valor, termos iniciais e critérios.
    "extra" acrescenta colunas antes do botão de remover; "aoMudarDesc" é chamado quando a descrição ou o valor mudam.
  */
  function linhasVerbas(tbody, lista, { lista: dl, extra, aoMudarDesc, vazioTxt }) {
    tbody.innerHTML = lista.map((it, i) => `<tr data-i="${i}">
      <td><input data-k="descricao" ${dl ? `list="${dl}"` : ''} value="${esc(it.descricao || '')}"></td>
      <td><input data-k="valor" class="num" inputmode="decimal" value="${it.valor ? fmtNum(it.valor) : ''}"></td>
      <td><input type="date" data-k="corrDesde" value="${esc(it.corrDesde || '')}"></td>
      <td><input type="date" data-k="jurosDesde" value="${esc(it.jurosDesde || '')}"></td>
      ${critCelulas(it.crit)}${extra ? extra.html(it) : ''}
      <td><button class="bt-x" title="Remover">&times;</button></td></tr>`).join('') || `<tr><td colspan="12" class="vazio">${vazioTxt}</td></tr>`;
    $$('tr[data-i]', tbody).forEach(tr => {
      const it = lista[+tr.dataset.i];
      $$('[data-k]', tr).forEach(inp => inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', () => {
        const k = inp.dataset.k;
        it[k] = k === 'valor' || inp.inputMode === 'decimal' ? r2(parseValor(inp.value)) : inp.value;
        alterado();
      }));
      $$('[data-k=valor], [data-k=multa]', tr).forEach(inp => inp.addEventListener('change', e => {
        const k = e.target.dataset.k;
        e.target.value = it[k] ? (k === 'valor' ? fmtNum(it[k]) : fmtPct(it[k])) : '';
      }));
      $('[data-k=descricao]', tr).addEventListener('change', () => aoMudarDesc?.());
      ligarCrit(tr, it.crit, alterado);
      $('.bt-x', tr).addEventListener('click', () => {
        if ((it.descricao || it.valor) && !confirm('Remover esta linha?')) return;
        lista.splice(+tr.dataset.i, 1); desenharTudo(); alterado();
      });
    });
  }

  // ---- Verbas (rubricas)
  const desenharRubricas = () => linhasVerbas($('#rubricas'), c.rubricas, {
    lista: 'dlRubricas', vazioTxt: 'Nenhuma verba lançada.', aoMudarDesc: () => { desenharHonorarios(); desenharAmortizacoes(); },
    extra: { html: it => `<td><input data-k="multa" class="num pct" inputmode="decimal" value="${it.multa ? esc(fmtPct(it.multa)) : ''}" title="Multa contratual (cláusula penal moratória) sobre o valor corrigido"></td>` },
  });
  $('#btAddRub').addEventListener('click', () => {
    c.rubricas.push({ id: novoId(), descricao: '', valor: 0, corrDesde: '', jurosDesde: '', multa: 0, crit: critNovo(c.rubricas) });
    desenharTudo(); marcarSujo();
    $('#rubricas tr:last-child [data-k=descricao]')?.focus();
  });

  // ---- Custas
  const desenharCustas = () => linhasVerbas($('#custas'), c.custas, { lista: 'dlCustas', vazioTxt: 'Nenhuma despesa lançada.', aoMudarDesc: desenharAmortizacoes,
    extra: { html: it => `<td><input data-k="idProc" class="id-proc" value="${esc(it.idProc || '')}" placeholder="Ex.: 123456789" title="Id. do documento no processo eletrônico (comprovante da despesa)"></td>` } });
  $('#sugVerbas').addEventListener('click', e => { e.preventDefault(); executar(() => editarSugestoes('descVerbas', 'Sugestões de descrição das verbas')); });
  $('#sugCustas').addEventListener('click', e => { e.preventDefault(); executar(() => editarSugestoes('descCustas', 'Sugestões de descrição das despesas')); });
  $('#btAddCus').addEventListener('click', () => {
    c.custas.push({ id: novoId(), descricao: '', valor: 0, corrDesde: '', jurosDesde: '', crit: critNovo(c.custas) });
    desenharTudo(); marcarSujo();
    $('#custas tr:last-child [data-k=descricao]')?.focus();
  });

  // ---- Honorários sucumbenciais (um quadro por lançamento)
  const FORMAS_HON = { condenacao: 'Percentual sobre a condenação', causa: 'Percentual sobre o valor da causa', fixo: 'Valor fixo' };
  function desenharHonorarios() {
    const el = $('#honorarios');
    el.innerHTML = c.honorarios.map((h, i) => `<div class="quadro-hon" data-i="${i}">
      <div class="grade-form">
        ${campo('Forma', `<select data-h="forma">${Object.entries(FORMAS_HON).map(([k, v]) => `<option value="${k}" ${h.forma === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`, 'w2')}
        ${h.forma !== 'fixo' ? campo('Percentual (%)', `<input data-h="pct" inputmode="decimal" value="${vazio(h.pct) ? '' : esc(fmtPct(h.pct))}">`) : ''}
        ${h.forma === 'fixo' ? campo('Valor fixado (R$)', `<input data-h="valor" class="num" inputmode="decimal" value="${h.valor ? esc(fmtNum(h.valor)) : ''}">`) + campo('Data da fixação (correção desde)', `<input type="date" data-h="data" value="${esc(h.data || '')}">`) : ''}
        ${h.forma !== 'condenacao' ? campo('Juros desde', `<input type="date" data-h="jurosDesde" value="${esc(h.jurosDesde || '')}">`, '', 'Trânsito em julgado (art. 85, § 16, do CPC). Em branco: sem juros.') : ''}
        ${campo('Descrição na planilha (opcional)', `<input data-h="descricao" value="${esc(h.descricao || '')}" placeholder="${esc(rotuloHonorario({ ...h, descricao: '' }))}">`, 'w2')}
        <div class="campo hon-remover"><button type="button" class="bt pequeno perigo" data-h-remover>Remover</button></div>
      </div>
      ${h.forma === 'condenacao' ? `<div class="campo"><label>Base de cálculo</label>
        <div class="opcoes-linha">${c.rubricas.map(r => `<label class="inline"><input type="checkbox" data-hb="${r.id}" ${(h.fora || []).includes(r.id) ? '' : 'checked'}> ${esc(r.descricao || 'Verba sem nome')}</label>`).join('')
          + c.series.map(s => `<label class="inline"><input type="checkbox" data-hb="serie:${s.id}" ${(h.fora || []).includes('serie:' + s.id) ? '' : 'checked'}> ${esc(s.descricao || 'Série')} (mensal)</label>`).join('') || '<span class="dica">Lance as verbas acima.</span>'}
          <label class="inline"><input type="checkbox" data-h="baseCustas" ${h.baseCustas ? 'checked' : ''}> Custas e despesas</label>
          <label class="inline"><input type="checkbox" data-h="baseMultas" ${h.baseMultas ? 'checked' : ''}> Multas processuais</label></div></div>
        <div class="cartao-cab" style="margin-top:6px"><b>Outras bases</b><button type="button" class="bt pequeno" data-h-outra>+ Outra base</button></div>
        <div class="rolagem"><table class="tabela tabela-edit tabela-verbas"><thead><tr><th>Descrição</th><th class="num">Valor (R$)</th><th>Correção desde</th><th>Juros desde</th>${CAB_CRIT}<th></th></tr></thead><tbody data-h-outras></tbody></table></div>`
      : `<h3 class="sec" style="margin-top:6px">Critérios de correção e juros</h3><div data-h-crit>${critFormulario(h.crit)}</div>`}
    </div>`).join('') || '<p class="vazio">Nenhum honorário lançado.</p>';
    $$('.quadro-hon', el).forEach(q => {
      const h = c.honorarios[+q.dataset.i];
      $$('[data-h]', q).forEach(inp => inp.addEventListener(inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input', () => {
        const k = inp.dataset.h;
        if (inp.type === 'checkbox') h[k] = inp.checked;
        else if (k === 'pct' || k === 'valor') h[k] = parseValor(inp.value);
        else h[k] = inp.value;
        if (k === 'forma') { desenharHonorarios(); desenharAmortizacoes(); }
        alterado();
      }));
      $$('[data-hb]', q).forEach(b => b.addEventListener('change', () => {
        h.fora = $$('[data-hb]', q).filter(b => !b.checked).map(b => b.dataset.hb);
        alterado();
      }));
      $('[data-h-remover]', q).addEventListener('click', () => {
        if (!confirm('Remover estes honorários?')) return;
        c.honorarios.splice(+q.dataset.i, 1); desenharHonorarios(); desenharAmortizacoes(); alterado();
      });
      if (h.forma === 'condenacao') {
        const tb = $('[data-h-outras]', q);
        const redesenhar = () => linhasVerbas(tb, h.outras, { vazioTxt: 'Nenhuma outra base.' });
        redesenhar();
        $('[data-h-outra]', q).addEventListener('click', () => {
          h.outras.push({ id: novoId(), descricao: '', valor: 0, corrDesde: '', jurosDesde: '', crit: critNovo(h.outras.length ? h.outras : c.rubricas) });
          redesenhar(); marcarSujo();
        });
      } else ligarCrit($('[data-h-crit]', q), h.crit, alterado);
    });
  }
  $('#btAddHon').addEventListener('click', () => {
    c.honorarios.push({ id: novoId(), forma: 'condenacao', pct: 10, fora: [], outras: [], baseCustas: false, baseMultas: false, valor: 0, data: '', jurosDesde: '', descricao: '', crit: critNovo(c.rubricas) });
    desenharHonorarios(); desenharAmortizacoes(); alterado();
  });

  // ---- Multas processuais
  const FORMAS_MULTA = { fixo: 'Valor fixo', pctCausa: 'Percentual do valor corrigido da causa', diaria: 'Multa diária (astreintes)' };
  function desenharMultas() {
    const el = $('#multas');
    el.innerHTML = c.multas.length ? `<div class="rolagem"><table class="tabela clicavel"><thead><tr><th>Multa</th><th>Valor</th><th>Correção desde</th><th>Juros desde</th><th>Critérios</th><th></th></tr></thead><tbody>
      ${c.multas.map((it, i) => `<tr data-i="${i}"><td>${esc(it.descricao || TIPOS_MULTA[it.tipo] || '')}</td>
        <td>${it.forma === 'pctCausa' ? fmtPct(it.pct) + '% da causa' : it.forma === 'diaria' ? `${fmtMoeda(it.valorDia)}/dia, ${fmtData(it.inicio)} a ${fmtData(it.fim)}${it.teto ? ` (teto ${fmtMoeda(it.teto)})` : ''}` : fmtMoeda(it.valor)}</td>
        <td>${it.forma === 'pctCausa' ? 'Ajuizamento' : (fmtData(it.corrDesde) || '—')}</td><td>${fmtData(it.jurosDesde) || '—'}</td>
        <td>${esc(descRegimes(regimesDeCrit(it.crit), !!it.jurosDesde))}</td><td><button class="bt-x" title="Remover">&times;</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="vazio">Nenhuma multa lançada.</p>';
    $$('tr[data-i]', el).forEach(tr => {
      tr.addEventListener('click', e => { if (!e.target.closest('.bt-x')) editarMulta(c.multas[+tr.dataset.i]); });
      $('.bt-x', tr).addEventListener('click', () => {
        if (!confirm('Remover esta multa?')) return;
        c.multas.splice(+tr.dataset.i, 1); desenharMultas(); desenharAmortizacoes(); alterado();
      });
    });
  }
  function editarMulta(it) {
    const nova = !it;
    it = it ? structuredClone(it) : { id: novoId(), tipo: 'litigancia', forma: 'pctCausa', pct: 2, valor: 0, valorDia: 0, inicio: '', fim: '', teto: 0, corrDesde: '', jurosDesde: '', descricao: '', crit: critNovo(c.multas.length ? c.multas : c.rubricas) };
    janelaItem(nova ? 'Nova multa processual' : 'Multa processual', `<div class="grade-form">
      ${campo('Tipo', `<select data-f="tipo">${Object.entries(TIPOS_MULTA).map(([k, v]) => `<option value="${k}" ${it.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`, 'w2')}
      ${campo('Forma', `<select data-f="forma">${Object.entries(FORMAS_MULTA).map(([k, v]) => `<option value="${k}" ${it.forma === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`, 'w2')}
      ${campo('Percentual (%)', inpPct('pct', it.pct), 'mu-pct', 'Sobre o valor da causa, corrigido desde o ajuizamento.')}
      ${campo('Valor (R$)', inpValor('valor', it.valor), 'mu-fixo')}
      ${campo('Valor por dia (R$)', inpValor('valorDia', it.valorDia), 'mu-dia')}
      ${campo('Primeiro dia', inpData('inicio', it.inicio), 'mu-dia')}
      ${campo('Último dia', inpData('fim', it.fim), 'mu-dia')}
      ${campo('Teto (R$)', inpValor('teto', it.teto), 'mu-dia', 'Em branco: sem limite.')}
      ${campo('Correção desde', inpData('corrDesde', it.corrDesde), 'mu-corr', 'Data da decisão que fixou a multa ou, nas astreintes, em geral o último dia.')}
      ${campo('Juros desde', inpData('jurosDesde', it.jurosDesde), '', 'Em branco: sem juros.')}
      ${campo('Descrição na planilha (opcional)', `<input data-f="descricao" value="${esc(it.descricao || '')}">`, 'wfull')}</div>`, it, {
      comCrit: true,
      aoMostrar: () => {
        const mostrar = () => {
          const f = $('#fItem [data-f=forma]').value;
          $$('.mu-pct').forEach(e => { e.hidden = f !== 'pctCausa'; });
          $$('.mu-fixo').forEach(e => { e.hidden = f !== 'fixo'; });
          $$('.mu-dia').forEach(e => { e.hidden = f !== 'diaria'; });
          $$('.mu-corr').forEach(e => { e.hidden = f === 'pctCausa'; });
        };
        $('#fItem [data-f=forma]').addEventListener('change', mostrar);
        mostrar();
      },
      aoSalvar: x => {
        if (x.forma === 'pctCausa' && !(c.valorCausa.valor > 0 && c.valorCausa.data)) throw new Error('Informe o valor da causa e a data do ajuizamento nos dados do cálculo.');
        if (x.forma === 'fixo' && !(x.valor > 0)) throw new Error('Informe o valor.');
        if (x.forma === 'diaria' && !(x.valorDia > 0 && ehData(x.inicio) && ehData(x.fim) && x.fim >= x.inicio)) throw new Error('Informe o valor por dia e o período.');
        if (x.forma === 'diaria' && !x.corrDesde) x.corrDesde = x.fim;
        if (nova) c.multas.push(x); else Object.assign(c.multas.find(r => r.id === x.id), x);
        desenharMultas(); desenharAmortizacoes(); alterado();
      },
    });
  }
  $('#btAddMul').addEventListener('click', () => editarMulta(null));

  // ---- Art. 523
  const mostrar523 = () => {
    $$('.a523').forEach(e => { e.hidden = !c.art523.aplicar; });
    $('[data-a=multa]').disabled = c.art523.incluirMulta === false;
    $('[data-a=honorarios]').disabled = c.art523.incluirHonorarios === false;
  };
  $$('[data-a]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.a;
    c.art523[k] = el.type === 'checkbox' ? el.checked : parseValor(el.value);
    mostrar523(); desenharAmortizacoes(); alterado();
  }));
  mostrar523();

  // ---- Amortizações
  // Opções de "Abater de", em grupos: regras gerais, um grupo de itens e um item específico
  function opcoesDestino() {
    const regras = [['proporcional', 'Todos os itens, proporcionalmente'], ['antigas', 'Itens mais antigos primeiro'],
      ['custasPrimeiro', 'Custas e despesas primeiro; depois as demais verbas']];
    const SO = { rubrica: 'Só as verbas (condenação)', custas: 'Só custas e despesas', honorarios: 'Só honorários sucumbenciais', multa: 'Só multas processuais' };
    const grupos = ['rubrica', 'custas', ...(c.tipo === 'judicial' ? ['honorarios', 'multa'] : [])].map(g => ['grupo:' + g, SO[g]]);
    c.series.forEach(s => grupos.push(['serie:' + s.id, 'Só a série: ' + (s.descricao || '—')]));
    const itens = [];
    c.rubricas.forEach(r => itens.push([r.id, 'Verba: ' + (r.descricao || '—')]));
    c.custas.forEach(x => itens.push([x.id, 'Custas: ' + (x.descricao || fmtData(x.corrDesde) || '—')]));
    if (c.tipo === 'judicial') {
      c.honorarios.forEach(h => itens.push([h.id, rotuloHonorario(h)]));
      c.multas.forEach(m => itens.push([m.id, m.descricao || TIPOS_MULTA[m.tipo]]));
      if (c.art523.aplicar && c.art523.incluirMulta !== false) itens.push(['art523-multa', 'Multa do art. 523']);
      if (c.art523.aplicar && c.art523.incluirHonorarios !== false) itens.push(['art523-hon', 'Honorários do art. 523']);
    }
    return [['Regras', regras], ['Um grupo', grupos], ['Um item', itens]].filter(([, l]) => l.length);
  }
  function desenharAmortizacoes() {
    const op = opcoesDestino(), com523 = c.tipo === 'judicial' && c.art523.aplicar;
    $('.col-prazo').hidden = !com523;
    $('#amortizacoes').innerHTML = c.amortizacoes.map((a, i) => `<tr data-i="${i}">
      <td><input type="date" data-k="data" value="${esc(a.data || '')}"></td>
      <td><input data-k="valor" class="num" inputmode="decimal" value="${a.valor ? fmtNum(a.valor) : ''}"></td>
      <td><select data-k="imputacao"><option value="juros">Juros primeiro (art. 354 do CC)</option><option value="principal" ${a.imputacao === 'principal' ? 'selected' : ''}>Principal primeiro</option></select></td>
      <td><select data-k="destino">${op.map(([g, l]) => `<optgroup label="${g}">${l.map(([v, t]) => `<option value="${esc(v)}" ${a.destino === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>`).join('')}
        ${op.some(([, l]) => l.some(([v]) => v === (a.destino || 'proporcional'))) ? '' : '<option value="proporcional" selected>(item removido) Todos, proporcionalmente</option>'}</select></td>
      <td class="cen" ${com523 ? '' : 'hidden'}><input type="checkbox" data-k="noPrazo" ${a.noPrazo ? 'checked' : ''} title="Pagamento feito no prazo de 15 dias: reduz a base da multa e dos honorários do art. 523 (§ 2º)"></td>
      <td><input data-k="descricao" value="${esc(a.descricao || '')}" placeholder="Ex.: depósito judicial, parte incontroversa"></td>
      <td><button class="bt-x" title="Remover">&times;</button></td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum pagamento lançado.</td></tr>';
    $$('#amortizacoes tr[data-i]').forEach(tr => {
      const a = c.amortizacoes[+tr.dataset.i];
      $$('[data-k]', tr).forEach(inp => inp.addEventListener(inp.tagName === 'SELECT' || inp.type === 'checkbox' ? 'change' : 'input', () => {
        const k = inp.dataset.k;
        if (k === 'valor') a.valor = r2(parseValor(inp.value)); else if (k === 'noPrazo') a.noPrazo = inp.checked; else a[k] = inp.value;
        alterado();
      }));
      $('[data-k=valor]', tr).addEventListener('change', e => { e.target.value = a.valor ? fmtNum(a.valor) : ''; });
      $('.bt-x', tr).addEventListener('click', () => { c.amortizacoes.splice(+tr.dataset.i, 1); desenharAmortizacoes(); alterado(); });
    });
  }
  $('#btAddAmo').addEventListener('click', () => { c.amortizacoes.push({ id: novoId(), data: hoje(), valor: 0, imputacao: 'juros', destino: 'proporcional', descricao: '', noPrazo: false }); desenharAmortizacoes(); marcarSujo(); });

  // ---- Séries mensais
  const seriesAbertas = new Set();
  const desenharSeriesCalc = () => desenharSeries($('#series'), c, { alterado, abertas: seriesAbertas,
    mudouEstrutura: () => { desenharSeriesCalc(); desenharHonorarios(); desenharAmortizacoes(); } });
  $('#btSeq').addEventListener('click', () => janelaSequencia(c, critNovo(c.rubricas), () => { desenharTudo(); alterado(); }));
  $('#btImpSeries').addEventListener('click', () => janelaImportarSeries(c, critNovo(c.rubricas), () => { desenharTudo(); alterado(); }));

  function desenharTudo() { desenharSeriesCalc(); desenharRubricas(); desenharCustas(); desenharHonorarios(); desenharMultas(); desenharAmortizacoes(); }
  desenharTudo();

  // ---- Cálculo
  let tmr;
  function recalcularLogo() { clearTimeout(tmr); tmr = setTimeout(recalcular, 250); }
  function recalcular() {
    const data = $('#calcData').value;
    if (!ehData(data)) return;
    $('.ordem-verbas').hidden = !c.series.length;
    const r = calcular(c, data);
    $('#calcResumo').innerHTML = itensResumo(r).map(([rot, v, e]) => `<div class="res-l ${e === 'f' ? 'final' : e === 'b' ? 'dest' : ''}"><span>${esc(rot)}</span><b>${fmtMoeda(v)}</b></div>`).join('')
      || '<p class="vazio">Lance as verbas para ver o cálculo.</p>';
    const ruins = datasInvalidas(c);
    $('#calcAvisos').innerHTML = (ruins.length ? `<p class="alerta">Data inválida, desconsiderada no cálculo (confira o ano): ${esc(ruins.join('; '))}.</p>` : '')
      + notasCalculo(r).map(n => `<p class="alerta">${esc(n)}</p>`).join('')
      + (r.r523 ? `<p class="dica">Art. 523: base de ${fmtMoeda(r.r523.baseFinal)} (débito atualizado até a data do cálculo).</p>` : '');
    $('#calcDet').innerHTML = tabelasDetalheHTML(r);
  }
  $('#calcData').addEventListener('change', recalcular);
  recalcular();

  // ---- Exportação (usa o que está na tela, mesmo antes de salvar)
  const exportar = formato => executar(async () => {
    validar();
    const data = $('#calcData').value;
    if (!ehData(data)) throw new Error('Informe a data do cálculo.');
    await garantirIndices();
    await exportarCalculo(formato, c, data, { ordem: $('#ordemVerbas').value });
  });
  $('#expVer').addEventListener('click', () => exportar('ver'));
  $('#expPdf').addEventListener('click', () => exportar('pdf'));
  $('#expXlsx').addEventListener('click', () => exportar('xlsx'));

  // ---- Salvar / excluir / duplicar
  function validar() {
    if (!c.credorId) throw new Error('Escolha o credor principal.');
    const ids = [c.credorId, ...c.outrosCredores];
    if (new Set(ids).size !== ids.length) throw new Error('O mesmo credor foi escolhido mais de uma vez.');
    if (!c.devedores.some(d => d.nome)) throw new Error('Informe o devedor.');
    const ruins = datasInvalidas(c);
    if (ruins.length) throw new Error('Data inválida (confira o ano): ' + ruins.join('; ') + '.');
    const semVenc = c.series.flatMap(s => s.meses.filter(m => Number(m.valor) > 0 && !ehData(m.vencimento)).map(() => s.descricao));
    if (semVenc.length) throw new Error(`Há ${semVenc.length} mês(es) sem vencimento válido na(s) série(s): ${[...new Set(semVenc)].join(', ')}.`);
    const semCorr =[...c.rubricas, ...c.custas].filter(x => Number(x.valor) > 0 && !x.corrDesde && !x.jurosDesde);
    if (semCorr.length) throw new Error(`Informe o termo inicial da correção e/ou dos juros de: ${semCorr.map(x => x.descricao || 'linha sem descrição').join(', ')}.`);
    const semDesc = c.rubricas.filter(x => Number(x.valor) > 0 && !x.descricao);
    if (semDesc.length) throw new Error('Há verba sem descrição.');
    const amo = c.amortizacoes.filter(a => Number(a.valor) > 0 && !ehData(a.data));
    if (amo.length) throw new Error(`Há ${amo.length} pagamento(s) sem data.`);
  }
  $('#btSalvar').addEventListener('click', () => executar(async () => {
    validar();
    c.devedores = c.devedores.filter(d => d.nome || d.documento);
    c.rubricas = c.rubricas.filter(x => Number(x.valor) > 0 || x.descricao);
    c.custas = c.custas.filter(d => Number(d.valor) > 0);
    c.honorarios.forEach(h => { h.outras = (h.outras || []).filter(o => Number(o.valor) > 0); });
    c.amortizacoes = c.amortizacoes.filter(a => Number(a.valor) > 0);
    await salvarRegistro('calculos', c);
    sujo = false;
    aviso('Cálculo salvo.');
    if (novo) { ignorarHash = true; location.hash = '#/calculo/' + c.id; hashAnterior = location.hash; }
    telaCalculo(c.id, new URLSearchParams());
  }));
  $('#btExcluir')?.addEventListener('click', () => executar(async () => {
    if (!confirm('Excluir este cálculo? O arquivo vai para a pasta "lixeira" dos dados.')) return;
    await excluirRegistro('calculos', c.id);
    sujo = false;
    location.hash = '#/inicio';
  }));
  $('#btDuplicar')?.addEventListener('click', () => executar(async () => {
    if (sujo) throw new Error('Salve as alterações antes de duplicar.');
    const copia = { ...structuredClone(original), id: novoId(), rev: 0, criadoEm: '', titulo: (original.titulo || 'Cálculo') + ' (cópia)', acordos: [] };
    await salvarRegistro('calculos', copia);
    location.hash = '#/calculo/' + copia.id;
  }));
}

// Datas preenchidas fora do padrão (ex.: ano "0017"), com a indicação de onde estão
function datasInvalidas(c) {
  const out = [];
  const ver = (v, onde) => { if (v && !ehData(v)) out.push(`${onde} (${fmtData(v)})`); };
  ver(c.valorCausa?.data, 'Data do ajuizamento');
  (c.rubricas || []).forEach(x => { ver(x.corrDesde, x.descricao || 'Verba'); ver(x.jurosDesde, x.descricao || 'Verba'); });
  (c.series || []).forEach(s => {
    if (s.juros === 'data') ver(s.jurosData, s.descricao);
    (s.meses || []).forEach(m => ver(m.vencimento, `${s.descricao} ${mesNum(m.competencia)}`));
  });
  (c.custas || []).forEach(x => { ver(x.corrDesde, x.descricao || 'Custas'); ver(x.jurosDesde, x.descricao || 'Custas'); });
  (c.honorarios || []).forEach(x => {
    ver(x.data, rotuloHonorario(x)); ver(x.jurosDesde, rotuloHonorario(x));
    (x.outras || []).forEach(o => { ver(o.corrDesde, o.descricao || 'Outra base'); ver(o.jurosDesde, o.descricao || 'Outra base'); });
  });
  (c.multas || []).forEach(x => ['corrDesde', 'jurosDesde', 'inicio', 'fim'].forEach(k => ver(x[k], x.descricao || TIPOS_MULTA[x.tipo])));
  (c.amortizacoes || []).forEach(x => ver(x.data, 'Amortização'));
  return out;
}

// Tabelas do cálculo de cada item (tela)
function tabelasDetalheHTML(r) {
  if (!r.itens.length) return '<p class="vazio">Nenhum item até a data do cálculo.</p>';
  const pg = r.temPagamento;
  let h = r.grupos.map(g => `<h3 class="sec">${esc(g.nome)}</h3><div class="rolagem"><table class="tabela"><thead><tr><th>Item</th><th class="num">Valor originário</th><th>Correção desde</th><th class="num">Fator</th><th class="num">${pg ? 'Principal (saldo)' : 'Valor corrigido'}</th><th>Juros desde</th><th class="num">Taxa</th><th class="num">Juros</th><th class="num">Multa</th>${pg ? '<th class="num">Pago</th>' : ''}<th class="num">Total</th></tr></thead><tbody>
    ${g.itens.map(it => { const u = it.parcelas[0]; return `<tr><td>${esc(it.rotulo)}</td><td class="num">${fmtNum(it.original)}</td><td>${u.sombra ? 'Da base' : fmtData(u.corrDesde) || '—'}</td><td class="num">${it.fator ? fmtFator(it.fator) : '—'}</td>
      <td class="num">${fmtNum(it.principal)}</td><td>${u.sombra ? 'Da base' : fmtData(u.jurosDesde) || '—'}</td><td class="num">${it.taxaJuros ? fmtPct(r2(it.taxaJuros * 100 * 100) / 100) + '%' : '—'}</td>
      <td class="num">${fmtNum(it.juros)}</td><td class="num">${fmtNum(it.multa)}</td>${pg ? `<td class="num">${it.pago ? fmtNum(it.pago) : ''}</td>` : ''}<td class="num">${fmtNum(it.total)}</td></tr>`; }).join('')}
    <tr class="subtotal"><td>Subtotal</td><td class="num">${fmtNum(g.original)}</td><td></td><td></td><td class="num">${fmtNum(g.principal)}</td><td></td><td></td><td class="num">${fmtNum(g.juros)}</td><td class="num">${fmtNum(g.multa)}</td>${pg ? '<td></td>' : ''}<td class="num">${fmtNum(g.total)}</td></tr></tbody></table></div>`).join('');
  if (r.amort.length) h += `<h3 class="sec">Amortizações</h3>` + tabelaAmortHTML(r);
  return h;
}

function tabelaAmortHTML(r) {
  return `<div class="rolagem"><table class="tabela"><thead><tr><th>Data</th><th class="num">Valor pago</th><th class="num">Débito na data</th><th>Imputação</th><th class="num">Saldo após</th></tr></thead><tbody>
    ${r.amort.map(a => `<tr><td>${fmtData(a.data)}${a.a.descricao ? `<div class="dica">${esc(a.a.descricao)}</div>` : ''}</td><td class="num">${fmtNum(a.valor)}</td><td class="num">${fmtNum(a.antes)}</td>
      <td>${linhasImputadas(a, r.c).map(l => `${esc(l.rotulo)}: ${[l.juros > 0.004 ? 'juros ' + fmtNum(l.juros) : '', l.multa > 0.004 ? 'multa ' + fmtNum(l.multa) : '', l.principal > 0.004 ? 'principal ' + fmtNum(l.principal) : ''].filter(Boolean).join(', ')}`).join('<br>')}${a.sobra ? `<br><b>Excedente: ${fmtNum(a.sobra)}</b>` : ''}</td>
      <td class="num">${fmtNum(a.depois)}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ================= Configurações ================= */
function telaConfig() {
  const c = structuredClone(D.config), e = c.escritorio;
  const crit = { ...c.padroes.crit };
  $('#conteudo').innerHTML = cabecalho('Configurações') + `
  <form class="cartao" id="fEsc" autocomplete="off"><h2>Escritório (cabeçalho das planilhas)</h2>
    <div class="grade-form">
      <div class="campo w2"><label>Nome</label><input name="nome" value="${esc(e.nome || '')}"></div>
      <div class="campo"><label>CNPJ / CPF</label><input name="documento" value="${esc(e.documento || '')}"></div>
      <div class="campo"><label>OAB</label><input name="oab" value="${esc(e.oab || '')}" placeholder="OAB/RJ 000.000"></div>
      <div class="campo wfull"><label>Endereço</label><input name="endereco" value="${esc(e.endereco || '')}"></div>
      <div class="campo"><label>Telefone</label><input name="telefone" value="${esc(e.telefone || '')}"></div>
      <div class="campo"><label>E-mail</label><input name="email" value="${esc(e.email || '')}"></div>
      <div class="campo w2"><label>Site</label><input name="site" value="${esc(e.site || '')}"></div>
      <div class="campo wfull"><label>Logotipo (PNG ou JPG)</label>
        <div class="logo-ctl"><span id="logoPrevia">${e.logo ? `<img src="${e.logo}" alt="Logotipo">` : '<span class="dica">Sem logotipo</span>'}</span><input type="file" id="logoArq" accept="image/png,image/jpeg"><button type="button" class="bt pequeno" id="logoTirar" ${e.logo ? '' : 'hidden'}>Remover</button></div>
        <small>Aparece no cabeçalho das planilhas em PDF e Excel. Clique em "Salvar configurações" depois de escolher.</small></div>
    </div>
    <h3 class="sec" style="margin-top:16px">Critérios sugeridos para as novas verbas</h3>
    <p class="dica">Usados nos credores sem critérios próprios. Em cada cálculo, os critérios de cada verba podem ser alterados livremente.</p>
    <div id="cfgCrit">${critFormulario(crit)}</div>
    <div class="grade-form" style="margin-top:10px"><div class="campo"><label>Honorários contratuais padrão (%), extrajudicial</label><input id="cfgHon" inputmode="decimal" value="${esc(fmtPct(c.padroes.honContr))}"></div></div>
    <label class="inline" style="margin-top:10px"><input type="checkbox" id="ignNeg" ${c.padroes.ignorarNegativos ? 'checked' : ''}> Desconsiderar índices mensais negativos (deflação) na correção monetária</label>
    <h3 class="sec" style="margin-top:16px">Sugestões de descrição</h3>
    <p class="dica">Opções que aparecem ao digitar a descrição de uma verba ou de uma despesa (uma por linha). Ainda é possível digitar qualquer outro texto.</p>
    <div class="grade-form">
      <div class="campo w2"><label>Verbas</label><textarea id="cfgDescVerbas" rows="10">${esc(c.descVerbas.join('\n'))}</textarea>
        <small><a href="#" data-padrao="verbas">Restaurar a lista original</a></small></div>
      <div class="campo w2"><label>Custas e despesas</label><textarea id="cfgDescCustas" rows="10">${esc(c.descCustas.join('\n'))}</textarea>
        <small><a href="#" data-padrao="custas">Restaurar a lista original</a></small></div>
    </div>
    <div class="barra-form"><button class="bt primario">Salvar configurações</button></div>
  </form>
  ${secaoIndicesHTML()}
  <div class="cartao"><h2>Base de dados</h2>
    <dl class="dados"><div><dt>Local</dt><dd>${esc(Armaz.descricao())}</dd></div><div><dt>Versão</dt><dd>${VERSAO}</dd></div></dl>
    <div class="acoes-linha"><button class="bt" id="btMudarLocal">Mudar o local dos dados…</button><a class="bt" href="#/usuarios">Usuários e convites</a><a class="bt" href="#/conta">Minha conta</a></div></div>`;
  $('#btMudarLocal').addEventListener('click', () => executar(mudarLocal));
  ligarIndices();
  ligarCrit($('#cfgCrit'), crit, marcarSujo);
  $$('[data-padrao]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    $(a.dataset.padrao === 'verbas' ? '#cfgDescVerbas' : '#cfgDescCustas').value = (a.dataset.padrao === 'verbas' ? DESC_RUBRICAS : DESC_CUSTAS).join('\n');
    marcarSujo();
  }));
  let logo = { logo: e.logo, logoL: e.logoL, logoA: e.logoA };
  $('#fEsc').addEventListener('input', marcarSujo);
  const mostrarLogo = () => {
    $('#logoPrevia').innerHTML = logo.logo ? `<img src="${logo.logo}" alt="Logotipo">` : '<span class="dica">Sem logotipo</span>';
    $('#logoTirar').hidden = !logo.logo;
  };
  $('#logoArq').addEventListener('change', ev => executar(async () => {
    const f = ev.target.files[0]; if (!f) return;
    if (f.size > 8e6) throw new Error('Imagem grande demais (máximo 8 MB).');
    const url = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
    const img = new Image(); img.src = url; await img.decode();
    // Reduz imagens grandes (até 600 px de largura ou 240 px de altura), mantendo a transparência do PNG
    const fat = Math.min(1, 600 / img.naturalWidth, 240 / img.naturalHeight);
    const w = Math.round(img.naturalWidth * fat), h = Math.round(img.naturalHeight * fat);
    let final = url;
    if (fat < 1 || f.size > 300e3) {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      final = f.type === 'image/jpeg' ? cv.toDataURL('image/jpeg', 0.9) : cv.toDataURL('image/png');
    }
    logo = { logo: final, logoL: w, logoA: h };
    mostrarLogo();
    marcarSujo();
  }));
  $('#logoTirar').addEventListener('click', () => { logo = {}; $('#logoArq').value = ''; mostrarLogo(); marcarSujo(); });
  $('#fEsc').addEventListener('submit', ev => { ev.preventDefault(); executar(async () => {
    const f = new FormData(ev.target);
    c.escritorio = { ...Object.fromEntries(['nome', 'documento', 'oab', 'endereco', 'telefone', 'email', 'site'].map(k => [k, String(f.get(k) || '').trim()])), ...logo };
    c.padroes = { crit, honContr: parseValor($('#cfgHon').value), ignorarNegativos: $('#ignNeg').checked };
    c.descVerbas = linhasDeTexto($('#cfgDescVerbas').value);
    c.descCustas = linhasDeTexto($('#cfgDescCustas').value);
    await salvarConfig(c);
    sujo = false;
    aviso('Configurações salvas.');
    telaConfig();
  }); });
}

/* ================= Conexão com a base de dados ================= */
const LINK_APP = 'https://felippealvarez.github.io/calculos-cobranca/';

async function telaConexao(erro) {
  document.body.classList.remove('conectado', 'admin');
  $('#statusArmaz').textContent = '';
  $('#usuarioTopo').innerHTML = '';
  const salva = localStorage.getItem('ccb-modo') === 'pasta' ? await Armaz.nomePastaSalva() : '';
  const suporta = 'showDirectoryPicker' in window;
  $('#conteudo').innerHTML = `<div class="boas-vindas"><h1>Cálculos de Cobrança</h1>
    <p class="dica">Planilhas de cálculo para cobrança judicial e extrajudicial: rubricas com critérios próprios, custas, honorários, multas, art. 523 do CPC e amortizações.</p></div>
    ${erro ? `<p class="alerta">${esc(erro)}</p>` : ''}
    <div class="cartao destaque caixa-login">
      <h2>Onde ficam os dados</h2>
      <p>Conecte o seu Dropbox e escolha a pasta da base de dados (pode ser uma pasta compartilhada com a equipe). Depois, entre com o seu login.</p>
      <button class="bt primario" id="btDropbox">Conectar ao Dropbox</button>
      <p class="dica" style="margin-top:10px">O programa só lê e grava dentro da pasta escolhida. Funciona no computador e no celular.</p>
    </div>
    <p id="avisoInstalar" hidden><button class="bt" id="btInstalar2">Instalar o aplicativo neste aparelho</button></p>
    <div class="opcoes-conexao">
      ${suporta ? `<div class="cartao"><h2>Pasta do computador</h2>
        <p class="dica">Escolha uma pasta do computador (por exemplo, sincronizada pelo Dropbox, OneDrive ou Google Drive). Chrome ou Edge.</p>
        ${salva ? `<button class="bt" id="btRetomar">Abrir "${esc(salva)}"</button> ` : ''}<button class="bt" id="btPasta">Escolher pasta…</button></div>` : ''}
      <div class="cartao"><h2>Apenas testar</h2><p class="dica">Os dados ficam só neste navegador. Não use para o trabalho real.</p><button class="bt" id="btLocal">Testar sem pasta</button></div>
    </div>
    <p class="rodape-legal">${linksLegais()}<br>Ao usar o programa, você concorda com os termos de uso e a política de privacidade.</p>`;
  $('#btDropbox').addEventListener('click', () => executar(() => DBX.entrar()));
  $('#btRetomar')?.addEventListener('click', () => executar(async () => {
    if (!await Armaz.retomarPasta(true)) throw new Error('Sem permissão para a pasta. Escolha a pasta novamente.');
    await conectado();
  }));
  $('#btPasta')?.addEventListener('click', () => executar(async () => { await Armaz.conectarPasta(); await conectado(); }));
  $('#btLocal').addEventListener('click', () => executar(async () => { Armaz.usarLocal(); await conectado(); }));
  atualizarBotoesInstalar();
}

// Escolha da pasta da base no Dropbox (navegando pelas pastas da conta)
async function telaPastaDropbox(inicial = '') {
  let atual = inicial;
  document.body.classList.remove('conectado', 'admin');
  const desenhar = async () => {
    $('#conteudo').innerHTML = '<p class="carregando">Lendo as pastas do Dropbox…</p>';
    const pastas = await DBX.listarPastas(atual);
    const partes = atual.split('/').filter(Boolean);
    $('#conteudo').innerHTML = `<div class="cartao caixa-login" style="max-width:640px">
      <h1>Pasta da base de dados</h1>
      <p class="dica">Dropbox de ${esc(DBX.conta)}. Abra a pasta desejada e clique em "Usar esta pasta". Para trabalhar em equipe, escolha uma pasta compartilhada com todos.</p>
      <div class="trilha"><a href="#" data-ir="">Dropbox</a>${partes.map((p, i) => ` / <a href="#" data-ir="/${esc(partes.slice(0, i + 1).join('/'))}">${esc(p)}</a>`).join('')}</div>
      <div class="lista-pastas">${pastas.map(p => `<a href="#" data-ir="${esc(atual + '/' + p)}">&#128193; ${esc(p)}</a>`).join('') || '<p class="vazio">Nenhuma subpasta.</p>'}</div>
      <div class="acoes-linha"><button class="bt primario" id="btUsar" ${atual ? '' : 'disabled'}>Usar esta pasta${atual ? ': ' + esc(partes[partes.length - 1]) : ''}</button>
        <button class="bt" id="btNova">Criar subpasta aqui…</button><button class="bt" id="btVoltarCx">Cancelar</button></div></div>`;
    $$('[data-ir]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); atual = a.dataset.ir; executar(desenhar); }));
    $('#btUsar').addEventListener('click', () => executar(async () => { await DBX.escolherBase(atual); Armaz.usarDropbox(); await conectado(); }));
    $('#btNova').addEventListener('click', () => executar(async () => {
      const nome = (prompt('Nome da nova pasta:', 'Cálculos de Cobrança') || '').trim();
      if (!nome) return;
      if (/[\\/:*?"<>|]/.test(nome)) throw new Error('O nome não pode ter os caracteres \\ / : * ? " < > |');
      await DBX.criarPasta(atual + '/' + nome);
      atual = atual + '/' + nome;
      await desenhar();
    }));
    $('#btVoltarCx').addEventListener('click', () => desconectarBase());
  };
  await desenhar();
}

/* ================= Mudança do local dos dados ================= */
const SUBPASTAS_DADOS = ['credores', 'calculos', 'lixeira'];

// Cópia de todos os arquivos do local atual (configurações, índices, usuários, credores, cálculos e lixeira)
async function copiaDosDados() {
  const arquivos = {};
  for (const p of ['config.json', 'indices.json', 'usuarios.json']) { const t = await Armaz.ler(p); if (t !== null) arquivos[p] = t; }
  for (const sub of SUBPASTAS_DADOS) {
    for (const n of await Armaz.listar(sub)) { const t = await Armaz.ler(`${sub}/${n}`); if (t !== null) arquivos[`${sub}/${n}`] = t; }
  }
  return { origem: Armaz.descricao(), modo: Armaz.modo, pasta: Armaz.modo === 'pasta' ? Armaz.dir : null, base: Armaz.modo === 'dropbox' ? DBX.base : '',
    criadoEm: new Date().toISOString(), usuario: Auth.usuario, lembrar: !!localStorage.getItem('ccb-sessao'), arquivos };
}

const resumoCopia = arqs => {
  const n = pre => Object.keys(arqs).filter(p => p.startsWith(pre + '/')).length;
  return `${n('calculos')} cálculo(s), ${n('credores')} credor(es)${arqs['usuarios.json'] ? ', usuários' : ''}${arqs['config.json'] ? ', configurações' : ''}${arqs['indices.json'] ? ', índices' : ''}`;
};

async function mudarLocal() {
  if (sujo) throw new Error('Salve as alterações antes de mudar o local dos dados.');
  const destino = await perguntar('Mudar o local dos dados', `<p>Local atual: <b>${esc(Armaz.descricao())}${Armaz.modo === 'dropbox' ? ' (' + esc(DBX.base) + ')' : ''}</b>.</p>
    <p>Escolha o novo local. Antes de mudar, o programa pergunta se deve levar uma cópia dos dados atuais. Nada é apagado do local atual.</p>`,
    [['dropbox', 'Dropbox (pela internet)', 'primario'], ...('showDirectoryPicker' in window ? [['pasta', 'Pasta do computador…']] : []), ['local', 'Somente neste navegador (teste)'], ['', 'Cancelar']]);
  if (!destino) return;
  if (destino === 'local' && Armaz.modo === 'local') throw new Error('Os dados já estão neste navegador.');
  const h = destino === 'pasta' ? await Armaz.escolherPasta() : null;
  if (h && Armaz.modo === 'pasta' && await h.isSameEntry(Armaz.dir)) throw new Error('Esta já é a pasta atual dos dados.');
  $('#conteudo').innerHTML = '<p class="carregando">Lendo os dados atuais…</p>';
  const copia = await copiaDosDados();
  const resp = await perguntar('Levar os dados para o novo local?', `<p>Copiar para o novo local os dados atuais: <b>${esc(resumoCopia(copia.arquivos))}</b>?</p>
    <p class="dica">Os arquivos do local atual continuam onde estão. Se o novo local já tiver dados, o programa pergunta de novo antes de copiar.</p>`,
    [['sim', 'Copiar os dados', 'primario'], ['nao', 'Não copiar (usar o que houver no novo local)'], ['', 'Cancelar']]);
  if (!resp) return rotear();
  if (resp === 'sim') await IDB.set('kv', 'migracao', copia); else await IDB.del('kv', 'migracao');
  document.body.classList.remove('conectado', 'admin');
  if (destino === 'pasta') { await Armaz.usarPasta(h); return conectado(); }
  if (destino === 'local') { Armaz.usarLocal(); return conectado(); }
  // Dropbox: escolhe a pasta (conectando a conta antes, se preciso); a cópia é feita ao abrir a pasta escolhida
  if (DBX.conectado()) { DBX.base = ''; return telaPastaDropbox(); }
  Armaz.desconectar();
  return DBX.entrar();
}

/* ---------- Cópia dos dados em arquivo (para levar a outro aparelho, ao aplicativo instalado ou como segurança) ---------- */
async function exportarDados() {
  $('#aviso').textContent = '';
  const copia = await copiaDosDados();
  const arq = { formato: 'calculos-cobranca', versao: VERSAO, exportadoEm: new Date().toISOString(), origem: copia.origem, arquivos: copia.arquivos };
  baixar(new Blob([JSON.stringify(arq)], { type: 'application/json' }), `calculos-cobranca-dados-${hoje()}.json`);
  aviso(`Cópia dos dados salva (${resumoCopia(copia.arquivos)}). Guarde o arquivo: ele contém dados pessoais dos devedores.`);
}

// Lê um arquivo exportado e grava os dados no local atual (pergunta antes se o local já tiver dados)
function importarDados(depois) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.addEventListener('change', () => executar(async () => {
    const f = inp.files[0];
    if (!f) return;
    let j;
    try { j = JSON.parse(await f.text()); } catch { throw new Error('Arquivo inválido: não é uma cópia dos dados do programa.'); }
    if (j?.formato !== 'calculos-cobranca' || typeof j.arquivos !== 'object') throw new Error('Arquivo inválido: não é uma cópia dos dados do programa.');
    const ok = await perguntar('Importar cópia dos dados', `<p>Arquivo <b>${esc(f.name)}</b>, exportado em ${new Date(j.exportadoEm).toLocaleString('pt-BR')} de "${esc(j.origem || '')}": <b>${esc(resumoCopia(j.arquivos))}</b>.</p>
      <p>Gravar esses dados em <b>${esc(Armaz.descricao())}</b>? Se já houver dados aqui, o programa pergunta antes de substituir.</p>`,
      [['sim', 'Importar', 'primario'], ['', 'Cancelar']]);
    if (ok !== 'sim') return;
    await IDB.set('kv', 'migracao', { origem: 'o arquivo ' + f.name, modo: 'arquivo', criadoEm: new Date().toISOString(), usuario: null, arquivos: j.arquivos });
    await aplicarMigracaoPendente();
    await depois();
  }));
  inp.click();
}

// Cópia pendente (pedida antes de mudar de local): grava os arquivos no local atual
async function aplicarMigracaoPendente() {
  const mig = await IDB.get('kv', 'migracao').catch(() => null);
  if (!mig) return;
  const mesmo = mig.modo === Armaz.modo && (Armaz.modo === 'local' || (Armaz.modo === 'dropbox' && mig.base === DBX.base)
    || (Armaz.modo === 'pasta' && mig.pasta && await mig.pasta.isSameEntry(Armaz.dir).catch(() => false)));
  if (mesmo) { await IDB.del('kv', 'migracao'); return; }
  // Cópia pedida há mais de duas horas (ex.: a mudança foi interrompida): confirma de novo
  if (Date.now() - new Date(mig.criadoEm).getTime() > 2 * 3600e3) {
    const ok = await perguntar('Cópia pendente', `<p>Há uma cópia dos dados de <b>${esc(mig.origem)}</b>, preparada em ${new Date(mig.criadoEm).toLocaleString('pt-BR')}, ainda não gravada.</p>
      <p>Copiar agora para <b>${esc(Armaz.descricao())}</b>?</p>`, [['sim', 'Copiar', 'primario'], ['nao', 'Descartar a cópia']]);
    if (ok !== 'sim') { await IDB.del('kv', 'migracao'); return; }
  }
  const nomes = Object.keys(mig.arquivos);
  // Arquivos que já existem no novo local
  const existentes = new Set();
  for (const p of nomes.filter(p => !p.includes('/'))) if (await Armaz.ler(p) !== null) existentes.add(p);
  for (const sub of SUBPASTAS_DADOS) for (const n of await Armaz.listar(sub)) existentes.add(`${sub}/${n}`);
  const repetidos = nomes.filter(p => existentes.has(p));
  let modo = 'tudo';
  if (existentes.size) {
    modo = await perguntar('O novo local já tem dados', `<p>Copiando de <b>${esc(mig.origem)}</b> para <b>${esc(Armaz.descricao())}</b>.</p>
      <p>O novo local já tem ${existentes.size} arquivo(s)${repetidos.length ? `, dos quais ${repetidos.length} com o mesmo nome dos que serão copiados` : ''}. Como prosseguir?</p>`,
      [['faltantes', 'Copiar só o que não existe lá', 'primario'], ...(repetidos.length ? [['tudo', 'Copiar tudo, substituindo os arquivos iguais']] : []), ['nao', 'Não copiar']]);
    if (!modo || modo === 'nao') { await IDB.del('kv', 'migracao'); aviso('Nenhum arquivo copiado.'); return; }
  }
  let n = 0;
  for (const p of nomes) {
    if (modo === 'faltantes' && existentes.has(p)) continue;
    $('#conteudo').innerHTML = `<p class="carregando">Copiando os dados… ${++n} de ${nomes.length}</p>`;
    await Armaz.gravar(p, mig.arquivos[p]);
  }
  await IDB.del('kv', 'migracao');
  // Com os usuários copiados, a pessoa continua conectada no novo local
  if (mig.usuario && nomes.includes('usuarios.json') && (modo === 'tudo' || !existentes.has('usuarios.json'))) { Auth.usuario = mig.usuario; Auth._guardar(mig.lembrar); }
  aviso(`${n} arquivo(s) copiado(s) de ${mig.origem}.`);
}

// Base acessível: confere o login (ou cria o primeiro administrador) e carrega os dados
async function conectado() {
  $('#conteudo').innerHTML = '<p class="carregando">Abrindo a base de dados…</p>';
  await aplicarMigracaoPendente();
  if (!await Auth.temUsuarios()) return telaPrimeiroAdmin();
  const s = await Auth.retomar();
  if (!s) return telaLogin();
  if (s.trocarSenha) return telaTrocarSenha(true);
  await abrirBase();
}

async function abrirBase() {
  $('#conteudo').innerHTML = '<p class="carregando">Lendo os dados…</p>';
  await recarregarTudo();
  document.body.classList.add('conectado');
  document.body.classList.toggle('admin', Auth.ehAdmin());
  $('#statusArmaz').textContent = Armaz.descricao();
  $('#usuarioTopo').innerHTML = `<a href="#/conta">${esc(Auth.usuario.nome)}</a>${Auth.ehAdmin() ? '<span class="chip neutro">Administrador</span>' : ''}<button class="bt-sair" id="btSair">Sair</button>`;
  $('#btSair').addEventListener('click', () => {
    if (sujo && !confirm('Há alterações não salvas. Sair assim mesmo?')) return;
    sujo = false;
    Auth.sair();
    document.body.classList.remove('conectado', 'admin');
    $('#usuarioTopo').innerHTML = '';
    telaLogin();
  });
  $('#rodapeMenu').innerHTML = `Versão ${VERSAO}<br>${esc(COPYRIGHT)}`;
  rotear();
}

function telaLogin() {
  document.body.classList.remove('conectado', 'admin');
  $('#conteudo').innerHTML = `<form class="cartao caixa-login" id="fLogin" autocomplete="on">
    <h1>Cálculos de Cobrança</h1>
    <p class="dica">${esc(Armaz.descricao())}${Armaz.modo === 'dropbox' && DBX.conta ? ' · ' + esc(DBX.conta) : ''}</p>
    <div class="grade-login">
      <div class="campo"><label for="lgLogin">Login</label><input id="lgLogin" autocomplete="username" autocapitalize="none" required></div>
      <div class="campo"><label for="lgSenha">Senha</label><input id="lgSenha" type="password" autocomplete="current-password" required></div>
      <label class="inline"><input type="checkbox" id="lgLembrar" checked> Manter conectado neste aparelho</label>
      <button class="bt primario">Entrar</button>
    </div>
    <p class="dica" style="margin-top:14px">Esqueceu a senha? Peça ao administrador uma senha provisória.</p>
    <p style="margin-top:6px"><a href="#" id="lgTrocarBase">Usar outra pasta, outra conta do Dropbox ou outra forma de acesso</a></p>
  </form>`;
  $('#lgLogin').focus();
  $('#fLogin').addEventListener('submit', e => { e.preventDefault(); executar(async () => {
    const r = await Auth.entrar($('#lgLogin').value, $('#lgSenha').value, $('#lgLembrar').checked);
    if (r.trocarSenha) return telaTrocarSenha(true);
    await abrirBase();
  }); });
  $('#lgTrocarBase').addEventListener('click', e => { e.preventDefault(); desconectarBase(); });
}

function desconectarBase() {
  Auth.sair();
  if (Armaz.modo === 'dropbox' || DBX.conectado()) DBX.sair();
  Armaz.desconectar();
  telaConexao();
}

function telaPrimeiroAdmin() {
  document.body.classList.remove('conectado', 'admin');
  $('#conteudo').innerHTML = `<form class="cartao caixa-login" id="fAdm" autocomplete="off">
    <h1>Primeiro acesso</h1>
    <p>Esta base ainda não tem usuários. Crie o <b>administrador</b>: ele cadastra os demais usuários e altera as configurações.</p>
    <p class="dica">${esc(Armaz.descricao())}${Armaz.modo === 'dropbox' && DBX.conta ? ' · ' + esc(DBX.conta) : ''}</p>
    <div class="grade-login">
      <div class="campo"><label>Nome</label><input id="adNome" required></div>
      <div class="campo"><label>Login</label><input id="adLogin" autocapitalize="none" placeholder="ex.: maria" required></div>
      <div class="campo"><label>Senha (mínimo 6 caracteres)</label><input id="adSenha" type="password" autocomplete="new-password" required></div>
      <div class="campo"><label>Repita a senha</label><input id="adSenha2" type="password" autocomplete="new-password" required></div>
      <button class="bt primario">Criar administrador e entrar</button>
    </div>
    <p style="margin-top:12px">Já usava o programa em outro aparelho ou endereço? <a href="#" id="adImportar">Importar uma cópia dos dados</a> (inclui os usuários; depois entre com o seu login).</p>
    <p style="margin-top:12px"><a href="#" id="adVoltar">Voltar</a></p>
  </form>`;
  $('#fAdm').addEventListener('submit', e => { e.preventDefault(); executar(async () => {
    if ($('#adSenha').value !== $('#adSenha2').value) throw new Error('As senhas não conferem.');
    await Auth.criarPrimeiroAdmin({ login: $('#adLogin').value, nome: $('#adNome').value, senha: $('#adSenha').value });
    aviso('Administrador criado.');
    await abrirBase();
  }); });
  $('#adVoltar').addEventListener('click', e => { e.preventDefault(); desconectarBase(); });
  $('#adImportar').addEventListener('click', e => { e.preventDefault(); importarDados(conectado); });
}

function telaTrocarSenha(obrigatoria) {
  if (obrigatoria) document.body.classList.remove('conectado', 'admin');
  const html = `<form class="cartao caixa-login" id="fSenha" autocomplete="off">
    <h${obrigatoria ? 1 : 2}>${obrigatoria ? 'Crie a sua senha' : 'Trocar a senha'}</h${obrigatoria ? 1 : 2}>
    ${obrigatoria ? '<p>Você entrou com uma senha provisória. Escolha uma senha pessoal para continuar.</p>' : ''}
    <div class="grade-login">
      <div class="campo"><label>Senha atual${obrigatoria ? ' (provisória)' : ''}</label><input id="tsAtual" type="password" autocomplete="current-password" required></div>
      <div class="campo"><label>Nova senha (mínimo 6 caracteres)</label><input id="tsNova" type="password" autocomplete="new-password" required></div>
      <div class="campo"><label>Repita a nova senha</label><input id="tsNova2" type="password" autocomplete="new-password" required></div>
      <button class="bt primario">Gravar a nova senha</button>
    </div></form>`;
  if (obrigatoria) $('#conteudo').innerHTML = html; else $('#areaSenha').innerHTML = html;
  $('#fSenha').addEventListener('submit', e => { e.preventDefault(); executar(async () => {
    if ($('#tsNova').value !== $('#tsNova2').value) throw new Error('As senhas não conferem.');
    await Auth.trocarSenha($('#tsAtual').value, $('#tsNova').value);
    aviso('Senha alterada.');
    if (obrigatoria) await abrirBase(); else telaConta();
  }); });
}

function telaConta() {
  $('#conteudo').innerHTML = cabecalho('Minha conta') + `
    <div class="cartao"><dl class="dados">
      <div><dt>Nome</dt><dd>${esc(Auth.usuario.nome)}</dd></div><div><dt>Login</dt><dd>${esc(Auth.usuario.login)}</dd></div>
      <div><dt>Perfil</dt><dd>${Auth.ehAdmin() ? 'Administrador' : 'Usuário'}</dd></div>
      <div><dt>Base de dados</dt><dd>${esc(Armaz.modo === 'dropbox' ? 'Dropbox: ' + DBX.base : Armaz.descricao())}</dd></div>
      ${Armaz.modo === 'dropbox' ? `<div><dt>Conta do Dropbox neste aparelho</dt><dd>${esc(DBX.conta)}</dd></div>` : ''}
      <div><dt>Versão do programa</dt><dd>${VERSAO}</dd></div></dl>
      <div class="acoes-linha"><button class="bt" id="btSenha">Trocar a senha</button><button class="bt" id="btMudarLocal">Mudar o local dos dados…</button><button class="bt" id="btDesconectar">Desconectar este aparelho</button></div>
      <p class="dica" style="margin-top:8px">"Mudar o local dos dados" passa a usar outro local (Dropbox, pasta do computador ou só este navegador), com a opção de levar uma cópia dos dados atuais.
        "Desconectar este aparelho" sai do login e da conta do Dropbox neste aparelho (útil em computador compartilhado).</p></div>
    <div class="cartao"><h2>Cópia dos dados em arquivo</h2>
      <p class="dica">Para levar os dados a outro aparelho, ao aplicativo instalado no iPhone ou ao endereço publicado (se você usava o programa aberto pelo arquivo do computador), ou para guardar uma cópia de segurança.
        O arquivo contém todos os cálculos, credores, usuários e configurações: guarde-o com cuidado.</p>
      <div class="acoes-linha"><button class="bt" id="btExportar">Exportar cópia dos dados</button>${Auth.ehAdmin() ? '<button class="bt" id="btImportar">Importar cópia dos dados</button>' : ''}</div></div>
    <div id="areaSenha"></div>`;
  $('#btSenha').addEventListener('click', () => telaTrocarSenha(false));
  $('#btMudarLocal').addEventListener('click', () => executar(mudarLocal));
  $('#btExportar').addEventListener('click', () => executar(exportarDados));
  $('#btImportar')?.addEventListener('click', () => importarDados(async () => { await recarregarTudo(); rotear(); }));
  $('#btDesconectar').addEventListener('click', () => {
    if (!confirm('Desconectar este aparelho? Será preciso conectar o Dropbox e entrar de novo.')) return;
    sujo = false;
    desconectarBase();
  });
}

/* ================= Usuários (administrador) ================= */
async function telaUsuarios() {
  const lista = await Auth.lista();
  $('#conteudo').innerHTML = cabecalho('Usuários', 'Quem pode usar o programa nesta base. Só o administrador cadastra usuários e altera as configurações.', '<button class="bt primario" id="btNovoUsu">Novo usuário</button>') + `
    <div class="cartao"><div class="rolagem"><table class="tabela clicavel"><thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Situação</th><th>Último acesso</th></tr></thead><tbody>
      ${lista.map(u => `<tr data-login="${esc(u.login)}"><td>${esc(u.nome)}</td><td>${esc(u.login)}</td><td>${u.perfil === 'admin' ? 'Administrador' : 'Usuário'}</td>
        <td>${u.ativo ? (u.trocarSenha ? '<span class="chip aberto">Senha provisória</span>' : '<span class="chip fechado">Ativo</span>') : '<span class="chip neutro">Sem acesso</span>'}</td>
        <td>${u.ultimoAcesso ? new Date(u.ultimoAcesso).toLocaleString('pt-BR') : '—'}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="cartao"><h2>Como a pessoa passa a usar</h2><ol>
      <li>No Dropbox, compartilhe com ela a pasta da base${Armaz.modo === 'dropbox' ? ` (<b>${esc(DBX.base)}</b>)` : ''}.</li>
      <li>Cadastre o usuário aqui. O programa gera uma senha provisória e a mensagem pronta para enviar (WhatsApp ou e-mail).</li>
      <li>A pessoa abre o link, conecta o Dropbox dela, escolhe a pasta compartilhada e entra com o login e a senha provisória. No primeiro acesso, ela cria a senha pessoal.</li></ol></div>`;
  $('#btNovoUsu').addEventListener('click', () => formUsuario(null));
  $$('tr[data-login]').forEach(tr => tr.addEventListener('click', () => formUsuario(lista.find(u => u.login === tr.dataset.login))));
}

function formUsuario(u) {
  const novo = !u;
  abrirModal(`<div class="modal-cab"><h2>${novo ? 'Novo usuário' : 'Editar usuário'}</h2><button class="bt-x" data-fechar>&times;</button></div>
    <form id="fUsu" class="form-modal" autocomplete="off"><div class="grade-form">
      <div class="campo w2"><label>Nome</label><input name="nome" value="${esc(u?.nome || '')}" required></div>
      <div class="campo"><label>Login</label><input name="login" value="${esc(u?.login || '')}" ${novo ? '' : 'disabled'} autocapitalize="none" placeholder="ex.: maria.silva" required></div>
      <div class="campo"><label>Perfil</label><select name="perfil"><option value="usuario">Usuário</option><option value="admin" ${u?.perfil === 'admin' ? 'selected' : ''}>Administrador</option></select></div>
      ${novo ? '' : `<div class="campo w2"><label class="inline"><input type="checkbox" name="ativo" ${u.ativo ? 'checked' : ''}> Acesso ativo</label></div>
        <div class="campo w2"><label class="inline"><input type="checkbox" name="redefinir"> Gerar nova senha provisória</label></div>`}
    </div>
    <p class="dica">${novo ? 'Uma senha provisória será gerada. A pessoa cria a senha pessoal no primeiro acesso.' : 'Desmarque "Acesso ativo" para bloquear a pessoa, sem apagar o histórico.'}</p>
    <div class="barra-form"><button class="bt primario">${novo ? 'Cadastrar' : 'Salvar'}</button><button type="button" class="bt" data-fechar>Cancelar</button></div></form>`, 'modal-medio');
  $('#fUsu').addEventListener('submit', e => { e.preventDefault(); executar(async () => {
    const f = e.target, senha = novo || f.redefinir?.checked ? senhaProvisoria() : '';
    const login = (novo ? f.login.value : u.login).trim().toLowerCase();
    await Auth.salvarUsuario({ login, nome: f.nome.value, perfil: f.perfil.value, ativo: novo ? true : f.ativo.checked, senha }, novo);
    if (senha) mostrarConvite(f.nome.value.trim(), login, senha); else { fecharModal(); aviso('Usuário salvo.'); telaUsuarios(); }
  }); });
}

// Mensagem pronta para enviar à pessoa (o link não leva senha nem acesso ao Dropbox)
function mostrarConvite(nome, login, senha) {
  const pasta = Armaz.modo === 'dropbox' ? DBX.base : '';
  const msg = `Olá, ${nome.split(' ')[0]}! Seu acesso ao programa Cálculos de Cobrança:

1. Abra no celular ou no computador (Chrome, Edge ou Safari): ${LINK_APP}
2. Se quiser, instale: botão "Instalar o aplicativo" (no iPhone: Compartilhar > Adicionar à Tela de Início).
3. Toque em "Conectar ao Dropbox", entre com a SUA conta do Dropbox e escolha a pasta ${pasta ? `"${pasta.split('/').pop()}"` : 'compartilhada com você'}.
4. Entre com o login: ${login}
   Senha provisória: ${senha}
5. No primeiro acesso, crie a sua senha pessoal.`;
  abrirModal(`<div class="modal-cab"><h2>Mensagem para enviar</h2><button class="bt-x" data-fechar>&times;</button></div>
    <p>Envie esta mensagem para <b>${esc(nome)}</b> (WhatsApp ou e-mail). A senha provisória aparece só agora; se perder, gere outra em Usuários.</p>
    <textarea id="txConvite" rows="11" readonly>${esc(msg)}</textarea>
    <div class="acoes-linha"><button class="bt primario" id="btCopiarConvite">Copiar mensagem</button>
      <a class="bt" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Abrir no WhatsApp</a>
      <a class="bt" href="mailto:?subject=${encodeURIComponent('Acesso ao programa Cálculos de Cobrança')}&body=${encodeURIComponent(msg)}">Abrir no e-mail</a>
      <button class="bt" data-fechar>Fechar</button></div>
    <p class="dica">Lembre-se de compartilhar com a pessoa, no Dropbox, a pasta da base.</p>`, 'modal-medio');
  $('#btCopiarConvite').addEventListener('click', () => executar(async () => {
    try { await navigator.clipboard.writeText(msg); } catch { $('#txConvite').select(); document.execCommand('copy'); }
    aviso('Mensagem copiada.');
  }));
  $('#modal').addEventListener('click', function fim(e) { if (e.target.closest('[data-fechar]')) { $('#modal').removeEventListener('click', fim); telaUsuarios(); } });
}

/* ================= Início ================= */
function eventosGlobais() {
  $('#btMenu').addEventListener('click', () => document.body.classList.toggle('menu-aberto'));
  $('#fundoMenu').addEventListener('click', () => document.body.classList.remove('menu-aberto'));
  document.addEventListener('click', e => { if (e.target.closest('[data-fechar]')) fecharModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) fecharModal(); });
  // Ano digitado com dois dígitos ("17" vira "0017"): completa para 2017 (ou 19xx) antes dos demais tratamentos
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.type !== 'date' || !el.value || ehData(el.value)) return;
    const [a, m, d] = el.value.split('-'), y = +a;
    if (y < 100) {
      const ano = (y <= new Date().getFullYear() % 100 + 10 ? 2000 : 1900) + y;
      el.value = `${ano}-${m}-${d}`;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      aviso(`Ano completado: ${fmtData(el.value)}.`);
    } else aviso('Data inválida: confira o ano (' + fmtData(el.value) + ').', 'erro');
  }, true);
  atualizarSugestoes();
  // Ao voltar para a janela, relê os dados (outras pessoas podem ter alterado pelo Dropbox)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !document.body.classList.contains('conectado') || sujo || !$('#modal').hidden) return;
    if (Date.now() - D.carregadoEm < 30000) return;
    executar(async () => { await recarregarTudo(); rotear(); });
  });
}

/* ================= Aplicativo instalável (PWA) ================= */
const ehIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let pedidoInstalacao = null;

// Os botões de instalar aparecem sempre que o programa não estiver aberto como aplicativo instalado
function atualizarBotoesInstalar() {
  [$('#btInstalar'), $('#btInstalarTopo'), $('#avisoInstalar')].forEach(el => { if (el) el.hidden = instalado(); });
}

const NOTA_DADOS_JUNTO = 'Os dados que você já salvou neste navegador continuam disponíveis no aplicativo instalado, porque ele usa o mesmo endereço e o mesmo armazenamento do navegador. Se os dados estiverem no Dropbox ou numa pasta, basta escolher o mesmo local no aplicativo.';
const ORIGEM_PUBLICADA = new URL(LINK_APP).origin;
let aoLiberarInstalacao = null; // chamado quando o navegador libera a instalação com a janela aberta

async function instalarApp() {
  // Aberto pelo arquivo do computador (ou outro endereço): não instala; oferece abrir o endereço publicado levando os dados
  if (location.protocol === 'file:' || (location.origin !== ORIGEM_PUBLICADA && location.hostname !== 'localhost')) return janelaLevarDados();
  if (pedidoInstalacao) return confirmarInstalacao();
  if (ehIOS()) {
    abrirModal(`<div class="modal-cab"><h2>Instalar no iPhone ou iPad</h2><button class="bt-x" data-fechar>&times;</button></div>
      <ol><li>Abra este endereço no <b>Safari</b>.</li><li>Toque no botão <b>Compartilhar</b> (quadrado com seta para cima).</li>
        <li>Escolha <b>Adicionar à Tela de Início</b> e confirme. O ícone "Cálculos" aparece na tela de início.</li></ol>
      <p><b>Dados:</b> no iPhone e no iPad, o aplicativo instalado não enxerga o que foi salvo no Safari no modo "Somente neste navegador". Antes de instalar, use "Exportar cópia dos dados" (em Minha conta) e, no aplicativo, "Importar cópia dos dados". Com os dados no Dropbox, basta conectar o mesmo Dropbox e escolher a mesma pasta.</p>
      <div class="acoes-linha"><button class="bt" data-fechar>Fechar</button></div>`, 'modal-medio');
    return;
  }
  // Chrome e Edge só liberam a instalação depois de alguns segundos de uso da página: o botão fica ativo quando liberarem
  abrirModal(`<div class="modal-cab"><h2>Instalar o aplicativo</h2><button class="bt-x" data-fechar>&times;</button></div>
    <p>O navegador vai perguntar se você quer instalar o aplicativo. Ao confirmar, ele cria o atalho "Cálculos de Cobrança" na área de trabalho e no menu Iniciar (no celular, na tela inicial), e o programa passa a abrir numa janela própria.</p>
    <div class="acoes-linha"><button class="bt primario" id="instAgora" disabled>Instalar agora</button><span class="dica" id="instEstado">Aguardando o navegador liberar a instalação (pode levar alguns segundos; continue usando a página)…</span></div>
    <details class="detalhes"><summary>O botão não ficou disponível?</summary>
      <ul><li>Talvez o aplicativo já esteja instalado neste aparelho: procure o atalho "Cálculos de Cobrança" ou, na barra de endereço do Chrome, a opção "Abrir no app".</li>
        <li><b>Chrome</b>: clique no ícone de instalação à direita da barra de endereço, ou menu <b>⋮</b> &gt; <b>Transmitir, salvar e compartilhar</b> &gt; <b>Instalar página como app</b>.</li>
        <li><b>Edge</b>: menu <b>…</b> &gt; <b>Aplicativos</b> &gt; <b>Instalar este site como um aplicativo</b>.</li>
        <li><b>Android</b>: menu <b>⋮</b> do Chrome &gt; <b>Instalar app</b> (ou "Adicionar à tela inicial").</li>
        <li>O Firefox não instala aplicativos deste tipo: use o Chrome ou o Edge.</li></ul></details>
    <p class="dica"><b>Dados:</b> ${NOTA_DADOS_JUNTO}</p>`, 'modal-medio');
  aoLiberarInstalacao = () => {
    const bt = $('#instAgora');
    if (!bt) return;
    bt.disabled = false;
    $('#instEstado').textContent = 'Pronto: clique em "Instalar agora".';
  };
  $('#instAgora').addEventListener('click', () => executar(confirmarInstalacao));
  // Sem liberação em 15 segundos, mostra o caminho pelo menu do navegador (que também cria o atalho)
  setTimeout(() => {
    const bt = $('#instAgora');
    if (!bt || !bt.disabled) return;
    $('#instEstado').innerHTML = '<b>O navegador não liberou a instalação direta</b> (talvez o aplicativo já esteja instalado). Use o menu do navegador, como explicado abaixo.';
    const d = bt.closest('.modal-caixa').querySelector('details');
    if (d) d.open = true;
  }, 15000);
}

async function confirmarInstalacao() {
  const p = pedidoInstalacao;
  if (!p) return;
  pedidoInstalacao = null;
  aoLiberarInstalacao = null;
  fecharModal();
  p.prompt();
  const r = await p.userChoice.catch(() => null);
  atualizarBotoesInstalar();
  if (r?.outcome === 'accepted') aviso('Aplicativo instalado: use o atalho "Cálculos de Cobrança". ' + NOTA_DADOS_JUNTO);
}

/* ---------- Do programa aberto pelo arquivo para o endereço publicado ---------- */
function janelaLevarDados() {
  const comDados = document.body.classList.contains('conectado');
  abrirModal(`<div class="modal-cab"><h2>Instalar o aplicativo</h2><button class="bt-x" data-fechar>&times;</button></div>
    <p>Aberto direto do arquivo do computador, o programa não pode ser instalado. A instalação é feita pelo endereço publicado:</p>
    <p><a href="${LINK_APP}" target="_blank" rel="noopener">${LINK_APP}</a></p>
    ${comDados ? `<p>Os dados salvos aqui não aparecem sozinhos no endereço publicado (para o navegador, são endereços diferentes). Use <b>Abrir levando os dados</b>: o programa abre o endereço publicado numa nova aba e envia para lá uma cópia dos dados, que você confirma na nova aba.</p>` : ''}
    <p id="levarEstado" class="dica"></p>
    <div class="acoes-linha">${comDados ? '<button class="bt primario" id="btLevar">Abrir levando os dados</button>' : ''}
      <a class="bt" href="${LINK_APP}" target="_blank" rel="noopener">Abrir ${comDados ? 'sem levar os dados' : 'o endereço publicado'}</a><button class="bt" data-fechar>Fechar</button></div>`, 'modal-medio');
  $('#btLevar')?.addEventListener('click', () => executar(enviarDadosParaPublicado));
}

async function enviarDadosParaPublicado() {
  const estado = t => { const e = $('#levarEstado'); if (e) e.textContent = t; };
  estado('Preparando a cópia dos dados…');
  const copia = await copiaDosDados();
  const pacote = { formato: 'calculos-cobranca', versao: VERSAO, exportadoEm: new Date().toISOString(), origem: copia.origem, arquivos: copia.arquivos };
  const w = window.open(LINK_APP + 'app/index.html', '_blank');
  if (!w) throw new Error('O navegador bloqueou a nova aba. Permita janelas pop-up para este arquivo e tente de novo.');
  estado('Enviando os dados para a nova aba… Confirme o recebimento lá.');
  // Reenvia até a página publicada carregar e confirmar o recebimento (no máximo 2 minutos)
  let recebido = false;
  const ouvir = e => { if (e.origin === ORIGEM_PUBLICADA && e.data?.tipo === 'ccb-recebido') recebido = true; };
  window.addEventListener('message', ouvir);
  for (let i = 0; i < 170 && !recebido && !w.closed; i++) {
    try { w.postMessage({ tipo: 'ccb-transferencia', pacote }, ORIGEM_PUBLICADA); } catch { /* a página ainda está carregando */ }
    await new Promise(ok => setTimeout(ok, 700));
  }
  window.removeEventListener('message', ouvir);
  if (!recebido) throw new Error('A página publicada não respondeu. Use "Exportar cópia dos dados" (em Minha conta) e importe o arquivo lá.');
  estado('Dados enviados. Continue na nova aba: confirme o recebimento, escolha onde ficam os dados e use o botão Instalar.');
}

// Na página publicada: recebe a cópia enviada pelo programa aberto pelo arquivo (sempre com confirmação)
let transferenciaRecebida = false;
function receberTransferencias() {
  window.addEventListener('message', e => {
    if (e.data?.tipo !== 'ccb-transferencia' || transferenciaRecebida) return;
    transferenciaRecebida = true;
    e.source?.postMessage({ tipo: 'ccb-recebido' }, e.origin === 'null' ? '*' : e.origin);
    executar(async () => {
      const p = e.data.pacote;
      if (p?.formato !== 'calculos-cobranca' || typeof p.arquivos !== 'object') throw new Error('Os dados recebidos não estão no formato do programa.');
      const de = e.origin === 'null' ? 'o programa aberto pelo arquivo do computador' : e.origin;
      const ok = await perguntar('Receber os dados', `<p>Chegou uma cópia dos dados de <b>${esc(de)}</b>: <b>${esc(resumoCopia(p.arquivos))}</b>.</p>
        <p>Receber esses dados neste endereço? ${document.body.classList.contains('conectado') ? `Eles serão gravados em <b>${esc(Armaz.descricao())}</b>; se já houver dados, o programa pergunta antes de substituir.` : 'Em seguida, escolha onde ficam os dados (a cópia será gravada lá) e entre com o seu login de sempre.'}</p>`,
        [['sim', 'Receber os dados', 'primario'], ['', 'Recusar']]);
      if (ok !== 'sim') return;
      await IDB.set('kv', 'migracao', { origem: de, modo: 'arquivo', criadoEm: new Date().toISOString(), usuario: null, arquivos: p.arquivos });
      if (document.body.classList.contains('conectado')) { await aplicarMigracaoPendente(); await recarregarTudo(); rotear(); }
      else if (Armaz.modo) await conectado();
      else aviso('Dados recebidos. Agora escolha onde ficam os dados neste endereço.');
    });
  });
}

function prepararInstalacao() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker', e));
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); pedidoInstalacao = e; atualizarBotoesInstalar(); aoLiberarInstalacao?.(); });
  window.addEventListener('appinstalled', () => { pedidoInstalacao = null; atualizarBotoesInstalar(); });
  document.addEventListener('click', e => {
    if (e.target.closest('#btInstalar, #btInstalar2, #btInstalarTopo')) { e.preventDefault(); executar(instalarApp); }
  });
  receberTransferencias();
  atualizarBotoesInstalar();
}

async function iniciar() {
  eventosGlobais();
  prepararInstalacao();
  // Volta do Dropbox depois de autorizar: ?code=...&state=ccb-...
  const q = new URLSearchParams(location.search);
  if (q.get('state')?.startsWith('ccb-') && (q.get('code') || q.get('error'))) {
    history.replaceState(null, '', location.pathname + location.hash);
    if (q.get('error')) return telaConexao('A conexão com o Dropbox foi cancelada.');
    try {
      $('#conteudo').innerHTML = '<p class="carregando">Conectando ao Dropbox…</p>';
      await DBX.concluirEntrada(q.get('code'), q.get('state'));
      if (!DBX.base) return await telaPastaDropbox();
      Armaz.usarDropbox();
      return await conectado();
    } catch (e) { console.error(e); return telaConexao(e.message); }
  }
  const modo = localStorage.getItem('ccb-modo');
  try {
    if (modo === 'dropbox' && DBX.temAcesso()) { Armaz.usarDropbox(); return await conectado(); }
    if (DBX.conectado() && !DBX.base) return await telaPastaDropbox();
    if (modo === 'local') { Armaz.usarLocal(); return await conectado(); }
    if (modo === 'pasta' && await Armaz.retomarPasta(false)) return await conectado();
  } catch (e) { console.error(e); return telaConexao(e.message); }
  // Manual e "Sobre" abrem direto pelo endereço, mesmo sem base escolhida
  if (/^#\/(manual|sobre)/.test(location.hash)) return rotear();
  telaConexao();
}

iniciar();
