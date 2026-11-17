'use strict';
/* PDF (jsPDF): papel timbrado do escritório, tabelas, resumo, prévia e gravação */
const COR_PRI = [31, 82, 69];
const COR_PRI_ESC = [20, 58, 49];
const COR_OURO = [179, 139, 58];
const COR_OURO_CLARO = [246, 239, 224];
const COR_OURO_TEXTO = [93, 70, 21];
const COR_FUNDO = [231, 241, 237];
const COR_TEXTO = [29, 39, 35];
const COR_SUAVE = [95, 109, 104];

function novoDocumento(paisagem) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: paisagem ? 'landscape' : 'portrait' });
  const P = paisagem ? { doc, M: 14, W: 297, H: 210, larg: 269, y: 0, rodape: 16 } : { doc, M: 14, W: 210, H: 297, larg: 182, y: 0, rodape: 16 };
  const adm = D.config.escritorio || {};

  // Cabeçalho (papel timbrado) repetido em todas as páginas: faixa verde com filete dourado, logo num quadro branco
  P.cab = () => {
    const top = 6;
    let x = P.M, altLogo = 0, logo = null;
    if (adm.logo && adm.logoL && adm.logoA) {
      const e = Math.min(34 / adm.logoL, 15 / adm.logoA);
      logo = { w: adm.logoL * e, h: adm.logoA * e };
      altLogo = logo.h + 4;
      x += logo.w + 4 + 5;
    }
    const larg = P.W - P.M - x;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8);
    const linhas = [
      [adm.documento, adm.oab].filter(Boolean).join('   ·   '),
      adm.endereco,
      [adm.telefone, adm.email, adm.site].filter(Boolean).join('   ·   '),
    ].filter(Boolean).flatMap(l => doc.splitTextToSize(l, larg));
    const altTexto = 5.2 + linhas.length * 3.5;
    const faixa = top + Math.max(altLogo, altTexto) + 5;
    // Degradê horizontal (faixas finas do verde escuro ao verde)
    for (let i = 0, n = 48; i < n; i++) {
      const t = i / (n - 1), cor = COR_PRI_ESC.map((v, k) => Math.round(v + ([44, 110, 92][k] - v) * t));
      doc.setFillColor(...cor); doc.rect(P.W * i / n, 0, P.W / n + 0.3, faixa, 'F');
    }
    doc.setFillColor(...COR_OURO); doc.rect(0, faixa, P.W, 0.9, 'F');
    if (logo) {
      const ly = top + (Math.max(altLogo, altTexto) - altLogo) / 2;
      doc.setFillColor(255, 255, 255); doc.roundedRect(P.M, ly, logo.w + 4, altLogo, 1.6, 1.6, 'F');
      try { doc.addImage(adm.logo, adm.logo.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', P.M + 2, ly + 2, logo.w, logo.h, 'logo', 'FAST'); } catch (err) { console.warn(err); }
    }
    let y = top + (Math.max(altLogo, altTexto) - altTexto) / 2 + 4.6;
    doc.setFont('times', 'bold'); doc.setFontSize(14.5); doc.setTextColor(255, 255, 255);
    doc.text(doc.splitTextToSize(adm.nome || 'Planilha de cobrança', larg)[0], x, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8); doc.setTextColor(214, 232, 225);
    linhas.forEach(l => { y += 3.5; doc.text(l, x, y); });
    P.y = faixa + 7;
    doc.setTextColor(...COR_TEXTO);
  };
  P.novaPagina = () => { doc.addPage(); P.cab(); };
  P.espaco = h => { if (P.y + h > P.H - P.rodape) P.novaPagina(); };
  return P;
}

