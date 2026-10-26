'use strict';
/*
  Simulação de acordo sobre um débito calculado.

  1. Débito: o cálculo atualizado até a data do acordo, item por item (verbas, custas, honorários, multas, art. 523,
     honorários contratuais).
  2. Desconto: sobre o total (R$ ou %) ou verba por verba (R$ ou % em cada item).
  3. Sinal: R$ ou % do valor já com desconto, pago na data do acordo.
  4. Parcelamento mensal do saldo, pela Tabela Price (parcelas iguais), a partir do 1º vencimento informado:
     - com juros até o 1º vencimento: o saldo rende juros (compostos, proporcionais aos dias / 30) da data do acordo
       até o 1º vencimento, e a 1ª parcela já paga esses juros (com 30 dias, é a Tabela Price comum);
     - sem juros até o 1º vencimento: o saldo fica parado até lá; a 1ª parcela não tem juros.
     Em ambos os casos, no 1º vencimento o saldo "SV" é pago em n parcelas antecipadas:
       parcela = SV × i / ((1 − (1 + i)^−n) × (1 + i))     (com i = 0: SV / n)
     Informando o valor da parcela, o número de parcelas é o menor n que quita o saldo; a última é ajustada.
  5. Rateio: cada parcela (e o sinal) é dividida entre o credor e os honorários advocatícios na proporção da
     composição do débito depois do desconto.
  As parcelas ficam em valores da data do acordo; a correção pelo índice escolhido é aplicada até cada pagamento.
*/

const ehHonorario = it => it.grupo === 'honorarios' || it.itemId === 'art523-hon' || it.itemId === 'honContr';

function novoAcordo(dataAcordo) {
  const d = dataAcordo || hoje();
  return { id: novoId(), nome: '', data: d,
    desconto: { modo: 'total', tipo: 'pct', valor: 0, itens: {} },
    sinal: { tipo: 'valor', valor: 0 },
    parcelas: { modo: 'numero', n: 12, valor: 0, taxa: 1, primeiro: diaDoMes(addMes(d.slice(0, 7), 1), +d.slice(8)), jurosAte1: true, indice: 'IPCA' } };
}

// Valor de um desconto ou sinal informado em R$ ou %
const valorDe = (cfg, base) => cfg?.tipo === 'pct' ? base * (Number(cfg.valor) || 0) / 100 : Number(cfg?.valor) || 0;

// Parcela de n pagamentos antecipados (o 1º no vencimento inicial) que quitam o saldo SV
function valorParcela(SV, i, n) {
  if (!(n > 0)) return 0;
  if (!i) return SV / n;
  return SV * i / ((1 - Math.pow(1 + i, -n)) * (1 + i));
}

// Menor número de parcelas de valor P que quita SV (null se a parcela não cobre nem os juros)
function numeroParcelas(SV, i, P) {
  if (!(P > 0)) return null;
  if (!i) return Math.ceil(SV / P - 1e-9);
  const x = 1 - SV * i / (P * (1 + i));
  if (x <= 0) return null;
  return Math.ceil(-Math.log(x) / Math.log(1 + i) - 1e-9);
}

