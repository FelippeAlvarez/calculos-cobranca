'use strict';
/* Utilidades: formatação, datas, interface */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const p2 = n => String(n).padStart(2, '0');
const cent = v => Math.round((Number(v) || 0) * 100);
const r2 = v => cent(v) / 100;
const fmtNum = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoeda = v => 'R$ ' + fmtNum(v);
const fmtPct = v => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const fmtFator = v => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const comparar = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { numeric: true, sensitivity: 'base' });
const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normalizar = s => semAcento(s).toLowerCase().replace(/\s+/g, ' ').trim();
const soDigitos = s => String(s ?? '').replace(/\D/g, '');

// Aceita "1.234,56", "1234.56", "R$ 1.234,56", números
function parseValor(s) {
  if (typeof s === 'number') return s;
  s = String(s ?? '').replace(/R\$|\s/g, '');
  if (!s) return 0;
  let neg = false;
  if (s.startsWith('-') || /^\(.*\)$/.test(s)) { neg = true; s = s.replace(/^-|[()]/g, ''); }
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (!/^\d+\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : (neg ? -n : n);
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const nomeMes = ym => { if (!ym) return ''; const [a, m] = ym.split('-'); return MESES[+m - 1] + '/' + a; };
const mesNum = ym => ym ? ym.slice(5, 7) + '/' + ym.slice(0, 4) : '';
function addMes(ym, n) {
  let [a, m] = ym.split('-').map(Number);
  m += n;
  while (m > 12) { m -= 12; a++; }
  while (m < 1) { m += 12; a--; }
  return a + '-' + p2(m);
}
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const mesAtual = () => hoje().slice(0, 7);
const fmtData = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
// Só anos de 1900 a 2099 (o campo de data aceita "0017" quando se digita o ano com dois dígitos)
const ehMes = s => /^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(s || '');
const ehData = s => /^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s || '');
const ultimoDia = ym => { const [a, m] = ym.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).getUTCDate(); };
// Dia "d" do mês "ym", limitado ao último dia do mês (ex.: dia 31 em fevereiro)
const diaDoMes = (ym, d) => `${ym}-${p2(Math.min(Math.max(1, +d || 1), ultimoDia(ym)))}`;
function diasEntre(de, ate) {
  const d = s => { const [a, m, dd] = s.split('-').map(Number); return Date.UTC(a, m - 1, dd); };
  return Math.round((d(ate) - d(de)) / 864e5);
}

// CPF/CNPJ formatado (se tiver a quantidade certa de dígitos)
function fmtDoc(s) {
  const d = soDigitos(s);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return String(s ?? '').trim();
}
const rotuloDoc = s => soDigitos(s).length === 14 ? 'CNPJ' : 'CPF';

/* ---------- Interface ---------- */
// Aviso com ícone; opcoes.fixo: fica até ser trocado ou fechado (ex.: progresso); opcoes.acao: [rótulo, função]
function aviso(msg, tipo = 'ok', opcoes = {}) {
  const a = $('#aviso');
  const ic = { ok: 'check', erro: 'alerta', info: 'info', carregando: 'nuvem' }[tipo] || 'info';
  a.innerHTML = `<span class="aviso-ic">${icone(ic)}</span><span class="aviso-txt">${esc(msg)}${tipo === 'carregando' ? '<span class="aviso-prog"><i></i></span>' : ''}</span>`
    + (opcoes.acao ? `<button type="button" class="aviso-acao">${esc(opcoes.acao[0])}</button>` : '')
    + '<button type="button" class="aviso-fechar" title="Fechar">&times;</button>';
  a.className = 'aviso mostrar ' + tipo;
  $('.aviso-fechar', a).onclick = () => { a.className = 'aviso'; };
  if (opcoes.acao) $('.aviso-acao', a).onclick = () => { a.className = 'aviso'; opcoes.acao[1](); };
  clearTimeout(a._t);
  if (!opcoes.fixo) a._t = setTimeout(() => { a.className = 'aviso'; }, tipo === 'erro' ? 9000 : opcoes.acao ? 7000 : 3500);
}
const fecharAviso = tipo => { const a = $('#aviso'); if (!tipo || a.classList.contains(tipo)) a.className = 'aviso'; };

