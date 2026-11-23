const MAX_FOTOS = 100;
const SWIPE_DIREITA_AVANCA = true; // deslizar para a direita vai para a próxima tarefa

let orcamentos = [];          // {id, cliente, descricao, numero}
let todas = [];               // todas as atividades de todos os orçamentos (para contagens)
let atividades = [];          // atividades do orçamento aberto (ordenadas)
let fotos = {};               // atividadeId -> [{id, atividadeId, data, t}]
let tela = 'clientes';        // 'clientes' | 'orcamentos' | 'home' | 'tarefa' | 'editar'
let clienteAtual = '';
let orcAtual = null;          // id do orçamento aberto
let idx = 0;
let fotoPendente = null;
let selecionadas = new Set();

const $ = s => document.querySelector(s);
const view = $('#view');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ---------- dados ---------- */
async function carregar() {
  await DB.open();
  orcamentos = await DB.todosOrcamentos();
  todas = await DB.todasAtividades();
  // migração: atividades antigas sem orçamento
  const orfas = todas.filter(a => !a.orcId);
  if (orfas.length) {
    const o = await criarOrcamento('Sem cliente', 'Atividades anteriores');
    for (const a of orfas) { a.orcId = o.id; await DB.salvarAtividade(a); }
  }
  fotos = {};
  for (const f of await DB.todasFotos()) (fotos[f.atividadeId] ||= []).push(f);
  for (const k in fotos) fotos[k].sort((a, b) => a.t - b.t);
}
const fotosDe = id => fotos[id] || [];
const proximoNumero = () => orcamentos.reduce((m, o) => Math.max(m, +o.numero || 0), 0) + 1;
const orcAberto = () => orcamentos.find(o => o.id === orcAtual);
function sync() { if (orcAtual) todas = todas.filter(a => a.orcId !== orcAtual).concat(atividades); }

async function criarOrcamento(cliente, descricao, numero) {
  const o = { id: uid(), cliente: cliente.trim() || 'Sem cliente', descricao: descricao.trim(), numero: numero || proximoNumero() };
  orcamentos.push(o); await DB.salvarOrcamento(o); return o;
}
function abrirOrc(id) {
  sync(); orcAtual = id;
  const o = orcAberto(); clienteAtual = o.cliente;
  atividades = todas.filter(a => a.orcId === id).sort((a, b) => a.ordem - b.ordem);
  selecionadas = new Set();
}
async function excluirOrcamento(id) {
  sync();
  for (const a of todas.filter(a => a.orcId === id)) {
    for (const f of fotosDe(a.id)) await DB.apagarFoto(f.id);
    delete fotos[a.id]; await DB.apagarAtividade(a.id);
  }
  todas = todas.filter(a => a.orcId !== id);
  await DB.apagarOrcamento(id);
  orcamentos = orcamentos.filter(o => o.id !== id);
  if (orcAtual === id) { orcAtual = null; atividades = []; }
}

async function reordenar() {
  for (let i = 0; i < atividades.length; i++) {
    if (atividades[i].ordem !== i) { atividades[i].ordem = i; await DB.salvarAtividade(atividades[i]); }
  }
}
async function novaAtividade(titulo = '', local = '', obs = '') {
  const a = { id: uid(), orcId: orcAtual, ordem: atividades.length, titulo, local, obs, concluida: false };
  atividades.push(a); await DB.salvarAtividade(a); return a;
}
async function excluirAtividade(id) {
  for (const f of fotosDe(id)) await DB.apagarFoto(f.id);
  delete fotos[id];
  await DB.apagarAtividade(id);
  atividades = atividades.filter(a => a.id !== id);
  await reordenar();
}
const incompleta = a => !a.titulo.trim() || fotosDe(a.id).length === 0;

