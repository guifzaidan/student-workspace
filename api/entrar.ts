// ─────────────────────────────────────────────────────────────────────────────
//  Entrar com o Google.
//
//  GET /api/entrar               manda para a tela de contas do Google.
//  GET /api/entrar?code=...      a volta de lá: troca o código pelo token,
//                                acha ou cria a conta e abre a sessão.
//
//  As duas pontas moram no mesmo endereço porque é ele que vai cadastrado no
//  Google Cloud como "URI de redirecionamento autorizado": um por ambiente,
//  `http://localhost:5173/api/entrar` e `https://<domínio>/api/entrar`.
//
//  É o fluxo de código, e não o botão pronto do Google: o botão da entrada
//  continua sendo o da casa, e o segredo do cliente nunca sai do servidor.
// ─────────────────────────────────────────────────────────────────────────────
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'node:crypto';
import { db, garantirSchema, novoId, agora } from './_db.js';
import { abrirSessao, cookie, definirCookie, lerCookies, origem } from './_sessao.js';

/* O `state` vai num cookie de vida curta e volta na URL: os dois precisam
   bater, senão a volta não foi pedida por este navegador. */
const COOKIE_ESTADO = 'sinapse_estado';

function ir(res: VercelResponse, para: string): void {
  res.statusCode = 302;
  res.setHeader('Location', para);
  res.end();
}

/* O erro volta para a entrada, que sabe dizê-lo. */
const paraEntrada = (res: VercelResponse, erro: string) => ir(res, `/login?erro=${encodeURIComponent(erro)}`);

function credenciais() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const segredo = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !segredo) throw new Error('GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET não estão definidas. Veja o .env.example.');
  return { id, segredo };
}

type Token = { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string; aud?: string; iss?: string; exp?: number };

/**
 * O que o Google diz de quem entrou.
 *
 * O id_token chega direto do Google, numa conexão TLS aberta por nós, e não
 * pela mão do navegador: por isso a assinatura não precisa ser conferida (o
 * OpenID Connect permite, seção 3.1.3.7). O que se confere é que ele é para
 * este app, emitido pelo Google e ainda válido.
 */
async function trocarCodigo(codigo: string, volta: string): Promise<Token> {
  const { id, segredo } = credenciais();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: codigo, client_id: id, client_secret: segredo, redirect_uri: volta, grant_type: 'authorization_code' }),
  });
  const corpo = (await r.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!r.ok || !corpo.id_token) throw new Error(`O Google recusou a entrada (${corpo.error || r.status}).`);

  const token = JSON.parse(Buffer.from(corpo.id_token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Token;
  if (token.aud !== id) throw new Error('O token não é deste app.');
  if (token.iss !== 'https://accounts.google.com' && token.iss !== 'accounts.google.com') throw new Error('O token não veio do Google.');
  if (!token.exp || token.exp * 1000 < Date.now()) throw new Error('O token do Google venceu. Tente de novo.');
  if (!token.sub || !token.email) throw new Error('O Google não mandou o e-mail da conta.');
  if (!token.email_verified) throw new Error('Esse e-mail ainda não foi confirmado no Google.');
  return token;
}

/**
 * A conta de quem entrou: achada pelo `sub` do Google; ou, na primeira vez,
 * pelo e-mail de uma conta ainda sem Google (a do acervo de antes do login);
 * ou criada agora, vazia.
 */
async function contaDe(token: Token): Promise<string> {
  const cx = db();
  const t = agora();
  const email = String(token.email).toLowerCase();
  const nome = token.name ?? '';
  const foto = token.picture ?? '';

  const pelaConta = await cx.execute('SELECT id FROM sinapse_usuarios WHERE google_id = ?', [String(token.sub)]);
  const pelaEmail = pelaConta.rows.length
    ? pelaConta
    : await cx.execute('SELECT id FROM sinapse_usuarios WHERE google_id IS NULL AND lower(email) = ? LIMIT 1', [email]);

  if (pelaEmail.rows.length) {
    const id = String((pelaEmail.rows[0] as unknown as { id: string }).id);
    /* O nome e a foto acompanham o Google a cada entrada. */
    await cx.execute(
      'UPDATE sinapse_usuarios SET google_id = ?, email = ?, nome = ?, foto = ?, ultimo_acesso = ? WHERE id = ?',
      [String(token.sub), email, nome, foto, t, id],
    );
    return id;
  }

  const id = novoId('usr');
  await cx.execute(
    'INSERT INTO sinapse_usuarios (id, google_id, email, nome, foto, criado_em, ultimo_acesso) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, String(token.sub), email, nome, foto, t, t],
  );
  return id;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const q = req.query as Record<string, string | undefined>;
  const volta = `${origem(req)}/api/entrar`;

  try {
    /* Quem fechou a tela do Google ou negou o acesso volta com `error`. */
    if (q.error) {
      paraEntrada(res, q.error === 'access_denied' ? 'Você cancelou a entrada com o Google.' : `O Google não deixou entrar (${q.error}).`);
      return;
    }

    if (!q.code) {
      const estado = randomBytes(24).toString('base64url');
      definirCookie(res, cookie(req, COOKIE_ESTADO, estado, 600, '/api/entrar'));
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({
        client_id: credenciais().id,
        redirect_uri: volta,
        response_type: 'code',
        scope: 'openid email profile',
        state: estado,
        /* Sempre pergunta qual conta: quem tem duas não entra na errada sem ver. */
        prompt: 'select_account',
      }).toString();
      ir(res, url.toString());
      return;
    }

    const esperado = lerCookies(req)[COOKIE_ESTADO];
    definirCookie(res, cookie(req, COOKIE_ESTADO, '', 0, '/api/entrar'));
    if (!esperado || esperado !== q.state) {
      paraEntrada(res, 'A entrada demorou demais ou veio de outra aba. Tente de novo.');
      return;
    }

    const token = await trocarCodigo(q.code, volta);
    await garantirSchema();
    abrirSessao(req, res, await contaDe(token));
    ir(res, '/app/');
  } catch (erro) {
    paraEntrada(res, erro instanceof Error ? erro.message : String(erro));
  }
}
