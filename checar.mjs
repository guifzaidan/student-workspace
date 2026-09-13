// ─────────────────────────────────────────────────────────────────────────────
//  Verificação de fumaça: carrega a página num DOM de verdade e navega por ela.
//
//  Existe por causa de uma quebra específica e silenciosa: tirar um elemento da
//  marcação deixa um `getElementById` devolvendo `null`, e a primeira chamada a
//  `.addEventListener` nele derruba o resto do script. A página abre, o desenho
//  aparece inteiro, e nada responde ao clique - sem nenhuma pista na tela.
//
//  Rodar: npm run checar
// ─────────────────────────────────────────────────────────────────────────────
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';

const erros = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => erros.push(String(e.message || e).split('\n')[0]));
vc.on('error', (...a) => erros.push('console.error: ' + a.join(' ')));

// O que o jsdom não implementa, e que não é problema do app.
const remendo = `
  window.matchMedia = window.matchMedia || function (q) {
    return { matches: false, media: q, addEventListener(){}, removeEventListener(){},
             addListener(){}, removeListener(){} };
  };
  window.fetch = function () { return Promise.reject(new Error('sem rede na verificação')); };
  Element.prototype.scrollTo = Element.prototype.scrollTo || function () {};
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {};
  window.__faltando = [];
  var __acha = document.getElementById.bind(document);
  document.getElementById = function (id) {
    var el = __acha(id);
    if (!el) window.__faltando.push(id);
    return el;
  };
`;

const html = readFileSync('index.html', 'utf8').replace('<script>', '<script>' + remendo);
const { window } = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost:5173/',
  virtualConsole: vc,
});
const doc = window.document;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
await esperar(400);

let falhou = false;
const dizer = (ok, texto) => {
  if (!ok) falhou = true;
  console.log(`${ok ? '  ok ' : '  X  '} ${texto}`);
};

console.log('\ncarga');
dizer(!erros.length, erros.length ? `erros: ${[...new Set(erros)].join(' | ')}` : 'script inteiro rodou sem exceção');

const ausentes = [...new Set(window.__faltando || [])];
if (ausentes.length) {
  console.log(`  ~   ids buscados e ausentes (tolerados): ${ausentes.join(', ')}`);
}

console.log('\nnavegação pelo menu');
const itens = [...doc.querySelectorAll('[data-ir]')];
dizer(itens.length > 0, `${itens.length} itens de menu`);
for (const botao of itens) {
  const alvo = botao.dataset.ir;
  botao.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await esperar(400);
  const visiveis = [...doc.querySelectorAll('[data-pagina]')].filter((p) => !p.hidden).map((p) => p.dataset.pagina);
  dizer(visiveis.length === 1 && visiveis[0] === alvo, `${alvo} -> ${visiveis.join(',') || '(nenhuma)'}`);
}

console.log('\nestado sem banco');
// A semente saiu da página: o banco é a única fonte. Sem rede, o certo é a tela
// vazia com a faixa de falha, e não conteúdo inventado.
const faixa = doc.getElementById('faixaFalha');
dizer(!!faixa && !faixa.hidden, 'a faixa de falha aparece quando a carga não volta');
const vazioPastas = doc.getElementById('vazioPastas');
dizer(!!vazioPastas && !vazioPastas.hidden, 'o estado vazio de pastas aparece');
dizer(doc.querySelectorAll('.dux-spinner-row').length === 0, 'nenhum giro ficou girando');
dizer(!!doc.getElementById('btnTentarDeNovo'), 'existe a saída para tentar de novo');

console.log('\nníveis dentro de uma tela');
// Só dá para descer níveis com dado, e dado vem do banco. Para cobrir esta
// parte, deixe `npm run dev` rodando noutra aba antes desta verificação.
const pastas = itens.find((b) => b.dataset.ir === 'pastas');
if (pastas) {
  pastas.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await esperar(400);
}
const cartao = doc.querySelector('.pasta-abrir') || doc.querySelector('.pasta-card');
if (!cartao) {
  console.log('  ~   sem pastas carregadas, então não há níveis para descer');
} else {
  cartao.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await esperar(400);
  const vista = [...doc.querySelectorAll('[data-vista]')].filter((v) => !v.hidden).map((v) => v.dataset.vista);
  dizer(vista.includes('pasta'), `abrir uma pasta -> vista ${vista.join(',') || '(nenhuma)'}`);
  const linha = doc.querySelector('.arquivo-linha');
  if (linha) {
    linha.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await esperar(400);
    const v2 = [...doc.querySelectorAll('[data-vista]')].filter((v) => !v.hidden).map((v) => v.dataset.vista);
    dizer(v2.includes('arquivo'), `abrir um arquivo -> vista ${v2.join(',') || '(nenhuma)'}`);
    const corpo = doc.getElementById('arquivoCorpo');
    dizer(!!corpo && corpo.isContentEditable !== false, 'o corpo do arquivo é editável');
  }
}


console.log(`\n${falhou ? 'FALHOU' : 'TUDO CERTO'}\n`);
process.exit(falhou ? 1 : 0);
