// ─────────────────────────────────────────────────────────────────────────────
//  O arquivo em PDF, gerado aqui e baixado direto, sem a janela de impressão.
//
//  POST /api/pdf   { html, nome, margem }   →   application/pdf
//
//  A tela manda o mesmo documento que a impressão usa: o texto do arquivo com
//  o CSS da página. Aqui ele abre num Chrome sem tela, que desenha com o mesmo
//  motor do navegador: as mesmas fontes, cores, margens e folhas A4, e o texto
//  continua sendo texto (seleciona, busca, copia). Gerar no navegador, com uma
//  biblioteca de PDF, faria de cada página uma fotografia.
//
//  Na Vercel o Chrome é o `@sparticuz/chromium`, feito para rodar em função.
//  Em desenvolvimento é o Chrome instalado na máquina (ou o de `CHROME_PATH`).
// ─────────────────────────────────────────────────────────────────────────────
import type { VercelRequest, VercelResponse } from '@vercel/node';
import puppeteer, { type Browser } from 'puppeteer-core';
import { existsSync } from 'node:fs';
/* A extensão `.js` é obrigatória: ver o comentário de import em `dados.ts`. */
import { db, garantirSchema } from './_db.js';

/* O documento chega com o CSS inteiro da página, que já passa de 200 KB; o
   teto deixa folga para um texto grande sem chegar ao limite de corpo da
   função. */
const TETO_HTML = 3.5 * 1024 * 1024;
/* A resposta da função também tem limite (4,5 MB na Vercel): um PDF maior
   que isso não chegaria, e é melhor dizer o motivo. */
const TETO_PDF = 4.4 * 1024 * 1024;

const CHROME_LOCAL = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

const naNuvem = () => !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

/* O Chrome fica aberto entre um pedido e outro da mesma instância: abrir um
   leva alguns segundos, e a função é reaproveitada enquanto está quente. Se
   ele caiu, abre de novo. */
let navegador: Promise<Browser> | null = null;
async function abrirNavegador(): Promise<Browser> {
  if (navegador) {
    const b = await navegador.catch(() => null);
    if (b && b.connected) return b;
    navegador = null;
  }
  navegador = (async () => {
    if (naNuvem()) {
      const chromium = (await import('@sparticuz/chromium')).default;
      return puppeteer.launch({
        args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
        executablePath: await chromium.executablePath(),
        headless: 'shell',
      });
    }
    const caminho = CHROME_LOCAL.find((c) => c && existsSync(c));
    if (!caminho) {
      throw new Error('Não achei o Chrome nesta máquina. Instale o Google Chrome ou aponte CHROME_PATH para ele no .env.');
    }
    return puppeteer.launch({ executablePath: caminho, headless: true });
  })();
  return navegador;
}

/* As imagens do texto apontam para `/api/imagem?id=...`. Elas entram no
   documento já embutidas, lidas direto do banco: assim o PDF não depende de o
   servidor alcançar o próprio site, o que falharia num preview protegido. */
async function embutirImagens(html: string): Promise<string> {
  const ids = Array.from(new Set(Array.from(html.matchAll(/\/api\/imagem\?id=([A-Za-z0-9_]+)/g), (m) => m[1])));
  if (!ids.length) return html;
  await garantirSchema();
  const r = await db().execute({
    sql: `SELECT id, tipo, dados FROM sinapse_imagens WHERE id IN (${ids.map(() => '?').join(',')})`,
    args: ids,
  });
  const porId = new Map<string, string>();
  for (const l of r.rows as unknown as { id: string; tipo: string; dados: string }[]) {
    porId.set(String(l.id), `data:${l.tipo};base64,${l.dados}`);
  }
  return html.replace(/\/api\/imagem\?id=([A-Za-z0-9_]+)/g, (inteiro, id) => porId.get(id) ?? inteiro);
}

/* O nome que o PDF ganha ao baixar: o do arquivo, sem o que o sistema não
   aceita em nome de arquivo. */
function nomeDoPdf(nome: string): string {
  const limpo = nome.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return (limpo || 'Arquivo') + '.pdf';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ erro: 'Método não permitido' });
    return;
  }
  let pagina: Awaited<ReturnType<Browser['newPage']>> | null = null;
  try {
    const corpo = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    const html = typeof corpo.html === 'string' ? corpo.html : '';
    if (!html) throw new Error('O documento veio vazio.');
    if (html.length > TETO_HTML) throw new Error('O arquivo é grande demais para virar PDF de uma vez.');
    const margem = Math.min(6.5, Math.max(0, Number(corpo.margem) || 2.54));

    const b = await abrirNavegador();
    pagina = await b.newPage();
    /* O `load` espera as imagens e as folhas de estilo; as fontes, logo abaixo. */
    await pagina.setContent(await embutirImagens(html), { waitUntil: 'load', timeout: 25000 });
    /* As fontes vêm do Google: o PDF só sai depois que elas chegaram, senão a
       primeira página sairia na fonte do sistema. */
    await pagina.evaluate(() => document.fonts.ready.then(() => true));
    const pdf = await pagina.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: `${margem}cm`, bottom: `${margem}cm`, left: `${margem}cm`, right: `${margem}cm` },
      /* O número da página no canto de baixo, à direita, como na folha da
         tela. O rodapé do Chrome não carrega fonte de fora: vai a do sistema. */
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        `<div style="width:100%;padding:0 ${margem}cm;font-family:Arial,sans-serif;font-size:8px;font-weight:600;` +
        `color:#A4A6AB;text-align:right;"><span class="pageNumber"></span></div>`,
    });
    if (naNuvem() && pdf.length > TETO_PDF) {
      throw new Error(`O PDF ficou com ${Math.round(pdf.length / 1048576)} MB, acima do que dá para baixar daqui. Imagens menores resolvem.`);
    }
    const nome = nomeDoPdf(String(corpo.nome || ''));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.setHeader('Content-Length', String(pdf.length));
    res.status(200).send(Buffer.from(pdf));
  } catch (erro) {
    res.status(500).json({ erro: erro instanceof Error ? erro.message : String(erro) });
  } finally {
    if (pagina) await pagina.close().catch(() => {});
  }
}
