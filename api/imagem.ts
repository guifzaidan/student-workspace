// ─────────────────────────────────────────────────────────────────────────────
//  As imagens do texto, servidas uma a uma.
//
//  GET /api/imagem?id=img_xxx    devolve os bytes, com o tipo certo.
//
//  Rota própria, e não mais um campo no `GET /api/dados`: aquele devolve o
//  estado inteiro do sistema numa resposta só, e imagem dentro dele faria a
//  primeira tela esperar por bytes que talvez nunca sejam olhados. Aqui o
//  navegador busca cada uma quando ela entra na tela, e guarda em cache.
//
//  O id é sorteado e nunca se repete, então o conteúdo deste endereço não muda:
//  é o que permite o `immutable` abaixo e o que faz a segunda visita ao arquivo
//  não pedir imagem nenhuma de novo.
// ─────────────────────────────────────────────────────────────────────────────
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, garantirSchema } from './_db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ erro: 'Método não suportado.' });
    return;
  }

  const id = String((req.query as Record<string, unknown>).id ?? '');
  if (!id) {
    res.status(400).json({ erro: 'Faltou o id da imagem.' });
    return;
  }

  try {
    await garantirSchema();
    const r = await db().execute({
      sql: 'SELECT tipo, dados FROM sinapse_imagens WHERE id = ?',
      args: [id],
    });
    const linha = r.rows[0] as unknown as { tipo: string; dados: string } | undefined;
    if (!linha) {
      res.status(404).json({ erro: 'Imagem não encontrada.' });
      return;
    }

    const bytes = Buffer.from(linha.dados, 'base64');
    res.setHeader('Content-Type', linha.tipo);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).send(bytes);
  } catch (erro) {
    res.status(500).json({ erro: erro instanceof Error ? erro.message : String(erro) });
  }
}
