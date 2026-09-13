// ─────────────────────────────────────────────────────────────────────────────
//  A porta única do Sinapse para o banco.
//
//  GET  /api/dados          devolve o estado inteiro: pastas com arquivos,
//                           decks com flashcards, e os números dos relatórios.
//  POST /api/dados          recebe { acao, ... } e grava.
//
//  Uma porta só, e não uma por recurso, porque a tela carrega tudo de uma vez
//  ao abrir: sete rotas seriam sete idas ao Turso para desenhar a primeira
//  tela. Gravar segue o mesmo caminho para não espalhar a checagem de schema.
// ─────────────────────────────────────────────────────────────────────────────
import type { VercelRequest, VercelResponse } from '@vercel/node';
/* A extensão `.js` é obrigatória, e não enfeite. O pacote é `type: module`, então
   na Vercel este arquivo vira `dados.js` e roda como ESM — e o carregador ESM do
   Node não completa extensão em caminho relativo. Sem ela o import quebra só em
   produção, no carregamento do módulo: a função morre antes do handler e a
   resposta é um 500 em texto puro, sem passar pelo try/catch daqui.

   Aponta para `_db.ts` mesmo assim: com `moduleResolution: "bundler"`, o
   TypeScript lê `.js` como o `.ts` correspondente. */
import { db, garantirSchema, novoId, agora } from './_db.js';

type Linha = Record<string, unknown>;

const texto = (v: unknown) => (v == null ? '' : String(v));
const numero = (v: unknown, padrao = 0) => (v == null || v === '' ? padrao : Number(v));

/* O teto de uma imagem. Print de tela cabe com folga; foto de câmera moderna
   não, e é melhor dizer isso do que estourar a memória da função. */
const TETO_IMAGEM = 5 * 1024 * 1024;
/* As etiquetas vão num campo só. O separador é o 0x1F do ASCII, que existe
   para exatamente isto e não pode aparecer num texto digitado. Escrito como
   escape, e não como o caractere cru: invisível no editor, ele viraria uma
   armadilha na primeira vez que alguém mexesse nesta linha. */
const SEPARADOR = '\u001f';
const lista = (v: unknown) => texto(v).split(SEPARADOR).filter(Boolean);
const juntar = (v: unknown) => (Array.isArray(v) ? v.filter(Boolean).join(SEPARADOR) : '');

/* As notas de um arquivo vão como JSON numa coluna dele. Não ganham tabela
   própria porque nunca são lidas sozinhas: elas só existem com o arquivo aberto
   e chegam junto com ele. Coluna vazia ou JSON quebrado vira lista vazia — uma
   nota ilegível não pode derrubar a leitura do acervo inteiro. */
function notas(v: unknown): unknown[] {
  const cru = texto(v);
  if (!cru) return [];
  try {
    const lido = JSON.parse(cru);
    return Array.isArray(lido) ? lido : [];
  } catch {
    return [];
  }
}

