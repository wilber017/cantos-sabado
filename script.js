/* ===================== IndexedDB Helper ===================== */
const DB = (() => {
  const DB_NAME = 'CifrasWebDB';
  const DB_VER = 3; // nova versão (adicionando playlists na meta)
  let db;

  function open(){
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e)=>{
        db = e.target.result;
        if (!db.objectStoreNames.contains('songs')) {
          const s = db.createObjectStore('songs', { keyPath: 'id' });
          s.createIndex('title','title',{unique:false});
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' }); // {key:'categories'|'tags'|'playlists'|'seedApplied'}
        }
      };
      req.onsuccess = ()=>{ db = req.result; resolve(); };
      req.onerror = ()=> reject(req.error);
    });
  }
  const tx = (store,mode='readonly') => db.transaction(store,mode).objectStore(store);

  // Songs
  const listSongs = () => new Promise((resolve,reject)=>{
    const out=[]; const r = tx('songs').openCursor();
    r.onsuccess = e => { const c = e.target.result; if(c){ out.push(c.value); c.continue(); } else resolve(out); };
    r.onerror = e => reject(e.target.error);
  });
  const getSong = id => new Promise((resolve,reject)=>{
    const r = tx('songs').get(id); r.onsuccess = ()=> resolve(r.result); r.onerror = ()=> reject(r.error);
  });
  const saveSong = song => new Promise((resolve,reject)=>{
    const s = tx('songs','readwrite'); if(!song.id) song.id = 's_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
    const r = s.put(song); r.onsuccess = ()=> resolve(song); r.onerror = ()=> reject(r.error);
  });
  const deleteSong = id => new Promise((resolve,reject)=>{
    const r = tx('songs','readwrite').delete(id); r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error);
  });

  // Meta
  const getMeta = key => new Promise((resolve,reject)=>{ const r = tx('meta').get(key); r.onsuccess=()=>resolve(r.result?r.result.value:null); r.onerror=()=>reject(r.error); });
  const setMeta = (key,value) => new Promise((resolve,reject)=>{ const r = tx('meta','readwrite').put({key,value}); r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error); });

  return { open, listSongs, getSong, saveSong, deleteSong, getMeta, setMeta };
})();

/* ===================== Estado / Elementos ===================== */
const State = {
  filterCat:'', filterTag:'', search:'',
  currentSong:null, editingId:null,
  urls: new Map(), // id -> {pdfURL, audioURL}
  pickerSongId: null
};
const els = {};
function elcache(){
  els.tabs = document.querySelectorAll('.tabs button');
  els.sections = {
    library: byId('tab-library'),
    create: byId('tab-create'),
    manage: byId('tab-manage'),
    playlists: byId('tab-playlists'),
  };
  // library
  els.search = byId('search'); els.categoryFilter = byId('categoryFilter');
  els.tagChips = byId('tagChips'); els.songList = byId('songList');
  // form
  els.title = byId('title'); els.artist = byId('artist'); els.category = byId('category');
  els.tags = byId('tags'); els.pdfInput = byId('pdfInput'); els.audioInput = byId('audioInput');
  els.saveSong = byId('saveSong'); els.clearForm = byId('clearForm');
  // manage
  els.newCategory = byId('newCategory'); els.addCategory = byId('addCategory');
  els.categoryList = byId('categoryList'); els.exportMeta = byId('exportMeta'); els.exportAll = byId('exportAll');
  els.importFile = byId('importFile'); els.importData = byId('importData');
  // playlists tab
  els.newPlaylistName = byId('newPlaylistName'); els.btnCreatePlaylist = byId('btnCreatePlaylist');
  els.playlistList = byId('playlistList');
  // modal música
  els.modal = byId('modal'); els.modalClose = byId('modalClose');
  els.mTitle = byId('mTitle'); els.mMeta = byId('mMeta'); els.mTags = byId('mTags');
  els.pdfViewer = byId('pdfViewer'); els.mAudio = byId('mAudio');
  els.editSong = byId('editSong'); els.deleteSong = byId('deleteSong');
  els.btnOpenPDF = byId('btnOpenPDF'); els.btnDownloadAll = byId('btnDownloadAll'); els.btnFullscreen = byId('btnFullscreen');
  // playlist picker
  els.playlistPicker = byId('playlistPicker'); els.pickerClose = byId('pickerClose');
  els.pickerNewName = byId('pickerNewName'); els.pickerCreate = byId('pickerCreate'); els.pickerList = byId('pickerList');
}