function calcularAcordo(c, a) {
  const data = a.data;
  const r = calcular(c, data);
  // Itens do débito na data do acordo (com os honorários contratuais, no extrajudicial)
  const itens = r.itens.filter(it => it.total > 0).map(it => ({ itemId: it.itemId, grupo: it.grupo, rotulo: it.rotulo, total: it.total }));
  if (r.honContr) itens.push({ itemId: 'honContr', grupo: 'honorarios', rotulo: `Honorários advocatícios contratuais (${fmtPct(r.pctContr)}%)`, total: r.honContr });
  const debito = itens.reduce((s, it) => s + cent(it.total), 0) / 100;

  // Desconto: verba por verba ou sobre o total (rateado proporcionalmente entre os itens)
  const dsc = a.desconto || {};
  if (dsc.modo === 'itens') {
    for (const it of itens) it.desconto = r2(Math.min(it.total, valorDe(dsc.itens?.[it.itemId], it.total)));
  } else {
    const total = Math.min(debito, r2(valorDe(dsc, debito)));
    let resto = cent(total);
    itens.forEach((it, k) => {
      const v = k === itens.length - 1 ? resto : Math.round(cent(total) * it.total / (debito || 1));
      it.desconto = Math.min(cent(it.total), v) / 100;
      resto -= cent(it.desconto);
    });
  }
  itens.forEach(it => { it.liquido = r2(it.total - it.desconto); });
  const desconto = itens.reduce((s, it) => s + cent(it.desconto), 0) / 100;
  const comDesconto = r2(debito - desconto);

  // Rateio entre credor e honorários advocatícios
  const honorarios = itens.filter(ehHonorario).reduce((s, it) => s + cent(it.liquido), 0) / 100;
  const pctHon = comDesconto > 0 ? honorarios / comDesconto : 0;
  const rateio = v => { const h = r2(v * pctHon); return { honorarios: h, credor: r2(v - h) }; };

  const sinal = Math.min(comDesconto, r2(valorDe(a.sinal, comDesconto)));
  const saldo = r2(comDesconto - sinal);

  // Parcelamento
  const p = a.parcelas || {};
  const i = (Number(p.taxa) || 0) / 100;
  const primeiro = ehData(p.primeiro) ? p.primeiro : diaDoMes(addMes(data.slice(0, 7), 1), +data.slice(8));
  const dias = Math.max(0, diasEntre(data, primeiro));
  const jurosAte1 = p.jurosAte1 !== false;
  const SV = jurosAte1 && i ? saldo * Math.pow(1 + i, dias / 30) : saldo;
  const avisos = [];
  let n, parcela;
  if (p.modo === 'valor') {
    parcela = r2(Number(p.valor) || 0);
    n = numeroParcelas(SV, i, parcela);
    if (saldo > 0 && n === null) avisos.push(parcela > 0 ? `A parcela de ${fmtMoeda(parcela)} não cobre os juros do saldo: aumente o valor da parcela ou reduza a taxa.` : 'Informe o valor da parcela.');
  } else {
    n = Math.max(1, Math.round(Number(p.n) || 1));
    parcela = r2(valorParcela(SV, i, n));
  }

  // Cronograma: a 1ª parcela paga os juros até o 1º vencimento (se houver); depois, juros mensais sobre o saldo
  const cronograma = [];
  if (saldo > 0 && n) {
    let s = saldo;
    for (let k = 1; k <= n && k <= 600; k++) {
      const juros = r2(k === 1 ? SV - saldo : s * i);
      let valor = parcela;
      if (k === n || valor >= s + juros) valor = r2(s + juros); // última parcela (ou quitação antecipada)
      const amortizacao = r2(valor - juros);
      s = r2(s - amortizacao);
      cronograma.push({ k, vencimento: diaDoMes(addMes(primeiro.slice(0, 7), k - 1), +primeiro.slice(8)), valor, juros, amortizacao, saldo: s, ...rateio(valor) });
      if (s <= 0) break;
    }
  }
  const totalParcelas = cronograma.reduce((t, x) => t + cent(x.valor), 0) / 100;
  const totalJuros = cronograma.reduce((t, x) => t + cent(x.juros), 0) / 100;
  if (dias < 1 && saldo > 0) avisos.push('O 1º vencimento deve ser posterior à data do acordo.');
  if (avisos.length === 0 && p.modo === 'valor' && n > 1 && cronograma.length && Math.abs(cronograma[cronograma.length - 1].valor - parcela) >= 0.01) {
    avisos.push(`A última parcela fica em ${fmtMoeda(cronograma[cronograma.length - 1].valor)} para quitar o saldo exatamente.`);
  }

  return {
    c, a, r, data, itens, debito, desconto, comDesconto, sinal, saldo, taxa: i, primeiro, dias, jurosAte1, SV: r2(SV),
    n: cronograma.length, parcela, cronograma, totalParcelas, totalJuros, totalPago: r2(sinal + totalParcelas),
    pctHon, sinalRateio: rateio(sinal), honorariosLiquidos: honorarios, indice: p.indice || 'Nenhum',
    avisos: [...avisos, ...notasCalculo(r)],
  };
}

// Valor de uma parcela corrigido da data do acordo até a data do pagamento, pelo índice escolhido
function parcelaCorrigida(ra, valor, dataPagamento) {
  const faltando = new Set();
  const u = { corrDesde: ra.data, regimes: [{ desde: '', indice: ra.indice, juros: 'nenhum' }] };
  const f = fatorParcela(u, dataPagamento, faltando);
  return { fator: f, valor: r2(valor * f), faltando: [...faltando] };
}

function descParcelamento(ra) {
  const p = [];
  p.push(`Data do acordo: ${fmtData(ra.data)}.`);
  if (ra.desconto) p.push(`Desconto de ${fmtMoeda(ra.desconto)} (${fmtPct(Math.round(ra.desconto / (ra.debito || 1) * 1e4) / 100)}% do débito)${ra.a.desconto?.modo === 'itens' ? ', aplicado verba por verba' : ''}.`);
  if (ra.sinal) p.push(`Sinal de ${fmtMoeda(ra.sinal)}, na data do acordo.`);
  if (ra.saldo > 0) {
    p.push(`Saldo de ${fmtMoeda(ra.saldo)} em ${ra.n} parcela(s) mensal(is)${ra.taxa ? `, com juros de ${fmtPct(ra.taxa * 100)}% ao mês (Tabela Price)` : ', sem juros'}, a primeira em ${fmtData(ra.primeiro)}.`);
    if (ra.taxa) p.push(ra.jurosAte1 ? `Juros desde a data do acordo, proporcionais até o 1º vencimento (${ra.dias} dias).` : 'Sem juros até o 1º vencimento; os juros correm a partir dele.');
    p.push(ra.indice && ra.indice !== 'Nenhum' ? `Valores na data do acordo; cada parcela é corrigida ${pelo(ra.indice)} desde a data do acordo até o pagamento.` : 'Parcelas sem correção monetária.');
  }
  if (ra.honorariosLiquidos) p.push(`Rateio: ${fmtPct(Math.round(ra.pctHon * 1e4) / 100)}% de cada pagamento corresponde a honorários advocatícios (proporção no débito com desconto).`);
  return p.join(' ');
}