/** O dia de hoje em ISO, sem hora: é assim que a fila do dia é comparada. */
function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Leitura ──────────────────────────────────────────────────────────────────
async function lerTudo() {
  const cx = db();
  const [pastas, arquivos, decks, cards, revisoes, ciclos] = await Promise.all([
    cx.execute('SELECT * FROM sinapse_pastas ORDER BY posicao, criada_em'),
    cx.execute('SELECT * FROM sinapse_arquivos ORDER BY posicao, criado_em'),
    cx.execute('SELECT * FROM sinapse_decks ORDER BY posicao, criado_em'),
    cx.execute('SELECT * FROM sinapse_flashcards ORDER BY criado_em'),
    cx.execute(
      `SELECT substr(revisado_em, 1, 10) AS dia, COUNT(*) AS total,
              SUM(CASE WHEN grau >= 2 THEN 1 ELSE 0 END) AS acertos
         FROM sinapse_revisoes
        WHERE revisado_em >= datetime('now', '-30 days')
        GROUP BY dia ORDER BY dia`,
    ),
    cx.execute(
      `SELECT COALESCE(SUM(minutos), 0) AS minutos, COUNT(*) AS total
         FROM sinapse_ciclos
        WHERE terminou_em IS NOT NULL AND substr(comecou_em, 1, 10) = ?`,
      [hoje()],
    ),
  ]);

  const porPasta = new Map<string, Linha[]>();
  for (const linha of arquivos.rows as unknown as Linha[]) {
    const arr = porPasta.get(texto(linha.pasta_id)) ?? [];
    arr.push({
      id: texto(linha.id),
      nome: texto(linha.nome),
      desc: texto(linha.descricao),
      tags: lista(linha.etiquetas),
      corpo: texto(linha.corpo),
      notas: notas(linha.notas),
    });
    porPasta.set(texto(linha.pasta_id), arr);
  }

  const dia = hoje();
  return {
    pastas: (pastas.rows as unknown as Linha[]).map((l) => ({
      id: texto(l.id),
      nome: texto(l.nome),
      desc: texto(l.descricao),
      tags: lista(l.etiquetas),
      lista: porPasta.get(texto(l.id)) ?? [],
    })),
    decks: (decks.rows as unknown as Linha[]).map((l) => ({
      id: texto(l.id),
      nome: texto(l.nome),
      desc: texto(l.descricao),
      novosPorDia: numero(l.novos_por_dia, 20),
    })),
    flashcards: (cards.rows as unknown as Linha[]).map((l) => ({
      id: texto(l.id),
      deckId: texto(l.deck_id),
      arquivoId: texto(l.arquivo_id),
      frente: texto(l.frente),
      verso: texto(l.verso),
      trecho: texto(l.trecho),
      origem: texto(l.origem),
      intervalo: numero(l.intervalo_dias),
      facilidade: numero(l.facilidade, 2.5),
      repeticoes: numero(l.repeticoes),
      acertos: numero(l.acertos),
      tentativas: numero(l.tentativas),
      proxima: texto(l.proxima_revisao),
      /* O estado não é guardado: ele é a data comparada com hoje. Guardado, ele
         envelheceria sozinho toda meia-noite. */
      estado: !numero(l.repeticoes)
        ? 'novo'
        : !texto(l.proxima_revisao)
          ? 'emdia'
          : texto(l.proxima_revisao) < dia
            ? 'atrasado'
            : texto(l.proxima_revisao) === dia
              ? 'hoje'
              : 'emdia',
    })),
    revisoesPorDia: (revisoes.rows as unknown as Linha[]).map((l) => ({
      dia: texto(l.dia),
      total: numero(l.total),
      acertos: numero(l.acertos),
    })),
    focoHoje: {
      minutos: numero((ciclos.rows[0] as unknown as Linha)?.minutos),
      ciclos: numero((ciclos.rows[0] as unknown as Linha)?.total),
    },
  };
}

// ── Escrita ──────────────────────────────────────────────────────────────────
/**
 * SM-2 enxuto: o grau vai de 0 a 3, e o que sai é o próximo intervalo.
 * Errou volta para o começo; acertou multiplica pela facilidade, que sobe com
 * o Fácil e desce com o Difícil.
 *
 * IMPORTANTE: esta função tem uma cópia no cliente (index.html,
 * `proximoIntervalo`), porque a tela de revisão precisa dizer em cada botão
 * daqui a quanto o card volta — antes de gravar, e sem uma ida de rede no meio
 * da sessão. Mexeu aqui, mexe lá.
 */
function proximoIntervalo(grau: number, intervalo: number, facilidade: number) {
  let fac = facilidade + (grau === 3 ? 0.15 : grau === 2 ? 0 : grau === 1 ? -0.15 : -0.2);
  fac = Math.min(2.8, Math.max(1.3, fac));
  if (grau === 0) return { intervalo: 0, facilidade: fac };
  if (!intervalo) return { intervalo: grau === 1 ? 1 : grau === 2 ? 3 : 8, facilidade: fac };
  /* Cada grau tem o seu passo, e não só o empurrão na facilidade: ela varia
     0,15 de um grau para o seguinte, o que dá menos de 5% de diferença no
     intervalo. Num card de 5 dias, Difícil, Bom e Fácil devolviam 12, 13 e 13
     dias — e a tela anunciava "em 2 semanas" nos três botões. Escolher entre
     eles deixava de querer dizer alguma coisa.
     Com o passo: 6, 13 e 17 dias. O Difícil quase não estica, o Bom segue a
     facilidade e o Fácil dá o salto. */
  const passo = grau === 1 ? 1.2 : grau === 3 ? fac * 1.3 : fac;
  return { intervalo: Math.max(1, Math.round(intervalo * passo)), facilidade: fac };
}

function emDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function gravar(corpo: Record<string, unknown>) {
  const cx = db();
  const acao = texto(corpo.acao);
  const t = agora();

  switch (acao) {
    case 'pasta.criar': {
      const id = novoId('pas');
      await cx.execute(
        `INSERT INTO sinapse_pastas (id, nome, descricao, etiquetas, posicao, criada_em, atualizada_em)
         VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(posicao), 0) + 1 FROM sinapse_pastas), ?, ?)`,
        [id, texto(corpo.nome), texto(corpo.desc), juntar(corpo.tags), t, t],
      );
      return { id };
    }
    case 'pasta.renomear':
      await cx.execute(
        'UPDATE sinapse_pastas SET nome = ?, descricao = ?, etiquetas = ?, atualizada_em = ? WHERE id = ?',
        [texto(corpo.nome), texto(corpo.desc), juntar(corpo.tags), t, texto(corpo.id)],
      );
      return { ok: true };
    case 'pasta.excluir':
      await cx.execute('DELETE FROM sinapse_pastas WHERE id = ?', [texto(corpo.id)]);
      return { ok: true };

    case 'arquivo.criar': {
      const id = novoId('arq');
      await cx.execute(
        `INSERT INTO sinapse_arquivos (id, pasta_id, nome, descricao, etiquetas, corpo, posicao, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(posicao), 0) + 1 FROM sinapse_arquivos), ?, ?)`,
        [id, texto(corpo.pastaId), texto(corpo.nome), texto(corpo.desc), juntar(corpo.tags), texto(corpo.corpo), t, t],
      );
      return { id };
    }
    case 'arquivo.salvar':
      await cx.execute(
        'UPDATE sinapse_arquivos SET nome = ?, descricao = ?, corpo = ?, notas = ?, atualizado_em = ? WHERE id = ?',
        [
          texto(corpo.nome), texto(corpo.desc), texto(corpo.corpo),
          /* As notas viajam já serializadas: elas se prendem a marcas dentro do
             corpo, então gravar as duas coisas na mesma escrita é o que impede
             uma nota apontar para uma marca que a outra escrita ainda não tem. */
          JSON.stringify(Array.isArray(corpo.notas) ? corpo.notas : []),
          t, texto(corpo.id),
        ],
      );
      return { ok: true };
    case 'arquivo.excluir':
      await cx.execute('DELETE FROM sinapse_arquivos WHERE id = ?', [texto(corpo.id)]);
      return { ok: true };

    /* Esvaziar uma pasta antes de apagá-la. Numa instrução só, e não um UPDATE
       por arquivo: a pasta é apagada logo em seguida, e um arquivo que ficasse
       para trás no meio do caminho seria levado junto pelo ON DELETE CASCADE. */
    case 'arquivos.mover':
      await cx.execute(
        'UPDATE sinapse_arquivos SET pasta_id = ?, atualizado_em = ? WHERE pasta_id = ?',
        [texto(corpo.para), t, texto(corpo.de)],
      );
      return { ok: true };

    case 'deck.criar': {
      const id = novoId('dck');
      await cx.execute(
        `INSERT INTO sinapse_decks (id, nome, descricao, novos_por_dia, posicao, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(posicao), 0) + 1 FROM sinapse_decks), ?, ?)`,
        [id, texto(corpo.nome), texto(corpo.desc), numero(corpo.novosPorDia, 20), t, t],
      );
      return { id };
    }
    case 'deck.excluir':
      await cx.execute('DELETE FROM sinapse_decks WHERE id = ?', [texto(corpo.id)]);
      return { ok: true };

    /* O mesmo, para os cards de um deck que vai ser apagado. */
    case 'cards.mover':
      await cx.execute(
        'UPDATE sinapse_flashcards SET deck_id = ?, atualizado_em = ? WHERE deck_id = ?',
        [texto(corpo.para), t, texto(corpo.de)],
      );
      return { ok: true };

    case 'card.criar': {
      // Vários de uma vez: salvar os rascunhos da sessão é um gesto só.
      const cards = Array.isArray(corpo.cards) ? (corpo.cards as Record<string, unknown>[]) : [corpo];
      const ids: string[] = [];
      for (const c of cards) {
        const id = novoId('crd');
        ids.push(id);
        await cx.execute(
          `INSERT INTO sinapse_flashcards
             (id, deck_id, arquivo_id, frente, verso, trecho, origem, proxima_revisao, criado_em, atualizado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            texto(corpo.deckId ?? c.deckId),
            texto(c.arquivoId) || null,
            texto(c.frente),
            texto(c.verso),
            texto(c.trecho),
            texto(c.origem),
            hoje(),
            t,
            t,
          ],
        );
      }
      return { ids };
    }
    case 'card.salvar':
      await cx.execute(
        'UPDATE sinapse_flashcards SET frente = ?, verso = ?, deck_id = ?, atualizado_em = ? WHERE id = ?',
        [texto(corpo.frente), texto(corpo.verso), texto(corpo.deckId), t, texto(corpo.id)],
      );
      return { ok: true };
    case 'card.excluir':
      await cx.execute('DELETE FROM sinapse_flashcards WHERE id = ?', [texto(corpo.id)]);
      return { ok: true };

    case 'card.revisar': {
      const grau = numero(corpo.grau);
      const atual = await cx.execute(
        'SELECT deck_id, intervalo_dias, facilidade, repeticoes, acertos, tentativas FROM sinapse_flashcards WHERE id = ?',
        [texto(corpo.id)],
      );
      const linha = atual.rows[0] as unknown as Linha;
      if (!linha) return { ok: false };
      const passo = proximoIntervalo(grau, numero(linha.intervalo_dias), numero(linha.facilidade, 2.5));
      await cx.batch([
        {
          sql: `UPDATE sinapse_flashcards
                   SET intervalo_dias = ?, facilidade = ?, repeticoes = repeticoes + 1,
                       tentativas = tentativas + 1, acertos = acertos + ?,
                       proxima_revisao = ?, atualizado_em = ?
                 WHERE id = ?`,
          args: [passo.intervalo, passo.facilidade, grau >= 2 ? 1 : 0, emDias(passo.intervalo), t, texto(corpo.id)],
        },
        {
          sql: 'INSERT INTO sinapse_revisoes (flashcard_id, deck_id, grau, revisado_em) VALUES (?, ?, ?, ?)',
          args: [texto(corpo.id), texto(linha.deck_id), grau, t],
        },
      ]);
      return { proxima: emDias(passo.intervalo) };
    }

    /* A imagem entra em base64 e sai pela `/api/imagem`, que devolve os bytes.
       O teto existe porque o corpo da requisição é uma string em memória dentro
       da função: sem ele, um arquivo grande derruba a gravação inteira em vez
       de receber um recado. */
    case 'imagem.criar': {
      const dados = texto(corpo.dados);
      const bytes = Math.floor((dados.length * 3) / 4);
      if (!dados) throw new Error('A imagem veio vazia.');
      if (bytes > TETO_IMAGEM) {
        throw new Error(`A imagem tem ${Math.round(bytes / 1048576)} MB, e o limite é ${TETO_IMAGEM / 1048576} MB.`);
      }
      const tipo = texto(corpo.tipo) || 'image/png';
      if (!tipo.startsWith('image/')) throw new Error('Só imagem entra por aqui.');
      const id = novoId('img');
      await cx.execute(
        `INSERT INTO sinapse_imagens (id, arquivo_id, nome, tipo, bytes, dados, criada_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, texto(corpo.arquivoId) || null, texto(corpo.nome), tipo, bytes, dados, t],
      );
      return { id, url: `/api/imagem?id=${id}` };
    }
    case 'imagem.excluir':
      await cx.execute('DELETE FROM sinapse_imagens WHERE id = ?', [texto(corpo.id)]);
      return { ok: true };

    case 'ciclo.comecar': {
      const r = await cx.execute(
        'INSERT INTO sinapse_ciclos (rotulo, arquivo_id, minutos, comecou_em) VALUES (?, ?, ?, ?)',
        [texto(corpo.rotulo), texto(corpo.arquivoId) || null, numero(corpo.minutos, 25), t],
      );
      return { id: Number(r.lastInsertRowid) };
    }
    case 'ciclo.terminar':
      await cx.execute('UPDATE sinapse_ciclos SET terminou_em = ? WHERE id = ?', [t, numero(corpo.id)]);
      return { ok: true };

    default:
      throw new Error(`Ação desconhecida: ${acao || '(vazia)'}`);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await garantirSchema();
    if (req.method === 'GET') {
      res.status(200).json(await lerTudo());
      return;
    }
    if (req.method === 'POST') {
      const corpo = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
      res.status(200).json(await gravar(corpo));
      return;
    }
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ erro: 'Método não permitido' });
  } catch (erro) {
    // A mensagem vai para a tela: sem ela, um token errado vira uma tela em
    // branco e ninguém sabe o que aconteceu.
    res.status(500).json({ erro: erro instanceof Error ? erro.message : String(erro) });
  }
}