/* ===================== Seed inicial via default_songs.json ===================== */
/** Coloque 'default_songs.json' na mesma pasta do index.html */
const DEFAULT_SEED_URL = 'default_songs.json';

async function maybeSeedFromDefault() {
  // se já aplicou uma vez, não repete
  const applied = await DB.getMeta('seedApplied');
  if (applied) return;

  // se já existem músicas, só marca como aplicado e sai
  const existing = await DB.listSongs();
  if (existing.length > 0) {
    await DB.setMeta('seedApplied', true);
    return;
  }

  // tenta buscar o JSON padrão
  try {
    const resp = await fetch(DEFAULT_SEED_URL, { cache: 'no-store' });
    if (!resp.ok) return; // se não existir, segue sem seed
    const data = await resp.json();
    if (!data || !Array.isArray(data.songs)) return;

    // mesclar categorias/tags/playlists se vierem
    if (Array.isArray(data.categories)) {
      const cur = new Set((await DB.getMeta('categories')) || []);
      data.categories.forEach(c => cur.add(c));
      await DB.setMeta('categories', Array.from(cur).sort());
    }
    if (Array.isArray(data.tags)) {
      const cur = new Set((await DB.getMeta('tags')) || []);
      data.tags.forEach(t => cur.add(t));
      await DB.setMeta('tags', Array.from(cur).sort());
    }
    if (Array.isArray(data.playlists)) {
      await DB.setMeta('playlists', data.playlists);
    }

    // salvar músicas do seed
    for (const s of data.songs){
      await DB.saveSong({
        id: s.id || null,
        title: s.title||'',
        artist: s.artist||'',
        category: s.category||'',
        tags: s.tags||[],
        createdAt: s.createdAt||Date.now(),
        updatedAt: s.updatedAt||Date.now(),
        pdfName: s.pdfName||'',
        audioName: s.audioName||'',
        pdfBlob: s.pdfB64 ? base64ToBlob(s.pdfB64, s.pdfMime||'application/pdf') : null,
        audioBlob: s.audioB64 ? base64ToBlob(s.audioB64, s.audioMime||'audio/mp3') : null
      });
    }

    await DB.setMeta('seedApplied', true);
  } catch (e) {
    console.warn('Seed padrão não aplicado:', e);
  }
}

/* ===================== Boot ===================== */
document.addEventListener('DOMContentLoaded', async ()=>{
  await DB.open();
  elcache();
  bindEvents();
  await ensureDefaults();
  await maybeSeedFromDefault(); // <<<<<< carrega JSON padrão na primeira visita
  await refreshCategories();
  await refreshTagsChips();
  await renderList();
  await renderPlaylists();
});

/* ===================== Defaults ===================== */
async function ensureDefaults(){
  if (!(await DB.getMeta('categories'))) await DB.setMeta('categories', ['Geral','Louvor','Missa','Ensaios']);
  if (!(await DB.getMeta('tags'))) await DB.setMeta('tags', ['entrada','ofertório','comunhão','final']);
  if (!(await DB.getMeta('playlists'))) await DB.setMeta('playlists', []); // {id,name,songIds:[]}
}

