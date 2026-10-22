'use strict';
/* Manual de uso (tela "Manual", aberta pelo botão no topo, pelo menu ou pela tela inicial) */

const MANUAL = [
  ['inicio', 'Primeiros passos', `
    <ol>
      <li><b>Escolha onde ficam os dados</b> (tela inicial): Dropbox, pasta do computador ou "Testar sem pasta" (só para experimentar). Veja "Onde ficam os dados".</li>
      <li><b>Crie o administrador</b> no primeiro acesso a uma base nova. Ele cadastra os demais usuários e altera as configurações.</li>
      <li>Em <b>Configurações</b>, preencha os dados do escritório (saem no cabeçalho das planilhas, com o logotipo) e os critérios sugeridos para as novas verbas.</li>
      <li>Cadastre o <b>credor</b> (cliente) em "Credores".</li>
      <li>Crie o <b>cálculo</b> em "Novo cálculo", lance as verbas e os demais itens e salve.</li>
      <li>Escolha a data em "Atualizar até" e gere o <b>PDF</b> ou o <b>Excel</b>.</li>
    </ol>`],

  ['dados', 'Onde ficam os dados', `
    <ul>
      <li><b>Dropbox (pela internet)</b>: funciona no computador e no celular. Você conecta a sua conta do Dropbox e escolhe a pasta da base. Para trabalhar em equipe, use uma pasta compartilhada com todos; cada pessoa conecta a própria conta e escolhe a mesma pasta.</li>
      <li><b>Pasta do computador</b> (Chrome ou Edge): grava direto numa pasta, que pode estar sincronizada pelo Dropbox, OneDrive ou Google Drive.</li>
      <li><b>Somente neste navegador</b>: para testes. Os dados podem ser perdidos se o navegador for limpo.</li>
    </ul>
    <p><b>Mudar de local:</b> em "Minha conta" ou "Configurações", use <b>Mudar o local dos dados…</b>. O programa pergunta se deve levar uma cópia dos dados atuais (cálculos, credores, usuários, configurações e índices). Se o novo local já tiver dados, pergunta de novo: copiar só o que falta ou substituir os arquivos iguais. Nada é apagado do local de origem.</p>
    <p>Cada credor e cada cálculo ficam num arquivo próprio. Os arquivos excluídos vão para a subpasta "lixeira". Se duas pessoas alterarem o mesmo cálculo ao mesmo tempo, o programa avisa e recarrega os dados antes de gravar.</p>`],

  ['calculo', 'Dados do cálculo e devedores', `
    <p>Escolha o credor, o tipo (judicial ou extrajudicial) e preencha os devedores. No judicial, informe o processo, o juízo e, se for usar honorários ou multas sobre o valor da causa, o <b>valor da causa</b> e a <b>data do ajuizamento</b> (termo inicial da correção do valor da causa).</p>
    <p>As observações internas não saem na planilha. "Duplicar" cria uma cópia do cálculo salvo, útil para simular outros critérios.</p>`],

  ['verbas', 'Verbas e critérios de correção e juros', `
    <p>Cada verba é uma linha, com os próprios termos iniciais e critérios:</p>
    <ul>
      <li><b>Valor</b>: o valor originário, em moeda da data do termo inicial da correção.</li>
      <li><b>Correção desde</b>: por exemplo, danos morais desde o arbitramento (Súmula 362 do STJ); danos materiais desde o efetivo prejuízo (Súmula 43 do STJ); dívida contratual desde o vencimento.</li>
      <li><b>Juros desde</b>: por exemplo, responsabilidade extracontratual desde o evento danoso (Súmula 54 do STJ); contratual desde a citação (art. 405 do CC) ou o vencimento da obrigação líquida (art. 397 do CC). Em branco: sem juros.</li>
      <li><b>Índice de correção</b>: UFIR-RJ, IPCA, IGP-M, INPC, IPCA-E ou Nenhum.</li>
      <li><b>Juros</b>: percentual ao mês (simples ou capitalizados, com a taxa ao lado), taxa legal do art. 406 do CC, SELIC (que já inclui a correção; o índice fica desativado) ou sem juros.</li>
      <li><b>Lei 14.905</b>: marcada, a partir de 30/08/2024 a correção passa a ser pelo IPCA e os juros pela taxa legal, qualquer que seja o critério escolhido para o período anterior.</li>
      <li><b>Multa %</b>: multa contratual (cláusula penal moratória), calculada sobre o valor corrigido.</li>
    </ul>
    <p>Uma linha nova já vem com os critérios da linha anterior. Os critérios sugeridos para as primeiras linhas são os do credor ou, se ele não tiver, os das Configurações.</p>
    <p><b>Como o programa calcula:</b> a correção acumula os índices mensais do mês do termo inicial até o mês anterior ao do cálculo (como a Calculadora do Cidadão do Banco Central); a UFIR-RJ usa a divisão entre os valores anuais. Os juros são simples, pro rata die, sobre o valor corrigido.</p>`],

  ['custas', 'Custas e despesas', `
    <p>Uma linha por despesa, com descrição, valor, correção desde (em geral, a data do desembolso) e, se for o caso, juros desde. Os critérios são próprios de cada linha. Para não corrigir uma despesa, escolha o índice "Nenhum".</p>`],

  ['honorarios', 'Honorários sucumbenciais', `
    <ul>
      <li><b>Percentual sobre a condenação</b>: marque as verbas que entram na base e, se for o caso, as custas e as multas. Os honorários acompanham a correção, os juros e a multa de cada verba da base. Pagamentos feitos ao credor não reduzem a base.</li>
      <li><b>Outras bases</b>: use "+ Outra base" para valores que não são verbas do cálculo, como o valor líquido de uma obrigação de fazer, cada um com os próprios termos e critérios.</li>
      <li><b>Percentual sobre o valor da causa</b>: corrigido desde o ajuizamento; juros desde a data informada.</li>
      <li><b>Valor fixo</b>: corrigido desde a fixação; juros desde o trânsito em julgado (art. 85, § 16, do CPC).</li>
    </ul>
    <p>Para incluir majoração recursal, use o percentual total (ex.: 15%) ou um segundo lançamento.</p>`],

  ['multas', 'Multas processuais', `
    <p>Litigância de má-fé, embargos protelatórios, agravo interno, ato atentatório e astreintes. Formas: valor fixo, percentual do valor corrigido da causa ou multa diária (valor por dia, período e teto). Clique na linha para editar; cada multa tem os próprios termos e critérios.</p>`],

  ['art523', 'Multa e honorários do art. 523 do CPC', `
    <p>Marque "Incluir" quando o débito não tiver sido pago no prazo de 15 dias do cumprimento de sentença. A multa e os honorários (10% cada, ajustáveis) incidem sobre o <b>débito atualizado até a data do cálculo</b>.</p>
    <ul>
      <li>Para incluir só a multa (ou só os honorários), desmarque o outro.</li>
      <li>Escolha o que entra na base além das verbas: honorários sucumbenciais da fase de conhecimento, custas e multas processuais.</li>
      <li>Pagamento parcial feito <b>no prazo</b>: na amortização, marque "No prazo do art. 523" para reduzir a base (§ 2º). Os pagamentos sem essa marca não reduzem a base.</li>
    </ul>`],

  ['extra', 'Cobrança extrajudicial', `
    <p>No tipo extrajudicial, as seções de honorários sucumbenciais, multas processuais e art. 523 ficam ocultas, e aparece o percentual de <b>honorários contratuais</b>, aplicado sobre o débito atualizado.</p>`],

  ['amortizacoes', 'Amortizações (pagamentos parciais)', `
    <p>Para cada pagamento, informe a data, o valor, a imputação e de onde abater:</p>
    <ul>
      <li><b>Imputação</b>: "Juros primeiro" (art. 354 do CC: juros e multa vencidos, depois o principal) ou "Principal primeiro".</li>
      <li><b>Abater de — Regras</b>: todos os itens proporcionalmente; os itens mais antigos primeiro; ou <b>custas e despesas primeiro, depois as demais verbas</b> (o que sobrar das custas é rateado proporcionalmente entre os demais itens).</li>
      <li><b>Abater de — Um grupo</b>: só as verbas, só as custas, só os honorários ou só as multas.</li>
      <li><b>Abater de — Um item</b>: uma verba, despesa, honorário ou multa específicos (por exemplo, o pagamento da parte incontroversa de uma verba).</li>
    </ul>
    <p>O débito é atualizado até a data do pagamento e o valor é abatido. Se o item ou grupo escolhido ficar quitado, o que sobrar vai para os demais itens, dos mais antigos para os mais novos. Os juros vencidos e não pagos continuam corrigidos, mas não rendem juros. O PDF traz um demonstrativo de cada pagamento.</p>`],

  ['planilhas', 'Planilhas em PDF e Excel', `
    <p>No quadro "Cálculo", escolha a data em "Atualizar até". O resumo e o detalhamento de cada item aparecem na tela. Use "Visualizar PDF", "Salvar PDF" ou "Salvar Excel" (não é preciso salvar o cálculo antes).</p>
    <p>No judicial, o PDF é o demonstrativo de débito com a memória de cálculo do art. 524 do CPC: índices, taxas, termos iniciais e finais, fatores, juros e amortizações de cada item. No Excel, os itens sem pagamentos e sem capitalização têm fórmulas; os demais trazem os valores calculados.</p>`],

  ['indices', 'Índices', `
    <p>IPCA, IGP-M, INPC, IPCA-E, SELIC e taxa legal são buscados automaticamente no Banco Central. Em Configurações é possível atualizá-los manualmente, informar valores à mão e incluir o valor da UFIR-RJ de cada novo ano (divulgado pela SEFAZ-RJ, normalmente em dezembro).</p>
    <p>Se faltar um índice para algum mês, o programa avisa na tela e na planilha. A SELIC do mês corrente só entra quando o mês termina; até lá, é usada a última taxa divulgada, com aviso.</p>`],

  ['usuarios', 'Usuários e acesso', `
    <p>O administrador cadastra os usuários em "Usuários". O programa gera uma senha provisória e uma mensagem pronta para enviar (WhatsApp ou e-mail); no primeiro acesso, a pessoa cria a senha pessoal. Para bloquear alguém, desmarque "Acesso ativo". Na base no Dropbox, lembre-se de compartilhar a pasta com a pessoa.</p>
    <p>"Desconectar este aparelho" (em Minha conta) sai do login e da conta do Dropbox no aparelho.</p>`],

  ['duvidas', 'Dúvidas comuns', `
    <ul>
      <li><b>Data com ano errado</b>: ao digitar o ano com dois dígitos (ex.: 17), o programa completa (2017). Datas inválidas aparecem num alerta e impedem salvar.</li>
      <li><b>Valor diferente de outra planilha</b>: confira os termos iniciais (correção e juros), o índice, o tipo de juros, a marca da Lei 14.905 e a base do art. 523 e dos honorários.</li>
      <li><b>Programa desatualizado</b>: recarregue a página com Ctrl+F5.</li>
      <li><b>Instalar como aplicativo</b>: use "Instalar o aplicativo" no menu (no iPhone, Compartilhar > Adicionar à Tela de Início).</li>
    </ul>`],
];

function telaManual() {
  const voltar = document.body.classList.contains('conectado') ? '' : '#/';
  $('#conteudo').innerHTML = cabecalho('Manual de uso', 'Como usar o programa, passo a passo.', '', voltar) + `
    <div class="cartao sumario-manual"><h2>Sumário</h2><ol>${MANUAL.map(([k, t]) => `<li><a href="#" data-ir="${k}">${t}</a></li>`).join('')}</ol></div>
    ${MANUAL.map(([k, t, html]) => `<section class="cartao texto-legal" id="man-${k}"><h2>${t}</h2>${html}<p class="dica"><a href="#" data-topo>Voltar ao sumário</a></p></section>`).join('')}`;
  $$('[data-ir]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); $('#man-' + a.dataset.ir).scrollIntoView({ behavior: 'smooth' }); }));
  $$('[data-topo]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
}
