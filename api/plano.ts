// ─────────────────────────────────────────────────────────────────────────────
//  O assistente de plano de estudos, com o Claude.
//
//  POST /api/plano   { etapa: 'perguntar' | 'conteudo' | 'montar' | 'analise', respostas, arquivos, acervo, conversa, desempenho }
//
//  Duas etapas, e não uma: antes de montar qualquer coisa, o Claude lê o que a
//  pessoa anexou e pergunta só o que muda o plano. Montar direto das primeiras
//  respostas dava um plano grande e genérico, e corrigir depois custa mais do
//  que perguntar antes.
//
//  O Claude não escreve as sessões dia a dia. Ele devolve a estratégia: os
//  tópicos com peso, a divisão das fases, quantas sessões cabem num dia e o
//  porquê. Quem transforma isso em datas é a tela, com as mesmas regras de
//  sempre. Assim a resposta é curta, sai rápido e não inventa calendário.
//
//  A chave mora só aqui, no servidor. O Claude (`ANTHROPIC_API_KEY`) é o
//  primeiro; o Gemini (`GEMINI_API_KEY`) entra quando não há chave do Claude,
//  ou quando o Claude falha por chave, limite ou queda. Os dois respondem no
//  mesmo esquema, então a tela não sabe quem respondeu.
// ─────────────────────────────────────────────────────────────────────────────
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { perguntar as perguntarIA, responderErro, semTravessao, temChave, texto, type Arquivo, type Material } from './_ia';

/* O corpo de uma função da Vercel para em 4,5 MB, e os arquivos chegam em
   base64, que é um terço maior que o original. O teto deixa folga para o
   resto do pedido; passar dele vira um recado, e não um erro sem causa. */
const TETO_ARQUIVOS = 3.3 * 1024 * 1024;
/* O texto do acervo vai junto como contexto, mas não o acervo inteiro: o que
   passa disso é cortado na tela, e o Claude é avisado do corte. */
const TETO_ACERVO = 120_000;

type Troca = { pergunta: string; resposta: string };

const Nivel = z.enum(['fraco', 'medio', 'forte']);

const Leitura = z.object({
  leitura: z.string().describe('De duas a quatro frases, em segunda pessoa, sobre o que você entendeu do estudo a partir das respostas e dos arquivos. Cite o que achou nos arquivos.'),
  topicos: z.array(z.object({
    nome: z.string().describe('Nome curto do tópico, como um título de capítulo.'),
    nivel: Nivel.describe('O domínio provável da pessoa nesse tópico. Sem pista, "medio".'),
  })).describe('Os tópicos do estudo, no máximo 12, na ordem em que faz sentido estudar.'),
  perguntas: z.array(z.object({
    pergunta: z.string().describe('Uma pergunta curta e específica, que cita o item dos arquivos ou das respostas a que se refere.'),
    porque: z.string().describe('Meia frase dizendo o que a resposta muda no plano.'),
    tipo: z.enum(['escolha', 'varias', 'texto']),
    opcoes: z.array(z.string()).describe('De 2 a 4 opções curtas para "escolha" e "varias". Vazio para "texto".'),
  })).describe('No máximo 4 perguntas. Nenhuma se nada mudaria o plano.'),
});

/* A lista de conteúdo: o que entra no plano, já cruzado entre as fontes. Um
   assunto que aparece no edital, numa pasta e numa prova vira um tópico só,
   e a origem diz de onde ele veio. */
const Conteudo = z.object({
  topicos: z.array(z.object({
    nome: z.string().describe('Nome curto do tópico, como um título de capítulo. Ex.: "Cardiologia".'),
    nivel: Nivel.describe('O domínio provável da pessoa. Use as provas feitas e o que já está no acervo como pista; sem pista, "medio".'),
    origem: z.string().describe('De onde o tópico veio, curto, citando as fontes. Ex.: "Edital e pasta Clínica".'),
    subtopicos: z.array(z.string()).describe('De 2 a 8 subtópicos concretos, curtos, na ordem de estudo. Ex.: "Insuficiência cardíaca".'),
  })).describe('Os tópicos do estudo, no máximo 15, na ordem em que faz sentido estudar.'),
});