/* ===================== Events ===================== */
function bindEvents(){
  // tabs
  document.querySelectorAll('.tabs button').forEach(btn=> btn.addEventListener('click', ()=>switchTab(btn.dataset.tab, btn)));

  // filtros
  els.search.addEventListener('input', ()=>{ State.search = els.search.value.trim().toLowerCase(); renderList(); });
  els.categoryFilter.addEventListener('change', ()=>{ State.filterCat = els.categoryFilter.value; renderList(); });

  // form
  els.saveSong.addEventListener('click', saveCurrentSong);
  els.clearForm.addEventListener('click', clearForm);

  // manage
  els.addCategory.addEventListener('click', addCategory);
  els.exportMeta.addEventListener('click', ()=> exportData(false));
  els.exportAll.addEventListener('click', ()=> exportData(true));
  els.importData.addEventListener('click', importData);

  // modal música
  els.modalClose.addEventListener('click', closeModal);
  els.editSong.addEventListener('click', ()=> loadSongIntoForm(State.currentSong));
  els.deleteSong.addEventListener('click', deleteCurrentSong);
  els.btnOpenPDF.addEventListener('click', ()=> {
    const u = State.urls.get(State.currentSong?.id); if (u?.pdfURL) window.open(u.pdfURL,'_blank');
  });
  els.btnDownloadAll.addEventListener('click', downloadCurrentFiles);
  els.btnFullscreen.addEventListener('click', toggleFullscreenPDF);

  // playlists tab
  els.btnCreatePlaylist.addEventListener('click', createPlaylistFromTab);

  // playlist picker
  els.pickerClose.addEventListener('click', closePicker);
  els.pickerCreate.addEventListener('click', createPlaylistFromPicker);
}

/* ===================== Categorias/Tags ===================== */
async function getCategories(){ return (await DB.getMeta('categories')) || []; }
async function setCategories(list){ await DB.setMeta('categories', list); }

async function refreshCategories(){
  const cats = await getCategories();
  els.category.innerHTML = cats.map(c=>`<option>${escapeHtml(c)}</option>`).join('');
  els.categoryFilter.innerHTML = `<option value="">Todas as categorias</option>` + cats.map(c=>`<option>${escapeHtml(c)}</option>`).join('');
  els.categoryList.innerHTML = cats.map(c=>`
    <li class="actions" style="align-items:center;justify-content:space-between">
      <span>${escapeHtml(c)}</span>
      <button data-cat="${escapeHtml(c)}" class="btn-danger inline">Remover</button>
    </li>`).join('');
  els.categoryList.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const list = (await getCategories()).filter(x=>x!==b.dataset.cat);
      await setCategories(list); await refreshCategories(); await renderList();
    });
  });
}
async function addCategory(){
  const name = (els.newCategory.value||'').trim(); if (!name) return;
  const set = new Set(await getCategories()); set.add(name);
  await setCategories(Array.from(set).sort()); els.newCategory.value=''; await refreshCategories();
}
async function refreshTagsChips(){
  const tags = (await DB.getMeta('tags')) || [];
  const all = ['todas', ...tags];
  els.tagChips.innerHTML = all.map(t=>{
    const val = t==='todas'?'':t; const cls = (State.filterTag===val)?'chip active':'chip';
    return `<span class="${cls}" data-tag="${escapeHtml(val)}">${escapeHtml(t)}</span>`;
  }).join('');
  els.tagChips.querySelectorAll('.chip').forEach(ch=>{
    ch.addEventListener('click', ()=>{ State.filterTag = ch.dataset.tag || ''; refreshTagsChips(); renderList(); });
  });
}

/* ===================== Lista / Biblioteca ===================== */
async function renderList(){
  const items = await DB.listSongs();
  items.sort((a,b)=> (a.title||'').localeCompare(b.title||''));
  const f = items.filter(it=>{
    const catOk = !State.filterCat || it.category===State.filterCat;
    const tagOk = !State.filterTag || (it.tags||[]).includes(State.filterTag);
    const q = State.search;
    const searchOk = !q || [it.title,it.artist,...(it.tags||[])].some(v=>(v||'').toLowerCase().includes(q));
    return catOk && tagOk && searchOk;
  });
  els.songList.innerHTML = f.map(it=> songItemHTML(it)).join('');
  // binds
  els.songList.querySelectorAll('[data-open]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.closest('li').dataset.id;
      const song = await DB.getSong(id);
      openModal(song);
    });
  });
  els.songList.querySelectorAll('[data-addtoplaylist]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.closest('li').dataset.id;
      openPicker(id);
    });
  });
}
function songItemHTML(it){
  const tags = (it.tags||[]).map(t=>`<span class="badge">${escapeHtml(t)}</span>`).join('');
  return `
  <li data-id="${it.id}">
    <div class="song-row">
      <div>
        <div class="song-title">${escapeHtml(it.title||'Sem título')}</div>
        <div class="song-meta">${escapeHtml(it.artist||'Sem artista')} • ${escapeHtml(it.category||'Sem categoria')}</div>
        <div class="song-meta">${tags}</div>
      </div>
      <div class="actions-row">
        <button class="inline" data-addtoplaylist>+ Playlist</button>
        <button class="inline btn-primary" data-open>Abrir</button>
      </div>
    </div>
  </li>`;
}