/* ---------- navegação ---------- */
function ir(t, i) {
  if (t === 'clientes' || t === 'orcamentos') sync();
  if (i !== undefined) idx = Math.max(0, Math.min(atividades.length - 1, i));
  tela = t; render();
}
$('#btnHome').onclick = () => { $('#menu').classList.add('hidden'); ir('clientes'); };
$('#btnMenu').onclick = e => { e.stopPropagation(); $('#menu').classList.toggle('hidden'); };
document.addEventListener('click', () => $('#menu').classList.add('hidden'));
$('#menu').onclick = async e => {
  const act = e.target.dataset.act; if (!act) return;
  if (act === 'editar') { if (!orcAtual) return toast('Abra um orçamento primeiro'); ir('editar'); }
  if (act === 'exportar') exportar();
  if (act === 'importar') $('#fileImport').click();
  if (act === 'apagar' && await confirmar('Apagar TODOS os clientes, orçamentos, atividades e fotos deste aparelho?')) {
    await DB.limpar(); orcamentos = []; todas = []; atividades = []; fotos = {}; orcAtual = null; ir('clientes');
  }
};

function render() {
  const o = orcAberto();
  $('#topTitle').textContent = tela === 'clientes' ? 'Clientes'
    : tela === 'orcamentos' ? clienteAtual
    : tela === 'editar' ? 'Editar lista'
    : o ? `${o.cliente} · Orç. ${o.numero}` : 'Levantamento';
  ({ clientes: renderClientes, orcamentos: renderOrcamentos, home: renderHome, tarefa: renderTarefa, editar: renderEditar })[tela]();
  view.scrollTop = 0;
}

/* ---------- CLIENTES ---------- */
function renderClientes() {
  sync();
  const nomes = [...new Set(orcamentos.map(o => o.cliente))].sort((a, b) => a.localeCompare(b));
  view.innerHTML = `
    <h2>Clientes</h2>
    <div class="resumo">${nomes.length} cliente(s) · ${orcamentos.length} orçamento(s)</div>
    <div class="grade">${nomes.map(n => {
      const os = orcamentos.filter(o => o.cliente === n);
      const qt = todas.filter(a => os.some(o => o.id === a.orcId)).length;
      return `<div class="cli" data-c="${esc(n)}"><b>${esc(n)}</b><small>${os.length} orçamento(s)<br>${qt} atividade(s)</small></div>`;
    }).join('')}</div>
    ${nomes.length ? '' : '<p class="ajuda">Nenhum cliente ainda. Toque em “+ Criar orçamento”.</p>'}
    <button class="add" id="btnNovoOrc">+ Criar orçamento</button>`;
  view.querySelectorAll('.cli').forEach(el => el.onclick = () => { clienteAtual = el.dataset.c; ir('orcamentos'); });
  $('#btnNovoOrc').onclick = () => formOrcamento();
}

/* ---------- ORÇAMENTOS DO CLIENTE ---------- */
function renderOrcamentos() {
  const os = orcamentos.filter(o => o.cliente === clienteAtual).sort((a, b) => a.numero - b.numero);
  if (!os.length) return ir('clientes');
  view.innerHTML = `
    <button class="sec" id="voltaCli">‹ Clientes</button>
    <h2 style="margin-top:10px">${esc(clienteAtual)}</h2>
    <div class="resumo">${os.length} orçamento(s)</div>
    ${os.map(o => {
      const as = todas.filter(a => a.orcId === o.id);
      return `<div class="item orc" data-id="${o.id}">
        <div class="t"><span class="orc-tag">ORÇAMENTO Nº ${o.numero}</span>${esc(o.descricao) || '<i>(sem descrição)</i>'}<small>${as.filter(a => a.concluida).length}/${as.length} atividades concluídas</small></div>
        <button class="sec mini" data-ed="${o.id}">✎</button><button class="sec mini" data-del="${o.id}">🗑</button>
      </div>`;
    }).join('')}
    <button class="add" id="btnNovoOrc">+ Criar orçamento para ${esc(clienteAtual)}</button>`;
  $('#voltaCli').onclick = () => ir('clientes');
  view.querySelectorAll('.orc').forEach(el => el.onclick = () => { abrirOrc(el.dataset.id); ir('home'); });
  view.querySelectorAll('[data-ed]').forEach(b => b.onclick = e => { e.stopPropagation(); formOrcamento(orcamentos.find(o => o.id === b.dataset.ed)); });
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    if (!await confirmar('Excluir este orçamento com TODAS as atividades e fotos?')) return;
    try { await excluirOrcamento(b.dataset.del); toast('Orçamento excluído'); } catch (err) { toast('Erro ao excluir: ' + err.message); }
    ir('orcamentos');
  });
  $('#btnNovoOrc').onclick = () => formOrcamento();
}

