// ─────────────────────────────────────────────────────────────────────────────
//  O quarto de estudos: a tela inicial em 3D.
//
//  Um diorama isométrico, de canto, com os objetos que levam ao resto do app:
//
//    estante        cada pasta é um livro, com o nome na lombada   → a pasta
//    fichário       a fila de hoje, e uma divisória por deck        → a revisão
//    relógio        a hora de verdade, e o anel do Pomodoro         → o Pomodoro
//    calendário     o dia de hoje e os planos                       → os planos
//    prancheta      a prova, e uma folha por questão                → as questões
//    monitor        os cards revisados na semana                    → os decks
//
//  Tudo é modelado aqui, sem arquivo de modelo para baixar: o quarto abre junto
//  com a página e tem as cores da casa. O three.js vem por import dinâmico, num
//  pedaço à parte, para não atrasar a primeira pintura do app.
//
//  O app conversa com isto por `window.sinapseQuarto` (o estado e as portas),
//  montado pelo script principal, e avisa com o evento `sinapse:dados` quando
//  o acervo muda.
// ─────────────────────────────────────────────────────────────────────────────

const caixa = document.getElementById('quarto');
const ponte = window.sinapseQuarto;

if (caixa && ponte) iniciar().catch((e) => {
  /* Sem WebGL (ou com ele quebrado) o quarto não aparece. */
  console.warn('[quarto] sem 3D:', e);
  caixa.classList.add('sem-3d');
});

