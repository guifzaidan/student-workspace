// ─────────────────────────────────────────────────────────────────────────────
//  A conexão com o Turso e o schema do Sinapse.
//
//  A credencial mora só aqui, no servidor. Ela nunca chega ao navegador: o que
//  a página conhece é `/api/dados`, e é a função que fala com o banco.
//
//  As tabelas levam o prefixo `sinapse_` de propósito. O mesmo banco pode estar
//  hospedando outra coisa, e `pastas` ou `decks` são nomes que qualquer projeto
//  reivindicaria. Com o prefixo, criar isto aqui não atropela nada que já exista.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient, type Client } from '@libsql/client';

let cliente: Client | null = null;
let schemaPronto: Promise<void> | null = null;

export function db(): Client {
  if (cliente) return cliente;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    throw new Error(
      'TURSO_DATABASE_URL não está definida. Copie .env.example para .env e preencha as duas variáveis.',
    );
  }
  cliente = createClient({ url, authToken });
  return cliente;
}

/**
 * O schema, em DDL que pode rodar quantas vezes for.
 *
 * Tudo é `IF NOT EXISTS`: subir a função de novo não recria nada nem perde
 * dado. Acrescentar uma coluna depois é escrever mais uma linha aqui.
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sinapse_pastas (
     id           TEXT PRIMARY KEY,
     nome         TEXT NOT NULL,
     descricao    TEXT NOT NULL DEFAULT '',
     etiquetas    TEXT NOT NULL DEFAULT '',
     posicao      INTEGER NOT NULL DEFAULT 0,
     criada_em    TEXT NOT NULL,
     atualizada_em TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS sinapse_arquivos (
     id            TEXT PRIMARY KEY,
     pasta_id      TEXT NOT NULL REFERENCES sinapse_pastas(id) ON DELETE CASCADE,
     nome          TEXT NOT NULL,
     descricao     TEXT NOT NULL DEFAULT '',
     etiquetas     TEXT NOT NULL DEFAULT '',
     corpo         TEXT NOT NULL DEFAULT '',
     posicao       INTEGER NOT NULL DEFAULT 0,
     criado_em     TEXT NOT NULL,
     atualizado_em TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_arquivos_pasta ON sinapse_arquivos (pasta_id, posicao)`,

  `CREATE TABLE IF NOT EXISTS sinapse_decks (
     id            TEXT PRIMARY KEY,
     nome          TEXT NOT NULL,
     descricao     TEXT NOT NULL DEFAULT '',
     novos_por_dia INTEGER NOT NULL DEFAULT 20,
     posicao       INTEGER NOT NULL DEFAULT 0,
     criado_em     TEXT NOT NULL,
     atualizado_em TEXT NOT NULL
   )`,

  // A repetição espaçada mora no próprio card: intervalo, facilidade e quando
  // ele volta. Guardar isso numa tabela à parte obrigaria uma junção em toda
  // leitura, e o dado nasce e morre junto com o card.
  `CREATE TABLE IF NOT EXISTS sinapse_flashcards (
     id              TEXT PRIMARY KEY,
     deck_id         TEXT NOT NULL REFERENCES sinapse_decks(id) ON DELETE CASCADE,
     arquivo_id      TEXT REFERENCES sinapse_arquivos(id) ON DELETE SET NULL,
     frente          TEXT NOT NULL,
     verso           TEXT NOT NULL DEFAULT '',
     trecho          TEXT NOT NULL DEFAULT '',
     origem          TEXT NOT NULL DEFAULT '',
     intervalo_dias  INTEGER NOT NULL DEFAULT 0,
     facilidade      REAL NOT NULL DEFAULT 2.5,
     repeticoes      INTEGER NOT NULL DEFAULT 0,
     acertos         INTEGER NOT NULL DEFAULT 0,
     tentativas      INTEGER NOT NULL DEFAULT 0,
     proxima_revisao TEXT,
     criado_em       TEXT NOT NULL,
     atualizado_em   TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_flashcards_deck ON sinapse_flashcards (deck_id)`,
  `CREATE INDEX IF NOT EXISTS idx_flashcards_fila ON sinapse_flashcards (proxima_revisao)`,
  `CREATE INDEX IF NOT EXISTS idx_flashcards_arquivo ON sinapse_flashcards (arquivo_id)`,

  // O histórico é separado porque ele cresce para sempre e não é lido junto com
  // o resto: serve ao gráfico dos últimos dias e ao acerto em 30 dias.
  `CREATE TABLE IF NOT EXISTS sinapse_revisoes (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     flashcard_id TEXT NOT NULL REFERENCES sinapse_flashcards(id) ON DELETE CASCADE,
     deck_id      TEXT NOT NULL,
     grau         INTEGER NOT NULL,
     revisado_em  TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_revisoes_dia ON sinapse_revisoes (revisado_em)`,

  `CREATE TABLE IF NOT EXISTS sinapse_ciclos (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     rotulo      TEXT NOT NULL DEFAULT '',
     arquivo_id  TEXT,
     minutos     INTEGER NOT NULL,
     comecou_em  TEXT NOT NULL,
     terminou_em TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_ciclos_dia ON sinapse_ciclos (comecou_em)`,
];

/**
 * Garante o schema uma vez por processo.
 *
 * A promessa fica presa num módulo: requisições simultâneas na mesma instância
 * esperam a mesma, em vez de dispararem o mesmo DDL em paralelo.
 */
export function garantirSchema(): Promise<void> {
  if (schemaPronto) return schemaPronto;
  schemaPronto = (async () => {
    const cx = db();
    for (const ddl of SCHEMA) await cx.execute(ddl);
    await cx.execute('PRAGMA foreign_keys = ON');
  })().catch((erro) => {
    // Falhou: solta a promessa para a próxima requisição tentar de novo, em vez
    // de guardar o erro para sempre.
    schemaPronto = null;
    throw erro;
  });
  return schemaPronto;
}

/** Identificador curto, legível no banco e suficiente para o volume daqui. */
export function novoId(prefixo: string): string {
  return `${prefixo}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function agora(): string {
  return new Date().toISOString();
}
