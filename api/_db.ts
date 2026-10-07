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
/* O ponto de entrada `/web` é o cliente só-HTTP. O `@libsql/client` padrão traz
   `libsql` como dependência normal, que é o binding nativo em `.node`, e num
   runtime serverless ele falha ao carregar: a função nem chega a rodar, e o que
   aparece é FUNCTION_INVOCATION_FAILED, sem pista do motivo. Contra um Turso
   remoto o nativo não serve para nada mesmo, porque a conversa é HTTP. */
import { createClient, type Client } from '@libsql/client/web';

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

  /* O rascunho é um card que ainda não escolheu deck. Não cabe na tabela dos
     cards porque lá o deck é obrigatório, e afrouxar isso deixaria a revisão
     tropeçar em card sem destino. Ele mora aqui até ser salvo num deck ou
     descartado, recarregar a página não é nenhuma das duas coisas.
     O arquivo apagado não leva o rascunho junto: ele continua com o trecho, e
     só perde o endereço de onde saiu. */
  `CREATE TABLE IF NOT EXISTS sinapse_rascunhos (
     id         TEXT PRIMARY KEY,
     arquivo_id TEXT REFERENCES sinapse_arquivos(id) ON DELETE SET NULL,
     frente     TEXT NOT NULL DEFAULT '',
     verso      TEXT NOT NULL DEFAULT '',
     trecho     TEXT NOT NULL DEFAULT '',
     origem     TEXT NOT NULL DEFAULT '',
     criado_em  TEXT NOT NULL
   )`,

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

  /* As imagens do texto ficam fora do corpo do arquivo. Embutidas como data:
     URL elas entrariam na mesma coluna que o texto, e o `GET /api/dados` carrega
     o corpo de todo arquivo de uma vez: meia duzia de prints e a primeira tela
     passaria a puxar megabytes antes de desenhar qualquer coisa.
     Aqui cada uma tem endereco proprio, o corpo guarda so a referencia, e o
     navegador as busca sob demanda e as guarda em cache. */
  `CREATE TABLE IF NOT EXISTS sinapse_imagens (
     id         TEXT PRIMARY KEY,
     arquivo_id TEXT REFERENCES sinapse_arquivos(id) ON DELETE CASCADE,
     nome       TEXT NOT NULL DEFAULT '',
     tipo       TEXT NOT NULL,
     bytes      INTEGER NOT NULL DEFAULT 0,
     dados      TEXT NOT NULL,
     criada_em  TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_imagens_arquivo ON sinapse_imagens (arquivo_id)`,

  `CREATE TABLE IF NOT EXISTS sinapse_ciclos (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     rotulo      TEXT NOT NULL DEFAULT '',
     arquivo_id  TEXT,
     minutos     INTEGER NOT NULL,
     comecou_em  TEXT NOT NULL,
     terminou_em TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_ciclos_dia ON sinapse_ciclos (comecou_em)`,

  /* O banco de questões. Cada questão é de múltipla escolha: o enunciado, as
     alternativas (2 a 5, em JSON, na ordem em que foram escritas) e o índice
     da certa. A prova embaralha na hora, então a ordem aqui é só a de quem
     escreveu. Como o rascunho, a questão sobrevive ao arquivo de onde saiu:
     ela guarda o trecho, e só perde o endereço. Acertos e tentativas moram
     nela para o banco mostrar, sem junção, quais ela anda errando. */
  `CREATE TABLE IF NOT EXISTS sinapse_questoes (
     id            TEXT PRIMARY KEY,
     arquivo_id    TEXT REFERENCES sinapse_arquivos(id) ON DELETE SET NULL,
     enunciado     TEXT NOT NULL,
     alternativas  TEXT NOT NULL DEFAULT '[]',
     correta       INTEGER NOT NULL DEFAULT 0,
     explicacao    TEXT NOT NULL DEFAULT '',
     trecho        TEXT NOT NULL DEFAULT '',
     origem        TEXT NOT NULL DEFAULT '',
     acertos       INTEGER NOT NULL DEFAULT 0,
     tentativas    INTEGER NOT NULL DEFAULT 0,
     criada_em     TEXT NOT NULL,
     atualizada_em TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_questoes_arquivo ON sinapse_questoes (arquivo_id)`,

  /* As provas feitas: o recorte de onde as questões saíram, a nota, o tempo e
     as respostas (JSON, uma por questão). É histórico, e não é desfeito
     quando uma questão some: a prova continua contando o que foi feito. */
  `CREATE TABLE IF NOT EXISTS sinapse_provas (
     id        TEXT PRIMARY KEY,
     escopo    TEXT NOT NULL DEFAULT '',
     total     INTEGER NOT NULL DEFAULT 0,
     acertos   INTEGER NOT NULL DEFAULT 0,
     segundos  INTEGER NOT NULL DEFAULT 0,
     respostas TEXT NOT NULL DEFAULT '[]',
     feita_em  TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_provas_dia ON sinapse_provas (feita_em)`,

  /* Os planos de estudo. O que o assistente perguntou (`respostas`) e o que
     ele montou a partir disso (`cronograma`) vão em JSON, cada um numa coluna:
     o plano é lido sempre inteiro, e ajustar é refazer o cronograma a partir
     das respostas, então separá-los em tabelas só obrigaria a remontar tudo
     a cada leitura. A pasta e o deck são o espaço que o plano criou; apagar
     um deles deixa o plano de pé, só sem o atalho. */
  `CREATE TABLE IF NOT EXISTS sinapse_planos (
     id            TEXT PRIMARY KEY,
     nome          TEXT NOT NULL,
     respostas     TEXT NOT NULL DEFAULT '{}',
     cronograma    TEXT NOT NULL DEFAULT '{}',
     pasta_id      TEXT REFERENCES sinapse_pastas(id) ON DELETE SET NULL,
     deck_id       TEXT REFERENCES sinapse_decks(id) ON DELETE SET NULL,
     criado_em     TEXT NOT NULL,
     atualizado_em TEXT NOT NULL
   )`,

  // O uso da plataforma, em minutos ativos por hora (UTC, `AAAA-MM-DDTHH`). Uma
  // linha por hora, e não por acesso: o mapa de calor do Dashboard só precisa
  // do total de cada hora, e a tabela cresce no máximo 24 linhas por dia.
  `CREATE TABLE IF NOT EXISTS sinapse_acessos (
     hora    TEXT PRIMARY KEY,
     minutos INTEGER NOT NULL DEFAULT 0
   )`,
];