/*
  Tabela com ajuste automático das colunas.
  cols: [{ t, w, a: 'r' (direita), nw: true (não quebra) }] — colunas à direita (valores) e "nw" (datas) nunca quebram:
  ganham a largura necessária, tirada das colunas de texto; se mesmo assim não couber, a fonte diminui.
  linhas: [{ c: [...], total, grupo }]
*/
function larguraColunas(P, cols, linhas, fs) {
  const { doc } = P, pad = 1.5;
  const soma = cols.reduce((s, c) => s + c.w, 0);
  const w = cols.map(c => c.w * P.larg / soma);
  const min = cols.map((c, j) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(fs - 0.5);
    let m = Math.max(...String(c.t).split(/\s+/).map(p => doc.getTextWidth(p)));
    if (c.a === 'r' || c.nw) {
      for (const ln of linhas) {
        if (ln.grupo) continue;
        doc.setFont('helvetica', ln.total ? 'bold' : 'normal'); doc.setFontSize(fs);
        m = Math.max(m, doc.getTextWidth(String(ln.c[j] ?? '')));
      }
    } else {
      // Colunas de texto quebram entre palavras: a mais longa precisa caber (até 30 mm)
      for (const ln of linhas) {
        if (ln.grupo) continue;
        doc.setFont('helvetica', ln.total ? 'bold' : 'normal'); doc.setFontSize(fs);
        for (const p of String(ln.c[j] ?? '').split(/\s+/)) m = Math.max(m, Math.min(30, doc.getTextWidth(p)));
      }
    }
    return m + 2 * pad + 0.6;
  });
  const falta = w.reduce((s, x, j) => s + Math.max(0, min[j] - x), 0);
  if (!falta) return w;
  const folgas = w.map((x, j) => Math.max(0, x - min[j]));
  const totalFolga = folgas.reduce((s, x) => s + x, 0);
  if (totalFolga < falta) return null;
  return w.map((x, j) => x < min[j] ? min[j] : x - folgas[j] * falta / totalFolga);
}

function tabelaPDF(P, colsIn, linhas, fsMax = 8.5) {
  const { doc } = P;
  let fs = fsMax, larguras = null;
  while (!(larguras = larguraColunas(P, colsIn, linhas, fs)) && fs > 6.5) fs -= 0.5;
  if (!larguras) larguras = colsIn.map(c => c.w * P.larg / colsIn.reduce((s, x) => s + x.w, 0));
  const cols = colsIn.map((c, j) => ({ ...c, w: larguras[j] }));
  const pad = 1.5, lh = fs * 0.3528 * 1.22;
  const quebra = (txt, w, nw) => nw ? [String(txt ?? '')] : doc.splitTextToSize(String(txt ?? ''), w - 2 * pad);
  const escrever = (partes, cs, y) => {
    let x = P.M;
    partes.forEach((p, j) => {
      const c = cs[j];
      p.forEach((t, k) => {
        const ty = y + pad + k * lh + lh * 0.78;
        if (c.a === 'r') doc.text(t, x + c.w - pad, ty, { align: 'right' });
        else if (c.a === 'c') doc.text(t, x + c.w / 2, ty, { align: 'center' });
        else doc.text(t, x + pad, ty);
      });
      x += c.w;
    });
  };
  const desenharCab = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(fs - 0.5);
    const partes = cols.map(c => quebra(c.t, c.w));
    const h = Math.max(...partes.map(p => p.length)) * lh + 2 * pad;
    doc.setFillColor(...COR_PRI); doc.rect(P.M, P.y, P.larg, h, 'F');
    doc.setTextColor(255);
    escrever(partes, cols, P.y);
    P.y += h;
    doc.setTextColor(...COR_TEXTO);
  };

  P.espaco(lh * 4 + 10);
  desenharCab();
  linhas.forEach((ln, i) => {
    const fonte = () => { doc.setFont('helvetica', ln.total || ln.grupo ? 'bold' : (ln.italico ? 'italic' : 'normal')); doc.setFontSize(fs); };
    fonte();
    // Linha de grupo: o primeiro texto ocupa a largura toda da tabela
    const cs = ln.grupo ? [{ w: P.larg }] : cols;
    const partes = ln.grupo ? [quebra(ln.c[0], P.larg)] : ln.c.map((v, j) => quebra(v, cols[j].w, cols[j].a === 'r' || cols[j].nw));
    const h = Math.max(...partes.map(p => p.length)) * lh + 2 * pad;
    if (P.y + h > P.H - P.rodape) { P.novaPagina(); desenharCab(); fonte(); }
    if (ln.total) { doc.setFillColor(...COR_OURO_CLARO); doc.rect(P.M, P.y, P.larg, h, 'F'); doc.setDrawColor(...COR_OURO); doc.setLineWidth(0.35); doc.line(P.M, P.y, P.M + P.larg, P.y); }
    else if (ln.grupo) { doc.setFillColor(...COR_FUNDO); doc.rect(P.M, P.y, P.larg, h, 'F'); }
    else if (i % 2) { doc.setFillColor(247, 250, 249); doc.rect(P.M, P.y, P.larg, h, 'F'); }
    doc.setTextColor(...(ln.total ? COR_OURO_TEXTO : ln.grupo ? COR_PRI : ln.italico ? COR_SUAVE : COR_TEXTO));
    escrever(partes, cs, P.y);
    P.y += h;
    doc.setTextColor(...COR_TEXTO);
    doc.setDrawColor(222, 226, 230); doc.setLineWidth(0.15);
    doc.line(P.M, P.y, P.M + P.larg, P.y);
  });
  P.y += 4;
}