/* ===================== Modal / Viewer Música ===================== */
function openModal(song){
  State.currentSong = song;
  els.mTitle.textContent = song.title || 'Sem título';
  els.mMeta.textContent = `${song.artist||'Sem artista'} • ${song.category||'Sem categoria'}`;
  els.mTags.textContent = (song.tags||[]).join(', ') || 'Sem tags';

  // revoke antigos
  const prev = State.urls.get(song.id) || {};
  if (prev.pdfURL) URL.revokeObjectURL(prev.pdfURL);
  if (prev.audioURL) URL.revokeObjectURL(prev.audioURL);
  const pdfURL = song.pdfBlob ? URL.createObjectURL(song.pdfBlob) : '';
  const audioURL = song.audioBlob ? URL.createObjectURL(song.audioBlob) : '';
  State.urls.set(song.id, {pdfURL, audioURL});

  // PDF
  els.pdfViewer.querySelector('iframe')?.remove();
  if (pdfURL){
    const ifr = document.createElement('iframe');
    ifr.src = pdfURL + '#toolbar=1&navpanes=0&scrollbar=1';
    ifr.title = 'PDF';
    els.pdfViewer.appendChild(ifr);
  } else {
    els.pdfViewer.innerHTML = `<div class="pdfhint" style="padding:10px">Nenhum PDF anexado.</div>`;
  }

  // Áudio
  if (audioURL){ els.mAudio.src = audioURL; els.mAudio.style.display='block'; }
  else { els.mAudio.removeAttribute('src'); els.mAudio.style.display='none'; }

  els.modal.style.display='flex';
}
function closeModal(){
  els.modal.style.display='none';
  els.mAudio.pause?.();
  State.currentSong = null;
}
function toggleFullscreenPDF(){
  const el = els.pdfViewer;
  if (!document.fullscreenElement){
    el.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

/* ===================== Form: salvar / limpar / editar ===================== */
async function saveCurrentSong(){
  const title = els.title.value.trim();
  if (!title){ alert('Informe o título.'); return; }

  const pdfFile = els.pdfInput.files?.[0] || null;
  const audioFile = els.audioInput.files?.[0] || null;

  const existing = State.editingId ? await DB.getSong(State.editingId) : {};
  const song = {
    id: State.editingId || null,
    title,
    artist: els.artist.value.trim(),
    category: els.category.value,
    tags: els.tags.value.split(',').map(t=>t.trim()).filter(Boolean),
    pdfBlob: pdfFile ? await fileToBlob(pdfFile) : (existing?.pdfBlob || null),
    pdfName: pdfFile ? pdfFile.name : (existing?.pdfName || ''),
    audioBlob: audioFile ? await fileToBlob(audioFile) : (existing?.audioBlob || null),
    audioName: audioFile ? audioFile.name : (existing?.audioName || ''),
    updatedAt: Date.now(),
    createdAt: State.editingId ? existing?.createdAt ?? Date.now() : Date.now(),
  };

  // atualizar tags sugeridas
  if (song.tags?.length){
    const cur = new Set((await DB.getMeta('tags')) || []);
    song.tags.forEach(t=> cur.add(t));
    await DB.setMeta('tags', Array.from(cur).sort());
    await refreshTagsChips();
  }

  await DB.saveSong(song);
  clearForm();
  switchTab('library');
  await renderList();
}
function clearForm(){
  State.editingId = null;
  els.title.value=''; els.artist.value=''; els.tags.value='';
  els.pdfInput.value=''; els.audioInput.value='';
}
function loadSongIntoForm(song){
  closeModal();
  switchTab('create');
  State.editingId = song.id;
  els.title.value = song.title||'';
  els.artist.value = song.artist||'';
  els.category.value = song.category||'';
  els.tags.value = (song.tags||[]).join(', ');
  els.pdfInput.value=''; els.audioInput.value='';
}

/* ===================== Excluir / Download ===================== */
async function deleteCurrentSong(){
  if (!State.currentSong?.id) return;
  if (!confirm('Excluir esta música?')) return;
  await DB.deleteSong(State.currentSong.id);
  // também remover dos playlists
  await removeSongFromAllPlaylists(State.currentSong.id);
  closeModal();
  await renderList(); await renderPlaylists();
}
function downloadCurrentFiles(){
  const s = State.currentSong; if (!s) return;
  const urls = State.urls.get(s.id)||{};
  if (s.pdfBlob){
    const a = document.createElement('a');
    a.href = urls.pdfURL || URL.createObjectURL(s.pdfBlob);
    a.download = s.pdfName || (s.title.replace(/\s+/g,'_')+'.pdf'); a.click();
  }
  if (s.audioBlob){
    const a = document.createElement('a');
    a.href = urls.audioURL || URL.createObjectURL(s.audioBlob);
    const ext = (s.audioBlob.type.split('/')[1]||'mp3');
    a.download = s.audioName || (s.title.replace(/\s+/g,'_')+'.'+ext); a.click();
  }
}

/* ===================== Playlists ===================== */
async function getPlaylists(){ return (await DB.getMeta('playlists')) || []; }
async function setPlaylists(arr){ await DB.setMeta('playlists', arr); }
function newPlaylistId(){ return 'p_'+Date.now()+'_'+Math.random().toString(36).slice(2,6); }

async function renderPlaylists(){
  const pls = await getPlaylists();
  if (!pls.length){
    els.playlistList.innerHTML = `<div class="pdfhint">Nenhuma playlist. Crie uma acima.</div>`;
    return;
  }
  els.playlistList.innerHTML = pls.map(pl=> playlistItemHTML(pl)).join('');
  // binds
  els.playlistList.querySelectorAll('[data-openpl]').forEach(btn=>{
    btn.addEventListener('click', ()=> openPlaylist(btn.dataset.openpl));
  });
  els.playlistList.querySelectorAll('[data-rename]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.rename;
      const pls = await getPlaylists();
      const pl = pls.find(p=>p.id===id); if(!pl) return;
      const name = prompt('Novo nome da playlist:', pl.name);
      if (!name) return;
      pl.name = name.trim();
      await setPlaylists(pls);
      await renderPlaylists();
    });
  });
  els.playlistList.querySelectorAll('[data-delpl]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.delpl;
      if (!confirm('Excluir playlist? (As músicas permanecem salvas)')) return;
      const pls = (await getPlaylists()).filter(p=>p.id!==id);
      await setPlaylists(pls);
      await renderPlaylists();
    });
  });
}
function playlistItemHTML(pl){
  return `
  <div class="card" data-plid="${pl.id}">
    <div class="actions-row" style="justify-content:space-between">
      <div class="pill"><strong>${escapeHtml(pl.name)}</strong> <span class="count">(${pl.songIds?.length||0})</span></div>
      <div class="actions-row">
        <button class="inline" data-openpl="${pl.id}">Abrir</button>
        <button class="inline" data-rename="${pl.id}">Renomear</button>
        <button class="inline btn-danger" data-delpl="${pl.id}">Excluir</button>
      </div>
    </div>
  </div>`;
}
async function openPlaylist(id){
  const pls = await getPlaylists();
  const pl = pls.find(p=>p.id===id); if(!pl){ alert('Playlist não encontrada'); return; }
  // carregar músicas
  const all = await DB.listSongs();
  const songs = (pl.songIds||[]).map(sid => all.find(s=>s.id===sid)).filter(Boolean);
  // render simples dentro da própria card (expansível)
  const card = els.playlistList.querySelector(`[data-plid="${CSS.escape(id)}"]`);
  let html = `<ul class="list" style="margin-top:10px">`;
  if (!songs.length){
    html += `<li><div class="pdfhint">Nenhuma música nesta playlist.</div></li>`;
  } else {
    html += songs.map(s=>`
      <li data-sid="${s.id}">
        <div class="song-row">
          <div>
            <div class="song-title">${escapeHtml(s.title)}</div>
            <div class="song-meta">${escapeHtml(s.artist||'Sem artista')} • ${escapeHtml(s.category||'')}</div>
          </div>
          <div class="actions-row">
            <button class="inline" data-remove="${s.id}" data-pl="${id}">Remover</button>
            <button class="inline btn-primary" data-open-song="${s.id}">Abrir</button>
          </div>
        </div>
      </li>`).join('');
  }
  html += `</ul>`;
  // remove expansões antigas e injeta
  card.querySelector('ul')?.remove();
  card.insertAdjacentHTML('beforeend', html);
  // binds
  card.querySelectorAll('[data-open-song]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const s = await DB.getSong(b.dataset.openSong);
      openModal(s);
    });
  });
  card.querySelectorAll('[data-remove]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const sid = b.dataset.remove, pid = b.dataset.pl;
      await removeSongFromPlaylist(pid, sid);
      await openPlaylist(pid); // re-render
      await renderPlaylists(); // atualizar contagem
    });
  });
}