function formOrcamento(o) {
  const clientes = [...new Set(orcamentos.map(x => x.cliente))];
  const ov = overlay(`<div class="form">
    <h2 style="color:#fff">${o ? 'Editar orçamento' : 'Novo orçamento'}</h2>
    <label style="color:#cfd6de">Cliente</label>
    <input type="text" id="oCli" list="dlCli" value="${esc(o ? o.cliente : (tela === 'orcamentos' ? clienteAtual : ''))}" placeholder="Ex.: Suzano, Klabin…">
    <datalist id="dlCli">${clientes.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <label style="color:#cfd6de">Descrição do orçamento</label>
    <input type="text" id="oDesc" value="${esc(o ? o.descricao : '')}" placeholder="Descrição resumida">
    <p style="color:#fff;margin-top:12px">Orçamento nº <b>${o ? o.numero : proximoNumero()}</b> <small>(automático)</small></p>
    <div class="row"><button class="sec" id="oCancela">Cancelar</button><button id="oSalva" style="background:var(--verde)">Salvar</button></div></div>`);
  ov.onclick = null;
  $('#oCancela').onclick = fechar;
  $('#oSalva').onclick = async () => {
    const cli = $('#oCli').value.trim(), desc = $('#oDesc').value;
    if (!cli) return toast('Informe o cliente');
    fechar(); // fecha a caixa primeiro; erros aparecem como aviso
    try {
      if (o) { o.cliente = cli; o.descricao = desc.trim(); await DB.salvarOrcamento(o); clienteAtual = cli; return ir('orcamentos'); }
      const n = await criarOrcamento(cli, desc); abrirOrc(n.id); ir('home'); toast('Orçamento criado — adicione as atividades');
    } catch (err) { toast('Erro ao salvar: ' + err.message); }
  };
}

/* ---------- ATIVIDADES (HOME do orçamento) ---------- */
function renderHome() {
  if (!orcAberto()) return ir('clientes');
  const o = orcAberto();
  const feitas = atividades.filter(a => a.concluida).length;
  const pend = atividades.filter(incompleta).length;
  view.innerHTML = `
    <button class="sec" id="voltaOrc">‹ ${esc(o.cliente)}</button>
    <h2 style="margin-top:10px">Atividades</h2>
    <div class="resumo"><b>Orç. nº ${o.numero}</b> — ${esc(o.descricao)}<br>${feitas} de ${atividades.length} concluídas · ${pend} com pendência (❌ sem foto/descrição)</div>
    ${atividades.map((a, i) => `
      <div class="item ${incompleta(a) ? 'alerta' : a.concluida ? 'ok' : ''}" data-i="${i}">
        <div class="n">Item ${i + 1}</div>
        <div class="t">${esc(a.titulo) || '<i>(sem descrição)</i>'}<small>${esc(a.local) || '(sem local)'} · 📷 ${fotosDe(a.id).length}</small></div>
        <div class="st">${a.concluida ? '✅' : ''}${incompleta(a) ? '❌' : ''}</div>
      </div>`).join('') || '<p class="ajuda">Nenhuma atividade ainda. Use “+ Adicionar serviço” ou ⋮ → Editar lista para colar do Excel.</p>'}
    <button class="add" id="btnAdd">+ Adicionar serviço</button>
    <button class="sec" style="width:100%;margin-top:8px" id="btnEd">📝 Editar lista (colar do Excel)</button>`;
  $('#voltaOrc').onclick = () => { clienteAtual = o.cliente; ir('orcamentos'); };
  view.querySelectorAll('.item').forEach(el => el.onclick = () => ir('tarefa', +el.dataset.i));
  $('#btnAdd').onclick = async () => { await novaAtividade(); ir('tarefa', atividades.length - 1); };
  $('#btnEd').onclick = () => ir('editar');
}