const Estrategia = z.object({
  resumo: z.string().describe('Uma ou duas frases sobre a estratégia do plano.'),
  topicos: z.array(z.object({
    nome: z.string(),
    nivel: Nivel,
    peso: z.number().describe('De 1 a 5: quanto tempo o tópico merece em relação aos outros.'),
    motivo: z.string().describe('Meia frase: por que esse peso.'),
  })),
  fases: z.object({
    base: z.number().describe('Porcentagem dos dias para ver a teoria de todos os tópicos.'),
    aprofundamento: z.number().describe('Porcentagem dos dias de prática e retorno ao que está fraco.'),
    final: z.number().describe('Porcentagem dos dias de reta final, sem conteúdo novo.'),
  }),
  sessoesPorDia: z.number().describe('1 ou 2. Use 2 só se o tempo diário passar de 2 horas e houver dois períodos.'),
  notas: z.array(z.string()).describe('De 2 a 5 frases curtas explicando as escolhas do plano, ligadas ao que a pessoa disse.'),
});

/* A análise do andamento: com o plano em curso, a IA lê o desempenho por
   tópico e subtópico (questões, flashcards, sessões e o que a pessoa marcou
   como visto) e diz onde ela está forte e onde está fraca. */
const Situacao = z.enum(['forte', 'estavel', 'atencao', 'critico', 'sem_dados']);
const Analise = z.object({
  resumo: z.string().describe('De duas a três frases, em segunda pessoa, sobre o momento do estudo: o que vai bem, o que preocupa e por onde seguir.'),
  topicos: z.array(z.object({
    nome: z.string().describe('O nome do tópico exatamente como veio no desempenho.'),
    situacao: Situacao.describe('"sem_dados" quando não há questões nem cards respondidos no tópico.'),
    fortes: z.array(z.string()).describe('De 0 a 3 pontos fortes concretos, curtos, citando subtópicos ou números.'),
    fracos: z.array(z.string()).describe('De 0 a 3 pontos fracos concretos, curtos, citando subtópicos, números ou o tipo de questão errada.'),
    proximoPasso: z.string().describe('Uma frase com a próxima ação, prática e específica.'),
    subtopicos: z.array(z.object({
      nome: z.string().describe('O nome do subtópico exatamente como veio.'),
      situacao: Situacao,
    })),
  })),
});