// Linhas "rótulo ....... valor", alinhadas à direita da página; rótulos longos quebram em mais linhas
function resumoPDF(P, itens, larg = 120) {
  const { doc } = P;
  const x0 = P.M + P.larg - larg, lh = 3.6, pad = 0.9;
  const medidas = itens.map(([rot, val, estilo]) => {
    doc.setFont('helvetica', estilo ? 'bold' : 'normal'); doc.setFontSize(8.5);
    const valor = 'R$ ' + fmtNum(val);
    const linhas = doc.splitTextToSize(rot, larg - doc.getTextWidth(valor) - 6);
    return { linhas, valor, h: linhas.length * lh + 2 * pad + (estilo === 'f' ? 0.6 : 0) };
  });
  P.espaco(Math.min(medidas.reduce((s, m) => s + m.h, 0) + 4, P.H - P.rodape - 40));
  itens.forEach(([, , estilo], i) => {
    const { linhas, valor, h } = medidas[i];
    if (P.y + h > P.H - P.rodape) P.novaPagina();
    if (estilo === 'f') { doc.setFillColor(...COR_PRI); doc.rect(x0, P.y, larg, h, 'F'); doc.setTextColor(255); }
    else if (estilo === 'b') { doc.setFillColor(...COR_FUNDO); doc.rect(x0, P.y, larg, h, 'F'); }
    else if (estilo === 'a') doc.setTextColor(179, 38, 30);
    doc.setFont('helvetica', estilo && estilo !== 'a' ? 'bold' : 'normal'); doc.setFontSize(8.5);
    linhas.forEach((l, k) => doc.text(l, x0 + 1.5, P.y + pad + k * lh + 2.8));
    doc.text(valor, x0 + larg - 1.5, P.y + pad + 2.8, { align: 'right' });
    doc.setTextColor(...COR_TEXTO);
    if (!estilo) { doc.setDrawColor(236, 239, 243); doc.setLineWidth(0.1); doc.line(x0, P.y + h, x0 + larg, P.y + h); }
    P.y += h;
  });
  P.y += 4;
}

function paragrafoPDF(P, texto, fs = 8.5, estilo = 'normal', cor = COR_TEXTO) {
  const { doc } = P;
  doc.setFont('helvetica', estilo); doc.setFontSize(fs); doc.setTextColor(...cor);
  const lh = fs * 0.3528 * 1.3;
  for (const l of doc.splitTextToSize(texto, P.larg)) {
    P.espaco(lh);
    doc.text(l, P.M, P.y + lh * 0.8);
    P.y += lh;
  }
  doc.setTextColor(...COR_TEXTO);
}

function subtituloPDF(P, texto, direita) {
  const { doc } = P;
  P.espaco(30); // não deixa o título sozinho no fim da página
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...COR_PRI);
  doc.text(texto, P.M, P.y + 4);
  if (direita) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...COR_SUAVE);
    doc.text(direita, P.M + P.larg, P.y + 4, { align: 'right' });
  }
  doc.setTextColor(...COR_TEXTO);
  P.y += 7;
}

