// ─────────────────────────────────────────────────────────────────────────────
//  O assistente de plano de estudos, com o Claude.
//
//  POST /api/plano   { etapa: 'perguntar' | 'montar', respostas, arquivos, acervo, conversa }
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
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

const MODELO = 'claude-opus-5-5';
/* O apelido `-latest` acompanha a versão atual do Flash, então não envelhece.
   Quem quiser outro modelo define GEMINI_MODEL no .env. */
const MODELO_GEMINI = process.env.GEMINI_MODEL || 'gemini-flash-latest';

/* O corpo de uma função da Vercel para em 4,5 MB, e os arquivos chegam em
   base64, que é um terço maior que o original. O teto deixa folga para o
   resto do pedido; passar dele vira um recado, e não um erro sem causa. */
const TETO_ARQUIVOS = 3.3 * 1024 * 1024;
/* O texto do acervo vai junto como contexto, mas não o acervo inteiro: o que
   passa disso é cortado na tela, e o Claude é avisado do corte. */
const TETO_ACERVO = 120_000;

type Arquivo = { nome: string; tipo: string; contexto: string; dados?: string; texto?: string };
type Material = { nome: string; texto: string };
type Troca = { pergunta: string; resposta: string };

const texto = (v: unknown) => (v == null ? '' : String(v));

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

const SISTEMA = `Você é o planejador de estudos do Sinapse, um app de estudo para estudantes brasileiros.
Você conversa em português do Brasil, com frases curtas e diretas, sem jargão e sem elogio vazio.
Nunca use travessão longo; use vírgula, dois-pontos ou ponto.

Seu trabalho tem duas etapas.

Na etapa "perguntar", você lê as respostas da pessoa e os arquivos anexados (edital, ementa, provas antigas, anotações, livro) e:
- resume o que entendeu, citando o que encontrou nos arquivos;
- extrai os tópicos do estudo, no máximo 12, juntando subtemas pequenos num tópico só;
- faz no máximo 4 perguntas, e só as que mudam o plano. Boas perguntas citam um item concreto: "O edital dá peso 3 a Cardiologia. Você já viu arritmias?". Não pergunte o que a pessoa já respondeu, nem coisas genéricas como "qual seu objetivo". Prefira perguntas de escolha, com 2 a 4 opções.

Na etapa "montar", você devolve a estratégia de um plano enxuto:
- o plano precisa caber no tempo real da pessoa; corte e priorize antes de inflar;
- tópico em que a pessoa é fraca, ou que pesa mais na prova, ganha peso maior;
- tópico que a pessoa domina ganha peso 1 e vira revisão;
- as fases somam 100; a reta final só existe se houver prazo;
- uma sessão por dia é o padrão: é mais fácil de cumprir.`;

function blocoDeArquivo(a: Arquivo): Anthropic.Beta.BetaContentBlockParam | null {
  const titulo = a.nome + (a.contexto ? ` (${a.contexto})` : '');
  if (a.texto != null) {
    return { type: 'document', title: titulo, source: { type: 'text', media_type: 'text/plain', data: a.texto } };
  }
  if (!a.dados) return null;
  if (a.tipo === 'application/pdf') {
    return { type: 'document', title: titulo, source: { type: 'base64', media_type: 'application/pdf', data: a.dados } };
  }
  if (a.tipo === 'image/png' || a.tipo === 'image/jpeg' || a.tipo === 'image/gif' || a.tipo === 'image/webp') {
    return { type: 'image', source: { type: 'base64', media_type: a.tipo, data: a.dados } };
  }
  return null;
}

/* Os arquivos vão primeiro, e o último deles marca o fim do cache: a etapa de
   montar manda os mesmos arquivos da etapa de perguntar, e com o cache eles
   não são lidos e cobrados de novo por inteiro. */
function conteudo(arquivos: Arquivo[], acervo: Material[], pedido: string): Anthropic.Beta.BetaContentBlockParam[] {
  const blocos: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const a of arquivos) {
    const b = blocoDeArquivo(a);
    if (!b) continue;
    if (b.type === 'image') blocos.push({ type: 'text', text: `Imagem anexada: ${a.nome}${a.contexto ? ` (${a.contexto})` : ''}` });
    blocos.push(b);
  }
  for (const m of acervo) {
    if (!m.texto.trim()) continue;
    blocos.push({ type: 'document', title: `Do acervo: ${m.nome}`, source: { type: 'text', media_type: 'text/plain', data: m.texto } });
  }
  const ultimo = blocos[blocos.length - 1];
  if (ultimo && (ultimo.type === 'document' || ultimo.type === 'image')) ultimo.cache_control = { type: 'ephemeral' };
  blocos.push({ type: 'text', text: pedido });
  return blocos;
}

function semTravessao<T>(v: T): T {
  return JSON.parse(JSON.stringify(v).replace(/\s*—\s*/g, ', ')) as T;
}

/* ── Gemini ──
   Chamado pela API REST, sem SDK, para não pesar a função. Os arquivos viajam
   como `inlineData` e o esquema vai como JSON Schema; o que volta passa pelo
   mesmo Zod do Claude, então uma resposta torta vira erro e não plano torto. */
