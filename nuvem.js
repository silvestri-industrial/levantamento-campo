// Nuvem (Firebase): login + sincronização em segundo plano. O IndexedDB continua sendo a base local (funciona sem internet).
// Fotos vão pequenas para a nuvem (~800px); vídeos ficam só no aparelho.
window.NUVEM = (() => {
  const CFG = {
    apiKey: 'AIzaSyAbRVG875x717EA2tQj4mVSoJo-4BxfTuU', authDomain: 'levantamento-campo-silvestri.firebaseapp.com',
    projectId: 'levantamento-campo-silvestri', storageBucket: 'levantamento-campo-silvestri.firebasestorage.app',
    messagingSenderId: '162727682923', appId: '1:162727682923:web:b1af4d2d70e0f604bda22e'
  };
  const COLS = ['orcamentos', 'atividades', 'fotos'];
  const MARGEM = 10 * 60 * 1000;           // relê os últimos 10 min (relógios diferentes entre aparelhos)
  const ls = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } }
  };
  let su = ls.get('nuvem_su', {});          // "store:id" -> upd já enviado
  let dels = ls.get('nuvem_del', {});       // "store:id" -> {upd, ...} exclusões ainda não enviadas
  let desde = ls.get('nuvem_desde', 0);
  let auth, fs, user = null, unsubs = [], rodando = false, denovo = false, timer = null, iniciado = false, erro = '';
  let mudou = false, aguardaRender = null;

  const salvaSu = () => { clearTimeout(salvaSu.t); salvaSu.t = setTimeout(() => { ls.set('nuvem_su', su); ls.set('nuvem_del', dels); }, 300); };
  const key = (s, id) => s + ':' + id;
  const limpo = o => JSON.parse(JSON.stringify(o, (k, v) => (k === 'blob' ? undefined : v)));

  /* ---------- foto pequena para a nuvem ---------- */
  async function miniFoto(f) {
    let im = await carregaImg(f.data), res = [[800, 0.6], [640, 0.5], [480, 0.45]], url;
    for (const [max, q] of res) {
      const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      url = c.toDataURL('image/jpeg', q); if (url.length < 900000) break;
    }
    return { id: f.id, atividadeId: f.atividadeId, t: f.t, tipo: 'foto', data: url, upd: f.upd || 1 };
  }

  /* ---------- envio (local -> nuvem) ---------- */
  function pendentes() {
    const lista = [];
    const todasAtv = [...new Map([...todas, ...atividades].map(a => [a.id, a])).values()];
    for (const o of orcamentos) if ((o.upd || 1) > (su[key('orcamentos', o.id)] || 0) && !dels[key('orcamentos', o.id)]) lista.push(['orcamentos', o]);
    for (const a of todasAtv) if ((a.upd || 1) > (su[key('atividades', a.id)] || 0) && !dels[key('atividades', a.id)]) lista.push(['atividades', a]);
    for (const f of Object.values(fotos).flat()) if (f.tipo !== 'video' && f.data && (f.upd || 1) > (su[key('fotos', f.id)] || 0) && !dels[key('fotos', f.id)]) lista.push(['fotos', f]);
    for (const k in dels) lista.push(['del', k]);
    return lista;
  }
  async function enviarUm([tipo, x]) {
    if (tipo === 'del') {
      const [store, ...r] = x.split(':'), id = r.join(':');
      await fs.collection(store).doc(id).set({ ...dels[x], id, del: true });
      su[x] = dels[x].upd; delete dels[x]; return;
    }
    const k = key(tipo, x.id), upd = x.upd || 1;
    const dado = tipo === 'fotos' ? await miniFoto(x) : { ...limpo(x), upd };
    await fs.collection(tipo).doc(x.id).set(dado);
    su[k] = Math.max(su[k] || 0, upd);
  }
  async function drenar() {
    if (!user || !fs) return;
    if (rodando) { denovo = true; return; }
    rodando = true; erro = '';
    try {
      do {
        denovo = false;
        const fila = pendentes();
        for (let i = 0; i < fila.length; i += 3) {
          await Promise.all(fila.slice(i, i + 3).map(it => enviarUm(it).catch(e => { erro = e.message || String(e); console.warn('nuvem:', e); })));
          salvaSu(); atualizaRotulo();
        }
      } while (denovo);
    } finally { rodando = false; salvaSu(); atualizaRotulo(); }
  }
  function agendar() { clearTimeout(timer); timer = setTimeout(drenar, 1500); atualizaRotulo(); }

  /* ---------- recebimento (nuvem -> local) ---------- */
  const achaAtv = id => atividades.find(a => a.id === id) || todas.find(a => a.id === id);
  const semDel = r => { const c = { ...r }; delete c.del; return c; };
  async function aplicarOrc(r) {
    const k = key('orcamentos', r.id); if (dels[k]) return;
    const l = orcamentos.find(o => o.id === r.id);
    if (r.del) {
      if (!l) return;
      orcamentos = orcamentos.filter(o => o.id !== r.id); await DB.raw.apagarOrcamento(r.id);
      if (orcAtual === r.id) { orcAtual = null; atividades = []; }
      su[k] = r.upd; return true;
    }
    if (!l) { const n = semDel(r); orcamentos.push(n); await DB.raw.salvarOrcamento(n); su[k] = r.upd; return true; }
    if (r.upd > (l.upd || 0)) { Object.assign(l, semDel(r)); await DB.raw.salvarOrcamento(l); su[k] = r.upd; return true; }
  }
  async function aplicarAtv(r) {
    const k = key('atividades', r.id); if (dels[k]) return;
    const l = achaAtv(r.id);
    if (r.del) {
      if (!l) return;
      atividades = atividades.filter(a => a.id !== r.id); todas = todas.filter(a => a.id !== r.id);
      for (const f of fotosDe(r.id)) await DB.raw.apagarFoto(f.id);
      delete fotos[r.id]; await DB.raw.apagarAtividade(r.id); su[k] = r.upd; return true;
    }
    if (!l) {
      const n = semDel(r);
      if (orcAtual === n.orcId) { atividades.push(n); atividades.sort((a, b) => a.ordem - b.ordem); } else todas.push(n);
      await DB.raw.salvarAtividade(n); su[k] = r.upd; return true;
    }
    if (r.upd > (l.upd || 0)) {
      Object.assign(l, semDel(r)); await DB.raw.salvarAtividade(l); su[k] = r.upd;
      if (orcAtual === l.orcId) atividades.sort((a, b) => a.ordem - b.ordem);
      return true;
    }
  }
  async function aplicarFoto(r) {
    const k = key('fotos', r.id); if (dels[k]) return;
    const ex = Object.values(fotos).flat().find(f => f.id === r.id);
    if (r.del) {
      if (!ex) return;
      fotos[ex.atividadeId] = fotosDe(ex.atividadeId).filter(f => f.id !== r.id); await DB.raw.apagarFoto(r.id); su[k] = r.upd; return true;
    }
    if (ex) { su[k] = Math.max(su[k] || 0, r.upd); return; }   // fotos não mudam; a local (maior) fica
    const n = semDel(r); (fotos[n.atividadeId] ||= []).push(n); fotos[n.atividadeId].sort((a, b) => a.t - b.t);
    await DB.raw.salvarFoto(n); su[k] = r.upd; return true;
  }
  const APLICA = { orcamentos: aplicarOrc, atividades: aplicarAtv, fotos: aplicarFoto };
  let cadeia = Promise.resolve();
  function receber(col, snap) {
    const itens = snap.docChanges().filter(c => c.type !== 'removed').map(c => c.doc.data());
    cadeia = cadeia.then(async () => {
      let alterou = false;
      for (const r of itens) {
        try { if (await APLICA[col](r)) alterou = true; } catch (e) { console.warn('nuvem: erro ao aplicar', col, e); }
        if (r.upd > desde + MARGEM) { desde = r.upd - MARGEM; }
      }
      ls.set('nuvem_desde', desde); salvaSu();
      if (alterou) { mudou = true; redesenhar(); }
      agendar();
    });
  }
  // só redesenha a tela se o usuário não estiver digitando nem com uma janela aberta
  function redesenhar() {
    clearTimeout(aguardaRender);
    const ocupado = ['INPUT', 'TEXTAREA'].includes(document.activeElement && document.activeElement.tagName)
      || !$('#overlay').classList.contains('hidden') || document.body.classList.contains('relatorio');
    if (ocupado) { aguardaRender = setTimeout(redesenhar, 2500); return; }
    if (!mudou) return; mudou = false;
    const y = view.scrollTop; sync();
    if (orcAtual && !orcAberto()) orcAtual = null;
    if (tela === 'tarefa' && !atividades.length) tela = 'home';
    render(); view.scrollTop = y;
  }
  function ouvir() {
    pararDeOuvir();
    for (const col of COLS) {
      unsubs.push(fs.collection(col).where('upd', '>', Math.max(0, desde)).onSnapshot(
        snap => receber(col, snap),
        e => { erro = e.message || String(e); console.warn('nuvem: escuta', col, e); atualizaRotulo(); }));
    }
  }
  const pararDeOuvir = () => { unsubs.forEach(u => u()); unsubs = []; };

  /* ---------- login ---------- */
  const MSG = {
    'auth/invalid-credential': 'E-mail ou senha incorretos.', 'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.', 'auth/invalid-email': 'E-mail inválido.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.', 'auth/network-request-failed': 'Sem internet. Tente novamente.',
    'auth/user-disabled': 'Esta conta foi desativada.'
  };
  function telaLogin() {
    overlay(`<div class="form"><h2 style="color:#fff">Entrar na nuvem</h2>
      <p style="color:#D9D9D9;margin:6px 0">Entre para sincronizar os orçamentos e fotos entre os aparelhos. Sem entrar, o aplicativo continua funcionando só neste aparelho.</p>
      <label style="color:#cfd6de">E-mail</label><input type="email" id="nvEmail" autocomplete="username" autocapitalize="off" value="${esc(localStorage.getItem('nuvem_email') || '')}">
      <label style="color:#cfd6de">Senha</label><input type="password" id="nvSenha" autocomplete="current-password">
      <p id="nvErro" style="color:#ff9b9b;min-height:20px;margin-top:6px"></p>
      <div class="row"><button class="sec" id="nvAgora">Agora não</button><button id="nvEntrar" style="background:var(--verde)">Entrar</button></div></div>`);
    $('#nvAgora').onclick = () => { sessionStorage.setItem('nuvem_pulou', '1'); fechar(); };
    const entrar = async () => {
      const e = $('#nvEmail').value.trim(), s = $('#nvSenha').value;
      if (!e || !s) { $('#nvErro').textContent = 'Informe e-mail e senha.'; return; }
      $('#nvEntrar').disabled = true; $('#nvErro').textContent = 'Entrando…';
      try { await auth.signInWithEmailAndPassword(e, s); localStorage.setItem('nuvem_email', e); fechar(); toast('Conectado à nuvem'); }
      catch (err) { $('#nvEntrar').disabled = false; $('#nvErro').textContent = MSG[err.code] || ('Erro: ' + (err.message || err.code)); }
    };
    $('#nvEntrar').onclick = entrar;
    $('#nvSenha').onkeydown = e => { if (e.key === 'Enter') entrar(); };
  }

  /* ---------- menu / estado ---------- */
  function textoStatus() {
    if (!auth) return 'Nuvem indisponível (atualize o app)';
    if (!user) return 'Nuvem: desconectado';
    const p = pendentes().length;
    if (erro) return 'Nuvem: erro — ' + erro.slice(0, 60);
    if (!navigator.onLine) return `Nuvem: sem internet${p ? ` (${p} a enviar)` : ''}`;
    return p ? `Nuvem: enviando ${p}…` : 'Nuvem: sincronizado ✓';
  }
  // estado de sincronização de UM orçamento (orçamento + atividades + fotos)
  function estadoOrc(id) {
    if (!auth || !user) return 'local';
    const ativ = [...new Map([...todas, ...atividades].filter(a => a.orcId === id).map(a => [a.id, a])).values()];
    const falta = (s, x) => !dels[key(s, x.id)] && (x.upd || 1) > (su[key(s, x.id)] || 0);
    const o = orcamentos.find(x => x.id === id);
    let p = (o && falta('orcamentos', o)) || ativ.some(a => falta('atividades', a));
    if (!p) p = ativ.some(a => fotosDe(a.id).some(f => f.tipo !== 'video' && f.data && falta('fotos', f)));
    if (!p) p = ativ.some(a => Object.keys(dels).some(k => dels[k].atividadeId === a.id));
    return !p ? 'ok' : navigator.onLine ? 'env' : 'off';
  }
  const SELO = { ok: ['☁ Sincronizado ✓', 'ok'], env: ['☁ Enviando…', 'env'], off: ['☁ Sem internet — aguardando', 'off'], local: ['Só neste aparelho', 'local'] };
  const selo = id => { const [t, c] = SELO[estadoOrc(id)]; return `<span class="nv-selo ${c}" data-nv="${id}">${t}</span>`; };
  function atualizaSelos() {
    document.querySelectorAll('.nv-selo').forEach(el => { const [t, c] = SELO[estadoOrc(el.dataset.nv)]; el.textContent = t; el.className = 'nv-selo ' + c; });
  }
  function atualizaRotulo() {
    atualizaSelos();
    const b = document.querySelector('[data-act="nuvem"]'); if (!b) return;
    b.textContent = !auth ? '☁ Nuvem indisponível' : user ? `☁ ${textoStatus().replace('Nuvem: ', '')} · Sair` : '☁ Entrar na nuvem';
    const bt = $('#btnMenu'); if (bt) bt.classList.toggle('nuvem-ok', !!user && !erro && navigator.onLine);
  }
  function menu() {
    if (!auth) return toast('A nuvem não carregou. Conecte-se à internet e atualize o app.');
    if (!user) return telaLogin();
    confirmar('Sair da conta da nuvem? Os dados continuam neste aparelho.').then(async ok => { if (ok) { await auth.signOut(); toast('Desconectado'); } });
  }

  /* ---------- início ---------- */
  function iniciar() {
    if (iniciado) return; iniciado = true;
    DB.aoSalvar = (store, o) => {
      if (store === 'fotos' && o.tipo === 'video') return;
      delete dels[key(store, o.id)]; agendar();
    };
    DB.aoApagar = (store, id) => {
      if (store === 'fotos') { const f = Object.values(fotos).flat().find(x => x.id === id); if (f && f.tipo === 'video') return; }
      let extra = {};
      if (store === 'fotos') { const f = Object.values(fotos).flat().find(x => x.id === id); if (f) extra = { atividadeId: f.atividadeId }; }
      dels[key(store, id)] = { upd: Date.now(), ...extra }; salvaSu(); agendar();
    };
    window.addEventListener('online', () => { atualizaRotulo(); drenar(); });
    window.addEventListener('offline', atualizaRotulo);
    setInterval(() => { if (user) drenar(); atualizaRotulo(); }, 60000);
    if (!window.firebase) { atualizaRotulo(); return; }
    try {
      firebase.initializeApp(CFG); auth = firebase.auth(); fs = firebase.firestore();
    } catch (e) { console.warn('nuvem: falha ao iniciar', e); auth = null; atualizaRotulo(); return; }
    auth.onAuthStateChanged(u => {
      user = u; erro = '';
      if (u) { ouvir(); agendar(); }
      else { pararDeOuvir(); if (!sessionStorage.getItem('nuvem_pulou') && $('#overlay').classList.contains('hidden')) telaLogin(); }
      atualizaRotulo();
    });
    atualizaRotulo();
  }
  // "Apagar tudo" deste aparelho: a nuvem não é apagada; na próxima entrada tudo é baixado de novo
  function zerar() { su = {}; dels = {}; desde = 0; ls.set('nuvem_su', su); ls.set('nuvem_del', dels); ls.set('nuvem_desde', 0); if (user) ouvir(); }
  return { iniciar, menu, zerar, atualizaRotulo, selo };
})();