const SISTEMA = `Você é o planejador de estudos do Sinapse, um app de estudo para estudantes brasileiros.
Você conversa em português do Brasil, com frases curtas e diretas, sem jargão e sem elogio vazio.
Nunca use travessão longo; use vírgula, dois-pontos ou ponto.

Seu trabalho tem duas etapas.

Na etapa "perguntar", você lê as respostas da pessoa e os arquivos anexados (edital, ementa, provas antigas, anotações, livro) e:
- resume o que entendeu, citando o que encontrou nos arquivos;
- extrai os tópicos do estudo, no máximo 12, juntando subtemas pequenos num tópico só;
- faz no máximo 4 perguntas, e só as que mudam o plano. Boas perguntas citam um item concreto: "O edital dá peso 3 a Cardiologia. Você já viu arritmias?". Não pergunte o que a pessoa já respondeu, nem coisas genéricas como "qual seu objetivo". Prefira perguntas de escolha, com 2 a 4 opções.

Na etapa "conteudo", você cruza tudo o que a pessoa trouxe (os arquivos anexados, o texto das pastas e os decks do acervo, o desempenho nas provas feitas e as respostas) e devolve a lista de conteúdo do plano:
- junte num tópico só o mesmo assunto que aparece em fontes diferentes, e diga na origem de onde ele veio;
- abra cada tópico em subtópicos concretos, do tamanho de uma sessão de estudo, sem repetir o nome do tópico;
- se a pessoa já listou tópicos nas respostas, mantenha os nomes dela e complete com subtópicos;
- prova com nota baixa num assunto é pista de nível "fraco"; assunto com muito material já estudado no acervo é pista de "forte";
- não invente assunto que não está em nenhuma fonte, a não ser que o tema deixe óbvio que ele faz parte.

Na etapa "montar", você devolve a estratégia de um plano enxuto:
- o plano precisa caber no tempo real da pessoa; corte e priorize antes de inflar;
- tópico em que a pessoa é fraca, ou que pesa mais na prova, ganha peso maior;
- tópico que a pessoa domina ganha peso 1 e vira revisão;
- as fases somam 100; a reta final só existe se houver prazo;
- uma sessão por dia é o padrão: é mais fácil de cumprir.

Na etapa "analise", o plano já está em curso e você recebe o desempenho por tópico e por subtópico: acertos nas questões e nas provas, retenção nos flashcards e sessões feitas, e algumas questões erradas como exemplo. Você:
- julga cada tópico e subtópico só pelos números e exemplos recebidos; sem dados, a situação é "sem_dados", e você diz o que fazer para gerar dados;
- "forte" é acerto alto com volume razoável; "estavel" é bom, mas com pouco volume ou oscilando; "atencao" é acerto médio, ou pouco volume perto da prova; "critico" é acerto baixo;
- nos pontos fortes e fracos, cite o subtópico e o número ("acertou 2 de 9 em pré-eclâmpsia"), nunca frases genéricas;
- o próximo passo usa o que o app tem: ler o arquivo, revisar flashcards, fazer uma prova curta do tópico, refazer as erradas.`;

/* O plano fala com a IA sempre com o mesmo sistema e o esforço médio; o
   acervo chega com o prefixo que diz à IA de onde aquele texto veio. */