class ErroGemini extends Error {
  constructor(public status: number, mensagem: string) { super(mensagem); }
}

type ParteGemini = { text: string } | { inlineData: { mimeType: string; data: string } };

const TIPOS_GEMINI = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

function partesGemini(arquivos: Arquivo[], acervo: Material[], pedido: string): ParteGemini[] {
  const partes: ParteGemini[] = [];
  for (const a of arquivos) {
    const titulo = a.nome + (a.contexto ? ` (${a.contexto})` : '');
    if (a.texto != null) {
      partes.push({ text: `Arquivo anexado: ${titulo}\n\n${a.texto}` });
    } else if (a.dados && TIPOS_GEMINI.includes(a.tipo)) {
      partes.push({ text: `Arquivo anexado: ${titulo}` });
      partes.push({ inlineData: { mimeType: a.tipo, data: a.dados } });
    }
  }
  for (const m of acervo) {
    if (m.texto.trim()) partes.push({ text: `Do acervo: ${m.nome}\n\n${m.texto}` });
  }
  partes.push({ text: pedido });
  return partes;
}

async function perguntarAoGemini<T extends z.ZodType>(esquema: T, partes: ParteGemini[]): Promise<z.infer<T>> {
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(esquema) as Record<string, unknown>;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SISTEMA }] },
      contents: [{ role: 'user', parts: partes }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: jsonSchema, maxOutputTokens: 16000 },
    }),
  });
  const j = (await r.json().catch(() => ({}))) as {
    error?: { message?: string };
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  if (!r.ok) throw new ErroGemini(r.status, j.error?.message || `HTTP ${r.status}`);
  const saida = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
  let json: unknown = null;
  try { json = JSON.parse(saida); } catch { /* cai no safeParse abaixo */ }
  const lido = esquema.safeParse(json);
  if (!lido.success) throw new ErroGemini(502, 'O Gemini devolveu uma resposta fora do formato.');
  return lido.data as z.infer<T>;
}

/* ── Claude ── */
async function perguntarAoClaude<T extends z.ZodType>(esquema: T, blocos: Anthropic.Beta.BetaContentBlockParam[]): Promise<z.infer<T> | null> {
  const r = await new Anthropic().beta.messages.parse({
    model: MODELO,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(esquema) },
    system: SISTEMA,
    messages: [{ role: 'user', content: blocos }],
  });
  return r.stop_reason === 'refusal' ? null : (r.parsed_output as z.infer<T> | null);
}

/* O Claude vem primeiro. Se ele cair por chave, limite ou queda, e houver
   chave do Gemini, o Gemini responde no lugar; pedido malformado não troca de
   IA, porque o mesmo pedido falharia lá também. */
async function perguntar<T extends z.ZodType>(esquema: T, arquivos: Arquivo[], acervo: Material[], pedido: string): Promise<z.infer<T> | null> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await perguntarAoClaude(esquema, conteudo(arquivos, acervo, pedido));
    } catch (erro) {
      const trocavel = erro instanceof Anthropic.APIError && !(erro instanceof Anthropic.BadRequestError);
      if (!process.env.GEMINI_API_KEY || !trocavel) throw erro;
      console.warn('[plano] Claude falhou, tentando o Gemini:', erro.message);
    }
  }
  return perguntarAoGemini(esquema, partesGemini(arquivos, acervo, pedido));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ erro: 'Método não permitido' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
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

    res.status(400).json({ erro: `Etapa desconhecida: ${etapa || '(vazia)'}` });
  } catch (erro) {
    if (erro instanceof ErroGemini) {
      if (erro.status === 401 || erro.status === 403) res.status(503).json({ erro: 'A chave do Gemini foi recusada. Confira GEMINI_API_KEY no .env.' });
      else if (erro.status === 429) res.status(429).json({ erro: 'A IA está sobrecarregada agora. Espere um pouco e tente de novo.' });
      else if (erro.status === 400) res.status(400).json({ erro: 'A IA recusou o pedido: ' + erro.message });
      else res.status(502).json({ erro: `A IA respondeu com erro (${erro.status}). Tente de novo.` });
    } else if (erro instanceof Anthropic.AuthenticationError) {
      res.status(503).json({ erro: 'A chave da IA foi recusada. Confira ANTHROPIC_API_KEY no .env.' });
    } else if (erro instanceof Anthropic.RateLimitError) {
      res.status(429).json({ erro: 'A IA está sobrecarregada agora. Espere um pouco e tente de novo.' });
    } else if (erro instanceof Anthropic.BadRequestError) {
      res.status(400).json({ erro: 'A IA recusou o pedido: ' + erro.message });
    } else if (erro instanceof Anthropic.APIError) {
      res.status(502).json({ erro: `A IA respondeu com erro (${erro.status}). Tente de novo.` });
    } else {
      res.status(500).json({ erro: erro instanceof Error ? erro.message : String(erro) });
    }
  }
}