async function createPlaylistFromTab(){
  const name = (els.newPlaylistName.value||'').trim();
  if (!name) return;
  const pls = await getPlaylists();
  pls.push({id:newPlaylistId(), name, songIds:[]});
  await setPlaylists(pls);
  els.newPlaylistName.value='';
  await renderPlaylists();
}

/* ===== Picker (adicionar da Biblioteca) ===== */
function openPicker(songId){
  State.pickerSongId = songId;
  renderPicker();
  els.playlistPicker.style.display='flex';
}
function closePicker(){
  els.playlistPicker.style.display='none';
  State.pickerSongId = null;
}
async function renderPicker(){
  const pls = await getPlaylists();
  if (!pls.length){
    els.pickerList.innerHTML = `<div class="pdfhint">Nenhuma playlist. Crie uma acima e depois selecione.</div>`;
    return;
  }
  els.pickerList.innerHTML = pls.map(pl=>`
    <div class="actions-row" style="justify-content:space-between;margin-bottom:8px">
      <span class="pill"><strong>${escapeHtml(pl.name)}</strong> <span class="count">(${pl.songIds?.length||0})</span></span>
      <button class="inline" data-addpl="${pl.id}">Adicionar</button>
    </div>
  `).join('');
  els.pickerList.querySelectorAll('[data-addpl]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      await addSongToPlaylist(b.dataset.addpl, State.pickerSongId);
      closePicker();
      await renderPlaylists();
    });
  });
}
async function createPlaylistFromPicker(){
  const name = (els.pickerNewName.value||'').trim(); if (!name) return;
  const pls = await getPlaylists();
  const id = newPlaylistId();
  pls.push({id, name, songIds:[]});
  await setPlaylists(pls);
  els.pickerNewName.value='';
  await renderPicker();
}
async function addSongToPlaylist(playlistId, songId){
  const pls = await getPlaylists();
  const pl = pls.find(p=>p.id===playlistId); if(!pl) return;
  pl.songIds = Array.from(new Set([...(pl.songIds||[]), songId]));
  await setPlaylists(pls);
}
async function removeSongFromPlaylist(playlistId, songId){
  const pls = await getPlaylists();
  const pl = pls.find(p=>p.id===playlistId); if(!pl) return;
  pl.songIds = (pl.songIds||[]).filter(id=>id!==songId);
  await setPlaylists(pls);
}
async function removeSongFromAllPlaylists(songId){
  const pls = await getPlaylists();
  let changed = false;
  for (const pl of pls){
    const newIds = (pl.songIds||[]).filter(id=>id!==songId);
    if (newIds.length !== (pl.songIds||[]).length){ pl.songIds = newIds; changed = true; }
  }
  if (changed) await setPlaylists(pls);
}