/* ---------- TAREFA ---------- */
function renderTarefa() {
  if (!atividades.length) return ir('home');
  const a = atividades[idx], fs = fotosDe(a.id);
  view.innerHTML = `
    <div class="cont"><span>Item ${idx + 1} de ${atividades.length}</span>
      <span class="nav"><button id="prev" ${idx === 0 ? 'disabled' : ''}>◀</button><button id="next" ${idx === atividades.length - 1 ? 'disabled' : ''}>▶</button></span></div>
    <label>Descrição do serviço</label>
    <input type="text" id="fTitulo" value="${esc(a.titulo)}" placeholder="Ex.: Instalar eletrocalha">
    <label>Local de instalação</label>
    <input type="text" id="fLocal" value="${esc(a.local)}" placeholder="Ex.: Sala 02 – 1º andar">
    <label>Descrição / observações do levantamento</label>
    <textarea id="fObs" placeholder="Escreva o que for útil para o levantamento">${esc(a.obs)}</textarea>
    <label>Fotos (${fs.length}/${MAX_FOTOS})</label>
    <div class="fotos">${fs.map(f => `<div class="th"><img src="${f.data}" data-f="${f.id}"><button class="x" data-d="${f.id}">✕</button></div>`).join('')}</div>
    <div class="row"><button id="btnCam" ${fs.length >= MAX_FOTOS ? 'disabled' : ''}>📷 Tirar foto</button><button class="sec" id="btnGal" ${fs.length >= MAX_FOTOS ? 'disabled' : ''}>📎 Anexar foto</button></div>
    <button class="concluir ${a.concluida ? 'on' : ''}" id="btnOk">${a.concluida ? '✔ Concluída' : '☐ Marcar como concluída'}</button>
    <div class="row"><button class="sec" id="btnDup">⧉ Duplicar</button><button class="sec" id="btnDel">🗑 Excluir</button></div>
    <div class="dica">Deslize para o lado para trocar de tarefa (ou use ← →)</div>`;

  const salvar = () => DB.salvarAtividade(a);
  $('#fTitulo').oninput = e => { a.titulo = e.target.value; salvar(); };
  $('#fLocal').oninput = e => { a.local = e.target.value; salvar(); };
  $('#fObs').oninput = e => { a.obs = e.target.value; salvar(); };
  $('#prev').onclick = () => ir('tarefa', idx - 1);
  $('#next').onclick = () => ir('tarefa', idx + 1);
  $('#btnCam').onclick = () => $('#fileFoto').click();
  $('#btnGal').onclick = () => $('#fileGaleria').click();
  $('#btnOk').onclick = async () => { a.concluida = !a.concluida; await salvar(); renderTarefa(); };
  $('#btnDup').onclick = async () => { await novaAtividade(a.titulo, a.local, a.obs); toast('Duplicada (sem fotos)'); ir('tarefa', atividades.length - 1); };
  $('#btnDel').onclick = async () => {
    if (!await confirmar('Excluir esta atividade e suas fotos?')) return;
    await excluirAtividade(a.id); atividades.length ? ir('tarefa', Math.min(idx, atividades.length - 1)) : ir('home');
  };
  view.querySelectorAll('.fotos img').forEach(im => im.onclick = () => ampliar(im.src));
  view.querySelectorAll('.fotos .x').forEach(b => b.onclick = async () => {
    if (!await confirmar('Excluir esta foto?')) return;
    await DB.apagarFoto(b.dataset.d); fotos[a.id] = fotosDe(a.id).filter(f => f.id !== b.dataset.d); renderTarefa();
  });
}

// confirmação própria (o confirm() do navegador pode estar bloqueado e retornar "não" sem aviso)
function confirmar(msg) {
  return new Promise(res => {
    overlay(`<div class="form"><p style="color:#fff;font-size:17px;margin-bottom:6px">${esc(msg)}</p>
      <div class="row"><button class="sec" id="cfNao">Cancelar</button><button class="danger" id="cfSim">Confirmar</button></div></div>`);
    $('#cfNao').onclick = () => { fechar(); res(false); };
    $('#cfSim').onclick = () => { fechar(); res(true); };
  });
}
window.addEventListener('error', e => toast('Erro: ' + e.message));
window.addEventListener('unhandledrejection', e => toast('Erro: ' + (e.reason && e.reason.message || e.reason)));