async function iniciar() {
  const [THREE, { RoundedBoxGeometry }, { RoomEnvironment }] = await Promise.all([
    import('three'),
    import('three/examples/jsm/geometries/RoundedBoxGeometry.js'),
    import('three/examples/jsm/environments/RoomEnvironment.js'),
  ]);
  await document.fonts.load('800 40px Manrope').catch(() => {});
  await document.fonts.load('800 40px "Bricolage Grotesque"').catch(() => {});

  const calmo = matchMedia('(prefers-reduced-motion: reduce)');
  const palco = caixa.querySelector('.quarto-palco');
  const dica = caixa.querySelector('.quarto-dica');

  // ── O motor ────────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  /* A sombra depende do sol e dos objetos, não da câmera: refazê-la a todo
     quadro, durante o voo do zoom, era o maior custo da cena. Ela é refeita só
     quando algo se mexe (ver `sombraSuja` no laço). */
  renderer.shadowMap.autoUpdate = false;
  let sombraSuja = true;
  /* O Neutral segura as cores da casa (o lima não desbota como no ACES). */
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.className = 'quarto-tela';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  palco.appendChild(renderer.domElement);

  const cena = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  cena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  cena.environmentIntensity = 0.35;

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const ALVO = new THREE.Vector3(-0.2, 2.35, -0.5);
  const DIRECAO = new THREE.Vector3(1, 0.86, 1).normalize();

  // ── Cores e materiais ─────────────────────────────────────────────────────
  /* Cores de quarto de verdade: parede em branco quente, piso de carvalho,
     móveis em carvalho e nogueira, tecidos em tons de lã e linho, plantas num
     verde de folha. O lima da casa fica só no que responde ao toque (o
     relógio, a caixa de cards, o monitor, as etiquetas), e é isso, mais um
     brilho próprio bem leve nesses objetos (ver `alvo`), que os destaca do
     resto sem gritar. Os livros são as pastas: têm cor de capa de verdade. */
  const COR = {
    parede: '#E9E2D6', paredeCorte: '#F3EEE6', rodape: '#CFC3AF',
    piso: '#B8946E', pisoCorte: '#8F7154',
    madeira: '#A87A50', madeiraEsc: '#6E4A30', madeiraClara: '#CFAE85',
    tinta: '#1C1D20', grafite: '#3B3D42', creme: '#F2ECE2', branco: '#FAFAF7',
    lima: '#C6F36B', limaEsc: '#9BD43A', cortica: '#B9895A', terracota: '#B5603E',
    folha: '#4A7337', folhaClara: '#6A9450', tapete: '#E7DED0', tapeteBorda: '#8C9A6B',
    salvia: '#8C9A6B', mostarda: '#B9924E', linho: '#D9CFBE', caqui: '#A39C7C', latao: '#B8955A',
  };
  const LIVROS = ['#2C3A57', '#7E9F4E', '#A9483A', '#D4A03E', '#53779B', '#6E5275', '#365F47', '#D6CFC0', '#1F2024', '#C48A84'];

  const materiais = new Map();
  function mat(cor, { rug = 0.82, metal = 0, ...resto } = {}) {
    const chave = cor + rug + metal + JSON.stringify(resto);
    if (!materiais.has(chave)) {
      materiais.set(chave, new THREE.MeshStandardMaterial({ color: cor, roughness: rug, metalness: metal, ...resto }));
    }
    return materiais.get(chave);
  }

  function peca(geo, material, { sombra = true, recebe = true } = {}) {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = sombra;
    m.receiveShadow = recebe;
    return m;
  }
  const caixaR = (l, a, p, r = 0.04, seg = 3) => new RoundedBoxGeometry(l, a, p, seg, Math.min(r, l / 2, a / 2, p / 2));
  function bloco(l, a, p, cor, x, y, z, op = {}) {
    // O raio e o "reto" são da forma; o resto vai para o material.
    const { r, reto, material, ...doMaterial } = op;
    const m = peca(reto ? new THREE.BoxGeometry(l, a, p) : caixaR(l, a, p, r ?? 0.04), material ?? mat(cor, doMaterial));
    m.position.set(x, y, z);
    return m;
  }

  /* Texto e desenho viram textura por um canvas: é o que deixa a lombada ter
     o nome da pasta e a tela do monitor ter o gráfico de verdade. */
  function tela(l, a, desenhar) {
    const c = document.createElement('canvas');
    c.width = l; c.height = a;
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const redesenhar = (...args) => { desenhar(c.getContext('2d'), l, a, ...args); tx.needsUpdate = true; };
    redesenhar();
    /* Sobe para a GPU agora, e não no primeiro quadro em que aparece: no
       meio do voo do zoom, a subida de várias texturas era um salto. */
    renderer.initTexture(tx);
    return { tx, redesenhar };
  }
  function cortar(ctx, texto, largura) {
    if (ctx.measureText(texto).width <= largura) return texto;
    while (texto.length > 1 && ctx.measureText(texto + '…').width > largura) texto = texto.slice(0, -1);
    return texto.trimEnd() + '…';
  }
  function claro(cor) {
    const c = new THREE.Color(cor);
    return c.r * 0.299 + c.g * 0.587 + c.b * 0.114 > 0.6;
  }
  function arredondado(ctx, x, y, l, a, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, l, a, r);
  }

  // ── O quarto ──────────────────────────────────────────────────────────────
  const sala = new THREE.Group();
  cena.add(sala);
  const entradas = [];   // o que surge na abertura, com o atraso de cada um
  const entra = (obj, atraso, queda = 1.4) => { entradas.push({ obj, atraso, queda, y: obj.position.y }); return obj; };

  const L = 10, ALT = 6, ESP = 0.3;

  // O piso de tábuas: uma placa grossa com a borda mais escura, e as frestas
  // desenhadas numa textura.
  const tabuas = tela(1024, 1024, (ctx, l, a) => {
    ctx.fillStyle = COR.piso; ctx.fillRect(0, 0, l, a);
    const n = 12, h = a / n;
    for (let i = 0; i < n; i++) {
      const tom = 0.94 + ((i * 37) % 7) / 60;
      ctx.fillStyle = `rgba(${Math.round(184 * tom)}, ${Math.round(148 * tom)}, ${Math.round(110 * tom)}, 1)`;
      ctx.fillRect(0, i * h, l, h);
      ctx.fillStyle = 'rgba(80, 52, 30, .28)';
      ctx.fillRect(0, i * h, l, 2);
      const corte = ((i * 389) % 700) + 150;
      ctx.fillRect(corte, i * h, 2, h);
    }
  });
  const piso = peca(new THREE.BoxGeometry(L, 0.4, L), [
    mat(COR.pisoCorte), mat(COR.pisoCorte),
    new THREE.MeshStandardMaterial({ map: tabuas.tx, roughness: 0.7 }),
    mat(COR.pisoCorte), mat(COR.pisoCorte), mat(COR.pisoCorte),
  ], { sombra: false });
  piso.position.set(0, -0.2, 0);
  sala.add(piso);

  /* A sombra no papel: um quadrado bem desfocado embaixo do piso, puxado um
     pouco para a frente (a luz vem de trás). É o que assenta o quarto no fundo
     da página, em vez de ele parecer recortado e colado ali. */
  const sombraPapel = tela(512, 512, (ctx, l, a) => {
    ctx.clearRect(0, 0, l, a);
    ctx.shadowColor = "rgba(0, 0, 0, 1)";
    ctx.shadowBlur = 70;
    ctx.fillStyle = "rgba(0, 0, 0, 1)";
    ctx.fillRect(l * 0.22, a * 0.22, l * 0.56, a * 0.56);
  });
  const chaoSombra = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.75, L * 1.75),
    new THREE.MeshBasicMaterial({ color: "#2A2014", alphaMap: sombraPapel.tx, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false }));
  chaoSombra.rotation.x = -Math.PI / 2;
  chaoSombra.position.set(0.7, -0.45, 0.7);
  chaoSombra.renderOrder = -1;
  sala.add(chaoSombra);

  // As paredes, com um vão para a janela na do fundo.
  const JAN = { x: 0.6, l: 2.8, y0: 2.3, y1: 4.7 };
  const paredeMat = [mat(COR.paredeCorte), mat(COR.paredeCorte), mat(COR.paredeCorte), mat(COR.paredeCorte), mat(COR.parede), mat(COR.parede)];
  function parede(l, a, p, x, y, z) {
    const m = peca(new THREE.BoxGeometry(l, a, p), paredeMat);
    m.position.set(x, y, z);
    sala.add(m);
  }
  const zF = -L / 2 - ESP / 2, xE = -L / 2 - ESP / 2;
  const jE = JAN.x - JAN.l / 2, jD = JAN.x + JAN.l / 2;
  parede(jE + L / 2, ALT, ESP, (-L / 2 + jE) / 2, ALT / 2, zF);
  parede(L / 2 - jD, ALT, ESP, (jD + L / 2) / 2, ALT / 2, zF);
  parede(JAN.l, JAN.y0, ESP, JAN.x, JAN.y0 / 2, zF);
  parede(JAN.l, ALT - JAN.y1, ESP, JAN.x, (ALT + JAN.y1) / 2, zF);
  const lateral = peca(new THREE.BoxGeometry(ESP, ALT, L + ESP), [mat(COR.parede), mat(COR.parede), mat(COR.paredeCorte), mat(COR.paredeCorte), mat(COR.paredeCorte), mat(COR.paredeCorte)]);
  lateral.position.set(xE, ALT / 2, -ESP / 2);
  sala.add(lateral);
  // Rodapés.
  sala.add(bloco(L, 0.18, 0.06, COR.rodape, 0, 0.09, -L / 2 + 0.03, { reto: true }));
  sala.add(bloco(0.06, 0.18, L, COR.rodape, -L / 2 + 0.03, 0.09, 0, { reto: true }));
  /* As paredes em dois tons: um lambri mais escuro até a altura da mesa e um
     friso claro em cima dele. Dá acabamento e assenta os móveis na parede. */
  const LAMBRI = 1.3, corLambri = '#DCD2C2';
  sala.add(bloco(L, LAMBRI, 0.02, corLambri, 0, LAMBRI / 2, -L / 2 + 0.011, { reto: true, rug: 0.9 }));
  sala.add(bloco(0.02, LAMBRI, L, corLambri, -L / 2 + 0.011, LAMBRI / 2, 0, { reto: true, rug: 0.9 }));
  sala.add(bloco(L, 0.06, 0.05, COR.paredeCorte, 0, LAMBRI + 0.03, -L / 2 + 0.025, { r: 0.015 }));
  sala.add(bloco(0.05, 0.06, L, COR.paredeCorte, -L / 2 + 0.025, LAMBRI + 0.03, 0, { r: 0.015 }));

  // A janela: moldura, vidro e o céu lá fora, que segue a hora do dia.
  const janela = new THREE.Group();
  const mold = COR.branco;
  janela.add(bloco(JAN.l + 0.2, 0.14, 0.42, mold, JAN.x, JAN.y0 - 0.02, zF + 0.12));
  janela.add(bloco(JAN.l + 0.2, 0.12, 0.2, mold, JAN.x, JAN.y1, zF));
  janela.add(bloco(0.12, JAN.y1 - JAN.y0, 0.2, mold, jE - 0.04, (JAN.y0 + JAN.y1) / 2, zF));
  janela.add(bloco(0.12, JAN.y1 - JAN.y0, 0.2, mold, jD + 0.04, (JAN.y0 + JAN.y1) / 2, zF));
  janela.add(bloco(0.06, JAN.y1 - JAN.y0, 0.1, mold, JAN.x, (JAN.y0 + JAN.y1) / 2, zF));
  janela.add(bloco(JAN.l, 0.06, 0.1, mold, JAN.x, (JAN.y0 + JAN.y1) / 2 + 0.2, zF));
  /* Vidro simples, transparente. Com `transmission` (MeshPhysicalMaterial) o
     three.js renderiza a cena inteira mais uma vez a cada quadro, só para a
     refração, e a 18% de opacidade ela nem se vê. */
  const vidro = new THREE.Mesh(new THREE.PlaneGeometry(JAN.l, JAN.y1 - JAN.y0),
    new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false }));
  vidro.position.set(JAN.x, (JAN.y0 + JAN.y1) / 2, zF + 0.02);
  janela.add(vidro);
  /* O céu da janela pinta o momento do dia (ver "O tempo lá fora"): o degradê
     do alto para o horizonte, as estrelas e a lua que vão aparecendo com a
     noite, e as nuvens e o morro, que escurecem junto. */
  const ceu = tela(512, 512, (ctx, l, a, m = { topo: '#9FD1F5', base: '#F7EBD3', noite: 0 }) => {
    const g = ctx.createLinearGradient(0, 0, 0, a);
    g.addColorStop(0, m.topo); g.addColorStop(1, m.base);
    ctx.fillStyle = g; ctx.fillRect(0, 0, l, a);
    if (m.noite > 0.05) {
      ctx.fillStyle = '#FFFFFF';
      for (let i = 0; i < 70; i++) {
        const x = (i * 97) % l, y = (i * 53) % (a * 0.8), r = (i % 3) * 0.5 + 0.6;
        ctx.globalAlpha = (0.35 + (i % 5) / 8) * m.noite; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = m.noite; ctx.fillStyle = '#F4F1E3'; ctx.beginPath(); ctx.arc(l * 0.72, a * 0.26, 34, 0, 7); ctx.fill();
      ctx.fillStyle = m.topo; ctx.beginPath(); ctx.arc(l * 0.72 + 16, a * 0.26 - 10, 30, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (m.noite < 0.95) {
      ctx.globalAlpha = 0.9 * (1 - m.noite);
      ctx.fillStyle = '#FFFFFF';
      for (const [x, y, s] of [[110, 140, 1], [330, 90, 0.8], [400, 210, 0.6]]) {
        for (const [dx, dy, r] of [[0, 0, 34], [32, -12, 28], [62, 4, 30], [28, 12, 30]]) {
          ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, 7); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#' + new THREE.Color('#B9D8A0').lerp(new THREE.Color('#2E3A4E'), m.noite).getHexString();
    ctx.beginPath(); ctx.moveTo(0, a); ctx.quadraticCurveTo(l * 0.3, a * 0.72, l * 0.6, a * 0.84); ctx.quadraticCurveTo(l * 0.85, a * 0.74, l, a * 0.8); ctx.lineTo(l, a); ctx.fill();
  });
  const fora = new THREE.Mesh(new THREE.PlaneGeometry(JAN.l + 0.3, JAN.y1 - JAN.y0 + 0.3), new THREE.MeshBasicMaterial({ map: ceu.tx, toneMapped: false }));
  fora.position.set(JAN.x, (JAN.y0 + JAN.y1) / 2, zF - ESP / 2 - 0.01);
  janela.add(fora);
  // Cortina, presa num varão.
  janela.add(bloco(JAN.l + 1.4, 0.05, 0.05, COR.grafite, JAN.x, JAN.y1 + 0.35, zF + 0.32, { r: 0.02, metal: 0.6, rug: 0.4 }));
  for (const lado of [-1, 1]) {
    const cortina = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const f = peca(new THREE.CylinderGeometry(0.09, 0.11, JAN.y1 - JAN.y0 + 0.9, 12), mat('#EDE6D8', { rug: 1 }));
      f.position.set(i * 0.15 * lado, 0, (i % 2) * 0.06);
      cortina.add(f);
    }
    cortina.position.set(JAN.x + lado * (JAN.l / 2 + 0.45), (JAN.y0 + JAN.y1) / 2 - 0.05, zF + 0.4);
    janela.add(cortina);
  }
  sala.add(janela);

  // O tapete, redondo, com a borda lima.
  const tramaTapete = tela(1024, 1024, (ctx, l, a) => {
    const c = l / 2;
    const aneis = [[c, '#3A3631'], [c * 0.93, COR.salvia], [c * 0.8, '#ECE4D6'], [c * 0.62, COR.salvia], [c * 0.56, '#ECE4D6'], [c * 0.3, '#E2D6C2']];
    for (const [r, cor] of aneis) { ctx.fillStyle = cor; ctx.beginPath(); ctx.arc(c, c, r, 0, 7); ctx.fill(); }
    // Pontinhos tecidos no miolo.
    ctx.fillStyle = 'rgba(18, 19, 22, .14)';
    for (let i = 0; i < 900; i++) {
      const g = i * 2.399, r = Math.sqrt(i / 900) * c * 0.78;
      ctx.beginPath(); ctx.arc(c + Math.cos(g) * r, c + Math.sin(g) * r, 3, 0, 7); ctx.fill();
    }
  });
  const tapete = new THREE.Group();
  const trama = new THREE.MeshStandardMaterial({ map: tramaTapete.tx, roughness: 1 });
  tapete.add(peca(new THREE.CylinderGeometry(2.3, 2.3, 0.05, 72), [mat('#3A3631', { rug: 1 }), trama, trama], { sombra: false }));
  // Embaixo do canto de leitura, que ele ancora.
  tapete.scale.set(0.86, 1, 0.86);
  tapete.position.set(-2.6, 0.02, 3.0);
  sala.add(entra(tapete, 0.05, 0.4));

  // ── Interação ─────────────────────────────────────────────────────────────
  /* Cada objeto que leva a algum lugar é um "alvo": título e linha de baixo
     para o balão, a porta que ele abre, e o jeito de reagir ao ponteiro (de 0
     a 1, amortecido). Os materiais dele são cópias, para o brilho do realce
     acender só nele. */
  const alvos = [];
  const LIMA = new THREE.Color(COR.lima), realce = new THREE.Color();
  /* O brilho próprio de um alvo: um tanto da cor dele, para ficar um pouco
     acima do resto do quarto. Quem tem textura (a lombada, a tela, o
     mostrador) já tem a cor nela, e ganha só um véu claro. Calculado na
     primeira vez, porque alguns materiais trocam depois de o alvo nascer. */
  const brilhoDe = (m) => m.userData.brilho ??= (m.map ? new THREE.Color('#FFFFFF') : m.color.clone()).multiplyScalar(m.map ? 0.05 : 0.09);
  /* A cena de cada alvo é o objeto que o zoom enquadra; os livros e as
     divisórias dos decks são "itens", que se escolhem um a um dentro dele. */
  const CENA_DO_PREFIXO = [
    ['pasta', 'estante'], ['arquivo:', 'estante'], ['deck:', 'mesa'], ['carta:', 'mesa'], ['revisao', 'mesa'],
    ['questao:', 'mural'], ['questoes', 'mural'], ['sessao:', 'calendario'], ['planos', 'calendario'],
    ['dia:', 'monitor'], ['decks', 'monitor'], ['pomodoro', 'relogio'],
  ];
  const cenaDe = (id) => CENA_DO_PREFIXO.find(([p]) => id.startsWith(p))?.[1] ?? id;
  /* Nível 1: o que se escolhe dentro do objeto (livro, divisória, folha,
     etiqueta, barra). Nível 2: o que se escolhe dentro dele (o card do leque,
     a ficha do livro aberto). */
  const NIVEL1 = ['pasta:', 'deck:', 'questao:', 'sessao:', 'dia:'], NIVEL2 = ['carta:', 'arquivo:'];
  function alvo(grupo, def) {
    const nivel = NIVEL2.some((p) => def.id.startsWith(p)) ? 2 : NIVEL1.some((p) => def.id.startsWith(p)) ? 1 : 0;
    const a = { grupo, foco: 0, quer: 0, cena: cenaDe(def.id), item: nivel > 0, nivel, ...def };
    grupo.userData.alvo = a;
    a.materiais = [];
    grupo.traverse((o) => {
      if (!o.isMesh || o.userData.semRealce) return;
      if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone());
      else o.material = o.material.clone();
      for (const m of [].concat(o.material)) if (m.emissive) a.materiais.push(m);
    });
    alvos.push(a);
    return a;
  }

  // ── A mesa ────────────────────────────────────────────────────────────────
  const MESA = { x: 0.6, z: -3.85, l: 4.2, p: 1.6, a: 1.55 };
  const mesa = new THREE.Group();
  mesa.add(bloco(MESA.l, 0.12, MESA.p, COR.madeira, 0, MESA.a, 0, { r: 0.05 }));
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    mesa.add(bloco(0.1, MESA.a, 0.1, COR.tinta, dx * (MESA.l / 2 - 0.18), MESA.a / 2, dz * (MESA.p / 2 - 0.15), { r: 0.03, rug: 0.5, metal: 0.3 }));
  }
  // Gaveteiro do lado direito.
  mesa.add(bloco(1.0, 0.9, 1.3, COR.madeiraClara, MESA.l / 2 - 0.65, 1.0, 0, { r: 0.05 }));
  mesa.add(bloco(0.86, 0.36, 0.04, COR.madeira, MESA.l / 2 - 0.65, 1.2, 0.66, { r: 0.02 }));
  mesa.add(bloco(0.86, 0.36, 0.04, COR.madeira, MESA.l / 2 - 0.65, 0.78, 0.66, { r: 0.02 }));
  for (const y of [1.2, 0.78]) mesa.add(bloco(0.26, 0.04, 0.05, COR.grafite, MESA.l / 2 - 0.65, y, 0.7, { r: 0.015, metal: 0.7, rug: 0.3 }));
  mesa.position.set(MESA.x, 0, MESA.z);
  sala.add(entra(mesa, 0.12));
  const topoMesa = MESA.a + 0.06;

  // A cadeira.
  const cadeira = new THREE.Group();
  cadeira.add(bloco(1.0, 0.14, 0.95, COR.tinta, 0, 0.95, 0, { r: 0.07, rug: 0.6 }));
  cadeira.add(bloco(0.95, 0.12, 0.85, '#55604B', 0, 1.05, 0, { r: 0.06, rug: 1 }));
  cadeira.add(bloco(1.0, 1.1, 0.12, COR.tinta, 0, 1.6, 0.48, { r: 0.07, rug: 0.6 }));
  cadeira.add(bloco(0.08, 0.85, 0.08, COR.grafite, 0, 0.47, 0, { r: 0.03, metal: 0.6, rug: 0.35 }));
  for (let i = 0; i < 5; i++) {
    const p = bloco(0.62, 0.06, 0.08, COR.grafite, 0.3, 0.08, 0, { r: 0.03, metal: 0.6, rug: 0.35 });
    const braco = new THREE.Group();
    braco.add(p);
    braco.rotation.y = (i / 5) * Math.PI * 2;
    cadeira.add(braco);
  }
  cadeira.position.set(MESA.x - 0.3, 0, MESA.z + 1.75);
  cadeira.rotation.y = 0.25;
  sala.add(entra(cadeira, 0.2));

  // A luminária, com a luz quente de verdade.
  const luminaria = new THREE.Group();
  luminaria.add(bloco(0.5, 0.06, 0.4, COR.tinta, 0, 0.03, 0, { r: 0.03, rug: 0.4, metal: 0.3 }));
  const haste = bloco(0.05, 1.1, 0.05, COR.tinta, 0, 0.55, 0, { r: 0.02, metal: 0.5, rug: 0.35 });
  haste.rotation.z = -0.18;
  luminaria.add(haste);
  const cupula = new THREE.Group();
  const cone = peca(new THREE.ConeGeometry(0.3, 0.42, 32, 1, true), mat(COR.latao, { side: THREE.DoubleSide, rug: 0.35, metal: 0.55 }));
  cone.rotation.z = 0.5;
  cupula.add(cone);
  const lampada = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), new THREE.MeshStandardMaterial({ color: '#FFF4D6', emissive: '#FFD9A0', emissiveIntensity: 2 }));
  lampada.position.set(-0.08, -0.12, 0);
  cupula.add(lampada);
  cupula.position.set(-0.18, 1.12, 0);
  luminaria.add(cupula);
  const luzMesa = new THREE.PointLight('#FFC98A', 3, 6, 1.6);
  luzMesa.position.set(-0.3, 0.95, 0.05);
  luminaria.position.set(MESA.x + 1.8, topoMesa, MESA.z - 0.3);
  /* A luz fica solta no quarto, e não dentro da luminária: quando a luminária
     some no zoom da estante, uma luz a menos na cena obrigaria o three.js a
     recompilar o shader de todo material, e era um quadro de quase um segundo. */
  luzMesa.position.add(luminaria.position);
  sala.add(luzMesa);
  sala.add(entra(luminaria, 0.35));

  // Caneca e um vasinho, para a mesa ter vida.
  const caneca = new THREE.Group();
  caneca.add(peca(new THREE.CylinderGeometry(0.12, 0.11, 0.26, 24), mat(COR.creme, { rug: 0.4 })));
  const asa = peca(new THREE.TorusGeometry(0.07, 0.022, 10, 20), mat(COR.creme, { rug: 0.4 }));
  asa.position.x = 0.14;
  caneca.add(asa);
  const cafe = peca(new THREE.CylinderGeometry(0.105, 0.105, 0.01, 24), mat('#5A3A22', { rug: 0.2 }), { sombra: false });
  cafe.position.y = 0.11;
  caneca.add(cafe);
  caneca.position.set(MESA.x + 1.25, topoMesa + 0.13, MESA.z + 0.5);
  sala.add(entra(caneca, 0.45));

  function fazerPlanta(escala) {
    const g = new THREE.Group();
    g.add(peca(new THREE.CylinderGeometry(0.32, 0.24, 0.5, 24), mat(COR.terracota, { rug: 0.9 })));
    const terra = peca(new THREE.CylinderGeometry(0.29, 0.29, 0.04, 24), mat('#4A3527'), { sombra: false });
    terra.position.y = 0.22;
    g.add(terra);
    const folhas = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const f = peca(new THREE.SphereGeometry(0.16, 12, 8), mat(i % 2 ? COR.folha : COR.folhaClara, { rug: 0.7 }));
      f.scale.set(0.6, 1.9, 0.25);
      const giro = (i / 9) * Math.PI * 2;
      f.position.set(Math.cos(giro) * 0.14, 0.55 + (i % 3) * 0.08, Math.sin(giro) * 0.14);
      f.rotation.set(Math.sin(giro) * 0.55, -giro, Math.cos(giro) * -0.55);
      folhas.add(f);
    }
    g.add(folhas);
    g.userData.folhas = folhas;
    g.scale.setScalar(escala);
    return g;
  }
  function planta(escala, x, y, z, atraso) {
    const g = fazerPlanta(escala);
    g.position.set(x, y + 0.25 * escala, z);
    sala.add(entra(g, atraso));
    return g;
  }
  const plantas = [
    planta(0.45, MESA.x + 1.15, topoMesa, MESA.z - 0.55, 0.5),
    planta(1.25, 4.1, 0, -4.1, 0.3),
  ];

  // ── A vida do quarto ──────────────────────────────────────────────────────
  /* O que não leva a lugar nenhum, mas faz o quarto ser de alguém: o canto de
     leitura com poltrona e luminária, o pufe, a mochila largada, a lixeira
     com rascunhos, os livros no chão, os quadros e o pisca-pisca no alto da
     parede. Nada disso é alvo: o ponteiro passa. */
  const decor = (obj, atraso, queda = 1.2) => { sala.add(entra(obj, atraso, queda)); return obj; };

  /* O quarto em duas zonas, com o chão da frente livre: o estudo na parede
     do fundo (mesa, mochila, lixeira) e a leitura no canto da frente à
     esquerda, toda sobre o tapete (poltrona, abajur, mesinha, o pufe e os
     livros do chão). A parede da esquerda fica só para a estante e o mural. */

  // O canto de leitura, sobre o tapete, virado para quem olha.
  const poltrona = new THREE.Group();
  poltrona.add(bloco(1.3, 0.42, 1.2, '#4A4D52', 0, 0.36, 0, { r: 0.12, rug: 0.95 }));
  poltrona.add(bloco(1.15, 0.2, 1.0, COR.linho, 0, 0.66, 0.05, { r: 0.09, rug: 1 }));
  poltrona.add(bloco(1.3, 0.95, 0.24, '#4A4D52', 0, 0.92, -0.5, { r: 0.12, rug: 0.95 }));
  for (const lado of [-1, 1]) poltrona.add(bloco(0.2, 0.62, 1.2, '#4A4D52', lado * 0.62, 0.62, 0, { r: 0.09, rug: 0.95 }));
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) poltrona.add(bloco(0.07, 0.18, 0.07, COR.madeiraEsc, dx * 0.5, 0.09, dz * 0.45, { r: 0.02 }));
  poltrona.add(bloco(0.5, 0.36, 0.14, COR.mostarda, -0.22, 0.88, -0.32, { r: 0.07, rug: 1 }));   // a almofada
  poltrona.position.set(-3.75, 0, 3.85);
  poltrona.rotation.y = Math.PI / 4;
  decor(poltrona, 0.55);

  const luzLeitura = new THREE.Group();
  luzLeitura.add(peca(new THREE.CylinderGeometry(0.22, 0.26, 0.05, 20), mat(COR.tinta, { rug: 0.4, metal: 0.3 })));
  const hasteLeitura = bloco(0.04, 2.3, 0.04, COR.tinta, 0, 1.15, 0, { r: 0.015, metal: 0.4, rug: 0.4 });
  luzLeitura.add(hasteLeitura);
  const cupulaLeitura = peca(new THREE.CylinderGeometry(0.2, 0.36, 0.4, 24, 1, true), mat(COR.creme, { side: THREE.DoubleSide, rug: 1 }));
  cupulaLeitura.position.y = 2.35;
  luzLeitura.add(cupulaLeitura);
  const lampadaLeitura = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshStandardMaterial({ color: '#FFF4D6', emissive: '#FFD9A0', emissiveIntensity: 1 }));
  lampadaLeitura.position.y = 2.25;
  luzLeitura.add(lampadaLeitura);
  luzLeitura.position.set(-4.55, 0, 4.55);
  decor(luzLeitura, 0.6);

  const mesinha = new THREE.Group();
  mesinha.add(peca(new THREE.CylinderGeometry(0.36, 0.36, 0.05, 24), mat(COR.madeira, { rug: 0.6 })));
  mesinha.children[0].position.y = 0.62;
  mesinha.add(bloco(0.06, 0.6, 0.06, COR.tinta, 0, 0.3, 0, { r: 0.02, metal: 0.4 }));
  mesinha.add(peca(new THREE.CylinderGeometry(0.22, 0.24, 0.03, 20), mat(COR.tinta, { metal: 0.4 })));
  [[LIVROS[3], 0.66], [LIVROS[0], 0.72]].forEach(([cor, y], i) => {
    const b = bloco(0.42, 0.06, 0.3, cor, -0.04, y, 0, { r: 0.015 });
    b.rotation.y = i * 0.35;
    mesinha.add(b);
  });
  const xicara = peca(new THREE.CylinderGeometry(0.07, 0.06, 0.12, 16), mat(COR.creme, { rug: 0.35 }));
  xicara.position.set(0.17, 0.71, 0.12);
  mesinha.add(xicara);
  mesinha.position.set(-2.45, 0, 4.5);
  decor(mesinha, 0.65);

  // O pufe, no tapete ao lado da poltrona, e livros largados ao lado dele.
  const pufe = new THREE.Group();
  const bolsa = peca(new THREE.SphereGeometry(0.62, 24, 16), mat(COR.caqui, { rug: 1 }));
  bolsa.scale.set(1, 0.62, 1);
  bolsa.position.y = 0.36;
  pufe.add(bolsa);
  const afundado = peca(new THREE.SphereGeometry(0.38, 20, 12), mat('#8E8869', { rug: 1 }));
  afundado.scale.set(1, 0.3, 1);
  afundado.position.set(-0.05, 0.66, -0.05);
  pufe.add(afundado);
  pufe.position.set(-1.55, 0, 2.5);
  decor(pufe, 0.7);
  const livrosPufe = new THREE.Group();
  [[LIVROS[4], 0.42, 0.06], [LIVROS[2], 0.38, 0.06], [LIVROS[7], 0.34, 0.05]].forEach(([cor, l, a], i) => {
    const b = bloco(l, a, l * 0.72, cor, 0, a / 2 + i * 0.06, 0, { r: 0.012 });
    b.rotation.y = i * 0.5 - 0.3;
    livrosPufe.add(b);
  });
  livrosPufe.position.set(-0.85, 0, 3.55);
  decor(livrosPufe, 0.75);

  // A mochila, encostada no pé da mesa.
  const mochila = new THREE.Group();
  mochila.add(bloco(0.62, 0.78, 0.36, '#2E3A59', 0, 0.39, 0, { r: 0.14, rug: 0.9 }));
  mochila.add(bloco(0.46, 0.34, 0.12, '#3B4A70', 0, 0.28, 0.21, { r: 0.06, rug: 0.9 }));
  mochila.add(bloco(0.2, 0.05, 0.05, COR.mostarda, 0, 0.8, 0, { r: 0.02 }));
  mochila.position.set(-1.75, 0, -2.3);
  mochila.rotation.set(-0.12, 0.5, 0);
  decor(mochila, 0.6);

  // A lixeira, com os rascunhos que não deram certo, um caído fora.
  const lixeira = new THREE.Group();
  lixeira.add(peca(new THREE.CylinderGeometry(0.3, 0.24, 0.62, 20, 1, true), mat(COR.tinta, { side: THREE.DoubleSide, rug: 0.5 })));
  lixeira.children[0].position.y = 0.31;
  lixeira.add(peca(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 20), mat(COR.tinta)));
  for (const [x, y, z] of [[0.05, 0.6, 0.02], [-0.1, 0.56, -0.08], [0.55, 0.09, 0.35]]) {
    const bola = peca(new THREE.IcosahedronGeometry(0.1, 0), mat(COR.branco, { flatShading: true, rug: 1 }));
    bola.position.set(x, y, z);
    lixeira.add(bola);
  }
  lixeira.position.set(3.3, 0, -2.75);
  decor(lixeira, 0.65);

  // Uma pilha de livros no chão, ao lado da poltrona.
  const livrosChao = new THREE.Group();
  [[LIVROS[1], 0.7], [LIVROS[8], 0.62], [LIVROS[5], 0.66], [LIVROS[6], 0.55]].forEach(([cor, l], i) => {
    const b = bloco(l, 0.11, l * 0.72, cor, 0, 0.055 + i * 0.11, 0, { r: 0.015 });
    b.rotation.y = (i % 2 ? 0.25 : -0.15) + i * 0.08;
    livrosChao.add(b);
  });
  livrosChao.position.set(-4.4, 0, 1.95);
  decor(livrosChao, 0.7);

  // Dois quadros, um sobre o outro, alinhados na coluna do relógio.
  const quadroArte = tela(256, 340, (ctx, l, a) => {
    ctx.fillStyle = COR.creme; ctx.fillRect(0, 0, l, a);
    ctx.fillStyle = COR.salvia; ctx.beginPath(); ctx.arc(l * 0.62, a * 0.36, l * 0.26, 0, 7); ctx.fill();
    ctx.fillStyle = COR.tinta; ctx.fillRect(l * 0.16, a * 0.52, l * 0.5, a * 0.3);
    ctx.fillStyle = '#E86A4A'; ctx.beginPath(); ctx.moveTo(l * 0.18, a * 0.5); ctx.lineTo(l * 0.42, a * 0.18); ctx.lineTo(l * 0.66, a * 0.5); ctx.fill();
  });
  const quadroFrase = tela(256, 200, (ctx, l, a) => {
    ctx.fillStyle = COR.tinta; ctx.fillRect(0, 0, l, a);
    ctx.fillStyle = '#E8DFC8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 34px "Bricolage Grotesque"';
    ctx.fillText('um dia', l / 2, a * 0.36);
    ctx.fillText('de cada vez', l / 2, a * 0.62);
  });
  function pendurarQuadro(textura, l, a, x, y) {
    const g = new THREE.Group();
    g.add(bloco(l + 0.12, a + 0.12, 0.06, COR.madeiraEsc, 0, 0, 0, { r: 0.02 }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(l, a), new THREE.MeshStandardMaterial({ map: textura.tx, roughness: 0.8 }));
    face.position.z = 0.035;
    g.add(face);
    g.position.set(x, y, -L / 2 + 0.05);
    return decor(g, 0.75, 0.5);
  }
  pendurarQuadro(quadroArte, 0.62, 0.84, -3.1, 2.1);
  pendurarQuadro(quadroFrase, 0.74, 0.56, -3.1, 3.15);

  // O pisca-pisca, em curvas no alto da parede do fundo. Acende mais de noite.
  const piscaMats = ['#FFD9A0', '#FFEBC4'].map((cor) => new THREE.MeshStandardMaterial({ color: cor, emissive: cor, emissiveIntensity: 0.4 }));
  const pisca = new THREE.Group();
  const fioPontos = [];
  const NPISCA = 22;
  for (let i = 0; i < NPISCA; i++) {
    const t = i / (NPISCA - 1), x = -4.75 + t * 9.5;
    // Três curvas, cada uma caindo um pouco no meio.
    const trecho = (t * 3) % 1, y = 5.62 - Math.sin(trecho * Math.PI) * 0.32;
    fioPontos.push(new THREE.Vector3(x, y + 0.04, -L / 2 + 0.12));
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), piscaMats[i % 2]);
    b.position.set(x, y - 0.03, -L / 2 + 0.14);
    b.castShadow = false;
    pisca.add(b);
  }
  const fio = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(fioPontos), 120, 0.012, 5, false), mat(COR.grafite, { rug: 0.6 }));
  fio.castShadow = false;
  pisca.add(fio);
  decor(pisca, 0.9, 0.4);


  // ── O monitor (os números) ────────────────────────────────────────────────
  const telaMonitor = tela(768, 432, (ctx, l, a, e, sel = -1, hov = -1) => {
    const g = ctx.createLinearGradient(0, 0, 0, a);
    g.addColorStop(0, '#16181D'); g.addColorStop(1, '#0D0E11');
    ctx.fillStyle = g; ctx.fillRect(0, 0, l, a);
    ctx.fillStyle = '#F4F4F2'; ctx.font = '800 34px Manrope'; ctx.fillText('Esta semana', 40, 66);
    const sete = e?.sete ?? [];
    const total = sete.reduce((t, d) => t + d.n, 0);
    ctx.fillStyle = '#8E8F93'; ctx.font = '700 22px Manrope';
    ctx.fillText(e ? `${total} ${total === 1 ? 'card revisado' : 'cards revisados'}` : 'carregando…', 40, 102);
    const teto = Math.max(1, ...sete.map((d) => d.n));
    const base = a - 70, alto = base - 150, larg = (l - 80) / 7;
    sete.forEach((d, i) => {
      const h = Math.max(6, (d.n / teto) * alto);
      const aceso = sel >= 0 ? i === sel : d.hoje;
      ctx.fillStyle = aceso ? COR.lima : i === hov ? 'rgba(198, 243, 107, .65)' : sel >= 0 ? 'rgba(198, 243, 107, .22)' : 'rgba(198, 243, 107, .38)';
      arredondado(ctx, 40 + i * larg + 10, base - h, larg - 20, h, 8); ctx.fill();
      if (i === sel) {
        ctx.fillStyle = '#F4F4F2'; ctx.font = '800 20px Manrope'; ctx.textAlign = 'center';
        ctx.fillText(String(d.n), 40 + i * larg + larg / 2, base - h - 12);
      }
      ctx.fillStyle = aceso ? '#F4F4F2' : '#74756F'; ctx.font = '800 18px Manrope'; ctx.textAlign = 'center';
      ctx.fillText(String(d.dia).toUpperCase(), 40 + i * larg + larg / 2, a - 34);
      ctx.textAlign = 'left';
    });
    const escolhido = sete[sel];
    if (escolhido) {
      const pct = escolhido.n ? Math.round((escolhido.acertos / escolhido.n) * 100) + '% de acerto' : 'sem revisão';
      ctx.fillStyle = COR.lima; arredondado(ctx, l - 330, 38, 290, 46, 23); ctx.fill();
      ctx.fillStyle = COR.tinta; ctx.font = '800 20px Manrope'; ctx.textAlign = 'center';
      ctx.fillText(`${escolhido.data} · ${pct}`, l - 185, 68); ctx.textAlign = 'left';
    } else if (e && e.filaHoje) {
      ctx.fillStyle = COR.lima; arredondado(ctx, l - 250, 38, 210, 46, 23); ctx.fill();
      ctx.fillStyle = COR.tinta; ctx.font = '800 22px Manrope'; ctx.textAlign = 'center';
      ctx.fillText(`${e.filaHoje} na fila hoje`, l - 145, 69); ctx.textAlign = 'left';
    }
  });
  const monitor = new THREE.Group();
  monitor.add(bloco(1.75, 1.05, 0.08, COR.tinta, 0, 0.95, 0, { r: 0.05, rug: 0.35, metal: 0.2 }));
  const visor = new THREE.Mesh(new THREE.PlaneGeometry(1.63, 0.92), new THREE.MeshBasicMaterial({ map: telaMonitor.tx, toneMapped: false }));
  visor.position.set(0, 0.95, 0.045);
  visor.userData.semRealce = true;
  monitor.add(visor);
  monitor.add(bloco(0.12, 0.45, 0.1, COR.grafite, 0, 0.3, -0.05, { r: 0.03, metal: 0.6, rug: 0.3 }));
  monitor.add(bloco(0.7, 0.05, 0.42, COR.grafite, 0, 0.03, 0, { r: 0.025, metal: 0.6, rug: 0.3 }));
  // Teclado.
  monitor.add(bloco(1.0, 0.05, 0.36, COR.creme, 0.25, 0.03, 0.68, { r: 0.025, rug: 0.5 }));
  monitor.position.set(MESA.x, topoMesa, MESA.z - 0.3);
  sala.add(entra(monitor, 0.4));
  alvo(monitor, {
    id: 'decks', titulo: 'Desempenho dos decks',
    sub: (e) => `${e.decks.length} ${e.decks.length === 1 ? 'deck' : 'decks'} · revisões da semana na tela`,
    acao: () => ponte.abrir('decks'),
    ancora: new THREE.Vector3(0, 1.75, 0),
    animar(a) { monitor.position.y = topoMesa + a.foco * 0.06; },
  });

  // ── O fichário de flashcards (a revisão) ──────────────────────────────────
  /* Uma caixa de fichas de madeira, como as de estudar: os cards em pé com o
     "?" da pergunta, uma divisória com aba colorida por deck (é nela que se
     escolhe o deck, no zoom) e, encostada na frente, a ficha do dia com
     quantos cards esperam hoje. */
  const caixaCards = new THREE.Group();
  const FIC = { l: 0.98, p: 0.66, a: 0.34, e: 0.035 };
  {
    const cor = COR.madeiraClara, borda = COR.madeira;
    caixaCards.add(bloco(FIC.l, FIC.e, FIC.p, borda, 0, FIC.e / 2, 0, { r: 0.012, rug: 0.7 }));
    // A frente é mais baixa, para as fichas aparecerem.
    caixaCards.add(bloco(FIC.l, FIC.a * 0.62, FIC.e, cor, 0, (FIC.a * 0.62) / 2, FIC.p / 2, { r: 0.012, rug: 0.7 }));
    caixaCards.add(bloco(FIC.l, FIC.a, FIC.e, cor, 0, FIC.a / 2, -FIC.p / 2, { r: 0.012, rug: 0.7 }));
    for (const lado of [-1, 1]) caixaCards.add(bloco(FIC.e, FIC.a, FIC.p, cor, lado * FIC.l / 2, FIC.a / 2, 0, { r: 0.012, rug: 0.7 }));
    // O puxador de latão na frente.
    caixaCards.add(bloco(0.2, 0.05, 0.03, COR.latao, 0, FIC.a * 0.4, FIC.p / 2 + 0.03, { r: 0.012, rug: 0.35, metal: 0.7 }));
  }
  const cardsEmPe = new THREE.Group();
  caixaCards.add(cardsEmPe);
  // A frente de toda ficha de pergunta: a mesma textura para todas.
  const fichaPergunta = tela(256, 176, (ctx, l, a) => {
    ctx.fillStyle = COR.branco; ctx.fillRect(0, 0, l, a);
    ctx.fillStyle = COR.lima; ctx.fillRect(0, 0, l, 18);
    ctx.fillStyle = 'rgba(18,19,22,.12)';
    for (const y of [104, 128, 152]) ctx.fillRect(28, y, l - 56, 3);
    // O "?" no alto à esquerda: é a parte que fica acima da frente da caixa.
    ctx.fillStyle = COR.tinta; ctx.font = '800 62px "Bricolage Grotesque"'; ctx.textAlign = 'center';
    ctx.fillText('?', 62, 74);
  });
  const matPergunta = new THREE.MeshStandardMaterial({ map: fichaPergunta.tx, roughness: 0.9 });
  // A ficha do dia, encostada na frente da caixa.
  const fichaHoje = tela(320, 216, (ctx, l, a, e) => {
    const n = e?.filaHoje ?? 0;
    ctx.fillStyle = n ? COR.lima : '#EEF0E6'; ctx.fillRect(0, 0, l, a);
    ctx.fillStyle = 'rgba(18,19,22,.08)'; ctx.fillRect(0, a - 14, l, 14);
    ctx.fillStyle = COR.tinta; ctx.textAlign = 'center';
    ctx.font = '800 96px "Bricolage Grotesque"';
    ctx.fillText(n ? String(n) : '✓', l / 2, 118);
    ctx.font = '800 26px Manrope';
    ctx.fillText(n ? (n === 1 ? 'card para hoje' : 'cards para hoje') : 'revisão em dia', l / 2, 168);
  });
  const fichaDia = new THREE.Group();
  {
    fichaDia.add(bloco(0.5, 0.34, 0.01, COR.branco, 0, 0, 0, { r: 0.01, rug: 0.9 }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.49, 0.33), new THREE.MeshStandardMaterial({ map: fichaHoje.tx, roughness: 0.85 }));
    face.position.z = 0.0065;
    fichaDia.add(face);
  }
  fichaDia.position.set(0.3, 0.17, FIC.p / 2 + 0.1);
  fichaDia.rotation.set(-0.32, -0.12, 0.03);
  caixaCards.add(fichaDia);
  caixaCards.position.set(MESA.x - 1.55, topoMesa, MESA.z - 0.25);
  caixaCards.rotation.y = 0.18;
  sala.add(entra(caixaCards, 0.5));
  const aCaixa = alvo(caixaCards, {
    id: 'revisao', titulo: 'Revisão de hoje',
    sub: (e) => e.filaHoje ? `${e.filaHoje} ${e.filaHoje === 1 ? 'card espera' : 'cards esperam'} por você` : 'Nada na fila. Bom trabalho!',
    acao: () => ponte.abrir('revisao'),
    ancora: new THREE.Vector3(0, 0.78, 0),
    animar(a, t) {
      cardsEmPe.children.forEach((c, i) => {
        c.position.y = c.userData.y + a.foco * (0.07 + Math.sin(t * 6 + i) * 0.02);
      });
    },
  });
  function encherCaixa(n) {
    cardsEmPe.clear();
    const qtd = Math.max(3, Math.min(10, Math.ceil(n / 3) + 3));
    for (let i = 0; i < qtd; i++) {
      const c = new THREE.Group();
      c.add(bloco(0.86, 0.44, 0.01, COR.branco, 0, 0, 0, { r: 0.008, rug: 0.9 }));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.43), matPergunta);
      face.position.z = 0.0055;
      c.add(face);
      // A última fica na frente das divisórias: o "?" dela está sempre à vista.
      const z = i === qtd - 1 ? 0.25 : -0.26 + i * (0.44 / qtd);
      c.position.set((i % 2) * 0.012, 0.25, z);
      c.rotation.x = -0.14 + (i % 3) * 0.025;
      c.userData.y = c.position.y;
      cardsEmPe.add(c);
    }
    // Os materiais novos também acendem no realce.
    aCaixa.materiais = [];
    caixaCards.traverse((o) => {
      if (o.isMesh && !o.userData.semRealce && !o.userData.divisoria) {
        if (!o.userData.proprio) { o.material = o.material.clone(); o.userData.proprio = true; }
        aCaixa.materiais.push(o.material);
      }
    });
  }

  // As divisórias, uma por deck, dentro da caixa: a aba tem o nome e a fila do deck.
  const pilhas = new THREE.Group();
  caixaCards.add(pilhas);
  const ABAS = [-0.28, 0, 0.28, -0.14];
  function montarPilhas(decks) {
    alvos.filter((a) => a.id.startsWith('deck:')).forEach((a) => alvos.splice(alvos.indexOf(a), 1));
    for (const c of [...pilhas.children]) { descartar(c); pilhas.remove(c); }
    const lista = decks.slice(0, 4);
    lista.forEach((d, i) => {
      const g = new THREE.Group();
      const cor = LIVROS[(i * 3 + 1) % LIVROS.length];
      const abaX = ABAS[i];
      g.add(bloco(0.86, 0.4, 0.012, cor, 0, 0.22, 0, { r: 0.008, rug: 0.8 }));
      g.add(bloco(0.32, 0.13, 0.012, cor, abaX, 0.47, 0, { r: 0.02, rug: 0.8 }));
      const rotulo = placaComTexto(320, 128, 0.31, 0.124, (ctx, l, a) => {
        ctx.fillStyle = cor; ctx.fillRect(0, 0, l, a);
        const tinta = claro(cor) ? COR.tinta : '#FBF8F2';
        ctx.fillStyle = tinta; ctx.font = '800 40px Manrope'; ctx.textAlign = 'center';
        ctx.fillText(cortar(ctx, d.nome, l - 24), l / 2, d.hoje ? 56 : 76);
        if (d.hoje) {
          ctx.font = '800 28px Manrope';
          ctx.fillText(`${d.hoje} hoje`, l / 2, 102);
        }
      });
      rotulo.position.set(abaX, 0.47, 0.007);
      g.add(rotulo);
      g.traverse((o) => { o.userData.divisoria = true; });
      const z = -0.2 + (lista.length > 1 ? (i * 0.4) / (lista.length - 1) : 0.15);
      g.position.set(0, 0.012, z);
      g.rotation.x = -0.1;
      g.userData.y = g.position.y;
      pilhas.add(g);
      alvo(g, {
        id: 'deck:' + d.nome, titulo: d.nome,
        sub: () => `${d.conta} ${d.conta === 1 ? 'card' : 'cards'}` + (d.hoje ? ` · ${d.hoje} para hoje` : ' · em dia'),
        acao: () => ponte.abrir('revisao', d.nome),
        ancora: new THREE.Vector3(abaX, 0.62, 0),
        // Passar por cima levanta a divisória, como quem puxa a aba.
        animar(a) { g.position.y = g.userData.y + a.foco * 0.14; },
      });
    });
  }

  // ── A estante (as pastas) ─────────────────────────────────────────────────
  const EST = { z: -3.0, l: 3.2, a: 4.6, p: 0.9, prateleiras: 4 };
  const estante = new THREE.Group();
  {
    const cor = COR.madeiraClara, e = 0.1;
    estante.add(bloco(EST.p, EST.a, e, cor, 0, EST.a / 2, -EST.l / 2, { r: 0.03 }));
    estante.add(bloco(EST.p, EST.a, e, cor, 0, EST.a / 2, EST.l / 2, { r: 0.03 }));
    estante.add(bloco(0.05, EST.a, EST.l, COR.madeira, -EST.p / 2 + 0.025, EST.a / 2, 0, { reto: true }));
    for (let i = 0; i <= EST.prateleiras; i++) {
      estante.add(bloco(EST.p, e, EST.l, cor, 0, 0.12 + i * ((EST.a - 0.2) / EST.prateleiras), 0, { r: 0.025 }));
    }
  }
  estante.position.set(-L / 2 + EST.p / 2 + 0.02, 0, EST.z);
  sala.add(entra(estante, 0.15));
  alvo(estante, {
    id: 'estante', titulo: 'Estante',
    sub: (e) => (e.pastas.length ? `${e.pastas.length} ${e.pastas.length === 1 ? 'pasta' : 'pastas'} · toque para abrir` : 'Crie a primeira pasta'),
    acao: () => ponte.abrir('pastas'),
    ancora: new THREE.Vector3(0.3, EST.a + 0.25, 0),
  });
  const livros = new THREE.Group();
  estante.add(livros);
  const vaoPrateleira = (EST.a - 0.2) / EST.prateleiras;

  /* A textura nasce na proporção da face do livro: numa proporção fixa, o
     texto esticava junto com a lombada, e um livro largo saía distorcido. */
  function lombada(nome, cor, largura, altura) {
    return tela(Math.max(48, Math.round((512 * largura) / altura)), 512, (ctx, l, a) => {
      ctx.fillStyle = cor; ctx.fillRect(0, 0, l, a);
      const tinta = claro(cor) ? COR.tinta : '#FBF8F2';
      ctx.fillStyle = tinta; ctx.globalAlpha = 0.85;
      ctx.fillRect(0, 34, l, 6); ctx.fillRect(0, a - 40, l, 6);
      ctx.globalAlpha = 1;
      // A letra acompanha a largura da lombada, centrada nela.
      const corpo = Math.min(50, l * 0.4);
      ctx.save(); ctx.translate(l / 2 + corpo * 0.34, a / 2); ctx.rotate(-Math.PI / 2);
      ctx.font = `800 ${corpo}px Manrope`; ctx.textAlign = 'center';
      ctx.fillText(cortar(ctx, nome, a - 110), 0, 0);
      ctx.restore();
    });
  }
  function montarLivros(pastas) {
    alvos.filter((a) => a.id.startsWith('pasta:') || a.id === 'pastas').forEach((a) => alvos.splice(alvos.indexOf(a), 1));
    livros.clear();
    const lugares = [];
    const lista = pastas.slice(0, 40);
    const vazios = !lista.length;
    // Sem pasta, a estante mostra livros-fantasma e um convite.
    const fonte = vazios ? [{ nome: '+ Criar pasta', fantasma: true, convite: true }, { fantasma: true, nome: '' }, { fantasma: true, nome: '' }] : lista;
    /* Os livros se espalham de cima para baixo, uns quatro por prateleira no
       mínimo, e o que sobra de cada uma ganha um enfeite. */
    const porPrat = Math.max(4, Math.ceil(fonte.length / EST.prateleiras));
    const fim = EST.l / 2 - 0.1;
    for (let s = 0; s < EST.prateleiras; s++) {
      const y = 0.12 + (EST.prateleiras - 1 - s) * vaoPrateleira + 0.05;
      let z = -EST.l / 2 + 0.14;
      fonte.slice(s * porPrat, (s + 1) * porPrat).forEach((p, k) => {
        const i = s * porPrat + k;
        const larg = Math.min(0.34, 0.2 + ((p.nome?.length ?? 5) % 4) * 0.035 + (p.arquivos ?? 0) * 0.004);
        if (z + larg > fim) return;
        lugares.push({ p, i, larg, y, z: z + larg / 2 });
        z += larg + 0.012;
      });
      if (fim - z > 0.75) enfeite(s + (fonte.length % 3), y, (z + fim) / 2);
    }
    lugares.forEach(({ p, i, larg, y, z }) => {
      const cor = LIVROS[i % LIVROS.length];
      const alto = vaoPrateleira * (0.72 + ((i * 7) % 5) * 0.045);
      const g = new THREE.Group();
      /* O convite é um livro lima de verdade; os outros fantasmas, vidro. */
      const corpo = peca(caixaR(0.62, alto, p.convite ? 0.3 : larg, 0.025), p.convite
        ? mat(COR.lima, { rug: 0.75 })
        : p.fantasma
          ? new THREE.MeshStandardMaterial({ color: COR.branco, transparent: true, opacity: 0.6, roughness: 0.3 })
          : mat(cor, { rug: 0.75 }));
      corpo.position.y = alto / 2;
      g.add(corpo);
      if (!p.fantasma || p.nome) {
        const faceL = (p.convite ? 0.3 : larg) * 0.92, faceA = alto * 0.94;
        const lb = lombada(p.nome || '', p.convite ? COR.lima : cor, faceL, faceA);
        const face = new THREE.Mesh(new THREE.PlaneGeometry(faceL, faceA), new THREE.MeshStandardMaterial({ map: lb.tx, roughness: 0.8 }));
        face.rotation.y = Math.PI / 2;
        face.position.set(0.312, alto / 2, 0);
        g.add(face);
      }
      // Um ou outro tomba de leve, como numa estante de verdade.
      const tomba = !p.fantasma && i % 7 === 5 ? 0.12 : 0;
      g.rotation.x = tomba;
      g.position.set(0.05, y, z + (tomba ? 0.05 : 0));
      g.userData.x = g.position.x;
      g.userData.y = g.position.y;
      g.userData.entrada = { atraso: 0.05 * (i % 12), t: -1 };
      livros.add(g);
      alvo(g, p.fantasma
        ? { id: 'pastas', titulo: 'A estante está vazia', sub: () => 'Toque para criar a primeira pasta', acao: () => ponte.abrir('pastas'), ancora: new THREE.Vector3(0.3, alto + 0.15, 0),
            animar(a) { g.position.x = g.userData.x + a.foco * 0.18; } }
        : { id: 'pasta:' + p.id, titulo: p.nome, sub: () => `${p.arquivos} ${p.arquivos === 1 ? 'arquivo' : 'arquivos'}`,
            acao: () => ponte.abrir('pasta', p.id), ancora: new THREE.Vector3(0.3, alto + 0.15, 0),
            /* Passar por cima puxa o livro para fora, como quem vai pegá-lo. */
            animar(a) { g.position.x = g.userData.x + a.foco * 0.32; g.position.y = g.userData.y + a.foco * 0.12; g.rotation.z = a.foco * 0.04; } });
    });
  }
  function enfeite(tipo, y, z) {
    const g = new THREE.Group();
    if (tipo % 3 === 0) {
      // Livros deitados, com um vasinho em cima.
      for (let k = 0; k < 3; k++) {
        const d = bloco(0.55, 0.09, 0.6, LIVROS[(k + 4) % LIVROS.length], 0, 0.045 + k * 0.092, 0, { r: 0.02 });
        d.rotation.y = (k - 1) * 0.1;
        g.add(d);
      }
      const v = fazerPlanta(0.32);
      v.position.y = 0.28 + 0.08;
      g.add(v);
    } else if (tipo % 3 === 1) {
      const v = fazerPlanta(0.42);
      v.position.y = 0.1;
      g.add(v);
    } else {
      // Uma caixa organizadora, com a etiqueta da casa.
      g.add(bloco(0.6, 0.42, 0.62, COR.creme, 0, 0.21, 0, { r: 0.04 }));
      const etiqueta = bloco(0.01, 0.12, 0.3, COR.lima, 0.305, 0.25, 0, { r: 0.005 });
      g.add(etiqueta);
    }
    g.position.set(0.02, y, z);
    livros.add(g);
  }

  // ── O relógio (o Pomodoro) ────────────────────────────────────────────────
  const relogio = new THREE.Group();
  const mostrador = tela(512, 512, (ctx, l, a) => {
    ctx.fillStyle = COR.creme; ctx.beginPath(); ctx.arc(l / 2, a / 2, l / 2, 0, 7); ctx.fill();
    ctx.fillStyle = COR.tinta;
    for (let i = 0; i < 60; i++) {
      const g = (i / 60) * Math.PI * 2, grosso = i % 5 === 0;
      ctx.save(); ctx.translate(l / 2, a / 2); ctx.rotate(g);
      ctx.fillRect(-(grosso ? 6 : 2), -l / 2 + 26, grosso ? 12 : 4, grosso ? 38 : 16);
      ctx.restore();
    }
    ctx.font = '800 40px "Bricolage Grotesque"'; ctx.textAlign = 'center';
    ctx.fillText('sinapse', l / 2, a / 2 + 110);
  });
  relogio.add(peca(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 64), mat(COR.tinta, { rug: 0.4 })));
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.54, 64), new THREE.MeshStandardMaterial({ map: mostrador.tx, roughness: 0.6 }));
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.052;
  relogio.add(face);
  const ponteiro = (comp, larg, cor, alt) => {
    const g = new THREE.Group();
    const m = bloco(larg, 0.02, comp, cor, 0, alt, -comp / 2 + 0.06, { r: 0.008, rug: 0.4 });
    g.add(m);
    relogio.add(g);
    return g;
  };
  const pHora = ponteiro(0.3, 0.05, COR.tinta, 0.07);
  const pMin = ponteiro(0.44, 0.035, COR.tinta, 0.09);
  const pSeg = ponteiro(0.46, 0.014, '#E86A4A', 0.11);
  const pino = peca(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 16), mat(COR.lima));
  pino.position.y = 0.1;
  relogio.add(pino);
  // O anel do Pomodoro: aparece em volta quando há um ciclo rodando.
  const anel = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.04, 12, 80, Math.PI * 2), new THREE.MeshStandardMaterial({ color: COR.lima, emissive: COR.lima, emissiveIntensity: 0.6 }));
  anel.rotation.x = Math.PI / 2;
  anel.userData.semRealce = true;
  anel.visible = false;
  relogio.add(anel);
  relogio.rotation.x = Math.PI / 2;
  relogio.position.set(-3.1, 4.5, -L / 2 + 0.06);
  sala.add(entra(relogio, 0.6, 0.6));
  let fracaoAnel = -1;
  alvo(relogio, {
    id: 'pomodoro', titulo: 'Pomodoro',
    sub: (e) => e.foco.rodando ? `Ciclo em andamento · faltam ${Math.ceil(e.foco.resta / 60)} min` : e.foco.minutos ? `${e.foco.minutos} min em foco hoje` : 'Começar um ciclo de foco',
    acao: () => ponte.abrir('pomodoro'),
    ancora: new THREE.Vector3(0, 0, -0.85),
    animar(a, t) { relogio.rotation.z = a.foco * Math.sin(t * 14) * 0.05; relogio.scale.setScalar(1 + a.foco * 0.06); },
  });

  // ── O calendário (os planos) ──────────────────────────────────────────────
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const folhaCal = tela(400, 520, (ctx, l, a, e, semana) => {
    const hoje = new Date();
    if (semana) {
      // A semana do plano: um dia por linha; as sessões são etiquetas de verdade, por cima.
      ctx.fillStyle = COR.branco; ctx.fillRect(0, 0, l, a);
      ctx.fillStyle = COR.tinta; ctx.fillRect(0, 0, l, 120);
      ctx.fillStyle = COR.lima; ctx.font = '800 40px "Bricolage Grotesque"'; ctx.textAlign = 'center';
      ctx.fillText('Esta semana', l / 2, 62);
      ctx.fillStyle = '#B0B0AB'; ctx.font = '700 17px Manrope';
      ctx.fillText(cortar(ctx, semana.plano, l - 60), l / 2, 94);
      ctx.textAlign = 'left';
      const h = (a - 120) / 7;
      semana.dias.forEach((d, i) => {
        const y = 120 + i * h;
        if (d.hoje) { ctx.fillStyle = '#EAF8C9'; ctx.fillRect(0, y, l, h); }
        ctx.fillStyle = '#E3E4DE'; ctx.fillRect(12, y + h - 1, l - 24, 1);
        ctx.fillStyle = d.hoje ? COR.tinta : '#999'; ctx.font = '800 14px Manrope';
        ctx.fillText(d.nome.toUpperCase(), 16, y + h / 2 - 2);
        ctx.fillStyle = COR.tinta; ctx.font = '800 22px "Bricolage Grotesque"';
        ctx.fillText(String(d.numero), 16, y + h / 2 + 20);
        if (!d.sessoes.length) { ctx.fillStyle = '#C8C8C4'; ctx.font = '600 15px Manrope'; ctx.fillText('livre', 130, y + h / 2 + 6); }
      });
      return;
    }
    ctx.fillStyle = COR.branco; ctx.fillRect(0, 0, l, a);
    ctx.fillStyle = COR.tinta; ctx.fillRect(0, 0, l, 120);
    ctx.fillStyle = COR.lima; ctx.font = '800 46px "Bricolage Grotesque"'; ctx.textAlign = 'center';
    ctx.fillText(MESES[hoje.getMonth()], l / 2, 78);
    ctx.fillStyle = COR.tinta; ctx.font = '800 200px "Bricolage Grotesque"';
    ctx.fillText(String(hoje.getDate()), l / 2, 330);
    ctx.font = '700 34px Manrope'; ctx.fillStyle = '#666';
    ctx.fillText(DIAS[hoje.getDay()], l / 2, 385);
    const n = e?.planos ?? 0;
    ctx.fillStyle = n ? COR.lima : '#F0F0EE';
    arredondado(ctx, 40, 420, l - 80, 64, 32); ctx.fill();
    ctx.fillStyle = COR.tinta; ctx.font = '800 28px Manrope';
    ctx.fillText(n ? `${n} ${n === 1 ? 'plano ativo' : 'planos ativos'}` : 'Sem plano ainda', l / 2, 463);
  });
  const calendario = new THREE.Group();
  calendario.add(bloco(1.3, 1.65, 0.05, COR.tinta, 0, 0, -0.02, { r: 0.03 }));
  const folha = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.56), new THREE.MeshStandardMaterial({ map: folhaCal.tx, roughness: 0.85 }));
  folha.position.z = 0.012;
  calendario.add(folha);
  // A folha de cima levanta no realce, como quem vai virar o mês.
  const virada = new THREE.Group();
  const folhaSolta = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.5), new THREE.MeshStandardMaterial({ color: '#F4F0E8', roughness: 0.9, side: THREE.DoubleSide }));
  folhaSolta.position.y = -0.25;
  virada.add(folhaSolta);
  virada.position.set(0, 0.78 - 1.56 + 0.5, 0.02);
  virada.visible = false;
  calendario.add(virada);
  for (const x of [-0.35, 0.35]) {
    const argola = peca(new THREE.TorusGeometry(0.06, 0.015, 8, 20), mat(COR.grafite, { metal: 0.8, rug: 0.3 }));
    argola.position.set(x, 0.82, 0.02);
    calendario.add(argola);
  }
  calendario.position.set(3.95, 3.7, -L / 2 + 0.05);
  calendario.rotation.z = -0.03;
  sala.add(entra(calendario, 0.7, 0.6));
  alvo(calendario, {
    id: 'planos', titulo: 'Planos de estudo',
    sub: (e) => e.planos ? (e.planoNome ? `Atual: ${e.planoNome}` : `${e.planos} planos`) : 'Montar um plano com a IA',
    acao: () => ponte.abrir('planos'),
    ancora: new THREE.Vector3(0, 1.0, 0),
    animar(a) {
      calendario.rotation.z = -0.03 + a.foco * 0.05;
      virada.visible = a.foco > 0.02;
      virada.rotation.x = -a.foco * 1.1;
    },
  });

  // ── A prancheta de prova (as questões) ────────────────────────────────────
  /* Uma prancheta na parede, com a folha de prova de cima à vista: o
     cabeçalho, questões com as bolinhas A B C D e o carimbo do acerto. No
     zoom ela vira a prova de verdade (ver "A prova na prancheta"). */
  const mural = new THREE.Group();   // o objeto das questões
  const prancheta = new THREE.Group();
  const folhaProva = tela(380, 500, (ctx, l, a, e) => {
    ctx.fillStyle = '#FBF8F2'; ctx.fillRect(0, 0, l, a);
    ctx.fillStyle = COR.tinta; ctx.font = '800 50px "Bricolage Grotesque"';
    ctx.fillText('PROVA', 32, 92);
    ctx.fillStyle = '#9A9A94'; ctx.font = '700 16px Manrope';
    ctx.fillText('Nome', 32, 124);
    ctx.fillRect(84, 122, l - 116, 2);
    // Três questões de exemplo: as linhas do enunciado e as bolinhas.
    const marcadas = [1, 2, 0];
    for (let k = 0; k < 3; k++) {
      const y = 168 + k * 92;
      ctx.fillStyle = COR.tinta; ctx.font = '800 20px Manrope'; ctx.fillText(`${k + 1}.`, 32, y);
      ctx.fillStyle = 'rgba(18,19,22,.16)';
      ctx.fillRect(62, y - 12, l - 100 - k * 30, 9);
      ctx.fillRect(62, y + 6, l - 160 + k * 20, 9);
      for (let b = 0; b < 4; b++) {
        const x = 76 + b * 64, cy = y + 42;
        ctx.beginPath(); ctx.arc(x, cy, 13, 0, 7);
        ctx.lineWidth = 2.5; ctx.strokeStyle = COR.tinta;
        if (b === marcadas[k]) { ctx.fillStyle = COR.tinta; ctx.fill(); } else ctx.stroke();
        ctx.fillStyle = b === marcadas[k] ? '#FBF8F2' : COR.tinta; ctx.font = '800 14px Manrope'; ctx.textAlign = 'center';
        ctx.fillText('ABCD'[b], x, cy + 5);
        ctx.textAlign = 'left';
      }
    }
    const n = e?.questoes ?? 0;
    ctx.fillStyle = COR.tinta; ctx.font = '800 22px Manrope';
    ctx.fillText(n ? `${n} ${n === 1 ? 'questão' : 'questões'}` : 'Sem questões ainda', 32, a - 40);
    // O carimbo do acerto, inclinado no canto.
    if (e?.acertoQuestoes != null) {
      ctx.save(); ctx.translate(l - 82, a - 66); ctx.rotate(-0.22);
      ctx.strokeStyle = '#C0473A'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, 48, 0, 7); ctx.stroke();
      ctx.fillStyle = '#C0473A'; ctx.textAlign = 'center';
      ctx.font = '800 30px "Bricolage Grotesque"'; ctx.fillText(`${e.acertoQuestoes}%`, 0, 8);
      ctx.font = '800 12px Manrope'; ctx.fillText('ACERTO', 0, 28);
      ctx.restore();
    }
  });
  let folhaCima;   // a folha à vista: a capa, ou a página da prova no zoom
  {
    // A placa de eucatex, a folha de baixo (a pilha) e a folha de cima.
    prancheta.add(bloco(0.06, 1.55, 1.15, '#8E6440', 0, 0, 0, { r: 0.05, rug: 0.7 }));
    const baixo = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.32), mat('#EFEADF', { rug: 0.95 }));
    baixo.rotation.set(0.035, Math.PI / 2, 0);
    baixo.position.set(0.034, -0.1, 0.03);
    const cima = folhaCima = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.32), new THREE.MeshStandardMaterial({ map: folhaProva.tx, roughness: 0.9 }));
    cima.rotation.y = Math.PI / 2;
    cima.position.set(0.04, -0.08, 0);
    prancheta.add(baixo, cima);
    // A presilha de metal no alto.
    prancheta.add(bloco(0.07, 0.16, 0.48, COR.latao, 0.055, 0.66, 0, { r: 0.03, rug: 0.3, metal: 0.75 }));
    const argola = peca(new THREE.TorusGeometry(0.05, 0.012, 8, 18), mat(COR.latao, { rug: 0.3, metal: 0.75 }));
    argola.rotation.y = Math.PI / 2;
    argola.position.set(0.06, 0.79, 0);
    prancheta.add(argola);
  }
  prancheta.rotation.x = 0.03;
  mural.add(prancheta);
  mural.position.set(-L / 2 + 0.06, 3.15, 0.55);
  sala.add(entra(mural, 0.8, 0.6));
  alvo(mural, {
    id: 'questoes', titulo: 'Questões',
    sub: (e) => e.questoes ? `${e.questoes} no banco · fazer uma prova` : 'Criar as primeiras questões',
    acao: () => ponte.abrir('questoes'),
    ancora: new THREE.Vector3(0.1, 0.95, 0),
    animar(a, t) { prancheta.rotation.x = 0.03 + a.foco * Math.sin(t * 4) * 0.03; },
  });

  // ── Luzes ─────────────────────────────────────────────────────────────────
  /* O sol entra pela janela e projeta o retângulo dela no chão; o resto do
     quarto é iluminado pelo céu (hemisférica) e pelo reflexo do ambiente. De
     noite o sol vira luar, e quem acende o quarto é a luminária. */
  const ceuLuz = new THREE.HemisphereLight('#FFF6E8', '#B9A88F', 0.85);
  cena.add(ceuLuz);
  const sol = new THREE.DirectionalLight('#FFE7C2', 3.6);
  sol.position.set(4, 11, -16);
  sol.target.position.set(0, 0, 0);
  sol.castShadow = true;
  sol.shadow.mapSize.set(2048, 2048);
  sol.shadow.camera.left = -9; sol.shadow.camera.right = 9;
  sol.shadow.camera.top = 9; sol.shadow.camera.bottom = -9;
  sol.shadow.camera.near = 1; sol.shadow.camera.far = 40;
  sol.shadow.bias = -0.0004;
  sol.shadow.normalBias = 0.03;
  sol.shadow.radius = 4;
  cena.add(sol, sol.target);
  // Uma luz de preenchimento de frente, sem sombra, para o lado da câmera não
  // ficar chapado.
  const preenche = new THREE.DirectionalLight('#FFFFFF', 0.9);
  preenche.position.set(10, 8, 6);
  cena.add(preenche);

  // A poeira no facho da janela, de dia.
  const poeira = (() => {
    const n = 70, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = JAN.x + (Math.random() - 0.5) * 2.6;
      pos[i * 3 + 1] = 1.6 + Math.random() * 2.8;
      pos[i * 3 + 2] = -4.6 + Math.random() * 3.2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#FFF3D6', size: 0.035, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    sala.add(p);
    return p;
  })();

  // ── O tempo lá fora ───────────────────────────────────────────────────────
  /* O dia segue o relógio de verdade: amanhece por volta das 6h, o sol anda
     de trás da esquerda para trás da direita (e o retângulo da janela anda no
     chão junto), entardece laranja perto das 18h e anoitece às 19h30. De
     noite o sol vira luar e quem acende o quarto é a luminária. O tema escuro
     é sempre noite. Entre um ponto e outro do dia, tudo se mistura aos
     poucos. Para ver outra hora: `window.__horaQuarto = 18` no console. */
  let piscaBase = 0.4;
  const DIA = [
    { h: 0, noite: 1, sol: '#9DB4FF', solI: 0.9, solP: [4, 11, -16], ceu: '#8C9BD6', ceuI: 0.32, chao: '#5C5470', pre: 0.22, lum: 9, lumD: 8, lamp: 3, env: 0.12, exp: 1.15, topo: '#0E1530', base: '#2B3560', fundoT: '#3A4470', fundoB: '#6A6F9A' },
    { h: 4.8 },
    { h: 6.3, noite: 0.25, sol: '#FFB08A', solI: 2.2, solP: [-12, 5, -14], ceu: '#FFD8C4', ceuI: 0.62, chao: '#B9988F', pre: 0.55, lum: 4, lumD: 6, lamp: 2, env: 0.24, exp: 1.08, topo: '#F3A98F', base: '#FCE2C2', fundoT: '#F6B9A0', fundoB: '#FBE3C8' },
    { h: 8, noite: 0, sol: '#FFE7C2', solI: 3.4, solP: [-6, 12, -16], ceu: '#FFF6E8', ceuI: 0.85, chao: '#B9A88F', pre: 0.9, lum: 2.5, lumD: 5, lamp: 1.5, env: 0.35, exp: 1.05, topo: '#9FD1F5', base: '#F7EBD3', fundoT: '#CFE6F7', fundoB: '#F7F1E4' },
    { h: 12.5, solI: 3.7, solP: [4, 15, -14] },
    { h: 16.3, solI: 3.4, solP: [12, 10, -14] },
    { h: 18, noite: 0.3, sol: '#FF9F6E', solI: 1.8, solP: [16, 4.5, -12], ceu: '#FFC4A3', ceuI: 0.6, chao: '#A88A86', pre: 0.5, lum: 6, lumD: 7, lamp: 2.4, env: 0.22, exp: 1.1, topo: '#E8836A', base: '#FBCB98', fundoT: '#F2A488', fundoB: '#FAD8B4' },
    { h: 19.6, ...{} },
    { h: 24 },
  ];
  // Cada ponto herda o que não diz do anterior; o fim da noite repete o começo.
  for (let i = 1; i < DIA.length; i++) DIA[i] = { ...DIA[i - 1], ...DIA[i] };
  Object.assign(DIA[DIA.length - 2], { ...DIA[0], h: 19.6 });
  Object.assign(DIA[DIA.length - 1], { ...DIA[0], h: 24 });
  Object.assign(DIA[1], { ...DIA[0], h: 4.8 });

  const corA = new THREE.Color(), corB = new THREE.Color();
  const misturar = (a, b, k) => corA.set(a).lerp(corB.set(b), k).getHexString();
  function horaAgora() {
    if (typeof window.__horaQuarto === 'number') return window.__horaQuarto;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }
  function momento() {
    const escuro = document.documentElement.getAttribute('data-theme') === 'dark';
    const h = escuro ? 0 : ((horaAgora() % 24) + 24) % 24;
    let i = 0;
    while (i < DIA.length - 2 && h >= DIA[i + 1].h) i++;
    const a = DIA[i], b = DIA[i + 1], k = Math.min(1, Math.max(0, (h - a.h) / (b.h - a.h || 1)));
    const m = { h };
    for (const chave of Object.keys(a)) {
      if (chave === 'h') continue;
      const va = a[chave], vb = b[chave];
      m[chave] = typeof va === 'number' ? va + (vb - va) * k
        : Array.isArray(va) ? va.map((x, j) => x + (vb[j] - x) * k)
        : '#' + misturar(va, vb, k);
    }
    return m;
  }

  const ceuLuzChao = ceuLuz.groundColor;
  let ultimoMomento = '';
  const palcoEstilo = palco.style;
  function aplicarTempo() {
    const m = momento();
    agoraNoite = m.noite;
    ceuLuz.intensity = m.ceuI;
    ceuLuz.color.set(m.ceu);
    ceuLuzChao.set(m.chao);
    sol.color.set(m.sol);
    sol.intensity = m.solI;
    sol.position.set(...m.solP);
    preenche.intensity = m.pre;
    luzMesa.intensity = m.lum;
    luzMesa.distance = m.lumD;
    lampada.material.emissiveIntensity = m.lamp;
    lampadaLeitura.material.emissiveIntensity = 0.6 + m.noite * 2.2;
    piscaBase = 0.35 + m.noite * 1.6;
    cena.environmentIntensity = m.env;
    renderer.toneMappingExposure = m.exp;
    poeira.visible = m.noite < 0.5;
    // O céu da janela e o fundo do palco só se refazem quando a cor muda de fato.
    const marca = m.topo + m.base + Math.round(m.noite * 20);
    if (marca !== ultimoMomento) {
      ultimoMomento = marca;
      ceu.redesenhar(m);
      palcoEstilo.setProperty('--ceu-topo', m.fundoT);
      palcoEstilo.setProperty('--ceu-base', m.fundoB);
    }
    sombraSuja = true;
  }

  let agoraNoite = 0;
  aplicarTempo();
  new MutationObserver(aplicarTempo).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ── Os dados ──────────────────────────────────────────────────────────────
  let estado = ponte.estado();
  let assinatura = '';
  function aplicarDados() {
    estado = ponte.estado();
    const nova = JSON.stringify([estado.carregado, estado.pastas, estado.decks]);
    if (nova !== assinatura) {
      assinatura = nova;
      if (estado.carregado) {
        montarLivros(estado.pastas);
        montarPilhas(estado.decks);
      }
    }
    encherCaixa(estado.filaHoje);
    folhaProva.redesenhar(estado);
    fichaHoje.redesenhar(estado);
    montarBarras(estado.sete);
    /* Os alvos são refeitos com os dados: o escolhido é reencontrado pelo id,
       os itens do zoom se acertam e o painel aberto se repinta. */
    if (selecionado) selecionado = alvos.find((a) => a.id === selecionado.id) ?? null;
    sincronizarItens();
    telaMonitor.redesenhar(estado.carregado ? estado : null, diaEscolhido(), -1);
    folhaCal.redesenhar(estado, focoAtual === 'calendario' ? estado.semana : null);
    if (focoAtual) pintarPainel();
    pintarPlacas();
  }
  document.addEventListener('sinapse:dados', aplicarDados);

  // ── Os itens dentro dos objetos ───────────────────────────────────────────
  /* Com zoom, cada objeto mostra os próprios itens, e cada um se escolhe ali
     mesmo: a folha da prova é uma questão, o leque da mesa são os cards do deck, o
     livro aberto traz as fichas dos arquivos, o calendário a semana do plano e
     o monitor uma barra por dia. Tudo isto nasce e some com o zoom; o quarto
     inteiro continua com o desenho de sempre. */
  const segundos = () => performance.now() / 1000;
  const surgindo = new Set();
  function surgir(obj, atraso = 0) {
    obj.scale.setScalar(0.001);
    obj.userData.surge = { t0: segundos() + atraso };
    surgindo.add(obj);
  }
  function descartar(obj) {
    obj.traverse((o) => {
      o.geometry?.dispose?.();
      for (const m of [].concat(o.material ?? [])) { m.map?.dispose?.(); m.dispose?.(); }
    });
  }
  function tirarAlvos(prefixo) {
    for (let i = alvos.length - 1; i >= 0; i--) if (alvos[i].id.startsWith(prefixo)) alvos.splice(i, 1);
  }
  function esvaziar(grupo, prefixo) {
    tirarAlvos(prefixo);
    for (const c of [...grupo.children]) { descartar(c); grupo.remove(c); surgindo.delete(c); }
  }
  /* Quebra um texto em linhas que cabem na largura, até um teto de linhas. */
  function linhas(ctx, texto, largura, teto) {
    const palavras = String(texto || '').replace(/\s+/g, ' ').trim().split(' ');
    const saida = [];
    let atual = '';
    for (const p of palavras) {
      const tenta = atual ? atual + ' ' + p : p;
      if (ctx.measureText(tenta).width <= largura || !atual) atual = tenta;
      else { saida.push(atual); atual = p; }
      if (saida.length === teto) break;
    }
    if (saida.length < teto && atual) saida.push(atual);
    if (saida.length === teto && palavras.join(' ').length > saida.join(' ').length) {
      saida[teto - 1] = cortar(ctx, saida[teto - 1] + '…', largura);
    }
    return saida.map((l) => cortar(ctx, l, largura));
  }
  function placaComTexto(l, a, larguraMundo, alturaMundo, desenhar, op = {}) {
    const t = tela(l, a, desenhar);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(larguraMundo, alturaMundo),
      new THREE.MeshStandardMaterial({ map: t.tx, roughness: 0.85, transparent: !!op.transparente, side: op.lados ?? THREE.FrontSide }));
    m.castShadow = !!op.sombra;
    return m;
  }

  // O acerto de uma questão, como texto.
  const acertoDe = (q) => (q.tentativas ? Math.round((q.acertos / q.tentativas) * 100) + '%' : 'nova');
  const cortarTexto = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

  // A mesa: o deck escolhido se abre num leque de cards, de frente para quem olha.
  const leque = new THREE.Group();
  sala.add(leque);
  let paginaLeque = 0, assinaturaLeque = '';
  const POR_PAGINA = 8;
  function cartaDesenho(texto, verso) {
    return (ctx, l, a) => {
      ctx.fillStyle = verso ? '#EAF8C9' : COR.branco; ctx.fillRect(0, 0, l, a);
      ctx.fillStyle = verso ? COR.lima : '#F0F0EE'; ctx.fillRect(0, 0, l, 34);
      ctx.fillStyle = 'rgba(18,19,22,.6)'; ctx.font = '800 16px Manrope';
      ctx.fillText(verso ? 'VERSO' : 'FRENTE', 16, 23);
      ctx.fillStyle = COR.tinta; ctx.font = '700 22px Manrope'; ctx.textAlign = 'center';
      const ls = linhas(ctx, texto || '(vazio)', l - 40, 5);
      const y0 = 34 + (a - 34) / 2 - ((ls.length - 1) * 27) / 2 + 8;
      ls.forEach((t, k) => ctx.fillText(t, l / 2, y0 + k * 27));
      ctx.textAlign = 'left';
    };
  }
  function montarLeque(deck) {
    const cartas = deck ? ponte.cartas(deck) : [];
    const paginas = Math.max(1, Math.ceil(cartas.length / POR_PAGINA));
    paginaLeque = Math.min(paginaLeque, paginas - 1);
    const pagina = cartas.slice(paginaLeque * POR_PAGINA, (paginaLeque + 1) * POR_PAGINA);
    const ass = JSON.stringify([deck, paginaLeque, pagina]);
    if (ass === assinaturaLeque) return false;
    assinaturaLeque = ass;
    esvaziar(leque, 'carta:');
    leque.userData.total = cartas.length;
    leque.userData.paginas = paginas;
    if (!deck) return true;
    const XS = [-1.05, -0.35, 0.35, 1.05], YS = [0.5, 0];
    pagina.forEach((c, i) => {
      const g = new THREE.Group();
      const giro = new THREE.Group();
      giro.add(bloco(0.62, 0.42, 0.012, COR.branco, 0, 0, 0, { r: 0.012, rug: 0.9 }));
      const frente = placaComTexto(320, 216, 0.6, 0.405, cartaDesenho(c.frente, false));
      frente.position.z = 0.0075;
      const costas = placaComTexto(320, 216, 0.6, 0.405, cartaDesenho(c.verso, true));
      costas.position.z = -0.0075;
      costas.rotation.y = Math.PI;
      giro.add(frente, costas);
      g.add(giro);
      const base = new THREE.Vector3(XS[i % 4], YS[Math.floor(i / 4)], 0);
      g.position.copy(base);
      g.rotation.x = -0.56;
      g.userData.giro = giro;
      g.userData.virado = 0;
      leque.add(g);
      surgir(giro, i * 0.04);
      alvo(g, {
        id: 'carta:' + c.id, titulo: cortarTexto(c.frente, 46), dica: 'Toque para ver e editar',
        sub: () => c.quando, ancora: new THREE.Vector3(0, 0.3, 0),
        animar(a) {
          g.position.z = base.z + a.foco * 0.14;
          g.position.y = base.y + a.foco * 0.04;
          g.scale.setScalar(1 + a.foco * 0.06);
        },
      });
    });
    leque.position.set(MESA.x - 1.25, topoMesa + 0.62, MESA.z + 1.05);
    return true;
  }
  function virarCarta(a, lado) {
    const g = a.grupo;
    g.userData.virado = lado ?? (g.userData.virado ? 0 : 1);
  }

  // A estante: o livro escolhido se abre na frente dela, com as fichas dos arquivos.
  const livroAberto = new THREE.Group();
  livroAberto.position.set(1.15, 2.35, 0);
  estante.add(livroAberto);
  let assinaturaLivro = '';
  function montarLivroAberto(p) {
    const ass = JSON.stringify(p ?? null);
    if (ass === assinaturaLivro) return false;
    assinaturaLivro = ass;
    esvaziar(livroAberto, 'arquivo:');
    if (!p) return true;
    const corpo = new THREE.Group();
    const i = estado.pastas.findIndex((x) => x.id === p.id);
    const cor = LIVROS[Math.max(0, i) % LIVROS.length];
    corpo.add(bloco(0.05, 1.72, 2.56, cor, -0.04, 0, 0, { r: 0.03, rug: 0.7 }));
    const pagina = (z, desenhar) => {
      const m = placaComTexto(300, 404, 1.2, 1.62, desenhar);
      m.rotation.y = Math.PI / 2;
      m.position.set(0, 0, z);
      corpo.add(m);
    };
    // Página da esquerda: a pasta.
    pagina(0.63, (ctx, l, a) => {
      ctx.fillStyle = '#FBF8F2'; ctx.fillRect(0, 0, l, a);
      const g2 = ctx.createLinearGradient(l - 30, 0, l, 0); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,.12)');
      ctx.fillStyle = g2; ctx.fillRect(l - 30, 0, 30, a);
      ctx.fillStyle = 'rgba(18,19,22,.45)'; ctx.font = '800 15px Manrope'; ctx.fillText('PASTA', 26, 40);
      ctx.fillStyle = COR.tinta; ctx.font = '800 32px "Bricolage Grotesque"';
      const titulo = linhas(ctx, p.nome, l - 52, 3);
      titulo.forEach((t, k) => ctx.fillText(t, 26, 82 + k * 36));
      ctx.fillStyle = '#666'; ctx.font = '600 17px Manrope';
      linhas(ctx, p.desc || 'Sem descrição.', l - 52, 6).forEach((t, k) => ctx.fillText(t, 26, 104 + titulo.length * 36 + k * 23));
      ctx.fillStyle = cor; arredondado(ctx, 26, a - 70, l - 52, 40, 20); ctx.fill();
      ctx.fillStyle = claro(cor) ? COR.tinta : '#FBF8F2'; ctx.font = '800 16px Manrope'; ctx.textAlign = 'center';
      ctx.fillText(`${p.arquivos} ${p.arquivos === 1 ? 'arquivo' : 'arquivos'} · ${p.cards} cards`, l / 2, a - 44);
      ctx.textAlign = 'left';
    });
    // Página da direita: o fundo das fichas.
    pagina(-0.63, (ctx, l, a) => {
      ctx.fillStyle = '#FBF8F2'; ctx.fillRect(0, 0, l, a);
      const g2 = ctx.createLinearGradient(0, 0, 30, 0); g2.addColorStop(0, 'rgba(0,0,0,.12)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, 30, a);
      ctx.fillStyle = 'rgba(18,19,22,.45)'; ctx.font = '800 15px Manrope'; ctx.fillText('ARQUIVOS', 30, 40);
      if (!p.lista.length) { ctx.fillStyle = '#999'; ctx.font = '600 18px Manrope'; ctx.fillText('Pasta vazia.', 30, 80); }
    });
    livroAberto.add(corpo);
    surgir(corpo);
    p.lista.slice(0, 7).forEach((arq, k) => {
      const g = new THREE.Group();
      const ficha = placaComTexto(400, 64, 1.02, 0.163, (ctx, l, a) => {
        ctx.fillStyle = COR.branco; arredondado(ctx, 2, 2, l - 4, a - 4, 12); ctx.fill();
        ctx.strokeStyle = '#E3E4DE'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = cor; arredondado(ctx, 12, 18, 8, a - 36, 4); ctx.fill();
        ctx.fillStyle = COR.tinta; ctx.font = '700 22px Manrope';
        ctx.fillText(cortar(ctx, arq.nome, l - 120), 32, 40);
        ctx.fillStyle = '#999'; ctx.font = '700 17px Manrope'; ctx.textAlign = 'right';
        ctx.fillText(`${arq.cards} cards`, l - 16, 40); ctx.textAlign = 'left';
      }, { transparente: true });
      ficha.rotation.y = Math.PI / 2;
      g.add(ficha);
      const y = 0.56 - k * 0.19;
      g.position.set(0.012, y, -0.63);
      livroAberto.add(g);
      surgir(ficha, 0.12 + k * 0.04);
      alvo(g, {
        id: `arquivo:${p.id}:${arq.id}`, titulo: arq.nome, dica: 'Toque para ver o arquivo',
        sub: () => `${arq.cards} cards`, ancora: new THREE.Vector3(0, 0.12, 0),
        animar(a) { g.position.x = 0.012 + a.foco * 0.06; g.scale.setScalar(1 + a.foco * 0.05); },
      });
    });
  }

  // O calendário: a semana do plano, com uma etiqueta por sessão.
  const etiquetasCal = new THREE.Group();
  calendario.add(etiquetasCal);
  let assinaturaSemana = '';
  const corDaSessao = (s) => (s.feita ? '#E3E4DE' : s.tipo === 'teoria' ? '#C6F36B' : s.tipo === 'revisao' ? '#9FD1F5' : '#F2C14E');
  function montarSemana(semana) {
    const ass = JSON.stringify(semana ?? null);
    if (ass === assinaturaSemana) return;
    assinaturaSemana = ass;
    esvaziar(etiquetasCal, 'sessao:');
    folhaCal.redesenhar(estado, semana);
    if (!semana) return;
    const alto = 1.56, topoFolha = 0.78 - 0.36, linha = (alto - 0.36) / 7;
    semana.dias.forEach((d, i) => {
      const lista = d.sessoes.slice(0, 2);
      const largura = (0.84 - 0.04 * (lista.length - 1)) / Math.max(1, lista.length);
      lista.forEach((s, k) => {
        const g = new THREE.Group();
        const placa = placaComTexto(Math.round(360 * largura / 0.84) + 40, 56, largura, 0.13, (ctx, l, a) => {
          ctx.fillStyle = corDaSessao(s); arredondado(ctx, 2, 2, l - 4, a - 4, 14); ctx.fill();
          ctx.fillStyle = s.feita ? '#888' : COR.tinta; ctx.font = '700 21px Manrope';
          const t = (s.feita ? '✓ ' : '') + s.titulo;
          ctx.fillText(cortar(ctx, t, l - 24), 12, 36);
          if (s.feita) { const w = Math.min(l - 24, ctx.measureText(t).width); ctx.fillRect(12, 29, w, 2); }
        }, { transparente: true });
        g.add(placa);
        g.position.set(-0.26 + largura / 2 + k * (largura + 0.04), topoFolha - (i + 0.5) * linha, 0.02);
        etiquetasCal.add(g);
        surgir(placa, i * 0.03);
        alvo(g, {
          id: `sessao:${semana.planoId}:${s.id}`, titulo: s.titulo, dica: s.feita ? 'Feita · toque para ver' : `${s.minutos} min · toque para ver`,
          sub: () => `${s.minutos} min`, ancora: new THREE.Vector3(0, 0.08, 0),
          animar(a) { g.position.z = 0.02 + a.foco * 0.05; g.scale.setScalar(1 + a.foco * 0.08); },
        });
      });
    });
  }

  // O monitor: uma faixa por dia, sobre as barras do gráfico.
  const barras = new THREE.Group();
  barras.position.set(0, 0.95, 0.047);
  monitor.add(barras);
  let assinaturaBarras = '';
  function montarBarras(sete) {
    const ass = JSON.stringify(sete.map((d) => d.data));
    if (ass === assinaturaBarras) return;
    assinaturaBarras = ass;
    esvaziar(barras, 'dia:');
    const larg = (768 - 80) / 7;
    sete.forEach((d, i) => {
      const px = 40 + i * larg + larg / 2;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(((larg - 6) / 768) * 1.63, ((412 - 120) / 432) * 0.92),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      m.userData.semRealce = true;
      const g = new THREE.Group();
      g.add(m);
      g.position.set((px / 768 - 0.5) * 1.63, (0.5 - (120 + 412) / 2 / 432) * 0.92, 0);
      barras.add(g);
      alvo(g, {
        id: 'dia:' + i, titulo: estado.sete[i]?.data ?? '', dica: 'Toque para ver o dia',
        sub: () => `${estado.sete[i]?.n ?? 0} cards`, ancora: new THREE.Vector3(0, 0.3, 0),
      });
    });
  }

  // ── A prova na prancheta ──────────────────────────────────────────────────
  /* Com zoom, a prancheta é uma prova de verdade: a folha de cima é a questão
     da vez, e virar a página sobe a folha pela presilha, para trás. Dá para
     fazer a prova ali (até 10 questões, as que mais pedem treino primeiro,
     alternativas embaralhadas, a correção na hora) ou folhear o banco com o
     gabarito marcado. A prova feita aqui entra no histórico como as outras. */
  const VERDE = '#3E7C3A', VERMELHO = '#C0473A';
  function paginaDesenho(ctx, l, a, f) {
    ctx.fillStyle = '#FBF8F2'; ctx.fillRect(0, 0, l, a);
    if (!f) return;
    ctx.fillStyle = '#9A9A94'; ctx.font = '800 15px Manrope';
    ctx.fillText(f.modo === 'folhear' ? 'BANCO DE QUESTÕES' : 'PROVA', 26, 38);
    if (f.tipo === 'resultado') {
      ctx.fillStyle = COR.tinta; ctx.font = '800 44px "Bricolage Grotesque"';
      ctx.fillText('Resultado', 26, 104);
      ctx.font = '800 92px "Bricolage Grotesque"';
      ctx.fillText(`${f.acertos}/${f.total}`, 26, 220);
      ctx.fillStyle = '#6A6A64'; ctx.font = '700 20px Manrope';
      ctx.fillText(`${f.acertos === 1 ? 'acerto' : 'acertos'} em ${Math.floor(f.segundos / 60)}min ${String(f.segundos % 60).padStart(2, '0')}s`, 26, 258);
      const pct = Math.round((f.acertos / Math.max(1, f.total)) * 100);
      ctx.save(); ctx.translate(l - 110, a - 130); ctx.rotate(-0.2);
      const cor = pct >= 70 ? VERDE : VERMELHO;
      ctx.strokeStyle = cor; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(0, 0, 72, 0, 7); ctx.stroke();
      ctx.fillStyle = cor; ctx.textAlign = 'center';
      ctx.font = '800 46px "Bricolage Grotesque"'; ctx.fillText(`${pct}%`, 0, 12);
      ctx.font = '800 15px Manrope'; ctx.fillText('ACERTO', 0, 40);
      ctx.restore();
      return;
    }
    const { q, k, n, ordem, escolhida, corrigir } = f;
    ctx.fillStyle = '#9A9A94'; ctx.textAlign = 'right'; ctx.fillText(`${k + 1} / ${n}`, l - 26, 38); ctx.textAlign = 'left';
    ctx.fillStyle = COR.tinta; ctx.font = '800 28px "Bricolage Grotesque"';
    ctx.fillText(`Questão ${k + 1}`, 26, 78);
    ctx.font = '600 18px Manrope'; ctx.fillStyle = '#2A2C31';
    const enunc = linhas(ctx, q.enunciado, l - 52, 7);
    enunc.forEach((tx, i) => ctx.fillText(tx, 26, 110 + i * 24));
    let y = 110 + enunc.length * 24 + 26;
    ordem.forEach((orig, i) => {
      const certa = orig === q.correta, marcada = i === escolhida;
      let fundo = null;
      if (corrigir && certa) fundo = VERDE;
      else if (corrigir && marcada && !certa) fundo = VERMELHO;
      else if (marcada) fundo = COR.tinta;
      ctx.beginPath(); ctx.arc(40, y - 6, 14, 0, 7);
      ctx.lineWidth = 2.5; ctx.strokeStyle = fundo ?? COR.tinta;
      if (fundo) { ctx.fillStyle = fundo; ctx.fill(); } else ctx.stroke();
      ctx.fillStyle = fundo ? '#FBF8F2' : COR.tinta; ctx.font = '800 14px Manrope'; ctx.textAlign = 'center';
      ctx.fillText('ABCDE'[i], 40, y - 1); ctx.textAlign = 'left';
      ctx.fillStyle = corrigir && !certa && !marcada ? '#8A8A84' : '#2A2C31'; ctx.font = '600 16px Manrope';
      const tl = linhas(ctx, q.alternativas[orig], l - 96, 2);
      tl.forEach((tx, j) => ctx.fillText(tx, 66, y + j * 20));
      y += Math.max(1, tl.length) * 20 + 18;
    });
    if (f.modo === 'folhear') {
      ctx.fillStyle = '#6A6A64'; ctx.font = '700 15px Manrope';
      ctx.fillText(q.tentativas ? `Acertou ${q.acertos} de ${q.tentativas} vezes` : 'Ainda não caiu em prova', 26, a - 26);
    }
  }
  // Duas páginas que se revezam: a que está à vista e a que vira.
  const paginas = [0, 1].map(() => tela(380, 500, paginaDesenho));
  let paginaVista = 0;
  const virando = new THREE.Group();
  {
    const frente = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.32), new THREE.MeshStandardMaterial({ map: paginas[0].tx, roughness: 0.9 }));
    const verso = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.32), mat('#EFEADF', { rug: 0.95 }));
    for (const m of [frente, verso]) { m.position.y = -0.66; m.userData.semRealce = true; }
    frente.rotation.y = Math.PI / 2;
    verso.rotation.y = -Math.PI / 2;
    virando.add(frente, verso);
    virando.userData.frente = frente;
  }
  virando.position.set(0.046, 0.58, 0);
  virando.visible = false;
  prancheta.add(virando);
  let viradaPagina = null;   // { t0, de, para, depois }

  let prova = null;    // { modo: 'fazer' | 'folhear' | 'resultado', lista, i, ordens, respostas, t0, editando }
  function folhaDe(k) {
    if (!prova) return null;
    if (prova.modo === 'resultado') return { tipo: 'resultado', modo: 'fazer', ...prova.resultado };
    const r = prova.respostas[k];
    return {
      modo: prova.modo, q: prova.lista[k], k, n: prova.lista.length, ordem: prova.ordens[k],
      escolhida: r ? r.indice : -1, corrigir: prova.modo === 'folhear' || !!r,
    };
  }
  /* Mostra a página `k`. Para a frente, a folha de cima sobe e revela a nova;
     para trás, a anterior desce por cima. */
  function mostrarPagina(sentido) {
    const nova = 1 - paginaVista;
    paginas[nova].redesenhar(folhaDe(prova.i));
    if (!sentido || calmo.matches) {
      folhaCima.material.map = paginas[nova].tx;
      paginaVista = nova;
    } else if (sentido > 0) {
      virando.userData.frente.material.map = paginas[paginaVista].tx;
      folhaCima.material.map = paginas[nova].tx;
      paginaVista = nova;
      viradaPagina = { t0: -1, de: 0, para: 2.9 };
    } else {
      virando.userData.frente.material.map = paginas[nova].tx;
      viradaPagina = { t0: -1, de: 2.9, para: 0, depois: () => { folhaCima.material.map = paginas[nova].tx; paginaVista = nova; } };
    }
    sombraSuja = true;
    pintarPainel();
  }
  function redesenharPagina() {
    paginas[paginaVista].redesenhar(folhaDe(prova.i));
  }
  function comecarProva() {
    const lista = ponte.questoesDaProva(10);
    if (!lista.length) return;
    prova = { modo: 'fazer', lista, i: 0, respostas: [], t0: performance.now(),
      ordens: lista.map((q) => q.alternativas.map((_, k) => k).sort(() => Math.random() - 0.5)) };
    mostrarPagina(1);
  }
  function folhear(id) {
    const lista = ponte.todasQuestoes();
    if (!lista.length) return;
    prova = { modo: 'folhear', lista, i: Math.max(0, lista.findIndex((q) => q.id === id)), respostas: [],
      ordens: lista.map((q) => q.alternativas.map((_, k) => k)) };
    mostrarPagina(1);
  }
  function responder(indice) {
    if (!prova || prova.modo !== 'fazer' || prova.respostas[prova.i]) return;
    const q = prova.lista[prova.i], orig = prova.ordens[prova.i][indice];
    if (orig == null) return;
    prova.respostas[prova.i] = { indice, questaoId: q.id, escolhida: orig, certa: orig === q.correta };
    redesenharPagina();
    pintarPainel();
  }
  function virarPagina(passo) {
    if (!prova || viradaPagina) return;
    if (prova.modo === 'fazer') {
      if (passo > 0 && !prova.respostas[prova.i]) return;   // responde antes de seguir
      if (passo > 0 && prova.i === prova.lista.length - 1) { entregar(); return; }
      if (passo < 0 && prova.i === 0) return;
    }
    if (prova.modo === 'folhear') {
      const n = prova.lista.length;
      if ((passo > 0 && prova.i >= n - 1) || (passo < 0 && prova.i <= 0)) return;
    }
    if (prova.modo === 'resultado') return;
    prova.i += passo;
    mostrarPagina(passo);
  }
  function entregar() {
    const respostas = prova.respostas.map((r) => ({ questaoId: r.questaoId, escolhida: r.escolhida, certa: r.certa }));
    const segundos = Math.round((performance.now() - prova.t0) / 1000);
    prova.resultado = { acertos: respostas.filter((r) => r.certa).length, total: respostas.length, segundos };
    prova.modo = 'resultado';
    mostrarPagina(1);
    ponte.registrarProva(respostas, segundos);
  }
  function largarProva() {
    prova = null;
    viradaPagina = null;
    virando.visible = false;
    folhaCima.material.map = folhaProva.tx;
    sombraSuja = true;
  }
  function animarVirada(t) {
    if (!viradaPagina) return;
    if (viradaPagina.t0 < 0) viradaPagina.t0 = t;
    const p = Math.min(1, (t - viradaPagina.t0) / 0.55), k = p * p * (3 - 2 * p);
    virando.visible = true;
    virando.rotation.z = viradaPagina.de + (viradaPagina.para - viradaPagina.de) * k;
    sombraSuja = true;
    if (p >= 1) { virando.visible = false; const d = viradaPagina.depois; viradaPagina = null; d?.(); }
  }
  // As teclas, com a prancheta em foco: setas viram, A a E (ou 1 a 5) respondem.
  window.addEventListener('keydown', (ev) => {
    if (focoAtual !== 'mural' || !prova || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) return;
    const tecla = ev.key.toLowerCase();
    let feito = true;
    if (tecla === 'arrowright') virarPagina(1);
    else if (tecla === 'arrowleft') virarPagina(-1);
    else if ('abcde'.includes(tecla) && tecla.length === 1) responder('abcde'.indexOf(tecla));
    else if ('12345'.includes(tecla) && tecla.length === 1) responder(Number(tecla) - 1);
    else feito = false;
    if (feito) ev.preventDefault();
  });

  // ── O zoom ────────────────────────────────────────────────────────────────
  /* Tocar num objeto aproxima a câmera dele e abre o painel ao lado (embaixo,
     no celular), com os detalhes e o que dá para fazer ali. Dentro do zoom, os
     livros e as divisórias do fichário se escolhem um por um. Sair é o botão do
     painel, o Esc, ou tocar no vazio. */
  const FOCOS = {
    estante: [estante],
    mesa: [caixaCards, pilhas, leque],
    relogio: [relogio],
    calendario: [calendario],
    mural: [mural],
    monitor: [monitor],
  };
  /* De onde se olha cada objeto no zoom: de frente para ele. A estante e o
     mural estão na parede da esquerda e são vistos pelo lado aberto do
     quarto; o resto, de frente para a parede do fundo. A mesa, um pouco de
     cima, para o tampo aparecer. */
  const FRENTES = {
    estante: new THREE.Vector3(1, 0.1, 0),
    mural: new THREE.Vector3(1, 0.06, 0),
    relogio: new THREE.Vector3(0, 0.06, 1),
    calendario: new THREE.Vector3(0, 0.06, 1),
    monitor: new THREE.Vector3(0, 0.18, 1),
    mesa: new THREE.Vector3(0, 0.62, 1),
  };
  for (const v of Object.values(FRENTES)) v.normalize();
  /* O que fica entre a câmera e o objeto, visto de frente, sai de cena
     durante o zoom: a cadeira tampa a mesa e as prateleiras de baixo. */
  const ATRAPALHA = {
    estante: [cadeira, mesa, luminaria, caneca, monitor, caixaCards, pilhas, ...plantas, mochila, livrosChao],
    mesa: [cadeira],
    monitor: [cadeira],
  };
  const sumindo = new Map([...new Set(Object.values(ATRAPALHA).flat())].map((o) => [o, { s: 1, de: 1, para: 1, t0: 0 }]));
  let focoAtual = null, selecionado = null, detalhe = null;

  const painel = document.createElement('aside');
  painel.className = 'quarto-painel';
  painel.setAttribute('aria-live', 'polite');
  palco.appendChild(painel);

  /* Um elemento com texto, montado sem innerHTML: o nome da pasta ou do deck
     é da pessoa, e nunca vira marcação. */
  function el(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  }
  function botao(texto, classe, acao, desligado) {
    const b = el('button', 'qp-botao ' + classe, texto);
    b.type = 'button';
    if (desligado) b.disabled = true;
    else b.addEventListener('click', acao);
    return b;
  }
  /* Ir para outra tela fecha o zoom na hora: voltar ao Dashboard é voltar ao
     quarto inteiro. */
  const ir = (...args) => () => { sair(true); ponte.abrir(...args); };
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  function numeros(lista) {
    const g = el('div', 'qp-numeros');
    for (const [valor, rotulo] of lista) {
      const c = el('div', 'qp-numero');
      c.append(el('strong', '', String(valor)), el('span', '', rotulo));
      g.append(c);
    }
    return g;
  }
  function item(titulo, meta, { acao, selo, ativo, feito } = {}) {
    const i = el(acao ? 'button' : 'div', 'qp-item' + (ativo ? ' ativo' : '') + (feito ? ' feito' : ''));
    if (acao) { i.type = 'button'; i.addEventListener('click', acao); }
    const textos = el('span', 'qp-item-textos');
    textos.append(el('span', 'qp-item-titulo', titulo));
    if (meta) textos.append(el('span', 'qp-item-meta', meta));
    i.append(textos);
    if (selo) i.append(el('span', 'qp-selo', selo));
    else if (acao) i.append(el('span', 'qp-seta', '›'));
    return i;
  }
  const alvoPorId = (id) => alvos.find((a) => a.id === id);
  const minutosLegiveis = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'min' : ''}` : `${m} min`);
  const relogioTexto = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

  let vivo = null;   // o que o painel atualiza a cada segundo, se algo
  /* Os campos de edição. O recado de erro fica embaixo do formulário, e
     gravar devolve o texto dele (vazio quando deu certo). */
  function campo(rotulo, entrada) {
    const c = el('label', 'qp-campo');
    c.append(el('span', 'qp-campo-rotulo', rotulo), entrada);
    return c;
  }
  function entrada(valor, { multi = false, linhasMin = 3, dica = '' } = {}) {
    const e = el(multi ? 'textarea' : 'input', 'qp-entrada');
    if (multi) e.rows = linhasMin; else e.type = 'text';
    e.value = valor ?? '';
    if (dica) e.placeholder = dica;
    return e;
  }
  const TIPO_SESSAO = { teoria: 'Teoria', revisao: 'Revisão', questoes: 'Questões', simulado: 'Simulado', cards: 'Flashcards' };
  const diaPorExtenso = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  function pintarPainel() {
    vivo = null;
    if (!focoAtual) return;
    const e = estado;
    const topo = el('div', 'qp-topo');
    const sobre = el('span', 'qp-sobre');
    const fechar = el('button', 'qp-fechar', '×');
    fechar.type = 'button';
    fechar.setAttribute('aria-label', 'Voltar ao quarto');
    fechar.title = 'Voltar ao quarto (Esc)';
    fechar.addEventListener('click', () => sair());
    topo.append(sobre, fechar);
    const titulo = el('h3', 'qp-titulo');
    const sub = el('p', 'qp-sub');
    const corpo = el('div', 'qp-corpo');
    const acoes = el('div', 'qp-acoes');
    const erro = el('p', 'qp-erro');
    const conteudo = [];
    const volta = (texto, fazer) => {
      const b = el('button', 'qp-volta', '‹ ' + texto);
      b.type = 'button';
      b.addEventListener('click', fazer);
      conteudo.push(b);
    };
    const salvarCom = (fazer) => () => {
      const recado = fazer();
      erro.textContent = recado || '';
    };

    if (focoAtual === 'estante') {
      const p = selecionado && e.pastas.find((x) => 'pasta:' + x.id === selecionado.id);
      const arq = p && detalhe && p.lista.find((x) => `arquivo:${p.id}:${x.id}` === detalhe.id);
      if (arq) {
        volta(p.nome, () => escolherDetalhe(null));
        sobre.textContent = 'Arquivo';
        titulo.textContent = arq.nome;
        sub.textContent = arq.desc || 'Sem descrição.';
        corpo.append(numeros([[arq.cards, arq.cards === 1 ? 'flashcard' : 'flashcards']]));
        acoes.append(botao('Abrir arquivo', 'primario', ir('arquivo', p.id, arq.id)));
      } else if (p) {
        volta('Todas as pastas', () => selecionar(null));
        sobre.textContent = 'Pasta';
        titulo.textContent = p.nome;
        sub.textContent = 'O livro está aberto na frente da estante. Toque numa ficha para ver o arquivo.';
        const nome = entrada(p.nome);
        const desc = entrada(p.desc, { multi: true, linhasMin: 2, dica: 'Sobre o que é esta pasta' });
        const form = el('div', 'qp-form');
        form.append(campo('Nome', nome), campo('Descrição', desc));
        corpo.append(form, erro, numeros([[p.arquivos, p.arquivos === 1 ? 'arquivo' : 'arquivos'], [p.cards, p.cards === 1 ? 'flashcard' : 'flashcards']]));
        if (p.lista.length) {
          const l = el('div', 'qp-lista');
          for (const a2 of p.lista) {
            l.append(item(a2.nome, plural(a2.cards, 'card', 'cards'), { acao: () => escolherDetalhe(alvoPorId(`arquivo:${p.id}:${a2.id}`)) }));
          }
          corpo.append(l);
        }
        acoes.append(botao('Salvar', 'primario', salvarCom(() => ponte.editar('pasta', p.id, { nome: nome.value, desc: desc.value }))));
        acoes.append(botao('Abrir pasta', 'secundario', ir('pasta', p.id)));
      } else {
        sobre.textContent = 'Estante';
        titulo.textContent = e.pastas.length ? plural(e.pastas.length, 'pasta', 'pastas') : 'Estante vazia';
        sub.textContent = e.pastas.length ? 'Toque num livro para abri-lo.' : 'Crie a primeira pasta para guardar seus resumos.';
        if (e.pastas.length) {
          const l = el('div', 'qp-lista');
          for (const p2 of e.pastas.slice(0, 12)) {
            l.append(item(p2.nome, `${plural(p2.arquivos, 'arquivo', 'arquivos')} · ${plural(p2.cards, 'card', 'cards')}`,
              { acao: () => selecionar(alvoPorId('pasta:' + p2.id)) }));
          }
          corpo.append(l);
        }
        acoes.append(botao('Nova pasta', 'primario', ir('pasta.nova')));
        if (e.pastas.length) acoes.append(botao('Ver todas', 'secundario', ir('pastas')));
      }
    }

    if (focoAtual === 'mesa') {
      const d = selecionado && e.decks.find((x) => 'deck:' + x.nome === selecionado.id);
      const cartas = d ? ponte.cartas(d.nome) : [];
      const c = d && detalhe && cartas.find((x) => 'carta:' + x.id === detalhe.id);
      if (c) {
        volta('Cards de ' + d.nome, () => escolherDetalhe(null));
        sobre.textContent = 'Flashcard';
        titulo.textContent = 'Editar card';
        sub.textContent = `${c.quando} · ${c.acertos}. Toque no card para virá-lo.`;
        const frente = entrada(c.frente, { multi: true, linhasMin: 3 });
        const verso = entrada(c.verso, { multi: true, linhasMin: 3 });
        const form = el('div', 'qp-form');
        form.append(campo('Frente', frente), campo('Verso', verso));
        corpo.append(form, erro);
        acoes.append(botao('Salvar', 'primario', salvarCom(() => ponte.editar('card', c.id, { frente: frente.value, verso: verso.value }))));
        acoes.append(botao('Virar', 'secundario', () => virarCarta(detalhe)));
        acoes.append(botao('Excluir', 'perigo', () => ponte.excluir('card', c.id, () => escolherDetalhe(null))));
      } else if (d) {
        volta('Todos os decks', () => selecionar(null));
        sobre.textContent = 'Deck';
        titulo.textContent = d.nome;
        sub.textContent = cartas.length ? 'Os cards estão abertos na mesa. Toque num para ver e editar.' : 'Este deck ainda não tem cards.';
        corpo.append(numeros([[d.conta, 'cards'], [d.hoje, 'para hoje'], [d.retencao + '%', 'de acerto']]));
        const paginas = leque.userData.paginas || 1;
        if (cartas.length) {
          const l = el('div', 'qp-lista');
          for (const c2 of cartas.slice(paginaLeque * POR_PAGINA, (paginaLeque + 1) * POR_PAGINA)) {
            l.append(item(c2.frente, c2.quando, { acao: () => escolherDetalhe(alvoPorId('carta:' + c2.id)) }));
          }
          corpo.append(l);
        }
        if (paginas > 1) {
          const nav = el('div', 'qp-paginas');
          nav.append(
            botao('‹', 'secundario mini', () => trocarPagina(-1), paginaLeque === 0),
            el('span', '', `${paginaLeque + 1} de ${paginas}`),
            botao('›', 'secundario mini', () => trocarPagina(1), paginaLeque >= paginas - 1),
          );
          corpo.append(nav);
        }
        acoes.append(botao('Revisar este deck', 'primario', ir('revisao', d.nome), !d.hoje));
        acoes.append(botao('Abrir deck', 'secundario', ir('deck', d.nome)));
      } else {
        sobre.textContent = 'Flashcards';
        titulo.textContent = e.filaHoje ? plural(e.filaHoje, 'card para hoje', 'cards para hoje') : 'Fila em dia';
        sub.textContent = 'Toque numa aba do fichário para abrir os cards do deck na mesa.';
        if (e.decks.length) {
          const l = el('div', 'qp-lista');
          for (const d2 of e.decks) {
            l.append(item(d2.nome, `${plural(d2.conta, 'card', 'cards')} · ${d2.retencao}% de acerto`,
              { acao: () => selecionar(alvoPorId('deck:' + d2.nome) ?? null), selo: d2.hoje ? String(d2.hoje) : null }));
          }
          corpo.append(l);
        } else {
          corpo.append(el('p', 'qp-nota', 'Nenhum deck ainda. Os cards nascem dos seus resumos.'));
        }
        acoes.append(botao(e.filaHoje ? `Revisar agora (${e.filaHoje})` : 'Revisar agora', 'primario', ir('revisao'), !e.filaHoje));
        acoes.append(botao('Ver decks', 'secundario', ir('decks')));
      }
    }

    if (focoAtual === 'relogio') {
      const f = e.foco;
      sobre.textContent = 'Pomodoro';
      titulo.textContent = f.rodando ? (f.rotulo === 'Foco' ? 'Em foco' : f.rotulo) : 'Pronto para focar';
      sub.textContent = f.rodando ? 'O anel no relógio mostra quanto falta.' : 'Um ciclo de foco, e depois uma pausa curta.';
      const visor = el('div', 'qp-relogio', relogioTexto(f.resta));
      corpo.append(visor, numeros([[minutosLegiveis(f.minutos), 'em foco hoje'], [f.ciclos, f.ciclos === 1 ? 'ciclo fechado' : 'ciclos fechados']]));
      acoes.append(botao(f.rodando ? 'Pausar' : 'Começar', 'primario', () => {
        ponte.abrir('foco.alternar');
        estado = ponte.estado();
        pintarPainel();
      }));
      acoes.append(botao('Abrir Pomodoro', 'secundario', ir('pomodoro')));
      const rodava = f.rodando;
      vivo = () => {
        visor.textContent = relogioTexto(estado.foco.resta);
        if (estado.foco.rodando !== rodava) pintarPainel();
      };
    }

    if (focoAtual === 'calendario') {
      const sem = e.semana;
      const s = sem && selecionado && sem.dias.flatMap((d) => d.sessoes.map((x) => ({ ...x, data: d.data })))
        .find((x) => `sessao:${sem.planoId}:${x.id}` === selecionado.id);
      if (s) {
        volta('A semana', () => selecionar(null));
        sobre.textContent = diaPorExtenso(s.data);
        titulo.textContent = s.titulo;
        sub.textContent = s.sobre || (TIPO_SESSAO[s.tipo] ?? 'Sessão de estudo');
        corpo.append(numeros([[minutosLegiveis(s.minutos), 'de estudo'], [TIPO_SESSAO[s.tipo] ?? '-', 'tipo']]));
        acoes.append(botao(s.feita ? 'Desmarcar' : 'Marcar como feita', 'primario', () => ponte.alternarSessao(sem.planoId, s.id)));
        acoes.append(botao('Ir para a sessão', 'secundario', ir('sessao', sem.planoId, s.id)));
      } else if (sem) {
        sobre.textContent = 'Esta semana';
        titulo.textContent = sem.plano;
        const todas = sem.dias.flatMap((d) => d.sessoes);
        const feitas = todas.filter((x) => x.feita).length;
        sub.textContent = todas.length ? `${feitas} de ${todas.length} sessões feitas. Toque numa etiqueta do calendário.` : 'Nada marcado nesta semana.';
        const l = el('div', 'qp-lista');
        for (const d of sem.dias) {
          for (const x of d.sessoes) {
            l.append(item(x.titulo, `${d.nome} ${d.numero} · ${minutosLegiveis(x.minutos)}`,
              { acao: () => selecionar(alvoPorId(`sessao:${sem.planoId}:${x.id}`)), feito: x.feita, ativo: d.hoje }));
          }
        }
        if (todas.length) corpo.append(l);
        acoes.append(botao('Abrir plano', 'primario', ir('plano', sem.planoId)));
        acoes.append(botao('Novo plano', 'secundario', ir('plano.novo')));
      } else {
        sobre.textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
        titulo.textContent = 'Nenhum plano ainda';
        sub.textContent = 'A IA monta um cronograma a partir da sua prova e do seu tempo.';
        acoes.append(botao('Montar um plano com a IA', 'primario', ir('plano.novo')));
      }
    }

    if (focoAtual === 'mural') {
      const editar = prova?.editando && ponte.todasQuestoes().find((x) => x.id === prova.editando);
      if (editar) {
        const q = editar;
        volta('Voltar à folha', () => { prova.editando = null; pintarPainel(); });
        sobre.textContent = 'Questão';
        titulo.textContent = 'Editar questão';
        sub.textContent = q.tentativas ? `Acertou ${q.acertos} de ${q.tentativas} vezes.` : 'Ainda não caiu em nenhuma prova.';
        const enunciado = entrada(q.enunciado, { multi: true, linhasMin: 3 });
        const form = el('div', 'qp-form');
        form.append(campo('Enunciado', enunciado));
        const grupo = el('div', 'qp-campo');
        grupo.append(el('span', 'qp-campo-rotulo', 'Alternativas (marque a certa)'));
        const alts = [];
        const nomeRadio = 'qp-certa-' + q.id;
        for (let i = 0; i < 5; i++) {
          const linhaAlt = el('div', 'qp-alt');
          const r = el('input');
          r.type = 'radio'; r.name = nomeRadio; r.checked = i === q.correta;
          r.setAttribute('aria-label', `Alternativa ${i + 1} é a certa`);
          const t = entrada(q.alternativas[i] ?? '', { dica: i < 2 ? `Alternativa ${i + 1}` : 'Opcional' });
          linhaAlt.append(r, t);
          grupo.append(linhaAlt);
          alts.push([r, t]);
        }
        const explicacao = entrada(q.explicacao, { multi: true, linhasMin: 2, dica: 'Por que a certa é a certa' });
        form.append(grupo, campo('Explicação', explicacao));
        corpo.append(form, erro);
        acoes.append(botao('Salvar', 'primario', salvarCom(() => {
          const recado = ponte.editar('questao', q.id, {
            enunciado: enunciado.value,
            alternativas: alts.map(([, t]) => t.value),
            correta: alts.findIndex(([r]) => r.checked),
            explicacao: explicacao.value,
          });
          // Salvo: a folha volta com o texto novo.
          if (!recado) { prova.editando = null; prova.lista = ponte.todasQuestoes(); prova.ordens = prova.lista.map((x) => x.alternativas.map((_, k) => k)); redesenharPagina(); pintarPainel(); }
          return recado;
        })));
        acoes.append(botao('Excluir', 'perigo', () => ponte.excluir('questao', q.id, () => { largarProva(); pintarPainel(); })));
      } else if (prova?.modo === 'fazer') {
        const q = prova.lista[prova.i], r = prova.respostas[prova.i];
        const ultima = prova.i === prova.lista.length - 1;
        volta('Sair da prova', () => { largarProva(); pintarPainel(); });
        sobre.textContent = `Prova · ${prova.i + 1} de ${prova.lista.length}`;
        titulo.textContent = `Questão ${prova.i + 1}`;
        sub.textContent = q.enunciado;
        const l = el('div', 'qp-lista qp-alternativas');
        prova.ordens[prova.i].forEach((orig, i) => {
          const certa = orig === q.correta, marcada = r && r.indice === i;
          const b = item(`${'ABCDE'[i]}) ${q.alternativas[orig]}`, null, {
            acao: r ? null : () => responder(i),
            ativo: marcada,
          });
          if (r && certa) b.classList.add('certa');
          if (r && marcada && !certa) b.classList.add('errada');
          l.append(b);
        });
        corpo.append(l);
        if (r) {
          const fb = el('div', 'qp-correcao ' + (r.certa ? 'certa' : 'errada'));
          fb.append(el('strong', '', r.certa ? 'Certa!' : `Errou. A certa é a ${'ABCDE'[prova.ordens[prova.i].indexOf(q.correta)]}.`));
          if (q.explicacao) fb.append(el('p', '', q.explicacao));
          corpo.append(fb);
          acoes.append(botao(ultima ? 'Ver resultado' : 'Próxima', 'primario', () => virarPagina(1)));
        } else {
          corpo.append(el('p', 'qp-nota', 'Escolha uma alternativa (ou tecle A a E).'));
        }
        if (prova.i > 0) acoes.append(botao('Anterior', 'secundario', () => virarPagina(-1)));
      } else if (prova?.modo === 'resultado') {
        const { acertos, total, segundos } = prova.resultado;
        volta('Voltar à prancheta', () => { largarProva(); pintarPainel(); });
        sobre.textContent = 'Prova entregue';
        titulo.textContent = `Você acertou ${acertos} de ${total}`;
        sub.textContent = acertos / Math.max(1, total) >= 0.7 ? 'Bom resultado. A prova já está no seu histórico.' : 'A prova já está no seu histórico; as que você errou voltam primeiro na próxima.';
        corpo.append(numeros([[Math.round((acertos / Math.max(1, total)) * 100) + '%', 'de acerto'], [`${Math.floor(segundos / 60)}min ${segundos % 60}s`, 'de prova']]));
        acoes.append(botao('Fazer outra', 'primario', () => comecarProva()));
        acoes.append(botao('Ver banco', 'secundario', ir('questoes')));
      } else if (prova?.modo === 'folhear') {
        const q = prova.lista[prova.i];
        volta('Voltar à prancheta', () => { largarProva(); pintarPainel(); });
        sobre.textContent = `Banco · ${prova.i + 1} de ${prova.lista.length}`;
        titulo.textContent = `Questão ${prova.i + 1}`;
        sub.textContent = q.enunciado;
        const l = el('div', 'qp-lista qp-alternativas');
        q.alternativas.forEach((alt, i) => {
          const b = item(`${'ABCDE'[i]}) ${alt}`, null, {});
          if (i === q.correta) b.classList.add('certa');
          l.append(b);
        });
        corpo.append(l);
        if (q.explicacao) { const fb = el('div', 'qp-correcao certa'); fb.append(el('p', '', q.explicacao)); corpo.append(fb); }
        corpo.append(el('p', 'qp-nota', q.tentativas ? `Acerto: ${acertoDe(q)} em ${q.tentativas} ${q.tentativas === 1 ? 'tentativa' : 'tentativas'}.` : 'Ainda não caiu em prova.'));
        const nav = el('div', 'qp-paginas');
        nav.append(
          botao('‹', 'secundario mini', () => virarPagina(-1), prova.i === 0),
          el('span', '', `${prova.i + 1} de ${prova.lista.length}`),
          botao('›', 'secundario mini', () => virarPagina(1), prova.i >= prova.lista.length - 1),
        );
        corpo.append(nav);
        acoes.append(botao('Editar', 'primario', () => { prova.editando = q.id; pintarPainel(); }));
        acoes.append(botao('Fazer a prova', 'secundario', () => comecarProva()));
      } else {
        sobre.textContent = 'Questões';
        titulo.textContent = e.questoes ? plural(e.questoes, 'questão no banco', 'questões no banco') : 'Prova em branco';
        sub.textContent = e.questoes
          ? 'Faça uma prova aqui mesmo, na prancheta, ou folheie o banco com o gabarito.'
          : 'As questões nascem dos seus resumos, como os cards.';
        if (e.questoes) corpo.append(numeros([[e.questoes, 'questões'], [e.acertoQuestoes == null ? '-' : e.acertoQuestoes + '%', 'de acerto']]));
        if (e.provas.length) {
          corpo.append(el('p', 'qp-rotulo', 'Últimas provas'));
          const l = el('div', 'qp-lista');
          for (const pv of e.provas) l.append(item(`${pv.acertos} de ${pv.total}`, pv.quando, { selo: Math.round((pv.acertos / Math.max(1, pv.total)) * 100) + '%' }));
          corpo.append(l);
        }
        if (e.questoes) {
          acoes.append(botao(`Fazer a prova (${Math.min(10, e.questoes)})`, 'primario', () => comecarProva()));
          acoes.append(botao('Folhear', 'secundario', () => folhear()));
        } else acoes.append(botao('Criar questões', 'primario', ir('questoes')));
      }
    }

    if (focoAtual === 'monitor') {
      const i = selecionado?.id.startsWith('dia:') ? Number(selecionado.id.slice(4)) : -1;
      const dia = e.sete[i];
      if (dia) {
        volta('A semana', () => selecionar(null));
        sobre.textContent = dia.hoje ? 'Hoje' : dia.dia;
        titulo.textContent = dia.data;
        sub.textContent = dia.n ? 'As revisões deste dia.' : 'Nenhuma revisão neste dia.';
        corpo.append(numeros([
          [dia.n, dia.n === 1 ? 'card revisado' : 'cards revisados'],
          [dia.acertos, dia.acertos === 1 ? 'acerto' : 'acertos'],
          [dia.n ? Math.round((dia.acertos / dia.n) * 100) + '%' : '-', 'de acerto'],
        ]));
        acoes.append(botao('Ver decks', 'primario', ir('decks')));
      } else {
        const n = e.numeros, total7 = e.sete.reduce((t, d) => t + d.n, 0);
        sobre.textContent = 'Esta semana';
        titulo.textContent = plural(total7, 'card revisado', 'cards revisados');
        sub.textContent = 'Toque numa barra da tela para ver o dia.';
        corpo.append(numeros([
          [n.revisadosHoje, 'revisados hoje'],
          [n.acerto30 == null ? '-' : n.acerto30 + '%', 'acerto em 30 dias'],
          [n.sequencia, n.sequencia === 1 ? 'dia seguido' : 'dias seguidos'],
          [e.filaHoje, 'na fila hoje'],
        ]));
        acoes.append(botao('Ver decks', 'primario', ir('decks')));
        if (e.filaHoje) acoes.append(botao('Revisar agora', 'secundario', ir('revisao')));
      }
    }

    painel.replaceChildren(topo, ...conteudo, titulo, sub, corpo, acoes);
    painel.setAttribute('aria-label', sobre.textContent);
  }

  // A câmera voa entre o quarto inteiro e o objeto, com aceleração e freio.
  const CIMA = new THREE.Vector3(0, 1, 0);
  const atual = { alvo: ALVO.clone(), zoom: 1, dir: DIRECAO.clone() };
  let quer = { alvo: ALVO.clone(), zoom: 1, dir: DIRECAO.clone() }, voo = null;
  /* A vista de longe é da pessoa: a rodinha (ou a pinça do trackpad) aproxima
     e afasta o quarto entre os limites, na direção do ponteiro. Sair do zoom
     de um objeto volta para essa vista, e não para a de fábrica. */
  const ZOOM_MIN = 0.75, ZOOM_MAX = 2.6;
  const vistaLivre = { alvo: ALVO.clone(), zoom: 1 };
  const suave = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  function voar(para) {
    quer = para;
    voo = { de: { alvo: atual.alvo.clone(), zoom: atual.zoom, dir: atual.dir.clone() }, t0: 0, dur: calmo.matches ? 1 : 1100 };
  }
  /* O enquadramento do foco: a caixa dos objetos, vista pela câmera, tem de
     caber no que sobra do palco ao lado do painel (ou acima dele). */
  function vistaDe(cena) {
    if (!cena) return { alvo: vistaLivre.alvo.clone(), zoom: vistaLivre.zoom, dir: DIRECAO.clone() };
    const caixa3 = new THREE.Box3();
    // O que ainda está surgindo é medido no tamanho em que vai ficar.
    const escalas = [...surgindo].map((o) => [o, o.scale.clone()]);
    for (const [o] of escalas) o.scale.setScalar(1);
    // Com o leque aberto, é ele que se enquadra.
    const objs = cena === 'mesa' && leque.children.length ? [leque] : cena === 'estante' && livroAberto.children.length ? [livroAberto] : FOCOS[cena];
    for (const o of objs) { o.updateMatrixWorld(true); caixa3.expandByObject(o); }
    for (const [o, s] of escalas) o.scale.copy(s);
    const centro = caixa3.getCenter(new THREE.Vector3());
    const olhar = FRENTES[cena];
    const frente = olhar.clone().negate();
    const dir = new THREE.Vector3().crossVectors(frente, CIMA).normalize();
    const cima = new THREE.Vector3().crossVectors(dir, frente).normalize();
    let w = 0, h = 0;
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Vector3(i & 1 ? caixa3.max.x : caixa3.min.x, i & 2 ? caixa3.max.y : caixa3.min.y, i & 4 ? caixa3.max.z : caixa3.min.z).sub(centro);
      w = Math.max(w, Math.abs(c.dot(dir)) * 2);
      h = Math.max(h, Math.abs(c.dot(cima)) * 2);
    }
    const W = palco.clientWidth, H = palco.clientHeight;
    const baseW = camera.right - camera.left, baseH = camera.top - camera.bottom;
    const deitado = !caixa.classList.contains('estreito');
    // 340px é a largura do painel no CSS; medir aqui forçava o layout da página.
    const pw = deitado ? 340 + 24 : 0;
    const ph = deitado ? 0 : painel.offsetHeight + 12;
    /* O que fica por cima do palco e não pode cobrir o objeto: no modo quarto,
       a coluna de atalhos à esquerda. Medida só aqui, na hora do zoom, e não a
       cada quadro. */
    const caixaPalco = palco.getBoundingClientRect();
    const coluna = document.querySelector('.hud:not([hidden]) .hud-atalhos');
    const esq = coluna ? Math.max(0, coluna.getBoundingClientRect().right - caixaPalco.left + 16) : 0;
    const topo = 0;
    // Bem perto: o objeto ocupa quase todo o espaço livre entre esses cantos e o painel.
    const livreW = Math.max(120, W - pw - esq - 40), livreH = Math.max(120, H - ph - topo - 40);
    const zoom = Math.min(7, Math.max(1.2, Math.min((livreW / W) * baseW / w, (livreH / H) * baseH / h)));
    // O objeto vai para o meio do espaço livre: o alvo da câmera anda o contrário.
    const meioX = (esq + (W - pw)) / 2 - W / 2, meioY = (topo + (H - ph)) / 2 - H / 2;
    const alvo = centro.clone()
      .addScaledVector(dir, -(meioX / W) * baseW / zoom)
      .addScaledVector(cima, (meioY / H) * baseH / zoom);
    return { alvo, zoom, dir: olhar.clone() };
  }

  function diaEscolhido() { return selecionado?.id.startsWith('dia:') ? Number(selecionado.id.slice(4)) : -1; }
  /* Os itens 3D do zoom seguem o que está escolhido: o leque do deck, o livro
     aberto da pasta, a semana no calendário. */
  function sincronizarItens() {
    sombraSuja = true;
    // Os itens mudaram embaixo do ponteiro parado: o realce é refeito.
    ponteiroAndou = true;
    const deck = focoAtual === 'mesa' && selecionado?.id.startsWith('deck:') ? selecionado.id.slice(5) : null;
    const mudouLeque = montarLeque(deck);
    const pasta = focoAtual === 'estante' && selecionado?.id.startsWith('pasta:') ? estado.pastas.find((x) => 'pasta:' + x.id === selecionado.id) : null;
    const mudouLivro = montarLivroAberto(pasta ?? null);
    if (mudouLivro && focoAtual === 'estante') voar(vistaDe('estante'));
    montarSemana(focoAtual === 'calendario' ? estado.semana : null);
    if (detalhe) detalhe = alvos.find((a) => a.id === detalhe.id) ?? null;
    if (mudouLeque && focoAtual === 'mesa') voar(vistaDe('mesa'));
  }
  function escolherDetalhe(a) {
    detalhe = a && a.nivel === 2 ? a : null;
    pintarPainel();
  }
  function trocarPagina(passo) {
    paginaLeque = Math.max(0, paginaLeque + passo);
    detalhe = null;
    sincronizarItens();
    pintarPainel();
  }
  function entrar(cena, sub) {
    focoAtual = cena;
    selecionado = sub?.nivel === 1 ? sub : null;
    detalhe = null;
    paginaLeque = 0;
    estado = ponte.estado();
    sincronizarItens();
    if (selecionado) selecionado = alvos.find((a) => a.id === selecionado.id) ?? null;
    telaMonitor.redesenhar(estado, diaEscolhido(), -1);
    pintarPainel();
    painel.classList.add('aberto');
    caixa.classList.add('focado');
    voar(vistaDe(cena));
    painel.querySelector('.qp-fechar')?.focus({ preventScroll: true });
  }
  function selecionar(a) {
    selecionado = a && a.nivel === 1 ? a : null;
    detalhe = null;
    paginaLeque = 0;
    sincronizarItens();
    telaMonitor.redesenhar(estado, diaEscolhido(), -1);
    pintarPainel();
  }
  function sair(jaFoi) {
    if (!focoAtual) return;
    focoAtual = null;
    selecionado = null;
    detalhe = null;
    if (prova) largarProva();
    sincronizarItens();
    telaMonitor.redesenhar(estado, -1, -1);
    painel.classList.remove('aberto');
    caixa.classList.remove('focado');
    if (jaFoi) {
      // Saindo para outra tela: o quarto volta inteiro, sem voo, para quando ela voltar.
      quer = vistaDe(null); voo = null;
      atual.alvo.copy(quer.alvo); atual.zoom = quer.zoom; atual.dir.copy(DIRECAO);
    } else {
      voar(vistaDe(null));
    }
  }
  /* Na captura, para chegar antes dos atalhos do app; com gaveta ou diálogo
     aberto por cima, o Esc é deles. */
  const algoPorCima = () => ['gavetaOverlay', 'dialogoOverlay'].some((id) => { const o = document.getElementById(id); return o && !o.hidden; });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !focoAtual || !visivel || algoPorCima() || naMini()) return;
    e.preventDefault();
    e.stopPropagation();
    const ativo = document.activeElement;
    if (ativo && palco.contains(ativo) && /^(INPUT|TEXTAREA)$/.test(ativo.tagName)) {
      ativo.blur();
      return;
    }
    // Volta um nível por vez: do card ao deck, do deck ao objeto, do objeto ao quarto.
    if (detalhe) escolherDetalhe(null);
    else if (selecionado) selecionar(null);
    else sair();
  }, true);

  // ── As placas ─────────────────────────────────────────────────────────────
  /* Cada objeto que é uma ferramenta tem uma placa sempre à vista, com o
     ícone e o nome do atalho da coluna e o número do dia: quem olha o quarto
     sabe na hora que a estante são as pastas e a caixa é a revisão. A placa
     também é um botão (aproxima o objeto), e passar por ela acende o objeto.
     Com zoom, as placas saem. */
  const ICONES = {
    pasta: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    cards: '<rect x="3" y="6" width="14" height="13" rx="2.5"/><path d="M8 3h10a3 3 0 0 1 3 3v10"/>',
    relogio: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9 2h6"/>',
    plano: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="m9 15 2 2 4-4"/>',
    lista: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11"/><circle cx="5.25" cy="18" r="1.6"/>',
    grafico: '<path d="M3 20h18M6 16v-4M11 16V7M16 16v-6M20 16V4"/>',
  };
  const PLACAS = [
    { alvo: 'estante', nome: 'Pastas', icone: 'pasta', valor: (e) => String(e.pastas.length) },
    { alvo: 'revisao', nome: 'Revisão', icone: 'cards', valor: (e) => (e.filaHoje ? `${e.filaHoje} hoje` : 'em dia') },
    { alvo: 'pomodoro', nome: 'Pomodoro', icone: 'relogio', valor: (e) => (e.foco.rodando ? relogioTexto(e.foco.resta) : `${e.foco.minutos} min`) },
    { alvo: 'planos', nome: 'Planos', icone: 'plano', valor: (e) => String(e.planos) },
    { alvo: 'questoes', nome: 'Questões', icone: 'lista', valor: (e) => String(e.questoes) },
    { alvo: 'decks', nome: 'Desempenho', icone: 'grafico', valor: (e) => (e.numeros.acerto30 == null ? 'semana' : `${e.numeros.acerto30}%`) },
  ];
  const camadaPlacas = el('div', 'quarto-placas');
  palco.appendChild(camadaPlacas);
  for (const p of PLACAS) {
    const a = alvoPorId(p.alvo);
    const b = el('button', 'quarto-placa');
    b.type = 'button';
    b.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONES[p.icone]}</svg>`;
    p.valorEl = el('span', 'quarto-placa-valor');
    b.append(el('span', 'quarto-placa-nome', p.nome), p.valorEl);
    b.addEventListener('click', () => { if (!focoAtual) entrar(a.cena); });
    b.addEventListener('pointerenter', () => { a.placa = true; b.classList.add('acesa'); });
    b.addEventListener('pointerleave', () => { a.placa = false; b.classList.remove('acesa'); });
    b.addEventListener('focus', () => { a.placa = true; });
    b.addEventListener('blur', () => { a.placa = false; });
    p.el = b;
    p.a = a;
    p.mundo = new THREE.Vector3();
    camadaPlacas.appendChild(b);
  }
  function pintarPlacas() {
    for (const p of PLACAS) {
      const v = estado.carregado ? p.valor(estado) : '';
      if (v !== p.ultimo) {
        p.ultimo = v; p.valorEl.textContent = v; p.valorEl.hidden = !v;
        // A largura só é medida quando o texto muda (ler a cada quadro forçaria o layout).
        p.w = p.el.offsetWidth; p.h = p.el.offsetHeight;
      }
      p.el.setAttribute('aria-label', `${p.nome}${v ? ', ' + v : ''}. Aproximar`);
    }
  }
  /* A cada quadro, só o lugar: a placa fica em cima do objeto, onde quer que a
     câmera esteja. */
  const HASTE = 14;
  function posicionarPlacas() {
    const W = palco.clientWidth, H = palco.clientHeight;
    for (const p of PLACAS) {
      p.mundo.copy(p.a.ancora ?? p.mundo.set(0, 0, 0));
      p.a.grupo.localToWorld(p.mundo).project(camera);
      p.x = (p.mundo.x * 0.5 + 0.5) * W;
      p.y = (-p.mundo.y * 0.5 + 0.5) * H;
      p.base = p.y - HASTE;   // onde fica a borda de baixo da placa
    }
    /* Duas placas que se encostam: a de cima sobe até sair da frente, e o pino
       dela cresce até o objeto. A de baixo fica no lugar. */
    const ordem = [...PLACAS].sort((a, b) => b.y - a.y);
    for (let i = 0; i < ordem.length; i++) {
      const p = ordem[i];
      for (let j = 0; j < i; j++) {
        const q = ordem[j];
        const juntas = Math.abs(p.x - q.x) < ((p.w || 120) + (q.w || 120)) / 2 + 8;
        const topoQ = q.base - (q.h || 30);
        if (juntas && p.base > topoQ - 6) p.base = topoQ - 6;
      }
    }
    for (const p of PLACAS) {
      p.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.base.toFixed(1)}px) translate(-50%, -100%)`;
      const haste = Math.round(p.y - p.base);
      if (haste !== p.haste) { p.haste = haste; p.el.style.setProperty('--haste', haste + 'px'); }
      // Quem está sob o ponteiro, no quarto, acende a placa dele também.
      p.el.classList.toggle('acesa', !!p.a.placa || sobre === p.a);
    }
  }

  // ── O ponteiro ────────────────────────────────────────────────────────────
  const raio = new THREE.Raycaster();
  const ponteiroNdc = new THREE.Vector2(9, 9);
  const parallax = new THREE.Vector2(0, 0), parallaxAlvo = new THREE.Vector2(0, 0);
  let sobre = null, dentro = false, apertou = null, ponteiroAndou = false;
  const ndc = (e) => {
    const r = palco.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  renderer.domElement.addEventListener('pointermove', (e) => {
    ponteiroNdc.copy(ndc(e));
    parallaxAlvo.copy(ponteiroNdc);
    ponteiroAndou = true;
    dentro = true;
  });
  renderer.domElement.addEventListener('pointerleave', () => { dentro = false; ponteiroNdc.set(9, 9); parallaxAlvo.set(0, 0); });
  renderer.domElement.addEventListener('pointerdown', (e) => {
    // No toque não há "passar por cima": o dedo marca e o clique decide.
    ponteiroNdc.copy(ndc(e));
    apertou = { x: e.clientX, y: e.clientY };
    sobre = acharAlvo();
  });
  /* No canto (a janelinha de fora do Dashboard), todo toque volta ao quarto,
     e o toque num móvel volta já aproximando dele. */
  const naMini = () => !!caixa.closest('.quarto-mini');
  renderer.domElement.addEventListener('click', (e) => {
    // Um arrasto não é um toque.
    if (apertou && Math.hypot(e.clientX - apertou.x, e.clientY - apertou.y) > 8) return;
    const a = acharAlvo();
    if (naMini()) {
      e.stopPropagation();
      ponte.voltar?.();
      if (a && !focoAtual) entrar(a.cena);
      return;
    }
    if (!focoAtual) { if (a) entrar(a.cena); return; }
    if (!a) { sair(); return; }
    if (a.nivel === 2) {
      // O card escolhido vira com outro toque; outro card, ou uma ficha, se escolhe.
      if (a === detalhe && a.id.startsWith('carta:')) virarCarta(a);
      else escolherDetalhe(a);
      return;
    }
    if (focoAtual === 'mural' && a.id === 'questoes') { if (prova) virarPagina(1); return; }
    if (a.nivel === 1) selecionar(a === selecionado ? null : a);
    else if (selecionado) selecionar(null);
  });
  /* De longe, quem responde é o objeto inteiro: tocar num livro aproxima a
     estante, e o livro se escolhe já de perto. */
  const CONTEINER = { estante: 'estante', mesa: 'revisao', mural: 'questoes', monitor: 'decks', calendario: 'planos', relogio: 'pomodoro' };
  function acharAlvo() {
    const a = acharAlvoCru();
    if (a && !focoAtual && a.nivel) return alvoPorId(CONTEINER[a.cena]) ?? a;
    return a;
  }
  function acharAlvoCru() {
    raio.setFromCamera(ponteiroNdc, camera);
    // Com zoom, só o que está em foco responde; o resto é cenário.
    const candidatos = focoAtual ? alvos.filter((a) => a.cena === focoAtual) : alvos;
    const achados = raio.intersectObjects(candidatos.map((a) => a.grupo), true);
    for (const h of achados) {
      if (h.object.isSprite) continue;
      let o = h.object;
      while (o && !o.userData.alvo) o = o.parent;
      if (o) return o.userData.alvo;
    }
    return null;
  }

  // ── Câmera e tamanho ──────────────────────────────────────────────────────
  function ajustar() {
    const l = palco.clientWidth, a = palco.clientHeight;
    if (!l || !a) return;
    renderer.setSize(l, a, false);
    caixa.classList.toggle('estreito', l < 720);
    const aspecto = l / a;
    // O quarto ocupa uns 15 por 13 na tela, com folga; cabe inteiro em qualquer formato.
    const meia = Math.max(6.85, 9 / aspecto);
    camera.left = -meia * aspecto; camera.right = meia * aspecto;
    camera.top = meia; camera.bottom = -meia;
    camera.updateProjectionMatrix();
    // O enquadramento do foco depende do tamanho: refeito na hora, sem voo.
    if (focoAtual) { quer = vistaDe(focoAtual); voo = null; atual.alvo.copy(quer.alvo); atual.zoom = quer.zoom; atual.dir.copy(quer.dir); }
  }
  /* A folha do celular faz o palco crescer numa transição: realocar o canvas a
     cada quadro dela travava o zoom. O tamanho é acertado quando ele para. */
  let esperaTamanho = 0;
  new ResizeObserver(() => { clearTimeout(esperaTamanho); esperaTamanho = setTimeout(ajustar, 90); }).observe(palco);
  ajustar();

  const direcaoCamera = new THREE.Vector3();

  // A rodinha: só de longe (com um objeto aproximado, o quarto é dele) e fora do canto.
  const eixoDireita = new THREE.Vector3(), eixoCima = new THREE.Vector3();
  renderer.domElement.addEventListener('wheel', (e) => {
    if (focoAtual || naMini() || voo) return;
    e.preventDefault();
    const z0 = vistaLivre.zoom;
    // A pinça do trackpad chega como rodinha com ctrl, em passos menores.
    const z1 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z0 * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
    if (z1 === z0) return;
    const r = palco.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
    // O ponto sob o ponteiro fica parado: o alvo da câmera anda o que o zoom moveria.
    const k = 1 / z0 - 1 / z1;
    eixoDireita.setFromMatrixColumn(camera.matrixWorld, 0);
    eixoCima.setFromMatrixColumn(camera.matrixWorld, 1);
    vistaLivre.alvo
      .addScaledVector(eixoDireita, nx * ((camera.right - camera.left) / 2) * k)
      .addScaledVector(eixoCima, ny * ((camera.top - camera.bottom) / 2) * k);
    // De longe o quarto volta para o meio; de perto, o passeio tem margem.
    const folga = Math.max(0, 1 - 1 / z1) * (camera.top - camera.bottom) * 0.6;
    const desvio = vistaLivre.alvo.clone().sub(ALVO);
    if (desvio.length() > folga) vistaLivre.alvo.copy(ALVO).addScaledVector(desvio.normalize(), folga);
    vistaLivre.zoom = z1;
    atual.alvo.copy(vistaLivre.alvo); atual.zoom = z1;
    quer = vistaDe(null);
    ponteiroAndou = true;
    sombraSuja = true;
  }, { passive: false });
  // Duplo clique no vazio devolve a vista inteira.
  renderer.domElement.addEventListener('dblclick', () => {
    if (focoAtual || naMini() || acharAlvo()) return;
    vistaLivre.alvo.copy(ALVO); vistaLivre.zoom = 1;
    voar(vistaDe(null));
  });
  function posicionarCamera() {
    if (voo) {
      /* O relógio do voo começa no primeiro quadro desenhado, e não no
         clique: o que o clique monta vira uma pausa antes do movimento, nunca
         um salto no meio dele. */
      if (!voo.t0) voo.t0 = performance.now();
      const p = Math.min(1, (performance.now() - voo.t0) / voo.dur), k = suave(p);
      atual.alvo.lerpVectors(voo.de.alvo, quer.alvo, k);
      // A câmera gira até ficar de frente, junto com a aproximação.
      atual.dir.lerpVectors(voo.de.dir, quer.dir, k).normalize();
      // O zoom anda em escala logarítmica: a aproximação parece constante.
      atual.zoom = Math.exp(Math.log(voo.de.zoom) + (Math.log(quer.zoom) - Math.log(voo.de.zoom)) * k);
      if (p >= 1) { voo = null; ponteiroAndou = true; }
    }
    if (camera.zoom !== atual.zoom) { camera.zoom = atual.zoom; camera.updateProjectionMatrix(); }
    // De perto, o balanço do ponteiro diminui, para o objeto não nadar.
    const giro = (parallax.x * 0.06) / atual.zoom, sobe = (parallax.y * 0.04) / atual.zoom;
    const d = direcaoCamera.copy(atual.dir).applyAxisAngle(CIMA, giro);
    d.y += sobe;
    camera.position.copy(atual.alvo).addScaledVector(d.normalize(), 40);
    camera.lookAt(atual.alvo);
  }

  /* O recado à mão: o texto vai para a área branca do lado de fora do quarto,
     na altura do objeto, e a seta faz uma barriga do recado até ele, como os
     rabiscos da LP. Com zoom o quarto passa das bordas, e o recado fica perto
     do objeto. Nunca sai pelas bordas do palco. */
  const notaDica = dica.querySelector('.quarto-dica-nota');
  const tituloDica = notaDica.querySelector('.quarto-dica-titulo'), textoSubDica = notaDica.querySelector('.quarto-dica-sub');
  let subDicaAtual = '';
  const setaDica = dica.querySelector('.seta'), pontaDica = dica.querySelector('.ponta');
  const quinaQuarto = new THREE.Vector3();
  function bordaDoQuarto(x, z) {
    quinaQuarto.set(x, 0, z);
    sala.localToWorld(quinaQuarto).project(camera);
    return (quinaQuarto.x * 0.5 + 0.5) * palco.clientWidth;
  }
  const tamanhoDica = { w: 0, h: 0 };
  function rabiscarDica(ax, ay, perto) {
    const W = palco.clientWidth, H = palco.clientHeight;
    const esq = ax < W / 2, lado = esq ? -1 : 1;
    const nw = tamanhoDica.w, nh = tamanhoDica.h;
    // (nx, ny) é o canto de baixo do recado do lado do objeto. As quinas da
    // esquerda e da direita do quarto marcam onde começa a área branca.
    const fora = esq ? bordaDoQuarto(-(L / 2 + ESP), L / 2) - 28 : bordaDoQuarto(L / 2, -(L / 2 + ESP)) + 28;
    let nx = perto ? ax + lado * Math.min(130, W * 0.12) : fora, ny = perto ? ay - 64 : ay - 24;
    nx = esq ? Math.max(nw + 12, nx) : Math.min(W - nw - 12, nx);
    ny = Math.min(H - 12, Math.max(nh + 12, ny));
    notaDica.classList.toggle('lado-esq', esq);
    notaDica.classList.toggle('lado-dir', !esq);
    notaDica.style.left = nx.toFixed(1) + 'px';
    notaDica.style.top = ny.toFixed(1) + 'px';
    // A seta sai de baixo do recado e para um pouco antes do objeto.
    const sx = perto ? nx + lado * 18 : nx - lado * 10, sy = perto ? ny + 8 : ny - nh * 0.35;
    let dx = ax - sx, dy = ay - sy;
    const dist = Math.hypot(dx, dy) || 1;
    const ex = ax - (dx / dist) * 8, ey = ay - (dy / dist) * 8;
    dx = ex - sx; dy = ey - sy;
    let px = dy / dist, py = -dx / dist;
    if (py > 0) { px = -px; py = -py; }
    const barriga = dist * 0.28;
    const c1x = sx + dx * 0.3 + px * barriga, c1y = sy + dy * 0.3 + py * barriga;
    const c2x = sx + dx * 0.75 + px * barriga * 0.7, c2y = sy + dy * 0.75 + py * barriga * 0.7;
    const ang = Math.atan2(ey - c2y, ex - c2x), pl = 11;
    const f = (n) => n.toFixed(1);
    setaDica.setAttribute('d', `M${f(sx)} ${f(sy)} C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(ex)} ${f(ey)}`);
    pontaDica.setAttribute('d',
      `M${f(ex - pl * Math.cos(ang - 0.5))} ${f(ey - pl * Math.sin(ang - 0.5))} L${f(ex)} ${f(ey)} ` +
      `L${f(ex - pl * Math.cos(ang + 0.5))} ${f(ey - pl * Math.sin(ang + 0.5))}`);
  }

  // ── O laço ────────────────────────────────────────────────────────────────
  const marcoZero = performance.now();
  let inicio = -1, ultimoSegundo = -1, antes = 0, ultimoHovDia = -1;
  const entradaDe = new Map(entradas.map((e) => [e.obj, e]));
  const molaSaida = (x) => { const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const ancoraMundo = new THREE.Vector3();

  function quadro() {
    const t = (performance.now() - marcoZero) / 1000;
    const dt = Math.min(0.05, Math.max(0.001, t - antes));
    antes = t;
    const quieto = calmo.matches;
    if (inicio < 0) inicio = t;
    if (!quieto) parallax.lerp(parallaxAlvo, Math.min(1, dt * 2.5));
    posicionarCamera();

    // O realce. Com zoom, o objeto em foco não brilha inteiro: brilha o que se
    // escolhe dentro dele (o livro, a pilha).
    /* O raio percorre a cena inteira: só vale lançá-lo quando o ponteiro andou,
       e nunca durante o voo, em que tudo passa por baixo dele. */
    if (dentro && ponteiroAndou && !voo) { ponteiroAndou = false; sobre = acharAlvo(); }
    if (!dentro && !('ontouchstart' in window)) sobre = null;
    const clicavel = sobre && (!focoAtual || sobre.item || selecionado);
    // O monitor acende a barra sob o ponteiro.
    const hovDia = focoAtual === 'monitor' && sobre?.id.startsWith('dia:') ? Number(sobre.id.slice(4)) : -1;
    if (hovDia !== ultimoHovDia) { ultimoHovDia = hovDia; telaMonitor.redesenhar(estado, diaEscolhido(), hovDia); }
    renderer.domElement.style.cursor = clicavel ? 'pointer' : '';
    for (const a of alvos) {
      const emFoco = focoAtual && a.cena === focoAtual;
      a.quer = a === selecionado || a === detalhe ? 1 : (a === sobre || (a.placa && !focoAtual)) && (!emFoco || a.item) ? 1 : 0;
      a.foco += (a.quer - a.foco) * Math.min(1, dt * (quieto ? 30 : 12));
      if (Math.abs(a.quer - a.foco) < 0.001) a.foco = a.quer;
      for (const m of a.materiais) m.emissive.copy(brilhoDe(m)).add(realce.copy(LIMA).multiplyScalar(a.foco * 0.18));
      a.animar?.(a, t);
    }

    // A abertura: cada peça cai no lugar, uma depois da outra. Vem depois do
    // realce, para valer enquanto corre; terminada, o realce manda sozinho.
    for (const e of entradas) {
      if (e.feito) continue;
      const p = quieto ? 1 : Math.min(1, Math.max(0, (t - inicio - e.atraso) / 0.7));
      const k = molaSaida(p);
      e.obj.position.y = e.y + (1 - k) * e.queda;
      e.obj.scale.setScalar(Math.max(0.001, Math.min(1.08, k)));
      if (p >= 1) { e.feito = true; e.obj.position.y = e.y; e.obj.scale.setScalar(1); }
    }
    livros.children.forEach((g) => {
      const en = g.userData.entrada;
      if (!en || en.feito) return;
      if (en.t < 0) en.t = t;
      const p = quieto ? 1 : Math.min(1, Math.max(0, (t - en.t - en.atraso) / 0.5));
      g.scale.y = Math.max(0.001, molaSaida(p));
      if (p >= 1) { en.feito = true; g.scale.y = 1; }
    });

    // O balão segue o objeto. Com zoom, só os itens de dentro têm balão: o
    // resto já está no painel.
    // No quarto inteiro a placa já diz o que o objeto é; o balão fica para os itens do zoom.
    const comBalao = sobre && focoAtual && sobre.item && sobre !== selecionado && sobre !== detalhe ? sobre : null;
    if (comBalao) {
      if (comBalao.ancora) ancoraMundo.copy(comBalao.ancora); else ancoraMundo.set(0, 0, 0);
      comBalao.grupo.localToWorld(ancoraMundo);
      ancoraMundo.project(camera);
      const novo = dica.dataset.id !== comBalao.id;
      const subDica = focoAtual ? (comBalao.dica ?? 'Toque para ver os detalhes') : comBalao.sub(estado);
      if (novo) {
        dica.dataset.id = comBalao.id;
        tituloDica.textContent = comBalao.titulo;
      }
      if (novo || subDica !== subDicaAtual) {
        subDicaAtual = subDica;
        textoSubDica.textContent = subDica;
        // A medida só é lida quando o texto muda, e não a cada quadro.
        tamanhoDica.w = notaDica.offsetWidth; tamanhoDica.h = notaDica.offsetHeight;
      }
      rabiscarDica((ancoraMundo.x * 0.5 + 0.5) * palco.clientWidth, (-ancoraMundo.y * 0.5 + 0.5) * palco.clientHeight, !!focoAtual);
      // Outro objeto: a seta se desenha de novo, do recado até ele.
      if (novo && dica.classList.contains('visivel')) { dica.classList.remove('visivel'); void dica.offsetWidth; }
      dica.classList.add('visivel');
    } else {
      dica.classList.remove('visivel');
      delete dica.dataset.id;
    }

    // O relógio anda com a hora de verdade, e o anel do Pomodoro acompanha.
    const agora = new Date();
    const seg = agora.getSeconds() + agora.getMilliseconds() / 1000;
    const min = agora.getMinutes() + seg / 60, hora = (agora.getHours() % 12) + min / 60;
    pSeg.rotation.y = -(seg / 60) * Math.PI * 2;
    pMin.rotation.y = -(min / 60) * Math.PI * 2;
    pHora.rotation.y = -(hora / 12) * Math.PI * 2;
    if (Math.floor(t) !== ultimoSegundo) {
      ultimoSegundo = Math.floor(t);
      estado.foco = ponte.foco();
      sombraSuja = true;   // os ponteiros do relógio andaram
      const f = estado.foco;
      const fr = f.rodando ? Math.max(0.01, f.resta / f.total) : -1;
      if (Math.abs(fr - fracaoAnel) > 0.004) {
        fracaoAnel = fr;
        anel.visible = fr > 0;
        if (fr > 0) { anel.geometry.dispose(); anel.geometry = new THREE.TorusGeometry(0.7, 0.04, 12, 80, Math.PI * 2 * fr); }
      }
      vivo?.();
      pintarPlacas();
      aplicarTempo();
    }
    if (anel.visible) anel.material.emissiveIntensity = 0.5 + Math.sin(t * 3) * 0.25;

    // A página da prova virando.
    animarVirada(t);

    // Os itens do zoom surgem com mola, pelo relógio.
    const agoraS = segundos();
    for (const o of surgindo) {
      const p = quieto ? 1 : (agoraS - o.userData.surge.t0) / 0.42;
      o.scale.setScalar(p <= 0 ? 0.001 : p >= 1 ? 1 : Math.max(0.001, molaSaida(p)));
      if (p >= 1) surgindo.delete(o);
    }
    // O card do leque vira para mostrar o verso.
    for (const g of leque.children) {
      const giro = g.userData.giro, alvoGiro = Math.PI * (g.userData.virado || 0);
      if (giro) giro.rotation.y += (alvoGiro - giro.rotation.y) * (quieto ? 1 : Math.min(1, dt * 9));
    }

    const lequeAberto = focoAtual === 'mesa' && leque.children.length > 0;

    // O que atrapalha a vista de frente encolhe até sumir, e volta na saída.
    // Pelo relógio, e não por quadro: termina no mesmo tempo em qualquer máquina.
    for (const [obj, st] of sumindo) {
      // Com o leque aberto, a caixa e as pilhas saem: o deck está todo na mesa.
      const para = (focoAtual && ATRAPALHA[focoAtual]?.includes(obj)) || (lequeAberto && (obj === caixaCards || obj === pilhas)) ? 0 : 1;
      if (para !== st.para) { st.de = st.s; st.para = para; st.t0 = t; }
      const p = quieto ? 1 : Math.min(1, (t - st.t0) / 0.45);
      st.s = st.de + (st.para - st.de) * suave(p);
      if (entradaDe.get(obj)?.feito ?? true) {
        obj.scale.setScalar(Math.max(0.001, st.s));
        obj.visible = st.s > 0.01;
      }
    }

    /* Mexeu: a abertura, um item surgindo ou sumindo, um realce em andamento,
       um card virando. As folhas balançando não contam: a diferença na sombra
       não se vê. */
    if (!sombraSuja) {
      sombraSuja = surgindo.size > 0 || entradas.some((e) => !e.feito) || livros.children.some((g) => g.userData.entrada && !g.userData.entrada.feito);
      if (!sombraSuja) for (const a of alvos) if (a.foco !== a.quer) { sombraSuja = true; break; }
      if (!sombraSuja) for (const [, st] of sumindo) if (st.s !== st.para) { sombraSuja = true; break; }
      if (!sombraSuja) for (const g of leque.children) if (g.userData.giro && Math.abs(Math.PI * (g.userData.virado || 0) - g.userData.giro.rotation.y) > 0.001) { sombraSuja = true; break; }
    }
    if (sombraSuja) { renderer.shadowMap.needsUpdate = true; sombraSuja = false; }

    // A vida miúda: as folhas balançam e a poeira flutua.
    if (!quieto) {
      plantas.forEach((p, i) => { p.userData.folhas.rotation.z = Math.sin(t * 0.9 + i) * 0.03; });
      piscaMats.forEach((m, i) => { m.emissiveIntensity = piscaBase * (0.75 + 0.25 * Math.sin(t * 1.3 + i * Math.PI)); });
      poeira.rotation.y = Math.sin(t * 0.05) * 0.02;
      poeira.position.y = Math.sin(t * 0.3) * 0.08;
    }
    // As placas seguem os objetos (a matriz da câmera é acertada antes, para não ficarem um quadro atrás).
    if (!focoAtual || voo) { camera.updateMatrixWorld(); posicionarPlacas(); }
    renderer.render(cena, camera);
  }

  /* O quarto só desenha quando está à vista: com o Dashboard escondido, ou a
     aba em segundo plano, a placa de vídeo descansa. */
  let visivel = false;
  const ligar = () => renderer.setAnimationLoop(visivel && document.visibilityState === 'visible' ? quadro : null);
  new IntersectionObserver((r) => { visivel = r[0].isIntersecting; ligar(); }).observe(palco);
  document.addEventListener('visibilitychange', ligar);

  aplicarDados();
  /* Uma amostra de cada material que só aparece com zoom (a placa com textura,
     opaca e transparente), compilada agora, junto com a cena. */
  const amostras = new THREE.Group();
  // Nos tamanhos de verdade (página, ficha, card), que não são potência de 2.
  amostras.add(
    placaComTexto(300, 404, 0.1, 0.1, () => {}),
    placaComTexto(320, 216, 0.1, 0.1, () => {}, { sombra: true }),
    placaComTexto(400, 64, 0.1, 0.1, () => {}, { transparente: true }),
    placaComTexto(256, 256, 0.1, 0.1, () => {}, { transparente: true, sombra: true }),
  );
  sala.add(amostras);
  ajustar();
  posicionarCamera();
  renderer.compile(cena, camera);
  // Um quadro desenhado de verdade prepara também os estados de desenho da GPU.
  amostras.position.copy(ALVO);
  renderer.shadowMap.needsUpdate = true;
  renderer.render(cena, camera);
  /* Sai da cena, mas os materiais ficam vivos: descartá-los liberaria o shader
     que acabou de ser compilado, e ele voltaria a compilar no meio do zoom. */
  sala.remove(amostras);
  caixa.classList.add('pronto');

  /* O primeiro campo de texto da página custa caro ao navegador (edição,
     corretor, fontes): pago no zoom, era um soluço de mais de 100 ms. Um
     painel invisível com campos é desenhado por dois quadros e sai, logo
     depois que o quarto aparece. */
  const aquecer = () => {
    const falso = el('div', 'quarto-painel aberto aquecendo');
    falso.setAttribute('aria-hidden', 'true');
    falso.inert = true;
    const form = el('div', 'qp-form');
    const r = el('input'); r.type = 'radio';
    form.append(campo('Nome', entrada('Sinapse')), campo('Texto', entrada('Sinapse', { multi: true })), r);
    falso.append(el('h3', 'qp-titulo', 'Sinapse'), form, botao('Salvar', 'primario', () => {}));
    palco.appendChild(falso);
    requestAnimationFrame(() => requestAnimationFrame(() => falso.remove()));
  };
  ('requestIdleCallback' in window ? requestIdleCallback : setTimeout)(aquecer, { timeout: 1500 });
}
