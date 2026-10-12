// ─────────────────────────────────────────────────────────────────────────────
//  A sessão vista de fora.
//
//  GET  /api/conta               quem está logado ({ email, nome, foto }), ou 401.
//                                É o que a entrada consulta para pular direto
//                                ao app quando a pessoa já tem sessão.
//  POST /api/conta { acao: 'sair' }   encerra a sessão.
// ─────────────────────────────────────────────────────────────────────────────
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, garantirSchema } from './_db.js';
import { abrirSessao, exigirUsuario, fecharSessao } from './_sessao.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'POST') {
      const corpo = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
      if (corpo.acao !== 'sair') {
        res.status(400).json({ erro: 'Ação desconhecida.' });
        return;
      }
      fecharSessao(req, res);
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, POST');
      res.status(405).json({ erro: 'Método não permitido' });
      return;
    }

    const u = exigirUsuario(req, res);
    if (!u) return;
    await garantirSchema();
    const r = await db().execute('SELECT email, nome, foto FROM sinapse_usuarios WHERE id = ?', [u]);
    const conta = r.rows[0] as unknown as { email: string; nome: string; foto: string } | undefined;
    if (!conta) {
      fecharSessao(req, res);
      res.status(401).json({ erro: 'Essa conta não existe mais.', semSessao: true });
      return;
    }
    /* Cada consulta empurra a validade para frente: quem usa não cai. */
    abrirSessao(req, res, u);
    res.status(200).json({ email: String(conta.email), nome: String(conta.nome), foto: String(conta.foto) });
  } catch (erro) {
    res.status(500).json({ erro: erro instanceof Error ? erro.message : String(erro) });
  }
}