/* ---------- Ícones (traço, 24×24) ---------- */
const ICONES = {
  balanca: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a4 4 0 0 0 6 0L5 7zM19 7l-3 7a4 4 0 0 0 6 0l-3-7z"/>',
  painel: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15v3M8 18h4"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  acordo: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3M3 4h8"/>',
  pessoas: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  engr: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  livro: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  escudo: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  baixar: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  nuvem: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/>',
  ajuda: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  tabela: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  moeda: '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 18V6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  seta: '<path d="m9 18 6-6-6-6"/>',
  martelo: '<path d="m14 13-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10M16 16l6-6M8 8l6-6M9 7l8 8M21 11l-8-8"/>',
  pct: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  alerta: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/>',
  lua: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  'tema-auto': '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  relogio: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  cartao: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  instalar: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18h.01"/>',
  conta: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.66V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.66"/>',
  grade: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  lista: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
};
const icone = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONES[n] || ''}</svg>`;

// Iniciais e cor estável para o "avatar" de um nome
const iniciais = s => (String(s || '').replace(/\b(d[aeo]s?|e|ltda|me|s\.?a\.?|eireli)\b\.?/gi, ' ').match(/\p{L}+/gu) || ['?']).slice(0, 2).map(p => p[0].toUpperCase()).join('');
const CORES_AVATAR = ['#2c6e5c', '#b38b3a', '#4b6fb5', '#8a4f9e', '#b3593a', '#3a8a9e', '#6b7b2c', '#9e3a5e'];
const corDe = s => CORES_AVATAR[[...String(s || '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % CORES_AVATAR.length];

// Valor em reais por extenso (até centenas de bilhões)
function valorPorExtenso(v) {
  const U = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const DZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const CT = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  const ate999 = n => {
    if (n === 100) return 'cem';
    const c = Math.floor(n / 100), r = n % 100, p = [];
    if (c) p.push(CT[c]);
    if (r < 20) { if (r) p.push(U[r]); } else { p.push(DZ[Math.floor(r / 10)] + (r % 10 ? ' e ' + U[r % 10] : '')); }
    return p.join(' e ');
  };
  const inteiro = n => {
    if (!n) return '';
    const esc3 = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
    const grupos = [];
    for (let i = 0; n > 0; i++, n = Math.floor(n / 1000)) grupos.push([n % 1000, i]);
    const partes = grupos.filter(([g]) => g).reverse().map(([g, i]) => i === 1 && g === 1 ? 'mil' : ate999(g) + (i ? ' ' + esc3[i][g > 1 ? 1 : 0] : ''));
    // "e" antes do último grupo quando ele é menor que 100 ou centena exata
    const ult = grupos.find(([g]) => g);
    if (partes.length > 1 && (ult[0] < 100 || ult[0] % 100 === 0)) return partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1];
    return partes.join(', ');
  };
  const c = Math.abs(cent(v)), reais = Math.floor(c / 100), cents = c % 100;
  const de = reais >= 1e6 && reais % 1e6 === 0 ? ' de' : '';
  const r = reais ? inteiro(reais) + de + (reais === 1 ? ' real' : ' reais') : '';
  const ct = cents ? ate999(cents) + (cents === 1 ? ' centavo' : ' centavos') : '';
  return (cent(v) < 0 ? 'menos ' : '') + ([r, ct].filter(Boolean).join(' e ') || 'zero real');
}

/* ---------- Tema claro / escuro ---------- */
const temaEscolhido = () => { try { return localStorage.getItem('ccb-tema') || 'auto'; } catch { return 'auto'; } };
function aplicarTema(t = temaEscolhido()) {
  const escuro = t === 'escuro' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.tema = escuro ? 'escuro' : 'claro';
  $('meta[name=theme-color]')?.setAttribute('content', escuro ? '#0f1715' : '#1f5245');
}
aplicarTema();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => aplicarTema());

class ErroConflito extends Error {
  constructor(m) {
    super(m || 'Este registro foi alterado em outro computador enquanto você editava. Os dados foram recarregados: confira e refaça a alteração.');
    this.conflito = true;
  }
}

async function executar(fn) {
  try { return await fn(); }
  catch (e) {
    console.error(e);
    if (e.name === 'AbortError') return;
    aviso(e.message || String(e), 'erro');
    if (e.conflito) { sujo = false; await recarregarTudo(); rotear(); }
  }
}

function baixar(blob, nome) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

function abrirModal(html, classe = '') {
  $('#modalCaixa').className = 'modal-caixa ' + classe;
  $('#modalCaixa').innerHTML = html;
  $('#modal').hidden = false;
}
function fecharModal() { $('#modal').hidden = true; $('#modalCaixa').innerHTML = ''; }

// Pergunta com botões; devolve a escolha (ou null se fechar)
function perguntar(titulo, html, botoes) {
  return new Promise(ok => {
    abrirModal(`<div class="modal-cab"><h2>${esc(titulo)}</h2><button class="bt-x" data-resp="">&times;</button></div>
      <div>${html}</div><div class="acoes-linha">${botoes.map(([v, r, cls]) => `<button class="bt ${cls || ''}" data-resp="${esc(v)}">${esc(r)}</button>`).join('')}</div>`, 'modal-medio');
    $$('[data-resp]', $('#modalCaixa')).forEach(b => b.addEventListener('click', () => { fecharModal(); ok(b.dataset.resp || null); }));
  });
}

const nomeArquivo = (...partes) => partes.filter(Boolean).join('-').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