function overlay(html) { const o = $('#overlay'); o.onclick = null; o.innerHTML = html; o.classList.remove('hidden'); return o; }
const fechar = () => { $('#overlay').classList.add('hidden'); $('#overlay').innerHTML = ''; };
function ampliar(src) {
  const o = overlay(`<img src="${src}"><div class="row"><button class="sec" id="ovFechar">Fechar</button></div>`);
  o.onclick = e => { if (e.target.tagName !== 'IMG') fechar(); };
}

/* ---------- FOTOS ---------- */
function reduzir(file, max = 1280) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('imagem inválida')); };
    img.src = url;
  });
}
async function aoEscolherFoto(e) {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try { fotoPendente = await reduzir(file); } catch { return toast('Não foi possível ler a foto'); }
  overlay(`<p>Usar esta foto?</p><img src="${fotoPendente}">
    <div class="row"><button class="danger" id="pvNao">✖ Não utilizar foto</button><button id="pvSim" style="background:var(--verde)">✔ Salvar foto</button></div>`);
  $('#pvNao').onclick = () => { fotoPendente = null; fechar(); };
  $('#pvSim').onclick = async () => {
    const a = atividades[idx];
    if (fotosDe(a.id).length >= MAX_FOTOS) { fechar(); return toast('Limite de 100 fotos'); }
    const f = { id: uid(), atividadeId: a.id, data: fotoPendente, t: Date.now() };
    await DB.salvarFoto(f); (fotos[a.id] ||= []).push(f); fotoPendente = null; fechar(); renderTarefa(); toast('Foto salva');
  };
}
$('#fileFoto').onchange = aoEscolherFoto;
$('#fileGaleria').onchange = aoEscolherFoto;

/* ---------- swipe e teclado ---------- */
let tx = null, ty = null;
view.addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
view.addEventListener('touchend', e => {
  if (tela !== 'tarefa' || tx === null) return;
  const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; tx = null;
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  const avanca = SWIPE_DIREITA_AVANCA ? dx > 0 : dx < 0;
  const novo = idx + (avanca ? 1 : -1);
  if (novo >= 0 && novo < atividades.length) ir('tarefa', novo);
}, { passive: true });
document.addEventListener('keydown', e => {
  if (tela !== 'tarefa' || ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || !$('#overlay').classList.contains('hidden')) return;
  if (e.key === 'ArrowRight' && idx < atividades.length - 1) ir('tarefa', idx + 1);
  if (e.key === 'ArrowLeft' && idx > 0) ir('tarefa', idx - 1);
});