// Título centralizado (serifado, em versalete), filete dourado e linhas de apoio centralizadas
function tituloPDF(P, titulo, linhas = []) {
  const { doc } = P, cx = P.M + P.larg / 2;
  doc.setFont('times', 'bold'); doc.setFontSize(16); doc.setTextColor(...COR_PRI);
  doc.setCharSpace?.(0.35);
  doc.text(titulo.toUpperCase(), cx, P.y + 3.5, { align: 'center' });
  doc.setCharSpace?.(0);
  doc.setFillColor(...COR_OURO); doc.rect(cx - 9, P.y + 6, 18, 0.7, 'F');
  P.y += 9.5;
  linhas.forEach(([t, fs, est, cor]) => {
    doc.setFont('helvetica', est || 'normal'); doc.setFontSize(fs || 9.5); doc.setTextColor(...(cor || COR_TEXTO));
    const lh = (fs || 9.5) * 0.3528 * 1.3;
    for (const l of doc.splitTextToSize(t, P.larg)) { doc.text(l, cx, P.y + lh * 0.8, { align: 'center' }); P.y += lh; }
  });
  doc.setTextColor(...COR_TEXTO);
  P.y += 5;
}

// Quadro-resumo: cartões com os principais valores; o último (total) em destaque
function cartoesPDF(P, cartoes) {
  if (!cartoes.length) return;
  const { doc } = P, gap = 3, n = cartoes.length, w = (P.larg - gap * (n - 1)) / n, h = 13;
  P.espaco(h + 6);
  cartoes.forEach(([rot, val, dest], i) => {
    const x = P.M + i * (w + gap);
    if (dest) { doc.setFillColor(...COR_PRI); doc.roundedRect(x, P.y, w, h, 1.6, 1.6, 'F'); }
    else { doc.setDrawColor(221, 227, 225); doc.setLineWidth(0.25); doc.setFillColor(255, 255, 255); doc.roundedRect(x, P.y, w, h, 1.6, 1.6, 'FD'); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6); doc.setTextColor(...(dest ? [214, 232, 225] : COR_SUAVE));
    doc.text(doc.splitTextToSize(rot.toUpperCase(), w - 6)[0], x + 3, P.y + 4.6);
    doc.setFontSize(dest ? 11.5 : 10.5); doc.setTextColor(...(dest ? [255, 255, 255] : COR_TEXTO));
    doc.text((dest ? 'R$ ' : '') + fmtNum(val), x + 3, P.y + 10.2);
  });
  doc.setTextColor(...COR_TEXTO);
  P.y += h + 6;
}

// Rodapé com data de emissão e numeração
function rodapePDF(P) {
  const { doc } = P;
  const n = doc.getNumberOfPages();
  const agora = new Date();
  const emissao = `Emitido em ${fmtData(hoje())} às ${p2(agora.getHours())}:${p2(agora.getMinutes())}`;
  const adm = D.config.escritorio?.nome || '';
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(...COR_OURO); doc.setLineWidth(0.3);
    doc.line(P.M, P.H - 11, P.W - P.M, P.H - 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2); doc.setTextColor(...COR_SUAVE);
    doc.text(emissao + '  ·  Cálculos de Cobrança', P.M, P.H - 7);
    if (adm) doc.text(adm, P.W / 2, P.H - 7, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...COR_PRI);
    doc.text(`${i} / ${n}`, P.W - P.M, P.H - 7, { align: 'right' });
  }
}

let pdfjsPronto = null;
function carregarScript(src) {
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => falha(new Error('Não foi possível carregar o leitor de PDF.'));
    document.head.appendChild(s);
  });
}