/**
 * Colunas que nasceram depois da tabela.
 *
 * `CREATE TABLE IF NOT EXISTS` não acrescenta coluna a uma tabela que já existe,
 * então quem chegou depois precisa ser garantido à parte. SQLite não tem
 * `ADD COLUMN IF NOT EXISTS`, e por isso a checagem vem antes.
 */
const COLUNAS: [string, string, string][] = [
  ['sinapse_arquivos', 'notas', `TEXT NOT NULL DEFAULT ''`],
  // Margem da folha em centímetros; 2,54 é a do Docs e do Word.
  ['sinapse_arquivos', 'margem', `REAL NOT NULL DEFAULT 2.54`],
  // Os post-its soltos sobre a folha, em JSON: cor, texto e posição.
  ['sinapse_arquivos', 'postits', `TEXT NOT NULL DEFAULT ''`],
  // O arquivo com as propostas da IA ainda não decididas, no lugar delas.
  // Vazio quando não há nenhuma; o corpo continua sendo só o aprovado.
  ['sinapse_arquivos', 'propostas_ia', `TEXT NOT NULL DEFAULT ''`],
  // Uma imagem por lado do card, como endereço da `/api/imagem` (vazio é sem).
  ['sinapse_flashcards', 'imagem_frente', `TEXT NOT NULL DEFAULT ''`],
  ['sinapse_flashcards', 'imagem_verso', `TEXT NOT NULL DEFAULT ''`],
  ['sinapse_rascunhos', 'imagem_frente', `TEXT NOT NULL DEFAULT ''`],
  ['sinapse_rascunhos', 'imagem_verso', `TEXT NOT NULL DEFAULT ''`],
];

async function garantirColunas(cx: ReturnType<typeof db>): Promise<void> {
  for (const [tabela, coluna, tipo] of COLUNAS) {
    const info = await cx.execute(`PRAGMA table_info(${tabela})`);
    const tem = info.rows.some((linha) => (linha as unknown as { name: string }).name === coluna);
    if (!tem) await cx.execute(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
  }
}

/**
 * O registro de uso nasceu depois do resto. Na primeira vez, ele herda o que
 * o histórico já conta: cada card revisado vale um minuto, e cada ciclo de
 * foco concluído vale os minutos dele, na hora em que começou. Sem isso o
 * mapa de calor abriria vazio para quem já estuda há semanas.
 */
async function preencherAcessos(cx: ReturnType<typeof db>): Promise<void> {
  await cx.execute(
    `INSERT OR IGNORE INTO sinapse_acessos (hora, minutos)
     SELECT hora, MIN(60, SUM(m)) FROM (
       SELECT substr(revisado_em, 1, 13) AS hora, 1 AS m FROM sinapse_revisoes
       UNION ALL
       SELECT substr(comecou_em, 1, 13), minutos FROM sinapse_ciclos WHERE terminou_em IS NOT NULL
     ) GROUP BY hora`,
  );
}

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
    const antes = await cx.execute(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sinapse_acessos'`,
    );
    for (const ddl of SCHEMA) await cx.execute(ddl);
    if (!antes.rows.length) await preencherAcessos(cx);
    await garantirColunas(cx);
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
