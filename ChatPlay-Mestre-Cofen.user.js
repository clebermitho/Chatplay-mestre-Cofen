// ==UserScript==
// @name         ChatPlay Mestre Cofen
// @namespace    chatplay.mestre.cofen
// @version      1.0.4
// @description  Para o Cofen no ChatPlay do CRM: apresentação automática do Coren (ou pedido de CPF sem vínculo), dados do cliente com copiar, sinalizados com aviso, retomada em lote, pasta na fila, contagem por cliente e WallPaper.
// @author       Elite Team
// @match        https://crm.pagueplay.com.br/*
// @homepageURL  https://github.com/clebermitho/Chatplay-mestre-Cofen
// @updateURL    https://raw.githubusercontent.com/clebermitho/Chatplay-mestre-Cofen/main/ChatPlay-Mestre-Cofen.user.js
// @downloadURL  https://raw.githubusercontent.com/clebermitho/Chatplay-mestre-Cofen/main/ChatPlay-Mestre-Cofen.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
 * ChatPlay Mestre Cofen 1.0.4
 * ============================
 * Sucessor do «AutoMensagem COREN» (v11, do chat antigo) para o ChatPlay do CRM
 * (crm.pagueplay.com.br/chatplay), com as ferramentas do Mestre que servem ao Cofen.
 *
 * O que faz:
 *   - no «Sim» de iniciar, coloca no campo (sem enviar):
 *       com vínculo  → «Bom dia profissional *NOME*… Central de Relacionamento Financeiro do Coren-XX»
 *       sem vínculo  → pedido de CPF para dar continuidade;
 *     a regional (Coren-XX) vem da pasta do cliente ou do canal «(CRXX)» do protocolo;
 *   - aba Atendimento: cliente, CPF, telefone e protocolo com copiar; a mensagem com
 *     Copiar / Colocar no chat / Enviar; botão ✨ ao lado das mensagens rápidas;
 *   - sinalizados com aviso (som, card, notificação), mesmo depois de finalizado;
 *   - retomada em lote, pasta na fila, contagem por cliente, vínculo da última
 *     tabulação no cabeçalho, WallPaper com balões opacos;
 *   - mensagens editáveis (aba Mensagens).
 *
 * Sem calculadora e sem valores de propósito: o ChatPlay manda títulos e acordos de
 * outro produto (BookPlay) para cliente Coren; aqui nada disso é usado.
 *
 * IMPORTANTE: mantenha só um Mestre ligado no Tampermonkey nesta página.
 */