// Aberto direto do disco (file:), o navegador não permite o "worker" do pdf.js: ele roda na própria página
function carregarPdfJs() {
  pdfjsPronto = pdfjsPronto || (async () => {
    await carregarScript('lib/pdf.min.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    if (location.protocol === 'file:') await carregarScript('lib/pdf.worker.min.js');
  })().catch(e => { pdfjsPronto = null; throw e; });
  return pdfjsPronto;
}

// Salva escolhendo a pasta (Chrome/Edge no computador) ou, se não der, na pasta Downloads
async function salvarArquivo(blob, nome, tipo) {
  if (window.showSaveFilePicker) {
    try {
      const ext = nome.split('.').pop();
      const h = await window.showSaveFilePicker({
        suggestedName: nome, id: 'ccb-relatorios',
        types: [{ description: ext === 'pdf' ? 'Documento PDF' : 'Planilha do Excel', accept: { [tipo]: ['.' + ext] } }],
      });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      aviso('Arquivo salvo: ' + h.name);
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.warn('Gravação com escolha de pasta indisponível; usando Downloads.', e);
    }
  }
  baixar(blob, nome);
  aviso('Arquivo salvo na pasta de downloads: ' + nome);
}

const salvarPDF = ({ doc, nome }) => salvarArquivo(doc.output('blob'), nome, 'application/pdf');
const salvarPlanilha = (blob, nome) => salvarArquivo(blob, nome, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

// Prévia do PDF numa janela sobre a tela (funciona também no celular)
async function visualizarPDF({ doc, nome }) {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const arquivo = new File([blob], nome, { type: 'application/pdf' });
  const compartilhar = navigator.canShare?.({ files: [arquivo] });
  abrirModal(`<div class="modal-cab"><h2>Prévia do relatório</h2><button class="bt-x" data-fechar title="Fechar">&times;</button></div>
    ${D.config.escritorio?.nome ? '' : '<p class="alerta">Os dados do escritório ainda não foram preenchidos e não aparecem no cabeçalho. Preencha em <a href="#/config" data-fechar>Configurações</a>.</p>'}
    <div class="barra-previa"><span class="dica">${esc(nome)}</span><span class="espaco"></span>
      <button class="bt primario" id="pvSalvar">Salvar PDF</button>
      ${compartilhar ? '<button class="bt" id="pvCompartilhar">Compartilhar</button>' : ''}
      <a class="bt" href="${url}" target="_blank" rel="noopener">Abrir em nova aba</a></div>
    <div class="previa" id="previa"><p class="carregando">Preparando a prévia…</p></div>`, 'modal-grande');
  $('#pvSalvar').addEventListener('click', () => executar(() => salvarArquivo(blob, nome, 'application/pdf')));
  $('#pvCompartilhar')?.addEventListener('click', () => navigator.share({ files: [arquivo], title: nome }).catch(() => {}));
  const area = $('#previa');
  try {
    await carregarPdfJs();
    const pdf = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
    area.innerHTML = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      if (!document.body.contains(area)) return; // a janela foi fechada
      const pg = await pdf.getPage(i);
      const base = pg.getViewport({ scale: 1 });
      const escala = Math.min(2.5, (area.clientWidth - 24) / base.width * (window.devicePixelRatio || 1));
      const vp = pg.getViewport({ scale: escala });
      const cv = document.createElement('canvas');
      cv.width = vp.width; cv.height = vp.height;
      cv.className = 'pagina-pdf';
      area.appendChild(cv);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    }
  } catch (e) {
    console.warn(e);
    area.innerHTML = `<iframe class="previa-pdf" src="${url}" title="Prévia do PDF"></iframe>`;
  }
}

// Compatibilidade com as chamadas antigas
const mostrarPDF = visualizarPDF;

// Botões "Visualizar" e "Salvar PDF" lado a lado
const botoesPDF = (id, rotulo = 'PDF') => `<button class="bt" id="${id}Ver">Visualizar ${rotulo}</button><button class="bt" id="${id}Salvar">Salvar ${rotulo}</button>`;
function ligarBotoesPDF(id, gerar) {
  $('#' + id + 'Ver')?.addEventListener('click', () => executar(async () => visualizarPDF(await gerar())));
  $('#' + id + 'Salvar')?.addEventListener('click', () => executar(async () => salvarPDF(await gerar())));
}