function perguntar<T extends z.ZodType>(esquema: T, arquivos: Arquivo[], acervo: Material[], pedido: string) {
  return perguntarIA({
    sistema: SISTEMA, esquema, arquivos, pedido, esforco: 'medium',
    acervo: acervo.map((m) => ({ nome: `Do acervo: ${m.nome}`, texto: m.texto })),
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ erro: 'Método não permitido' });
    return;
  }
  if (!temChave()) {
    res.status(503).json({ erro: 'A chave da IA não está configurada. Defina ANTHROPIC_API_KEY ou GEMINI_API_KEY no .env.' });
    return;
  }

  try {
    const corpo = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as Record<string, unknown>;
    const etapa = texto(corpo.etapa);
    const arquivos = (Array.isArray(corpo.arquivos) ? corpo.arquivos : []) as Arquivo[];
    const acervo = (Array.isArray(corpo.acervo) ? corpo.acervo : []) as Material[];
    const conversa = (Array.isArray(corpo.conversa) ? corpo.conversa : []) as Troca[];

    const peso = arquivos.reduce((t, a) => t + texto(a.dados).length + texto(a.texto).length, 0);
    if (peso > TETO_ARQUIVOS) {
      res.status(413).json({ erro: `Os arquivos somam ${(peso / 1048576).toFixed(1)} MB, e o limite é ${(TETO_ARQUIVOS / 1048576).toFixed(1)} MB. Tire algum ou anexe uma parte.` });
      return;
    }
    let restaAcervo = TETO_ACERVO;
    const acervoCortado = acervo.map((m) => {
      const t = texto(m.texto).slice(0, Math.max(0, restaAcervo));
      restaAcervo -= t.length;
      return { nome: texto(m.nome), texto: t };
    }).filter((m) => m.texto);

    const contexto = [
      `Hoje é ${new Date().toISOString().slice(0, 10)}.`,
      'Respostas da pessoa, em JSON:',
      JSON.stringify(corpo.respostas ?? {}),
      conversa.length ? '\nPerguntas que você já fez e as respostas:\n' + conversa.map((c) => `- ${c.pergunta}\n  Resposta: ${c.resposta || '(pulou)'}`).join('\n') : '',
      corpo.leitura ? `\nO que você já tinha entendido antes: ${texto(corpo.leitura)}` : '',
    ].join('\n');

    if (etapa === 'perguntar') {
      const saida = await perguntar(Leitura, arquivos, acervoCortado,
        `Etapa: perguntar.\n${contexto}\n\nLeia tudo, extraia os tópicos e faça só as perguntas que mudam o plano.`);
      if (!saida) throw new Error('A IA não conseguiu ler o pedido. Tente de novo, ou siga sem ela.');
      res.status(200).json(semTravessao({
        leitura: saida.leitura,
        topicos: saida.topicos.slice(0, 12),
        perguntas: saida.perguntas.slice(0, 4).map((p) => ({ ...p, opcoes: p.tipo === 'texto' ? [] : p.opcoes.slice(0, 4) })),
      }));
      return;
    }

    if (etapa === 'conteudo') {
      const c = await perguntar(Conteudo, arquivos, acervoCortado,
        `Etapa: conteudo.\n${contexto}\n\nCruze os arquivos, o acervo e as provas e devolva a lista de conteúdo, com subtópicos.`);
      if (!c) throw new Error('A IA não conseguiu montar a lista de conteúdo. Tente de novo, ou escreva os tópicos.');
      res.status(200).json(semTravessao({
        topicos: c.topicos.slice(0, 15).map((t) => ({
          nome: t.nome.trim(),
          nivel: t.nivel,
          origem: t.origem.trim(),
          subtopicos: t.subtopicos.map((s) => s.trim()).filter(Boolean).slice(0, 8),
        })).filter((t) => t.nome),
      }));
      return;
    }

    if (etapa === 'montar') {
      const s = await perguntar(Estrategia, arquivos, acervoCortado,
        `Etapa: montar.\n${contexto}\n\nUse os tópicos das respostas (a pessoa pode ter ajustado o nível de cada um) e devolva a estratégia do plano.`);
      if (!s) throw new Error('A IA não conseguiu montar a estratégia. Tente de novo, ou siga sem ela.');
      /* O esquema não segura faixa de número, então quem segura é aqui. */
      const total = Math.max(1, s.fases.base + s.fases.aprofundamento + s.fases.final);
      res.status(200).json(semTravessao({
        resumo: s.resumo,
        topicos: s.topicos.slice(0, 12).map((t) => ({ ...t, peso: Math.min(5, Math.max(1, Math.round(t.peso))) })),
        fases: {
          base: s.fases.base / total,
          aprofundamento: s.fases.aprofundamento / total,
          final: s.fases.final / total,
        },
        sessoesPorDia: s.sessoesPorDia >= 2 ? 2 : 1,
        notas: s.notas.slice(0, 5),
      }));
      return;
    }

    if (etapa === 'analise') {
      const a = await perguntar(Analise, [], [],
        `Etapa: analise.
${contexto}

Desempenho por tópico, em JSON:
${JSON.stringify(corpo.desempenho ?? [])}

Analise os pontos fortes e fracos de cada tópico e subtópico.`);
      if (!a) throw new Error('A IA não conseguiu analisar o desempenho. Tente de novo.');
      res.status(200).json(semTravessao({
        resumo: a.resumo,
        topicos: a.topicos.slice(0, 20).map((t) => ({
          nome: t.nome.trim(), situacao: t.situacao,
          fortes: t.fortes.slice(0, 3), fracos: t.fracos.slice(0, 3), proximoPasso: t.proximoPasso,
          subtopicos: t.subtopicos.slice(0, 12).map((s) => ({ nome: s.nome.trim(), situacao: s.situacao })),
        })),
      }));
      return;
    }

    res.status(400).json({ erro: `Etapa desconhecida: ${etapa || '(vazia)'}` });
  } catch (erro) {
    responderErro(res, erro);
  }
}