/* ---------- EDITAR LISTA (PC): colar do Excel, copiar, duplicar, mover ---------- */
function renderEditar() {
  if (!orcAberto()) return ir('clientes');
  view.innerHTML = `
    <button class="sec" id="voltaHome">‹ Atividades</button>
    <p class="ajuda" style="margin-top:10px">Cole aqui linhas do Excel/Word (<b>Ctrl+V</b>): cada linha vira uma atividade deste orçamento. Com 2 colunas = <i>descrição</i> e <i>local</i>. Marque linhas e use <b>Ctrl+C</b> para copiar.</p>
    <textarea id="colar" placeholder="Cole aqui (Ctrl+V)…" style="min-height:70px"></textarea>
    <div class="row"><button id="btnAplicar">+ Criar atividades coladas</button></div>
    <label>Locais de instalação (cole uma coluna; linha 1 = Item 1, linha 2 = Item 2…)</label>
    <textarea id="colarLocal" placeholder="Cole aqui os locais (Ctrl+V)…" style="min-height:70px"></textarea>
    <div class="row"><button id="btnLocais">📍 Aplicar locais às atividades</button></div>
    <div class="row"><button class="sec" id="btnCopiar">Copiar marcadas (Ctrl+C)</button><button class="sec" id="btnTodas">Marcar todas</button></div>
    <div class="row"><button style="background:var(--verde)" id="btnLink">📲 Gerar link para o celular</button></div>
    <div id="lista" style="margin-top:12px"></div>
    <button class="add" id="btnAdd2">+ Adicionar serviço</button>`;
  desenharLista();
  $('#voltaHome').onclick = () => ir('home');
  $('#btnAplicar').onclick = () => colar($('#colar').value, true);
  $('#btnLink').onclick = gerarLink;
  $('#btnLocais').onclick = async () => {
    const ls = $('#colarLocal').value.split(/\r?\n/).map(l => l.trim()).filter((l, i, arr) => l || i < arr.length - 1);
    if (!ls.length) return toast('Cole os locais primeiro');
    for (let i = 0; i < ls.length; i++) {
      if (!atividades[i]) await novaAtividade('', ls[i]); else { atividades[i].local = ls[i]; await DB.salvarAtividade(atividades[i]); }
    }
    $('#colarLocal').value = ''; desenharLista(); toast(`${ls.length} local(is) aplicado(s)`);
  };
  $('#btnCopiar').onclick = copiarMarcadas;
  $('#btnTodas').onclick = () => { selecionadas = new Set(selecionadas.size === atividades.length ? [] : atividades.map(a => a.id)); desenharLista(); };
  $('#btnAdd2').onclick = async () => { await novaAtividade(); desenharLista(); };
}
function desenharLista() {
  const L = $('#lista'); if (!L) return;
  L.innerHTML = atividades.map((a, i) => `
    <div class="ed-linha" data-id="${a.id}">
      <input type="checkbox" ${selecionadas.has(a.id) ? 'checked' : ''} data-s="${a.id}">
      <span style="min-width:22px;padding-top:8px">${i + 1}</span>
      <input type="text" data-k="titulo" value="${esc(a.titulo)}" placeholder="Descrição">
      <input type="text" data-k="local" value="${esc(a.local)}" placeholder="Local">
      <button data-m="up">↑</button><button data-m="down">↓</button><button data-m="dup">⧉</button><button data-m="del">✕</button>
    </div>`).join('');
  L.querySelectorAll('.ed-linha').forEach(row => {
    const a = atividades.find(x => x.id === row.dataset.id);
    row.querySelector('[data-s]').onchange = e => e.target.checked ? selecionadas.add(a.id) : selecionadas.delete(a.id);
    row.querySelectorAll('input[type=text]').forEach(inp => inp.oninput = () => { a[inp.dataset.k] = inp.value; DB.salvarAtividade(a); });
    row.querySelectorAll('[data-m]').forEach(b => b.onclick = async () => {
      const i = atividades.indexOf(a), m = b.dataset.m;
      if (m === 'up' && i > 0) [atividades[i - 1], atividades[i]] = [atividades[i], atividades[i - 1]];
      if (m === 'down' && i < atividades.length - 1) [atividades[i + 1], atividades[i]] = [atividades[i], atividades[i + 1]];
      if (m === 'dup') { const n = { ...a, id: uid(), concluida: false }; atividades.splice(i + 1, 0, n); await DB.salvarAtividade(n); }
      if (m === 'del') { if (!await confirmar('Excluir atividade e fotos?')) return; await excluirAtividade(a.id); }
      await reordenar(); desenharLista();
    });
  });
}
async function colar(texto, limpar) {
  const linhas = texto.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim());
  if (!linhas.length) return toast('Nada para colar');
  for (const l of linhas) { const [t, loc = '', obs = ''] = l.split('\t'); await novaAtividade(t.trim(), loc.trim(), obs.trim()); }
  if (limpar && $('#colar')) $('#colar').value = '';
  desenharLista(); toast(`${linhas.length} atividade(s) criada(s)`);
}
async function copiarMarcadas() {
  const sel = atividades.filter(a => selecionadas.has(a.id));
  if (!sel.length) return toast('Marque as linhas para copiar');
  const txt = sel.map(a => [a.titulo, a.local, a.obs].join('\t')).join('\n');
  try { await navigator.clipboard.writeText(txt); toast(`${sel.length} copiada(s)`); } catch { toast('Não foi possível copiar'); }
}
document.addEventListener('paste', e => {
  if (tela !== 'editar' || ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  e.preventDefault(); colar(e.clipboardData.getData('text'));
});
document.addEventListener('copy', e => {
  if (tela !== 'editar' || ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  const sel = atividades.filter(a => selecionadas.has(a.id)); if (!sel.length) return;
  e.preventDefault(); e.clipboardData.setData('text/plain', sel.map(a => [a.titulo, a.local, a.obs].join('\t')).join('\n')); toast(`${sel.length} copiada(s)`);
});

/* ---------- EXPORTAR / IMPORTAR (arquivo, inclui fotos) ---------- */
function exportar() {
  sync();
  const dados = { versao: 2, exportadoEm: new Date().toISOString(), orcamentos, atividades: todas, fotos: Object.values(fotos).flat() };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(dados)], { type: 'application/json' }));
  a.download = `levantamento-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
$('#fileImport').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.atividades)) throw 0;
    sync();
    const mapaO = {}, mapaA = {};
    let orcs = d.orcamentos;
    if (!Array.isArray(orcs)) { orcs = [{ id: '_', cliente: 'Sem cliente', descricao: 'Importado' }]; d.atividades.forEach(a => a.orcId = '_'); }
    for (const o of orcs) { const n = await criarOrcamento(o.cliente || 'Sem cliente', o.descricao || ''); mapaO[o.id] = n.id; }
    for (const a of d.atividades) {
      if (!mapaO[a.orcId]) continue;
      const n = { ...a, id: uid(), orcId: mapaO[a.orcId] }; mapaA[a.id] = n.id;
      todas.push(n); await DB.salvarAtividade(n);
    }
    for (const f of d.fotos || []) {
      if (!mapaA[f.atividadeId]) continue;
      const n = { ...f, id: uid(), atividadeId: mapaA[f.atividadeId] }; await DB.salvarFoto(n); (fotos[n.atividadeId] ||= []).push(n);
    }
    if (orcAtual) atividades = todas.filter(a => a.orcId === orcAtual).sort((a, b) => a.ordem - b.ordem);
    toast('Levantamento importado (como novos orçamentos)'); ir('clientes');
  } catch { toast('Arquivo inválido'); }
};

/* ---------- LINK PARA O CELULAR (orçamento + lista de tarefas no endereço) ---------- */
const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
function gerarLink() {
  const o = orcAberto();
  if (!o || !atividades.length) return toast('Cole as tarefas primeiro');
  const dados = { c: o.cliente, d: o.descricao, n: o.numero, l: atividades.map(a => [a.titulo, a.local, a.obs]) };
  const url = location.href.split('#')[0] + '#orc=' + b64(JSON.stringify(dados));
  overlay(`<p>Envie este link para o celular (WhatsApp, e-mail). Ao abrir, o orçamento de ${esc(o.cliente)} com ${atividades.length} tarefas é carregado.</p>
    <textarea id="lnk" style="max-width:400px;min-height:120px" readonly>${esc(url)}</textarea>
    <div class="row"><button id="lnkCopia">Copiar link</button><button class="sec" id="lnkFecha">Fechar</button></div>`);
  $('#lnkCopia').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Link copiado'); } catch { $('#lnk').select(); } };
  $('#lnkFecha').onclick = fechar;
}
async function importarDoLink() {
  const m = location.hash.match(/^#orc=(.+)$/); if (!m) return;
  try {
    const d = JSON.parse(unb64(m[1]));
    let num = d.n;
    if (orcamentos.some(o => o.numero === num)) num = proximoNumero();
    const o = await criarOrcamento(d.c, d.d, num);
    abrirOrc(o.id);
    for (const [t, l, ob] of d.l) await novaAtividade(t || '', l || '', ob || '');
    toast(`Orçamento carregado: ${d.l.length} tarefas`);
    history.replaceState(null, '', location.pathname);
    return 'home';
  } catch { toast('Link inválido'); history.replaceState(null, '', location.pathname); }
}

/* ---------- início ---------- */
carregar().then(importarDoLink).then(destino => ir(destino || 'clientes'));
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js');
