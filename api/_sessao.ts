// ─────────────────────────────────────────────────────────────────────────────
//  Quem está do outro lado da requisição.
//
//  A sessão é um cookie assinado, e não uma linha no banco: ele leva o id da
//  pessoa e a validade, e a assinatura HMAC com `SESSAO_SEGREDO` impede que
//  alguém troque o id por outro. Conferir isso não custa ida ao Turso, então
//  toda rota pode exigir a sessão sem pesar.
//
//  O cookie é HttpOnly: o JavaScript da página não o lê, e um script injetado
//  num arquivo não consegue levá-lo embora.
// ─────────────────────────────────────────────────────────────────────────────
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'sinapse_sessao';
/* Trinta dias, renovados a cada abertura do app: quem estuda toda semana não
   precisa entrar de novo; quem some por um mês, entra. */
const DURACAO_S = 30 * 86400;

function segredo(): string {
  const s = process.env.SESSAO_SEGREDO;
  if (!s || s.length < 32) {
    throw new Error('SESSAO_SEGREDO não está definida (ou tem menos de 32 caracteres). Veja o .env.example.');
  }
  return s;
}

const assinar = (dado: string) => createHmac('sha256', segredo()).update(dado).digest('base64url');

export function lerCookies(req: IncomingMessage): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const parte of (req.headers.cookie ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const nome = parte.slice(0, i).trim();
    if (nome) saida[nome] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return saida;
}

/** Atrás da Vercel o https chega no cabeçalho; no Vite local, é http mesmo. */
export function origem(req: IncomingMessage): string {
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || 'http';
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
  return `${proto}://${host}`;
}

export function cookie(req: IncomingMessage, nome: string, valor: string, maxAge: number, caminho = '/'): string {
  const seguro = origem(req).startsWith('https:') ? '; Secure' : '';
  return `${nome}=${encodeURIComponent(valor)}; Path=${caminho}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${seguro}`;
}

/* Um `Set-Cookie` não pode apagar o outro: a resposta pode levar mais de um. */
export function definirCookie(res: ServerResponse, valor: string): void {
  const atual = res.getHeader('Set-Cookie');
  const lista = Array.isArray(atual) ? atual : atual ? [String(atual)] : [];
  res.setHeader('Set-Cookie', [...lista, valor]);
}

export function abrirSessao(req: IncomingMessage, res: ServerResponse, usuarioId: string): void {
  const dado = Buffer.from(JSON.stringify({ u: usuarioId, e: Math.floor(Date.now() / 1000) + DURACAO_S })).toString('base64url');
  definirCookie(res, cookie(req, COOKIE, `${dado}.${assinar(dado)}`, DURACAO_S));
}

export function fecharSessao(req: IncomingMessage, res: ServerResponse): void {
  definirCookie(res, cookie(req, COOKIE, '', 0));
}

/** O id de quem está logado, ou null: sem cookie, assinatura que não bate ou vencido. */
export function usuarioDaSessao(req: IncomingMessage): string | null {
  const bruto = lerCookies(req)[COOKIE];
  if (!bruto) return null;
  const [dado, assinatura] = bruto.split('.');
  if (!dado || !assinatura) return null;
  const esperada = Buffer.from(assinar(dado));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(dado, 'base64url').toString('utf8')) as { u?: unknown; e?: unknown };
    if (typeof u !== 'string' || !u || typeof e !== 'number' || e * 1000 < Date.now()) return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * O id de quem está logado, ou um 401 já respondido.
 *
 * Quem chama só segue quando volta um id: `if (!usuario) return;`. A tela lê o
 * 401 e manda para a entrada.
 */
export function exigirUsuario(req: IncomingMessage, res: ServerResponse & { status(c: number): { json(d: unknown): unknown } }): string | null {
  const usuario = usuarioDaSessao(req);
  if (!usuario) res.status(401).json({ erro: 'Entre na sua conta para continuar.', semSessao: true });
  return usuario;
}
