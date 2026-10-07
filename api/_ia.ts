// ─────────────────────────────────────────────────────────────────────────────
//  A conversa com a IA, dividida entre as rotas que a usam.
//
//  O Claude (`ANTHROPIC_API_KEY`) é o primeiro; o Gemini (`GEMINI_API_KEY`)
//  entra quando não há chave do Claude, ou quando o Claude falha por chave,
//  limite ou queda. Os dois respondem no mesmo esquema Zod, então quem chama
//  não sabe quem respondeu.
//
//  O sublinhado no nome tira o arquivo das rotas: a Vercel não serve
//  `api/_ia.ts` como `/api/_ia`.
// ─────────────────────────────────────────────────────────────────────────────
import type { VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

/* O Sonnet 4.6 é o padrão: rápido e bom de sobra para ler material de estudo.
   Nele o raciocínio não liga sozinho, então vai pedido como adaptativo. */
const MODELO = 'claude-sonnet-4-6';
/* O apelido `-latest` acompanha a versão atual do Flash, então não envelhece.
   Quem quiser outro modelo define GEMINI_MODEL no .env. */
const MODELO_GEMINI = process.env.GEMINI_MODEL || 'gemini-flash-latest';

export type Arquivo = { nome: string; tipo: string; contexto: string; dados?: string; texto?: string };
export type Material = { nome: string; texto: string };
export type Esforco = 'low' | 'medium' | 'high';

export const texto = (v: unknown) => (v == null ? '' : String(v));

export function temChave() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY);
}

export function semTravessao<T>(v: T): T {
  return JSON.parse(JSON.stringify(v).replace(/\s*\u2014\s*/g, ', ')) as T;
}

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

/* Os arquivos vão primeiro, e o último deles marca o fim do cache: pedidos
   seguidos sobre o mesmo material não o leem e cobram de novo por inteiro. */
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
    blocos.push({ type: 'document', title: m.nome, source: { type: 'text', media_type: 'text/plain', data: m.texto } });
  }
  const ultimo = blocos[blocos.length - 1];
  if (ultimo && (ultimo.type === 'document' || ultimo.type === 'image')) ultimo.cache_control = { type: 'ephemeral' };
  blocos.push({ type: 'text', text: pedido });
  return blocos;
}

/* ── Gemini ──
   Chamado pela API REST, sem SDK, para não pesar a função. Os arquivos viajam
   como `inlineData` e o esquema vai como JSON Schema; o que volta passa pelo
   mesmo Zod do Claude, então uma resposta torta vira erro e não dado torto. */
export class ErroGemini extends Error {
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
    if (m.texto.trim()) partes.push({ text: `${m.nome}\n\n${m.texto}` });
  }
  partes.push({ text: pedido });
  return partes;
}

async function perguntarAoGemini<T extends z.ZodType>(sistema: string, esquema: T, partes: ParteGemini[]): Promise<z.infer<T>> {
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(esquema) as Record<string, unknown>;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sistema }] },
      contents: [{ role: 'user', parts: partes }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: jsonSchema, maxOutputTokens: TETO_TOKENS },
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
/* Quando a resposta vem, mas não serve: recusada, cortada no teto de tokens
   ou fora do formato. Tem nome para o aviso dizer o motivo de verdade, e não
   um "não conseguiu" genérico. */
export class ErroDaResposta extends Error {
  constructor(public motivo: 'recusa' | 'longa' | 'formato', mensagem: string) { super(mensagem); }
}

/* O teto de tokens conta o raciocínio junto com a resposta: uma parte grande
   de um material, com tabelas em HTML, passava dos 16 mil e chegava cortada,
   e o JSON cortado não fecha. O teto alto pede um prazo explícito (sem ele o
   SDK recusa a chamada sem streaming), abaixo dos 300 s da função na Vercel. */
const TETO_TOKENS = 48000;
const PRAZO_CLAUDE = 270_000;

async function perguntarAoClaude<T extends z.ZodType>(sistema: string, esquema: T, blocos: Anthropic.Beta.BetaContentBlockParam[], esforco: Esforco): Promise<z.infer<T>> {
  const r = await new Anthropic().beta.messages.parse({
    model: MODELO,
    max_tokens: TETO_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort: esforco, format: betaZodOutputFormat(esquema) },
    system: sistema,
    messages: [{ role: 'user', content: blocos }],
  }, { timeout: PRAZO_CLAUDE, maxRetries: 0 });
  if (r.stop_reason === 'refusal') throw new ErroDaResposta('recusa', 'A IA recusou este pedido.');
  if (!r.parsed_output) {
    if (r.stop_reason === 'max_tokens') throw new ErroDaResposta('longa', 'A resposta ficou longa demais para caber de uma vez. Peça uma parte menor, por exemplo uma seção por vez.');
    throw new ErroDaResposta('formato', 'A IA devolveu uma resposta fora do formato. Tente de novo.');
  }
  return r.parsed_output as z.infer<T>;
}

/* O Claude vem primeiro. Se ele cair por chave, limite ou queda, e houver
   chave do Gemini, o Gemini responde no lugar; pedido malformado não troca de
   IA, porque o mesmo pedido falharia lá também. */
export async function perguntar<T extends z.ZodType>(o: {
  sistema: string; esquema: T; arquivos?: Arquivo[]; acervo?: Material[]; pedido: string; esforco?: Esforco;
}): Promise<z.infer<T> | null> {
  const arquivos = o.arquivos ?? [], acervo = o.acervo ?? [];
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await perguntarAoClaude(o.sistema, o.esquema, conteudo(arquivos, acervo, o.pedido), o.esforco ?? 'medium');
    } catch (erro) {
      /* Resposta cortada, fora do formato ou recusada também passa para o
         Gemini: é outra IA, que pode dar conta do mesmo pedido. */
      const trocavel = erro instanceof ErroDaResposta ||
        (erro instanceof Anthropic.APIError && !(erro instanceof Anthropic.BadRequestError)) ||
        (erro instanceof Error && /timed? ?out/i.test(erro.message));
      if (!process.env.GEMINI_API_KEY || !trocavel) throw erro;
      console.warn('[ia] Claude falhou, tentando o Gemini:', erro instanceof Error ? erro.message : erro);
    }
  }
  return perguntarAoGemini(o.sistema, o.esquema, partesGemini(arquivos, acervo, o.pedido));
}

/* O erro vira um recado que a tela sabe mostrar, e não uma pilha. */
export function responderErro(res: VercelResponse, erro: unknown) {
  if (erro instanceof ErroDaResposta) {
    res.status(502).json({ erro: erro.message, motivo: erro.motivo });
    return;
  }
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
