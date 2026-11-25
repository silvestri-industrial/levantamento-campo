const MAX_FOTOS = 100;
let direcao = ''; // 'next' | 'prev' (animação ao trocar de tarefa)

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

async function criarOrcamento(cliente, descricao, numero, id) {
  const o = { id: id || uid(), cliente: cliente.trim() || 'Sem cliente', descricao: descricao.trim(), numero: numero || proximoNumero() };
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
async function novaAtividade(titulo = '', local = '', obs = '', id) {
  const a = { id: id || uid(), orcId: orcAtual, ordem: atividades.length, titulo, local, obs, concluida: false };
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
  const antes = idx, estavaTarefa = tela === 'tarefa';
  if (i !== undefined) idx = Math.max(0, Math.min(atividades.length - 1, i));
  direcao = (t === 'tarefa' && estavaTarefa && i !== undefined) ? (idx > antes ? 'next' : idx < antes ? 'prev' : '') : '';
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
  if (act === 'colarlink') colarLink();
  if (act === 'nuvem' && window.NUVEM) NUVEM.menu();
  if (act === 'relatorio') { if (!orcAtual) return toast('Abra um orçamento primeiro'); abrirRelatorio(); }
  if (act === 'apagar' && await confirmar('Apagar TODOS os clientes, orçamentos, atividades e fotos deste aparelho?')) {
    await DB.limpar(); if (window.NUVEM) NUVEM.zerar(); orcamentos = []; todas = []; atividades = []; fotos = {}; orcAtual = null; ir('clientes');
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
    <div class="hero"><img src="logo-branco.png" alt="Silvestri"><p>Levantamento de Campo<small>Clientes e orçamentos</small></p></div>
    <h2>Clientes</h2>
    <div class="resumo">${nomes.length} cliente(s) · ${orcamentos.length} orçamento(s)</div>
    <div class="grade">${nomes.map(n => {
      const os = orcamentos.filter(o => o.cliente === n);
      const qt = todas.filter(a => os.some(o => o.id === a.orcId)).length;
      return `<div class="cli" data-c="${esc(n)}"><b>${esc(n)}</b><small>${os.length} orçamento(s)<br>${qt} atividade(s)</small></div>`;
    }).join('')}</div>
    ${nomes.length ? '' : '<p class="ajuda">Nenhum cliente ainda. Toque em “+ Criar orçamento”.</p>'}
    <button class="add" id="btnNovoOrc">+ Criar orçamento</button>
    <button class="sec" style="width:100%;margin-top:8px" id="btnColarLink">📋 Colar link do orçamento</button>`;
  $('#btnColarLink').onclick = colarLink;
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
        <div class="t"><span class="orc-tag">ORÇAMENTO Nº ${o.numero}</span>${window.NUVEM ? NUVEM.selo(o.id) : ''}${esc(o.descricao) || '<i>(sem descrição)</i>'}<small>${as.filter(a => a.concluida).length}/${as.length} atividades concluídas</small></div>
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

/* faixa que mostra qual orçamento está aberto */
function bannerOrc() {
  const o = orcAberto(); if (!o) return '';
  return `<div class="orc-banner"><small>${esc(o.cliente.toUpperCase())} · ORÇAMENTO Nº ${o.numero}</small>${window.NUVEM ? NUVEM.selo(o.id) : ''}<b>${esc(o.descricao) || '(sem descrição)'}</b></div>`;
}

/* ---------- ATIVIDADES (HOME do orçamento) ---------- */
function renderHome() {
  if (!orcAberto()) return ir('clientes');
  const o = orcAberto();
  const feitas = atividades.filter(a => a.concluida).length;
  const pend = atividades.filter(incompleta).length;
  view.innerHTML = `
    <button class="sec" id="voltaOrc">‹ ${esc(o.cliente)}</button>
    ${bannerOrc()}
    <h2>Atividades</h2>
    <div class="resumo">${feitas} de ${atividades.length} concluídas · ${pend} com pendência (❌ sem foto/descrição)</div>
    ${atividades.map((a, i) => `
      <div class="item ${incompleta(a) ? 'alerta' : a.concluida ? 'ok' : ''}" data-i="${i}">
        <div class="n">Item ${i + 1}</div>
        <div class="t">${esc(a.titulo) || '<i>(sem descrição)</i>'}<small>${esc(a.local) || '(sem local)'} · 📷 ${fotosDe(a.id).length}</small></div>
        <div class="st">${a.concluida ? '✅' : ''}${incompleta(a) ? '❌' : ''}</div>
      </div>`).join('') || '<p class="ajuda">Nenhuma atividade ainda. Use “+ Adicionar serviço” ou ⋮ → Editar lista para colar do Excel.</p>'}
    <button class="add" id="btnAdd">+ Adicionar serviço</button>
    <button class="sec" style="width:100%;margin-top:8px" id="btnEd">📝 Editar lista (colar do Excel)</button>
    <button style="width:100%;margin-top:8px;background:var(--verde)" id="btnRel">📄 Relatório em PDF (com fotos)</button>
    <button class="sec" style="width:100%;margin-top:8px" id="btnRelPend">📄 Relatório das pendentes (PDF)</button>`;
  $('#btnRel').onclick = () => abrirRelatorio(false);
  $('#btnRelPend').onclick = () => atividades.some(a => !a.concluida) ? abrirRelatorio(true) : toast('Nenhuma atividade pendente');
  $('#voltaOrc').onclick = () => { clienteAtual = o.cliente; ir('orcamentos'); };
  view.querySelectorAll('.item').forEach(el => el.onclick = () => ir('tarefa', +el.dataset.i));
  $('#btnAdd').onclick = async () => { await novaAtividade(); ir('tarefa', atividades.length - 1); };
  $('#btnEd').onclick = () => ir('editar');
}

/* ---------- TAREFA ---------- */
function renderTarefa() {
  if (!atividades.length) return ir('home');
  if (idx > atividades.length - 1) idx = atividades.length - 1;
  const a = atividades[idx], fs = fotosDe(a.id);
  const anim = direcao ? ' anim-' + direcao : ''; direcao = '';
  view.innerHTML = bannerOrc() + `<div class="pagina${anim}">
    <button class="sec" id="voltaLista">‹ Lista de atividades</button>
    <div class="cont"><span>Item ${idx + 1} de ${atividades.length}</span>
      <span class="nav"><button id="prev" ${idx === 0 ? 'disabled' : ''}>▲ Anterior</button><button id="next" ${idx === atividades.length - 1 ? 'disabled' : ''}>Próxima ▼</button></span></div>
    <div class="prog"><i style="width:${((idx + 1) / atividades.length) * 100}%"></i></div>
    <label>Descrição do serviço</label>
    <textarea class="auto" id="fTitulo" rows="3" placeholder="Ex.: Instalar eletrocalha">${esc(a.titulo)}</textarea>
    <label>Local de instalação</label>
    <textarea class="auto" id="fLocal" rows="1" placeholder="Ex.: Sala 02 – 1º andar">${esc(a.local)}</textarea>
    <label>Descrição / observações do levantamento</label>
    <textarea id="fObs" placeholder="Escreva o que for útil para o levantamento">${esc(a.obs)}</textarea>
    <label>Fotos e vídeos (${fs.length}/${MAX_FOTOS})</label>
    <div class="fotos">${fs.map(miniatura).join('')}</div>
    <div class="row"><button id="btnCam" ${fs.length >= MAX_FOTOS ? 'disabled' : ''}>📷 Tirar foto</button><button id="btnVid" ${fs.length >= MAX_FOTOS ? 'disabled' : ''}>🎥 Filmar</button></div>
    <div class="row"><button class="sec" id="btnGal" ${fs.length >= MAX_FOTOS ? 'disabled' : ''}>📎 Anexar foto ou vídeo</button></div>
    <button class="concluir ${a.concluida ? 'on' : ''}" id="btnOk">${a.concluida ? '✔ Concluída' : '☐ Marcar como concluída'}</button>
    <div class="row"><button class="sec" id="btnDup">⧉ Duplicar</button><button class="sec" id="btnDel">🗑 Excluir</button></div>
    <div class="dica">⬆ Arraste para cima (no fim da página) para a próxima atividade · para baixo (no topo) para voltar</div></div>`;

  $('#voltaLista').onclick = () => ir('home');
  view.querySelectorAll('textarea.auto').forEach(crescer);
  const salvar = () => DB.salvarAtividade(a);
  $('#fTitulo').oninput = e => { a.titulo = e.target.value; salvar(); };
  $('#fLocal').oninput = e => { a.local = e.target.value; salvar(); };
  $('#fObs').oninput = e => { a.obs = e.target.value; salvar(); };
  $('#prev').onclick = () => ir('tarefa', idx - 1);
  $('#next').onclick = () => ir('tarefa', idx + 1);
  $('#btnCam').onclick = () => $('#fileFoto').click();
  $('#btnVid').onclick = () => $('#fileVideo').click();
  $('#btnGal').onclick = () => $('#fileGaleria').click();
  $('#btnOk').onclick = async () => { a.concluida = !a.concluida; await salvar(); renderTarefa(); };
  $('#btnDup').onclick = async () => { await novaAtividade(a.titulo, a.local, a.obs); toast('Duplicada (sem fotos)'); ir('tarefa', atividades.length - 1); };
  $('#btnDel').onclick = async () => {
    if (!await confirmar('Excluir esta atividade e suas fotos?')) return;
    await excluirAtividade(a.id); atividades.length ? ir('tarefa', Math.min(idx, atividades.length - 1)) : ir('home');
  };
  view.querySelectorAll('.fotos [data-f]').forEach(el => el.onclick = () => {
    const f = fotosDe(a.id).find(x => x.id === el.dataset.f); if (!f) return;
    f.tipo === 'video' ? ampliarVideo(urlMidia(f)) : ampliar(f.data);
  });
  view.querySelectorAll('.fotos .x').forEach(b => b.onclick = async () => {
    if (!await confirmar('Excluir este arquivo (foto/vídeo)?')) return;
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

// caixa de texto que cresce sozinha para mostrar todo o texto (sem Enter: vira uma linha só)
function crescer(el) {
  const ajusta = () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; };
  el.addEventListener('input', ajusta);
  el.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
  ajusta(); setTimeout(ajusta, 60); setTimeout(ajusta, 400);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajusta);
  if (window.ResizeObserver) { let w = el.clientWidth; new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; ajusta(); } }).observe(el); }
}

function overlay(html) { const o = $('#overlay'); o.onclick = null; o.innerHTML = html; o.classList.remove('hidden'); return o; }
const fechar = () => { $('#overlay').classList.add('hidden'); $('#overlay').innerHTML = ''; };
const urls = {};
const urlMidia = f => f.tipo === 'video' ? (urls[f.id] ||= URL.createObjectURL(f.blob)) : f.data;
const miniatura = f => f.tipo === 'video'
  ? `<div class="th"><video src="${urlMidia(f)}#t=0.1" preload="metadata" muted playsinline data-f="${f.id}"></video><span class="play">▶</span><button class="x" data-d="${f.id}">✕</button></div>`
  : `<div class="th"><img src="${f.data}" data-f="${f.id}"><button class="x" data-d="${f.id}">✕</button></div>`;
function ampliarVideo(src) {
  const o = overlay(`<video src="${src}" controls autoplay playsinline style="max-width:100%;max-height:75vh;border-radius:10px"></video><div class="row"><button class="sec" id="ovFechar">Fechar</button></div>`);
  o.onclick = e => { if (e.target.tagName !== 'VIDEO') fechar(); };
}
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
  if (file.type.startsWith('video/')) return previaVideo(file);
  try { fotoPendente = await reduzir(file); } catch { return toast('Não foi possível ler a foto'); }
  overlay(`<p>Usar esta foto?</p><img src="${fotoPendente}">
    <div class="row"><button class="danger" id="pvNao">✖ Não utilizar foto</button><button id="pvSim" style="background:var(--verde)">✔ Salvar foto</button></div>`);
  $('#pvNao').onclick = () => { fotoPendente = null; fechar(); };
  $('#pvSim').onclick = async () => {
    const a = atividades[idx];
    if (fotosDe(a.id).length >= MAX_FOTOS) { fechar(); return toast('Limite de 100 arquivos'); }
    const f = { id: uid(), atividadeId: a.id, data: fotoPendente, t: Date.now() };
    await DB.salvarFoto(f); (fotos[a.id] ||= []).push(f); fotoPendente = null; fechar(); renderTarefa(); toast('Foto salva');
  };
}
function previaVideo(file) {
  const url = URL.createObjectURL(file), mb = (file.size / 1048576).toFixed(1);
  overlay(`<p>Usar este vídeo? (${mb} MB)</p><video src="${url}" controls playsinline style="max-width:100%;max-height:60vh;border-radius:10px"></video>
    <div class="row"><button class="danger" id="pvNao">✖ Não utilizar vídeo</button><button id="pvSim" style="background:var(--verde)">✔ Salvar vídeo</button></div>`);
  $('#pvNao').onclick = () => { URL.revokeObjectURL(url); fechar(); };
  $('#pvSim').onclick = async () => {
    const a = atividades[idx];
    if (fotosDe(a.id).length >= MAX_FOTOS) { fechar(); return toast('Limite de 100 arquivos'); }
    try {
      const f = { id: uid(), atividadeId: a.id, tipo: 'video', blob: file, t: Date.now() };
      await DB.salvarFoto(f); (fotos[a.id] ||= []).push(f);
      URL.revokeObjectURL(url); fechar(); renderTarefa(); toast('Vídeo salvo');
    } catch { fechar(); toast('Não foi possível salvar o vídeo (pouco espaço?)'); }
  };
}
$('#fileFoto').onchange = aoEscolherFoto;
$('#fileGaleria').onchange = aoEscolherFoto;
$('#fileVideo').onchange = aoEscolherFoto;

/* ---------- swipe e teclado ---------- */
// arrastar para CIMA avança para a próxima atividade; para BAIXO volta (como no Instagram).
// Se a página ainda tem o que rolar, o arrasto apenas rola; ao chegar no fim/início, o próximo arrasto troca de atividade.
let ty = null, noFim = false, noTopo = false;
view.addEventListener('touchstart', e => {
  ty = e.touches[0].clientY;
  noTopo = view.scrollTop <= 2;
  noFim = view.scrollTop + view.clientHeight >= view.scrollHeight - 2;
}, { passive: true });
view.addEventListener('touchend', e => {
  if (tela !== 'tarefa' || ty === null) return;
  const dy = e.changedTouches[0].clientY - ty; ty = null;
  if (Math.abs(dy) < 80) return;
  if (dy < 0 && noFim && idx < atividades.length - 1) ir('tarefa', idx + 1);
  else if (dy > 0 && noTopo && idx > 0) ir('tarefa', idx - 1);
}, { passive: true });
document.addEventListener('keydown', e => {
  if (tela !== 'tarefa' || ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || !$('#overlay').classList.contains('hidden')) return;
  if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && idx < atividades.length - 1) ir('tarefa', idx + 1);
  if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && idx > 0) ir('tarefa', idx - 1);
});

/* ---------- EDITAR LISTA (PC): colar do Excel, copiar, duplicar, mover ---------- */
function renderEditar() {
  if (!orcAberto()) return ir('clientes');
  view.innerHTML = `
    <button class="sec" id="voltaHome">‹ Atividades</button>
    <div style="height:10px"></div>${bannerOrc()}
    <p class="ajuda">Cole aqui linhas do Excel/Word (<b>Ctrl+V</b>): cada linha vira uma atividade deste orçamento. Com 2 colunas = <i>descrição</i> e <i>local</i>. Marque linhas e use <b>Ctrl+C</b> para copiar.</p>
    <textarea id="colar" placeholder="Cole aqui (Ctrl+V)…" style="min-height:70px"></textarea>
    <div class="row"><button id="btnAplicar">+ Criar atividades coladas</button></div>
    <label>Locais de instalação (cole uma coluna; linha 1 = Item 1, linha 2 = Item 2…)</label>
    <textarea id="colarLocal" placeholder="Cole aqui os locais (Ctrl+V)…" style="min-height:70px"></textarea>
    <div class="row"><button id="btnLocais">📍 Aplicar locais às atividades</button></div>
    <div class="row"><button class="sec" id="btnCopiar">Copiar marcadas (Ctrl+C)</button><button class="sec" id="btnTodas">Marcar todas</button></div>
    <div class="row"><button style="background:var(--verde)" id="btnLink">📲 Gerar link para o celular</button></div>
    <div class="row"><button class="sec" id="btnArq">📄 Baixar arquivo para o celular</button></div>
    <div id="lista" style="margin-top:12px"></div>
    <button class="add" id="btnAdd2">+ Adicionar serviço</button>`;
  desenharLista();
  $('#voltaHome').onclick = () => ir('home');
  $('#btnAplicar').onclick = () => colar($('#colar').value, true);
  $('#btnLink').onclick = gerarLink;
  $('#btnArq').onclick = baixarArquivoOrcamento;
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
      <textarea class="auto" rows="1" data-k="titulo" placeholder="Descrição">${esc(a.titulo)}</textarea>
      <textarea class="auto" rows="1" data-k="local" placeholder="Local">${esc(a.local)}</textarea>
      <button data-m="up">↑</button><button data-m="down">↓</button><button data-m="dup">⧉</button><button data-m="del">✕</button>
    </div>`).join('');
  L.querySelectorAll('.ed-linha').forEach(row => {
    const a = atividades.find(x => x.id === row.dataset.id);
    row.querySelector('[data-s]').onchange = e => e.target.checked ? selecionadas.add(a.id) : selecionadas.delete(a.id);
    row.querySelectorAll('textarea.auto').forEach(inp => { crescer(inp); inp.addEventListener('input', () => { a[inp.dataset.k] = inp.value; DB.salvarAtividade(a); }); });
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
const blobParaDataURL = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
async function exportar() {
  sync(); toast('Preparando arquivo…');
  const fts = [];
  for (const f of Object.values(fotos).flat()) fts.push(f.tipo === 'video' ? { ...f, blob: undefined, data: await blobParaDataURL(f.blob) } : f);
  const dados = { versao: 2, exportadoEm: new Date().toISOString(), orcamentos, atividades: todas, fotos: fts };
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
      const n = { ...f, id: uid(), atividadeId: mapaA[f.atividadeId] };
      if (n.tipo === 'video' && n.data) { n.blob = await (await fetch(n.data)).blob(); delete n.data; }
      await DB.salvarFoto(n); (fotos[n.atividadeId] ||= []).push(n);
    }
    if (orcAtual) atividades = todas.filter(a => a.orcId === orcAtual).sort((a, b) => a.ordem - b.ordem);
    toast('Levantamento importado (como novos orçamentos)'); ir('clientes');
  } catch { toast('Arquivo inválido'); }
};

/* ---------- LINK PARA O CELULAR (orçamento + lista de tarefas no endereço) ---------- */
const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
// compacta o texto (deflate) e converte para base64 "de URL": link bem mais curto
const bytes2b64 = u8 => { let b = ''; u8.forEach(x => b += String.fromCharCode(x)); return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const b642bytes = t => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function comprimir(txt) {
  const buf = await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  return bytes2b64(new Uint8Array(buf));
}
async function descomprimir(b64) {
  return new Response(new Blob([b642bytes(b64)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
}
async function gerarLink() {
  const o = orcAberto();
  if (!o || !atividades.length) return toast('Cole as tarefas primeiro');
  const dados = [o.cliente, o.descricao, o.numero, atividades.map(a => a.obs ? [a.titulo, a.local, a.obs] : [a.titulo, a.local]), o.id, atividades.map(a => a.id)];
  let url;
  try { url = location.href.split('#')[0] + '#z=' + await comprimir(JSON.stringify(dados)); }
  catch { url = location.href.split('#')[0] + '#orc=' + b64(JSON.stringify({ c: o.cliente, d: o.descricao, n: o.numero, l: dados[3] })); }
  const longo = url.length > 2000;
  overlay(`<div class="form"><p style="color:#fff">Link do orçamento de ${esc(o.cliente)} com ${atividades.length} tarefas (${url.length} caracteres).</p>
    ${longo ? '<p style="color:#ffd27a">Link muito longo: se não abrir no celular, use “Baixar arquivo para o celular”.</p>' : ''}
    <textarea id="lnk" style="min-height:110px" readonly>${esc(url)}</textarea>
    <div class="row"><button id="lnkCopia">Copiar link</button><button class="sec" id="lnkFecha">Fechar</button></div></div>`);
  $('#lnkCopia').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Link copiado'); } catch { $('#lnk').select(); } };
  $('#lnkFecha').onclick = fechar;
}
// arquivo só deste orçamento (sem fotos), para enviar por WhatsApp/e-mail e abrir no celular com ⋮ → Importar
function baixarArquivoOrcamento() {
  const o = orcAberto(); if (!o) return;
  const dados = { versao: 2, orcamentos: [o], atividades: atividades.map(a => ({ ...a, concluida: false })), fotos: [] };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(dados)], { type: 'application/json' }));
  a.download = `orcamento-${o.numero}-${o.cliente.replace(/[^\w-]+/g, '_')}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Arquivo baixado — envie para o celular e use ⋮ → Importar');
}
// lê um link (ou só o código depois do #) e cria o orçamento
async function importarTexto(txt) {
  const m = String(txt).match(/[#?&]?(z|orc)=([A-Za-z0-9_-]+)/);
  if (!m) { toast('Link não reconhecido'); return false; }
  try {
    let c, d, n, l, oid, aids;
    if (m[1] === 'z') { [c, d, n, l, oid, aids] = JSON.parse(await descomprimir(m[2])); }
    else { const x = JSON.parse(unb64(m[2])); c = x.c; d = x.d; n = x.n; l = x.l; }
    const ja = oid && orcamentos.find(x => x.id === oid);
    if (ja) { abrirOrc(ja.id); toast('Este orçamento já está no aparelho'); return true; }
    if (orcamentos.some(o => o.numero === n)) n = proximoNumero();
    const o = await criarOrcamento(c, d, n, oid);
    abrirOrc(o.id);
    for (const [i, [t, loc, ob]] of l.entries()) await novaAtividade(t || '', loc || '', ob || '', aids && aids[i]);
    toast(`Orçamento carregado: ${l.length} tarefas`);
    return true;
  } catch { toast('Link inválido ou incompleto'); return false; }
}
async function importarDoLink() {
  if (!/^#(z|orc)=/.test(location.hash)) return;
  const ok = await importarTexto(location.hash);
  history.replaceState(null, '', location.pathname);
  return ok ? 'home' : undefined;
}
// no iPhone o link abre no Safari e não no app instalado: por isso é possível colar o link dentro do app
function colarLink() {
  overlay(`<div class="form"><h2 style="color:#fff">Colar link do orçamento</h2>
    <p style="color:#D9D9D9;margin:6px 0">Copie o link recebido (segure o dedo sobre ele → Copiar), volte para este app e cole abaixo.</p>
    <textarea id="lkCola" style="min-height:110px" placeholder="Cole o link aqui"></textarea>
    <div class="row"><button class="sec" id="lkNao">Cancelar</button><button id="lkSim" style="background:var(--verde)">Carregar</button></div></div>`);
  $('#lkNao').onclick = fechar;
  $('#lkSim').onclick = async () => {
    const t = $('#lkCola').value;
    if (await importarTexto(t)) { fechar(); ir('home'); }
  };
}

/* ---------- RELATÓRIO EM PDF (com todas as fotos) ---------- */
// Monta o relatório na tela; "Imprimir / Salvar PDF" abre a impressão do aparelho, onde se escolhe "Salvar como PDF".
let relFiltro = false; // true = relatório só das atividades pendentes
async function abrirRelatorio(apenasPend = false) {
  const o = orcAberto(); if (!o) return toast('Abra um orçamento primeiro');
  relFiltro = apenasPend === true;
  const area = $('#print-area');
  const dt = new Date().toLocaleDateString('pt-BR');
  let totFotos = 0, totVideos = 0;
  const lista = relFiltro ? atividades.filter(a => !a.concluida) : atividades;
  const blocos = atividades.map((a, i) => {
    if (relFiltro && a.concluida) return '';
    const ms = fotosDe(a.id), fs = ms.filter(m => m.tipo !== 'video'), nv = ms.length - fs.length;
    totFotos += fs.length; totVideos += nv;
    return `<section class="rp-item">
      <div class="rp-tit"><span>ITEM ${i + 1}</span><em class="${a.concluida ? 'ok' : 'pend'}">${a.concluida ? 'Concluída' : 'Pendente'}</em></div>
      <p class="rp-desc">${esc(a.titulo) || '(sem descrição)'}</p>
      <p><b>Local de instalação:</b> ${esc(a.local) || '—'}</p>
      ${a.obs ? `<p><b>Observações:</b> ${esc(a.obs)}</p>` : ''}
      ${fs.length ? `<div class="rp-fotos">${fs.map((f, k) => `<figure><img src="${f.data}"><figcaption>Foto ${k + 1} de ${fs.length}</figcaption></figure>`).join('')}</div>` : '<p class="rp-sem">Sem fotos</p>'}
      ${nv ? `<p class="rp-vid">${nv} vídeo(s) anexado(s) no aplicativo (vídeos não entram no PDF).</p>` : ''}
    </section>`;
  }).join('');
  area.innerHTML = `
    <div class="rp-barra"><button class="sec" id="rpVolta">‹ Voltar</button><button id="rpPdf" style="background:var(--verde)">📄 Gerar PDF</button><button class="sec" id="rpPrint">🖨 Imprimir</button></div>
    <div class="rp-pagina">
      <div class="rp-cab"><img src="logo-branco.png" alt="Silvestri"><div><b>${relFiltro ? 'RELATÓRIO DE ATIVIDADES PENDENTES' : 'RELATÓRIO DE LEVANTAMENTO DE CAMPO'}</b><span>${esc(o.cliente)} · Orçamento nº ${o.numero}</span></div></div>
      <h1>${esc(o.descricao) || '(sem descrição)'}</h1>
      <p class="rp-meta">Data: ${dt} · ${relFiltro ? `${lista.length} pendente(s) de ${atividades.length} atividade(s)` : `${atividades.length} atividade(s) · ${atividades.filter(a => a.concluida).length} concluída(s)`} · ${totFotos} foto(s)${totVideos ? ` · ${totVideos} vídeo(s) fora do PDF` : ''}</p>
      ${blocos || '<p>Nenhuma atividade neste orçamento.</p>'}
    </div>`;
  document.body.classList.add('relatorio');
  area.scrollTop = 0;
  $('#rpVolta').onclick = () => { document.body.classList.remove('relatorio'); area.innerHTML = ''; };
  $('#rpPdf').onclick = criarPdfEMostrar;
  $('#rpPrint').onclick = async () => {
    await Promise.all([...area.querySelectorAll('img')].map(im => im.decode ? im.decode().catch(() => {}) : 0));
    const t = document.title; document.title = `Relatorio-Orcamento-${o.numero}-${o.cliente}`.replace(/[^\w-]+/g, '_');
    window.print(); setTimeout(() => { document.title = t; }, 1500);
  };
}

/* ---------- PDF de verdade (arquivo) - funciona no iPhone, onde "imprimir" nao abre ---------- */
const limpaPdf = t => String(t ?? '').replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2026/g, '...').replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, '');
const carregaImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
// reduz a foto para o PDF nao ficar gigante
async function fotoParaPdf(dataUrl, max = 1000) {
  const im = await carregaImg(dataUrl), k = Math.min(1, max / Math.max(im.width, im.height));
  const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  return { url: c.toDataURL('image/jpeg', 0.75), w: c.width, h: c.height };
}
async function gerarPdf() {
  const o = orcAberto(); if (!o) return;
  if (!window.jspdf) { toast('Biblioteca de PDF não carregou. Atualize o app.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const AZUL = [0, 51, 102], CIANO = [0, 168, 232], CINZA = [140, 140, 140], ESC = [27, 36, 48];
  const M = 15, LARG = 180, FIM = 282;
  let y = 15;
  const ensure = h => { if (y + h > FIM) { doc.addPage(); y = 15; } };
  const texto = (txt, tam, estilo, cor, x = M, larg = LARG) => {
    doc.setFont('helvetica', estilo); doc.setFontSize(tam); doc.setTextColor(...cor);
    const linhas = doc.splitTextToSize(limpaPdf(txt), larg);
    for (const l of linhas) { ensure(tam * 0.43 + 1); doc.text(l, x, y + tam * 0.35); y += tam * 0.43 + 0.6; }
  };
  // cabecalho
  const logo = await fetch('logo-branco.png').then(r => r.blob()).then(blobParaDataURL), li = await carregaImg(logo);
  doc.setFillColor(...AZUL); doc.roundedRect(M, y, LARG, 24, 2, 2, 'F');
  const lw = 48, lh = lw * li.height / li.width; doc.addImage(logo, 'PNG', M + 5, y + (24 - lh) / 2, lw, lh);
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(relFiltro ? 'RELATORIO DE ATIVIDADES PENDENTES' : 'RELATORIO DE LEVANTAMENTO DE CAMPO', M + 62, y + 10);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(217, 217, 217); doc.text(limpaPdf(`${o.cliente} - Orcamento n ${o.numero}`), M + 62, y + 17);
  y += 31;
  texto(o.descricao || '(sem descricao)', 15, 'bold', AZUL);
  const concl = atividades.filter(a => a.concluida).length;
  const lista = relFiltro ? atividades.filter(a => !a.concluida) : atividades;
  const totF = lista.reduce((n, a) => n + fotosDe(a.id).filter(f => f.tipo !== 'video').length, 0);
  const totV = lista.reduce((n, a) => n + fotosDe(a.id).filter(f => f.tipo === 'video').length, 0);
  y += 1; texto(`Data: ${new Date().toLocaleDateString('pt-BR')}  |  ${relFiltro ? `${lista.length} pendente(s) de ${atividades.length} atividade(s)` : `${atividades.length} atividade(s)  |  ${concl} concluida(s)`}  |  ${totF} foto(s)${totV ? `  |  ${totV} video(s) fora do PDF` : ''}`, 9, 'normal', CINZA);
  y += 4;
  // atividades
  let feitasPdf = 0;
  for (let i = 0; i < atividades.length; i++) {
    if (relFiltro && atividades[i].concluida) continue;
    const pg = $('#pdfProg'); if (pg) pg.textContent = `Atividade ${++feitasPdf} de ${lista.length}`; await new Promise(r => setTimeout(r, 0));
    const a = atividades[i], ms = fotosDe(a.id), fs = ms.filter(m => m.tipo !== 'video'), nv = ms.length - fs.length;
    ensure(40); let y0 = y;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...AZUL); doc.text(`ITEM ${i + 1}`, M + 4, y + 4);
    doc.setTextColor(...(a.concluida ? [21, 122, 69] : [180, 35, 35])); doc.text(a.concluida ? 'Concluida' : 'Pendente', M + LARG, y + 4, { align: 'right' });
    y += 7;
    texto(a.titulo || '(sem descricao)', 11, 'bold', ESC, M + 4, LARG - 4);
    texto('Local de instalacao: ' + (a.local || '-'), 10, 'normal', ESC, M + 4, LARG - 4);
    if (a.obs) texto('Observacoes: ' + a.obs, 10, 'normal', ESC, M + 4, LARG - 4);
    if (!fs.length) texto('Sem fotos', 9, 'italic', CINZA, M + 4);
    // fotos: 2 por linha
    for (let k = 0; k < fs.length; k += 2) {
      const par = [];
      for (const f of fs.slice(k, k + 2)) par.push(await fotoParaPdf(f.data));
      const larg = 86, hs = par.map(p => Math.min(larg * p.h / p.w, 110)), linhaH = Math.max(...hs) + 5;
      if (y + linhaH + 2 > FIM) { doc.setFillColor(...CIANO); doc.rect(M, y0, 1.2, Math.max(2, y - y0), 'F'); doc.addPage(); y = 15; y0 = y; }
      par.forEach((p, n) => {
        const h = hs[n], w = h * p.w / p.h, x = M + 4 + n * (larg + 4);
        doc.addImage(p.url, 'JPEG', x, y, w, h, undefined, 'FAST');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...CINZA); doc.text(`Foto ${k + n + 1} de ${fs.length}`, x, y + h + 3.5);
      });
      y += linhaH;
    }
    if (nv) texto(`${nv} video(s) anexado(s) no aplicativo (videos nao entram no PDF).`, 9, 'italic', CINZA, M + 4);
    doc.setFillColor(...CIANO); doc.rect(M, y0, 1.2, Math.max(2, y - y0), 'F');
    y += 5; doc.setDrawColor(217, 217, 217); doc.line(M, y - 2.5, M + LARG, y - 2.5);
  }
  // rodape com numeracao
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...CINZA);
    doc.text(limpaPdf(`Silvestri - ${o.cliente} - Orcamento n ${o.numero}`), M, 291); doc.text(`Pagina ${p} de ${n}`, M + LARG, 291, { align: 'right' });
  }
  return doc.output('blob');
}
async function criarPdfEMostrar() {
  const o = orcAberto();
  // o popup abre logo ao clicar, ja com a mensagem de progresso
  overlay(`<div class="form"><h2 style="color:#fff">Gerando PDF…</h2>
    <p style="color:#D9D9D9;margin:6px 0" id="pdfProg">Preparando…</p>
    <button id="pdfCancela" class="sec" style="width:100%;margin-top:8px">Cancelar</button></div>`);
  let cancelado = false;
  $('#pdfCancela').onclick = () => { cancelado = true; fechar(); };
  try {
    const blob = await gerarPdf(); if (!blob || cancelado) return;
    const nome = (relFiltro
      ? `Pendentes - Orçamento - ${o.descricao || o.cliente}`.replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim()
      : `Relatorio-Orcamento-${o.numero}-${o.cliente}`.replace(/[^\w-]+/g, '_')) + '.pdf';
    const url = URL.createObjectURL(blob), mb = (blob.size / 1048576).toFixed(1);
    const arquivo = new File([blob], nome, { type: 'application/pdf' });
    const podeCompartilhar = !!(navigator.canShare && navigator.canShare({ files: [arquivo] }));
    overlay(`<div class="form"><h2 style="color:#fff">PDF pronto \u2714</h2>
      <p style="color:#D9D9D9;margin:6px 0">${esc(nome)} (${mb} MB)</p>
      ${podeCompartilhar ? '<button id="pdfShare" style="width:100%;margin-top:8px;background:var(--verde)">\u{1F4E4} Compartilhar / Salvar em Arquivos</button>' : ''}
      <button id="pdfAbrir" style="width:100%;margin-top:8px">\u{1F441} Abrir PDF</button>
      <button id="pdfBaixar" class="sec" style="width:100%;margin-top:8px">\u2B07 Baixar arquivo</button>
      <button id="pdfFecha" class="sec" style="width:100%;margin-top:8px">Fechar</button></div>`);
    if (podeCompartilhar) $('#pdfShare').onclick = async () => { try { await navigator.share({ files: [arquivo], title: nome }); } catch (e) { if (e.name !== 'AbortError') toast('Não foi possível compartilhar'); } };
    $('#pdfAbrir').onclick = () => { window.open(url, '_blank') || (location.href = url); };
    $('#pdfBaixar').onclick = () => { const a = document.createElement('a'); a.href = url; a.download = nome; a.click(); };
    $('#pdfFecha').onclick = fechar;
  } catch (err) {
    fechar(); toast('Erro ao gerar PDF: ' + (err.message || err));
  }
}

/* ---------- inicio ---------- */
carregar().then(importarDoLink).then(destino => { ir(destino || 'clientes'); if (window.NUVEM) NUVEM.iniciar(); });
const VERSAO = '2026-11-25 · v11b';
if ($('#versao')) $('#versao').textContent = 'Versão ' + VERSAO;
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  const tinhaSW = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const verifica = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) verifica(); });
    setInterval(verifica, 5 * 60 * 1000);
  });
  // quando uma versão nova assume, recarrega uma vez para mostrar a atualização
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (tinhaSW && !sessionStorage.getItem('recarregou')) { sessionStorage.setItem('recarregou', '1'); location.reload(); }
  });
}