/* ===================== Backup Import/Export ===================== */
async function exportData(includeFiles){
  const songs = await DB.listSongs();
  const cats = await DB.getMeta('categories') || [];
  const tags = await DB.getMeta('tags') || [];
  const playlists = await DB.getMeta('playlists') || [];

  const payload = {
    version: '3-pdf-audio-playlists',
    exportedAt: new Date().toISOString(),
    includeFiles: !!includeFiles,
    categories: cats, tags, playlists,
    songs: await Promise.all(songs.map(async s=>{
      const base = {
        id: s.id, title: s.title, artist: s.artist, category: s.category, tags: s.tags||[],
        createdAt: s.createdAt, updatedAt: s.updatedAt,
        pdfName: s.pdfName||'', audioName: s.audioName||''
      };
      if (includeFiles){
        base.pdfB64 = s.pdfBlob ? await blobToBase64(s.pdfBlob) : '';
        base.pdfMime = s.pdfBlob ? s.pdfBlob.type : '';
        base.audioB64 = s.audioBlob ? await blobToBase64(s.audioBlob) : '';
        base.audioMime = s.audioBlob ? s.audioBlob.type : '';
      }
      return base;
    }))
  };

  const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = includeFiles ? 'cifras_backup_com_arquivos.json' : 'cifras_backup_meta.json';
  a.click(); URL.revokeObjectURL(url);
}
async function importData(){
  const file = els.importFile.files?.[0];
  if (!file){ alert('Selecione um arquivo JSON.'); return; }
  const text = await file.text();
  let data; try{ data = JSON.parse(text); }catch(e){ alert('JSON inválido.'); return; }
  if (!data || !Array.isArray(data.songs)){ alert('Backup inválido.'); return; }

  await DB.setMeta('categories', Array.from(new Set([...(await DB.getMeta('categories')||[]), ...data.categories||[]])).sort());
  await DB.setMeta('tags', Array.from(new Set([...(await DB.getMeta('tags')||[]), ...data.tags||[]])).sort());
  if (Array.isArray(data.playlists)) await DB.setMeta('playlists', data.playlists);

  for (const s of data.songs){
    await DB.saveSong({
      id: s.id || null,
      title: s.title||'',
      artist: s.artist||'',
      category: s.category||'',
      tags: s.tags||[],
      createdAt: s.createdAt||Date.now(),
      updatedAt: s.updatedAt||Date.now(),
      pdfName: s.pdfName||'',
      audioName: s.audioName||'',
      pdfBlob: s.pdfB64 ? base64ToBlob(s.pdfB64, s.pdfMime||'application/pdf') : null,
      audioBlob: s.audioB64 ? base64ToBlob(s.audioB64, s.audioMime||'audio/mp3') : null
    });
  }
  await refreshCategories(); await refreshTagsChips(); await renderList(); await renderPlaylists();
  alert('Importação concluída!');
}

/* ===================== Utils ===================== */
const byId = id => document.getElementById(id);
function switchTab(name, btn=null){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active'); else document.querySelector(`.tabs button[data-tab="${name}"]`)?.classList.add('active');
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function fileToBlob(file){ return new Promise(res=>{ const r = new FileReader(); r.onload=()=>res(new Blob([r.result],{type:file.type||'application/octet-stream'})); r.readAsArrayBuffer(file); }); }
function blobToBase64(blob){ return new Promise((res,rej)=>{ const r = new FileReader(); r.onload=()=>res(btoa(String.fromCharCode(...new Uint8Array(r.result)))); r.onerror=rej; r.readAsArrayBuffer(blob); }); }
function base64ToBlob(b64, mime='application/octet-stream'){ const bin = atob(b64); const bytes = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i); return new Blob([bytes],{type:mime}); }