(function () {
  'use strict';

  const VERSAO = '1.0.4';
  /** Carteira desta versão: 'cofen' (crm.pagueplay.com.br) ou 'bookplay' (crm.bookplay.com.br). */
  const CARTEIRA = 'cofen';
  const NOME_CARTEIRA = 'Cofen';
  /** O «ChatPlay Mestre Cofen» é gerado desta base com isto em true. */
  const EH_COFEN = true;
  /** Trava de setores (opcional, vem desligada): existe em todas as versões menos no Cofen. */
  const COM_TRAVA = !EH_COFEN;
  /** Arquivo publicado no GitHub (a versão gerada para uso põe o endereço; vazio = não confere). */
  const URL_ATUALIZACAO = 'https://raw.githubusercontent.com/clebermitho/Chatplay-mestre-Cofen/main/ChatPlay-Mestre-Cofen.user.js';

  // ═══════════════════════════════════════════════════════════════════════
  // 1. NÚCLEO
  // ═══════════════════════════════════════════════════════════════════════

  // ── 1.1 Dinheiro: tudo em centavos inteiros ─────────────────────────────

  const Dinheiro = {
    deNumero(x) {
      const v = Number(x);
      return Number.isFinite(v) ? Math.round(v * 100) : 0;
    },
    deTexto(t) {
      if (typeof t === 'number') return Dinheiro.deNumero(t);
      const s = String(t ?? '').replace(/[^\d,.-]/g, '');
      if (!s) return 0;
      const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
      return Dinheiro.deNumero(parseFloat(normal));
    },
    formatar(c) {
      c = Math.round(Number(c) || 0);
      const neg = c < 0;
      c = Math.abs(c);
      const reais = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      return `${neg ? '-' : ''}R$ ${reais},${String(c % 100).padStart(2, '0')}`;
    },
    paraCampo(c) {
      return Dinheiro.formatar(c).replace('R$ ', '');
    },
    desconto(c, pct) {
      const p = Math.min(Math.max(Number(pct) || 0, 0), 100);
      return Math.round((c * (100 - p)) / 100);
    },
    tetoReal(c) {
      return Math.ceil(c / 100) * 100;
    },
    dividir(c, n, emReais = false) {
      if (!n) return 0;
      return emReais ? Math.ceil(c / (n * 100)) * 100 : Math.round(c / n);
    }
  };

  // ── 1.2 Setores e cálculo das propostas ─────────────────────────────────

  const SETORES = {
    PlayEmDia: { nome: 'Play em dia', tipo: 'emDia', descontos: ['quitacao', 'anuidade', 'semestral', 'juncao2', 'pixAuto'] },
    Play1: { nome: 'Play 1', tipo: 'atraso', descontos: ['quitacao', 'juncao', 'atraso', 'anuidade', 'semestral'] },
    Play2: { nome: 'Play 2', tipo: 'atraso', descontos: ['quitacao', 'juncao', 'atraso', 'anuidade', 'semestral'] },
    Play3: { nome: 'Play 3', tipo: 'atrasoSimples', descontos: ['quitacao', 'juncao', 'atraso'] },
    Play4: { nome: 'Play 4', tipo: 'atrasoSimples', descontos: ['quitacao', 'juncao', 'atraso'] },
    Play5: { nome: 'Play 5', tipo: 'atrasoSimples', descontos: ['quitacao', 'juncao', 'atraso'] },
    Play6: { nome: 'Play 6', tipo: 'atualizado', descontos: ['quitacao'] }
  };
  const ORDEM_SETORES = Object.keys(SETORES);

  /** Descontos de partida (os da Ferramenta 2.6). Cada pessoa ajusta os seus. */
  const DESCONTOS_PADRAO = {
    PlayEmDia: { quitacao: 20, anuidade: 12, semestral: 6, juncao2: 5, pixAuto: 0 },
    Play1: { quitacao: 25, juncao: 12, atraso: 10, anuidade: 18, semestral: 8 },
    Play2: { quitacao: 35, juncao: 18, atraso: 12, anuidade: 25, semestral: 18 },
    Play3: { quitacao: 45, juncao: 15, atraso: 15 },
    Play4: { quitacao: 45, juncao: 15, atraso: 15 },
    Play5: { quitacao: 45, juncao: 15, atraso: 15 },
    Play6: { quitacao: 45 }
  };

  const NOMES_DESCONTO = {
    quitacao: 'Quitação', juncao: 'Junção', atraso: 'Atraso', anuidade: 'Anuidade',
    semestral: 'Semestral', juncao2: 'Junção 2 parc.', pixAuto: 'PIX automático'
  };

  const CAMPOS = {
    atraso: [
      { id: 'totalAberto', rotulo: 'Total em aberto', moeda: true },
      { id: 'valorParcela', rotulo: 'Valor da parcela', moeda: true },
      { id: 'qtdAtraso', rotulo: 'Parcelas em atraso' },
      { id: 'valorAtraso', rotulo: 'Valor em atraso', moeda: true }
    ],
    atualizado: [
      { id: 'totalAberto', rotulo: 'Total sem juros', moeda: true },
      { id: 'totalAtualizado', rotulo: 'Total atualizado', moeda: true }
    ],
    emDia: [
      { id: 'valorParcela', rotulo: 'Valor da parcela', moeda: true },
      { id: 'qtdRestantes', rotulo: 'Parcelas restantes' }
    ]
  };
  CAMPOS.atrasoSimples = CAMPOS.atraso;

  /**
   * O cálculo inteiro, num lugar só. Entrada em centavos.
   * opcoes.parcelasCartao: 12 ou 21 (só a quitação no cartão usa).
   */
  function calcular(setorId, entrada, descontos, opcoes = {}) {
    const setor = SETORES[setorId];
    const D = Dinheiro;
    const pct = k => Number(descontos?.[k]) || 0;
    const e = entrada || {};
    const nx = opcoes.parcelasCartao === 21 ? 21 : 12;
    const moeda = {};
    const numeros = { PARCELAS_CARTAO: nx };
    const condicoes = {};
    let resumo = [];
    if (!setor) return { moeda, numeros, condicoes, resumo };

    if (setor.tipo === 'emDia') {
      const vp = e.valorParcela || 0;
      const q = e.qtdRestantes || 0;
      const total = vp * q;
      const quit = D.desconto(total, pct('quitacao'));
      const anu = D.desconto(vp * 12, pct('anuidade'));
      const sem = D.desconto(vp * 6, pct('semestral'));
      Object.assign(moeda, {
        VALOR_PARCELA: vp,
        QUITACAO_SEM_DESCONTO: total,
        QUITACAO_DESCONTO: quit,
        QUITACAO_12X: D.dividir(quit, nx),
        ANUIDADE_SEM_DESCONTO: vp * 12,
        ANUIDADE_DESCONTO: anu,
        ANUIDADE_12X: D.dividir(anu, 12),
        SEMESTRAL_SEM_DESCONTO: vp * 6,
        SEMESTRAL_DESCONTO: sem,
        SEMESTRAL_6X: D.dividir(sem, 6),
        JUNCAO_SEM_DESCONTO: vp * 2,
        JUNCAO_DESCONTO: D.desconto(vp * 2, pct('juncao2')),
        DESCONTO_PIX_AUTO: D.desconto(vp, pct('pixAuto'))
      });
      numeros.QTD_PARCELAS = q;
      condicoes.TEM_ANUIDADE = q >= 14;
      condicoes.TEM_SEMESTRAL = q >= 8;
      condicoes.TEM_PIX_AUTO = !!opcoes.pixAuto;
      resumo = [
        { rotulo: 'Total', valor: D.formatar(total), tom: 'risco' },
        { rotulo: 'Quitação', valor: D.formatar(quit), tom: 'destaque' },
        { rotulo: 'Parcelas', valor: `${q}× ${D.formatar(vp)}` }
      ];
    } else if (setor.tipo === 'atualizado') {
      const total = e.totalAberto || 0;
      const atualizado = e.totalAtualizado || total;
      const quit = D.tetoReal(D.desconto(total, pct('quitacao')));
      Object.assign(moeda, {
        QUITACAO_SEM_DESCONTO: total,
        QUITACAO_DESCONTO: quit,
        QUITACAO_12X: D.dividir(quit, nx, true),
        VALOR_TOTAL_JUROS: atualizado
      });
      resumo = [
        { rotulo: 'Atualizado', valor: D.formatar(atualizado), tom: 'risco' },
        { rotulo: 'Quitação', valor: D.formatar(quit), tom: 'destaque' },
        { rotulo: `Cartão ${nx}×`, valor: D.formatar(D.dividir(quit, nx, true)) }
      ];
    } else {
      const total = e.totalAberto || 0;
      const vp = e.valorParcela || 0;
      const qtd = e.qtdAtraso || 0;
      const valorAtraso = e.valorAtraso || 0;
      const quit = D.tetoReal(D.desconto(total, pct('quitacao')));
      const anu = D.tetoReal(D.desconto(vp * 12, pct('anuidade')));
      const sem = D.tetoReal(D.desconto(vp * 6, pct('semestral')));
      const juncaoBase = valorAtraso + vp;
      const jun = D.tetoReal(D.desconto(juncaoBase, pct('juncao')));
      const atr = D.tetoReal(D.desconto(valorAtraso, pct('atraso')));
      Object.assign(moeda, {
        VALOR_PARCELA: vp,
        QUITACAO_SEM_DESCONTO: total,
        QUITACAO_DESCONTO: quit,
        QUITACAO_12X: D.dividir(quit, nx, true),
        ANUIDADE_SEM_DESCONTO: vp * 12,
        ANUIDADE_DESCONTO: anu,
        ANUIDADE_12X: D.dividir(anu, 12, true),
        SEMESTRAL_SEM_DESCONTO: vp * 6,
        SEMESTRAL_DESCONTO: sem,
        SEMESTRAL_6X: D.dividir(sem, 6, true),
        JUNCAO_SEM_DESCONTO: juncaoBase,
        JUNCAO_DESCONTO: jun,
        ATRASO_SEM_DESCONTO: valorAtraso,
        PARCELA_ATRASO: atr
      });
      numeros.QTD_PARCELAS_ATRASO = qtd;
      // Cada opção só aparece se existir de verdade e sair mais barata que a
      // quitação; todas comparam o valor JÁ COM desconto.
      condicoes.TEM_ANUIDADE = vp > 0 && total >= vp * 14 && anu < quit;
      condicoes.TEM_SEMESTRAL = vp > 0 && total >= vp * 8 && sem < quit;
      condicoes.TEM_JUNCAO = valorAtraso > 0 && jun < quit;
      condicoes.TEM_ATRASO = valorAtraso > 0 && atr < quit;
      resumo = [
        { rotulo: 'Total', valor: D.formatar(total), tom: 'risco' },
        { rotulo: 'Quitação', valor: D.formatar(quit), tom: 'destaque' },
        { rotulo: `Atraso (${qtd}×)`, valor: D.formatar(atr) }
      ];
    }
    return { moeda, numeros, condicoes, resumo };
  }

  /** Setor pelo «Setor Vinculado» do cliente (regra da Ferramenta 2.6). */
  function setorPeloVinculo(setorVinculado, temAtraso) {
    const sv = String(setorVinculado || '').toUpperCase();
    const play = sv.match(/PLAY\s*([1-6])(?!\d)/) || sv.match(/\bCOB\s+([1-6])(?!\d)/); // «COB PLAY 2» ou o antigo «COB 2»
    if (play) return 'Play' + play[1];
    if (sv.includes('EM DIA')) return 'PlayEmDia';
    if (sv.includes('JORNADA') || sv.includes('RECEPTIVO')) return temAtraso ? 'Play1' : 'PlayEmDia';
    return null;
  }

  /** Setor pelo NOME DA PASTA, só quando ela diz: «Play 3 SV» → Play3, «Em dia» → PlayEmDia. */
  function setorDaPasta(pasta) {
    const p = String(pasta || '').toUpperCase();
    const n = p.match(/PLAY\s*([1-6])(?!\d)/);
    if (n) return 'Play' + n[1];
    return /EM\s+DIA/.test(p) ? 'PlayEmDia' : null;
  }

  // ── 1.3 Modelos de mensagem ─────────────────────────────────────────────
  //   {{VARIAVEL}}               troca pelo valor
  //   {{N}}                      número da opção: 1️⃣, 2️⃣, 3️⃣… na ordem em que aparece
  //   {{#TEM_X}} … {{/TEM_X}}    só aparece quando a condição vale
  //   {{^TEM_X}} … {{/TEM_X}}    só aparece quando a condição NÃO vale

  function emojiNumero(n) {
    return String(n).split('').map(d => `${d}\uFE0F\u20E3`).join('');
  }

  function renderizarModelo(texto, variaveis, condicoes) {
    let s = String(texto || '').replace(/\r\n/g, '\n');
    for (let i = 0; i < 6; i++) {
      const novo = s.replace(
        /\{\{([#^])([A-Z0-9_]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g,
        (_, tipo, nome, dentro) => ((tipo === '#') === !!condicoes?.[nome] ? dentro : '')
      );
      if (novo === s) break;
      s = novo;
    }
    let n = 0;
    s = s.replace(/\{\{N\}\}/g, () => emojiNumero(++n));
    s = s.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) =>
      variaveis && Object.prototype.hasOwnProperty.call(variaveis, k) ? String(variaveis[k]) : m
    );
    // Coren é «o Conselho»: «da *Coren-PE*» vira «do *Coren-PE*», também nos modelos editados
    s = s.replace(/\b([Dd])a(\s+\*?)(Coren-[A-Z]{2})\b/g, (_, d, meio, coren) => (d === 'D' ? 'Do' : 'do') + meio + coren);
    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /** «Bom dia / Boa tarde / Boa noite» certo para a hora, mantendo maiúsculas. */
  function saudacaoDaHora(quando = new Date()) {
    const h = quando.getHours();
    return h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
  }
  function corrigirSaudacao(texto, quando = new Date()) {
    const certa = saudacaoDaHora(quando).toLowerCase();
    return String(texto).replace(/\b(bom\s+dia|boa\s+tarde|boa\s+noite)\b/gi, achado => {
      if (achado === achado.toUpperCase()) return certa.toUpperCase();
      if (achado[0] === achado[0].toUpperCase()) return certa[0].toUpperCase() + certa.slice(1);
      return certa;
    });
  }

  /*
   * Tipos de mensagem. `setores` de um modelo diz onde ele vale: um setor da
   * calculadora (Play1…) ou um destes tipos.
   */
  const TIPOS_MENSAGEM = {
    abordagem: 'Abordagem',
    acordo: 'Abordagem com acordo',
    quebra: 'Quebra de acordo',
    negociacao: 'Negociação em andamento',
    recuperacao: 'Recuperação',
    pix: 'Instruções PIX',
    cartao: 'Instruções cartão'
  };
  const TIPOS_ABORDAGEM = ['abordagem', 'acordo', 'quebra', 'negociacao'];
  /** Mensagens do Cofen (o que cada modelo pode ser). */
  const TIPOS_COFEN = {
    apresentacao: 'Apresentação (com vínculo)',
    cpf: 'Pedido de CPF (sem vínculo)',
    recuperacao: 'Retomada'
  };
  const nomeDoAlvo = id => TIPOS_COFEN[id] || SETORES[id]?.nome || TIPOS_MENSAGEM[id] || id;
  const tipoDoAlvo = id => (SETORES[id] ? SETORES[id].tipo : id);

  const TODOS_ATRASO = ['atraso', 'atrasoSimples'];
  const CALCULO = ['atraso', 'atrasoSimples', 'atualizado', 'emDia'];
  const VARIAVEIS = [
    { nome: 'QUITACAO_SEM_DESCONTO', desc: 'Total sem desconto', tipos: CALCULO },
    { nome: 'QUITACAO_DESCONTO', desc: 'Quitação com desconto', tipos: CALCULO },
    { nome: 'QUITACAO_12X', desc: 'Parcela da quitação no cartão (12× ou 21×)', tipos: CALCULO },
    { nome: 'PARCELAS_CARTAO', desc: 'Vezes no cartão: 12 ou 21', tipos: CALCULO },
    { nome: 'VALOR_TOTAL_JUROS', desc: 'Débito atualizado (com juros)', tipos: ['atualizado'] },
    { nome: 'VALOR_PARCELA', desc: 'Valor da parcela', tipos: [...TODOS_ATRASO, 'emDia'] },
    { nome: 'QTD_PARCELAS_ATRASO', desc: 'Quantas parcelas em atraso', tipos: TODOS_ATRASO },
    { nome: 'ATRASO_SEM_DESCONTO', desc: 'Atraso sem desconto', tipos: TODOS_ATRASO },
    { nome: 'PARCELA_ATRASO', desc: 'Atraso com desconto', tipos: TODOS_ATRASO },
    { nome: 'JUNCAO_SEM_DESCONTO', desc: 'Junção sem desconto', tipos: [...TODOS_ATRASO, 'emDia'] },
    { nome: 'JUNCAO_DESCONTO', desc: 'Junção com desconto', tipos: [...TODOS_ATRASO, 'emDia'] },
    { nome: 'ANUIDADE_SEM_DESCONTO', desc: 'Anuidade sem desconto', tipos: [...TODOS_ATRASO, 'emDia'] },
    { nome: 'ANUIDADE_DESCONTO', desc: 'Anuidade com desconto', tipos: [...TODOS_ATRASO, 'emDia'] },
    { nome: 'ANUIDADE_12X', desc: 'Anuidade em 12×', tipos: [...TODOS_ATRASO, 'emDia'] },
    { nome: 'SEMESTRAL_SEM_DESCONTO', desc: 'Semestral sem desconto', tipos: [...TODOS_ATRASO, 'emDia'] },
    { nome: 'SEMESTRAL_DESCONTO', desc: 'Semestral com desconto', tipos: [...TODOS_ATRASO, 'emDia'] },
    { nome: 'SEMESTRAL_6X', desc: 'Semestral em 6×', tipos: [...TODOS_ATRASO, 'emDia'] },
    { nome: 'QTD_PARCELAS', desc: 'Parcelas restantes', tipos: ['emDia'] },
    { nome: 'DESCONTO_PIX_AUTO', desc: 'Parcela no PIX automático', tipos: ['emDia'] },
    { nome: 'PARCELAS_VENCIDAS', desc: 'Parcelas vencidas', tipos: TIPOS_ABORDAGEM },
    { nome: 'PALAVRA_PARCELAS', desc: '«parcela» ou «parcelas»', tipos: TIPOS_ABORDAGEM },
    { nome: 'ACORDO_VALOR', desc: 'Valor do acordo', tipos: ['acordo', 'quebra'] },
    { nome: 'ACORDO_CARTAO', desc: 'Parcela do acordo no cartão (12× ou 21×)', tipos: ['acordo', 'quebra'] },
    { nome: 'ACORDO_PARCELAS', desc: 'Vezes do acordo no cartão: 12 ou 21', tipos: ['acordo', 'quebra'] },
    { nome: 'ACORDO_VENCIMENTO', desc: 'Vencimento do acordo (dd/mm)', tipos: ['acordo', 'quebra'] },
    { nome: 'PROX_CONTATO', desc: 'Próximo contato combinado (dd/mm/aaaa)', tipos: ['negociacao'] },
    { nome: 'SETOR_CLIENTE', desc: 'Setor do cliente (pela qualidade ou vínculo)', tipos: TIPOS_ABORDAGEM }
  ];
  const VARIAVEIS_GERAIS = [
    { nome: 'SAUDACAO', desc: 'Bom dia / Boa tarde / Boa noite' },
    { nome: 'NOME', desc: 'Nome completo do cliente' },
    { nome: 'PRIMEIRO_NOME', desc: 'Primeiro nome' },
    { nome: 'OPERADOR', desc: 'Seu nome (Ajustes)' },
    { nome: 'CONTRATO', desc: 'Nrdoc do contrato' },
    { nome: 'DIAS_ATRASO', desc: 'Dias em atraso' },
    { nome: 'INSTITUICAO', desc: 'Instituição do cliente' },
    { nome: 'PROTOCOLO', desc: 'Número do protocolo' },
    { nome: 'SAC', desc: 'Telefone do SAC' },
    { nome: 'HOJE', desc: 'Data de hoje' },
    { nome: 'CPF', desc: 'CPF do cliente' },
    { nome: 'TELEFONE', desc: 'Telefone do cliente' }
  ];
  const CONDICOES = [
    { nome: 'TEM_ATRASO', desc: 'Atraso com desconto sai mais barato', tipos: TODOS_ATRASO },
    { nome: 'TEM_JUNCAO', desc: 'Junção sai mais barata', tipos: TODOS_ATRASO },
    { nome: 'TEM_ANUIDADE', desc: 'Anuidade disponível', tipos: [...TODOS_ATRASO, 'emDia'] },
    { nome: 'TEM_SEMESTRAL', desc: 'Semestral disponível', tipos: [...TODOS_ATRASO, 'emDia'] },
    { nome: 'TEM_PIX_AUTO', desc: 'PIX automático ligado', tipos: ['emDia'] },
    { nome: 'TEM_PARCELAS_VENCIDAS', desc: 'Tem parcelas vencidas', tipos: TIPOS_ABORDAGEM },
    { nome: 'TEM_PROTOCOLO', desc: 'Protocolo encontrado', tipos: TIPOS_ABORDAGEM },
    { nome: 'TEM_PROX_CONTATO', desc: 'Próximo contato ainda por vir', tipos: ['negociacao'] },
    { nome: 'ACORDO_PARCELADO', desc: 'Acordo em parcelas (oferece a quitação com desconto)', tipos: ['acordo', 'quebra'] }
  ];

  const PERGUNTA_FINAL = '*Qual a melhor opção para negociar hoje e receber o desconto?*';
  const OPCOES_QUITACAO =
    '*{{N}} - Quitação* à vista no *Boleto* ou *PIX* de *{{QUITACAO_SEM_DESCONTO}}* por apenas *{{QUITACAO_DESCONTO}}*\n\n' +
    '*{{N}} - Quitação* no *Cartão de Crédito* ficando em até *{{PARCELAS_CARTAO}}x de {{QUITACAO_12X}}* por mês. (Podendo ser cartão de terceiros)\n\n';
  const APRESENTACAO =
    'Olá, *{{NOME}}*.\n' +
    'Meu nome é *{{OPERADOR}}*, represento o departamento de acordos da *{{INSTITUICAO}}*.\n' +
    'Esse canal é exclusivo para negociação de débitos.';

  /** As mensagens que já existiam, como modelos. Não se editam; duplicam-se. */
  const MODELOS_FIXOS = [
    {
      id: 'padrao:emdia', titulo: 'Proposta padrão', setores: ['PlayEmDia'], fixo: true,
      texto:
        'No momento você tem {{QTD_PARCELAS}} parcelas restantes no valor de {{VALOR_PARCELA}}.\n\n' +
        OPCOES_QUITACAO +
        '{{#TEM_ANUIDADE}}*{{N}} - Anuidade* (12 parcelas) de *{{ANUIDADE_SEM_DESCONTO}}* por *{{ANUIDADE_DESCONTO}}* à vista via PIX ou no cartão de crédito em 12x de *{{ANUIDADE_12X}}*\n\n{{/TEM_ANUIDADE}}' +
        '{{#TEM_SEMESTRAL}}*{{N}} - Semestral* (6 parcelas) de *{{SEMESTRAL_SEM_DESCONTO}}* por *{{SEMESTRAL_DESCONTO}}* à vista via PIX ou no cartão de crédito em 6x de *{{SEMESTRAL_6X}}*\n\n{{/TEM_SEMESTRAL}}' +
        '*{{N}} - JUNÇÃO DE 2 PARCELAS* de *{{JUNCAO_SEM_DESCONTO}}* por *{{JUNCAO_DESCONTO}}* no PIX/BOLETO ou no cartão de crédito parcelado. Vencimento: HOJE\n\n' +
        '{{#TEM_PIX_AUTO}}*{{N}} - PIX Automático* em *{{QTD_PARCELAS}}x {{DESCONTO_PIX_AUTO}}* (via PIX todo mês com desconto).\n\n{{/TEM_PIX_AUTO}}' +
        PERGUNTA_FINAL
    },
    {
      id: 'padrao:play12', titulo: 'Proposta padrão', setores: ['Play1', 'Play2'], fixo: true,
      texto:
        'Segue as propostas que temos hoje vigentes para seu contrato:\n\n' +
        OPCOES_QUITACAO +
        '{{#TEM_ANUIDADE}}*{{N}} - Anuidade* (12 parcelas) de *{{ANUIDADE_SEM_DESCONTO}}* por *{{ANUIDADE_DESCONTO}}* à vista via PIX ou no cartão de crédito em 12x de *{{ANUIDADE_12X}}*\n\n{{/TEM_ANUIDADE}}' +
        '{{#TEM_SEMESTRAL}}*{{N}} - Semestral* (6 parcelas) de *{{SEMESTRAL_SEM_DESCONTO}}* por *{{SEMESTRAL_DESCONTO}}* à vista via PIX ou no cartão de crédito em 6x de *{{SEMESTRAL_6X}}*\n\n{{/TEM_SEMESTRAL}}' +
        '{{#TEM_JUNCAO}}*{{N}} - Junção* (parcelas em atraso + a vencer) de *{{JUNCAO_SEM_DESCONTO}}* por *{{JUNCAO_DESCONTO}}* Vencimento: *HOJE*\n\n{{/TEM_JUNCAO}}' +
        '{{#TEM_ATRASO}}*{{N}} - Regularizar parcelas em atraso* no valor de *{{PARCELA_ATRASO}}* (PIX ou cartão de crédito)\n\n{{/TEM_ATRASO}}' +
        PERGUNTA_FINAL
    },
    {
      id: 'padrao:play345', titulo: 'Proposta padrão', setores: ['Play3', 'Play4', 'Play5'], fixo: true,
      texto:
        'Segue as propostas que temos hoje vigentes para seu contrato:\n\n' +
        OPCOES_QUITACAO +
        '{{#TEM_ATRASO}}*{{N}} - Parcela em atraso* por *{{PARCELA_ATRASO}}* via pix/cartão HOJE\n\n{{/TEM_ATRASO}}' +
        '*{{N}} - Contraproposta da parte do Cliente*\n\n' +
        'Qual a melhor opção para negociar hoje e receber o desconto?'
    },
    {
      id: 'padrao:play6', titulo: 'Proposta padrão', setores: ['Play6'], fixo: true,
      texto:
        'Valor do débito atualizado: *{{VALOR_TOTAL_JUROS}}* ⚠️\n\n' +
        '{{N}} Quitação no PIX: *{{QUITACAO_DESCONTO}} vencimento HOJE* 💠\n' +
        '{{N}} Quitação no Cartão: até em {{PARCELAS_CARTAO}}x de *{{QUITACAO_12X}} podendo ser de terceiros* 💳\n' +
        '{{N}} *Contraproposta da parte do Cliente*\n\n' +
        PERGUNTA_FINAL
    },
    {
      id: 'padrao:abordagem', titulo: 'Abordagem padrão', setores: ['abordagem'], fixo: true,
      texto:
        APRESENTACAO +
        '{{#TEM_PARCELAS_VENCIDAS}}\n\nVerificamos que existe *{{PARCELAS_VENCIDAS}}* {{PALAVRA_PARCELAS}} em aberto no nosso sistema.{{/TEM_PARCELAS_VENCIDAS}}' +
        '{{#TEM_PROTOCOLO}}\n*Número do protocolo de atendimento: {{PROTOCOLO}}*{{/TEM_PROTOCOLO}}'
        // Sem SAC e sem site de propósito: se o cliente liga ou entra no PaguePlay antes do registro
        // produtivo, o operador perde o cliente no ChatPlay.
    },
    {
      id: 'padrao:acordo', titulo: 'Acordo em dia', setores: ['acordo'], fixo: true,
      texto:
        APRESENTACAO + '\n' +
        '{{#TEM_PROTOCOLO}}*Número do protocolo de atendimento: {{PROTOCOLO}}*\n{{/TEM_PROTOCOLO}}\n' +
        'Verificamos que você tem um acordo formalizado conosco, no valor de *{{ACORDO_VALOR}}* com o vencimento para dia {{ACORDO_VENCIMENTO}}.\n\n' +
        'Você gostaria de transferir o pagamento pelo pix ou para o cartão?\n\n' +
        '*Opção 1:* Pagamento via pix no valor de *{{ACORDO_VALOR}}*\n' +
        '*Opção 2:* Pagamento via cartão de crédito em *{{ACORDO_PARCELAS}}x* de *{{ACORDO_CARTAO}}*\n' +
        '{{#ACORDO_PARCELADO}}*Opção 3:* Verificar o melhor desconto para quitação hoje\n{{/ACORDO_PARCELADO}}\n' +
        'Como podemos concluir? 😊'
    },
    {
      id: 'padrao:quebra', titulo: 'Quebra de acordo', setores: ['quebra'], fixo: true,
      texto:
        APRESENTACAO + '\n' +
        '{{#TEM_PROTOCOLO}}*Número do protocolo de atendimento: {{PROTOCOLO}}*\n{{/TEM_PROTOCOLO}}\n' +
        'Verificamos que você tinha um acordo formalizado conosco, no valor de *{{ACORDO_VALOR}}*, com vencimento para o dia {{ACORDO_VENCIMENTO}}, e consta uma *quebra de acordo*, pois o pagamento não foi identificado.\n\n' +
        'Você gostaria de transferir o pagamento para o cartão de crédito?\n\n' +
        '*Opção 1:* Pagamento via pix no valor de *{{ACORDO_VALOR}}*\n' +
        '*Opção 2:* Pagamento via cartão de crédito em *{{ACORDO_PARCELAS}}x* de *{{ACORDO_CARTAO}}*\n' +
        '{{#ACORDO_PARCELADO}}*Opção 3:* Verificar o melhor desconto para quitação hoje\n{{/ACORDO_PARCELADO}}\n' +
        'Como podemos concluir? 😊'
    },
    {
      id: 'padrao:negociacao', titulo: 'Retomar negociação', setores: ['negociacao'], fixo: true,
      texto:
        APRESENTACAO + '\n' +
        '{{#TEM_PROTOCOLO}}*Número do protocolo de atendimento: {{PROTOCOLO}}*\n{{/TEM_PROTOCOLO}}\n' +
        'Vi que estávamos em negociação{{#TEM_PROX_CONTATO}} e tínhamos combinado de falar novamente em *{{PROX_CONTATO}}*{{/TEM_PROX_CONTATO}}.\n\n' +
        'Vamos dar continuidade? Posso te passar agora as melhores condições para regularizar o seu contrato. 😊'
    },
    {
      id: 'padrao:recuperacao', titulo: 'Recuperação padrão', setores: ['recuperacao'], fixo: true,
      texto: '{{SAUDACAO}}, tudo bem? Me chamo {{OPERADOR}}, darei continuidade em seu atendimento, qual a melhor opção no momento?\n\n1- Continuidade no atendimento.\n2- Encerrar o atendimento.'
    },
    {
      id: 'padrao:pix', titulo: 'Como pagar no PIX', setores: ['pix'], fixo: true,
      texto:
        '⚠️ IMPORTANTE: Confirme se o nome do titular está correto! ✅\n\n' +
        '1️⃣ - Confirme seu nome e selecione "PIX".\n\n2️⃣ - Gere a chave PIX e copie.\n\n3️⃣ - Abra seu app e selecione "PIX Copia e Cola".\n\n' +
        '⏰ Atenção: O link expira em *10 minutos* por motivos de segurança. Se precisar de mais tempo, nos avise ou envie "OK" para estender o prazo.\n\n' +
        '✅ Acordo formalizado com sucesso! Ao realizar o pagamento, você evita transtornos em seu CPF, como negativação, além de interromper as ligações, juros e multas.'
    },
    {
      id: 'padrao:cartao', titulo: 'Como pagar no cartão', setores: ['cartao'], fixo: true,
      texto:
        '1️⃣ Clique no link para abrir a página de pagamento:\n\n2️⃣ Confira os dados do pagamento (nome, valor e descrição).\n\n' +
        '3️⃣ Selecione a opção: 💳 *Cartão de Crédito*\n\n4️⃣ Preencha os dados do seu cartão:\n🔹 Número do cartão\n🔹 Nome completo (como está no cartão)\n🔹 Validade (mês/ano)\n🔹 Código de segurança (3 dígitos no verso)\n\n' +
        '5️⃣ *Escolha o número de parcelas desejado (até 24x sem juros).*\n\n6️⃣ Clique em Pagar ou Finalizar pagamento ✅\n\n7️⃣ Aguarde a confirmação e salve o comprovante.\n\n' +
        '⏰ Atenção: O link expira em *10 minutos* por motivos de segurança. Se precisar de mais tempo, nos avise ou envie "OK" para estender o prazo.\n\n' +
        '📞 Qualquer dúvida ou erro na hora de pagar, me chame aqui que te ajudo!'
    },
  ];

  /** Variáveis das mensagens do Cofen. */
  const VARIAVEIS_COFEN = [
    { nome: 'SAUDACAO', desc: 'Bom dia / Boa tarde / Boa noite' },
    { nome: 'NOME', desc: 'Nome do profissional (cadastro vinculado)' },
    { nome: 'PRIMEIRO_NOME', desc: 'Primeiro nome' },
    { nome: 'OPERADOR', desc: 'Seu nome (Ajustes)' },
    { nome: 'COREN', desc: 'Regional: Coren-PA, Coren-SP…' },
    { nome: 'DO_COREN', desc: '«do Coren-PA» (ou «do Coren»)' },
    { nome: 'CPF', desc: 'CPF do profissional' },
    { nome: 'TELEFONE', desc: 'Telefone do contato' },
    { nome: 'PROTOCOLO', desc: 'Protocolo do atendimento' },
    { nome: 'HOJE', desc: 'Data de hoje' }
  ];
  /** As mensagens do AutoMensagem COREN v11, como modelos. Não se editam; duplicam-se. */
  const MODELOS_COFEN = [
    {
      id: 'cofen:apresentacao', titulo: 'Apresentação Coren', setores: ['apresentacao'], fixo: true,
      texto: '{{SAUDACAO}} profissional *{{NOME}}*, tudo bem?\nMeu nome é {{OPERADOR}}, falo pela Central de Relacionamento Financeiro {{DO_COREN}}.'
    },
    {
      id: 'cofen:cpf', titulo: 'Pedido de CPF', setores: ['cpf'], fixo: true,
      texto: 'Meu nome é {{OPERADOR}}, falo pela Central de Relacionamento Financeiro {{DO_COREN}}.\n\nProfissional informe o CPF para dar continuidade ao atendimento.'
    },
    {
      id: 'cofen:recuperacao', titulo: 'Retomada padrão', setores: ['recuperacao'], fixo: true,
      texto: '{{SAUDACAO}}, tudo bem? Me chamo {{OPERADOR}}, darei continuidade em seu atendimento, qual a melhor opção no momento?\n\n1- Continuidade no atendimento.\n2- Encerrar o atendimento.'
    }
  ];

  /** Recuperação aleatória: abertura + opção 1 + opção 2 sorteadas (iguais à Ferramenta). */
  const REC_ABERTURAS = [
    'Boa noite, tudo bem? Me chamo {nome}, darei continuidade em seu atendimento. Qual a melhor opção no momento?',
    'Boa noite! Aqui é {nome}, vou dar sequência ao seu atendimento. Como prefere seguir?',
    'Boa noite, tudo certo? Sou {nome} e vou continuar o seu atendimento. Podemos seguir de onde paramos?',
    'Boa noite! Me chamo {nome} e estou retomando o seu atendimento. Ainda posso te ajudar?',
    'Boa noite, tudo bem? Aqui é {nome}. Vi que nossa conversa ficou parada e quero te ajudar a concluir. O que prefere?',
    'Boa noite! Sou {nome} e vou dar continuidade ao seu atendimento por aqui. Qual opção fica melhor para você agora?',
    'Boa noite, como vai? Me chamo {nome} e estou à disposição para continuar o seu atendimento. Como deseja prosseguir?',
    'Boa noite! Aqui é {nome}, retomando o seu atendimento. Responda com o número da opção:'
  ];
  const REC_OPCAO1 = ['Verificar os descontos disponíveis.', 'Tenho interesse nos descontos.', 'Continuidade no atendimento.'];
  const REC_OPCAO2 = ['Encerrar o atendimento.', 'Finalizar o atendimento.'];
  const sortear = lista => lista[Math.floor(Math.random() * lista.length)];
  function mensagemRecAleatoria(nome) {
    return sortear(REC_ABERTURAS).replace('{nome}', nome) + '\n\n1- ' + sortear(REC_OPCAO1) + '\n2- ' + sortear(REC_OPCAO2);
  }

  // ── 1.4 Leitura das respostas da API ────────────────────────────────────

  const EMPRESAS = {
    mundial: { rotulo: 'Mundial Editora', sac: '0800 779 4000' },
    faculbookplay: { rotulo: 'Faculdade Bookplay', sac: '0800 777 2020' },
    bookplay: { rotulo: 'Bookplay', sac: '0800 779 6000' },
    pagueplay: { rotulo: 'Pagueplay', sac: '0800 779 6000' }
  };
  const SIGLAS = { FACB: 'faculbookplay', MUND: 'mundial', PAGP: 'pagueplay', BOOK: 'bookplay' };
  const SAC_EXTRA = { 'Faculdade Play': '0800 777 2020', 'Faculdade Alfa América': '0800 777 2020' };
  const sacDe = rotulo => Object.values(EMPRESAS).find(e => e.rotulo === rotulo)?.sac || SAC_EXTRA[rotulo] || '0800 779 6000';

  /** departmentId → pasta (a Ferramenta tinha esta tabela; o socket ensina o resto). */
  const PASTAS = {
    92: 'Mundial / Play Receptivo', 110: 'Mundial / Play 6', 112: 'Mundial / Play Marília BR',
    115: 'Bookplay / Multiplay', 116: 'Bookplay / Play 1', 117: 'Bookplay / Play 2', 118: 'Bookplay / Play 3',
    122: 'Bookplay / Play Marília', 125: 'FBP / Multiplay', 126: 'FBP / Play 1', 127: 'FBP / Play 2', 128: 'FBP / Play 3',
    145: 'Bookplay / Play Receptivo', 147: 'FBP / Play Receptivo', 148: 'Bookplay / Play 1 SV', 149: 'Bookplay / Play 2 SV',
    150: 'Bookplay / Play 3 SV', 155: 'Bookplay / Play Marília SV', 156: 'FBP / Play 1 SV', 157: 'FBP / Play 2 SV',
    158: 'FBP / Play 3 SV', 173: 'Mundial / Play 2 SV', 174: 'Mundial / Play 3 SV', 177: 'Mundial / Play 6 SV',
    178: 'Mundial / Play Marília BR SV', 179: 'Mundial / Play Marília SV', 218: 'Pagueplay / Triagem',
    219: 'Pagueplay / Play 1', 223: 'Pagueplay / Play 2 SV', 239: 'Pagueplay / Clientes Logados'
  };

  function dataBR(texto) {
    const m = String(texto || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  }
  function hojeZerado() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function valorX(obj, chave) {
    if (obj == null) return 0;
    const x = obj[chave + 'X'];
    return x != null && x !== '' ? Dinheiro.deNumero(x) : Dinheiro.deTexto(obj[chave]);
  }
  function moda(valores) {
    const freq = new Map();
    for (const v of valores) if (v > 0) freq.set(v, (freq.get(v) || 0) + 1);
    let melhor = 0;
    let vezes = 0;
    for (const [v, n] of freq) if (n > vezes) { melhor = v; vezes = n; }
    return vezes >= 2 ? melhor : 0;
  }
  function primeiroNome(nome) {
    const p = String(nome || '').trim().split(/\s+/)[0] || '';
    return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
  }
  function normalizarNome(nome) {
    return String(nome || '').replace(/\s*\(\d+\)\s*$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /** Títulos (toolbar 5) → contratos prontos para o cálculo. */
  function normalizarContratos(documentos) {
    const hoje = hojeZerado();
    return (documentos || []).map(doc => {
      const parcelas = (doc.Installments || []).map(p => {
        const aberto = valorX(p, 'OutstandingAmount');
        const venc = dataBR(p.DueDate);
        const dias = Number(p.Delay) || 0;
        return {
          numero: p.InstallmentNumber, vencimento: p.DueDate || '', original: valorX(p, 'Amount'), aberto, dias,
          atrasada: aberto > 0 && (dias > 0 || (venc != null && venc < hoje))
        };
      });
      const abertas = parcelas.filter(p => p.aberto > 0);
      const atrasadas = abertas.filter(p => p.atrasada);
      const soma = lista => lista.reduce((t, p) => t + p.aberto, 0);
      return {
        nrdoc: String(doc.DocumentNumber ?? ''),
        totalAberto: soma(abertas),
        totalAtualizado: valorX(doc, 'UpdatedTotalValue'),
        saldoAtualizado: valorX(doc, 'UpdatedRemainingValue'),
        valorParcela: moda(parcelas.map(p => p.original)) || abertas[0]?.original || 0,
        qtdAbertas: abertas.length,
        qtdAtraso: atrasadas.length,
        valorAtraso: soma(atrasadas),
        maiorAtraso: atrasadas.reduce((m, p) => Math.max(m, p.dias), 0),
        restantes: Number(doc.NumberInstallmentsRemaining) || abertas.length,
        parcelas
      };
    });
  }

  /** contact do GET /contacts/{atendimento} → dados do cliente. */
  function normalizarContato(contato) {
    const c = contato || {};
    const campos = {};
    const rotulos = {};
    for (const pv of c.printValues || []) { campos[pv.field] = String(pv.value ?? '').trim(); rotulos[pv.field] = pv.label || ''; }
    const tudo = Object.values(campos).join(' \n ').toUpperCase();

    let chave = null;
    if (/FACULDADE BOOKPLAY|\(FACB\)/.test(tudo)) chave = 'faculbookplay';
    else {
      const sigla = (campos.Protocolo || '').toUpperCase().match(/\((PAGP|MUND|BOOK|FACB)\)/);
      if (sigla) chave = SIGLAS[sigla[1]];
      else if (EMPRESAS[c.hashIconCompany]) chave = c.hashIconCompany;
    }
    // A apresentação é sempre pelo PRODUTO contratado, nunca pelo canal por onde o cliente entrou.
    // «Bookplay Informações» traz o «Plano contratado»: é o que mais acerta a instituição
    const plano = (campos.bookplayInfos || '').match(/Plano contratado:?[^\n]*/i)?.[0] || '';
    // Ordem: matrícula informada pelo ChatPlay > plano contratado > (último caso) sigla do canal ou ícone
    const matricula = (campos.Faculdade || '').toUpperCase().replace(/\s+/g, '');
    const pelaMatricula = matricula.includes('FACULDADEBOOKPLAY') ? 'Faculdade Bookplay'
      : matricula.includes('FACULDADEPLAY') ? 'Faculdade Play'
      : matricula.includes('UNIVERSIDADEPLAY') ? 'Universidade Play' : null;
    // Cliente Coren pode ter um plano Bookplay ANTIGO no mesmo CPF: a dívida cobrada é do Coren
    const peloCoren = corenDoCliente(campos);
    const peloPlano = instituicaoDoPlano(plano);
    const pelaPasta = instituicaoDaPasta(campos.SetorDepartamento);
    const pelaEntrada = chave ? EMPRESAS[chave].rotulo : '';
    const instituicao = peloCoren || pelaMatricula || peloPlano || pelaPasta || pelaEntrada;
    const instituicaoFonte = peloCoren ? 'carteira Coren' : pelaMatricula ? 'matrícula' : peloPlano ? 'plano contratado'
      : pelaPasta ? 'pasta do atendimento' : pelaEntrada ? 'canal de entrada' : '';

    const dias = (campos.Vencimento || '').match(/\((\d+)\s*dias?\)/i);
    const vencidas = tudo.match(/(\d+)\s+PARCELAS?\s+(?:VENCIDAS?|EM\s+ABERTO)/);
    const protocolo = (campos['Venda.NrDocumento'] || '').match(/^(\d{5,})/);
    const protocoloAtendimento = (campos.Protocolo || '').match(/\b([A-Z]{2,}\d+-\d+)\b/);

    return {
      nome: campos['Agent.Nome'] || c.name || '',
      cpf: campos['Agent.cpf'] || '',
      empresa: chave || c.hashIconCompany || '',
      instituicao: instituicao || EMPRESAS.bookplay.rotulo,
      instituicaoDetectada: !!instituicao,
      instituicaoFonte,
      plano,
      diasAtraso: dias ? parseInt(dias[1], 10) : null,
      parcelasVencidas: vencidas ? parseInt(vencidas[1], 10) : null,
      protocolo: protocolo ? protocolo[1] : '',
      protocoloAtendimento: protocoloAtendimento ? protocoloAtendimento[1] : '',
      setorVinculado: campos.SetorVinculado || '',
      setorDepartamento: campos.SetorDepartamento || '',
      nomeContato: c.name || '',
      telefone: String(c.accountKey || '').replace(/\D/g, ''),
      saldoTotal: Dinheiro.deTexto(campos.DebitoTotal || ''),
      emAtraso: Dinheiro.deTexto(campos.EmAtraso || ''),
      desde: campos.Vencimento || '',
      desdeRotulo: rotulos.Vencimento || 'Desde',
      aVencer: Dinheiro.deTexto(campos.aVencer || ''),
      ultimoAtendimento: campos.TempoUltAtend || '',
      protocoloCanal: campos.Protocolo || ''
    };
  }

  /**
   * Instituição pelo «Plano contratado» (regra da Ferramenta). null = não reconheceu.
   * Olha só o NOME do plano (até a vírgula ou a quebra de linha): o resto da
   * linha do «Bookplay Informações» não decide a instituição.
   */
  function instituicaoDoPlano(plano) {
    const p = String(plano || '').replace(/^[\s\S]*?Plano contratado:?/i, '').split(/[,;|\n]/)[0];
    if (!p.trim()) return null;
    if (/alfa\s*-?\s*am[eé]rica/i.test(p)) return 'Faculdade Alfa América';
    if (/faculdade\s*play\b/i.test(p)) return 'Faculdade Play';
    if (/universidade\s*play\b/i.test(p)) return 'Universidade Play'; // entra pouco
    if (/mundial/i.test(p)) return EMPRESAS.mundial.rotulo;
    // ProfissionalPlay é Bookplay, com [PRO] ou [FACUL-PRO]: o «FACUL» do código não faz dele Faculdade
    if (/profissional\s*play/i.test(p)) return EMPRESAS.bookplay.rotulo;
    if (/\bPEC\b|FACUL|faculdade\s*book\s*play/i.test(p)) return EMPRESAS.faculbookplay.rotulo;
    if (/pague\s*play/i.test(p)) return EMPRESAS.pagueplay.rotulo;
    if (/book\s*play/i.test(p)) return EMPRESAS.bookplay.rotulo; // qualquer plano Bookplay (Pro, Premium, Kids…)
    return null;
  }

  /**
   * Carteira Coren: «Pague Coren/Coren - PE» (às vezes «Coren BA», sem hífen) ou,
   * na falta da pasta, a sigla do canal no Protocolo, «(CRPE)». null = não é Coren.
   */
  function corenDoCliente(campos) {
    const pelaPasta = String(campos?.SetorDepartamento || '').match(/Coren\s*-?\s*([A-Z]{2})\b/);
    if (pelaPasta) return 'Coren-' + pelaPasta[1];
    const peloCanal = String(campos?.Protocolo || '').toUpperCase().match(/\(CR([A-Z]{2})\)/);
    return peloCanal ? 'Coren-' + peloCanal[1] : null;
  }

  /** Instituição pelo nome da pasta do atendimento («Cobrança FBP/Play 3 SV», «Cobrança - Bookplay/…»). */
  function instituicaoDaPasta(departamento) {
    const d = String(departamento || '');
    if (/\bFBP\b|faculdade\s*book\s*play/i.test(d)) return EMPRESAS.faculbookplay.rotulo;
    if (/faculdade\s*play/i.test(d)) return 'Faculdade Play';
    if (/universidade\s*play/i.test(d)) return 'Universidade Play';
    if (/mundial/i.test(d)) return EMPRESAS.mundial.rotulo;
    if (/book\s*play/i.test(d)) return EMPRESAS.bookplay.rotulo;
    return null;
  }

  /** Usuário do PaguePlay (PAGUEPLAY, PAGUE_PLAY, PagPlay…): acordo dele não é acordo de operador. */
  const ehUsuarioPaguePlay = u => /pag(?:ue)?[\s_.\-]*play/i.test(String(u || ''));

  /**
   * Acordo pelas tabulações (toolbar 4), regra da Ferramenta 2.6 revista em 19/11:
   *  - vale o «Acordo Fechado» MAIS RECENTE, mesmo que depois dele tenham
   *    tabulado outra coisa (proposta, I.A., caixa postal…);
   *  - acordo parcelado («primeiro vencimento») traz o TOTAL: quando a aba
   *    «Acordos» tem a parcela da vez, a abordagem usa a de lá (parcelado: true);
   *  - vencimento ainda por vir → acordo em dia; vencido há 1 ou 2 dias, no
   *    mesmo mês → quebra de acordo;
   *  - acordo tabulado pelo USUÁRIO PaguePlay é ignorado: só acordo de operador
   *    gera a abordagem (vale o de operador mais recente);
   *  - acordo feito no Pagueplay não conta (links no texto não contam como menção).
   * O valor é o EXATO do acordo. Até a 2.1.7 somava R$ 1 ou R$ 2 sorteados (regra
   * herdada da Ferramenta); a operação pediu o valor real.
   */
  function acordoDaTabulacao(documentos, hoje = hojeZerado()) {
    const doc = (documentos || []).find(d => /^\s*acordo fechado\s*$/i.test(d?.sitCobranca || '') && !ehUsuarioPaguePlay(d.usuario));
    if (!doc) return null;
    const det = String(doc.detalhes ?? '').replace(/\s+/g, ' ');
    const semLinks = (det + ' ' + (doc.observacao ?? '')).replace(/https?:\/\/\S+/gi, '');
    if (/pagueplay|pague\s*play/i.test(semLinks)) return null;
    const mV = det.match(/no valor de (R\$\s*[\d.,]+)/i);
    const valor = mV ? Dinheiro.deTexto(mV[1].replace(/[.,]$/, '')) : 0;
    const mD = det.match(/vencimento (?:em|para|dia)?\s*(\d{1,2})(?:[\/-](\d{1,2})(?:[\/-](\d{4}))?)?(?!\d)/i);
    if (!valor || !mD) return null;

    // Data da tabulação: dá o mês e o ano quando o texto não traz
    const feita = /^\d{4}-\d{2}-\d{2}/.test(doc.data || '') ? new Date(+doc.data.slice(0, 4), +doc.data.slice(5, 7) - 1, +doc.data.slice(8, 10)) : dataBR(doc.dtStart) || hoje;
    const dia = +mD[1];
    let venc;
    if (mD[3]) venc = new Date(+mD[3], +mD[2] - 1, dia);
    else if (mD[2]) {
      venc = new Date(feita.getFullYear(), +mD[2] - 1, dia);
      if (venc < new Date(feita.getFullYear(), feita.getMonth() - 1, 1)) venc.setFullYear(venc.getFullYear() + 1); // dez → jan
    } else {
      venc = new Date(feita.getFullYear(), feita.getMonth(), dia);
      if (dia < feita.getDate()) venc = new Date(feita.getFullYear(), feita.getMonth() + 1, dia); // só o dia: o próximo
    }
    if (isNaN(venc)) return null;

    const final = valor;
    const dd = n => String(n).padStart(2, '0');
    const resultado = quebra => ({ quebra, valor: final, vencimento: `${dd(venc.getDate())}/${dd(venc.getMonth() + 1)}`, parcelado: /primeiro vencimento/i.test(det), vezes: Number(det.match(/no valor de R\$\s*[\d.,]+\s*em\s*(\d+)\s*x/i)?.[1]) || 0 });
    if (venc >= hoje) return resultado(false);
    const dias = Math.round((hoje - venc) / 864e5);
    const mesmoMes = venc.getMonth() === hoje.getMonth() && venc.getFullYear() === hoje.getFullYear();
    return dias >= 1 && dias <= 2 && mesmoMes ? resultado(true) : null;
  }

  /**
   * Setor de verdade pelo «Setor de qualidade» (toolbar 3). Cada agendamento de
   * cobrança registra «Agendamento de cobrança para "OPERADOR - (COB PLAY 2 - X)"».
   * Vale o mais novo. O cliente pode ter entrado pelo canal de outro setor; este
   * registro diz a qual setor ele pertence.
   */
  function setorDaQualidade(documentos, hoje = hojeZerado()) {
    const lista = [...(documentos || [])].sort((a, b) => (Number(b.seq) || 0) - (Number(a.seq) || 0));
    for (const d of lista) {
      const m = String(d.detail || '').match(/agendamento de cobran[çc]a para\s*"[^"]*?-\s*\(([^)]+)\)"/i);
      if (!m) continue;
      const data = dataBR(d.date);
      return {
        texto: m[1].trim(),
        setor: setorPeloVinculo(m[1], true),
        data: d.date ? String(d.date).slice(0, 10) : '',
        dias: data ? Math.max(0, Math.round((hoje - data) / 864e5)) : null
      };
    }
    return null;
  }

  /**
   * Acordo formalizado no sistema (toolbar 6, «Acordos»), o mais recente com
   * parcela em aberto. Em aberto = sem data de pagamento. Alguma aberta vencida = atrasado.
   */
  function acordoDoSistema(documentos, hoje = hojeZerado()) {
    const todos = [];
    for (const d of documentos || []) for (const a of d.agreements || []) todos.push({ ...a, nrdoc: d.DocumentNumber });
    todos.sort((a, b) => (Number(b.AgreementCode) || 0) - (Number(a.AgreementCode) || 0));
    for (const a of todos) {
      if (Object.entries(a).some(([k, v]) => typeof v === 'string' && /user|usu|oper|sector|setor/i.test(k) && ehUsuarioPaguePlay(v))) continue;
      const unicas = new Map();
      for (const p of a.installments || []) if (!unicas.has(p.InstallmentNumber)) unicas.set(p.InstallmentNumber, p);
      const parcelas = [...unicas.values()];
      const abertas = parcelas.filter(p => { const pg = String(p.PaymentDate || '').trim(); return !pg || pg.toUpperCase() === 'VAZIO'; });
      if (!abertas.length) continue; // todo pago
      abertas.sort((x, y) => (dataBR(x.DueDate) || 0) - (dataBR(y.DueDate) || 0));
      const vencidas = abertas.filter(p => { const v = dataBR(p.DueDate); return v && v < hoje; });
      const prox = abertas[0];
      return {
        situacao: vencidas.length ? 'atrasado' : 'em dia',
        quebra: vencidas.length > 0 && (() => {
          const v = dataBR(prox.DueDate);
          const dias = v ? Math.round((hoje - v) / 864e5) : 0;
          return dias >= 1 && dias <= 2 && v.getMonth() === hoje.getMonth() && v.getFullYear() === hoje.getFullYear();
        })(),
        valor: Dinheiro.deTexto(prox.InstallmentValue),
        vencimento: String(prox.DueDate || '').slice(0, 5),
        vencimentoCompleto: prox.DueDate || '',
        abertas: abertas.length,
        vencidas: vencidas.length,
        total: parcelas.length,
        valorAcordo: Dinheiro.deTexto(a.AgreementValue),
        data: String(a.AgreementDate || '').slice(0, 10),
        setor: a.Sector || '',
        nrdoc: String(a.nrdoc ?? ''),
        parcelado: Math.max(Number(a.InstallmentsAgreement) || 0, parcelas.length) > 1
      };
    }
    return null;
  }

  /** Última tabulação (toolbar 4): situação, quando, quem e o próximo contato combinado. */
  function ultimaTabulacao(documentos) {
    const d = documentos?.[0];
    if (!d) return null;
    const data = /^\d{4}-\d{2}-\d{2}/.test(d.data || '') ? d.data.slice(8, 10) + '/' + d.data.slice(5, 7) + '/' + d.data.slice(0, 4) : String(d.dtStart || '').slice(0, 10);
    return { situacao: d.sitCobranca || '', data, usuario: d.usuario || '', setor: d.setor || '', proxContato: String(d.proxCtato || '').slice(0, 10), detalhes: d.detalhes || '' };
  }

  /**
   * Negociação em andamento: a última tabulação é «Em negociação» e o próximo
   * contato combinado ainda não chegou. No dia do próximo contato, ou depois,
   * o vínculo acabou e não é mais negociação em andamento.
   */
  function negociacaoEmAndamento(documentos, hoje = hojeZerado()) {
    const t = ultimaTabulacao(documentos);
    if (!t || !/em negocia[çc][ãa]o/i.test(t.situacao)) return null;
    const prox = dataBR(t.proxContato);
    if (!prox || prox <= hoje) return null;
    return { ...t, proxFuturo: true };
  }

  /**
   * Vínculo pela ÚLTIMA tabulação (toolbar 4), para o cabeçalho da conversa.
   * «Em negociação» vale só ANTES do dia do próximo contato (a mesma regra da
   * abordagem); «Acordo Fechado» vale até o dia do próximo contato, inclusive.
   * A tabulação já traz quem tabulou (usuario) e o setor dessa pessoa (setor).
   */
  function vinculoDaTabulacao(documentos, hoje = hojeZerado()) {
    const t = ultimaTabulacao(documentos);
    if (!t) return null;
    const tipo = /acordo fechado/i.test(t.situacao) ? 'acordo' : negociacaoEmAndamento(documentos, hoje) ? 'negociacao' : null;
    const ate = dataBR(t.proxContato);
    if (!tipo || !ate || ate < hoje) return null;
    const prev = String(documentos[0].prevPgto || '').slice(0, 10);
    return { tipo, situacao: t.situacao, usuario: String(t.usuario).trim(), setor: String(t.setor).trim(), data: t.data, ate: t.proxContato, prevPgto: prev };
  }

  /** Telefone canônico: DDD + 8 últimos dígitos (neutraliza 55 e o 9 extra). */
  function chaveTel(raw) {
    let d = String(raw ?? '').replace(/\D/g, '');
    if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
    return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : d;
  }
  const telDoTexto = t => (t || '').match(/\((\d{10,13})\)/)?.[1] || null;
  /** "Cobrança - Bookplay/Play Receptivo" → "Play Receptivo" */
  function departamentoCurto(setorDept) {
    if (!setorDept) return '';
    const partes = String(setorDept).split('/');
    return partes.length >= 2 ? partes[partes.length - 1].trim() : String(setorDept).trim();
  }
  function formatarTel(tel) {
    const d = String(tel || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return tel || '';
  }

  // Testes no Node: expõe o núcleo e para aqui.
  if (typeof window === 'undefined') {
    module.exports = {
      Dinheiro, SETORES, calcular, renderizarModelo, MODELOS_FIXOS, normalizarContratos, normalizarContato,
      acordoDaTabulacao, setorPeloVinculo, normalizarNome, CONDICOES, VARIAVEIS_GERAIS, formatarTel, corrigirSaudacao, chaveTel, departamentoCurto, instituicaoDoPlano, instituicaoDaPasta, corenDoCliente, moda,
      setorDaQualidade, acordoDoSistema, ultimaTabulacao, negociacaoEmAndamento, vinculoDaTabulacao, ehUsuarioPaguePlay, setorDaPasta
    };
    return;
  }


  // ═══════════════════════════════════════════════════════════════════════
  // 2. CONFIGURAÇÃO (salva neste computador)
  // ═══════════════════════════════════════════════════════════════════════

  const PAGINA = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  if (PAGINA.__chatplayMestre) return; // já carregado nesta aba
  PAGINA.__chatplayMestre = VERSAO;

  const MODULOS = {
    abordagem: { nome: 'Apresentação automática', desc: 'Ao clicar em «Sim», a apresentação (ou o pedido de CPF, sem vínculo) vai para o campo de mensagem.' },
    sinalizados: { nome: 'Sinalizados com aviso', desc: 'Som, card e notificação quando um cliente sinalizado escreve, mesmo depois de finalizado.' },
    recuperacao: { nome: 'Retomar conversas', desc: 'Marcar clientes parados e mandar a mensagem de retomada em lote.' },
    identificador: { nome: 'Setor na fila', desc: 'Etiqueta com a pasta de cada cliente na lista.' },
    vinculo: { nome: 'Vínculo no cabeçalho', desc: 'Acordo fechado ou negociação em andamento: com quem e de qual setor.' },
    cronometro: { nome: 'Contagem por cliente', desc: 'Tempo na fila desde a primeira mensagem enviada, com aviso no fim.' },
    papel: { nome: 'WallPaper', desc: 'Imagem ou tema de fundo na conversa.' }
  };

  function cfgPadrao() {
    const setores = {};
    for (const id of ORDEM_SETORES) {
      setores[id] = {
        ativo: true, diasMin: 0, diasMax: 0,
        descontos: Object.fromEntries(SETORES[id].descontos.map(k => [k, DESCONTOS_PADRAO[id]?.[k] ?? 0]))
      };
    }
    return {
      versao: 4,
      operador: '',
      modulos: Object.fromEntries(Object.keys(MODULOS).map(k => [k, true])),
      calc: { setores, pixAuto: true, parcelasCartao: 12, ultimoSetor: null, diasQualidade: 30 },
      modelos: [],
      modeloPadrao: {},
      abordagemAuto: true,
      abordagemAcordoSistema: true,
      abordagemNegociacao: true,
      rec: { aleatoria: true, selecionados: [], agendadoPara: 0, pasta: '', minutos: 30, usarTempo: false },
      crono: { minutos: 60, alertaMin: 5, auto: true },
      papel: { ativo: false, tipo: 'nenhum', preset: 'aurora', ajuste: 'cover', x: 50, y: 50, veu: 35 },
      sinal: { som: true, notificacao: true, lembrarDias: 30, voltou: true, todasMensagens: false },
      visual: {
        setorEmAtendimento: true,   // pasta também na lista «Em andamento»
        marcadorRecuperacao: true,  // marcador de retomada na lista
        contadorNaAba: true         // (2) no título da aba com sinalizados novos
      },
      // Trava de setores: DESLIGADA por padrão; cada pessoa liga e escolhe os setores em Ajustes
      trava: { ligada: false, setores: ['Play3'], inicio: '07:00', fim: '17:00' }
    };
  }

  function mesclar(base, salvo) {
    if (!salvo || typeof salvo !== 'object' || Array.isArray(salvo)) return base;
    const out = { ...base };
    for (const [k, v] of Object.entries(salvo)) {
      out[k] = base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? mesclar(base[k], v) : v;
    }
    return out;
  }

  const cfg = mesclar(cfgPadrao(), GM_getValue('mestre', null));
  for (const id of ORDEM_SETORES) {
    const d = cfg.calc.setores[id].descontos;
    for (const k of Object.keys(d)) if (!SETORES[id].descontos.includes(k)) delete d[k];
  }
  if (!Array.isArray(cfg.modelos)) cfg.modelos = [];
  // Da 2.x para a 3.0: «alertas» virou «sinalizados» e «Copiar CPF» já é do próprio ChatPlay
  if ((Number(cfg.versao) || 1) < 3) {
    if (cfg.modulos.alertas === false) cfg.modulos.sinalizados = false;
    if (cfg.crono.minutos === 59) cfg.crono.minutos = 60;
    cfg.versao = 3;
  }
  // 3.0.6: a trava entrou na versão principal e vem desligada (a config salva antes dizia «ligada»)
  if ((Number(cfg.versao) || 3) < 4) {
    cfg.trava.ligada = false;
    if (!Array.isArray(cfg.trava.setores)) cfg.trava.setores = ['Play3'];
    cfg.versao = 4;
  }
  if (!Array.isArray(cfg.trava.setores)) cfg.trava.setores = ['Play3'];
  for (const k of ['atalhos', 'confirmarFinalizar', 'transf', 'janela']) delete cfg[k];
  for (const k of ['transferencia', 'alertas', 'cpf']) delete cfg.modulos[k];
  for (const k of ['linhaPlay3', 'rotuloLancador', 'avisarConversaAberta', 'setorCarregando']) delete cfg.visual[k];

  let salvarTimer = null;
  function salvarCfg(imediato = false) {
    clearTimeout(salvarTimer);
    if (imediato) GM_setValue('mestre', cfg);
    else salvarTimer = setTimeout(() => GM_setValue('mestre', cfg), 300);
  }
  const ligado = modulo => cfg.modulos[modulo] !== false;

  function novoId() {
    return 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function todosModelos() {
    return [...MODELOS_COFEN, ...cfg.modelos];
  }
  function modelosDe(alvo) {
    return todosModelos().filter(m => (m.setores || []).includes(alvo));
  }
  function modeloEmUso(alvo) {
    const lista = modelosDe(alvo);
    return lista.find(m => m.id === cfg.modeloPadrao[alvo]) || lista.find(m => m.fixo) || lista[0] || null;
  }

  /** localStorage do CRM (contagens e caches; o Tampermonkey guarda o resto). */
  const LS = {
    ler(chave, padrao) {
      try {
        const v = PAGINA.localStorage.getItem(chave);
        return v == null ? padrao : JSON.parse(v);
      } catch { return padrao; }
    },
    gravar(chave, valor) {
      try { PAGINA.localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* cheio ou bloqueado */ }
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // 3. PONTE COM O CHATPLAY — o único gancho de rede
  // ═══════════════════════════════════════════════════════════════════════

  const API = 'https://api.chatplay.com.br';
  const URL_PROGRESSO = API + '/departments/null/attendments/progress/T';
  const URL_AGUARDANDO = API + '/departments/null/attendments/waiting/T';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const tentar = fn => { try { return fn(); } catch (e) { console.warn('[Mestre]', e); } };

  const ponte = {
    atendimentoId: null,
    usuarioId: null,      // id do usuário no ChatPlay (não é o id do CRM)
    ultimoFrame: 0,
    ouvintes: {},
    on(evento, fn) { (this.ouvintes[evento] ||= []).push(fn); },
    emitir(evento, ...args) {
      for (const fn of this.ouvintes[evento] || []) tentar(() => fn(...args));
    },
    tem(evento) { return !!this.ouvintes[evento]?.length; }
  };

  const fetchOriginal = PAGINA.fetch;
  const exportar = fn => (typeof exportFunction === 'function' ? exportFunction(fn, PAGINA) : fn);
  const ehPolling = url => /\/socket\.io\/.*transport=polling/i.test(url);

  /**
   * Chamada observada (do fetch ou do XHR). `texto()` lê a resposta só se
   * alguém pedir; `corpo` é o que a tela mandou (POST).
   */
  function observarChamada(url, metodo, status, texto, corpo) {
    if (!url.startsWith(API)) return;
    if (ehPolling(url)) { texto().then(t => lerPolling(t)); return; }
    const ok = status >= 200 && status < 300;
    const usuario = url.match(/\/user\/(\d+)\/departments/);
    if (usuario && !ponte.usuarioId) ponte.usuarioId = Number(usuario[1]);

    const abriu = url.match(/\/attendments\/(\d+)\/messages(?:[?#]|$)/);
    if (abriu && metodo === 'GET' && abriu[1] !== ponte.atendimentoId) {
      ponte.atendimentoId = abriu[1];
      ponte.emitir('atendimento', abriu[1]);
    }
    if (abriu && ok) {
      if (metodo === 'GET') ponte.emitir('historico', abriu[1], texto);
      else if (metodo === 'POST') {
        texto().then(t => {
          let j = null;
          try { j = JSON.parse(t); } catch { return; }
          if (j?.status === 'success') ponte.emitir('enviada', abriu[1], j.data);
        });
      }
    }
    const iniciou = url.match(/\/attendments\/(\d+)\/start(?:[?#]|$)/);
    if (iniciou && ok) {
      texto().then(t => {
        let deu = true;
        try { deu = JSON.parse(t)?.status !== 'error'; } catch { /* sem corpo */ }
        if (deu) ponte.emitir('iniciado', iniciou[1]);
      });
    }
    // Etiqueta (sinalizar) trocada na tela
    if (/\/attendments\/tag\/insert-update/.test(url) && ok && corpo) {
      try { ponte.emitir('etiqueta', JSON.parse(corpo)); } catch { /* corpo estranho */ }
    }
    if (/\/user\/me(?:[?#]|$)/.test(url) && ok) {
      texto().then(t => { try { ponte.emitir('eu', JSON.parse(t)?.data); } catch { /* ignora */ } });
    }
    if (ponte.tem('lista') && /\/attendments\/(?:progress|waiting)\//.test(url)) {
      texto().then(t => { try { ponte.emitir('lista', /waiting/.test(url) ? 'aguardando' : 'andamento', JSON.parse(t)?.data || []); } catch { /* ignora */ } });
    }
  }

  PAGINA.fetch = exportar(function (input, init) {
    const resposta = fetchOriginal.apply(PAGINA, arguments);
    tentar(() => {
      const url = typeof input === 'string' ? input : input?.url || String(input || '');
      if (!url.startsWith(API)) return;
      const metodo = String(init?.method || input?.method || 'GET').toUpperCase();
      const corpo = typeof init?.body === 'string' ? init.body : null;
      resposta.then(r => {
        let cache = null;
        const texto = () => (cache ||= r.clone().text().catch(() => ''));
        tentar(() => observarChamada(url, metodo, r.status, texto, corpo));
      }, () => {});
    });
    return resposta;
  });

  // XHR: o CRM usa axios para falar com o ChatPlay
  const xhrProto = PAGINA.XMLHttpRequest?.prototype;
  if (xhrProto) {
    const abrir = xhrProto.open;
    const enviar = xhrProto.send;
    xhrProto.open = exportar(function (metodo, url) {
      tentar(() => { this.__mst = { url: String(url || ''), metodo: String(metodo || 'GET').toUpperCase() }; });
      return abrir.apply(this, arguments);
    });
    xhrProto.send = exportar(function (corpo) {
      tentar(() => {
        const m = this.__mst;
        if (!m || !m.url.startsWith(API) || m.ouvindo) return;
        m.ouvindo = true;
        m.corpo = typeof corpo === 'string' ? corpo : null;
        this.addEventListener('load', () => tentar(() => {
          const ler = () => Promise.resolve(this.responseType === 'json' ? JSON.stringify(this.response)
            : (!this.responseType || this.responseType === 'text') ? this.responseText : '');
          observarChamada(m.url, m.metodo, this.status, ler, m.corpo);
        }));
      });
      return enviar.apply(this, arguments);
    });
  }

  // WebSocket: só o do ChatPlay (o CRM tem outro socket.io, o de presença)
  const socketsOuvidos = new WeakSet();
  const ehSocketDoChat = url => /api\.chatplay\.com\.br/i.test(String(url || ''));
  function ouvirSocket(ws) {
    if (!ws || socketsOuvidos.has(ws) || !ehSocketDoChat(ws.url)) return;
    socketsOuvidos.add(ws);
    ws.addEventListener('message', e => tentar(() => lerFrame(e.data)));
  }
  const WSOriginal = PAGINA.WebSocket;
  if (WSOriginal) {
    const proto = WSOriginal.prototype;
    const Gancho = function (...args) {
      const ws = new WSOriginal(...args);
      tentar(() => ouvirSocket(ws));
      return ws;
    };
    Gancho.prototype = proto;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Gancho[k] = WSOriginal[k];
    PAGINA.WebSocket = exportar(Gancho);
    const sendOriginal = proto.send;
    proto.send = exportar(function () {
      tentar(() => ouvirSocket(this));
      return sendOriginal.apply(this, arguments);
    });
  }

  let limiteSemSinal = 90000;
  function lerFrame(dado) {
    ponte.ultimoFrame = Date.now();
    if (typeof dado !== 'string') return;
    if (dado.startsWith('0{')) {
      try {
        const { pingInterval, pingTimeout } = JSON.parse(dado.slice(1));
        if (pingInterval > 0) limiteSemSinal = Math.max(90000, pingInterval + (pingTimeout || 0) + 30000);
      } catch { /* ignora */ }
      return;
    }
    const cab = /^42(?:\/[^,[]*,)?\d*/.exec(dado);
    if (!cab) return;
    let dados;
    try { dados = JSON.parse(dado.slice(cab[0].length)); } catch { return; }
    if (!Array.isArray(dados)) return;
    ponte.emitir('socket', dados[0], dados[1], dado);
  }
  function lerPolling(texto) {
    if (typeof texto !== 'string' || !texto) return;
    if (!/^\d+:/.test(texto)) { texto.split('\x1e').forEach(lerFrame); return; }
    for (let i = 0; i < texto.length;) {
      const sep = texto.indexOf(':', i);
      const n = parseInt(texto.slice(i, sep), 10);
      if (sep < 0 || !Number.isFinite(n)) break;
      lerFrame(texto.slice(sep + 1, sep + 1 + n));
      i = sep + 1 + n;
    }
  }

  // ── API ─────────────────────────────────────────────────────────────────

  /** Token do ChatPlay que o CRM guarda em cookie (o mesmo que a tela usa). */
  function tokenDoChat() {
    try {
      const par = document.cookie.split('; ').find(c => c.startsWith('app.token_chatplay='));
      return par ? decodeURIComponent(par.slice(par.indexOf('=') + 1)) : null;
    } catch { return null; }
  }

  async function chamarApi(caminho, { metodo = 'GET', corpo, tempo = 8000 } = {}) {
    const token = tokenDoChat();
    if (!token) throw new Error('Sem login do ChatPlay. Recarregue a página.');
    const ctrl = new PAGINA.AbortController();
    const t = setTimeout(() => ctrl.abort(), tempo);
    try {
      const headers = { Authorization: 'Basic ' + token };
      if (corpo) headers['Content-Type'] = 'application/json';
      const r = await fetchOriginal.call(PAGINA, caminho.startsWith('http') ? caminho : API + caminho, {
        method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined, signal: ctrl.signal
      });
      if (r.status === 401) throw Object.assign(new Error('O ChatPlay recusou o login. Recarregue a página.'), { status: 401 });
      const txt = await r.text();
      let j = null;
      try { j = txt ? JSON.parse(txt) : null; } catch { /* corpo não-JSON */ }
      if (!r.ok || (j && j.status && j.status !== 'success')) {
        throw Object.assign(new Error(j?.message || `O ChatPlay respondeu com erro (${r.status}).`), { status: r.status });
      }
      return j?.data ?? j;
    } catch (e) {
      if (e.name === 'AbortError') throw Object.assign(new Error('O ChatPlay demorou para responder.'), { status: 0 });
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  /** Quem está logado no ChatPlay: id (para as consultas) e a paleta de etiquetas. */
  const eu = { dados: null, promessa: null };
  ponte.on('eu', d => { if (d?.id) { eu.dados = d; ponte.usuarioId = d.id; } });
  function quemSouEu() {
    if (eu.dados) return Promise.resolve(eu.dados);
    eu.promessa ||= chamarApi('/user/me').then(d => { eu.dados = d; if (d?.id) ponte.usuarioId = d.id; return d; })
      .catch(e => { eu.promessa = null; throw e; });
    return eu.promessa;
  }
  async function usuarioId() {
    return ponte.usuarioId || (await quemSouEu())?.id;
  }

  const api = {
    contato: id => chamarApi(`/contacts/${id}`).then(d => d?.contact ?? null),
    /** Consultas do atendimento: 3 qualidade, 4 cobrança, 5 títulos, 6 acordos, 8 crédito. */
    async toolbarBruto(id, idToolbar) {
      return chamarApi('/toolbar/list', { metodo: 'POST', corpo: { userId: await usuarioId(), idToolbar, idAttendment: Number(id) } });
    },
    toolbar(id, idToolbar) { return this.toolbarBruto(id, idToolbar).then(d => d?.documents ?? []); },
    enviarMensagem: (id, texto) => chamarApi(`/attendments/${id}/messages`, {
      metodo: 'POST', corpo: { text: texto, datetime: new Date().toISOString() }
    }),
    _progresso: null,
    progresso({ fresco = false } = {}) {
      if (!fresco && this._progresso && Date.now() - this._progresso.em < 1500) return this._progresso.p;
      const p = chamarApi(URL_PROGRESSO).then(d => d || []);
      this._progresso = { em: Date.now(), p };
      p.catch(() => { if (this._progresso?.p === p) this._progresso = null; });
      return p;
    },
    aguardando: () => chamarApi(URL_AGUARDANDO, { tempo: 6000 }).then(d => d || [])
  };

  /** Tabulações (toolbar 4) com cache curto: cabeçalho e calculadora usam a mesma busca. */
  const cacheTabulacoes = new Map();
  function tabulacoesDe(id, forcar = false) {
    const k = String(id);
    const c = cacheTabulacoes.get(k);
    if (!forcar && c && Date.now() - c.em < 120000) return c.promessa;
    const promessa = api.toolbar(id, 4);
    cacheTabulacoes.set(k, { em: Date.now(), promessa });
    promessa.then(docs => ponte.emitir('tabulacoes', k, docs), () => { if (cacheTabulacoes.get(k)?.promessa === promessa) cacheTabulacoes.delete(k); });
    if (cacheTabulacoes.size > 100) cacheTabulacoes.delete(cacheTabulacoes.keys().next().value);
    return promessa;
  }

  /** «Regra de desconto» que o ChatPlay manda junto com os títulos (toolbar 5). */
  function lerRegraDesconto(r) {
    if (!r || typeof r !== 'object') return null;
    const data = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : '');
    return {
      tipo: r.TipoAcordo || '', descricao: r.DescTipoAcordo || '', setor: r.SetorDesconto || '',
      possuiDesconto: r.PossuiDesconto !== false,
      operador: Number(r.DescOperador) || 0, supervisor: Number(r.DescSupervisor) || 0, gerente: Number(r.DescGerente) || 0,
      vencimentoOperador: data(r.VctoMaxOperador), prazo: r.PrazoGrid || '', entrada: !!r.PossuiEntrada
    };
  }

  /** Tudo de um atendimento, em paralelo, com cache curto. */
  const cacheClientes = new Map();
  function carregarCliente(id, forcar = false) {
    const c = cacheClientes.get(id);
    if (!forcar && c && Date.now() - c.em < 120000) return c.promessa;
    const inicio = performance.now();
    const promessa = Promise.all([
      api.contato(id),
      tabulacoesDe(id, forcar).catch(() => [])
    ]).then(([contato, tabulacoes]) => {
      const cliente = normalizarContato(contato);
      // Regional: pasta do cliente («Pague Coren/Coren - PA») ou canal do protocolo «(CRPA)»;
      // na falta, a pasta por onde o atendimento entrou
      const pelaFicha = corenDoCliente({ SetorDepartamento: cliente.setorDepartamento, Protocolo: cliente.protocoloCanal });
      const pasta = nomePasta(atendimentos.get(String(id))?.departmentId);
      const pelaPasta = (pasta.match(/Coren\s*-?\s*([A-Z]{2})\b/) || [])[1];
      const coren = pelaFicha || (pelaPasta ? 'Coren-' + pelaPasta : null);
      // Sem vínculo: nenhum profissional ligado ao contato (sem código, sem CPF; o «nome» é o telefone)
      const semVinculo = contato?.codAgent == null || !String(cliente.cpf || '').replace(/\D/g, '') || /^\d{8,}$/.test(String(cliente.nome || '').trim());
      return {
        atendimentoId: id,
        cliente,
        coren: coren || 'Coren',
        corenFonte: pelaFicha ? (/Coren/i.test(cliente.setorDepartamento) ? 'pasta do cliente' : 'canal do protocolo') : pelaPasta ? 'pasta do atendimento' : '',
        semVinculo,
        contratos: [],
        tabulacoes,
        ultimaTabulacao: ultimaTabulacao(tabulacoes),
        acordoSistema: null,
        qualidade: null,
        setorCliente: null,
        ms: Math.round(performance.now() - inicio)
      };
    });
    cacheClientes.set(id, { em: Date.now(), promessa });
    promessa.catch(() => cacheClientes.delete(id));
    if (cacheClientes.size > 60) cacheClientes.delete(cacheClientes.keys().next().value);
    return promessa;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. PÁGINA — endereços da tela nova (CRM) e utilidades
  // ═══════════════════════════════════════════════════════════════════════

  const SEL = {
    campo: '#chat-new-message-textarea',
    pesquisarConversa: '[aria-label="Pesquisar na conversa"]',
    nomeNoCabecalho: 'button[aria-label="Abrir dados do contato"] span span',
    linha: '[data-index] > div > div[role="button"]',
    rapidas: '[aria-label="Mensagens rápidas"]',
    menu: '[role="menu"]'
  };
  /** Tudo que o Mestre põe na página tem esta classe: o observador ignora. */
  const NOSSO = 'mst-el';
  const ehNosso = n => n?.nodeType === 1 && (n.classList?.contains(NOSSO) || !!n.closest?.('.' + NOSSO));

  function esc(t) {
    return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  /** O CRM monta duas versões da tela (celular e computador): vale a que aparece. */
  const visivel = el => !!el && el.getClientRects().length > 0;
  const primeiroVisivel = sel => [...document.querySelectorAll(sel)].find(visivel) || null;

  /** Objeto do atendimento que o próprio ChatPlay guarda nas props React do elemento. */
  const attCache = new WeakMap();
  function propsCom(el, teste, niveis = 8) {
    try {
      const k = Object.keys(el).find(x => x.startsWith('__reactFiber$'));
      for (let f = k && el[k], i = 0; f && i < niveis; i++, f = f.return) {
        const p = f.memoizedProps;
        if (!p || typeof p !== 'object') continue;
        for (const v of Object.values(p)) if (v && typeof v === 'object' && !v.$$typeof && teste(v)) return v;
      }
    } catch { /* sem acesso às props */ }
    return null;
  }
  const ehAtendimento = v => v.id != null && typeof v.name === 'string' && ('departmentId' in v || 'contact' in v);
  function attDaLinha(linha) {
    const nomeAgora = linha.textContent;
    const g = attCache.get(linha);
    if (g && g.texto === nomeAgora) return g.att;
    const att = propsCom(linha, ehAtendimento, 6);
    attCache.set(linha, { texto: nomeAgora, att });
    return att;
  }

  /** Linhas visíveis da fila (a lista é virtual: só as que estão na tela existem). */
  let linhasDoCiclo = null;
  function linhas() {
    return linhasDoCiclo || [...document.querySelectorAll(SEL.linha)].filter(visivel);
  }
  /** Seção da linha pela legenda acima da lista: 'aguardando' | 'andamento' | null. */
  const cacheSecao = new WeakMap();
  function secaoDaLinha(linha) {
    const lista = linha.closest('[class*="overflow-y-auto"]');
    if (!lista) return null;
    if (cacheSecao.has(lista)) return cacheSecao.get(lista);
    const t = lista.previousElementSibling?.textContent || '';
    const s = /Aguardando/i.test(t) ? 'aguardando' : /Em\s+andamento/i.test(t) ? 'andamento' : null;
    if (s) cacheSecao.set(lista, s);
    return s;
  }
  /** Linha de baixo do cliente (fluxo + hora): é onde as etiquetas do Mestre entram. */
  function linhaDeBaixo(linha) {
    const bloco = linha.querySelector(':scope > div.min-w-0');
    const baixo = bloco?.children[1];
    return baixo?.firstElementChild || baixo || bloco;
  }
  /** Nome da linha sem o telefone. */
  const nomeDaLinha = (att, linha) => String(att?.name || linha?.querySelector('span span')?.textContent || '').replace(/\s*\(\d{10,13}\)\s*$/, '').trim();

  // ── Conversa aberta ──
  function cabecalho() {
    return primeiroVisivel(SEL.pesquisarConversa)?.parentElement || null;
  }
  const nomeNaTela = () => (cabecalho()?.querySelector(SEL.nomeNoCabecalho)?.textContent || '').trim();
  function campoDoChat() {
    const c = document.querySelector(SEL.campo);
    return c && visivel(c) ? c : null;
  }
  /** Área das mensagens (onde vai o WallPaper). */
  function areaDasMensagens() {
    const cab = cabecalho();
    for (const filho of cab?.parentElement?.children || []) {
      const rolagem = filho.firstElementChild;
      if (rolagem && /overflow-y-auto/.test(rolagem.className) && /space-y/.test(rolagem.className)) return rolagem;
    }
    return null;
  }
  function escreverNoCampo(campo, texto) {
    const setter = Object.getOwnPropertyDescriptor(PAGINA.HTMLTextAreaElement.prototype, 'value').set;
    campo.focus();
    setter.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  }
  /** Botão azul de enviar: só existe com texto no campo (no lugar do microfone). */
  function botaoEnviar(campo) {
    const caixa = campo?.closest('.border-t');
    const botoes = caixa ? [...caixa.querySelectorAll('button')] : [];
    return botoes.reverse().find(b => /bg-primary/.test(b.className) && b.getAttribute('aria-label') !== 'Gravar áudio') || null;
  }
  /**
   * Escreve e envia pelo próprio campo do ChatPlay (a tela registra o envio
   * como se fosse digitado). Confere que o campo esvaziou.
   */
  async function enviarPeloChat(texto) {
    const campo = campoDoChat();
    if (!campo) throw new Error('Campo de mensagem não encontrado.');
    if (campo.disabled) throw new Error('O ChatPlay não deixa enviar nesta conversa agora.');
    escreverNoCampo(campo, texto);
    const botao = await esperar(() => botaoEnviar(campo), 1500, 50);
    if (botao) botao.click();
    else campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    const saiu = await esperar(() => campo.value.trim() === '', 6000, 100);
    if (!saiu) throw new Error('A mensagem ficou no campo: confira e envie.');
    return true;
  }

  /** Abre a conversa de um atendimento clicando na linha dele (rola a lista virtual se precisar). */
  async function abrirAtendimento(id) {
    id = String(id);
    const achar = () => [...document.querySelectorAll(SEL.linha)].find(l => visivel(l) && String(attDaLinha(l)?.id) === id);
    let linha = achar();
    if (!linha) {
      const listas = [...document.querySelectorAll('[class*="overflow-y-auto"]')].filter(l => visivel(l) && l.querySelector('[data-index]'));
      for (const lista of listas) {
        const inicio = lista.scrollTop;
        lista.scrollTop = 0;
        for (let i = 0; i < 60 && !linha; i++) {
          await sleep(60);
          linha = achar();
          if (linha || lista.scrollTop + lista.clientHeight >= lista.scrollHeight - 2) break;
          lista.scrollTop += lista.clientHeight * 0.8;
        }
        if (linha) break;
        lista.scrollTop = inicio;
      }
    }
    if (!linha) return false;
    linha.scrollIntoView({ block: 'nearest' });
    linha.click();
    return true;
  }

  // ── Observador único da página ──────────────────────────────────────────
  // Cada módulo registra o que roda quando a página muda; tudo num ciclo só.
  // Mudanças do próprio Mestre e o texto das mensagens não disparam nada.
  const tarefasDom = [];
  function aoMudarPagina(nome, fn) {
    tarefasDom.push({ nome, fn });
  }
  let cicloTimer = null;
  function rodarCiclo() {
    cicloTimer = null;
    linhasDoCiclo = [...document.querySelectorAll(SEL.linha)].filter(visivel);
    for (const t of tarefasDom) tentar(t.fn);
    linhasDoCiclo = null;
  }
  const agendarCiclo = (ms = 150) => { if (!cicloTimer) cicloTimer = setTimeout(rodarCiclo, ms); };
  function iniciarObservador() {
    new MutationObserver(muts => {
      if (cicloTimer) return;
      for (const m of muts) {
        const alvo = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (!alvo || ehNosso(alvo)) continue;
        if (m.type === 'childList' && m.removedNodes.length === 0 && [...m.addedNodes].every(ehNosso)) continue;
        agendarCiclo();
        return;
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    // a lista virtual troca as linhas ao rolar
    document.addEventListener('scroll', () => agendarCiclo(60), true);
  }

  // ── Som ─────────────────────────────────────────────────────────────────
  const som = {
    ctx: null,
    contexto() {
      if (!this.ctx || this.ctx.state === 'closed') this.ctx = new (PAGINA.AudioContext || PAGINA.webkitAudioContext)();
      return this.ctx;
    },
    async liberar() {
      try {
        const c = this.contexto();
        if (c.state !== 'running') await Promise.race([c.resume().catch(() => {}), sleep(800)]);
        return c.state === 'running';
      } catch { this.ctx = null; return false; }
    },
    get liberado() { return this.ctx?.state === 'running'; },
    async tocar(notas, volume = 0.16, duracao = 0.38) {
      try {
        const c = this.contexto();
        if (c.state !== 'running') await Promise.race([c.resume().catch(() => {}), sleep(500)]);
        if (c.state !== 'running') return false;
        for (const [freq, ini, tipo] of notas) {
          const o = c.createOscillator();
          const g = c.createGain();
          const t = c.currentTime + ini;
          o.type = tipo || 'sine';
          o.frequency.value = freq;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(volume, t + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0001, t + duracao);
          o.connect(g); g.connect(c.destination);
          o.start(t); o.stop(t + duracao + 0.02);
          o.onended = () => { o.disconnect(); g.disconnect(); };
        }
        return true;
      } catch { this.ctx = null; return false; }
    },
    alerta() { return this.tocar([[784, 0], [1046.5, 0.14]]); },
    voltou() { return this.tocar([[659, 0], [880, 0.12], [1175, 0.24]], 0.14); },
    fimDoTempo() { return this.tocar([0, 0.9].flatMap(r => [[659, r], [784, r + 0.16], [988, r + 0.32]]), 0.25, 0.4); },
    bloqueio() { return this.tocar([[880, 0, 'square'], [660, 0.18, 'square'], [880, 0.36, 'square']], 0.08, 0.16); }
  };
  ['pointerdown', 'keydown'].forEach(ev => PAGINA.addEventListener(ev, e => { if (e.isTrusted) som.liberar(); }, { capture: true, once: true }));

  function notificacaoDoSistema(titulo, corpo, { tag, fixa = false, aoClicar } = {}) {
    if (!('Notification' in PAGINA) || Notification.permission !== 'granted') return null;
    try {
      const n = new Notification(titulo, { body: corpo, tag, renotify: !!tag, requireInteraction: fixa, icon: '/favicon.svg' });
      n.onclick = () => { PAGINA.focus(); n.close(); aoClicar?.(); };
      return n;
    } catch { return null; }
  }
  function pedirPermissaoNotificacao() {
    if ('Notification' in PAGINA && Notification.permission === 'default') Notification.requestPermission()?.catch?.(() => {});
  }

  // ── Tema: o CRM põe «dark» no <html> ────────────────────────────────────
  const tema = {
    atual: 'claro',
    detectar() { return document.documentElement.classList.contains('dark') ? 'escuro' : 'claro'; },
    aplicar() {
      const t = this.detectar();
      if (t === this.atual) return;
      this.atual = t;
      ponte.emitir('tema', t);
    },
    iniciar() {
      this.atual = this.detectar();
      new MutationObserver(() => this.aplicar()).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
  };

  function estilo(id, css) {
    let s = document.getElementById(id);
    if (!s) {
      s = document.createElement('style');
      s.id = id;
      (document.head || document.documentElement).appendChild(s);
    }
    if (s.textContent !== css) s.textContent = css;
    return s;
  }
  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      const t = document.createElement('textarea');
      t.value = texto;
      Object.assign(t.style, { position: 'fixed', top: '-1000px', opacity: '0' });
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    }
  }
  function esperar(teste, limite = 5000, passo = 80) {
    return new Promise(resolve => {
      const ja = teste();
      if (ja) return resolve(ja);
      const fim = Date.now() + limite;
      const t = setInterval(() => {
        const v = teste();
        if (v || Date.now() > fim) { clearInterval(t); resolve(v || null); }
      }, passo);
    });
  }
  function formatarCpf(cpf) {
    const d = String(cpf || '').replace(/\D/g, '');
    return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : String(cpf || '');
  }

  /** Pasta (departmentId → nome): /user/{id}/departments e o que o socket ensinar. */
  const pastasAprendidas = new Map(LS.ler('mestre.pastas', []));
  const nomePasta = dep => (dep == null ? '' : pastasAprendidas.get(String(dep)) || String(PASTAS[dep] || '').split('/').pop().trim());
  async function carregarPastas() {
    try {
      const lista = await chamarApi(`/user/${await usuarioId()}/departments`);
      for (const d of lista || []) {
        if (d?.id == null || typeof d.name !== 'string') continue;
        pastasAprendidas.set(String(d.id), d.name.trim());
      }
      LS.gravar('mestre.pastas', [...pastasAprendidas]);
      ponte.emitir('pastas');
    } catch { /* fica com o que o socket ensinar */ }
  }
  ponte.on('socket', (evento, dados) => {
    if (evento !== 'sector-updates' || !Array.isArray(dados)) return;
    let mudou = false;
    for (const d of dados) {
      const nome = typeof d?.name === 'string' ? d.name.trim() : '';
      if (d?.id != null && nome && pastasAprendidas.get(String(d.id)) !== nome) { pastasAprendidas.set(String(d.id), nome); mudou = true; }
    }
    if (mudou) { LS.gravar('mestre.pastas', [...pastasAprendidas]); ponte.emitir('pastas'); }
  });

  /**
   * Atendimentos que o Mestre conhece (das listas e do socket): id → att.
   * Serve à retomada, aos sinalizados e à trava.
   */
  const atendimentos = new Map();
  function guardarAtt(a) {
    if (a?.id == null) return;
    const k = String(a.id);
    atendimentos.set(k, { ...atendimentos.get(k), ...a });
    if (atendimentos.size > 3000) atendimentos.delete(atendimentos.keys().next().value);
  }
  ponte.on('lista', (secao, lista) => { if (Array.isArray(lista)) for (const a of lista) guardarAtt({ ...a, _secao: secao }); });
  ponte.on('socket', (evento, d) => {
    if (d && typeof d === 'object' && !Array.isArray(d) && d.id != null && typeof d.name === 'string') guardarAtt(d);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. MÓDULOS
  // ═══════════════════════════════════════════════════════════════════════

  /** Chip no padrão da tela (mesma altura e raio das etiquetas de fluxo do ChatPlay). */
  function chip(classe, texto, titulo = '') {
    const s = document.createElement('span');
    s.className = `${NOSSO} mst-chip ${classe}`;
    s.textContent = texto;
    if (titulo) s.title = titulo;
    return s;
  }
  /** Clique dentro da linha da fila não pode abrir a conversa nem arrastar a linha. */
  function blindar(el) {
    for (const t of ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'click']) el.addEventListener(t, e => e.stopPropagation());
    return el;
  }
  /** Pasta de um setor travado (e a trava ligada, no horário)? */
  function pastaTravada(pasta) {
    if (!COM_TRAVA || !cfg.trava.ligada || !trava.valendo()) return false;
    const s = setorDaPasta(pasta);
    return !!s && cfg.trava.setores.includes(s);
  }

  // ── 5.1 Setor na fila ───────────────────────────────────────────────────
  // A linha da fila já traz o atendimento (props React): a pasta vem do
  // departmentId, sem consulta extra.

  const setorFila = (() => {
    const CORES = { bookplay: '#3b82f6', mundial: '#f59e0b', faculbookplay: '#8b5cf6', pagueplay: '#10b981' };

    function desenhar() {
      if (!ligado('identificador')) return;
      for (const linha of linhas()) {
        const att = attDaLinha(linha);
        const secao = secaoDaLinha(linha);
        let el = linha.querySelector('.mst-setor');
        const mostrar = att && (secao === 'aguardando' || (secao === 'andamento' && cfg.visual.setorEmAtendimento));
        const pasta = mostrar ? nomePasta(att.departmentId) || att.sectorName || '' : '';
        const play3 = secao === 'aguardando' && !!pasta && pastaTravada(pasta);
        if (linha.hasAttribute('data-mst-play3') !== play3) linha.toggleAttribute('data-mst-play3', play3);
        if (!pasta) { el?.remove(); continue; }
        const chave = `${pasta}|${att.hashIconCompany}`;
        if (el?.dataset.chave === chave) continue;
        if (!el) { el = chip('mst-setor', ''); linhaDeBaixo(linha)?.appendChild(el); }
        el.dataset.chave = chave;
        el.textContent = pasta;
        el.title = 'Pasta: ' + (att.sectorName ? att.sectorName + ' / ' : '') + pasta;
        el.style.setProperty('--cor', CORES[att.hashIconCompany] || '#64748b');
      }
    }
    function desligar() {
      document.querySelectorAll('.mst-setor').forEach(e => e.remove());
      document.querySelectorAll('[data-mst-play3]').forEach(e => e.removeAttribute('data-mst-play3'));
    }
    return { iniciar() { aoMudarPagina('setor', desenhar); ponte.on('pastas', desenhar); }, desenhar, desligar };
  })();

  // ── 5.2 Contagem por cliente ────────────────────────────────────────────
  // Começa na PRIMEIRA mensagem que o operador envia no atendimento, pelo
  // horário dela. Só conta quando dá para ter certeza de que é a primeira:
  // o atendimento foi iniciado neste navegador («Sim») ou a conversa aberta
  // não tinha nenhuma mensagem enviada. Guarda a HORA do fim: F5 não perde.

  const cronometro = (() => {
    const CHAVE = 'mestre.crono.v3';
    const CHAVE_ATT = 'mestre.crono.atendimentos.v3';
    const LIMPAR_APOS = 12 * 3600000;
    const GUARDAR_ATT = 24 * 3600000;
    const RAIO = 9;
    const VOLTA = 2 * Math.PI * RAIO;
    const ICONE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle class="trilho" cx="12" cy="12" r="${RAIO}" stroke-width="2.4"/><circle class="prog" cx="12" cy="12" r="${RAIO}" stroke-width="2.4" stroke-dasharray="${VOLTA.toFixed(2)}" stroke-dashoffset="0" transform="rotate(-90 12 12)"/><polyline points="12 7.5 12 12 15 13.5" stroke-width="2.2"/></svg>`;
    let timers = LS.ler(CHAVE, {});
    let registros = LS.ler(CHAVE_ATT, {});
    const semEnvioAntes = new Map();
    const duracao = () => Math.max(1, Number(cfg.crono.minutos) || 60) * 60000;
    const alertaMs = () => Math.max(0, Number(cfg.crono.alertaMin) || 0) * 60000;
    const salvar = () => LS.gravar(CHAVE, timers);
    const recarregar = () => { timers = LS.ler(CHAVE, {}); };
    const salvarAtt = () => LS.gravar(CHAVE_ATT, registros);
    const recarregarAtt = () => { registros = LS.ler(CHAVE_ATT, {}); };
    const telDe = att => chaveTel(telDoTexto(att?.name) || att?.contact);

    function estado(tel, agora) {
      const t = timers[tel];
      if (!t) return { tipo: 'parado' };
      const resta = t.fim - agora;
      const total = t.duracao || duracao();
      if (resta <= 0) return { tipo: 'fim', resta: 0, total };
      return { tipo: resta <= alertaMs() ? 'alerta' : 'rodando', resta, total };
    }
    const fmt = ms => {
      const s = Math.ceil(ms / 1000);
      return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
    const TITULOS = {
      parado: () => `Iniciar contagem de ${cfg.crono.minutos} minutos`,
      rodando: () => 'Tempo para continuar com o cliente. Clique para cancelar',
      alerta: () => `Faltam menos de ${cfg.crono.alertaMin} minutos. Clique para cancelar`,
      fim: () => 'Tempo esgotado. Clique para dispensar',
      confirmar: () => 'Clique de novo para cancelar a contagem'
    };

    function pintar(btn, e) {
      const confirmando = btn.dataset.confirmar && (e.tipo === 'rodando' || e.tipo === 'alerta');
      const tipo = confirmando ? 'confirmar' : e.tipo;
      if (btn.dataset.tipo !== tipo) { btn.dataset.tipo = tipo; btn.title = TITULOS[tipo](); }
      const txt = tipo === 'parado' ? '' : confirmando ? 'Cancelar?' : tipo === 'fim' ? 'Esgotado' : fmt(e.resta);
      const no = btn.querySelector('.txt');
      if (no.textContent !== txt) no.textContent = txt;
      const fracao = e.tipo === 'rodando' || e.tipo === 'alerta' ? e.resta / e.total : e.tipo === 'fim' ? 0 : 1;
      const off = (VOLTA * (1 - fracao)).toFixed(1);
      const prog = btn.querySelector('.prog');
      if (prog.getAttribute('stroke-dashoffset') !== off) prog.setAttribute('stroke-dashoffset', off);
      btn.closest('[role="button"]')?.classList.toggle('mst-esgotado', e.tipo === 'fim');
    }

    function clicar(ev) {
      ev.preventDefault();
      som.liberar();
      const btn = ev.currentTarget;
      const tel = btn.dataset.tel;
      if (!tel) return;
      recarregar();
      const e = estado(tel, Date.now());
      if (e.tipo === 'parado') {
        timers[tel] = { fim: Date.now() + duracao(), duracao: duracao(), nome: btn.dataset.nome || tel, avisado: false };
        pedirPermissaoNotificacao();
      } else if (e.tipo === 'fim') {
        delete timers[tel];
      } else if (!btn.dataset.confirmar) {
        btn.dataset.confirmar = '1';
        clearTimeout(btn._mstConfirmar);
        btn._mstConfirmar = setTimeout(() => { delete btn.dataset.confirmar; pintar(btn, estado(tel, Date.now())); }, 3000);
        pintar(btn, e);
        return;
      } else {
        delete timers[tel];
      }
      clearTimeout(btn._mstConfirmar);
      delete btn.dataset.confirmar;
      salvar();
      desenhar();
    }

    function horaDaMensagem(msg) {
      const agora = Date.now();
      const t = new Date(msg?.datetime).getTime();
      return Number.isFinite(t) && Math.abs(agora - t) < 5 * 60000 ? t : agora;
    }
    function criar(tel, id, inicio, nome) {
      recarregar();
      const fim = inicio + duracao();
      if (fim <= Date.now()) return;
      timers[tel] = { fim, duracao: duracao(), nome: nome || tel, avisado: false, att: id, auto: true };
      salvar();
    }
    function resolverPendentes(att, linha) {
      const id = att?.id;
      const a = id != null ? registros[id] : null;
      if (!a?.f || a.c) return;
      recarregarAtt();
      const fresco = registros[id];
      if (!fresco?.f || fresco.c) return;
      fresco.c = 1;
      salvarAtt();
      criar(telDe(att), String(id), fresco.f, nomeDaLinha(att, linha));
    }
    function aoIniciar(id) {
      recarregarAtt();
      registros[id] = { i: Date.now() };
      salvarAtt();
    }
    function aoAbrir(id, texto) {
      if (!ligado('cronometro') || !cfg.crono.auto) return;
      if (registros[id]?.i || registros[id]?.f || semEnvioAntes.has(id)) return;
      texto().then(t => {
        const lista = JSON.parse(t)?.data?.messages;
        if (!Array.isArray(lista)) return;
        semEnvioAntes.set(id, !lista.some(m => m?.type === 'sent'));
        if (semEnvioAntes.size > 200) semEnvioAntes.delete(semEnvioAntes.keys().next().value);
      }).catch(() => {});
    }
    function aoEnviar(id, msg) {
      if (!ligado('cronometro') || !cfg.crono.auto) return;
      recarregarAtt();
      const a = registros[id] || {};
      if (a.f) return;
      const podeContar = !!a.i || semEnvioAntes.get(id) === true;
      registros[id] = { ...a, f: podeContar ? horaDaMensagem(msg) : Date.now(), c: podeContar ? 0 : 1 };
      salvarAtt();
      if (podeContar) { pedirPermissaoNotificacao(); desenhar(); }
    }
    function limparRegistros() {
      const limite = Date.now() - GUARDAR_ATT;
      recarregarAtt();
      let mudou = false;
      for (const [id, a] of Object.entries(registros)) if (Math.max(a.i || 0, a.f || 0) < limite) { delete registros[id]; mudou = true; }
      if (mudou) salvarAtt();
    }

    function desenhar() {
      if (!ligado('cronometro')) return;
      const agora = Date.now();
      for (const linha of linhas()) {
        const att = attDaLinha(linha);
        const tel = att && secaoDaLinha(linha) === 'andamento' ? telDe(att) : '';
        let btn = linha.querySelector('.mst-crono');
        if (!tel) { btn?.remove(); linha.classList.remove('mst-esgotado'); continue; }
        if (cfg.crono.auto) resolverPendentes(att, linha);
        if (!btn) {
          btn = blindar(document.createElement('button'));
          btn.type = 'button';
          btn.className = `${NOSSO} mst-crono`;
          btn.innerHTML = `${ICONE}<span class="txt"></span>`;
          btn.addEventListener('click', clicar);
          linhaDeBaixo(linha)?.appendChild(btn);
        }
        if (btn.dataset.tel !== tel) { delete btn.dataset.confirmar; btn.dataset.tel = tel; }
        btn.dataset.nome = nomeDaLinha(att, linha);
        pintar(btn, estado(tel, agora));
      }
    }

    function tick() {
      if (!ligado('cronometro')) return;
      const agora = Date.now();
      let mudou = false;
      for (const tel of Object.keys(timers)) {
        const t = timers[tel];
        if (!t || agora < t.fim) continue;
        if (!t.avisado) {
          recarregar();
          const fresco = timers[tel];
          if (fresco && !fresco.avisado && agora >= fresco.fim) {
            fresco.avisado = true;
            salvar();
            som.fimDoTempo();
            notificacaoDoSistema('Tempo esgotado', `${fresco.nome || tel} — ${Math.round((fresco.duracao || duracao()) / 60000)} min completos`, { tag: 'mst-crono-' + tel, fixa: true });
            aviso(`Tempo esgotado: ${fresco.nome || tel}`, 'alerta');
          }
        } else if (agora - t.fim > LIMPAR_APOS) {
          delete timers[tel];
          salvar();
          mudou = true;
        }
      }
      if (mudou) { desenhar(); return; }
      if (document.hidden) return;
      for (const btn of document.querySelectorAll('.mst-crono:not([data-tipo=parado])')) pintar(btn, estado(btn.dataset.tel, agora));
    }

    function iniciar() {
      PAGINA.addEventListener('storage', e => {
        if (e.key === CHAVE) { recarregar(); desenhar(); }
        else if (e.key === CHAVE_ATT) { recarregarAtt(); desenhar(); }
      });
      ponte.on('iniciado', aoIniciar);
      ponte.on('historico', aoAbrir);
      ponte.on('enviada', aoEnviar);
      aoMudarPagina('cronometro', desenhar);
      setInterval(tick, 1000);
      setInterval(limparRegistros, 3600000);
      limparRegistros();
    }
    function desligar() {
      document.querySelectorAll('.mst-crono').forEach(e => e.remove());
      document.querySelectorAll('.mst-esgotado').forEach(e => e.classList.remove('mst-esgotado'));
    }
    return { iniciar, desenhar, desligar };
  })();

  // ── 5.3 Sinalizados com aviso ───────────────────────────────────────────
  //
  // O ChatPlay novo tem «Sinalizados» (etiqueta de cor no atendimento), mas
  // não avisa nada quando o cliente escreve, e a etiqueta some quando o
  // atendimento é finalizado. Aqui:
  //   - todo cliente sinalizado fica LEMBRADO pelo telefone (por N dias);
  //   - mensagem nova dele = som + card + notificação do Windows + (N) na aba
  //     + contador ao lado de «Sinalizados» no menu da esquerda;
  //   - se ele voltar num atendimento novo (finalizado antes), também avisa;
  //   - gatilho é o socket (`message-received`) com dedupe pelo ID: abrir e
  //     fechar a conversa não avisa de novo.

  const sinalizados = (() => {
    const CH_LEMBRADOS = 'mestre.sinalizados';
    const CH_PENDENTES = 'mestre.sinalizados.pendentes';
    const ROTULO_MIDIA = {
      IMAGEM: 'Imagem', IMAGE: 'Imagem', AUDIO: 'Áudio', PTT: 'Áudio', VIDEO: 'Vídeo', DOCUMENTO: 'Documento',
      DOCUMENT: 'Documento', STICKER: 'Figurinha', LOCALIZACAO: 'Localização', LOCATION: 'Localização', CONTATO: 'Contato', CONTACT: 'Contato'
    };
    const PALETA = [
      { Id: 1, Cor: '#44c2e1', Tag: 'Azul' }, { Id: 2, Cor: '#72e361', Tag: 'Verde' }, { Id: 3, Cor: '#b267d7', Tag: 'Roxo' },
      { Id: 4, Cor: '#c33831', Tag: 'Vermelho' }, { Id: 5, Cor: '#FFA500', Tag: 'Laranja' }
    ];
    let lembrados = GM_getValue(CH_LEMBRADOS, {}) || {};
    let pendentes = LS.ler(CH_PENDENTES, []);
    const vistos = new Set();
    const voltouAvisado = new Set();
    const notificacoes = new Map();
    let tituloBase = null;

    const paleta = () => (Array.isArray(eu.dados?.tag) && eu.dados.tag.length ? eu.dados.tag : PALETA);
    const corValida = c => !!c && String(c).trim().toLowerCase() !== 'transparente';
    const nomeDaCor = cor => paleta().find(p => String(p.Cor).toLowerCase() === String(cor || '').toLowerCase())?.Tag || 'Sinalizado';
    const salvarLembrados = () => GM_setValue(CH_LEMBRADOS, lembrados);
    const salvarPendentes = () => LS.gravar(CH_PENDENTES, pendentes);
    const telDoAtt = a => chaveTel(a?.contact || telDoTexto(a?.name));
    const nomeLimpo = n => String(n || '').replace(/\s*\(\d{10,13}\)\s*$/, '').trim();
    const fmtHora = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };

    function lembrar(att, cor) {
      const tel = telDoAtt(att);
      if (!tel || !corValida(cor)) return;
      const antes = lembrados[tel];
      lembrados[tel] = {
        tel, telFormatado: formatarTel(att.contact || telDoTexto(att.name)), nome: nomeLimpo(att.name) || antes?.nome || tel,
        cor, etiqueta: nomeDaCor(cor), att: String(att.id), desde: antes?.cor === cor ? antes.desde : Date.now(), visto: Date.now()
      };
      if (!antes || antes.cor !== cor || antes.att !== String(att.id)) { salvarLembrados(); ponte.emitir('sinalizados'); }
    }
    function esquecer(tel) {
      if (!lembrados[tel]) return;
      delete lembrados[tel];
      pendentes = pendentes.filter(p => p.tel !== tel);
      salvarLembrados();
      salvarPendentes();
      atualizarTudo();
    }
    function expirar() {
      const limite = Date.now() - Math.max(1, Number(cfg.sinal.lembrarDias) || 30) * 864e5;
      let mudou = false;
      for (const [tel, l] of Object.entries(lembrados)) if ((l.visto || l.desde) < limite) { delete lembrados[tel]; mudou = true; }
      if (mudou) salvarLembrados();
    }

    /** Listas do ChatPlay: quem tem etiqueta é lembrado; quem perdeu a etiqueta no MESMO atendimento é esquecido. */
    function lerLista(lista) {
      for (const a of lista || []) {
        const tel = telDoAtt(a);
        if (!tel) continue;
        if (corValida(a.tagColor)) lembrar(a, a.tagColor);
        else if ('tagColor' in a && lembrados[tel]?.att === String(a.id) && a._secao !== 'aguardando') esquecer(tel);
        else if (lembrados[tel]) lembrados[tel].visto = Math.max(lembrados[tel].visto || 0, Date.now() - 1);
      }
    }
    /** Etiqueta trocada nesta tela (POST /attendments/tag/insert-update). */
    function aoEtiquetar({ idAttendment, idTag }) {
      const att = atendimentos.get(String(idAttendment));
      if (!att) return;
      const cor = paleta().find(p => Number(p.Id) === Number(idTag))?.Cor;
      if (!idTag || !corValida(cor)) esquecer(telDoAtt(att));
      else lembrar(att, cor);
    }

    function conversaVisivel(attId) {
      return !document.hidden && String(ponte.atendimentoId) === String(attId) && !!campoDoChat();
    }
    function previa(d) {
      const tipo = String(d.contentType || d.messageType || '').toUpperCase();
      const txt = String(d.text || d.mediaCaption || '').replace(/\s+/g, ' ').trim();
      return txt ? txt.slice(0, 90) + (txt.length > 90 ? '…' : '') : ROTULO_MIDIA[tipo] || 'Mensagem nova';
    }

    function aoMensagem(d) {
      if (!ligado('sinalizados') || d?.type !== 'received' || d.id == null) return;
      const chaveMsg = String(d.id);
      if (vistos.has(chaveMsg)) return;
      vistos.add(chaveMsg);
      if (vistos.size > 1000) vistos.delete(vistos.values().next().value);
      const att = atendimentos.get(String(d.attendmentId));
      const tel = chaveTel(d.NumberFormated || att?.contact || telDoTexto(att?.name));
      const l = tel && lembrados[tel];
      const daLista = att && corValida(att.tagColor);
      if (!l && !daLista) return;
      if (daLista && !l) lembrar(att, att.tagColor);
      const info = lembrados[tel] || {};
      if (conversaVisivel(d.attendmentId)) return;
      const voltou = info.att && info.att !== String(d.attendmentId);
      avisar({
        tel, att: String(d.attendmentId), nome: info.nome || nomeLimpo(att?.name) || formatarTel(d.NumberFormated),
        cor: info.cor || att?.tagColor, etiqueta: info.etiqueta || nomeDaCor(att?.tagColor), texto: previa(d),
        hora: fmtHora(d.datetime), tipo: voltou ? 'voltou' : 'msg', idMsg: chaveMsg
      });
    }
    /** Cliente lembrado entrou de novo na fila (atendimento novo). */
    function aoNovoAtendimento(a) {
      if (!ligado('sinalizados') || !cfg.sinal.voltou || !a?.id) return;
      const tel = telDoAtt(a);
      const l = tel && lembrados[tel];
      if (!l || l.att === String(a.id) || voltouAvisado.has(String(a.id))) return;
      voltouAvisado.add(String(a.id));
      avisar({ tel, att: String(a.id), nome: l.nome, cor: l.cor, etiqueta: l.etiqueta, texto: `Voltou: novo atendimento${a.sectorName ? ' em ' + a.sectorName : ''}.`, hora: fmtHora(a.lastUpdate), tipo: 'voltou', idMsg: 'v' + a.id });
    }

    function avisar(p) {
      pendentes = [p, ...pendentes.filter(x => x.tel !== p.tel)].slice(0, 30);
      salvarPendentes();
      if (cfg.sinal.som) (p.tipo === 'voltou' ? som.voltou() : som.alerta());
      if (cfg.sinal.notificacao) {
        notificacoes.get(p.tel)?.close?.();
        const n = notificacaoDoSistema(`${p.tipo === 'voltou' ? 'Sinalizado voltou' : 'Sinalizado'} · ${p.nome}`, p.texto, { tag: 'mst-sinal-' + p.tel, fixa: true, aoClicar: () => abrir(p.tel) });
        if (n) notificacoes.set(p.tel, n);
      }
      atualizarTudo();
    }
    function dispensar(tel) {
      pendentes = pendentes.filter(p => p.tel !== tel);
      salvarPendentes();
      notificacoes.get(tel)?.close?.();
      notificacoes.delete(tel);
      atualizarTudo();
    }
    async function abrir(tel) {
      const p = pendentes.find(x => x.tel === tel);
      const l = lembrados[tel];
      const att = p?.att || l?.att;
      dispensar(tel);
      if (!att) return;
      const foi = await abrirAtendimento(att);
      if (!foi) aviso('Esse atendimento não está na sua lista agora (pode ter sido finalizado ou estar com outra pessoa).', 'alerta');
    }
    /** Conversa aberta de um pendente: o aviso dele some. */
    function limparAberta() {
      const id = ponte.atendimentoId;
      if (!id || document.hidden) return;
      const p = pendentes.find(x => x.att === String(id));
      if (p) dispensar(p.tel);
    }

    // ── na tela ──
    function contador() {
      const btn = [...document.querySelectorAll('aside button')].find(b => visivel(b) && /^\s*Sinalizados\s*$/.test(b.textContent || '') && b.querySelector('svg'));
      let el = btn?.querySelector('.mst-qtd-sinal');
      const n = ligado('sinalizados') ? pendentes.length : 0;
      if (!btn || !n) { el?.remove(); return; }
      if (!el) { el = document.createElement('span'); el.className = `${NOSSO} mst-qtd-sinal`; btn.appendChild(el); }
      if (el.textContent !== String(n)) el.textContent = String(n);
      el.title = `${n} sinalizado(s) com mensagem nova`;
    }
    function titulo() {
      const atual = document.title.replace(/^\(\d+\)\s*/, '');
      if (tituloBase == null || atual !== tituloBase) tituloBase = atual;
      const n = ligado('sinalizados') && cfg.visual.contadorNaAba ? pendentes.length : 0;
      const novo = n ? `(${n}) ${tituloBase}` : tituloBase;
      if (document.title !== novo) document.title = novo;
    }
    function atualizarTudo() {
      contador();
      titulo();
      ponte.emitir('sinalizados');
    }

    function iniciar() {
      expirar();
      ponte.on('lista', (_, lista) => lerLista(lista));
      ponte.on('etiqueta', aoEtiquetar);
      ponte.on('socket', (evento, d) => {
        if (evento === 'message-received' || evento === 'message-received-department') aoMensagem(d || {});
        else if (evento === 'waiting-attendment-received' || evento === 'update-attendment-start') aoNovoAtendimento(d);
        else if (d && corValida(d.tagColor)) lembrar(d, d.tagColor);
      });
      ponte.on('atendimento', () => setTimeout(limparAberta, 800));
      document.addEventListener('visibilitychange', limparAberta);
      aoMudarPagina('sinalizados', contador);
      PAGINA.addEventListener('storage', e => { if (e.key === CH_PENDENTES) { pendentes = LS.ler(CH_PENDENTES, []); atualizarTudo(); } });
      // Aba segurando um Web Lock não é congelada pelo navegador em segundo plano
      try { PAGINA.navigator.locks?.request('mst-sinal-' + Math.random().toString(36).slice(2), () => new Promise(() => {})).catch(() => {}); } catch { /* ignora */ }
      setInterval(() => { titulo(); expirar(); }, 5000);
      quemSouEu().catch(() => {});
      atualizarTudo();
    }
    function desligar() {
      document.querySelectorAll('.mst-qtd-sinal').forEach(e => e.remove());
      titulo();
    }
    return {
      iniciar, desligar, abrir, dispensar, esquecer, lembrar,
      get pendentes() { return pendentes; },
      get lembrados() { return Object.values(lembrados).sort((a, b) => (b.desde || 0) - (a.desde || 0)); },
      limparPendentes() { pendentes = []; salvarPendentes(); for (const n of notificacoes.values()) n.close?.(); notificacoes.clear(); atualizarTudo(); },
      testar() { som.liberar(); avisar({ tel: 'teste', att: '', nome: 'Cliente de teste', cor: '#44c2e1', etiqueta: 'Azul', texto: 'Som, card e notificação funcionando.', hora: fmtHora(new Date()), tipo: 'msg', idMsg: 't' + Date.now() }); }
    };
  })();

  // ── 5.4 WallPaper ───────────────────────────────────────────────────────

  const papel = (() => {
    const CHAVE_IMG = 'mestre.papel.img';
    const PRESETS = {
      aurora: { nome: 'Aurora', css: 'radial-gradient(1200px 600px at 10% 10%, #4f46e5aa, transparent 60%), radial-gradient(900px 500px at 90% 30%, #06b6d4aa, transparent 60%), radial-gradient(800px 600px at 50% 100%, #a855f7aa, transparent 60%), #0f172a' },
      oceano: { nome: 'Oceano', css: 'linear-gradient(160deg, #0c4a6e 0%, #0369a1 45%, #22d3ee 100%)' },
      grafite: { nome: 'Grafite', css: 'radial-gradient(#ffffff14 1px, transparent 1px) 0 0/18px 18px, linear-gradient(180deg, #1f2937, #111827)' },
      por_do_sol: { nome: 'Pôr do sol', css: 'linear-gradient(170deg, #7c2d12 0%, #ea580c 40%, #fbbf24 100%)' },
      menta: { nome: 'Menta', css: 'radial-gradient(#0f766e22 1.2px, transparent 1.2px) 0 0/16px 16px, linear-gradient(180deg, #ecfdf5, #d1fae5)' },
      papel: { nome: 'Papel', css: 'repeating-linear-gradient(0deg, #00000008 0 1px, transparent 1px 28px), linear-gradient(180deg, #fefcf6, #f5efe0)' },
      noite: { nome: 'Noite', css: 'radial-gradient(1px 1px at 20% 30%, #fff9, transparent), radial-gradient(1px 1px at 70% 60%, #fff8, transparent), radial-gradient(1.5px 1.5px at 40% 80%, #fffa, transparent), radial-gradient(1px 1px at 85% 15%, #fff7, transparent), linear-gradient(180deg, #020617, #1e1b4b)' },
      rosa: { nome: 'Rosé', css: 'linear-gradient(135deg, #fdf2f8 0%, #fbcfe8 50%, #f9a8d4 100%)' }
    };
    let imagem = cfg.papel.ativo && cfg.papel.tipo === 'imagem' ? GM_getValue(CHAVE_IMG, '') || '' : null;
    const carregada = () => (imagem ??= GM_getValue(CHAVE_IMG, '') || '');
    const ALVO = '[data-mst-papel]';

    /**
     * Balões 100% opacos com WallPaper. O ChatPlay pinta o enviado com
     * `bg-emerald-500/10` (10% de opacidade) e o recebido com `bg-muted`
     * (65%): sobre o fundo liso não se nota, sobre um papel de parede ele
     * aparece através do balão. Aqui vão as mesmas cores, já misturadas e opacas.
     */
    function baloesOpacos() {
      const escuro = tema.atual === 'escuro';
      const enviado = escuro ? '#123a33' : '#e2f6ee';
      const recebido = escuro ? '#1e293b' : '#e8f1fa';
      const sombra = escuro ? '0 1px 2px rgba(0,0,0,.45)' : '0 1px 2px rgba(15,23,42,.16)';
      const ENV = '[class*="rounded-[16px_16px_4px_16px]"]';
      const REC = '[class*="rounded-[16px_16px_16px_4px]"]';
      return `${ALVO} ${ENV}{background:${enviado}!important;box-shadow:${sombra}}` +
        `${ALVO} ${REC}{background:${recebido}!important;box-shadow:${sombra}}`;
    }
    // «scroll» no contêiner que rola = o fundo fica preso à parte VISÍVEL da conversa (não se
    // estica pela conversa inteira nem anda junto com as mensagens).
    function fundo() {
      const p = cfg.papel;
      if (!ligado('papel') || !p.ativo || p.tipo === 'nenhum') return '';
      const veu = Math.min(Math.max(Number(p.veu) || 0, 0), 90) / 100;
      const corVeu = tema.atual === 'escuro' ? `rgba(2, 6, 23, ${veu})` : `rgba(255, 255, 255, ${veu})`;
      const camada = `linear-gradient(${corVeu}, ${corVeu})`;
      if (p.tipo === 'imagem' && carregada()) {
        const tam = p.ajuste === 'contain' ? 'contain' : p.ajuste === 'repeat' ? 'auto' : 'cover';
        const rep = p.ajuste === 'repeat' ? 'repeat' : 'no-repeat';
        return `${ALVO}{background-image:${camada},url("${imagem.replace(/"/g, '%22')}")!important;background-size:auto,${tam}!important;background-position:center,${p.x}% ${p.y}%!important;background-repeat:no-repeat,${rep}!important;background-attachment:scroll,scroll!important;background-color:${tema.atual === 'escuro' ? '#020617' : '#f4f4f5'}!important}` + baloesOpacos();
      }
      return `${ALVO}{background:${camada},${(PRESETS[p.preset] || PRESETS.aurora).css}!important;background-attachment:scroll!important}` + baloesOpacos();
    }
    function marcar() {
      const alvo = areaDasMensagens();
      const atual = document.querySelector(ALVO);
      if (atual && atual !== alvo) atual.removeAttribute('data-mst-papel');
      if (alvo && !alvo.hasAttribute('data-mst-papel')) alvo.setAttribute('data-mst-papel', '');
    }
    function aplicar() { estilo('mst-papel', fundo()); marcar(); }
    async function comprimir(arquivo) {
      if (!/^image\//.test(arquivo?.type || '')) throw new Error('Escolha um arquivo de imagem.');
      if (arquivo.size > 25 * 1024 * 1024) throw new Error('Imagem muito grande (máx. 25 MB).');
      const url = URL.createObjectURL(arquivo);
      try {
        const img = await new Promise((ok, erro) => {
          const i = new Image();
          i.onload = () => ok(i);
          i.onerror = () => erro(new Error('Não consegui abrir esta imagem.'));
          i.src = url;
        });
        const max = 2560;
        const escala = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
        const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        let dado = canvas.toDataURL('image/webp', 0.86);
        if (!dado.startsWith('data:image/webp')) dado = canvas.toDataURL('image/jpeg', 0.86);
        return { dado, w, h };
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    async function usarArquivo(arquivo) {
      const { dado, w, h } = await comprimir(arquivo);
      imagem = dado;
      GM_setValue(CHAVE_IMG, dado);
      Object.assign(cfg.papel, { ativo: true, tipo: 'imagem', x: 50, y: 50 });
      salvarCfg(true);
      aplicar();
      return { w, h, kb: Math.round((dado.length * 3) / 4 / 1024) };
    }
    function removerImagem() {
      imagem = '';
      GM_setValue(CHAVE_IMG, '');
      if (cfg.papel.tipo === 'imagem') cfg.papel.tipo = 'nenhum';
      salvarCfg(true);
      aplicar();
    }
    return {
      PRESETS, aplicar, usarArquivo, removerImagem,
      get imagem() { return carregada(); },
      iniciar() { ponte.on('tema', aplicar); aoMudarPagina('papel', marcar); aplicar(); }
    };
  })();

  // ── 5.5 Apresentação automática (Cofen) ─────────────────────────────────
  //
  // A regra do AutoMensagem COREN v11, lendo a API em vez da tela:
  //   com vínculo → apresentação ao profissional, com a regional do Coren;
  //   sem vínculo → pedido de CPF.
  // Disparo: a resposta de POST /attendments/{id}/start (só o «Sim» gera essa chamada).
  // Antes de escrever, confere que a conversa aberta é a desse atendimento (id aberto e
  // nome ou telefone no cabeçalho, lidos duas vezes). Se não der para provar, não escreve.

  const abordagem = (() => {
    let token = null;

    function variaveis(dados) {
      const cli = dados?.cliente || {};
      const coren = dados?.coren || 'Coren';
      return {
        vars: {
          SAUDACAO: saudacaoDaHora(),
          NOME: cli.nome || '',
          PRIMEIRO_NOME: primeiroNome(cli.nome),
          OPERADOR: cfg.operador || '',
          COREN: coren,
          DO_COREN: 'do ' + coren,
          CPF: formatarCpf(cli.cpf),
          TELEFONE: formatarTel(cli.telefone),
          PROTOCOLO: cli.protocoloAtendimento || '',
          HOJE: new Date().toLocaleDateString('pt-BR')
        },
        conds: { SEM_VINCULO: !!dados?.semVinculo }
      };
    }
    const situacao = dados => (dados?.semVinculo ? 'cpf' : 'apresentacao');

    function montar(dados, { modelo = null, tipo = null } = {}) {
      const qual = tipo || situacao(dados);
      const { vars, conds } = variaveis(dados);
      const m = modelo || modeloEmUso(qual);
      return { texto: renderizarModelo(m?.texto || '', vars, conds), tipo: qual, coren: vars.COREN };
    }

    /** O cabeçalho mostra o nome do contato (ou o telefone, sem vínculo). */
    function confere(cli) {
      const tela = nomeNaTela();
      const n = normalizarNome(tela);
      if (n && [cli.nome, cli.nomeContato].some(x => x && normalizarNome(x) === n)) return true;
      const dig = tela.replace(/\D/g, '');
      return dig.length >= 10 && !!cli.telefone && chaveTel(dig) === chaveTel(cli.telefone);
    }

    async function executar(id, manual = false) {
      if (!manual && (!ligado('abordagem') || !cfg.abordagemAuto)) return;
      if (!cfg.operador) { aviso('Preencha seu nome em Ajustes para gerar a apresentação.', 'erro'); return; }
      if (token) token.cancelado = true;
      const tk = (token = { cancelado: false });
      const t0 = performance.now();
      try {
        const dados = await carregarCliente(id, true);
        if (tk.cancelado) return;
        let iguais = 0;
        const certo = await esperar(() => {
          if (tk.cancelado) return 'cancelado';
          const ok = ponte.atendimentoId === String(id) && confere(dados.cliente) && !!campoDoChat();
          iguais = ok ? iguais + 1 : 0;
          return iguais >= 2;
        }, 8000, 60);
        if (certo !== true) {
          if (!tk.cancelado) aviso('Mensagem não colocada: a conversa aberta não confirmou o cliente.', 'alerta');
          return;
        }
        const { texto, tipo, coren } = montar(dados);
        const campo = campoDoChat();
        if (tk.cancelado || !campo || ponte.atendimentoId !== String(id) || !confere(dados.cliente)) return;
        if (campo.value.trim() && !manual) { aviso('Mensagem não colocada: o campo de mensagem já tem texto.', 'alerta'); return; }
        escreverNoCampo(campo, texto);
        if (tipo === 'cpf') aviso('Sem vínculo: pedido de CPF no campo.');
        else if (dados.corenFonte) aviso(`Apresentação no campo · ${coren} · ${Math.round(performance.now() - t0)} ms`);
        else aviso('Apresentação no campo, mas a regional do Coren não apareceu: saiu só «Coren». Confira.', 'alerta');
        ponte.emitir('abordagem-colocada', id);
      } catch (e) {
        if (!tk.cancelado) aviso('Apresentação: ' + (e.message || e), 'erro');
      }
    }

    return { iniciar() { ponte.on('iniciado', id => executar(id)); }, executar, montar, variaveis, situacao };
  })();

  // ── 5.6 Vínculo no cabeçalho da conversa ───────────────────────────────

  const cabecalhoVinculo = (() => {
    const porAtt = new Map();
    const nomeDoUsuario = u => String(u || '').replace(/[_.]+/g, ' ').trim().toLowerCase().replace(/(^|\s)\S/g, l => l.toUpperCase());

    function guardar(id, docs) {
      porAtt.set(String(id), vinculoDaTabulacao(docs));
      if (porAtt.size > 200) porAtt.delete(porAtt.keys().next().value);
    }
    function carregar(id) {
      desenhar();
      if (!ligado('vinculo') || !id) return;
      tabulacoesDe(id).then(docs => { guardar(id, docs); desenhar(); }, () => {});
    }
    function desenhar() {
      const atual = document.querySelector('.mst-vinculo');
      const id = ponte.atendimentoId;
      const v = ligado('vinculo') && id ? porAtt.get(String(id)) : null;
      const cab = v && cabecalho();
      const nomeBtn = cab?.querySelector('button[aria-label="Abrir dados do contato"]');
      if (!nomeBtn) { atual?.remove(); return; }
      const chave = [id, v.tipo, v.usuario, v.setor, v.ate, v.prevPgto].join('|');
      if (atual?.dataset.chave === chave && atual.previousElementSibling === nomeBtn) return;
      atual?.remove();
      const quem = nomeDoUsuario(v.usuario) || 'operador não informado';
      const prazo = v.tipo === 'acordo' && v.prevPgto ? 'pagamento previsto ' + v.prevPgto.slice(0, 5) : 'retorno ' + v.ate.slice(0, 5);
      const el = document.createElement('div');
      el.className = `${NOSSO} mst-vinculo`;
      el.dataset.chave = chave;
      el.dataset.tipo = v.tipo;
      el.innerHTML = `<i></i><div><b>${v.tipo === 'acordo' ? 'Acordo fechado' : 'Em negociação'} com ${esc(quem)}</b><small>${esc([v.setor, prazo].filter(Boolean).join(' · '))}</small></div>`;
      el.title = `Última tabulação: ${v.situacao} em ${v.data} por ${v.usuario || '?'}${v.setor ? ' (' + v.setor + ')' : ''}. Próximo contato ${v.ate}${v.prevPgto ? ', previsão de pagamento ' + v.prevPgto : ''}.`;
      nomeBtn.after(el);
    }
    function iniciar() {
      ponte.on('atendimento', carregar);
      ponte.on('tabulacoes', (id, docs) => { guardar(id, docs); if (String(id) === String(ponte.atendimentoId)) desenhar(); });
      aoMudarPagina('vinculo', desenhar);
      if (ponte.atendimentoId) carregar(ponte.atendimentoId);
    }
    return { iniciar, desenhar, desligar: () => document.querySelectorAll('.mst-vinculo').forEach(e => e.remove()), carregar };
  })();

  // ── 5.7 Retomar conversas (recuperação) ─────────────────────────────────
  //
  // Marca clientes (no avatar da fila ou por filtro de pasta e tempo parado)
  // e manda a mensagem de retomada em lote, com pausas sorteadas, descanso a
  // cada 50 e nova tentativa quando o servidor reclama.

  const recuperacao = (() => {
    const mapa = new Map();
    const selecionados = new Set(cfg.rec.selecionados.map(String));
    let enviando = false, parar = false, status = 'Ninguém selecionado';

    function salvar() {
      cfg.rec.selecionados = [...selecionados];
      salvarCfg();
      ponte.emitir('recuperacao');
      pintarMarcadores();
    }
    function mudarStatus(t) { status = t; ponte.emitir('recuperacao'); }
    const textoDaVez = () => {
      const nome = String(cfg.operador || '').trim();
      const fixo = modeloEmUso('recuperacao');
      const base = cfg.rec.aleatoria && nome ? mensagemRecAleatoria(nome)
        : renderizarModelo(fixo?.texto || '', { SAUDACAO: saudacaoDaHora(), OPERADOR: nome }, {});
      return corrigirSaudacao(base);
    };

    function absorver(lista) {
      mapa.clear();
      for (const a of lista) {
        const ultima = a.lastUpdate ? new Date(a.lastUpdate).getTime() : NaN;
        mapa.set(String(a.id), {
          nome: (a.name || '').replace(/\s*\(\d+\)\s*$/, '').trim(),
          pasta: nomePasta(a.departmentId) || a.sectorName || '',
          operador: a.usernameAttendant || '',
          ultima: Number.isFinite(ultima) ? ultima : null
        });
      }
      pintarMarcadores();
      ponte.emitir('recuperacao');
    }
    async function atualizarMapa() {
      try { absorver(await api.progresso()); } catch { /* tenta de novo */ }
    }
    const pastas = () => [...new Set([...mapa.values()].map(i => i.pasta).filter(Boolean))].sort();

    function alternar(id) {
      id = String(id);
      if (selecionados.has(id)) selecionados.delete(id); else selecionados.add(id);
      salvar();
    }
    function limpar() { selecionados.clear(); salvar(); }

    async function selecionarParados() {
      await atualizarMapa();
      const limite = cfg.rec.usarTempo ? Date.now() - Math.max(1, cfg.rec.minutos) * 60000 : null;
      let novos = 0;
      for (const [id, i] of mapa) {
        if (cfg.rec.pasta && i.pasta !== cfg.rec.pasta) continue;
        if (limite != null && (i.ultima == null || i.ultima > limite)) continue;
        if (!selecionados.has(id)) { selecionados.add(id); novos++; }
      }
      salvar();
      const filtro = (cfg.rec.pasta || 'todas as pastas') + (limite != null ? `, parados desde ${new Date(limite).toTimeString().slice(0, 5)}` : '');
      aviso(novos ? `${novos} selecionado(s) (${filtro}). Confira e envie.` : `Nenhum atendimento novo em ${filtro}.`, novos ? 'ok' : 'alerta');
    }

    async function enviar() {
      if (enviando) { parar = true; return; }
      if (!selecionados.size) return aviso('Ninguém selecionado.', 'alerta');
      if (cfg.rec.aleatoria && !cfg.operador) return aviso('Preencha seu nome em Ajustes para as mensagens aleatórias.', 'erro');
      enviando = true;
      parar = false;
      const lista = [...selecionados];
      let ok = 0, falha = 0;
      const pausa = async (ms, rotulo) => {
        const ate = Date.now() + ms;
        while (!parar && Date.now() < ate) {
          if (rotulo) mudarStatus(`${rotulo} ${Math.ceil((ate - Date.now()) / 1000)}s`);
          await sleep(Math.min(500, ate - Date.now()));
        }
      };
      for (let i = 0; i < lista.length && !parar; i++) {
        const id = lista[i];
        mudarStatus(`Enviando ${i + 1}/${lista.length} → ${mapa.get(id)?.nome || '#' + id}`);
        let deu = false;
        for (let tent = 1; tent <= 3 && !parar; tent++) {
          try { await api.enviarMensagem(id, textoDaVez()); deu = true; break; } catch (e) {
            const repetir = !e.status || e.status === 429 || e.status >= 500;
            if (!repetir || tent === 3) break;
            await pausa(5000 * tent);
          }
        }
        if (deu) { ok++; selecionados.delete(id); } else falha++;
        if (i + 1 >= lista.length) break;
        if ((i + 1) % 50 === 0) await pausa(20000, `${i + 1}/${lista.length} · pausa de segurança`);
        else await pausa(1000 + Math.random() * 2000);
      }
      const parado = parar;
      enviando = parar = false;
      salvar();
      mudarStatus(`${parado ? 'Parado' : 'Pronto'}: ${ok} enviada(s) · ${falha} falha(s)${parado ? ` · ${selecionados.size} ainda selecionado(s)` : ''}`);
      aviso(`Retomada: ${ok} enviada(s)${falha ? `, ${falha} falha(s)` : ''}.`, falha ? 'alerta' : 'ok');
    }

    function agendar(hhmm) {
      const [h, m] = String(hhmm).split(':').map(Number);
      if (!Number.isFinite(h)) return;
      const alvo = new Date();
      alvo.setHours(h, m || 0, 0, 0);
      if (alvo.getTime() <= Date.now()) alvo.setDate(alvo.getDate() + 1);
      cfg.rec.agendadoPara = alvo.getTime();
      salvarCfg(true);
      ponte.emitir('recuperacao');
      aviso(`Retomada agendada para ${formatarAgenda(cfg.rec.agendadoPara)}.`);
    }
    function cancelarAgenda() {
      cfg.rec.agendadoPara = 0;
      salvarCfg(true);
      ponte.emitir('recuperacao');
    }
    function formatarAgenda(ts) {
      const d = new Date(ts);
      const hora = d.toTimeString().slice(0, 5);
      return d.toDateString() === new Date().toDateString() ? `hoje às ${hora}` : `${d.toLocaleDateString('pt-BR')} às ${hora}`;
    }
    function verificarAgenda() {
      const quando = cfg.rec.agendadoPara;
      if (!quando || Date.now() < quando) return;
      cancelarAgenda();
      if (Date.now() - quando > 10 * 60000) return mudarStatus(`Agendamento de ${formatarAgenda(quando)} perdido: o ChatPlay estava fechado.`);
      if (!selecionados.size) return mudarStatus(`No horário (${formatarAgenda(quando)}) não havia ninguém selecionado.`);
      enviar();
    }

    // ── marcador no avatar de cada conversa da fila ──
    const ICONE = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    function desenharMarcadores() {
      const mostrar = ligado('recuperacao') && cfg.visual.marcadorRecuperacao;
      for (const linha of linhas()) {
        const avatar = linha.firstElementChild;
        let cb = avatar?.querySelector(':scope > .mst-rec');
        const att = mostrar ? attDaLinha(linha) : null;
        const id = att && secaoDaLinha(linha) === 'andamento' ? String(att.id) : null;
        if (!id || !avatar) { cb?.remove(); linha.classList.remove('mst-rec-marcada'); continue; }
        if (!cb) {
          cb = blindar(Object.assign(document.createElement('button'), { type: 'button', className: `${NOSSO} mst-rec`, innerHTML: ICONE }));
          cb.addEventListener('click', e => { e.preventDefault(); alternar(cb.dataset.id); });
          avatar.style.position = 'relative';
          avatar.appendChild(cb);
        }
        cb.dataset.id = id;
      }
      pintarMarcadores();
    }
    function pintarMarcadores() {
      for (const cb of document.querySelectorAll('.mst-rec')) {
        const m = selecionados.has(cb.dataset.id);
        cb.classList.toggle('marcado', m);
        cb.title = m ? 'Tirar da retomada' : 'Marcar para retomada';
        cb.closest('[role="button"]')?.classList.toggle('mst-rec-marcada', m);
      }
    }

    function iniciar() {
      aoMudarPagina('recuperacao', desenharMarcadores);
      ponte.on('lista', (secao, lista) => { if (ligado('recuperacao') && secao === 'andamento') absorver(lista); });
      setInterval(() => { if (ligado('recuperacao') && painelAberto('recuperacao') && !document.hidden) atualizarMapa(); }, 15000);
      setInterval(verificarAgenda, 15000);
      verificarAgenda();
    }
    function desligar() {
      document.querySelectorAll('.mst-rec').forEach(e => e.remove());
      document.querySelectorAll('.mst-rec-marcada').forEach(e => e.classList.remove('mst-rec-marcada'));
    }
    return {
      iniciar, desligar, alternar, limpar, selecionarParados, enviar, agendar, cancelarAgenda, formatarAgenda, pastas,
      desenharMarcadores, textoDaVez, atualizarMapa,
      get selecionados() { return selecionados; }, get mapa() { return mapa; },
      get status() { return status; }, get enviando() { return enviando; }
    };
  })();

  // ── 5.8 Trava de setores (opcional, vem desligada) ──────────────────────
  //
  // No «Sim» da janela «Iniciar atendimento», com a trava ligada e no horário:
  // cliente de um setor escolhido em Ajustes (pelo agendamento recente da
  // qualidade ou, sem ele, pela pasta por onde entrou) é segurado com uma tela
  // vermelha. Não existe no Cofen.

  const trava = (() => {
    const qualidadePorAtt = new Map();
    function buscarQualidade(attId) {
      if (!attId || qualidadePorAtt.has(String(attId))) return;
      qualidadePorAtt.set(String(attId), 'buscando');
      api.toolbar(attId, 3).then(docs => qualidadePorAtt.set(String(attId), setorDaQualidade(docs)), () => qualidadePorAtt.delete(String(attId)));
      if (qualidadePorAtt.size > 300) qualidadePorAtt.delete(qualidadePorAtt.keys().next().value);
    }
    function qualidadeRecente(attId) {
      const q = attId != null ? qualidadePorAtt.get(String(attId)) : null;
      return q && q !== 'buscando' && q.setor && q.dias != null && q.dias <= (Number(cfg.calc.diasQualidade) || 30) ? q : null;
    }
    /** Setor travado? A qualidade recente manda; sem ela, vale a pasta por onde entrou. */
    function setorTravado(att) {
      const alvo = cfg.trava.setores || [];
      if (!alvo.length) return '';
      const q = qualidadeRecente(att?.id);
      if (q) return alvo.includes(q.setor) ? q.texto : '';
      const pasta = nomePasta(att?.departmentId) || '';
      const s = setorDaPasta(pasta);
      return s && alvo.includes(s) ? pasta : '';
    }
    const minutos = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
    function valendo(t = cfg.trava) {
      if (!t.ligada) return false;
      const d = new Date();
      const agora = d.getHours() * 60 + d.getMinutes();
      const ini = minutos(t.inicio), fim = minutos(t.fim);
      if (ini === fim) return true;
      return ini < fim ? agora >= ini && agora < fim : agora >= ini || agora < fim;
    }

    function telaVermelha({ titulo, nome, texto, botoes }) {
      document.getElementById('mst-play3')?.remove();
      const fundo = document.createElement('div');
      fundo.id = 'mst-play3';
      fundo.className = NOSSO;
      ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'focusin', 'focusout', 'keydown']
        .forEach(t => fundo.addEventListener(t, e => e.stopPropagation()));
      fundo.innerHTML = `<div class="caixa" role="alertdialog" aria-label="${esc(titulo)}"><span class="cadeado">${icone('cadeado', 26)}</span><b>${esc(titulo)}</b><strong>${esc(nome || '')}</strong><p>${esc(texto)}</p><div class="botoes"></div></div>`;
      const linha = fundo.querySelector('.botoes');
      let foco = null;
      for (const b of botoes) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = b.rotulo;
        if (b.principal) { btn.className = 'principal'; foco = btn; }
        btn.addEventListener('click', ev => { ev.stopPropagation(); fundo.remove(); b.acao?.(); });
        linha.appendChild(btn);
      }
      fundo.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); foco?.click(); } });
      document.body.appendChild(fundo);
      foco?.focus();
      som.bloqueio();
    }

    function aoClicar(ev) {
      if (!COM_TRAVA || !cfg.trava.ligada) return;
      // Clique numa linha de «Aguardando»: já busca a qualidade (fica pronta antes do «Sim»)
      const linha = ev.target?.closest?.(SEL.linha);
      if (linha && secaoDaLinha(linha) === 'aguardando') { buscarQualidade(attDaLinha(linha)?.id); return; }
      if (!ev.isTrusted || !valendo()) return;
      const btn = ev.target?.closest?.('button');
      if (!btn || !/^\s*Sim\s*$/i.test(btn.textContent || '')) return;
      const d = btn.closest('[role="dialog"]');
      if (!d || d.dataset.mstLiberado === '1' || !/Iniciar atendimento/i.test(d.textContent || '')) return;
      const att = propsCom(btn, ehAtendimento, 30) || propsCom(d, ehAtendimento, 30);
      const setor = att && setorTravado(att);
      if (!setor) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      telaVermelha({
        titulo: 'CLIENTE ' + setor.toUpperCase() + ' BLOQUEADO',
        nome: nomeDaLinha(att),
        texto: 'Esse cliente é do ' + setor + ' e não pode ser pego.',
        botoes: [
          { rotulo: 'Cancelar', principal: true, acao: () => [...d.querySelectorAll('button')].find(b => /^\s*Cancelar\s*$/i.test(b.textContent || ''))?.click() },
          { rotulo: 'Continuar mesmo assim', acao: () => { d.dataset.mstLiberado = '1'; btn.click(); } }
        ]
      });
    }
    return {
      valendo,
      iniciar() { if (COM_TRAVA) document.addEventListener('click', aoClicar, true); }
    };
  })();

  // ═══════════════════════════════════════════════════════════════════════
  // 6. ESTILOS — só variáveis do próprio CRM (claro e escuro de graça)
  // ═══════════════════════════════════════════════════════════════════════

  function cssDaPagina() {
    return `
/* ── fila ── */
.mst-chip{display:inline-flex;align-items:center;min-width:0;max-width:128px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:1;
  border-radius:4px;padding:2px 6px;font-size:10px;line-height:14px;font-weight:600;color:var(--cor,var(--muted-foreground));
  background:color-mix(in srgb,var(--cor,var(--muted-foreground)) 13%,transparent)}
.mst-setor{flex-shrink:0}
.mst-crono{flex:none;display:inline-flex;align-items:center;gap:3px;height:18px;padding:0 6px 0 3px;border:0;border-radius:999px;background:transparent;
  color:var(--muted-foreground);cursor:pointer;font:600 10px/18px inherit;font-family:inherit;font-variant-numeric:tabular-nums;opacity:.45;transition:opacity .15s,background .15s}
.mst-crono svg{width:14px;height:14px;flex:none}
.mst-crono .trilho{stroke:currentColor;opacity:.22}
.mst-crono .prog{stroke:currentColor;transition:stroke-dashoffset .9s linear}
.mst-crono .txt:empty{display:none}
.mst-crono[data-tipo=parado]{opacity:0}
[role="button"]:hover .mst-crono,.mst-crono:focus-visible{opacity:1}
.mst-crono:not([data-tipo=parado]){opacity:1}
.mst-crono[data-tipo=rodando]{color:var(--primary);background:color-mix(in srgb,var(--primary) 11%,transparent)}
.mst-crono[data-tipo=alerta],.mst-crono[data-tipo=confirmar]{color:#d97706;background:color-mix(in srgb,#f59e0b 16%,transparent)}
.mst-crono[data-tipo=fim]{color:#fff;background:var(--destructive);animation:mst-pulso 1.2s ease-in-out infinite}
.mst-esgotado{box-shadow:inset 3px 0 0 var(--destructive)}
.mst-rec{position:absolute;right:-4px;bottom:-4px;width:16px;height:16px;display:grid;place-items:center;padding:0;border-radius:999px;cursor:pointer;
  border:2px solid var(--chat-list);background:var(--background);color:transparent;box-shadow:0 0 0 1px var(--border);opacity:0;transition:opacity .15s,background .15s}
[role="button"]:hover .mst-rec,.mst-rec.marcado{opacity:1}
.mst-rec:hover{color:var(--muted-foreground)}
.mst-rec.marcado{background:#f59e0b;color:#fff;box-shadow:none}
.mst-rec-marcada{background-image:linear-gradient(90deg,color-mix(in srgb,#f59e0b 12%,transparent),transparent 70%)}
[data-mst-play3]{box-shadow:inset 3px 0 0 var(--destructive);background-image:linear-gradient(90deg,color-mix(in srgb,var(--destructive) 12%,transparent),transparent 75%)}
.mst-qtd-sinal{margin-left:auto;min-width:18px;height:18px;padding:0 5px;border-radius:999px;display:inline-grid;place-items:center;
  background:var(--destructive);color:#fff;font:700 10px/1 inherit;font-family:inherit;animation:mst-pulso 1.6s ease-in-out infinite}
/* ── cabeçalho da conversa ── */
.mst-vinculo{display:flex;align-items:center;gap:8px;min-width:0;max-width:300px;margin:0 6px;padding:4px 12px 4px 8px;border-radius:999px;
  border:1px solid color-mix(in srgb,var(--tom) 35%,transparent);background:color-mix(in srgb,var(--tom) 10%,transparent);cursor:default;flex-shrink:1}
.mst-vinculo[data-tipo=acordo]{--tom:#10b981}
.mst-vinculo[data-tipo=negociacao]{--tom:#0ea5e9}
.mst-vinculo i{width:8px;height:8px;border-radius:999px;background:var(--tom);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--tom) 25%,transparent)}
.mst-vinculo div{display:flex;flex-direction:column;min-width:0}
.mst-vinculo b{font-size:11px;line-height:14px;font-weight:600;color:var(--foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mst-vinculo small{font-size:10px;line-height:13px;color:var(--muted-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mst-cab-btn[aria-pressed=true],.mst-compor[aria-pressed=true]{color:var(--primary)!important}
.mst-cab-btn svg,.mst-compor svg{display:block}
.mst-menu-item{cursor:pointer}
.mst-menu-item .mst-menu-ico{background:linear-gradient(135deg,var(--primary),var(--primary-2,#06b6d4))!important;color:#fff}
/* ── trava do Play 3 ── */
#mst-play3{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(127,29,29,.55);backdrop-filter:blur(3px);
  font-family:inherit;pointer-events:auto;animation:mst-entrar .18s ease-out}
#mst-play3 .caixa{width:min(420px,92vw);padding:24px;border-radius:calc(var(--radius,.85rem) + 6px);background:var(--popover);color:var(--popover-foreground);
  border:2px solid var(--destructive);box-shadow:0 24px 60px rgba(0,0,0,.4);text-align:center;display:flex;flex-direction:column;gap:8px;align-items:center}
#mst-play3 .cadeado{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;background:var(--destructive);color:#fff;margin-bottom:4px}
#mst-play3 b{font-size:16px;color:var(--destructive);letter-spacing:.02em}
#mst-play3 strong{font-size:14px}
#mst-play3 p{margin:0;font-size:13px;color:var(--muted-foreground)}
#mst-play3 .botoes{display:flex;gap:8px;margin-top:10px;width:100%}
#mst-play3 button{flex:1;height:38px;border-radius:10px;border:1px solid var(--border);background:var(--background);color:var(--foreground);font:600 13px inherit;font-family:inherit;cursor:pointer}
#mst-play3 button.principal{background:var(--destructive);border-color:var(--destructive);color:#fff}
@keyframes mst-pulso{50%{opacity:.6}}
@keyframes mst-entrar{from{opacity:0;transform:scale(.97)}}
`;
  }

  const CSS_PAINEL = `
:host{all:initial}
*{box-sizing:border-box}
:host{--r:var(--radius,.85rem);font-family:inherit;color:var(--foreground);font-size:13px;line-height:1.45;-webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit;color:inherit}
button{cursor:pointer}
[hidden]{display:none!important}
svg{flex:none}

/* ── folha lateral (mesmo desenho da folha «Consultas do atendimento») ── */
.folha{position:fixed;top:0;right:0;height:100dvh;width:min(460px,100vw);z-index:45;display:flex;flex-direction:column;
  background:var(--chat-list);border-left:1px solid var(--border);box-shadow:0 25px 50px -12px rgba(0,0,0,.25);
  transform:translateX(102%);visibility:hidden}
.folha.aberta{transform:none;visibility:visible}
/* O movimento é feito pela Web Animations API (deslizar): roda com «efeitos de animação» do Windows desligados */
.topo{flex:none;display:flex;flex-direction:column;gap:12px;padding:12px 16px;background:var(--chat-sidebar);color:var(--chat-sidebar-foreground);border-bottom:1px solid rgba(255,255,255,.1)}
.topo-linha{display:flex;align-items:center;gap:12px}
.marca{width:40px;height:40px;flex:none;border-radius:12px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,var(--primary),var(--primary-2,#06b6d4));box-shadow:0 6px 16px -6px var(--primary)}
.titulos{min-width:0;flex:1}
.titulos h2{margin:0;font-size:16px;line-height:22px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.titulos p{margin:0;font-size:12px;line-height:16px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.topo-bt{width:36px;height:36px;flex:none;border:0;border-radius:999px;background:transparent;display:grid;place-items:center;color:inherit;transition:background .15s}
.topo-bt:hover{background:rgba(255,255,255,.1)}
.topo-bt.girando svg{animation:girar .9s linear infinite}
/* Todas as abas sempre à vista: grade de 3 colunas (2 linhas com as 6 abas), sem rolagem */
.abas{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:0 -4px;padding:4px;border-radius:16px;background:rgba(255,255,255,.1)}
.aba{min-width:0;display:flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;border:0;border-radius:999px;padding:6px 8px;background:transparent;
  font-size:12px;font-weight:500;color:var(--chat-sidebar-foreground);transition:background .15s,color .15s;overflow:hidden;text-overflow:ellipsis}
.aba:hover{background:rgba(255,255,255,.1)}
.aba[aria-selected=true]{background:#fff;color:#0f172a;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.aba i{width:16px;height:16px;border-radius:999px;display:grid;place-items:center;background:var(--c);color:#fff;font-style:normal}
.aba i svg{width:10px;height:10px}
.aba .qtd{min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--destructive);color:#fff;font-size:10px;font-weight:700;display:inline-grid;place-items:center}
.corpo{flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px;scrollbar-width:thin}
.corpo>*{flex-shrink:0}
.rodape{flex:none;display:flex;gap:8px;padding:12px 16px;background:var(--background);border-top:1px solid var(--border)}
.rodape:empty{display:none}

/* ── peças ── */
.cartao{border:1px solid var(--border);border-radius:16px;background:var(--card);box-shadow:0 1px 2px rgba(15,23,42,.05);overflow:hidden}
.cartao.pad{padding:14px}
.secao{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:2px 2px -6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted-foreground)}
.secao small{text-transform:none;letter-spacing:0;font-weight:500}
.dica{font-size:12px;color:var(--muted-foreground)}
.linha{display:flex;align-items:center;gap:8px}
.entre{justify-content:space-between}
.cresce{flex:1}
.bt{height:36px;padding:0 14px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:10px;border:1px solid var(--border);
  background:var(--background);color:var(--foreground);font-size:13px;font-weight:500;white-space:nowrap;transition:background .15s,opacity .15s,border-color .15s}
.bt:hover:not(:disabled){border-color:color-mix(in srgb,var(--primary) 40%,var(--border));background:color-mix(in srgb,var(--primary) 6%,var(--background))}
.bt:disabled{opacity:.5;cursor:not-allowed}
.bt.primario{background:var(--primary);border-color:var(--primary);color:var(--primary-foreground)}
.bt.primario:hover:not(:disabled){background:var(--primary-hover,var(--primary));opacity:.92}
.bt.confirmar{background:#f59e0b;border-color:#f59e0b;color:#1f2937}
.bt.perigo{color:var(--destructive)}
.bt.cheio-perigo{background:var(--destructive);border-color:var(--destructive);color:#fff}
.bt.pequeno{height:30px;padding:0 10px;font-size:12px;border-radius:8px}
.bt.texto{border:0;background:none;height:auto;padding:0;color:var(--primary);font-size:12px}
.bt.so-icone{width:36px;padding:0}
.ico-bt{width:28px;height:28px;flex:none;border:0;border-radius:8px;background:transparent;color:var(--muted-foreground);display:grid;place-items:center}
.ico-bt:hover{background:var(--accent);color:var(--foreground)}
.ico-bt.ok{color:var(--success)}
.entrada{width:100%;height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:var(--background);color:var(--foreground);outline:none;font-size:13px;transition:border-color .15s,box-shadow .15s}
.entrada:focus{border-color:var(--primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--primary) 18%,transparent)}
textarea.entrada{height:auto;min-height:180px;padding:10px 12px;resize:vertical;line-height:1.5}
select.entrada{padding-right:8px}
.entrada.mexido{border-color:#f59e0b}
.campo{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:500;color:var(--muted-foreground)}
.campo>span{display:flex;align-items:center;justify-content:space-between;gap:6px}
.grade{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.moeda{position:relative}
.moeda::before{content:'R$';position:absolute;left:11px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--muted-foreground);pointer-events:none}
.moeda .entrada{padding-left:32px;text-align:right;font-variant-numeric:tabular-nums}
.etq{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:var(--muted);color:var(--muted-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.etq.ok{background:color-mix(in srgb,var(--success) 14%,transparent);color:var(--success)}
.etq.risco{background:color-mix(in srgb,var(--destructive) 13%,transparent);color:var(--destructive)}
.etq.azul{background:color-mix(in srgb,var(--primary) 13%,transparent);color:var(--primary)}
.etq.ambar{background:color-mix(in srgb,#f59e0b 16%,transparent);color:#b45309}
.etiquetas{display:flex;flex-wrap:wrap;gap:6px}
.aviso{padding:10px 12px;border-radius:12px;font-size:12px;background:color-mix(in srgb,#f59e0b 13%,var(--card));border:1px solid color-mix(in srgb,#f59e0b 35%,transparent)}
.aviso.erro{background:color-mix(in srgb,var(--destructive) 10%,var(--card));border-color:color-mix(in srgb,var(--destructive) 35%,transparent)}
.aviso.info{background:color-mix(in srgb,var(--primary) 9%,var(--card));border-color:color-mix(in srgb,var(--primary) 30%,transparent)}
.vazio-estado{padding:28px 18px;text-align:center;color:var(--muted-foreground);display:flex;flex-direction:column;align-items:center;gap:6px}
.vazio-estado b{color:var(--foreground);font-size:14px}
.vazio-estado .bolha{width:48px;height:48px;border-radius:16px;display:grid;place-items:center;background:var(--muted);color:var(--muted-foreground);margin-bottom:4px}
.esqueleto{height:12px;border-radius:6px;background:linear-gradient(90deg,var(--muted),color-mix(in srgb,var(--muted) 40%,transparent),var(--muted));background-size:200% 100%;animation:brilho 1.2s linear infinite}

/* ── cliente ── */
.cli-topo{display:flex;align-items:center;gap:12px;padding:14px 14px 12px}
.avatar{width:42px;height:42px;flex:none;border-radius:999px;display:grid;place-items:center;font-weight:700;font-size:14px;color:var(--primary);background:color-mix(in srgb,var(--primary) 13%,transparent)}
.cli-nome{min-width:0;flex:1}
.cli-nome b{display:block;font-size:14px;line-height:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cli-nome .etiquetas{margin-top:5px}
.dados{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--border)}
.dado{min-width:0;padding:9px 14px;border-bottom:1px solid var(--border)}
.dado:nth-child(odd){border-right:1px solid var(--border)}
.dado span{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--muted-foreground)}
.dado span svg{color:var(--primary)}
.dado div{display:flex;align-items:center;justify-content:space-between;gap:4px;margin-top:2px;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--foreground)}
.dado div em{font-style:normal;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dado .ico-bt{width:24px;height:24px}
.dado.vermelho div{color:var(--destructive)}
.situacao{display:flex;flex-direction:column}
.sit{display:grid;grid-template-columns:88px 1fr;gap:10px;padding:9px 14px;border-bottom:1px solid var(--border);font-size:12px}
.sit:last-child{border-bottom:0}
.sit>span{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted-foreground);padding-top:2px}
.sit small{color:var(--muted-foreground)}
.ok{color:var(--success)} .risco{color:var(--destructive)} .azul{color:var(--primary)}
.contratos-caixa{position:relative;padding:0 14px 12px}
.contratos{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;scroll-behavior:smooth}
.contratos::-webkit-scrollbar{display:none}
.contrato{flex:none;display:flex;flex-direction:column;align-items:flex-start;padding:7px 11px;border-radius:12px;border:1px solid var(--border);background:var(--background);text-align:left}
.contrato b{font-size:12px}
.contrato small{font-size:11px;color:var(--muted-foreground)}
.contrato[aria-pressed=true]{border-color:var(--primary);background:color-mix(in srgb,var(--primary) 9%,var(--background));box-shadow:0 0 0 1px var(--primary)}

/* ── proposta ── */
.valores{padding:6px 0}
.valores-topo{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:8px 14px 10px;border-bottom:1px dashed var(--border)}
.valores-topo span{font-size:12px;color:var(--muted-foreground)}
.valores-topo b{font-size:18px;font-variant-numeric:tabular-nums}
.opc{display:grid;grid-template-columns:1fr auto;gap:0 10px;padding:9px 14px}
.opc+.opc{border-top:1px solid var(--border)}
.opc span{font-weight:600}
.opc b{font-size:14px;font-variant-numeric:tabular-nums;text-align:right}
.opc small{font-size:11px;color:var(--muted-foreground)}
.opc small:last-child{text-align:right}
.opc.principal b{color:var(--success)}
.ajustar{display:flex;align-items:center;justify-content:space-between;width:100%;padding:10px 14px;border:0;border-top:1px solid var(--border);background:transparent;font-size:12px;font-weight:600;color:var(--muted-foreground)}
.ajustar svg{transition:transform .2s}
.ajustar[aria-expanded=true] svg{transform:rotate(180deg)}
.ajustes-valores{display:flex;flex-direction:column;gap:12px;padding:0 14px 14px}
.descontos{display:flex;flex-wrap:wrap;gap:6px}
.desc{display:flex;align-items:center;gap:6px;padding:4px 4px 4px 10px;border-radius:10px;border:1px solid var(--border);background:var(--background);font-size:12px}
.desc input{width:46px;height:26px;border:1px solid var(--border);border-radius:7px;background:var(--card);text-align:center;outline:none}
.segmento{display:inline-flex;padding:3px;gap:2px;border-radius:10px;background:var(--muted)}
.segmento button{border:0;background:transparent;padding:4px 12px;border-radius:8px;font-size:12px;font-weight:600;color:var(--muted-foreground)}
.segmento button[aria-pressed=true]{background:var(--background);color:var(--foreground);box-shadow:0 1px 2px rgba(15,23,42,.12)}
.sub-rotulo{font-size:11px;font-weight:600;color:var(--muted-foreground);margin-bottom:6px}
.regra{display:flex;gap:10px;align-items:flex-start;padding:10px 14px;border-top:1px solid var(--border);font-size:12px;background:color-mix(in srgb,var(--primary) 5%,transparent)}
.regra svg{color:var(--primary);margin-top:1px}

/* ── prévia da mensagem (balão do próprio chat) ── */
.conversa{padding:14px;border-radius:16px;background:color-mix(in srgb,var(--muted) 60%,var(--chat-list));border:1px solid var(--border)}
.balao{position:relative;margin-left:auto;max-width:92%;padding:10px 12px 18px;border-radius:16px 16px 4px 16px;background:color-mix(in srgb,#10b981 16%,var(--card));
  white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.55}
.balao[data-hora]::after{content:attr(data-hora);position:absolute;right:10px;bottom:4px;font-size:9px;color:var(--muted-foreground)}
.balao.vazio{color:var(--muted-foreground);font-style:italic;background:var(--card)}
.balao mark{background:color-mix(in srgb,#f59e0b 30%,transparent);color:inherit;border-radius:4px;padding:0 2px}

/* ── listas ── */
.item{padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.item+.item{border-top:1px solid var(--border)}
.item.em-uso{background:color-mix(in srgb,var(--primary) 5%,transparent)}
.item-topo{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.item-topo b{font-size:13px}
.item-trecho{font-size:12px;color:var(--muted-foreground);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}
.item-acoes{display:flex;gap:6px;flex-wrap:wrap}
.selo{font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;background:var(--muted);color:var(--muted-foreground)}
.selo.azul{background:color-mix(in srgb,var(--primary) 13%,transparent);color:var(--primary)}
.lista-linha{display:flex;align-items:center;gap:10px;padding:9px 14px}
.lista-linha+.lista-linha{border-top:1px solid var(--border)}
.lista-linha .nome{flex:1;min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lista-linha .sub{font-size:11px;color:var(--muted-foreground);white-space:nowrap}
.lista-vazia{padding:16px;text-align:center;color:var(--muted-foreground);font-size:12px}
.status{padding:10px 14px;border-radius:12px;background:var(--card);border:1px solid var(--border);font-size:12px;font-weight:600}
.opcao{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px}
.opcao+.opcao{border-top:1px solid var(--border)}
.opcao b{display:block;font-size:13px}
.opcao small{display:block;font-size:12px;color:var(--muted-foreground);margin-top:1px}
.chave{position:relative;flex:none;width:38px;height:22px}
.chave input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer;z-index:1}
.chave span{position:absolute;inset:0;border-radius:999px;background:color-mix(in srgb,var(--muted-foreground) 35%,transparent);transition:background .18s}
.chave span::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:999px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .18s}
.chave input:checked+span{background:var(--primary)}
.chave input:checked+span::after{transform:translateX(16px)}
.chave input:focus-visible+span{box-shadow:0 0 0 3px color-mix(in srgb,var(--primary) 30%,transparent)}
.fichas{display:flex;flex-wrap:wrap;gap:6px}
.ficha{border:1px solid var(--border);background:var(--background);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:600;color:var(--foreground)}
.ficha:hover{border-color:var(--primary)}
.ficha[aria-pressed=true]{background:var(--primary);border-color:var(--primary);color:var(--primary-foreground)}
.ficha.cond{border-style:dashed}
.setor-cfg{padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.setor-cfg+.setor-cfg{border-top:1px solid var(--border)}
.setor-cfg.desligado b{opacity:.5}
.dias{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted-foreground)}
.dias .entrada{width:64px;height:30px;text-align:center}
.versao{text-align:center;font-size:11px;color:var(--muted-foreground)}
/* convite para o tutorial (primeira vez no painel) */
.convite{display:flex;gap:12px;padding:14px;border-color:color-mix(in srgb,var(--primary) 35%,var(--border));background:linear-gradient(135deg,color-mix(in srgb,var(--primary) 9%,var(--card)),var(--card));animation:subir .35s ease-out}
.convite b{display:block;font-size:13px}
.convite small{display:block;font-size:12px;color:var(--muted-foreground)}
.convite-ic{width:38px;height:38px;flex:none;border-radius:12px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,var(--primary),var(--primary-2,#06b6d4))}

/* ── sinalizados ── */
.sinal{display:flex;align-items:center;gap:10px;padding:10px 14px}
.sinal+.sinal{border-top:1px solid var(--border)}
.cor{width:10px;height:10px;border-radius:999px;flex:none;background:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 25%,transparent)}
.sinal .meio{flex:1;min-width:0}
.sinal .meio b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sinal .meio small{display:block;font-size:11px;color:var(--muted-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sinal.novo{background:color-mix(in srgb,var(--c) 9%,transparent)}

/* ── WallPaper ── */
.previa-papel{position:relative;height:150px;border-radius:16px;overflow:hidden;border:1px solid var(--border);cursor:crosshair}
.previa-papel .fundo{position:absolute;inset:0}
.previa-papel .bolha{position:absolute;max-width:62%;padding:7px 10px;border-radius:14px;font-size:12px;background:var(--card);box-shadow:0 1px 2px rgba(0,0,0,.1)}
.previa-papel .cli{left:12px;top:18px;border-bottom-left-radius:4px}
.previa-papel .eu{right:12px;bottom:18px;border-bottom-right-radius:4px;background:color-mix(in srgb,#10b981 18%,var(--card))}
.previa-papel .mira{position:absolute;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:999px;border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.4)}
.temas{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.tema{height:58px;border-radius:12px;border:2px solid transparent;display:flex;align-items:flex-end;padding:5px;overflow:hidden}
.tema span{font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;background:rgba(0,0,0,.5);color:#fff}
.tema[aria-pressed=true]{border-color:var(--primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--primary) 30%,transparent)}
.soltar{padding:18px;border-radius:14px;border:1.5px dashed var(--border);text-align:center;display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted-foreground);cursor:pointer;background:var(--card)}
.soltar b{color:var(--foreground);font-size:13px}
.soltar.sobre{border-color:var(--primary);background:color-mix(in srgb,var(--primary) 7%,var(--card))}
input[type=range]{width:100%;accent-color:var(--primary)}

/* ── confirmação, avisos e cards de sinalizados ── */
.confirma{position:absolute;inset:0;display:none;align-items:flex-end;background:rgba(2,6,23,.35);padding:16px}
.confirma.ver{display:flex}
.confirma>div{width:100%;padding:16px;border-radius:16px;background:var(--popover);color:var(--popover-foreground);border:1px solid var(--border);box-shadow:0 20px 40px rgba(0,0,0,.25);animation:subir .2s ease-out}
.confirma p{margin:0 0 12px;font-size:13px}
.confirma .linha{justify-content:flex-end}
.aviso-flutuante{position:fixed;left:50%;top:14px;z-index:2147483646;transform:translate(-50%,-12px);opacity:0;pointer-events:none;max-width:min(520px,92vw);
  padding:10px 14px;border-radius:12px;background:var(--popover);color:var(--popover-foreground);border:1px solid var(--border);border-left:4px solid var(--success);
  box-shadow:0 12px 32px rgba(15,23,42,.18);font-size:13px;font-weight:500;transition:opacity .2s,transform .2s}
.aviso-flutuante.ver{opacity:1;transform:translate(-50%,0)}
.aviso-flutuante.alerta{border-left-color:#f59e0b}
.aviso-flutuante.erro{border-left-color:var(--destructive)}
.cards{position:fixed;left:12px;bottom:12px;z-index:2147483645;width:min(320px,calc(100vw - 24px));display:flex;flex-direction:column-reverse;gap:8px;pointer-events:none}
.card-sinal{pointer-events:auto;display:flex;gap:10px;padding:12px;border-radius:14px;background:var(--popover);color:var(--popover-foreground);border:1px solid var(--border);
  box-shadow:0 16px 36px rgba(2,6,23,.28);border-left:4px solid var(--c);animation:subir .25s ease-out;cursor:pointer}
.card-sinal:hover{border-color:var(--c)}
.card-sinal .meio{flex:1;min-width:0}
.card-sinal .meio small{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--c)}
.card-sinal .meio b{display:block;font-size:13px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card-sinal .meio p{margin:2px 0 0;font-size:12px;color:var(--muted-foreground);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-sinal .lado{display:flex;flex-direction:column;align-items:flex-end;justify-content:space-between;gap:6px}
.card-sinal .lado span{font-size:10px;color:var(--muted-foreground)}
.mais-cards{pointer-events:auto;align-self:flex-start;padding:4px 10px;border-radius:999px;border:1px solid var(--border);background:var(--popover);font-size:11px;font-weight:600;color:var(--muted-foreground)}
@keyframes girar{to{transform:rotate(360deg)}}
@keyframes brilho{to{background-position:-200% 0}}
@keyframes subir{from{opacity:0;transform:translateY(8px)}}
`;

  // ═══════════════════════════════════════════════════════════════════════
  // 7. PAINEL
  // ═══════════════════════════════════════════════════════════════════════

  // Ícones no traço do lucide (o mesmo conjunto que o CRM usa)
  const ICONES = {
    calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8"/><path d="M16 14v4"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
    mestre: '<path d="M12 2 3 7l9 5 9-5-9-5z"/><path d="m3 17 9 5 9-5"/><path d="m3 12 9 5 9-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    atualizar: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    copiar: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    enviar: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    mao: '<path d="M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
    retomar: '<path d="M3 12a9 9 0 1 0 9-9"/><polyline points="3 4 3 12 11 12"/>',
    mensagens: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
    imagem: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    ajustes: '<path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    lixo: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    duplicar: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16V4h12"/>',
    estrela: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    baixar: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    subir: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
    voltar: '<path d="m15 18-6-6 6-6"/>',
    abaixo: '<path d="m6 9 6 6 6-6"/>',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    telefone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    cpf: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M14 10h4M14 14h4"/>',
    dinheiro: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    alerta: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
    documento: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h6M16 13H8M16 17H8"/>',
    escudo: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    sino: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    abrir: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    cadeado: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    brilho: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4M22 5h-4M4 17v2M5 18H3"/>',
    usuario: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'
  };
  const icone = (nome, tam = 16) => `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome] || ''}</svg>`;

  /** WhatsApp (*negrito*, _itálico_, ~riscado~) → HTML da prévia. */
  function formatarWhats(texto) {
    return esc(texto)
      .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s.,!?)])/g, '$1<i>$2</i>')
      .replace(/~([^~\n]+)~/g, '<s>$1</s>')
      .replace(/\{\{[#^/]?[A-Z0-9_]+\}\}/g, m => `<mark>${m}</mark>`);
  }
  const chave = (attr, marcado, rotulo = '') => `<span class="chave"><input type="checkbox" ${attr} ${marcado ? 'checked' : ''} aria-label="${esc(rotulo)}"><span></span></span>`;

  const ABAS = [
    { id: 'atendimento', nome: 'Atendimento', titulo: 'Atendimento', icone: 'mao', cor: '#059669' },
    { id: 'recuperacao', nome: 'Retomar', titulo: 'Retomar conversas', icone: 'retomar', cor: '#d97706', modulo: 'recuperacao' },
    { id: 'sinalizados', nome: 'Sinalizados', titulo: 'Sinalizados', icone: 'tag', cor: '#65a30d', modulo: 'sinalizados' },
    { id: 'mensagens', nome: 'Mensagens', titulo: 'Mensagens', icone: 'mensagens', cor: '#7c3aed' },
    { id: 'aparencia', nome: 'WallPaper', titulo: 'WallPaper', icone: 'imagem', cor: '#db2777', modulo: 'papel' }
  ];
  const PAGINAS = { ajustes: 'Ajustes' };

  const ui = {
    aberto: false,
    aba: 'atendimento',
    carregando: false, erro: null, dados: null, contratoIdx: 0, setor: null, setorManual: false,
    edicoes: {}, modeloId: null, confirmandoEnvio: false, ajustarAberto: false, enviando: false,
    filtro: null, editando: null
  };
  function painelAberto(aba) {
    return ui.aberto && (!aba || ui.aba === aba);
  }

  let host, raiz, folha, corpo, rodape, avisoEl, caixaConfirma, cardsEl;

  function aviso(texto, tipo = 'ok') {
    if (!avisoEl) { console.log('[Mestre]', texto); return; }
    avisoEl.textContent = texto;
    avisoEl.className = `aviso-flutuante ver ${tipo === 'ok' ? '' : tipo}`;
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => avisoEl.classList.remove('ver'), tipo === 'erro' ? 5000 : 3000);
  }

  /** Confirmação dentro do painel, no lugar do confirm() do navegador. */
  function confirmar(texto, rotulo = 'Confirmar') {
    return new Promise(resolve => {
      caixaConfirma.innerHTML = `<div role="alertdialog" aria-label="Confirmação"><p>${esc(texto)}</p><div class="linha"><button type="button" class="bt pequeno" data-r="0">Cancelar</button><button type="button" class="bt pequeno primario" data-r="1">${esc(rotulo)}</button></div></div>`;
      caixaConfirma.classList.add('ver');
      const fim = v => { caixaConfirma.classList.remove('ver'); caixaConfirma.replaceChildren(); resolve(v); };
      caixaConfirma.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => fim(b.dataset.r === '1')));
      caixaConfirma.querySelector('[data-r="1"]').focus();
    });
  }

  function montarPainel() {
    host = document.createElement('div');
    host.id = 'chatplay-mestre';
    host.className = NOSSO;
    raiz = host.attachShadow({ mode: 'open' });
    raiz.innerHTML = `
      <style>${CSS_PAINEL}</style>
      <section class="folha" role="complementary" aria-label="ChatPlay Mestre">
        <header class="topo">
          <div class="topo-linha">
            <div class="marca">${icone('mestre', 20)}</div>
            <div class="titulos"><h2 id="titulo">ChatPlay Mestre</h2><p id="subtitulo"></p></div>
            <button class="topo-bt" id="bt-atualizar" type="button" title="Buscar de novo no ChatPlay">${icone('atualizar', 18)}</button>
            <button class="topo-bt" id="bt-ajustes" type="button" title="Ajustes">${icone('ajustes', 18)}</button>
            <button class="topo-bt" id="bt-fechar" type="button" title="Fechar (Esc)">${icone('x', 18)}</button>
          </div>
          <nav class="abas" role="tablist" aria-label="Ferramentas do Mestre"></nav>
        </header>
        <main class="corpo"></main>
        <footer class="rodape"></footer>
        <div class="confirma"></div>
      </section>
      <div class="cards" aria-live="polite"></div>
      <div class="aviso-flutuante" role="status"></div>`;
    document.body.appendChild(host);
    folha = raiz.querySelector('.folha');
    corpo = raiz.querySelector('.corpo');
    rodape = raiz.querySelector('.rodape');
    avisoEl = raiz.querySelector('.aviso-flutuante');
    caixaConfirma = raiz.querySelector('.confirma');
    cardsEl = raiz.querySelector('.cards');

    // O ChatPlay tem atalhos próprios: o que se digita aqui não sai daqui
    for (const t of ['keydown', 'keyup', 'keypress']) {
      folha.addEventListener(t, e => {
        if (t === 'keydown' && e.key === 'Escape') alternar(false);
        e.stopPropagation();
      });
    }
    raiz.getElementById('bt-fechar').addEventListener('click', () => alternar(false));
    raiz.getElementById('bt-ajustes').addEventListener('click', () => {
      if (PAGINAS[ui.aba]) irPara(ui.abaAnterior || abasVisiveis()[0]?.id || 'mensagens');
      else { ui.abaAnterior = ui.aba; irPara('ajustes'); }
    });
    raiz.getElementById('bt-atualizar').addEventListener('click', () => {
      if (ui.aba === 'atendimento') buscar(true);
      else if (ui.aba === 'recuperacao') recuperacao.atualizarMapa();
      desenhar();
    });
    PAGINA.addEventListener('keydown', e => {
      if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); alternar(); }
    }, true);
    desenharAbas();
    desenharCards();
  }

  // ── Encaixe na tela do ChatPlay ─────────────────────────────────────────
  // Os botões copiam a classe dos vizinhos: ficam iguais aos do próprio ChatPlay.

  function botoesNaTela() {
    // Cabeçalho da conversa: antes de «Pesquisar na conversa»
    const pesquisar = primeiroVisivel(SEL.pesquisarConversa);
    let b = pesquisar?.parentElement?.querySelector(':scope > .mst-cab-btn');
    if (pesquisar && !b) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = `${pesquisar.className} ${NOSSO} mst-cab-btn`;
      b.title = 'ChatPlay Mestre (Alt+C)';
      b.setAttribute('aria-label', 'ChatPlay Mestre');
      b.innerHTML = icone('mestre', 18);
      b.addEventListener('click', () => alternar());
      pesquisar.before(b);
    }
    // Campo de mensagem: depois de «Mensagens rápidas»
    const rapidas = primeiroVisivel(SEL.rapidas);
    let c = rapidas?.parentElement?.querySelector(':scope > .mst-compor');
    if (ligado('abordagem')) {
      if (rapidas && !c) {
        c = document.createElement('button');
        c.type = 'button';
        c.className = `${rapidas.className} ${NOSSO} mst-compor`;
        c.title = 'Gerar apresentação (ou pedido de CPF, sem vínculo)';
        c.setAttribute('aria-label', 'Gerar apresentação');
        c.innerHTML = icone('brilho', 18);
        c.addEventListener('click', () => { if (!ponte.atendimentoId) return aviso('Abra uma conversa primeiro.', 'alerta'); abordagem.executar(ponte.atendimentoId, true); });
        rapidas.after(c);
      }
    } else c?.remove();
    menuDasConsultas();
    pintarBotoes();
  }
  function pintarBotoes() {
    for (const el of document.querySelectorAll('.mst-cab-btn')) el.setAttribute('aria-pressed', String(ui.aberto));
  }

  /** «ChatPlay Mestre» no fim do menu «Consultas do atendimento». */
  function menuDasConsultas() {
    for (const menu of document.querySelectorAll(SEL.menu)) {
      if (!/Consultas do atendimento/.test(menu.querySelector('[data-slot="dropdown-menu-label"]')?.textContent || '')) continue;
      if (menu.querySelector('.mst-menu-item')) continue;
      const modelo = [...menu.querySelectorAll('[role="menuitem"]')].pop();
      if (!modelo) continue;
      const item = modelo.cloneNode(true);
      item.classList.add(NOSSO, 'mst-menu-item');
      item.removeAttribute('data-highlighted');
      item.removeAttribute('id');
      const spans = item.querySelectorAll(':scope > span');
      if (spans[0]) { spans[0].classList.add('mst-menu-ico'); spans[0].innerHTML = icone('mestre', 15); }
      const textos = spans[1]?.querySelectorAll('span');
      if (textos?.[0]) textos[0].textContent = 'ChatPlay Mestre';
      if (textos?.[1]) textos[1].textContent = 'Apresentação, sinalizados, retomada e WallPaper';
      item.addEventListener('mouseenter', () => item.setAttribute('data-highlighted', ''));
      item.addEventListener('mouseleave', () => item.removeAttribute('data-highlighted'));
      item.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        // Fecha o menu pelo próprio botão (Esc também fecharia a conversa)
        const gatilho = document.getElementById(menu.getAttribute('aria-labelledby') || '');
        if (gatilho) gatilho.dispatchEvent(new PAGINA.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }));
        if (!ui.aberto) alternar(true);
        irPara('atendimento');
      });
      modelo.parentElement.appendChild(item);
    }
  }

  function abasVisiveis() {
    return ABAS.filter(a => !a.modulo || ligado(a.modulo));
  }
  function desenharAbas() {
    const nav = raiz.querySelector('.abas');
    const abas = abasVisiveis();
    if (!PAGINAS[ui.aba] && !abas.some(a => a.id === ui.aba)) ui.aba = abas[0]?.id || 'mensagens';
    nav.hidden = !!PAGINAS[ui.aba];
    const qtd = { recuperacao: recuperacao.selecionados.size, sinalizados: ligado('sinalizados') ? sinalizados.pendentes.length : 0 };
    nav.innerHTML = abas.map(a => `<button type="button" class="aba" role="tab" data-aba="${a.id}" aria-selected="${a.id === ui.aba}" title="${esc(a.titulo)}"><i style="--c:${a.cor}">${icone(a.icone, 10)}</i>${esc(a.nome)}${qtd[a.id] ? `<span class="qtd">${qtd[a.id]}</span>` : ''}</button>`).join('');
    nav.querySelectorAll('[data-aba]').forEach(b => b.addEventListener('click', () => irPara(b.dataset.aba)));
    nav.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    raiz.getElementById('bt-ajustes').innerHTML = icone(PAGINAS[ui.aba] ? 'voltar' : 'ajustes', 18);
    raiz.getElementById('bt-ajustes').title = PAGINAS[ui.aba] ? 'Voltar' : 'Ajustes';
  }

  /** Cards de sinalizados no canto (aparecem mesmo com o painel fechado). */
  function desenharCards() {
    if (!cardsEl) return;
    const lista = ligado('sinalizados') ? sinalizados.pendentes : [];
    const chaveCards = lista.map(p => p.idMsg).join('|');
    if (cardsEl.dataset.chave === chaveCards) return;
    cardsEl.dataset.chave = chaveCards;
    const vistos = lista.slice(0, 3);
    cardsEl.innerHTML = vistos.map(p => `
      <div class="card-sinal" style="--c:${esc(p.cor || '#44c2e1')}" data-tel="${esc(p.tel)}" role="button" tabindex="0" title="Abrir a conversa">
        <div class="meio"><small>${icone('tag', 11)}${p.tipo === 'voltou' ? 'Sinalizado voltou' : 'Sinalizado'} · ${esc(p.etiqueta || '')}</small><b>${esc(p.nome)}</b><p>${esc(p.texto)}</p></div>
        <div class="lado"><button type="button" class="ico-bt" data-dispensar="${esc(p.tel)}" title="Dispensar">${icone('x', 14)}</button><span>${esc(p.hora || '')}</span></div>
      </div>`).join('') + (lista.length > 3 ? `<button type="button" class="mais-cards" data-ver-todos>+${lista.length - 3} sinalizado(s) · ver todos</button>` : '');
    cardsEl.querySelectorAll('.card-sinal').forEach(c => c.addEventListener('click', () => sinalizados.abrir(c.dataset.tel)));
    cardsEl.querySelectorAll('[data-dispensar]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); sinalizados.dispensar(b.dataset.dispensar); }));
    cardsEl.querySelector('[data-ver-todos]')?.addEventListener('click', () => { if (!ui.aberto) alternar(true); irPara('sinalizados'); });
  }

  const precisaDoCliente = () => (ui.aba === 'atendimento') && ponte.atendimentoId && ui.dados?.atendimentoId !== ponte.atendimentoId;

  // ── Abrir e fechar: o painel desliza e a conversa acompanha ─────────────
  // O painel (460 px) é mais largo que «Dados do cliente» (340 px). Ao abrir, a
  // conversa encolhe só o pedaço que ficaria coberto, no mesmo movimento do painel;
  // ao fechar, volta. A animação é da Web Animations API: não depende do CSS da
  // página e roda mesmo com os «efeitos de animação» do Windows desligados.
  const MOVIMENTO = { duration: 440, easing: 'cubic-bezier(.32,.72,0,1)' };
  const espaco = {
    col: null,
    anims: [],
    animando() { return this.anims.some(a => a.playState === 'running'); },
    /** Coluna da conversa: o ancestral do cabeçalho que tem «Dados do cliente» à direita. */
    coluna() {
      let a = cabecalho();
      for (let i = 0; a && i < 8; i++, a = a.parentElement) {
        const irmao = a.nextElementSibling;
        if (irmao && visivel(irmao) && irmao.getBoundingClientRect().left >= a.getBoundingClientRect().right - 2) return a;
      }
      return null;
    },
    /** Quanto a conversa precisa encolher para o painel não cobrir nada dela. */
    folga(col) {
      if (innerWidth < 1000) return 0; // tela estreita: o painel fica por cima, como antes
      const r = col.getBoundingClientRect();
      const atual = parseFloat(col.style.marginRight) || 0;
      const largura = Math.min(460, innerWidth);
      const f = Math.max(0, Math.round(r.right + atual - (innerWidth - largura)));
      return r.width + atual - f < 380 ? 0 : f; // nunca deixa a conversa espremida demais
    },
    soltar(col) { if (col) col.style.marginRight = ''; },
    /** Sem animação: segue a conversa quando ela é trocada ou a janela muda de tamanho. */
    manter() {
      if (this.animando()) return;
      const col = ui.aberto ? this.coluna() : null;
      if (this.col && this.col !== col) { this.soltar(this.col); this.col = null; }
      if (!col) return;
      const f = this.folga(col);
      const px = f ? f + 'px' : '';
      if (col.style.marginRight !== px) col.style.marginRight = px;
      this.col = col;
    }
  };
  function deslizar(abrir) {
    // Começa de onde está (se clicar no meio do movimento, ele vira sem pulo)
    const deX = getComputedStyle(folha).transform;
    const col = espaco.coluna();
    const deM = col ? parseFloat(getComputedStyle(col).marginRight) || 0 : 0;
    espaco.anims.forEach(a => a.cancel());
    espaco.anims = [];
    if (espaco.col && espaco.col !== col) espaco.soltar(espaco.col);
    folha.classList.toggle('aberta', abrir);
    espaco.anims.push(folha.animate([
      { transform: deX === 'none' ? 'translateX(0)' : deX, visibility: 'visible' },
      { transform: abrir ? 'translateX(0)' : 'translateX(102%)', visibility: 'visible' }
    ], MOVIMENTO));
    espaco.col = col;
    if (!col) return;
    col.style.marginRight = deM ? deM + 'px' : '';
    const paraM = abrir ? espaco.folga(col) : 0;
    col.style.marginRight = paraM ? paraM + 'px' : '';
    if (Math.abs(paraM - deM) < 1) return;
    espaco.anims.push(col.animate([{ marginRight: deM + 'px' }, { marginRight: paraM + 'px' }], MOVIMENTO));
    // A conversa estava no fim? Continua no fim enquanto as mensagens se reacomodam
    const area = areaDasMensagens();
    if (area && area.scrollHeight - area.scrollTop - area.clientHeight < 48) {
      const segurar = () => { area.scrollTop = area.scrollHeight; if (espaco.animando()) requestAnimationFrame(segurar); };
      requestAnimationFrame(segurar);
    }
  }

  let pedidoDeslize = 0;
  function alternar(abrir = !ui.aberto) {
    ui.aberto = abrir;
    pintarBotoes();
    const pedido = ++pedidoDeslize;
    if (!abrir) { deslizar(false); return; }
    // Monta o conteúdo ANTES de mexer: o trabalho pesado fica fora do movimento,
    // que começa dois quadros depois, já com o painel pronto
    if (precisaDoCliente()) buscar();
    if (ui.aba === 'recuperacao') recuperacao.atualizarMapa();
    desenhar();
    requestAnimationFrame(() => requestAnimationFrame(() => { if (pedido === pedidoDeslize && ui.aberto) deslizar(true); }));
  }
  function irPara(aba) {
    ui.aba = aba;
    ui.confirmandoEnvio = false;
    if (aba !== 'mensagens') ui.editando = null;
    if (precisaDoCliente()) buscar();
    if (aba === 'recuperacao') recuperacao.atualizarMapa();
    corpo.scrollTop = 0;
    desenharAbas();
    pintarBotoes();
    desenhar();
  }

  let desenhoAdiado = false;
  function desenhar() {
    if (!raiz || !ui.aberto) return;
    // Durante o deslize nada é redesenhado (pesa no PC fraco): fica para o fim do movimento
    if (espaco.animando()) {
      if (!desenhoAdiado) {
        desenhoAdiado = true;
        Promise.all(espaco.anims.map(a => a.finished.catch(() => {}))).then(() => { desenhoAdiado = false; desenhar(); });
      }
      return;
    }
    raiz.getElementById('titulo').textContent = PAGINAS[ui.aba] || ABAS.find(a => a.id === ui.aba)?.titulo || 'ChatPlay Mestre';
    const cli = ui.dados && ui.dados.atendimentoId === ponte.atendimentoId ? ui.dados.cliente : null;
    raiz.getElementById('subtitulo').textContent = cli ? `${cli.nome || cli.nomeContato}${cli.telefone ? ' · ' + formatarTel(cli.telefone) : ''}` : `ChatPlay Mestre Cofen ${VERSAO}`;
    raiz.getElementById('bt-atualizar').classList.toggle('girando', ui.carregando);
    rodape.innerHTML = '';
    const desenhos = { atendimento: abaAtendimento, recuperacao: abaRecuperacao, sinalizados: abaSinalizados, mensagens: abaMensagens, aparencia: abaAparencia, ajustes: abaAjustes };
    (desenhos[ui.aba] || abaAjustes)();
    if (!PAGINAS[ui.aba] && !ui.editando) boasVindas.cardNoPainel(corpo);
  }

  // ── Dados do cliente aberto ─────────────────────────────────────────────

  async function buscar(forcar = false) {
    const id = ponte.atendimentoId;
    if (!id) {
      ui.dados = null;
      desenhar();
      if (forcar) aviso('Abra uma conversa no ChatPlay primeiro.', 'alerta');
      return;
    }
    ui.carregando = true;
    ui.erro = null;
    desenhar();
    try {
      const dados = await carregarCliente(id, forcar);
      if (ponte.atendimentoId !== id) return;
      const mudou = ui.dados?.atendimentoId !== id;
      ui.dados = dados;
      if (mudou) {
        ui.edicoes = {};
        ui.setorManual = false;
        ui.modeloId = null;
        ui.contratoIdx = dados.contratos.reduce((m, c, i, l) => (c.totalAberto > l[m].totalAberto ? i : m), 0);
      }
      if (!ui.setorManual) ui.setor = detectarSetor();
    } catch (e) {
      ui.erro = e.message || String(e);
    } finally {
      ui.carregando = false;
      desenhar();
    }
  }

  const contratoAtual = () => ui.dados?.contratos?.[ui.contratoIdx] || null;
  function entradaDoContrato(ct) {
    if (!ct) return {};
    return {
      totalAberto: ct.totalAberto, valorParcela: ct.valorParcela, qtdAtraso: ct.qtdAtraso, valorAtraso: ct.valorAtraso,
      totalAtualizado: ct.totalAtualizado || ct.saldoAtualizado || ct.totalAberto, qtdRestantes: ct.qtdAbertas
    };
  }
  const entradaAtual = () => ({ ...entradaDoContrato(contratoAtual()), ...ui.edicoes });
  const diasAtrasoAtual = () => ui.dados?.cliente?.diasAtraso ?? contratoAtual()?.maiorAtraso ?? null;
  const setoresAtivos = () => ORDEM_SETORES.filter(id => cfg.calc.setores[id].ativo);

  /** Setor: qualidade recente → «Setor Vinculado» → qualidade antiga → faixa de dias → último usado. */
  function detectarSetor() {
    const d = ui.dados;
    const ct = contratoAtual();
    const dias = diasAtrasoAtual();
    if (d?.setorFonte === 'qualidade' && d.setorCliente) return d.setorCliente;
    const pelo = setorPeloVinculo(d?.cliente?.setorVinculado, (ct?.qtdAtraso || 0) > 0 || dias > 0);
    if (pelo) return pelo;
    if (d?.qualidade?.setor) return d.qualidade.setor;
    const ativos = setoresAtivos();
    if (ativos.length === 1) return ativos[0];
    if (dias != null) {
      for (const id of ativos) {
        const s = cfg.calc.setores[id];
        if ((s.diasMin || s.diasMax) && dias >= s.diasMin && dias <= s.diasMax) return id;
      }
    }
    if (!dias && ativos.includes('PlayEmDia')) return 'PlayEmDia';
    return cfg.calc.ultimoSetor || (dias ? 'Play1' : 'PlayEmDia');
  }

  function montarProposta(setor = ui.setor, modelo = null, entrada = entradaAtual()) {
    const r = calcular(setor, entrada, cfg.calc.setores[setor]?.descontos, { pixAuto: cfg.calc.pixAuto, parcelasCartao: cfg.calc.parcelasCartao });
    const cli = ui.dados?.cliente || {};
    const vars = {
      SAUDACAO: saudacaoDaHora(), NOME: cli.nome || '', PRIMEIRO_NOME: primeiroNome(cli.nome), OPERADOR: cfg.operador || '',
      CONTRATO: contratoAtual()?.nrdoc || '', DIAS_ATRASO: String(diasAtrasoAtual() ?? ''), INSTITUICAO: cli.instituicao || '',
      PROTOCOLO: cli.protocolo || '', SAC: sacDe(cli.instituicao), HOJE: new Date().toLocaleDateString('pt-BR'),
      CPF: formatarCpf(cli.cpf), TELEFONE: formatarTel(cli.telefone), ...r.numeros
    };
    for (const [k, v] of Object.entries(r.moeda)) vars[k] = Dinheiro.formatar(v);
    const m = modelo || modelosDe(setor).find(x => x.id === ui.modeloId) || modeloEmUso(setor);
    return { texto: m ? renderizarModelo(m.texto, vars, r.condicoes) : '', resumo: r.resumo };
  }

  /** A conversa aberta ainda é a do cliente carregado? */
  function mesmaConversa() {
    if (ui.dados && ui.dados.atendimentoId !== ponte.atendimentoId) {
      aviso('Você trocou de conversa. Atualizei os dados: confira antes de enviar.', 'erro');
      buscar();
      return false;
    }
    return true;
  }
  /** Coloca no campo de mensagem do chat, para revisar e enviar. */
  async function colocarNoChat(texto) {
    if (!texto || !mesmaConversa()) return false;
    const campo = campoDoChat();
    if (!campo) {
      await copiar(texto);
      aviso('Campo de mensagem não encontrado. A mensagem foi copiada.', 'alerta');
      return false;
    }
    escreverNoCampo(campo, texto);
    aviso('Mensagem no campo. Revise e envie.');
    return true;
  }
  /** Envia pelo campo do chat (a tela registra o envio normalmente). */
  async function enviarNoChat(texto) {
    if (!texto || ui.enviando || !mesmaConversa()) return false;
    ui.enviando = true;
    try {
      await enviarPeloChat(texto);
      aviso('Mensagem enviada.');
      return true;
    } catch (e) {
      aviso(e.message || 'Não consegui enviar.', 'erro');
      return false;
    } finally {
      ui.enviando = false;
    }
  }
  /** Botão «Enviar» em dois cliques: o primeiro vira «Confirmar envio» por 4 s. */
  function botaoEnviarComConfirmacao(btn, gerarTexto, depois) {
    btn.addEventListener('click', async () => {
      if (!ui.confirmandoEnvio) {
        ui.confirmandoEnvio = true;
        btn.className = 'bt confirmar cresce';
        btn.innerHTML = `${icone('enviar', 15)}Confirmar envio`;
        clearTimeout(ui.tConfirmar);
        ui.tConfirmar = setTimeout(() => { ui.confirmandoEnvio = false; depois?.(); }, 4000);
        return;
      }
      ui.confirmandoEnvio = false;
      clearTimeout(ui.tConfirmar);
      btn.disabled = true;
      await enviarNoChat(gerarTexto());
      depois?.();
    });
  }

  function semConversa(texto = 'Abra uma conversa e os dados do cliente aparecem aqui sozinhos.') {
    return `<div class="cartao vazio-estado"><div class="bolha">${icone('chat', 22)}</div><b>Nenhuma conversa aberta</b>${esc(texto)}</div>`;
  }
  const iniciais = nome => String(nome || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
  function dado(rotulo, ico, valor, { copiavel = false, vermelho = false } = {}) {
    if (!valor) return `<div class="dado"><span>${icone(ico, 12)}${esc(rotulo)}</span><div><em style="color:var(--muted-foreground);font-weight:500">—</em></div></div>`;
    return `<div class="dado ${vermelho ? 'vermelho' : ''}"><span>${icone(ico, 12)}${esc(rotulo)}</span><div><em title="${esc(valor)}">${esc(valor)}</em>${copiavel ? `<button type="button" class="ico-bt" data-copiar-valor="${esc(valor)}" title="Copiar ${esc(rotulo)}">${icone('copiar', 13)}</button>` : ''}</div></div>`;
  }

  /** Cartão do cliente: nome, CPF, telefone, saldos, situação e a regra de desconto do sistema. */
  function cartaoCliente(compacto = false) {
    const d = ui.dados;
    if (ui.carregando && d?.atendimentoId !== ponte.atendimentoId) {
      return '<div class="cartao pad"><div class="esqueleto" style="width:60%"></div><div class="esqueleto" style="width:40%;margin-top:10px"></div><div class="esqueleto" style="width:80%;margin-top:10px"></div></div>';
    }
    if (!d) return '';
    const cli = d.cliente;
    const dias = diasAtrasoAtual();
    const ct = contratoAtual();
    const coren = cli.instituicaoFonte === 'carteira Coren';
    return `<div class="cartao">
      <div class="cli-topo">
        <div class="avatar">${esc(iniciais(cli.nome || cli.nomeContato))}</div>
        <div class="cli-nome"><b title="${esc(cli.nome)}">${esc(cli.nome || cli.nomeContato || 'Cliente')}</b>
          <div class="etiquetas">
            ${cli.instituicaoDetectada ? `<span class="etq ${cli.instituicaoFonte === 'canal de entrada' ? 'ambar' : 'azul'}" title="Instituição pelo ${esc(cli.instituicaoFonte)}">${esc(cli.instituicao)}${cli.instituicaoFonte === 'canal de entrada' ? ' · confira' : ''}</span>` : ''}
            ${dias ? `<span class="etq risco">${dias} dias em atraso</span>` : '<span class="etq ok">Em dia</span>'}
            ${cli.setorVinculado ? `<span class="etq" title="Setor vinculado">${esc(cli.setorVinculado)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="dados">
        ${dado('CPF', 'cpf', formatarCpf(cli.cpf), { copiavel: true })}
        ${dado('Telefone', 'telefone', formatarTel(cli.telefone), { copiavel: true })}
        ${compacto ? '' : `${dado('Saldo total', 'dinheiro', cli.saldoTotal ? Dinheiro.formatar(cli.saldoTotal) : '')}
        ${!cli.emAtraso && cli.aVencer ? dado('A vencer', 'dinheiro', Dinheiro.formatar(cli.aVencer)) : dado('Em atraso', 'alerta', cli.emAtraso ? Dinheiro.formatar(cli.emAtraso) : '', { vermelho: cli.emAtraso > 0 })}`}
        ${dado(coren ? 'Protocolo' : 'Nrdoc', 'documento', coren ? cli.protocoloAtendimento || cli.protocolo : ct?.nrdoc || cli.protocolo, { copiavel: true })}
        ${dado(cli.desdeRotulo || 'Desde', /pr[óo]xima/i.test(cli.desdeRotulo || '') ? 'documento' : 'alerta', (cli.desde || '').replace(/\s*\(.*\)\s*$/, ''))}
      </div>
      ${!compacto && d.contratos.length > 1 ? `<div class="contratos-caixa" style="padding-top:12px"><div class="sub-rotulo">${d.contratos.length} contratos</div><div class="contratos">${d.contratos.map((c, i) => `
        <button type="button" class="contrato" data-contrato="${i}" aria-pressed="${i === ui.contratoIdx}"><b>${esc(c.nrdoc)}</b><small>${Dinheiro.formatar(c.totalAberto)} em aberto</small></button>`).join('')}</div></div>` : ''}
      ${!compacto && !d.contratos.length ? '<div class="aviso" style="margin:0 14px 12px">O ChatPlay não trouxe títulos para esta conversa. Preencha os valores à mão.</div>' : ''}
      ${situacaoDoCliente(d)}
    </div>`;
  }

  function situacaoDoCliente(d) {
    const linhasSit = [];
    const cli = d.cliente;
    if (d.setorCliente) {
      const fonte = d.setorFonte === 'qualidade' ? `pela qualidade (agendamento de ${d.qualidade.data})`
        : d.setorFonte === 'vinculo' ? 'pelo setor vinculado' : `pela qualidade, registro antigo de ${d.qualidade?.data}`;
      linhasSit.push(['Setor', `<b>${esc(SETORES[d.setorCliente]?.nome || d.setorCliente)}</b> <small>${esc(fonte)}</small>`]);
    }
    const canal = departamentoCurto(cli.setorDepartamento);
    const setorCanal = setorPeloVinculo(canal, true);
    if (d.setorCliente && setorCanal && setorCanal !== d.setorCliente) {
      linhasSit.push(['Atenção', `<span class="risco">Entrou pelo canal <b>${esc(canal)}</b>, mas o cliente é do <b>${esc(SETORES[d.setorCliente]?.nome)}</b>.</span>`]);
    }
    const a = d.acordoSistema;
    if (a) {
      const txt = a.situacao === 'em dia'
        ? `<span class="ok">Em dia</span> · ${a.abertas} de ${a.total} parcela(s) em aberto · próxima <b>${Dinheiro.formatar(a.valor)}</b> em ${esc(a.vencimentoCompleto)}`
        : `<span class="risco">Atrasado</span> · ${a.vencidas} parcela(s) vencida(s) de ${a.total} · ${Dinheiro.formatar(a.valor)} desde ${esc(a.vencimentoCompleto)}`;
      linhasSit.push(['Acordo', `${txt}<br><small>feito em ${esc(a.data)}${a.setor ? ' · ' + esc(a.setor) : ''}${a.nrdoc ? ' · Nrdoc ' + esc(a.nrdoc) : ''}</small>`]);
    }
    const t = d.ultimaTabulacao;
    if (t?.situacao) {
      const tom = /acordo fechado/i.test(t.situacao) ? 'ok' : /negocia/i.test(t.situacao) ? 'azul' : '';
      linhasSit.push(['Tabulação', `<span class="${tom}">${esc(t.situacao)}</span> · ${esc(t.data)}${t.usuario ? ' · ' + esc(t.usuario) : ''}${t.setor ? ' (' + esc(t.setor) + ')' : ''}${t.proxContato ? `<br><small>próximo contato ${esc(t.proxContato)}</small>` : ''}`]);
    }
    if (cli.ultimoAtendimento) linhasSit.push(['Último', `<small>${esc(cli.ultimoAtendimento.trim().slice(0, 160))}</small>`]);
    if (!linhasSit.length) return '';
    return `<div class="situacao" style="border-top:1px solid var(--border)">${linhasSit.map(([r, v]) => `<div class="sit"><span>${r}</span><div>${v}</div></div>`).join('')}</div>`;
  }

  /** Regra de desconto que o ChatPlay manda com os títulos: o teto de cada cargo. */
  function regraDoSistema(r) {
    if (!r) return '';
    if (!r.possuiDesconto) return `<div class="regra" style="border-top:0">${icone('escudo', 16)}<div><b>Aba «Títulos»: sem desconto</b> para este cliente${r.tipo ? ` · ${esc(r.tipo)}` : ''}.</div></div>`;
    return `<div class="regra" style="border-top:0">${icone('escudo', 16)}<div><b>Regra da aba «Títulos»${r.tipo ? ` · ${esc(r.tipo)}` : ''}</b> <small>(referência do ChatPlay)</small><br>
      <small>Desconto até <b>${r.operador}%</b> (operador) · ${r.supervisor}% supervisor · ${r.gerente}% gerente${r.vencimentoOperador ? ` · vencimento até ${esc(r.vencimentoOperador)}` : ''}${r.setor ? ` · ${esc(r.setor)}` : ''}</small></div></div>`;
  }

  function ligarCopiar(raizEl) {
    raizEl.querySelectorAll('[data-copiar-valor]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      if (await copiar(b.dataset.copiarValor)) {
        b.classList.add('ok');
        b.innerHTML = icone('check', 13);
        setTimeout(() => { b.classList.remove('ok'); b.innerHTML = icone('copiar', 13); }, 1400);
      }
    }));
  }

  // ── Aba Atendimento ─────────────────────────────────────────────────────

  /** Cartão do profissional: só identificação (nada de valores). */
  function cartaoCofen() {
    const d = ui.dados;
    if (ui.carregando && d?.atendimentoId !== ponte.atendimentoId) {
      return '<div class="cartao pad"><div class="esqueleto" style="width:60%"></div><div class="esqueleto" style="width:40%;margin-top:10px"></div><div class="esqueleto" style="width:80%;margin-top:10px"></div></div>';
    }
    if (!d || d.atendimentoId !== ponte.atendimentoId) return '';
    const cli = d.cliente;
    const nome = d.semVinculo ? (cli.nomeContato && !/^\d+$/.test(cli.nomeContato.trim()) ? cli.nomeContato : formatarTel(cli.telefone)) : cli.nome;
    const linhasSit = [];
    const t = d.ultimaTabulacao;
    if (t?.situacao) {
      const tom = /acordo fechado/i.test(t.situacao) ? 'ok' : /negocia/i.test(t.situacao) ? 'azul' : '';
      linhasSit.push(['Tabulação', `<span class="${tom}">${esc(t.situacao)}</span> · ${esc(t.data)}${t.usuario ? ' · ' + esc(t.usuario) : ''}${t.proxContato ? `<br><small>próximo contato ${esc(t.proxContato)}</small>` : ''}`]);
    }
    if (cli.ultimoAtendimento) linhasSit.push(['Último', `<small>${esc(cli.ultimoAtendimento.trim().slice(0, 160))}</small>`]);
    return `<div class="cartao">
      <div class="cli-topo">
        <div class="avatar">${d.semVinculo ? icone('usuario', 18) : esc(iniciais(cli.nome))}</div>
        <div class="cli-nome"><b title="${esc(nome)}">${esc(nome || 'Profissional')}</b>
          <div class="etiquetas">
            <span class="etq ${d.corenFonte ? 'azul' : 'ambar'}" title="${esc(d.corenFonte ? 'Regional pela ' + d.corenFonte : 'Regional não encontrada')}">${esc(d.coren)}${d.corenFonte ? '' : ' · confira'}</span>
            ${d.semVinculo ? '<span class="etq ambar">Sem vínculo · pedir CPF</span>' : '<span class="etq ok">Vinculado</span>'}
          </div>
        </div>
      </div>
      <div class="dados">
        ${dado('CPF', 'cpf', formatarCpf(cli.cpf), { copiavel: true })}
        ${dado('Telefone', 'telefone', formatarTel(cli.telefone), { copiavel: true })}
        ${dado('Protocolo', 'documento', cli.protocoloAtendimento, { copiavel: true })}
        ${dado('Pasta', 'tag', departamentoCurto(cli.setorDepartamento))}
      </div>
      ${linhasSit.length ? `<div class="situacao">${linhasSit.map(([r, v]) => `<div class="sit"><span>${r}</span><div>${v}</div></div>`).join('')}</div>` : ''}
    </div>`;
  }

  function abaAtendimento() {
    const d = ui.dados && ui.dados.atendimentoId === ponte.atendimentoId ? ui.dados : null;
    const forcado = ui.tipoForcado?.att === ponte.atendimentoId ? ui.tipoForcado.tipo : null;
    const prev = d ? abordagem.montar(d, { tipo: forcado }) : null;
    corpo.innerHTML = `
      ${!cfg.operador ? '<div class="aviso erro">Preencha seu nome em <b>Ajustes</b>: ele vai na apresentação.</div>' : ''}
      ${ui.erro ? `<div class="aviso erro">${esc(ui.erro)}</div>` : ''}
      ${cartaoCofen() || semConversa('Abra uma conversa: o profissional e a mensagem aparecem aqui.')}
      ${prev ? `
        <div class="secao"><span>${esc(TIPOS_COFEN[prev.tipo])}</span><small>${forcado ? 'escolhida à mão' : d.semVinculo ? 'atendimento sem vínculo' : esc(prev.coren)}</small></div>
        ${prev.tipo === 'apresentacao' && !d.corenFonte ? '<div class="aviso">A regional não apareceu na pasta nem no canal: a mensagem saiu só com «Coren». Confira.</div>' : ''}
        <div class="conversa"><div class="balao" data-hora="${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}">${formatarWhats(prev.texto)}</div></div>
        <div class="linha entre">
          <button type="button" class="bt texto" id="at-trocar">${prev.tipo === 'cpf' ? 'Usar a apresentação' : 'Usar o pedido de CPF'}</button>
          <button type="button" class="bt texto" data-ir-msg="${prev.tipo}">${icone('editar', 13)} Editar este texto</button>
        </div>` : ''}
      <div class="cartao">
        <label class="opcao"><div><b>Apresentação automática</b><small>Ao clicar em «Sim» para iniciar, a mensagem vai para o campo, sem enviar: a apresentação, ou o pedido de CPF quando o atendimento está sem vínculo.</small></div>${chave('id="at-auto"', cfg.abordagemAuto, 'Apresentação automática')}</label>
      </div>
      <div class="dica" style="text-align:center">O botão ${icone('brilho', 12)} ao lado das mensagens rápidas gera a mensagem na hora.</div>`;
    const temConversa = !!ponte.atendimentoId && !!prev;
    rodape.innerHTML = `
      <button type="button" class="bt so-icone" id="at-copiar" title="Copiar" aria-label="Copiar" ${temConversa ? '' : 'disabled'}>${icone('copiar')}</button>
      <button type="button" class="bt cresce" id="at-colocar" title="Coloca no campo de mensagem para você revisar" ${temConversa ? '' : 'disabled'}>${icone('chat', 15)}Colocar no chat</button>
      <button type="button" class="bt primario cresce" id="at-enviar" ${temConversa ? '' : 'disabled'}>${icone('enviar', 15)}Enviar</button>`;
    ligarCopiar(corpo);
    corpo.querySelector('#at-auto').addEventListener('change', e => { cfg.abordagemAuto = e.target.checked; salvarCfg(); });
    corpo.querySelectorAll('[data-ir-msg]').forEach(b => b.addEventListener('click', () => { ui.filtro = b.dataset.irMsg; irPara('mensagens'); }));
    corpo.querySelector('#at-trocar')?.addEventListener('click', () => {
      ui.tipoForcado = { att: ponte.atendimentoId, tipo: prev.tipo === 'cpf' ? 'apresentacao' : 'cpf' };
      desenhar();
    });
    const texto = () => (cfg.operador && ui.dados ? abordagem.montar(ui.dados, { tipo: forcado }).texto : '');
    const semNome = () => aviso('Preencha seu nome em Ajustes.', 'erro');
    rodape.querySelector('#at-copiar').addEventListener('click', async () => { if (!cfg.operador) return semNome(); aviso((await copiar(texto())) ? 'Mensagem copiada.' : 'Não consegui copiar.'); });
    rodape.querySelector('#at-colocar').addEventListener('click', () => { if (!cfg.operador) return semNome(); colocarNoChat(texto()); });
    if (cfg.operador) botaoEnviarComConfirmacao(rodape.querySelector('#at-enviar'), texto, () => painelAberto('atendimento') && desenhar());
    else rodape.querySelector('#at-enviar').addEventListener('click', semNome);
  }

  // ── Aba Retomar ─────────────────────────────────────────────────────────

  function abaRecuperacao() {
    const sel = recuperacao.selecionados;
    const pastas = recuperacao.pastas();
    const agenda = cfg.rec.agendadoPara;
    const chaveEx = `${cfg.rec.aleatoria}|${cfg.operador}|${modeloEmUso('recuperacao')?.id}`;
    if (ui.exemploRec?.chave !== chaveEx) ui.exemploRec = { chave: chaveEx, texto: recuperacao.textoDaVez() };
    corpo.innerHTML = `
      ${!cfg.operador ? '<div class="aviso erro">Preencha seu nome em <b>Ajustes</b>: ele vai na mensagem.</div>' : ''}
      <div class="status">${esc(recuperacao.status)}</div>
      <div class="secao"><span>Mensagem</span></div>
      <div class="linha entre"><div class="segmento" id="rec-modo"><button type="button" data-m="1" aria-pressed="${cfg.rec.aleatoria}">Aleatória</button><button type="button" data-m="0" aria-pressed="${!cfg.rec.aleatoria}">Fixa</button></div>
        ${cfg.rec.aleatoria ? '' : '<button type="button" class="bt texto" data-ir-msg="recuperacao">Editar a fixa</button>'}</div>
      <div class="dica">${cfg.rec.aleatoria ? 'Cada cliente recebe abertura e opções sorteadas, com o seu nome. A saudação segue a hora.' : `Usa a mensagem «${esc(modeloEmUso('recuperacao')?.titulo || '')}».`}</div>
      <div class="conversa"><div class="balao">${formatarWhats(ui.exemploRec.texto)}</div></div>
      <div class="secao"><span>Selecionar parados</span></div>
      <div class="cartao pad" style="display:flex;flex-direction:column;gap:10px">
        <select class="entrada" id="rec-pasta"><option value="">Todas as pastas</option>${pastas.map(p => `<option ${p === cfg.rec.pasta ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
        <div class="linha"><label class="linha cresce" style="font-size:12px;color:var(--muted-foreground)"><input type="checkbox" id="rec-usar" ${cfg.rec.usarTempo ? 'checked' : ''}> Sem interação há
          <input type="number" class="entrada" id="rec-min" min="1" max="1440" value="${cfg.rec.minutos}" style="width:70px;height:30px;text-align:center"> min</label>
          <button type="button" class="bt" id="rec-selecionar">Selecionar</button></div>
        <div class="dica">Também dá para marcar na fila: passe o mouse no avatar do cliente e clique na bolinha.</div>
      </div>
      <div class="secao"><span>Agendar envio</span></div>
      <div class="cartao pad">${agenda ? `<div class="linha entre"><span>Agendado para <b>${esc(recuperacao.formatarAgenda(agenda))}</b></span><button type="button" class="bt pequeno perigo" id="rec-desagendar">Cancelar</button></div>`
        : '<div class="linha"><input type="time" class="entrada cresce" id="rec-hora"><button type="button" class="bt" id="rec-agendar">Agendar</button></div>'}</div>
      <div class="secao"><span>Selecionados (${sel.size})</span>${sel.size ? '<button type="button" class="bt texto" id="rec-limpar">Limpar</button>' : ''}</div>
      <div class="cartao">${sel.size ? [...sel].map(id => {
        const i = recuperacao.mapa.get(id);
        return `<div class="lista-linha"><span class="nome">${esc(i?.nome || '#' + id)}</span><span class="sub">${esc(i?.pasta || '')}</span><button type="button" class="ico-bt" data-tirar="${esc(id)}" title="Tirar">${icone('x', 14)}</button></div>`;
      }).join('') : '<div class="lista-vazia">Ninguém selecionado.</div>'}</div>`;
    rodape.innerHTML = `<button type="button" class="bt ${recuperacao.enviando ? 'cheio-perigo' : 'primario'} cresce" id="rec-enviar" ${!sel.size && !recuperacao.enviando ? 'disabled' : ''}>${icone(recuperacao.enviando ? 'x' : 'enviar', 15)}${recuperacao.enviando ? 'Parar envio' : `Enviar para ${sel.size}`}</button>`;
    corpo.querySelectorAll('#rec-modo [data-m]').forEach(b => b.addEventListener('click', () => { cfg.rec.aleatoria = b.dataset.m === '1'; salvarCfg(); desenhar(); }));
    corpo.querySelectorAll('[data-ir-msg]').forEach(b => b.addEventListener('click', () => { ui.filtro = b.dataset.irMsg; irPara('mensagens'); }));
    corpo.querySelector('#rec-pasta').addEventListener('change', e => { cfg.rec.pasta = e.target.value; salvarCfg(); });
    corpo.querySelector('#rec-usar').addEventListener('change', e => { cfg.rec.usarTempo = e.target.checked; salvarCfg(); });
    corpo.querySelector('#rec-min').addEventListener('input', e => { cfg.rec.minutos = Math.max(1, parseInt(e.target.value || '30', 10) || 30); salvarCfg(); });
    corpo.querySelector('#rec-selecionar').addEventListener('click', () => recuperacao.selecionarParados());
    corpo.querySelector('#rec-agendar')?.addEventListener('click', () => { const v = corpo.querySelector('#rec-hora').value; if (v) recuperacao.agendar(v); else aviso('Escolha o horário.', 'alerta'); });
    corpo.querySelector('#rec-desagendar')?.addEventListener('click', () => recuperacao.cancelarAgenda());
    corpo.querySelector('#rec-limpar')?.addEventListener('click', () => recuperacao.limpar());
    corpo.querySelectorAll('[data-tirar]').forEach(b => b.addEventListener('click', () => recuperacao.alternar(b.dataset.tirar)));
    rodape.querySelector('#rec-enviar').addEventListener('click', async () => {
      if (!recuperacao.enviando && !await confirmar(`Enviar a mensagem de retomada para ${sel.size} cliente(s)?`, 'Enviar')) return;
      recuperacao.enviar();
      setTimeout(desenhar, 50);
    });
  }

  // ── Aba Sinalizados ─────────────────────────────────────────────────────

  function abaSinalizados() {
    const pend = sinalizados.pendentes;
    const lemb = sinalizados.lembrados;
    const naFila = tel => [...atendimentos.values()].some(a => chaveTel(a.contact || telDoTexto(a.name)) === tel);
    const quando = ts => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); };
    const perm = 'Notification' in PAGINA ? Notification.permission : 'sem';
    corpo.innerHTML = `
      <div class="aviso info">Sinalize pelo ícone de etiqueta no topo da conversa, como sempre. O Mestre lembra o cliente pelo telefone por ${cfg.sinal.lembrarDias} dias e avisa quando ele escrever, mesmo que o atendimento tenha sido finalizado.</div>
      <div class="secao"><span>Mensagens novas (${pend.length})</span>${pend.length ? '<button type="button" class="bt texto" id="sn-limpar">Dispensar todas</button>' : ''}</div>
      <div class="cartao">${pend.length ? pend.map(p => `
        <div class="sinal novo" style="--c:${esc(p.cor || '#44c2e1')}"><span class="cor"></span>
          <div class="meio"><b>${esc(p.nome)}</b><small>${p.tipo === 'voltou' ? 'voltou · ' : ''}${esc(p.texto)}</small></div>
          <span class="sub" style="font-size:11px;color:var(--muted-foreground)">${esc(p.hora || '')}</span>
          <button type="button" class="ico-bt" data-abrir="${esc(p.tel)}" title="Abrir a conversa">${icone('abrir', 14)}</button>
          <button type="button" class="ico-bt" data-dispensar="${esc(p.tel)}" title="Dispensar">${icone('x', 14)}</button></div>`).join('') : '<div class="lista-vazia">Nenhuma mensagem nova de sinalizados.</div>'}</div>
      <div class="secao"><span>Clientes lembrados (${lemb.length})</span></div>
      <div class="cartao">${lemb.length ? lemb.map(l => `
        <div class="sinal" style="--c:${esc(l.cor)}"><span class="cor"></span>
          <div class="meio"><b>${esc(l.nome)}</b><small>${esc(l.etiqueta)} · ${esc(l.telFormatado || l.tel)} · desde ${esc(quando(l.desde))}</small></div>
          ${naFila(l.tel) ? `<button type="button" class="ico-bt" data-abrir="${esc(l.tel)}" title="Abrir a conversa">${icone('abrir', 14)}</button>` : '<span class="selo" title="Não está na sua lista agora">fora da fila</span>'}
          <button type="button" class="ico-bt" data-esquecer="${esc(l.tel)}" title="Esquecer (não avisa mais)">${icone('lixo', 14)}</button></div>`).join('') : '<div class="lista-vazia">Ninguém sinalizado ainda.</div>'}</div>
      <div class="secao"><span>Como avisar</span></div>
      <div class="cartao">
        <label class="opcao"><div><b>Som</b><small>Dois toques quando escreve; três quando volta num atendimento novo.</small></div>${chave('data-sn="som"', cfg.sinal.som, 'Som')}</label>
        <label class="opcao"><div><b>Notificação do Windows</b><small>${perm === 'granted' ? 'Permitida.' : perm === 'denied' ? 'Bloqueada no navegador (libere no cadeado da barra de endereço).' : perm === 'sem' ? 'Sem suporte.' : 'Ainda não permitida.'}</small></div>${perm === 'default' ? '<button type="button" class="bt pequeno" id="sn-permitir">Permitir</button>' : chave('data-sn="notificacao"', cfg.sinal.notificacao, 'Notificação')}</label>
        <label class="opcao"><div><b>Avisar quando voltar</b><small>Cliente lembrado que entra de novo na fila, num atendimento novo.</small></div>${chave('data-sn="voltou"', cfg.sinal.voltou, 'Avisar quando voltar')}</label>
        <div class="opcao"><div><b>Lembrar por</b><small>Depois disso, o cliente sai da lista sozinho.</small></div><div class="linha"><input type="number" class="entrada" id="sn-dias" min="1" max="180" value="${cfg.sinal.lembrarDias}" style="width:70px;height:30px;text-align:center"><small>dias</small></div></div>
      </div>`;
    rodape.innerHTML = `<button type="button" class="bt cresce" id="sn-testar">${icone('sino', 15)}Testar aviso</button>`;
    corpo.querySelectorAll('[data-abrir]').forEach(b => b.addEventListener('click', () => sinalizados.abrir(b.dataset.abrir)));
    corpo.querySelectorAll('[data-dispensar]').forEach(b => b.addEventListener('click', () => sinalizados.dispensar(b.dataset.dispensar)));
    corpo.querySelectorAll('[data-esquecer]').forEach(b => b.addEventListener('click', async () => { if (await confirmar('Esquecer este cliente? O Mestre para de avisar sobre ele.', 'Esquecer')) sinalizados.esquecer(b.dataset.esquecer); }));
    corpo.querySelector('#sn-limpar')?.addEventListener('click', () => sinalizados.limparPendentes());
    corpo.querySelectorAll('[data-sn]').forEach(c => c.addEventListener('change', () => { cfg.sinal[c.dataset.sn] = c.checked; salvarCfg(); }));
    corpo.querySelector('#sn-dias').addEventListener('input', e => { cfg.sinal.lembrarDias = Math.min(180, Math.max(1, parseInt(e.target.value || '30', 10) || 30)); salvarCfg(); });
    corpo.querySelector('#sn-permitir')?.addEventListener('click', () => Promise.resolve(Notification.requestPermission()).then(desenhar));
    rodape.querySelector('#sn-testar').addEventListener('click', () => sinalizados.testar());
  }

  // ── Aba Mensagens ───────────────────────────────────────────────────────

  const ALVOS = Object.keys(TIPOS_COFEN);
  const EXEMPLO = { totalAberto: 189000, valorParcela: 13500, qtdAtraso: 3, valorAtraso: 40500, totalAtualizado: 236000, qtdRestantes: 14 };
  const CLIENTE_EXEMPLO = {
    atendimentoId: null, coren: 'Coren-PA', corenFonte: 'pasta do cliente', semVinculo: false,
    cliente: { nome: 'MARIA DA SILVA', cpf: '12345678900', telefone: '5591999999999', protocoloAtendimento: 'BCPA202611-12345678' }
  };

  function previaDoModelo(m) {
    const alvo = m.setores[0] || 'apresentacao';
    const dados = ui.dados || CLIENTE_EXEMPLO;
    if (alvo === 'recuperacao') return renderizarModelo(m.texto, abordagem.variaveis(dados).vars, {});
    return abordagem.montar(dados, { modelo: m, tipo: alvo }).texto;
  }

  function abaMensagens() {
    if (ui.editando) return editorDeMensagem();
    const filtro = ALVOS.includes(ui.filtro) ? ui.filtro : 'apresentacao';
    ui.filtro = filtro;
    const lista = modelosDe(filtro);
    const emUso = modeloEmUso(filtro);
    corpo.innerHTML = `
      <div class="linha">
        <select class="entrada cresce" id="msg-filtro">
          ${Object.entries(TIPOS_COFEN).map(([id, n]) => `<option value="${id}" ${id === filtro ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
        <button type="button" class="bt primario" id="msg-nova">${icone('mais', 15)}Nova</button>
      </div>
      <div class="dica">A ★ marca a que é usada. As suas ficam salvas só neste computador.</div>
      <div class="cartao">${lista.map(m => `
        <div class="item ${m.id === emUso?.id ? 'em-uso' : ''}">
          <div class="item-topo"><b>${esc(m.titulo)}</b>${m.fixo ? '<span class="selo">Padrão</span>' : '<span class="selo azul">Sua</span>'}${m.id === emUso?.id ? '<span class="selo azul">★ Em uso</span>' : ''}</div>
          <div class="item-trecho">${esc(m.texto.replace(/\{\{[#^/][A-Z0-9_]+\}\}/g, '').slice(0, 220))}</div>
          <div class="item-acoes">
            ${m.id !== emUso?.id ? `<button type="button" class="bt pequeno" data-usar="${esc(m.id)}">${icone('estrela', 14)}Usar</button>` : ''}
            <button type="button" class="bt pequeno" data-editar="${esc(m.id)}" title="${m.fixo ? 'Edita e salva como a sua versão, já em uso' : 'Editar'}">${icone('editar', 14)}Editar</button>
            <button type="button" class="bt pequeno" data-duplicar="${esc(m.id)}">${icone('duplicar', 14)}Duplicar</button>
            ${m.fixo ? '' : `<button type="button" class="bt pequeno perigo" data-excluir="${esc(m.id)}" title="Excluir">${icone('lixo', 14)}</button>`}
          </div>
        </div>`).join('')}</div>
      <div class="linha" style="justify-content:center">
        <button type="button" class="bt pequeno" id="msg-exportar">${icone('baixar', 14)}Exportar as minhas</button>
        <button type="button" class="bt pequeno" id="msg-importar">${icone('subir', 14)}Importar</button>
        <input type="file" id="msg-arquivo" accept=".json,application/json" hidden>
      </div>`;
    const porId = id => todosModelos().find(m => m.id === id);
    corpo.querySelector('#msg-filtro').addEventListener('change', e => { ui.filtro = e.target.value; desenhar(); });
    corpo.querySelector('#msg-nova').addEventListener('click', () => { ui.editando = { id: null, titulo: '', setores: [filtro], texto: '' }; desenhar(); });
    corpo.querySelectorAll('[data-usar]').forEach(b => b.addEventListener('click', () => {
      for (const s of porId(b.dataset.usar).setores) cfg.modeloPadrao[s] = b.dataset.usar;
      salvarCfg();
      ui.modeloId = null;
      desenhar();
    }));
    corpo.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () => {
      const m = porId(b.dataset.editar);
      ui.editando = m.fixo ? { id: null, base: m.id, titulo: m.titulo, setores: [...m.setores], texto: m.texto } : { ...m, setores: [...m.setores] };
      desenhar();
    }));
    corpo.querySelectorAll('[data-duplicar]').forEach(b => b.addEventListener('click', () => { const m = porId(b.dataset.duplicar); ui.editando = { id: null, titulo: `${m.titulo} (cópia)`, setores: [...m.setores], texto: m.texto }; desenhar(); }));
    corpo.querySelectorAll('[data-excluir]').forEach(b => b.addEventListener('click', async () => {
      const m = porId(b.dataset.excluir);
      if (!await confirmar(`Excluir a mensagem «${m.titulo}»?`, 'Excluir')) return;
      cfg.modelos = cfg.modelos.filter(x => x.id !== m.id);
      for (const s of Object.keys(cfg.modeloPadrao)) if (cfg.modeloPadrao[s] === m.id) delete cfg.modeloPadrao[s];
      salvarCfg(true);
      desenhar();
      aviso('Mensagem excluída.');
    }));
    corpo.querySelector('#msg-exportar').addEventListener('click', exportarModelos);
    const arq = corpo.querySelector('#msg-arquivo');
    corpo.querySelector('#msg-importar').addEventListener('click', () => arq.click());
    arq.addEventListener('change', () => importarModelos(arq.files[0]));
  }

  function editorDeMensagem() {
    const m = ui.editando;
    const tipos = new Set(m.setores.map(tipoDoAlvo));
    const vars = VARIAVEIS_COFEN;
    const conds = CONDICOES.filter(c => c.tipos.some(t => tipos.has(t)));
    corpo.innerHTML = `
      <div class="linha"><button type="button" class="bt texto" id="ed-voltar">${icone('voltar', 14)}Voltar</button><b class="cresce">${m.base ? 'Editar a mensagem padrão' : m.id ? 'Editar mensagem' : 'Nova mensagem'}</b></div>
      ${m.base ? '<div class="aviso info">Ao salvar, esta vira <b>a sua versão</b> e passa a ser a usada. A padrão continua na lista; para voltar a ela é só clicar em «Usar».</div>' : ''}
      <label class="campo"><span>Nome da mensagem</span><input class="entrada" id="ed-titulo" maxlength="60" placeholder="Ex.: Proposta com entrada" value="${esc(m.titulo)}"></label>
      <div class="campo"><span>Vale para</span>
        <div class="fichas">${ALVOS.map(id => `<button type="button" class="ficha" data-alvo="${id}" aria-pressed="${m.setores.includes(id)}">${esc(nomeDoAlvo(id))}</button>`).join('')}</div>
        <div class="dica">Cada mensagem vale para um tipo.</div>
      </div>
      <label class="campo"><span>Texto</span><textarea class="entrada" id="ed-texto" spellcheck="false" placeholder="Escreva a mensagem e clique nas variáveis abaixo para inserir os valores.">${esc(m.texto)}</textarea></label>
      <div><div class="sub-rotulo">Inserir valor</div><div class="fichas">${vars.map(v => `<button type="button" class="ficha" data-inserir="{{${v.nome}}}" title="${esc(v.desc)}">${v.nome}</button>`).join('')}</div></div>
      <div><div class="sub-rotulo">Opções numeradas e trechos condicionais</div>
        <div class="fichas"><button type="button" class="ficha" data-inserir="{{N}}" title="Vira 1️⃣, 2️⃣, 3️⃣… na ordem">{{N}} número da opção</button>
        ${conds.map(c => `<button type="button" class="ficha cond" data-cond="${c.nome}" title="${esc(c.desc)}">só se ${c.nome}</button>`).join('')}</div>
        <div class="dica" style="margin-top:6px">Selecione um trecho e clique em «só se…»: ele só aparece quando a condição vale. {{N}} numera sozinho, mesmo quando uma opção some.</div>
      </div>
      <div class="secao"><span>Prévia ${ui.dados ? 'com o cliente aberto' : 'com valores de exemplo'}</span></div>
      <div class="conversa"><div class="balao" id="ed-previa"></div></div>`;
    rodape.innerHTML = '<button type="button" class="bt cresce" id="ed-cancelar">Cancelar</button><button type="button" class="bt primario cresce" id="ed-salvar">Salvar mensagem</button>';

    const titulo = corpo.querySelector('#ed-titulo');
    const texto = corpo.querySelector('#ed-texto');
    const previa = corpo.querySelector('#ed-previa');
    const atualizar = () => {
      m.titulo = titulo.value;
      m.texto = texto.value;
      const t = m.setores.length && m.texto.trim() ? previaDoModelo(m) : '';
      previa.className = t ? 'balao' : 'balao vazio';
      if (t) previa.innerHTML = formatarWhats(t); else previa.textContent = 'A prévia aparece aqui.';
    };
    titulo.addEventListener('input', atualizar);
    texto.addEventListener('input', atualizar);
    const inserir = (antes, depois = '') => {
      const { selectionStart: a, selectionEnd: b, value } = texto;
      const meio = value.slice(a, b);
      texto.value = value.slice(0, a) + antes + meio + depois + value.slice(b);
      const pos = a + antes.length + meio.length + (meio ? depois.length : 0);
      texto.focus();
      texto.setSelectionRange(pos, pos);
      atualizar();
    };
    corpo.querySelectorAll('[data-inserir]').forEach(b => b.addEventListener('click', () => inserir(b.dataset.inserir)));
    corpo.querySelectorAll('[data-cond]').forEach(b => b.addEventListener('click', () => inserir(`{{#${b.dataset.cond}}}`, `{{/${b.dataset.cond}}}`)));
    corpo.querySelectorAll('[data-alvo]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.alvo;
      m.titulo = titulo.value;
      m.texto = texto.value;
      if (SETORES[id]) {
        m.setores = m.setores.filter(s => SETORES[s]);
        m.setores = m.setores.includes(id) ? m.setores.filter(s => s !== id) : [...m.setores, id];
      } else m.setores = m.setores.includes(id) ? [] : [id];
      editorDeMensagem();
    }));
    const sair = () => { ui.editando = null; desenhar(); };
    corpo.querySelector('#ed-voltar').addEventListener('click', sair);
    rodape.querySelector('#ed-cancelar').addEventListener('click', sair);
    rodape.querySelector('#ed-salvar').addEventListener('click', () => {
      m.titulo = titulo.value.trim();
      m.texto = texto.value.trim();
      if (!m.titulo) { aviso('Dê um nome para a mensagem.', 'erro'); titulo.focus(); return; }
      if (!m.setores.length) { aviso('Escolha onde ela vale.', 'erro'); return; }
      if (!m.texto) { aviso('Escreva o texto da mensagem.', 'erro'); texto.focus(); return; }
      if ((m.texto.match(/\{\{[#^][A-Z0-9_]+\}\}/g) || []).length !== (m.texto.match(/\{\{\/[A-Z0-9_]+\}\}/g) || []).length) {
        aviso('Tem um «só se…» sem fechamento no texto.', 'erro');
        return;
      }
      const agora = new Date().toISOString();
      if (m.id && cfg.modelos.some(x => x.id === m.id)) {
        cfg.modelos = cfg.modelos.map(x => (x.id === m.id ? { ...x, titulo: m.titulo, setores: m.setores, texto: m.texto, atualizadoEm: agora } : x));
      } else {
        m.id = novoId();
        cfg.modelos.push({ id: m.id, titulo: m.titulo, setores: m.setores, texto: m.texto, criadoEm: agora });
        if (m.base) for (const s of m.setores) cfg.modeloPadrao[s] = m.id;
      }
      salvarCfg(true);
      ui.filtro = m.setores[0];
      ui.modeloId = null;
      sair();
      aviso(m.base ? 'Sua versão foi salva e já está em uso.' : 'Mensagem salva.');
    });
    atualizar();
  }

  function exportarModelos() {
    if (!cfg.modelos.length) return aviso('Você ainda não criou mensagens.', 'alerta');
    const blob = new Blob([JSON.stringify({ app: 'chatplay-mestre', versao: 1, modelos: cfg.modelos }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mensagens-chatplay-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function importarModelos(arquivo) {
    if (!arquivo) return;
    try {
      const j = JSON.parse(await arquivo.text());
      const lista = Array.isArray(j) ? j : j.modelos;
      if (!Array.isArray(lista)) throw new Error('arquivo sem mensagens');
      let novos = 0;
      for (const m of lista) {
        if (!m?.texto || !m?.titulo) continue;
        const setores = (m.setores || [m.setor]).filter(s => ALVOS.includes(s));
        if (!setores.length || cfg.modelos.some(x => x.titulo === m.titulo && x.texto === m.texto)) continue;
        cfg.modelos.push({ id: novoId(), titulo: String(m.titulo).slice(0, 60), setores, texto: String(m.texto), criadoEm: new Date().toISOString() });
        novos++;
      }
      salvarCfg(true);
      desenhar();
      aviso(novos ? `${novos} mensagem(ns) importada(s).` : 'Nada novo no arquivo.', novos ? 'ok' : 'alerta');
    } catch (e) { aviso('Não consegui ler o arquivo: ' + e.message, 'erro'); }
  }

  // ── Aba WallPaper ───────────────────────────────────────────────────────

  function abaAparencia() {
    const p = cfg.papel;
    const temImagem = !!papel.imagem;
    corpo.innerHTML = `
      <div class="cartao"><label class="opcao"><div><b>WallPaper na conversa</b><small>Fica salvo neste computador.</small></div>${chave('id="pp-ativo"', p.ativo, 'WallPaper')}</label></div>
      <div class="secao"><span>Prévia</span><small>${p.tipo === 'imagem' && temImagem ? 'clique na imagem para escolher o ponto de foco' : ''}</small></div>
      <div class="previa-papel" id="pp-previa"><div class="fundo"></div><div class="bolha cli">Oi! Queria ver meu boleto.</div><div class="bolha eu">Claro! Já te passo as opções 😊</div>${p.tipo === 'imagem' && temImagem ? `<i class="mira" style="left:${p.x}%;top:${p.y}%"></i>` : ''}</div>
      <div class="secao"><span>Temas prontos</span></div>
      <div class="temas">${Object.entries(papel.PRESETS).map(([id, t]) => `<button type="button" class="tema" data-preset="${id}" aria-pressed="${p.tipo === 'preset' && p.preset === id}" style="background:${t.css}"><span>${esc(t.nome)}</span></button>`).join('')}</div>
      <div class="secao"><span>Sua imagem</span>${temImagem ? `<button type="button" class="bt texto" id="pp-usar-img" ${p.tipo === 'imagem' ? 'hidden' : ''}>Usar a minha imagem</button>` : ''}</div>
      <div class="soltar" id="pp-soltar" tabindex="0" role="button"><b>Arraste uma imagem aqui</b><span>ou clique para escolher · também dá para colar (Ctrl+V)</span></div>
      <input type="file" id="pp-arquivo" accept="image/*" hidden>
      <div class="grade">
        <label class="campo"><span>Encaixe</span><select class="entrada" id="pp-ajuste" ${p.tipo !== 'imagem' ? 'disabled' : ''}>
          <option value="cover" ${p.ajuste === 'cover' ? 'selected' : ''}>Preencher</option><option value="contain" ${p.ajuste === 'contain' ? 'selected' : ''}>Mostrar inteira</option><option value="repeat" ${p.ajuste === 'repeat' ? 'selected' : ''}>Lado a lado</option></select></label>
        <label class="campo"><span>Véu para leitura: <b id="pp-veu-v">${p.veu}%</b></span><input type="range" id="pp-veu" min="0" max="90" step="5" value="${p.veu}"></label>
      </div>
      <div class="linha entre">
        <button type="button" class="bt pequeno" id="pp-nenhum">Sem WallPaper</button>
        ${temImagem ? `<button type="button" class="bt pequeno perigo" id="pp-remover">${icone('lixo', 14)}Apagar minha imagem</button>` : ''}
      </div>`;

    const previa = corpo.querySelector('#pp-previa .fundo');
    const pintarPrevia = () => {
      const veu = p.veu / 100;
      const cor = tema.atual === 'escuro' ? `rgba(2,6,23,${veu})` : `rgba(255,255,255,${veu})`;
      const camada = `linear-gradient(${cor},${cor})`;
      if (p.tipo === 'imagem' && temImagem) {
        previa.style.background = `${camada}, url("${papel.imagem}") ${p.x}% ${p.y}% / ${p.ajuste === 'contain' ? 'contain' : p.ajuste === 'repeat' ? 'auto' : 'cover'} ${p.ajuste === 'repeat' ? 'repeat' : 'no-repeat'}, ${tema.atual === 'escuro' ? '#020617' : '#f4f4f5'}`;
      } else if (p.tipo === 'preset') previa.style.background = `${camada}, ${papel.PRESETS[p.preset]?.css}`;
      else previa.style.background = tema.atual === 'escuro' ? '#020617' : '#f4f4f5';
    };
    const mudar = (novo, redesenhar = false) => {
      Object.assign(p, novo);
      salvarCfg();
      papel.aplicar();
      if (redesenhar) desenhar(); else pintarPrevia();
    };
    pintarPrevia();
    corpo.querySelector('#pp-ativo').addEventListener('change', e => mudar({ ativo: e.target.checked, tipo: e.target.checked && p.tipo === 'nenhum' ? 'preset' : p.tipo }, true));
    corpo.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => mudar({ ativo: true, tipo: 'preset', preset: b.dataset.preset }, true)));
    corpo.querySelector('#pp-usar-img')?.addEventListener('click', () => mudar({ ativo: true, tipo: 'imagem' }, true));
    corpo.querySelector('#pp-nenhum').addEventListener('click', () => mudar({ tipo: 'nenhum', ativo: false }, true));
    corpo.querySelector('#pp-remover')?.addEventListener('click', async () => { if (await confirmar('Apagar a imagem salva?', 'Apagar')) { papel.removerImagem(); desenhar(); } });
    corpo.querySelector('#pp-ajuste').addEventListener('change', e => mudar({ ajuste: e.target.value }));
    const veu = corpo.querySelector('#pp-veu');
    veu.addEventListener('input', () => { corpo.querySelector('#pp-veu-v').textContent = veu.value + '%'; mudar({ veu: Number(veu.value) }); });
    corpo.querySelector('#pp-previa').addEventListener('click', e => {
      if (p.tipo !== 'imagem' || !temImagem) return;
      const r = e.currentTarget.getBoundingClientRect();
      mudar({ x: Math.round(((e.clientX - r.left) / r.width) * 100), y: Math.round(((e.clientY - r.top) / r.height) * 100) }, true);
    });
    const soltar = corpo.querySelector('#pp-soltar');
    const arquivo = corpo.querySelector('#pp-arquivo');
    const usar = async f => {
      if (!f) return;
      soltar.innerHTML = '<b>Preparando a imagem…</b>';
      try {
        const r = await papel.usarArquivo(f);
        aviso(`WallPaper aplicado (${r.w}×${r.h}, ${r.kb} KB).`);
      } catch (e) { aviso(e.message, 'erro'); }
      desenhar();
    };
    soltar.addEventListener('click', () => arquivo.click());
    soltar.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); arquivo.click(); } });
    arquivo.addEventListener('change', () => usar(arquivo.files[0]));
    soltar.addEventListener('dragover', e => { e.preventDefault(); soltar.classList.add('sobre'); });
    soltar.addEventListener('dragleave', () => soltar.classList.remove('sobre'));
    soltar.addEventListener('drop', e => { e.preventDefault(); soltar.classList.remove('sobre'); usar(e.dataTransfer.files[0]); });
    folha.onpaste = e => {
      if (ui.aba !== 'aparencia') return;
      const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); usar(f); }
    };
  }

  // ── Ajustes ─────────────────────────────────────────────────────────────

  function abaAjustes() {
    const VISUAIS = [
      ['setorEmAtendimento', 'Pasta também em «Em andamento»', 'Etiqueta de pasta nos clientes que já estão em atendimento.'],
      ['marcadorRecuperacao', 'Marcador de retomada na fila', 'Bolinha no avatar para marcar clientes sem abrir a conversa.'],
      ['contadorNaAba', 'Contador no título da aba', 'Ex.: (2) CRM quando há sinalizados com mensagem nova.']
    ];
    corpo.innerHTML = `
      <label class="campo"><span>Seu nome (vai na apresentação e na retomada)</span><input class="entrada" id="aj-nome" maxlength="40" placeholder="Ex.: Cleber" value="${esc(cfg.operador)}"></label>
      <div class="secao"><span>Ferramentas</span></div>
      <div class="cartao">${Object.entries(MODULOS).map(([id, m]) => `<label class="opcao"><div><b>${esc(m.nome)}</b><small>${esc(m.desc)}</small></div>${chave(`data-modulo="${id}"`, ligado(id), m.nome)}</label>`).join('')}</div>
      <div class="secao"><span>Informações na tela</span></div>
      <div class="cartao">${VISUAIS.map(([id, nome, desc]) => `<label class="opcao"><div><b>${esc(nome)}</b><small>${esc(desc)}</small></div>${chave(`data-visual="${id}"`, cfg.visual[id], nome)}</label>`).join('')}</div>
      ${COM_TRAVA ? `
      <div class="secao"><span>Trava de setores</span><small>opcional</small></div>
      <div class="cartao">
        <label class="opcao"><div><b>Trava ligada</b><small>No «Sim» de iniciar, cliente de um setor travado é segurado com uma tela vermelha. Vem desligada.</small></div>${chave('id="aj-trava"', cfg.trava.ligada, 'Trava')}</label>
        <div class="opcao" style="flex-direction:column;align-items:stretch;gap:8px"><div><b>Setores travados</b><small>Clique para marcar ou desmarcar. Vale o agendamento recente da qualidade; sem ele, a pasta por onde o cliente entrou.</small></div>
          <div class="fichas">${ORDEM_SETORES.map(id => `<button type="button" class="ficha" data-trava-setor="${id}" aria-pressed="${cfg.trava.setores.includes(id)}">${esc(SETORES[id].nome)}</button>`).join('')}</div>
          ${!cfg.trava.setores.length ? '<div class="dica" style="color:#b45309">Nenhum setor marcado: a trava não segura ninguém.</div>' : ''}</div>
        <div class="opcao"><div><b>Horário</b><small>${!cfg.trava.ligada ? 'Trava desligada.' : trava.valendo() ? 'Valendo agora.' : 'Fora do horário agora.'}</small></div><div class="linha"><input type="time" class="entrada" id="aj-trava-ini" value="${esc(cfg.trava.inicio)}" style="width:110px;height:30px"><small>às</small><input type="time" class="entrada" id="aj-trava-fim" value="${esc(cfg.trava.fim)}" style="width:110px;height:30px"></div></div>
      </div>` : ''}
      ${false ? `
      <div class="secao"><span>Setores e descontos</span></div>
      <div class="dica" style="margin-top:-6px">Ordem do setor: agendamento recente no «Setor de qualidade» → «Setor Vinculado» → faixa de dias em atraso.</div>
      <div class="cartao">
        <div class="setor-cfg"><div class="dias">Agendamento da qualidade vale por <input class="entrada" type="number" min="1" max="365" id="aj-dias-qual" value="${cfg.calc.diasQualidade}"> dias</div></div>
        ${ORDEM_SETORES.map(id => {
          const s = cfg.calc.setores[id];
          return `<div class="setor-cfg ${s.ativo ? '' : 'desligado'}">
            <div class="linha entre"><b>${esc(SETORES[id].nome)}</b>${chave(`data-ativo="${id}"`, s.ativo, 'Usar ' + SETORES[id].nome)}</div>
            ${s.ativo ? `<div class="dias">Atraso de <input class="entrada" type="number" min="0" data-dias="${id}:diasMin" value="${s.diasMin}"> a <input class="entrada" type="number" min="0" data-dias="${id}:diasMax" value="${s.diasMax}"> dias</div>
              <div class="descontos">${SETORES[id].descontos.map(k => `<label class="desc">${esc(NOMES_DESCONTO[k])}<input inputmode="decimal" data-aj-desc="${id}:${k}" value="${s.descontos[k] ?? 0}">%</label>`).join('')}</div>` : ''}
          </div>`;
        }).join('')}
      </div>` : ''}
      ${ligado('cronometro') ? `
      <div class="secao"><span>Contagem por cliente</span></div>
      <div class="cartao">
        <label class="opcao"><div><b>Contagem automática</b><small>Começa na primeira mensagem enviada ao cliente.</small></div>${chave('id="aj-crono-auto"', cfg.crono.auto, 'Contagem automática')}</label>
        <div class="opcao"><div><b>Tempo da contagem</b><small>Duração e aviso antes do fim.</small></div><div class="linha"><input type="number" class="entrada" id="aj-crono" min="1" max="600" value="${cfg.crono.minutos}" style="width:64px;height:30px;text-align:center"><small>min · alerta</small><input type="number" class="entrada" id="aj-crono-alerta" min="0" max="60" value="${cfg.crono.alertaMin}" style="width:56px;height:30px;text-align:center"></div></div>
      </div>` : ''}
      <div class="linha" style="justify-content:center"><button type="button" class="bt pequeno" id="aj-tutorial">${icone('mestre', 14)}Ver o tutorial</button><button type="button" class="bt pequeno" id="aj-aviso">${icone('alerta', 14)}Rever o aviso</button></div>
      <div class="linha" style="justify-content:center"><button type="button" class="bt pequeno perigo" id="aj-reset">Restaurar ajustes (mantém mensagens e imagem)</button></div>
      <div class="versao">ChatPlay Mestre Cofen ${VERSAO}${COM_TRAVA && cfg.trava.ligada ? ' · trava ligada' : ''} · Alt+C abre e fecha</div>`;

    corpo.querySelector('#aj-nome').addEventListener('input', e => { cfg.operador = e.target.value.trim(); salvarCfg(); });
    corpo.querySelectorAll('[data-modulo]').forEach(c => c.addEventListener('change', () => {
      cfg.modulos[c.dataset.modulo] = c.checked;
      salvarCfg(true);
      aplicarModulos();
      desenharAbas();
      desenhar();
    }));
    corpo.querySelectorAll('[data-visual]').forEach(c => c.addEventListener('change', () => {
      cfg.visual[c.dataset.visual] = c.checked;
      salvarCfg(true);
      aplicarModulos();
    }));
    corpo.querySelector('#aj-trava')?.addEventListener('change', e => { cfg.trava.ligada = e.target.checked; salvarCfg(true); setorFila.desenhar(); desenhar(); });
    corpo.querySelectorAll('[data-trava-setor]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.travaSetor;
      cfg.trava.setores = cfg.trava.setores.includes(id) ? cfg.trava.setores.filter(x => x !== id) : [...cfg.trava.setores, id];
      salvarCfg(true);
      setorFila.desenhar();
      desenhar();
    }));
    corpo.querySelector('#aj-trava-ini')?.addEventListener('change', e => { cfg.trava.inicio = e.target.value || '07:00'; salvarCfg(); });
    corpo.querySelector('#aj-trava-fim')?.addEventListener('change', e => { cfg.trava.fim = e.target.value || '17:00'; salvarCfg(); });
    corpo.querySelectorAll('[data-ativo]').forEach(c => c.addEventListener('change', () => {
      cfg.calc.setores[c.dataset.ativo].ativo = c.checked;
      salvarCfg();
      if (!ui.setorManual) ui.setor = detectarSetor();
      desenhar();
    }));
    corpo.querySelectorAll('[data-dias]').forEach(inp => inp.addEventListener('input', () => {
      const [id, k] = inp.dataset.dias.split(':');
      cfg.calc.setores[id][k] = Math.max(0, parseInt(inp.value || '0', 10) || 0);
      salvarCfg();
    }));
    corpo.querySelectorAll('[data-aj-desc]').forEach(inp => {
      inp.addEventListener('input', () => {
        const [id, k] = inp.dataset.ajDesc.split(':');
        const v = parseFloat(inp.value.replace(',', '.'));
        cfg.calc.setores[id].descontos[k] = Number.isFinite(v) ? Math.min(Math.max(v, 0), 100) : 0;
        salvarCfg();
      });
      inp.addEventListener('focus', () => inp.select());
    });
    corpo.querySelector('#aj-dias-qual')?.addEventListener('input', e => {
      cfg.calc.diasQualidade = Math.min(365, Math.max(1, parseInt(e.target.value || '30', 10) || 30));
      salvarCfg();
      cacheClientes.clear();
    });
    corpo.querySelector('#aj-crono-auto')?.addEventListener('change', e => { cfg.crono.auto = e.target.checked; salvarCfg(); });
    corpo.querySelector('#aj-crono')?.addEventListener('input', e => { cfg.crono.minutos = Math.max(1, parseInt(e.target.value || '60', 10) || 60); salvarCfg(); });
    corpo.querySelector('#aj-crono-alerta')?.addEventListener('input', e => { cfg.crono.alertaMin = Math.max(0, parseInt(e.target.value || '0', 10) || 0); salvarCfg(); });
    corpo.querySelector('#aj-tutorial').addEventListener('click', () => boasVindas.tutorial());
    corpo.querySelector('#aj-aviso').addEventListener('click', () => boasVindas.aviso(true));
    corpo.querySelector('#aj-reset').addEventListener('click', async () => {
      if (!await confirmar('Restaurar módulos, setores, descontos e opções? Suas mensagens e a imagem de fundo ficam.', 'Restaurar')) return;
      const novo = cfgPadrao();
      Object.assign(cfg, { ...novo, operador: cfg.operador, modelos: cfg.modelos, modeloPadrao: cfg.modeloPadrao, rec: { ...novo.rec, selecionados: cfg.rec.selecionados } });
      salvarCfg(true);
      ui.setorManual = false;
      ui.setor = detectarSetor();
      aplicarModulos();
      desenharAbas();
      desenhar();
      aviso('Ajustes restaurados.');
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 7b. BOAS-VINDAS — aviso único e tutorial
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Aviso: aparece UMA vez por computador (fica no Tampermonkey deste navegador),
  // no meio da tela, e o botão só libera depois de 5 s com a aba à vista.
  // Tutorial: tour opcional que acende cada parte da tela. É oferecido num card
  // no painel na primeira vez que ele abre, e pode ser revisto em Ajustes.
  // As animações são do próprio Mestre (shadow DOM, transform e opacidade): rodam
  // mesmo com os «efeitos de animação» do Windows desligados.

  const CHAVE_AVISO = 'mestre.aviso.v2';
  const CHAVE_TUTORIAL = 'mestre.tutorial.v1';

  const CSS_BOAS_VINDAS = `
:host{all:initial}
*{box-sizing:border-box}
:host{font-family:inherit;color:var(--texto);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;
  --pri:#008bcb;--fundo:#ffffff;--texto:#0f172a;--suave:#5b6b80;--borda:#e2e8f0;--item:#f3f8fc;--verde-fundo:#ecfdf3;--verde-borda:#a7f3c8;--verde-texto:#047857}
:host([data-tema=escuro]){--pri:#0ea5e9;--fundo:#0f172a;--texto:#e5edf6;--suave:#94a3b8;--borda:#1e2b3f;--item:#14223a;--verde-fundo:#0b2a1f;--verde-borda:#14532d;--verde-texto:#4ade80}
button{font:inherit;cursor:pointer}
svg{flex:none;display:block}

/* ── aviso ── */
.veu{position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;padding:16px;background:rgba(2,6,23,.58);backdrop-filter:blur(3px)}
.cartao{position:relative;width:min(480px,100%);max-height:calc(100vh - 32px);overflow-y:auto;scrollbar-width:thin;border-radius:24px;background:var(--fundo);border:1px solid var(--borda);
  box-shadow:0 30px 80px -20px rgba(2,6,23,.55)}
.faixa{position:relative;height:118px;overflow:hidden;background:linear-gradient(135deg,#00507a,var(--pri) 55%,#06b6d4)}
.faixa i{position:absolute;width:220px;height:220px;border-radius:50%;filter:blur(28px);opacity:.55;will-change:transform}
.faixa i:nth-child(1){left:-60px;top:-90px;background:#22d3ee;animation:flutuar1 9s ease-in-out infinite}
.faixa i:nth-child(2){right:-70px;top:-60px;background:#818cf8;animation:flutuar2 11s ease-in-out infinite}
.faixa i:nth-child(3){left:35%;top:40px;background:#38bdf8;animation:flutuar1 13s ease-in-out infinite reverse}
.selo{position:absolute;left:50%;top:84px;z-index:1;width:68px;height:68px;margin-left:-34px;border-radius:22px;display:grid;place-items:center;color:#fff;
  background:linear-gradient(135deg,var(--pri),#06b6d4);box-shadow:0 0 0 6px var(--fundo),0 12px 24px -8px rgba(0,139,203,.7);animation:boiar 3.6s ease-in-out infinite}
.selo::after{content:'';position:absolute;inset:-6px;border-radius:26px;border:2px solid var(--pri);opacity:0;animation:onda 2.4s ease-out infinite}
.miolo{padding:50px 26px 22px;text-align:center}
.miolo h2{margin:0;font-size:19px;line-height:26px;font-weight:700;color:var(--texto)}
.miolo .sub{margin:4px 0 18px;font-size:13px;color:var(--suave)}
.itens{display:flex;flex-direction:column;gap:10px;text-align:left}
.item{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:14px;border:1px solid var(--borda);
  background:var(--item);opacity:0;animation:entrar .5s cubic-bezier(.2,.8,.2,1) forwards}
.item:nth-child(1){animation-delay:.35s}.item:nth-child(2){animation-delay:.55s}.item:nth-child(3){animation-delay:.75s}
.item b{display:block;font-size:14px;line-height:19px;color:var(--texto)}
.item small{display:block;font-size:12.5px;line-height:17px;color:var(--suave);margin-top:2px}
.ic{width:34px;height:34px;flex:none;border-radius:11px;display:grid;place-items:center;color:#fff}
.ic.a{background:#0ea5e9}.ic.b{background:#f59e0b}.ic.c{background:#10b981}.ic.d{background:#16a34a}
.oficial{display:flex;gap:12px;align-items:flex-start;margin:0 0 12px;padding:12px 14px;border-radius:14px;text-align:left;
  background:var(--verde-fundo);border:1px solid var(--verde-borda);opacity:0;animation:entrar .5s cubic-bezier(.2,.8,.2,1) .1s forwards}
.oficial b{display:block;font-size:14px;line-height:19px;color:var(--verde-texto)}
.oficial small{display:block;font-size:12.5px;line-height:17px;color:var(--texto);margin-top:2px}
.oficial small b{display:inline;font-size:inherit;color:inherit}
.pe{padding:0 26px 24px}
.ok{position:relative;width:100%;height:46px;border:0;border-radius:14px;font-size:14px;font-weight:600;color:#fff;background:var(--pri);overflow:hidden;
  display:flex;align-items:center;justify-content:center;gap:10px;transition:filter .2s,transform .15s}
.ok:disabled{cursor:not-allowed;background:color-mix(in srgb,var(--suave) 35%,var(--fundo));color:var(--suave)}
.ok:not(:disabled):hover{filter:brightness(1.08)}
.ok:focus{outline:none}
.ok:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb,var(--pri) 35%,transparent)}
.ok:not(:disabled):active{transform:scale(.98)}
.ok .barra{position:absolute;left:0;bottom:0;height:3px;width:100%;background:var(--pri);transform-origin:left;transform:scaleX(0)}
.ok.livre{animation:liberar .45s cubic-bezier(.2,.8,.2,1)}
.anel{width:22px;height:22px}
.anel circle{fill:none;stroke-width:3}
.anel .t{stroke:currentColor;opacity:.25}
.anel .p{stroke:currentColor;stroke-linecap:round;transform:rotate(-90deg);transform-origin:center}
@keyframes flutuar1{50%{transform:translate(40px,22px) scale(1.12)}}
@keyframes flutuar2{50%{transform:translate(-36px,26px) scale(.9)}}
@keyframes boiar{50%{transform:translateY(-5px)}}
@keyframes onda{0%{opacity:.6;transform:scale(1)}100%{opacity:0;transform:scale(1.35)}}
@keyframes entrar{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes liberar{40%{transform:scale(1.04)}}

/* ── tutorial ── */
.guia{position:fixed;inset:0;z-index:2147483600}
.foco{position:fixed;border-radius:14px;pointer-events:none;box-shadow:0 0 0 200vmax rgba(2,6,23,.62);
  transition:top .45s cubic-bezier(.32,.72,0,1),left .45s cubic-bezier(.32,.72,0,1),width .45s cubic-bezier(.32,.72,0,1),height .45s cubic-bezier(.32,.72,0,1),border-radius .45s}
.foco::after{content:'';position:absolute;inset:-4px;border-radius:inherit;border:2px solid #38bdf8;animation:piscar 1.8s ease-in-out infinite}
.foco.vazio::after{display:none}
.dica-guia{position:fixed;width:min(340px,calc(100vw - 24px));padding:18px 18px 14px;border-radius:18px;background:var(--fundo);border:1px solid var(--borda);
  box-shadow:0 24px 60px -16px rgba(2,6,23,.5);transition:top .45s cubic-bezier(.32,.72,0,1),left .45s cubic-bezier(.32,.72,0,1)}
.dica-guia.larga{width:min(560px,calc(100vw - 24px))}
.dica-guia .passo{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--pri)}
.dica-guia h3{margin:4px 0 6px;font-size:16px;line-height:22px;color:var(--texto)}
.dica-guia p{margin:0;font-size:13.5px;line-height:20px;color:var(--suave)}
.dica-guia p b{color:var(--texto)}
.dica-guia .obs{margin-top:8px;font-size:12px;color:#b45309}
.conteudo{animation:entrar .35s cubic-bezier(.2,.8,.2,1)}
.pontos{display:flex;gap:5px;margin-top:14px}
.pontos i{height:6px;width:6px;border-radius:99px;background:var(--borda);transition:width .3s,background .3s}
.pontos i.ag{width:18px;background:var(--pri)}
.acoes{display:flex;align-items:center;gap:8px;margin-top:12px}
.acoes .pular{margin-right:auto;border:0;background:none;color:var(--suave);font-size:12.5px;padding:6px 2px}
.acoes .bt{height:34px;padding:0 14px;border-radius:10px;border:1px solid var(--borda);background:var(--fundo);color:var(--texto);font-size:13px;font-weight:600}
.acoes .bt.pri{background:var(--pri);border-color:var(--pri);color:#fff}
@keyframes piscar{50%{opacity:.35}}

/* ── nova versão ── */
.nova{position:fixed;right:18px;bottom:18px;z-index:2147483590;width:min(360px,calc(100vw - 36px));padding:16px;border-radius:18px;
  background:var(--fundo);border:1px solid var(--borda);box-shadow:0 24px 60px -16px rgba(2,6,23,.5);overflow:hidden}
.nova::before{content:'';position:absolute;inset:0 0 auto 0;height:3px;background:linear-gradient(90deg,var(--pri),#06b6d4,#818cf8,var(--pri));
  background-size:200% 100%;animation:correr 2.4s linear infinite}
.nova .topo-n{display:flex;gap:12px;align-items:flex-start}
.nova .ic-n{position:relative;width:40px;height:40px;flex:none;border-radius:13px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,var(--pri),#06b6d4)}
.nova .ic-n svg{animation:girar-n 2.6s cubic-bezier(.6,0,.4,1) infinite}
.nova .ic-n::after{content:'';position:absolute;inset:-5px;border-radius:17px;border:2px solid var(--pri);opacity:0;animation:onda 2.4s ease-out infinite}
.nova b{display:block;font-size:14px;line-height:19px;color:var(--texto)}
.nova small{display:block;font-size:12.5px;line-height:17px;color:var(--suave);margin-top:2px}
.nova small b{display:inline;font-size:inherit;color:var(--texto)}
.nova .acoes-n{display:flex;gap:8px;margin-top:14px}
.nova .acoes-n button{flex:1;height:36px;border-radius:11px;border:1px solid var(--borda);background:var(--fundo);color:var(--texto);font-size:13px;font-weight:600}
.nova .acoes-n button.pri{background:var(--pri);border-color:var(--pri);color:#fff}
.nova .acoes-n button:hover{filter:brightness(1.06)}
.nova ol{margin:10px 0 0;padding-left:18px;font-size:12.5px;line-height:18px;color:var(--texto)}
@keyframes correr{to{background-position:-200% 0}}
@keyframes girar-n{0%,60%{transform:rotate(0)}100%{transform:rotate(360deg)}}
`;

  const boasVindas = (() => {
    let host = null, raizBV = null;

    function montarHost() {
      if (host) return;
      host = document.createElement('div');
      host.id = 'mestre-boas-vindas';
      host.className = NOSSO;
      raizBV = host.attachShadow({ mode: 'open' });
      raizBV.innerHTML = `<style>${CSS_BOAS_VINDAS}</style>`;
      host.dataset.tema = tema.atual;
      ponte.on('tema', t => { if (host) host.dataset.tema = t; });
      // O ChatPlay tem atalhos de teclado: o que acontece aqui não sai daqui
      for (const t of ['keydown', 'keyup', 'keypress']) host.addEventListener(t, e => e.stopPropagation());
      document.body.appendChild(host);
    }
    const sair = (el, depois) => {
      const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
      a.onfinish = () => { el.remove(); depois?.(); };
    };

    // ── aviso único ──
    function aviso(forcar = false) {
      if (!forcar && GM_getValue(CHAVE_AVISO, null)) return Promise.resolve();
      montarHost();
      return new Promise(fim => {
        const SEGUNDOS = 5;
        const R = 9, VOLTA = 2 * Math.PI * R;
        const veu = document.createElement('div');
        veu.className = 'veu';
        veu.innerHTML = `
          <div class="cartao" role="alertdialog" aria-modal="true" aria-labelledby="bv-titulo">
            <div class="faixa"><i></i><i></i><i></i></div><div class="selo">${icone('alerta', 30)}</div>
            <div class="miolo">
              <h2 id="bv-titulo">Aviso sobre a extensão ChatPlay Mestre</h2>
              <p class="sub">Leva 10 segundos. É importante.</p>
              <div class="oficial"><span class="ic d">${icone('escudo', 18)}</span><div><b>O ChatPlay novo é oficial</b><small>A nova versão do ChatPlay, dentro do CRM, foi feita pela TI. <b>Este aviso não é sobre ela.</b> É só sobre a extensão ChatPlay Mestre: ${EH_COFEN ? 'o painel extra com a apresentação automática, os avisos de sinalizados e o papel de parede' : 'o painel extra com a calculadora, a abordagem, os avisos de sinalizados e o papel de parede'}.</small></div></div>
              <div class="itens">
                <div class="item"><span class="ic a">${icone('usuario', 18)}</span><div><b>A extensão não foi feita pela TI</b><small>O ChatPlay Mestre foi criado por pessoas que buscam resolver problemas e otimizar tempo. Ele é instalado à parte, no Tampermonkey.</small></div></div>
                <div class="item"><span class="ic b">${icone('alerta', 18)}</span><div><b>A extensão pode sair do ar a qualquer momento</b><small>Sem aviso prévio. Se ela sumir ou parar de funcionar, o ChatPlay continua funcionando normalmente.</small></div></div>
                <div class="item"><span class="ic c">${icone('check', 18)}</span><div><b>Confira antes de enviar</b><small>A extensão ajuda, mas quem envia é você. Se algo parecer errado, desligue o ChatPlay Mestre no Tampermonkey.</small></div></div>
              </div>
            </div>
            <div class="pe"><button type="button" class="ok" disabled>
              <svg class="anel" viewBox="0 0 24 24"><circle class="t" cx="12" cy="12" r="${R}"/><circle class="p" cx="12" cy="12" r="${R}" stroke-dasharray="${VOLTA.toFixed(2)}" stroke-dashoffset="0"/></svg>
              <span class="rot">Leia o aviso · ${SEGUNDOS}s</span><span class="barra"></span></button></div>
          </div>`;
        raizBV.appendChild(veu);
        const cartao = veu.querySelector('.cartao');
        const ok = veu.querySelector('.ok');
        const rot = veu.querySelector('.rot');
        const prog = veu.querySelector('.anel .p');
        const barra = veu.querySelector('.barra');
        veu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' });
        cartao.animate([{ opacity: 0, transform: 'translateY(24px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.9,.25,1.05)' });

        // Conta só com a aba à vista: quem troca de aba não «lê» o aviso
        let lido = 0, antes = performance.now(), quadro = 0;
        const passo = agora => {
          if (!document.hidden) lido += Math.min(agora - antes, 250);
          antes = agora;
          const fracao = Math.min(1, lido / (SEGUNDOS * 1000));
          prog.setAttribute('stroke-dashoffset', (VOLTA * fracao).toFixed(2));
          barra.style.transform = `scaleX(${fracao})`;
          const resta = Math.ceil(SEGUNDOS - lido / 1000);
          if (fracao < 1) {
            const t = `Leia o aviso · ${resta}s`;
            if (rot.textContent !== t) rot.textContent = t;
            quadro = requestAnimationFrame(passo);
            return;
          }
          ok.disabled = false;
          ok.classList.add('livre');
          ok.querySelector('.anel').remove();
          barra.remove();
          rot.textContent = 'Li e entendi';
          ok.focus();
        };
        quadro = requestAnimationFrame(passo);
        ok.addEventListener('click', () => {
          if (ok.disabled) return;
          cancelAnimationFrame(quadro);
          GM_setValue(CHAVE_AVISO, { em: Date.now(), versao: VERSAO });
          cartao.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(12px) scale(.97)', opacity: 0 }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
          sair(veu, fim);
        });
      });
    }

    // ── tutorial ──
    const passos = () => {
      return [
        { titulo: 'Bem-vindo ao ChatPlay Mestre', texto: 'Um tour rápido de 1 minuto para você saber onde fica cada coisa. Dá para sair quando quiser.', largo: false },
        {
          alvo: () => primeiroVisivel('.mst-cab-btn'), lado: 'baixo',
          titulo: 'O botão do Mestre', texto: 'Fica no topo da conversa, ao lado da lupa. Abre e fecha o painel. Atalho: <b>Alt + C</b>.',
          semAlvo: 'Ele aparece quando você abre uma conversa.'
        },
        EH_COFEN ? {
          alvo: () => primeiroVisivel('.mst-compor'), lado: 'cima',
          titulo: 'Gerar a mensagem na hora', texto: 'O botão ✨ ao lado das mensagens rápidas coloca no campo a <b>apresentação do Coren</b> ou, sem vínculo, o <b>pedido de CPF</b>. Nada é enviado sozinho.',
          semAlvo: 'Ele aparece no campo de mensagem quando uma conversa está aberta.'
        } : {
          alvo: () => primeiroVisivel('.mst-compor'), lado: 'cima',
          titulo: 'A calculadora', texto: 'Ao lado das mensagens rápidas. Abre a <b>Proposta</b> com os valores do cliente aberto e a mensagem pronta.',
          semAlvo: 'Ela aparece no campo de mensagem quando uma conversa está aberta.'
        },
        {
          alvo: () => primeiroVisivel('[data-index] > div > div[role="button"]'), lado: 'direita',
          titulo: 'Na fila de clientes', texto: 'Cada cliente ganha a <b>pasta</b> dele. Passando o mouse aparecem o <b>relógio</b> (contagem de tempo) e a <b>bolinha no avatar</b> (marcar para retomar).'
        },
        {
          antes: () => { if (!ui.aberto) alternar(true); irPara(EH_COFEN ? 'atendimento' : 'proposta'); }, espera: 650,
          alvo: () => raiz?.querySelector('.abas'), lado: 'esquerda',
          titulo: 'As abas do painel', texto: EH_COFEN
            ? '<b>Atendimento</b>: o profissional e a mensagem pronta · <b>Retomar</b>: mensagem em lote para parados · <b>Sinalizados</b>: avisos dos clientes com etiqueta · <b>Mensagens</b>: edite os textos · <b>WallPaper</b>: fundo da conversa.'
            : '<b>Proposta</b>: valores e mensagem · <b>Abordar</b>: apresentação, acordo e quebra · <b>Retomar</b>: mensagem em lote · <b>Sinalizados</b>: avisos dos clientes com etiqueta · <b>Mensagens</b>: edite os textos · <b>WallPaper</b>: fundo da conversa.'
        },
        {
          antes: () => { if (!ui.aberto) alternar(true); irPara(EH_COFEN ? 'atendimento' : 'proposta'); }, espera: 450,
          alvo: () => raiz?.querySelector('.corpo .cartao:not(.convite)'), lado: 'esquerda',
          titulo: 'Os dados do cliente', texto: 'CPF, telefone e protocolo com botão de <b>copiar</b>. Logo abaixo, a última tabulação e o último atendimento.',
          semAlvo: 'Abra uma conversa e o cartão do cliente aparece aqui.'
        },
        {
          antes: () => { if (!ui.aberto) alternar(true); }, espera: 300,
          alvo: () => raiz?.getElementById('bt-ajustes'), lado: 'baixo',
          titulo: 'Seu nome vai aqui', texto: 'Em <b>Ajustes</b>, preencha o seu nome: ele entra na apresentação. Ali também dá para ligar e desligar cada ferramenta e rever este tutorial.'
        },
        {
          antes: () => { if (ui.aberto) alternar(false); }, espera: 450,
          titulo: 'Sinalizados que avisam', texto: 'Sinalize o cliente pela etiqueta, como sempre. Quando ele escrever, mesmo depois de finalizado, aparece um <b>card no canto de baixo</b>, com som e notificação.'
        },
        { titulo: 'Pronto!', texto: 'É isso. Para rever, abra <b>Ajustes</b> no painel e clique em «Ver o tutorial».' }
      ];
    };

    let guia = null;
    function tutorial() {
      montarHost();
      guia?.fechar();
      const lista = passos();
      let i = 0;
      const tela = document.createElement('div');
      tela.className = 'guia';
      tela.innerHTML = '<div class="foco vazio"></div><div class="dica-guia" role="dialog" aria-label="Tutorial do ChatPlay Mestre"></div>';
      raizBV.appendChild(tela);
      const foco = tela.querySelector('.foco');
      const dica = tela.querySelector('.dica-guia');
      tela.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });

      function posicionar(alvo, lado) {
        const W = innerWidth, H = innerHeight, M = 12;
        const r = alvo?.getBoundingClientRect();
        const ok = r && r.width > 0 && r.height > 0;
        const fx = ok ? { left: r.left - 6, top: r.top - 6, width: r.width + 12, height: r.height + 12 } : { left: W / 2, top: H / 2, width: 0, height: 0 };
        Object.assign(foco.style, { left: fx.left + 'px', top: fx.top + 'px', width: fx.width + 'px', height: fx.height + 'px' });
        foco.classList.toggle('vazio', !ok);
        const dw = dica.offsetWidth, dh = dica.offsetHeight;
        let x = (W - dw) / 2, y = (H - dh) / 2;
        if (ok) {
          const pos = {
            baixo: [fx.left + fx.width / 2 - dw / 2, fx.top + fx.height + M],
            cima: [fx.left + fx.width / 2 - dw / 2, fx.top - dh - M],
            direita: [fx.left + fx.width + M, fx.top + fx.height / 2 - dh / 2],
            esquerda: [fx.left - dw - M, fx.top + fx.height / 2 - dh / 2]
          };
          const cabe = ([px, py]) => px >= M && py >= M && px + dw <= W - M && py + dh <= H - M;
          const ordem = [lado, 'baixo', 'cima', 'esquerda', 'direita'].filter(Boolean);
          const escolhido = ordem.map(l => pos[l]).find(cabe) || pos[lado] || pos.baixo;
          [x, y] = escolhido;
        }
        dica.style.left = Math.round(Math.min(Math.max(x, M), W - dw - M)) + 'px';
        dica.style.top = Math.round(Math.min(Math.max(y, M), H - dh - M)) + 'px';
      }

      async function mostrar() {
        const p = lista[i];
        if (p.antes) { tentar(p.antes); await sleep(p.espera || 300); }
        if (!tela.isConnected) return;
        const alvo = p.alvo ? tentar(p.alvo) : null;
        const temAlvo = !!alvo && visivel(alvo);
        dica.classList.toggle('larga', !!p.largo);
        dica.innerHTML = `<div class="conteudo"><div class="passo">${i + 1} de ${lista.length}</div><h3>${esc(p.titulo)}</h3><p>${p.texto}</p>${!temAlvo && p.semAlvo ? `<div class="obs">${esc(p.semAlvo)}</div>` : ''}
          <div class="pontos">${lista.map((_, k) => `<i class="${k === i ? 'ag' : ''}"></i>`).join('')}</div>
          <div class="acoes">${i < lista.length - 1 ? '<button type="button" class="pular">Pular tutorial</button>' : '<span class="pular"></span>'}
            ${i > 0 ? '<button type="button" class="bt" data-ir="-1">Voltar</button>' : ''}
            <button type="button" class="bt pri" data-ir="1">${i === lista.length - 1 ? 'Concluir' : i === 0 ? 'Começar' : 'Próximo'}</button></div></div>`;
        dica.querySelector('.pular')?.addEventListener('click', () => fechar(false));
        dica.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => {
          const novo = i + Number(b.dataset.ir);
          if (novo >= lista.length) return fechar(true);
          i = Math.max(0, novo);
          mostrar();
        }));
        posicionar(temAlvo ? alvo : null, p.lado);
        dica.querySelector('.bt.pri')?.focus();
      }
      function fechar(concluiu) {
        removeEventListener('resize', aoRedimensionar);
        GM_setValue(CHAVE_TUTORIAL, { em: Date.now(), concluiu: !!concluiu });
        sair(tela);
        guia = null;
        ponte.emitir('tutorial');
      }
      const aoRedimensionar = () => { const p = lista[i]; const a = p.alvo ? tentar(p.alvo) : null; posicionar(a && visivel(a) ? a : null, p.lado); };
      addEventListener('resize', aoRedimensionar);
      tela.addEventListener('keydown', e => { if (e.key === 'Escape') fechar(false); });
      guia = { fechar: () => fechar(false) };
      mostrar();
    }

    /** Card no topo do painel, na primeira vez: convida para o tutorial. */
    function cardNoPainel(corpoEl) {
      if (GM_getValue(CHAVE_TUTORIAL, null) || !corpoEl) return;
      const el = document.createElement('div');
      el.className = 'cartao convite';
      el.innerHTML = `<div class="convite-ic">${icone('mestre', 20)}</div><div class="cresce"><b>Primeira vez por aqui?</b><small>Um tour de 1 minuto mostra onde fica cada coisa.</small>
        <div class="linha" style="margin-top:10px"><button type="button" class="bt pequeno primario" data-tour>Ver tutorial</button><button type="button" class="bt pequeno" data-depois>Agora não</button></div></div>`;
      el.querySelector('[data-tour]').addEventListener('click', () => tutorial());
      el.querySelector('[data-depois]').addEventListener('click', () => { GM_setValue(CHAVE_TUTORIAL, { em: Date.now(), concluiu: false }); el.remove(); });
      corpoEl.prepend(el);
    }

    // ── nova versão no GitHub ──
    // O Tampermonkey só confere atualizações 1× por dia. Aqui o próprio Mestre olha o
    // arquivo publicado (ao abrir e a cada 20 min, com a aba à vista) e, se houver versão
    // maior, mostra um card com «Atualizar agora». Usa o fetch da página: o GitHub libera
    // o arquivo para qualquer site e não precisa de permissão nova no Tampermonkey.
    const CH_ATUALIZACAO = 'mestre.atualizacao.' + (EH_COFEN ? 'cofen' : 'bookplay');
    const INTERVALO = 20 * 60000;
    const maior = (a, b) => {
      const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
      for (let k = 0; k < Math.max(x.length, y.length); k++) if ((x[k] || 0) !== (y[k] || 0)) return (x[k] || 0) > (y[k] || 0);
      return false;
    };
    let cardNova = null;
    async function versaoPublicada() {
      // Várias abas e PCs: uma consulta a cada 20 min por navegador basta
      const guardado = LS.ler(CH_ATUALIZACAO, null);
      if (guardado?.em && Date.now() - guardado.em < INTERVALO) return guardado.versao;
      const r = await fetchOriginal.call(PAGINA, URL_ATUALIZACAO, { cache: 'no-store' });
      if (!r.ok) throw new Error('GitHub respondeu ' + r.status);
      const versao = ((await r.text()).match(/@version\s+([\d.]+)/) || [])[1] || null;
      LS.gravar(CH_ATUALIZACAO, { em: Date.now(), versao });
      return versao;
    }
    async function conferirVersao() {
      if (!URL_ATUALIZACAO || document.hidden || cardNova) return;
      let publicada;
      try { publicada = await versaoPublicada(); } catch { return; } // sem internet ou GitHub fora: tenta depois
      if (!publicada || !maior(publicada, VERSAO)) return;
      const depois = LS.ler(CH_ATUALIZACAO + '.depois', null);
      if (depois?.versao === publicada && Date.now() < depois.ate) return;
      mostrarNovaVersao(publicada);
    }
    function mostrarNovaVersao(publicada) {
      montarHost();
      cardNova = document.createElement('div');
      cardNova.className = 'nova';
      cardNova.setAttribute('role', 'status');
      const passo1 = () => {
        cardNova.innerHTML = `<div class="topo-n"><span class="ic-n">${icone('atualizar', 20)}</span><div><b>Nova versão do ChatPlay Mestre</b>
          <small>Versão <b>${esc(publicada)}</b> disponível. Você está na ${esc(VERSAO)}. Leva 10 segundos.</small></div></div>
          <div class="acoes-n"><button type="button" data-depois>Depois</button><button type="button" class="pri" data-atualizar>Atualizar agora</button></div>`;
        cardNova.querySelector('[data-depois]').addEventListener('click', () => {
          LS.gravar(CH_ATUALIZACAO + '.depois', { versao: publicada, ate: Date.now() + 2 * 3600000 }); // volta a lembrar em 2 h
          fecharNova();
        });
        cardNova.querySelector('[data-atualizar]').addEventListener('click', () => {
          // O Tampermonkey abre a tela de atualização quando a aba nova carrega o .user.js
          PAGINA.open(URL_ATUALIZACAO, '_blank');
          passo2();
        });
      };
      const passo2 = () => {
        cardNova.innerHTML = `<div class="topo-n"><span class="ic-n">${icone('atualizar', 20)}</span><div><b>Quase lá</b>
          <ol><li>Na aba que abriu, clique em <b>Atualizar</b> (ou <b>Reinstalar</b>).</li><li>Volte aqui e clique em <b>Recarregar</b>.</li></ol></div></div>
          <div class="acoes-n"><button type="button" data-fechar>Fechar</button><button type="button" class="pri" data-recarregar>Recarregar</button></div>`;
        cardNova.querySelector('[data-fechar]').addEventListener('click', fecharNova);
        cardNova.querySelector('[data-recarregar]').addEventListener('click', () => PAGINA.location.reload());
      };
      passo1();
      raizBV.appendChild(cardNova);
      cardNova.animate([{ opacity: 0, transform: 'translateY(16px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.9,.25,1.05)' });
    }
    function fecharNova() {
      if (!cardNova) return;
      const el = cardNova;
      cardNova = null;
      el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(12px)' }], { duration: 200, easing: 'ease-in', fill: 'forwards' }).onfinish = () => el.remove();
    }

    function iniciar() {
      // Espera a tela do ChatPlay assentar; o aviso vem antes de qualquer outra coisa,
      // e só depois dele o card de versão nova
      setTimeout(() => aviso().then(() => {
        conferirVersao();
        setInterval(conferirVersao, 5 * 60000); // a consulta de verdade só sai a cada 20 min (cache acima)
        document.addEventListener('visibilitychange', () => { if (!document.hidden) conferirVersao(); });
      }), 1200);
    }
    return { iniciar, aviso, tutorial, cardNoPainel, conferirVersao };
  })();

  // ═══════════════════════════════════════════════════════════════════════
  // 8. INÍCIO
  // ═══════════════════════════════════════════════════════════════════════

  const DESLIGAVEIS = { identificador: setorFila, vinculo: cabecalhoVinculo, cronometro, sinalizados, recuperacao };

  /** Liga/desliga o que aparece na página conforme Ajustes. */
  function aplicarModulos() {
    estilo('mst-pagina', cssDaPagina());
    for (const [id, mod] of Object.entries(DESLIGAVEIS)) {
      if (ligado(id)) tentar(() => (mod.desenhar || mod.desenharMarcadores)?.call(mod));
      else tentar(() => mod.desligar?.());
    }
    if (ligado('recuperacao')) recuperacao.desenharMarcadores();
    else recuperacao.desligar();
    if (!cfg.visual.marcadorRecuperacao) recuperacao.desligar();
    setorFila.desligar();
    setorFila.desenhar();
    papel.aplicar();
    botoesNaTela();
    desenharCards();
  }

  /** Versões antigas do Mestre (chatplay.com.br) não rodam aqui, mas outros scripts podem. */
  function avisarDuplicado() {
    if (document.querySelectorAll('#chatplay-mestre').length > 1) aviso('Há dois Mestres ligados no Tampermonkey: deixe só o ChatPlay Mestre Cofen.', 'erro');
  }

  let montado = false;
  function montarNaTelaDoChat() {
    if (montado || !/^\/chatplay(?:\/|$)/.test(location.pathname) || !document.body) return;
    montado = true;
    tema.iniciar();
    estilo('mst-pagina', cssDaPagina());
    montarPainel();
    iniciarObservador();
    setorFila.iniciar();
    cronometro.iniciar();
    sinalizados.iniciar();
    papel.iniciar();
    abordagem.iniciar();
    cabecalhoVinculo.iniciar();
    recuperacao.iniciar();
    trava.iniciar();
    aoMudarPagina('botoes', botoesNaTela);
    aoMudarPagina('espaco', () => espaco.manter());
    PAGINA.addEventListener('resize', () => agendarCiclo(120));
    aplicarModulos();
    quemSouEu().then(carregarPastas, () => {});

    // Trocou de conversa: com o painel aberto, os dados acompanham; fechado, nada é buscado
    ponte.on('atendimento', () => {
      ui.confirmandoEnvio = false;
      if (precisaDoCliente() && ui.aberto) buscar();
      else desenhar();
    });
    // Listas que mudam sozinhas: redesenha a aba, mas nunca no meio da digitação
    const redesenharSe = aba => () => {
      desenharAbas();
      if (!painelAberto(aba)) return;
      const foco = raiz.activeElement;
      if (foco && /^(INPUT|TEXTAREA|SELECT)$/.test(foco.tagName)) return;
      const rolagem = corpo.scrollTop;
      desenhar();
      corpo.scrollTop = rolagem;
    };
    ponte.on('recuperacao', redesenharSe('recuperacao'));
    ponte.on('pastas', () => { if (painelAberto('recuperacao')) desenhar(); });
    ponte.on('sinalizados', () => { desenharCards(); redesenharSe('sinalizados')(); });
    ponte.on('tema', () => { if (painelAberto('aparencia')) desenhar(); });
    ponte.on('tutorial', () => { raiz.querySelector('.convite')?.remove(); if (ui.aberto) desenhar(); });
    boasVindas.iniciar();
    ponte.on('abordagem-colocada', () => { if (painelAberto('atendimento')) buscar(); });

    setTimeout(avisarDuplicado, 5000);
    // Depuração: com localStorage «mestre.debug» = 1, dá para simular eventos no console
    if (LS.ler('mestre.debug', 0) === 1) PAGINA.__mestreTeste = { emitir: (...a) => ponte.emitir(...a), sinalizados, cfg };
    console.log(`[ChatPlay Mestre] ${VERSAO} ${NOME_CARTEIRA}${COM_TRAVA && cfg.trava.ligada ? ' (trava de setores ligada)' : ''} ativo.`);
  }

  // O CRM troca de tela sem recarregar (login → main → chatplay): confere a rota.
  setInterval(montarNaTelaDoChat, 1000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarNaTelaDoChat, { once: true });
  else montarNaTelaDoChat();
})();
