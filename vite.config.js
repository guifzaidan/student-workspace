// ─────────────────────────────────────────────────────────────────────────────
//  A API rodando dentro do Vite, em desenvolvimento.
//
//  Em produção quem executa `api/*.ts` é a Vercel. Em desenvolvimento, o
//  `vercel dev` faria o mesmo, mas exige conta e login na Vercel: uma barreira
//  desnecessária para quem só quer abrir o projeto e escrever.
//
//  Este plugin monta o mesmo handler no servidor do Vite. O `ssrLoadModule`
//  compila o TypeScript na hora e recarrega a cada salvamento, então editar
//  `api/dados.ts` tem efeito imediato, sem reiniciar nada.
//
//  O adaptador existe porque o handler foi escrito para a assinatura da Vercel
//  (`res.status().json()`, `req.body` já convertido) e aqui chegam o
//  `IncomingMessage` e o `ServerResponse` crus do Node.
// ─────────────────────────────────────────────────────────────────────────────
import { defineConfig, loadEnv } from 'vite';

function apiLocal(env) {
  return {
    name: 'api-local',
    configureServer(server) {
      // As credenciais do .env não são expostas ao navegador: elas só entram
      // no processo do servidor, que é onde o handler roda.
      for (const chave of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN']) {
        if (env[chave]) process.env[chave] = env[chave];
      }

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next();

        const nome = req.url.split('?')[0].replace('/api/', '').replace(/\/$/, '');
        try {
          const mod = await server.ssrLoadModule(`/api/${nome}.ts`);

          let corpo = '';
          if (req.method === 'POST') {
            corpo = await new Promise((ok, erro) => {
              let dados = '';
              req.on('data', (p) => { dados += p; });
              req.on('end', () => ok(dados));
              req.on('error', erro);
            });
          }

          const pedido = Object.assign(req, {
            body: corpo ? JSON.parse(corpo) : {},
            query: Object.fromEntries(new URL(req.url, 'http://local').searchParams),
          });
          const resposta = Object.assign(res, {
            status(codigo) { res.statusCode = codigo; return resposta; },
            json(dados) {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify(dados));
              return resposta;
            },
            send(dados) { res.end(dados); return resposta; },
          });

          await mod.default(pedido, resposta);
        } catch (erro) {
          // O erro vai como JSON porque é isso que a tela sabe ler: uma pilha
          // de exceção em HTML viraria "resposta inesperada" e esconderia a causa.
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ erro: erro instanceof Error ? erro.message : String(erro) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // O terceiro argumento vazio lê toda variável do .env, e não só as VITE_.
  const env = loadEnv(mode, process.cwd(), '');
  return { plugins: [apiLocal(env)] };
});
