// Armazenamento local (IndexedDB): orçamentos, atividades e fotos
const DB = (() => {
  let db;
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('levantamento', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('atividades')) d.createObjectStore('atividades', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('fotos')) d.createObjectStore('fotos', { keyPath: 'id' }).createIndex('atividadeId', 'atividadeId');
      if (!d.objectStoreNames.contains('orcamentos')) d.createObjectStore('orcamentos', { keyPath: 'id' });
    };
    r.onsuccess = () => { db = r.result; res(); };
    r.onerror = () => rej(r.error);
    r.onblocked = () => alert('Feche as outras abas/janelas deste programa e recarregue a página (F5).');
  });
  const run = (store, mode, fn) => new Promise((res, rej) => {
    const tx = db.transaction(store, mode);
    const out = fn(tx.objectStore(store));
    tx.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
    tx.onerror = () => rej(tx.error);
  });
  const raw = {
    open,
    todosOrcamentos: () => run('orcamentos', 'readonly', s => s.getAll()),
    salvarOrcamento: o => run('orcamentos', 'readwrite', s => s.put(o)),
    apagarOrcamento: id => run('orcamentos', 'readwrite', s => s.delete(id)),
    todasAtividades: () => run('atividades', 'readonly', s => s.getAll()),
    salvarAtividade: a => run('atividades', 'readwrite', s => s.put(a)),
    apagarAtividade: id => run('atividades', 'readwrite', s => s.delete(id)),
    todasFotos: () => run('fotos', 'readonly', s => s.getAll()),
    salvarFoto: f => run('fotos', 'readwrite', s => s.put(f)),
    apagarFoto: id => run('fotos', 'readwrite', s => s.delete(id)),
    limpar: async () => {
      await run('orcamentos', 'readwrite', s => s.clear());
      await run('atividades', 'readwrite', s => s.clear());
      await run('fotos', 'readwrite', s => s.clear());
    }
  };
  // Versão usada pelo app: carimba "upd" (hora da alteração) e avisa a nuvem (nuvem.js).
  // "raw" grava sem carimbar nem avisar (usado quando a mudança veio da nuvem).
  const api = { ...raw, raw, aoSalvar: null, aoApagar: null };
  const salva = (nome, store) => o => { o.upd = Date.now(); const r = raw[nome](o); if (api.aoSalvar) api.aoSalvar(store, o); return r; };
  const apaga = (nome, store) => id => { if (api.aoApagar) api.aoApagar(store, id); return raw[nome](id); };
  api.salvarOrcamento = salva('salvarOrcamento', 'orcamentos');
  api.salvarAtividade = salva('salvarAtividade', 'atividades');
  api.salvarFoto = salva('salvarFoto', 'fotos');
  api.apagarOrcamento = apaga('apagarOrcamento', 'orcamentos');
  api.apagarAtividade = apaga('apagarAtividade', 'atividades');
  api.apagarFoto = apaga('apagarFoto', 'fotos');
  return api;
})();
