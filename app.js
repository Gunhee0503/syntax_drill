/* PIF 구문 드릴 — 선생님용 (1차)
 * 데이터: Supabase beacon-syntax 의 drill_* 테이블, 음성: drill-audio 버킷, 서버 기능: Edge Function `drill`
 */
(() => {
'use strict';

const SB_URL = 'https://kyboczqmdrjkubklajtb.supabase.co';  // Supabase 프로젝트: syntax-drill (허브와 분리)
const SB_KEY = 'sb_publishable_ftGo0kcR3GjcT6UM4giMxA_6Ca5qahQ';
const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pif-drill-auth' } });

const VOICES = {
  en: [
    ['XrExE9yKIg1WjnnlVkGX', 'Matilda — 미국 여성, 또렷한 강의 톤 (기본)'],
    ['xGlGKBuNUZYW7Vx2RHol', 'Alex — 미국 남성, 이러닝 강사'],
    ['hpp4J3VqNfWAUOO0d1Us', 'Bella — 미국 여성, 밝고 따뜻함'],
    ['onwK4e9ZLuTAKqWW03F9', 'Daniel — 영국 남성, 방송 톤'],
    ['Xb7hH8MSUJpSbSDYk0k2', 'Alice — 영국 여성, 교육용'],
  ],
  ko: [
    ['H9ihk5yaEtJLXjhBgRaF', 'Jay Lee — 남성, 차분한 교육용 (기본)'],
    ['6ZPN1uE51vVTtd32NM3q', '30대 한국 남성 — 밝고 또렷함'],
    ['6uV2tbeVbmthVHTl9Pko', '이건희 — 내 목소리 (복제)'],
  ],
};

/* ---------- 작은 도구 ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const natural = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true });
const store = {
  get(k, d) { try { const v = localStorage.getItem('drill:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('drill:' + k, JSON.stringify(v)); } catch { /* 없음 */ } },
};
let toastT = 0;
function toast(msg, err) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast on' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast' + (err ? ' err' : ''); }, err ? 5200 : 2600);
}
const ERR = {
  'User already registered': '이미 가입된 이메일이에요. 로그인해 주세요.',
  'Password should be': '비밀번호는 8자 이상으로 해 주세요.',
  NO_ELEVENLABS_KEY: '일레븐랩스 API 키가 아직 등록되지 않았어요. Supabase에 ELEVENLABS_API_KEY를 등록해 주세요.',
  NO_ANTHROPIC_KEY: 'AI 초안 기능의 키가 없어요. 직접 끊기로 입력해 주세요.',
  NOT_STAFF: '선생님 계정만 쓸 수 있어요.',
  TOO_LONG: '문장이 너무 길어요 (900자 이하).',
  EMPTY: '내용이 비어 있어요.',
  AI_UPSTREAM: 'AI 응답을 받지 못했어요. 잠시 뒤 다시 해 주세요.',
  BAD_AI_OUTPUT: 'AI 응답을 읽지 못했어요. 다시 해 주세요.',
  'Invalid login credentials': '이메일 또는 비밀번호가 맞지 않아요.',
  'Email not confirmed': '이메일 인증이 아직 안 됐어요. 메일함의 확인 링크를 눌러 주세요.',
};
function errText(e) {
  const m = String(e && (e.message || e) || '오류');
  for (const k in ERR) if (m.includes(k)) return ERR[k];
  if (/ELEVENLABS_401/.test(m)) return '일레븐랩스 키가 올바르지 않아요. 키를 다시 등록해 주세요.';
  if (/ELEVENLABS_402|quota|credits/i.test(m)) return '일레븐랩스 크레딧이 부족해요.';
  if (/ELEVENLABS_4/.test(m)) return '일레븐랩스 요청 오류: ' + m.slice(0, 160);
  if (/Failed to fetch|NetworkError/i.test(m)) return '인터넷 연결을 확인해 주세요.';
  return m.slice(0, 200);
}
async function fn(op, body = {}) {
  const { data, error } = await sb.functions.invoke('drill', { body: { op, ...body } });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = (j.error || msg) + (j.detail ? ': ' + j.detail : ''); } catch { /* 본문 없음 */ }
    throw new Error(msg);
  }
  return data;
}

/* ---------- 데이터 ---------- */
const D = { cats: [], sents: [], lessons: [], voices: { en: VOICES.en[0][0], ko: VOICES.ko[0][0] }, num: null };
const byId = (id) => D.sents.find((s) => s.id === id);
function sortSents(a) {
  return a.sort((x, y) => {
    if (x.category !== y.category) {
      if (x.category == null) return 1;
      if (y.category == null) return -1;
      return natural(x.category, y.category);
    }
    return (x.position - y.position) || String(x.created_at).localeCompare(String(y.created_at));
  });
}
async function loadAll() {
  const [c, s, l, v] = await Promise.all([
    sb.from('drill_categories').select('*'),
    sb.from('drill_sentences').select('*'),
    sb.from('drill_lessons').select('*').order('lesson_date', { ascending: false }).order('created_at', { ascending: false }),
    sb.from('drill_settings').select('value').eq('key', 'voices').maybeSingle(),
  ]);
  for (const r of [c, s, l]) if (r.error) throw r.error;
  D.cats = c.data.sort((a, b) => natural(a.code, b.code));
  D.sents = sortSents(s.data);
  D.lessons = l.data;
  if (v.data && v.data.value) D.voices = { ...D.voices, ...v.data.value };
}
function audioState(s) {
  if (L.busy.has(s.id)) return 'busy';
  if (!s.audio_en) return 'need';
  if (!s.audio_key) return 'stale';
  return 'ready';
}
const AU_LABEL = { ready: '음성 있음', need: '음성 없음', stale: '문장 바뀜', busy: '만드는 중…' };
const chunksOf = (s) => (s.chunks || []).filter((c) => String(c.en || '').trim());
const enLine = (s) => chunksOf(s).map((c) => c.en).join(' / ');
const koLine = (s) => chunksOf(s).map((c) => c.ko || '').join(' / ');

/* ---------- 로그인 ---------- */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session || session.user.is_anonymous) return showGate();
  const { data: ok, error } = await sb.rpc('is_staff');
  if (error || ok !== true) {
    await sb.auth.signOut();
    return showGate('선생님으로 등록된 이메일이 아니에요. 원장님께 설정 → 선생님 계정에서 이메일 등록을 요청하세요.');
  }
  $('meEmail').textContent = session.user.email || '';
  $('gate').hidden = true; $('app').hidden = false;
  try { await loadAll(); } catch (e) { toast('불러오기 실패: ' + errText(e), true); }
  restoreClass();
  renderLib(); renderPl(); renderStage();
  switchTab(store.get('tab', 'lib'));
}
function showGate(msg) {
  $('app').hidden = true; $('gate').hidden = false;
  $('loginMsg').className = 'msg'; $('loginMsg').textContent = msg || '';
}
$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  $('loginMsg').textContent = ''; $('go').disabled = true;
  try {
    const { error } = await sb.auth.signInWithPassword({ email: $('em').value.trim(), password: $('pw').value });
    if (error) throw error;
    await boot();
  } catch (err) { $('loginMsg').textContent = errText(err); }
  $('go').disabled = false;
};
$('signup').onclick = async () => {
  const email = $('em').value.trim().toLowerCase(), password = $('pw').value;
  $('loginMsg').className = 'msg';
  if (!email || password.length < 8) { $('loginMsg').textContent = '이메일과 8자 이상 비밀번호를 입력한 뒤 눌러 주세요.'; return; }
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) { $('loginMsg').textContent = errText(error); return; }
  if (data.session) return boot();
  $('loginMsg').className = 'msg ok';
  $('loginMsg').textContent = '메일함에서 확인 링크를 눌러 주세요. 링크를 누른 뒤 이 화면에서 로그인하면 됩니다.';
};
$('reset').onclick = async () => {
  const email = $('em').value.trim();
  $('loginMsg').className = 'msg';
  if (!email) { $('loginMsg').textContent = '이메일을 먼저 입력해 주세요.'; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) { $('loginMsg').textContent = errText(error); return; }
  $('loginMsg').className = 'msg ok'; $('loginMsg').textContent = '비밀번호 재설정 메일을 보냈어요.';
};
$('logout').onclick = async () => { stop(); await sb.auth.signOut(); showGate(); };

/* ---------- 탭 ---------- */
function switchTab(t) {
  if (!['lib', 'class', 'set'].includes(t)) t = 'lib';
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  $('tab-lib').hidden = t !== 'lib'; $('tab-class').hidden = t !== 'class'; $('tab-set').hidden = t !== 'set';
  if (t !== 'class') stop();
  if (t === 'set') renderSettings();
  store.set('tab', t);
}
$('tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); };

/* =========================================================
 *  문장 관리
 * ========================================================= */
const L = { cat: '', q: '', tag: '', audio: '', star: false, sel: new Set(), busy: new Set() };

function renderCats() {
  const count = (code) => D.sents.filter((s) => s.category === code).length;
  const none = D.sents.filter((s) => !s.category).length;
  let h = `<li class="${L.cat === '' ? 'on' : ''}" data-c=""><span class="code">전체</span><span class="ttl"></span><span class="n">${D.sents.length}</span></li>`;
  for (const c of D.cats) {
    h += `<li class="${L.cat === c.code ? 'on' : ''}" data-c="${esc(c.code)}"><span class="code">${esc(c.code)}</span><span class="ttl">${esc(c.title || '')}</span><span class="n">${count(c.code)}</span><button class="ed" data-edcat="${esc(c.code)}" title="카테고리 수정">✎</button></li>`;
  }
  if (none) h += `<li class="${L.cat === '__none' ? 'on' : ''}" data-c="__none"><span class="code">–</span><span class="ttl">미분류</span><span class="n">${none}</span></li>`;
  $('catList').innerHTML = h;
}
$('catList').onclick = (e) => {
  const ed = e.target.closest('[data-edcat]');
  if (ed) { e.stopPropagation(); return editCat(ed.dataset.edcat); }
  const li = e.target.closest('li'); if (!li) return;
  L.cat = li.dataset.c; renderLib();
};
$('catAddBtn').onclick = () => { $('catAdd').hidden = !$('catAdd').hidden; if (!$('catAdd').hidden) $('catCode').focus(); };
$('catCancel').onclick = () => { $('catAdd').hidden = true; };
$('catAdd').onsubmit = async (e) => {
  e.preventDefault();
  const code = $('catCode').value.trim(), title = $('catTitle').value.trim();
  if (!code) return;
  if (D.cats.some((c) => c.code === code)) return toast('이미 있는 번호예요.', true);
  const { data, error } = await sb.from('drill_categories').insert({ code, title: title || null }).select().single();
  if (error) return toast(errText(error), true);
  D.cats.push(data); D.cats.sort((a, b) => natural(a.code, b.code));
  $('catCode').value = ''; $('catTitle').value = ''; $('catAdd').hidden = true;
  L.cat = code; renderLib(); toast(`카테고리 ${code}를 만들었어요.`);
};
async function addCategoryInline(code, title) {
  if (!code || D.cats.some((c) => c.code === code)) return true;
  const { data, error } = await sb.from('drill_categories').insert({ code, title: title || null }).select().single();
  if (error) { toast(errText(error), true); return false; }
  D.cats.push(data); D.cats.sort((a, b) => natural(a.code, b.code));
  return true;
}
function editCat(code) {
  const c = D.cats.find((x) => x.code === code); if (!c) return;
  openModal(`
    <div class="mh"><h3>카테고리 ${esc(code)}</h3><button class="icon" data-close>✕</button></div>
    <div class="mb">
      <label>번호<input id="ecCode" value="${esc(c.code)}" maxlength="20"></label>
      <label>이름<input id="ecTitle" value="${esc(c.title || '')}" maxlength="40"></label>
      <p class="hint">삭제하면 이 카테고리의 문장은 지워지지 않고 '미분류'로 옮겨져요.</p>
    </div>
    <div class="mf"><button class="btn danger" id="ecDel">삭제</button><span class="grow"></span><button class="btn ghost" data-close>취소</button><button class="btn primary" id="ecSave">저장</button></div>`, 'sm');
  $('ecSave').onclick = async () => {
    const nc = $('ecCode').value.trim(), nt = $('ecTitle').value.trim();
    if (!nc) return;
    if (nc !== code && D.cats.some((x) => x.code === nc)) return toast('이미 있는 번호예요.', true);
    const { error } = await sb.from('drill_categories').update({ code: nc, title: nt || null }).eq('code', code);
    if (error) return toast(errText(error), true);
    c.code = nc; c.title = nt || null;
    D.sents.forEach((s) => { if (s.category === code) s.category = nc; });
    D.cats.sort((a, b) => natural(a.code, b.code)); sortSents(D.sents);
    if (L.cat === code) L.cat = nc;
    closeModal(); renderLib(); renderPl(); renderStage();
  };
  $('ecDel').onclick = async () => {
    if (!await confirmBox('카테고리 삭제', `${code} 카테고리를 지울까요? 문장은 미분류로 남아요.`, '삭제', true)) return;
    const { error } = await sb.from('drill_categories').delete().eq('code', code);
    if (error) return toast(errText(error), true);
    D.cats = D.cats.filter((x) => x.code !== code);
    D.sents.forEach((s) => { if (s.category === code) s.category = null; });
    sortSents(D.sents); if (L.cat === code) L.cat = '';
    renderLib();
  };
}

function filtered() {
  const q = L.q.toLowerCase();
  return D.sents.filter((s) => {
    if (L.cat === '__none' ? s.category : (L.cat && s.category !== L.cat)) return false;
    if (L.star && !s.starred) return false;
    if (L.tag && !(s.tags || []).includes(L.tag)) return false;
    if (L.audio) { const a = audioState(s); if (L.audio === 'ready' ? a !== 'ready' : a === 'ready') return false; }
    if (q) {
      const hay = (s.text + ' ' + koLine(s) + ' ' + (s.memo || '') + ' ' + (s.tags || []).join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
function renderTagFilter() {
  const tags = [...new Set(D.sents.flatMap((s) => s.tags || []))].sort(natural);
  const cur = L.tag;
  $('tagFilter').innerHTML = '<option value="">모든 태그</option>' + tags.map((t) => `<option ${t === cur ? 'selected' : ''}>${esc(t)}</option>`).join('');
  if (cur && !tags.includes(cur)) L.tag = '';
}
function sentHtml(s, no) {
  const ch = chunksOf(s);
  const sl = '<span class="sl">/</span>';
  const en = ch.map((c) => esc(c.en)).join(sl);
  const hasKo = ch.some((c) => c.ko);
  const ko = hasKo ? ch.map((c) => esc(c.ko || '…')).join(sl) : '';
  const a = audioState(s);
  const canMove = L.cat && L.cat !== '__none' && !L.q && !L.tag && !L.star && !L.audio;
  return `<div class="sent ${L.sel.has(s.id) ? 'sel' : ''}" data-id="${s.id}">
    <input type="checkbox" data-a="sel" ${L.sel.has(s.id) ? 'checked' : ''} aria-label="선택">
    <div class="no">${no}</div>
    <div class="body">
      <div class="en">${en}</div>
      ${ko ? `<div class="ko">${ko}</div>` : ''}
      <div class="tags">${s.category ? `<span class="tag cat">${esc(s.category)}</span>` : ''}${(s.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
      ${s.memo ? `<div class="memo">${esc(s.memo)}</div>` : ''}
    </div>
    <div class="act">
      <span class="au ${a}">${AU_LABEL[a]}</span>
      ${s.audio_en ? '<button class="icon" data-a="play" title="들어보기">▶︎</button>' : ''}
      <button class="icon" data-a="tts" title="${a === 'ready' ? '음성 다시 만들기' : '음성 만들기'}">↻</button>
      <button class="icon star ${s.starred ? 'on' : ''}" data-a="star" title="별표">★</button>
      <button class="icon" data-a="edit" title="수정">✎</button>
      ${canMove ? '<button class="icon" data-a="up" title="위로">↑</button><button class="icon" data-a="down" title="아래로">↓</button>' : ''}
      <button class="icon" data-a="del" title="삭제">✕</button>
    </div>
  </div>`;
}
function renderLib() {
  renderCats(); renderTagFilter();
  const list = filtered();
  $('starFilter').setAttribute('aria-pressed', L.star ? 'true' : 'false');
  let h = '';
  if (!list.length) {
    h = D.sents.length
      ? '<div class="empty">조건에 맞는 문장이 없어요.</div>'
      : '<div class="empty">아직 문장이 없어요.<br><b>+ 새 문장</b>을 눌러 수업할 문장을 붙여넣으세요.<br><span class="small">카테고리(예: 1-1)를 먼저 만들어 두면 정리하기 좋아요.</span></div>';
  } else {
    const groups = L.cat === '' && !L.q;
    let last = Symbol('x'), n = 0;
    for (const s of list) {
      if (s.category !== last) {
        last = s.category; n = 0;
        if (groups) {
          const c = D.cats.find((x) => x.code === s.category);
          h += `<div class="group-h">${s.category ? esc(s.category) : '미분류'} <span>${c && c.title ? esc(c.title) : ''}</span></div>`;
        }
      }
      n++;
      h += sentHtml(s, n);
    }
  }
  $('sentList').innerHTML = h;
  renderSelbar();
}
function renderSelbar() {
  for (const id of [...L.sel]) if (!byId(id)) L.sel.delete(id);
  $('selbar').hidden = !L.sel.size;
  $('selCount').textContent = `${L.sel.size}개 선택`;
}
$('q').oninput = (e) => { L.q = e.target.value.trim(); renderLib(); };
$('tagFilter').onchange = (e) => { L.tag = e.target.value; renderLib(); };
$('audioFilter').onchange = (e) => { L.audio = e.target.value; renderLib(); };
$('starFilter').onclick = () => { L.star = !L.star; renderLib(); };
$('newBtn').onclick = () => openEditor(null);
$('selAll').onclick = () => { filtered().forEach((s) => L.sel.add(s.id)); renderLib(); };
$('selClear').onclick = () => { L.sel.clear(); renderLib(); };
$('selToClass').onclick = () => {
  const ids = D.sents.filter((s) => L.sel.has(s.id)).map((s) => s.id);
  addToPlaylist(ids, C.list.length ? 'ask' : 'replace');
};
$('selTts').onclick = () => makeAudio(D.sents.filter((s) => L.sel.has(s.id)).map((s) => s.id), true);
$('selMove').onclick = () => {
  openModal(`
    <div class="mh"><h3>카테고리 옮기기</h3><button class="icon" data-close>✕</button></div>
    <div class="mb"><label>옮길 카테고리<select id="mvCat"><option value="">미분류</option>${D.cats.map((c) => `<option value="${esc(c.code)}">${esc(c.code)} ${esc(c.title || '')}</option>`).join('')}</select></label></div>
    <div class="mf"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="mvGo">${L.sel.size}개 옮기기</button></div>`, 'sm');
  $('mvGo').onclick = async () => {
    const cat = $('mvCat').value || null;
    let pos = maxPos(cat);
    const ids = D.sents.filter((s) => L.sel.has(s.id)).map((s) => s.id);
    for (const id of ids) {
      pos++;
      const { error } = await sb.from('drill_sentences').update({ category: cat, position: pos }).eq('id', id);
      if (error) { toast(errText(error), true); break; }
      Object.assign(byId(id), { category: cat, position: pos });
    }
    sortSents(D.sents); closeModal(); L.sel.clear(); renderLib(); renderPl();
  };
};
const maxPos = (cat) => D.sents.filter((s) => s.category === cat).reduce((m, s) => Math.max(m, s.position), -1);

$('sentList').onclick = async (e) => {
  const el = e.target.closest('[data-a]'); const row = e.target.closest('.sent');
  if (!row) return;
  const id = row.dataset.id, s = byId(id); if (!s) return;
  const a = el ? el.dataset.a : null;
  if (a === 'sel' || (!a && !e.target.closest('button'))) {
    if (L.sel.has(id)) L.sel.delete(id); else L.sel.add(id);
    row.classList.toggle('sel', L.sel.has(id));
    row.querySelector('input[type=checkbox]').checked = L.sel.has(id);
    renderSelbar(); return;
  }
  if (a === 'play') return preview(s);
  if (a === 'tts') return makeAudio([id], true, audioState(s) === 'ready');
  if (a === 'edit') return openEditor(s);
  if (a === 'star') {
    const v = !s.starred;
    const { error } = await sb.from('drill_sentences').update({ starred: v }).eq('id', id);
    if (error) return toast(errText(error), true);
    s.starred = v; renderLib(); return;
  }
  if (a === 'del') {
    if (!await confirmBox('문장 삭제', `"${s.text.slice(0, 80)}" 문장을 지울까요? 만든 음성도 함께 사라져요.`, '삭제', true)) return;
    const { error } = await sb.from('drill_sentences').delete().eq('id', id);
    if (error) return toast(errText(error), true);
    D.sents = D.sents.filter((x) => x.id !== id); L.sel.delete(id);
    C.list = C.list.filter((x) => x !== id); saveClass();
    renderLib(); renderPl(); renderStage(); return;
  }
  if (a === 'up' || a === 'down') return moveSent(s, a === 'up' ? -1 : 1);
};
async function moveSent(s, dir) {
  const group = D.sents.filter((x) => x.category === s.category);
  const i = group.indexOf(s), j = i + dir;
  if (j < 0 || j >= group.length) return;
  [group[i], group[j]] = [group[j], group[i]];
  const changes = [];
  group.forEach((x, k) => { if (x.position !== k) { x.position = k; changes.push(x); } });
  sortSents(D.sents); renderLib();
  for (const x of changes) {
    const { error } = await sb.from('drill_sentences').update({ position: x.position }).eq('id', x.id);
    if (error) { toast(errText(error), true); break; }
  }
}

/* ---------- 음성 만들기 ---------- */
let ttsRunning = false;
async function makeAudio(ids, announce, force) {
  ids = ids.filter((id) => byId(id) && chunksOf(byId(id)).length);
  if (!ids.length) return;
  if (ttsRunning) { ids.forEach((id) => ttsQueue.push(id)); ids.forEach((id) => L.busy.add(id)); renderLib(); return; }
  ttsRunning = true;
  ttsQueue.push(...ids); ids.forEach((id) => L.busy.add(id)); renderLib();
  let done = 0, fail = null;
  while (ttsQueue.length) {
    const id = ttsQueue.shift();
    try {
      const r = await fn('tts', { id, force: !!force });
      const s = byId(id);
      if (s && Array.isArray(r.chunks)) s.chunks = r.chunks;
      if (s) Object.assign(s, { audio_en: r.audio_en, times_en: r.times_en, audio_ko: r.audio_ko, times_ko: r.times_ko, audio_key: r.audio_key || s.audio_key || 'ok', voice_en: r.voice_en || s.voice_en, voice_ko: r.voice_ko || s.voice_ko });
      done++;
    } catch (e) {
      fail = e;
      if (/NO_ELEVENLABS_KEY|ELEVENLABS_401|ELEVENLABS_402|NOT_STAFF/.test(String(e.message))) { ttsQueue.forEach((x) => L.busy.delete(x)); ttsQueue.length = 0; }
    }
    L.busy.delete(id);
    renderLib(); renderPl();
    if (curSent() && curSent().id === id) renderStage();
  }
  ttsRunning = false;
  if (fail) toast(errText(fail), true);
  else if (announce) toast(done > 1 ? `음성 ${done}개를 만들었어요.` : '음성을 만들었어요.');
  return done;
}
const ttsQueue = [];

/* ---------- 문장 편집 ---------- */
// 끊어 둔 영어 의미구 → 같은 개수의 우리말 (실패하면 null)
async function translate(en) {
  try { const r = await fn('translate', { chunks: en }); return Array.isArray(r.ko) && r.ko.length === en.length ? r.ko : null; }
  catch (e) { toast(errText(e), true); return null; }
}
function splitSlash(s) { return String(s || '').split('/').map((x) => x.trim()); }
function draftFrom(s) {
  return { id: s ? s.id : null, en: s ? enLine(s) : '', ko: s ? koLine(s) : '', tags: s ? (s.tags || []).join(', ') : '', memo: s ? s.memo || '' : '' };
}
function checkDraft(d) {
  const en = splitSlash(d.en).filter(Boolean);
  const koRaw = splitSlash(d.ko);
  const ko = d.ko.trim() ? koRaw : [];
  let warn = '';
  if (!en.length) warn = '영어 문장을 입력해 주세요.';
  else if (ko.length > en.length) warn = `우리말이 ${ko.length}개로 영어 의미구(${en.length}개)보다 많아요. '/' 개수를 맞춰 주세요.`;
  else if (ko.length && ko.length < en.length) warn = `우리말이 ${ko.length}개, 영어가 ${en.length}개예요. 비어 있는 의미구는 말하기 드릴에서 건너뜁니다.`;
  else if (!ko.length) warn = '우리말 뜻이 없으면 말하기 드릴·직독직해를 할 수 없어요.';
  const chunks = en.map((e, i) => ({ en: e, ko: (ko[i] || '').trim() }));
  const block = !en.length || ko.length > en.length;
  return { chunks, warn, block };
}
function openEditor(s) {
  const isNew = !s;
  let drafts = isNew ? [] : [draftFrom(s)];
  const catOpts = (sel) => `<option value="">미분류</option>${D.cats.map((c) => `<option value="${esc(c.code)}" ${c.code === sel ? 'selected' : ''}>${esc(c.code)} ${esc(c.title || '')}</option>`).join('')}<option value="__new">+ 새 카테고리…</option>`;
  const defCat = s ? (s.category || '') : (L.cat && L.cat !== '__none' ? L.cat : (store.get('lastCat', '') || ''));
  openModal(`
    <div class="mh"><h3>${isNew ? '새 문장 추가' : '문장 수정'}</h3><button class="icon" data-close>✕</button></div>
    <div class="mb">
      <div class="ed-top">
        <label>카테고리<select id="edCat">${catOpts(defCat)}</select></label>
        <div id="edNewCat" hidden><label>새 카테고리 번호<input id="edNewCode" placeholder="예: 2-3" maxlength="20"></label></div>
      </div>
      ${isNew ? `<div class="ed-paste">
        <label>문장 붙여넣기 <span class="small">— 한 줄에 한 문장. 왼쪽 버튼은 '/'로 끊은 그대로 의미구마다 우리말을 붙이고, 오른쪽 버튼은 끊기부터 자동으로 해요. 결과는 아래에서 고칠 수 있어요.</span>
          <textarea id="edPaste" placeholder="The students who studied hard passed the exam.&#10;It is important / that we keep our promises."></textarea></label>
        <div class="row">
          <button class="btn primary" id="edDirect" title="'/'로 끊은 그대로, 의미구마다 우리말 뜻을 자동으로 붙여요">끊은 문장 넣기 (우리말 자동 번역)</button>
          <button class="btn" id="edAi" title="끊기부터 AI가 하고 우리말도 붙여요">문장 넣기 (자동 끊기·번역)</button>
          <span class="small" id="edAiMsg"></span>
        </div>
      </div>` : ''}
      <div class="ed-items" id="edItems"></div>
    </div>
    <div class="mf">
      <p class="msg" id="edMsg"></p>
      <label class="chk" style="color:var(--ink2)"><input type="checkbox" id="edTts" checked> 저장하고 바로 음성 만들기</label>
      <button class="btn ghost" data-close>취소</button>
      <button class="btn primary" id="edSave">저장</button>
    </div>`);
  const draw = () => {
    $('edItems').innerHTML = drafts.map((d, i) => {
      const r = checkDraft(d);
      return `<div class="ed-item" data-i="${i}">
        <div class="ih">${isNew ? `문장 ${i + 1}` : ''}<span class="grow"></span>
          <button class="btn ghost sm" data-x="tr" title="지금 끊은 그대로 우리말만 다시 번역">우리말 다시 번역</button>
          <button class="btn ghost sm" data-x="ai" title="의미구 끊기부터 다시">AI로 다시 끊기</button>
          ${isNew ? '<button class="icon" data-x="rm" title="빼기">✕</button>' : ''}</div>
        <label>영어 <span class="small">의미구는 / 로 끊기</span><input class="en" data-f="en" value="${esc(d.en)}"></label>
        <label>우리말 뜻 <span class="small">영어와 같은 개수로 / 로 끊기</span><input class="ko" data-f="ko" value="${esc(d.ko)}"></label>
        <div class="pairs">${r.chunks.map((c) => `<div class="pair ${c.ko ? '' : 'miss'}"><b>${esc(c.en)}</b><i>${esc(c.ko || '뜻 없음')}</i></div>`).join('')}</div>
        ${r.warn ? `<div class="warn">${esc(r.warn)}</div>` : ''}
        <div class="two">
          <label>태그 <span class="small">쉼표로 구분 (예: 관계대명사, 분사구문)</span><input data-f="tags" value="${esc(d.tags)}"></label>
          <label>출제 포인트 메모<input data-f="memo" value="${esc(d.memo)}" placeholder="예: who → 주격 관계대명사, 동사 수일치"></label>
        </div>
      </div>`;
    }).join('') || '<p class="small" style="text-align:center;padding:16px 0">문장을 붙여넣고 위 버튼을 눌러 주세요.</p>';
  };
  const redrawPairs = (i) => {
    const box = $('edItems').querySelector(`.ed-item[data-i="${i}"]`); if (!box) return;
    const r = checkDraft(drafts[i]);
    box.querySelector('.pairs').innerHTML = r.chunks.map((c) => `<div class="pair ${c.ko ? '' : 'miss'}"><b>${esc(c.en)}</b><i>${esc(c.ko || '뜻 없음')}</i></div>`).join('');
    let w = box.querySelector('.warn');
    if (r.warn) { if (!w) { w = document.createElement('div'); w.className = 'warn'; box.querySelector('.pairs').after(w); } w.textContent = r.warn; } else if (w) w.remove();
  };
  draw();
  $('edCat').onchange = () => { $('edNewCat').hidden = $('edCat').value !== '__new'; if ($('edCat').value === '__new') $('edNewCode').focus(); };
  $('edItems').oninput = (e) => {
    const f = e.target.dataset.f; const box = e.target.closest('.ed-item'); if (!f || !box) return;
    const i = +box.dataset.i; drafts[i][f] = e.target.value;
    if (f === 'en' || f === 'ko') redrawPairs(i);
  };
  // lines: 영어 문장들. '/'로 끊은 문장은 그 끊기 그대로 의미구별 번역만 받고(translate),
  // 안 끊은 문장만 AI가 끊기부터 함(ai)
  const runAi = async (lines, btn, label) => {
    if (btn) { btn.disabled = true; }
    const msg = $('edAiMsg'); if (msg) msg.textContent = label || '의미구별로 우리말을 옮기는 중…';
    try {
      const out = lines.map(() => null);
      const cut = [], whole = [];
      lines.forEach((l, k) => (l.includes('/') ? cut : whole).push(k));
      const jobs = cut.map(async (k) => {
        const en = splitSlash(lines[k]).filter(Boolean);
        const ko = await translate(en);
        out[k] = { en: en.join(' / '), ko: ko ? ko.join(' / ') : '', tags: '' };
      });
      if (whole.length) jobs.push((async () => {
        const r = await fn('ai', { lines: whole.map((k) => lines[k]) });
        const items = r.items || [];
        whole.forEach((k, n) => {
          const it = items.find((x) => x.no === n + 1) || items[n];
          if (it && it.chunks.length) out[k] = { en: it.chunks.map((c) => c.en).join(' / '), ko: it.chunks.map((c) => c.ko).join(' / '), tags: (it.tags || []).join(', ') };
        });
      })());
      await Promise.all(jobs);
      return out;
    } catch (e) { toast(errText(e), true); return null; }
    finally { if (btn) btn.disabled = false; if (msg) msg.textContent = ''; }
  };
  $('edItems').onclick = async (e) => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    const i = +b.closest('.ed-item').dataset.i;
    if (b.dataset.x === 'rm') { drafts.splice(i, 1); draw(); return; }
    if (b.dataset.x === 'tr') {
      const en = splitSlash(drafts[i].en).filter(Boolean); if (!en.length) return;
      b.disabled = true; const ko = await translate(en); b.disabled = false;
      if (ko) { drafts[i].en = en.join(' / '); drafts[i].ko = ko.join(' / '); draw(); }
      return;
    }
    if (b.dataset.x === 'ai') {
      const parts = splitSlash(drafts[i].en).filter(Boolean);
      if (!parts.length) return;
      const line = b.dataset.x === 'tr' ? parts.join(' / ') + (parts.length === 1 ? ' /' : '') : parts.join(' ');
      const out = await runAi([line], b, b.dataset.x === 'tr' ? '우리말로 옮기는 중…' : '');
      if (out && out[0]) {
        const keep = b.dataset.x === 'tr' ? { en: parts.join(' / ') } : {};
        drafts[i] = { ...drafts[i], en: out[0].en, ko: out[0].ko, ...keep, tags: drafts[i].tags || out[0].tags }; draw();
      }
    }
  };
  if (isNew) {
    const lines = () => $('edPaste').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
    $('edAi').onclick = async () => {
      const ls = lines(); if (!ls.length) return toast('문장을 먼저 붙여넣어 주세요.', true);
      // 오른쪽 버튼: '/'가 있어도 무시하고 AI가 처음부터 끊음
      const out = await runAi(ls.map((l) => splitSlash(l).filter(Boolean).join(' ')), $('edAi'), '의미구를 끊고 우리말로 옮기는 중…');
      if (!out) return;
      drafts = drafts.concat(ls.map((l, k) => out[k] ? { id: null, memo: '', ...out[k] } : { id: null, en: l, ko: '', tags: '', memo: '' }));
      if (out.some((x) => !x)) toast('일부 문장은 자동 번역을 못 했어요. 저장할 때 다시 시도합니다.', true);
      $('edPaste').value = ''; draw();
    };
    // 왼쪽 버튼: 선생님이 '/'로 끊은 그대로, 의미구마다 우리말 번역
    $('edDirect').onclick = async () => {
      const ls = lines(); if (!ls.length) return toast('문장을 먼저 붙여넣어 주세요.', true);
      const btn = $('edDirect'); btn.disabled = true; $('edAi').disabled = true;
      $('edAiMsg').textContent = '끊은 의미구마다 우리말로 옮기는 중…';
      const res = await Promise.all(ls.map(async (l) => {
        const en = splitSlash(l).filter(Boolean);
        const ko = await translate(en);
        return { id: null, en: en.join(' / '), ko: ko ? ko.join(' / ') : '', tags: '', memo: '' };
      }));
      btn.disabled = false; $('edAi').disabled = false; $('edAiMsg').textContent = '';
      drafts = drafts.concat(res);
      if (res.some((d) => !d.ko)) toast('일부 문장은 번역을 못 했어요. 저장할 때 한 번 더 시도합니다.', true);
      $('edPaste').value = ''; draw();
    };
    setTimeout(() => $('edPaste').focus(), 30);
  }
  $('edSave').onclick = async () => {
    $('edMsg').textContent = '';
    if (!drafts.length) return ($('edMsg').textContent = '저장할 문장이 없어요.');
    // 우리말이 빈 의미구는 저장 전에 자동 번역 (끊기는 그대로). 실패해도 저장하고, 음성 만들 때 서버가 다시 채움
    const needKo = drafts.map((d, i) => {
      const en = splitSlash(d.en).filter(Boolean), ko = d.ko.trim() ? splitSlash(d.ko) : [];
      return en.length && en.some((_, k) => !(ko[k] || '').trim()) ? i : -1;
    }).filter((i) => i >= 0);
    if (needKo.length) {
      $('edSave').disabled = true; $('edMsg').className = 'msg ok'; $('edMsg').textContent = '우리말 뜻을 자동으로 채우는 중…';
      await Promise.all(needKo.map(async (i) => {
        const en = splitSlash(drafts[i].en).filter(Boolean);
        const ko = await translate(en);
        if (ko) { const cur = drafts[i].ko.trim() ? splitSlash(drafts[i].ko) : []; drafts[i].ko = en.map((_, k) => (cur[k] || '').trim() || ko[k]).join(' / '); }
      }));
      $('edSave').disabled = false; $('edMsg').className = 'msg'; $('edMsg').textContent = '';
    }
    const checked = drafts.map(checkDraft);
    const bad = checked.findIndex((r) => r.block);
    if (bad >= 0) return ($('edMsg').textContent = `문장 ${bad + 1}: ${checked[bad].warn}`);
    let cat = $('edCat').value || null;
    if (cat === '__new') {
      cat = $('edNewCode').value.trim();
      if (!cat) return ($('edMsg').textContent = '새 카테고리 번호를 입력해 주세요.');
      if (!await addCategoryInline(cat)) return;
    }
    store.set('lastCat', cat || '');
    const tagsOf = (t) => [...new Set(String(t || '').split(/[,#]/).map((x) => x.trim()).filter(Boolean))].slice(0, 8);
    $('edSave').disabled = true;
    const toTts = [];
    try {
      if (isNew) {
        let pos = maxPos(cat);
        const rows = drafts.map((d, i) => ({ category: cat, position: ++pos, chunks: checked[i].chunks, text: checked[i].chunks.map((c) => c.en).join(' '), tags: tagsOf(d.tags), memo: d.memo.trim() || null }));
        const { data, error } = await sb.from('drill_sentences').insert(rows).select();
        if (error) throw error;
        D.sents.push(...data); data.forEach((r) => toTts.push(r.id));
      } else {
        const d = drafts[0], r = checked[0];
        const changed = JSON.stringify(r.chunks) !== JSON.stringify(chunksOf(s).map((c) => ({ en: c.en, ko: c.ko || '' })));
        const upd = { category: cat, chunks: r.chunks, text: r.chunks.map((c) => c.en).join(' '), tags: tagsOf(d.tags), memo: d.memo.trim() || null };
        if (cat !== s.category) upd.position = maxPos(cat) + 1;
        if (changed) upd.audio_key = null;
        const { error } = await sb.from('drill_sentences').update(upd).eq('id', s.id);
        if (error) throw error;
        Object.assign(s, upd);
        if (changed || !s.audio_en) toTts.push(s.id);
      }
    } catch (e) { $('edSave').disabled = false; return ($('edMsg').textContent = errText(e)); }
    sortSents(D.sents);
    const doTts = $('edTts').checked;
    closeModal();
    if (cat && L.cat && L.cat !== cat) L.cat = cat;
    renderLib(); renderPl(); renderStage();
    toast(isNew ? `문장 ${toTts.length}개를 저장했어요.` : '저장했어요.');
    if (doTts && toTts.length) makeAudio(toTts, true);
  };
}

/* ---------- 창 도우미 ---------- */
let modalClose = null;
function openModal(html, size) {
  $('mbox').onclick = null;
  $('mbox').className = 'mbox' + (size ? ' ' + size : '');
  $('mbox').innerHTML = html; $('modal').hidden = false;
  return new Promise((res) => { modalClose = res; });
}
function closeModal(v) { $('modal').hidden = true; $('mbox').innerHTML = ''; if (modalClose) { const f = modalClose; modalClose = null; f(v); } }
$('modal').onclick = (e) => { if (e.target.closest('[data-close]')) closeModal(false); };
function confirmBox(title, text, ok, danger) {
  const p = openModal(`
    <div class="mh"><h3>${esc(title)}</h3></div>
    <div class="mb"><p style="margin:0;line-height:1.6">${esc(text)}</p></div>
    <div class="mf"><button class="btn ghost" data-close>취소</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cfOk">${esc(ok || '확인')}</button></div>`, 'sm');
  $('cfOk').onclick = () => closeModal(true);
  return p;
}

/* =========================================================
 *  수업
 * ========================================================= */
const O = Object.assign({ mode: 'full', speed: 1, rep: 1, think: 1, shadow: 0, enView: 'show', koView: 'show', auto: false, numOn: true }, store.get('opts', {}));
if (!['full', 'chunk', 'drill'].includes(O.mode)) O.mode = 'full';
const C = { list: [], idx: 0, lessonId: null, lessonTitle: '' };
const V = { cur: -1, enHideFrom: null, koHideFrom: null, cue: -1 };
const resetV = () => Object.assign(V, { cur: -1, enHideFrom: null, koHideFrom: null, cue: -1 });
const curSent = () => byId(C.list[C.idx]);
const saveOpts = () => store.set('opts', O);
function saveClass() { store.set('class', { list: C.list, idx: C.idx, lessonId: C.lessonId, lessonTitle: C.lessonTitle }); }
function restoreClass() {
  const c = store.get('class', null);
  if (c && Array.isArray(c.list)) {
    C.list = c.list.filter((id) => byId(id)); C.idx = Math.min(c.idx || 0, Math.max(0, C.list.length - 1));
    C.lessonId = c.lessonId || null; C.lessonTitle = c.lessonTitle || '';
  }
  syncControls();
}

function addToPlaylist(ids, how) {
  if (!ids.length) return toast('넣을 문장이 없어요.', true);
  const go = (replace) => {
    stop();
    if (replace) { C.list = [...ids]; C.idx = 0; C.lessonId = null; C.lessonTitle = ''; }
    else { const set = new Set(C.list); ids.forEach((id) => { if (!set.has(id)) C.list.push(id); }); }
    saveClass(); L.sel.clear(); renderLib(); renderPl(); renderStage(); switchTab('class');
    toast(`수업 목록 ${C.list.length}문장`);
  };
  if (how !== 'ask') return go(how === 'replace');
  openModal(`
    <div class="mh"><h3>수업 목록에 넣기</h3><button class="icon" data-close>✕</button></div>
    <div class="mb"><p style="margin:0;line-height:1.6">지금 수업 목록에 ${C.list.length}문장이 있어요. 어떻게 할까요?</p></div>
    <div class="mf"><button class="btn ghost" data-close>취소</button><button class="btn" id="apAdd">뒤에 추가</button><button class="btn primary" id="apRep">새 목록으로 바꾸기</button></div>`, 'sm');
  $('apAdd').onclick = () => { closeModal(); go(false); };
  $('apRep').onclick = () => { closeModal(); go(true); };
}

function renderPl() {
  C.list = C.list.filter((id) => byId(id));
  if (C.idx >= C.list.length) C.idx = Math.max(0, C.list.length - 1);
  $('plCount').textContent = C.list.length ? `${C.list.length}문장` : '';
  $('plLesson').textContent = C.lessonTitle ? `📘 ${C.lessonTitle}` : '';
  $('plList').innerHTML = C.list.map((id, i) => {
    const s = byId(id);
    return `<li class="${i === C.idx ? 'on' : ''}" data-i="${i}"><span class="n">${i + 1}</span><span class="s">${esc(s.text)}${s.audio_en ? '' : ' <span class="noau">음성 없음</span>'}</span>
      <span class="mv"><button data-m="-1" title="위로">↑</button><button data-m="1" title="아래로">↓</button><button data-m="x" title="빼기">✕</button></span></li>`;
  }).join('') || '<li style="cursor:default;color:var(--ink3);display:block">비어 있어요</li>';
  const on = $('plList').querySelector('li.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
$('plList').onclick = (e) => {
  const li = e.target.closest('li[data-i]'); if (!li) return;
  const i = +li.dataset.i; const m = e.target.closest('[data-m]');
  if (m) {
    if (m.dataset.m === 'x') { C.list.splice(i, 1); if (C.idx > i) C.idx--; }
    else {
      const j = i + Number(m.dataset.m); if (j < 0 || j >= C.list.length) return;
      [C.list[i], C.list[j]] = [C.list[j], C.list[i]];
      if (C.idx === i) C.idx = j; else if (C.idx === j) C.idx = i;
    }
    saveClass(); renderPl(); renderStage(); return;
  }
  stop(); C.idx = i; saveClass(); renderPl(); renderStage(); preloadAround();
};
$('plClear').onclick = async () => {
  if (!C.list.length) return;
  if (!await confirmBox('수업 목록 비우기', '수업 목록을 비울까요? 문장과 저장된 수업 기록은 그대로 남아요.', '비우기')) return;
  stop(); C.list = []; C.idx = 0; C.lessonId = null; C.lessonTitle = ''; saveClass(); renderPl(); renderStage();
};
$('plLoad').onclick = () => openLoader();
function openLoader() {
  const catN = (code) => D.sents.filter((s) => s.category === code).length;
  const starN = D.sents.filter((s) => s.starred).length;
  const allLessonIds = () => { const seen = new Set(), out = []; [...D.lessons].reverse().forEach((l) => l.items.forEach((id) => { if (!seen.has(id) && byId(id)) { seen.add(id); out.push(id); } })); return out; };
  const draw = () => `
    <div class="mh"><h3>수업 목록 불러오기</h3><button class="icon" data-close>✕</button></div>
    <div class="mb pick">
      <div><h4>카테고리</h4><div class="chips">${D.cats.filter((c) => catN(c.code)).map((c) => `<button class="chip" data-cat="${esc(c.code)}">${esc(c.code)}<small>${esc(c.title || '')} ${catN(c.code)}</small></button>`).join('') || '<span class="small">문장이 있는 카테고리가 없어요.</span>'}</div></div>
      <div><h4>모아 듣기</h4><div class="chips">
        <button class="chip" data-all="lessons">지금까지 수업한 문장 전체<small>${allLessonIds().length}</small></button>
        <button class="chip" data-all="star">★ 별표 문장<small>${starN}</small></button>
        <button class="chip" data-all="every">문장 전체<small>${D.sents.length}</small></button>
      </div></div>
      <div><h4>수업 기록</h4>
        <ul class="lessons">${D.lessons.map((l) => `<li><span class="d">${esc(l.lesson_date)}</span><span class="t">${esc(l.title || '(제목 없음)')}</span><span class="c">${l.items.filter((id) => byId(id)).length}문장</span>
          <button class="btn sm" data-ls="${l.id}">불러오기</button><button class="icon" data-lsdel="${l.id}" title="기록 삭제">✕</button></li>`).join('') || '<li><span class="small">아직 저장한 수업 기록이 없어요. 수업 목록을 만든 뒤 \'수업 기록 저장\'을 누르세요.</span></li>'}</ul>
      </div>
      <p class="small">문장 관리에서 문장을 골라 '수업 목록에 넣기'를 해도 됩니다.</p>
    </div>
    <div class="mf"><label class="chk" style="color:var(--ink2)"><input type="checkbox" id="ldAppend"> 지금 목록 뒤에 추가</label><span class="grow"></span><button class="btn ghost" data-close>닫기</button></div>`;
  openModal(draw());
  $('mbox').onclick = async (e) => {
    const append = $('ldAppend') && $('ldAppend').checked;
    const b = e.target.closest('[data-cat],[data-all],[data-ls],[data-lsdel]'); if (!b) return;
    let ids = [], lesson = null;
    if (b.dataset.cat) ids = D.sents.filter((s) => s.category === b.dataset.cat).map((s) => s.id);
    else if (b.dataset.all === 'lessons') ids = allLessonIds();
    else if (b.dataset.all === 'star') ids = D.sents.filter((s) => s.starred).map((s) => s.id);
    else if (b.dataset.all === 'every') ids = D.sents.map((s) => s.id);
    else if (b.dataset.ls) { lesson = D.lessons.find((l) => l.id === b.dataset.ls); ids = lesson.items.filter((id) => byId(id)); }
    else if (b.dataset.lsdel) {
      const l = D.lessons.find((x) => x.id === b.dataset.lsdel);
      $('mbox').onclick = null;
      if (!await confirmBox('수업 기록 삭제', `${l.lesson_date} "${l.title}" 기록을 지울까요? 문장은 지워지지 않아요.`, '삭제', true)) return openLoader();
      const { error } = await sb.from('drill_lessons').delete().eq('id', l.id);
      if (error) toast(errText(error), true);
      else { D.lessons = D.lessons.filter((x) => x.id !== l.id); if (C.lessonId === l.id) { C.lessonId = null; C.lessonTitle = ''; saveClass(); renderPl(); } }
      return openLoader();
    }
    if (!ids.length) return toast('문장이 없어요.', true);
    $('mbox').onclick = null; closeModal();
    addToPlaylist(ids, append ? 'add' : 'replace');
    if (lesson && !append) { C.lessonId = lesson.id; C.lessonTitle = `${lesson.lesson_date} ${lesson.title}`; saveClass(); renderPl(); }
  };
}
$('plSave').onclick = () => {
  if (!C.list.length) return toast('수업 목록이 비어 있어요.', true);
  const cur = D.lessons.find((l) => l.id === C.lessonId);
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const cats = [...new Set(C.list.map((id) => byId(id) && byId(id).category).filter(Boolean))];
  const defTitle = cur ? cur.title : (cats.length ? cats.join(', ') + ' 구문' : '구문 수업');
  openModal(`
    <div class="mh"><h3>수업 기록 저장</h3><button class="icon" data-close>✕</button></div>
    <div class="mb">
      <label>날짜<input type="date" id="lsDate" value="${esc(cur ? cur.lesson_date : today)}"></label>
      <label>제목<input id="lsTitle" value="${esc(defTitle)}" maxlength="60" placeholder="예: 고2 정신여고반 관계사"></label>
      <p class="hint">지금 수업 목록 ${C.list.length}문장을 이 순서대로 저장해요. 나중에 '지금까지 수업한 문장 전체'로 모아 들을 수 있어요.</p>
    </div>
    <div class="mf">${cur ? '<button class="btn" id="lsNew">새 기록으로 저장</button>' : ''}<span class="grow"></span><button class="btn ghost" data-close>취소</button><button class="btn primary" id="lsSave">${cur ? '이 기록 덮어쓰기' : '저장'}</button></div>`, 'sm');
  const save = async (asNew) => {
    const row = { lesson_date: $('lsDate').value || today, title: $('lsTitle').value.trim(), items: C.list };
    const q = (!asNew && cur) ? sb.from('drill_lessons').update(row).eq('id', cur.id).select().single() : sb.from('drill_lessons').insert(row).select().single();
    const { data, error } = await q;
    if (error) return toast(errText(error), true);
    D.lessons = D.lessons.filter((l) => l.id !== data.id); D.lessons.unshift(data);
    D.lessons.sort((a, b) => String(b.lesson_date).localeCompare(String(a.lesson_date)));
    C.lessonId = data.id; C.lessonTitle = `${data.lesson_date} ${data.title}`; saveClass();
    closeModal(); renderPl(); toast('수업 기록을 저장했어요.');
  };
  $('lsSave').onclick = () => save(false);
  if (cur) $('lsNew').onclick = () => save(true);
};

/* ---------- 무대 그리기 ---------- */
const MODE_LABEL = { full: '전체듣기', chunk: '끊어듣기', drill: '직독직해' };
function wordsOf(t) { return String(t).split(/\s+/).filter(Boolean); }
function maskWord(w, kind) {
  const m = w.match(/^([^A-Za-z0-9]*)([A-Za-z0-9'’-]+)(.*)$/);
  if (!m) return esc(w);
  if (kind === 'initial') return `${esc(m[1])}<span class="ini">${esc(m[2][0])}<u>${'_'.repeat(Math.min(8, m[2].length - 1))}</u></span>${esc(m[3])}`;
  return `<span class="mask" style="width:${Math.max(0.9, m[2].length * 0.52).toFixed(2)}em"></span>${esc(m[3])}`;
}
function enHtml(text, k) {
  let kind = O.enView;
  if (V.enHideFrom != null && k >= V.enHideFrom) kind = 'hide';
  if (kind === 'show') return esc(text);
  return wordsOf(text).map((w) => maskWord(w, kind)).join(' ');
}
function koVisible(k) {
  if (V.cue === k) return 'cue';
  if (V.koHideFrom != null) return k < V.koHideFrom ? 'on' : 'off';
  return O.koView === 'show' ? 'on' : 'off';
}
function renderStage() {
  const s = curSent();
  $('stNum').textContent = s ? `${C.idx + 1} / ${C.list.length}` : '–';
  $('stMeta').innerHTML = s ? `${s.category ? `<span class="tag cat">${esc(s.category)}</span>` : ''}${(s.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}` : '';
  setStateText();
  if (!s) {
    $('stChunks').innerHTML = '<div class="empty-stage">왼쪽 <b>불러오기</b>에서 카테고리나 수업 기록을 고르거나,<br>문장 관리에서 문장을 골라 수업 목록에 넣으세요.</div>';
    return;
  }
  drawChunks();
}
function drawChunks() {
  const s = curSent(); if (!s) return;
  const ch = chunksOf(s);
  $('stChunks').innerHTML = ch.map((c, k) => {
    const kv = koVisible(k);
    const dim = V.cur >= 0 && k !== V.cur;
    return `<div class="ck ${k === V.cur ? 'cur' : ''} ${dim ? 'dim' : ''}"><div class="e">${enHtml(c.en, k)}</div><div class="k ${kv === 'off' ? 'off' : ''} ${kv === 'cue' ? 'cue' : ''}">${esc(c.ko || '')}</div></div>`;
  }).join('');
}
function setStateText(txt) {
  const el = $('stState');
  el.textContent = txt || (P.paused ? '일시정지 — Space로 이어서' : P.playing ? MODE_LABEL[O.mode] + ' 재생 중' : MODE_LABEL[O.mode]);
  el.classList.toggle('live', !!P.playing);
}
function syncControls() {
  const segOn = (id, v) => document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('on', String(b.dataset.v) === String(v)));
  segOn('speed', O.speed); segOn('rep', O.rep); segOn('think', O.think); segOn('shadow', O.shadow); segOn('enView', O.enView); segOn('koView', O.koView);
  document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === O.mode));
  $('auto').checked = !!O.auto; $('numOn').checked = !!O.numOn;
}
const segNum = { speed: true, rep: true, think: true, shadow: true };
['speed', 'rep', 'think', 'shadow', 'enView', 'koView'].forEach((id) => {
  $(id).onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    O[id] = segNum[id] ? Number(b.dataset.v) : b.dataset.v; saveOpts(); syncControls();
    if (id === 'enView' || id === 'koView') drawChunks();
  };
});
$('modes').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; setMode(b.dataset.mode); };
function setMode(m) { stop(); O.mode = m; saveOpts(); syncControls(); setStateText(); }
$('auto').onchange = (e) => { O.auto = e.target.checked; saveOpts(); };
$('numOn').onchange = (e) => { O.numOn = e.target.checked; saveOpts(); };
$('prev').onclick = () => go(-1);
$('next').onclick = () => go(1);
$('play').onclick = () => run();
$('stopBtn').onclick = () => stop();
// 수업 화면 버튼은 누른 뒤 포커스를 풀어 Space가 버튼을 다시 누르지 않게
document.querySelector('.controls').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) b.blur(); });
$('fs').onclick = () => toggleFs();
function go(d) {
  if (!C.list.length) return;
  const j = Math.min(C.list.length - 1, Math.max(0, C.idx + d));
  if (j === C.idx) return;
  stop(); C.idx = j; saveClass(); renderPl(); renderStage(); preloadAround();
}
function toggleFs() {
  const el = $('stageWrap');
  try { if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen(); } catch { /* 무시 */ }
}

/* ---------- 재생 엔진 ---------- */
const P = { tok: 0, playing: false, paused: false, en: new Audio(), ko: new Audio(), num: new Audio() };
[P.en, P.ko, P.num].forEach((a) => { a.preload = 'auto'; });
const urlCache = new Map();
async function audioUrl(path) {
  if (!path) return null;
  if (!urlCache.has(path)) {
    urlCache.set(path, (async () => {
      const { data, error } = await sb.storage.from('drill-audio').download(path);
      if (error) throw error;
      return URL.createObjectURL(new Blob([data], { type: 'audio/mpeg' }));
    })());
  }
  try { return await urlCache.get(path); } catch (e) { urlCache.delete(path); throw e; }
}
function preloadAround() {
  [C.idx, C.idx + 1].forEach((i) => { const s = byId(C.list[i]); if (s) { audioUrl(s.audio_en).catch(() => {}); audioUrl(s.audio_ko).catch(() => {}); } });
}
function loadEl(el, url) {
  if (el._u === url && el.readyState >= 2) return Promise.resolve();
  return new Promise((res, rej) => {
    const ok = () => { off(); res(); }, bad = () => { off(); rej(new Error('음성 파일을 열지 못했어요.')); };
    const off = () => { el.removeEventListener('canplay', ok); el.removeEventListener('error', bad); };
    el.addEventListener('canplay', ok); el.addEventListener('error', bad);
    el._u = url; el.src = url; el.load();
  });
}
async function seg(el, url, s, e, rate, tok) {
  if (!url) return true;
  await loadEl(el, url);
  if (tok !== P.tok) return false;
  el.playbackRate = rate; el.preservesPitch = true; el.mozPreservesPitch = true; el.webkitPreservesPitch = true;
  el.currentTime = s || 0;
  try { await el.play(); } catch (err) { if (tok !== P.tok) return false; throw err; }
  return new Promise((res) => {
    const iv = setInterval(() => {
      if (tok !== P.tok) { clearInterval(iv); el.pause(); return res(false); }
      if (P.paused) { if (!el.paused) el.pause(); return; }
      if (el.paused && !el.ended) { el.play().catch(() => {}); return; }
      if ((e != null && el.currentTime >= e) || el.ended) { clearInterval(iv); el.pause(); res(true); }
    }, 12);
  });
}
function wait(ms, tok, label) {
  return new Promise((res) => {
    let el = 0, last = performance.now();
    if (label) showCount(label);
    const iv = setInterval(() => {
      if (tok !== P.tok) { clearInterval(iv); hideCount(); return res(false); }
      const now = performance.now(); if (!P.paused) el += now - last; last = now;
      if (label) updCount(ms - el, ms);
      if (el >= ms) { clearInterval(iv); if (label) hideCount(); res(true); }
    }, 40);
  });
}
function showCount(label) { $('stCountLbl').textContent = label; $('stCount').classList.remove('off'); }
function updCount(left, total) { $('stCountN').textContent = Math.max(1, Math.ceil(left / 1000)); $('stCountBar').style.transform = `scaleX(${Math.max(0, left / total)})`; }
function hideCount() { $('stCount').classList.add('off'); }
function thinkMs(c) {
  const w = wordsOf(c.en).length;
  return Math.round(Math.min(10000, Math.max(1600, 1100 + w * 520)) * (O.think || 1));
}
function setPlaying(v) { P.playing = v; if (!v) P.paused = false; drawPlay(); setStateText(); }
function drawPlay() {
  const live = P.playing && !P.paused;
  $('play').textContent = live ? '❚❚' : '▶︎';
  $('play').classList.toggle('on', live);
  $('play').title = live ? '일시정지 (Space)' : (P.paused ? '이어서 재생 (Space)' : '재생 (Space)');
}
function togglePause() {
  if (!P.playing) return;
  P.paused = !P.paused;
  if (P.paused) [P.en, P.ko, P.num].forEach((a) => { try { a.pause(); } catch { /* 무시 */ } });
  drawPlay(); setStateText();
}
function stop() {
  P.tok++;
  [P.en, P.ko, P.num].forEach((a) => { try { a.pause(); } catch { /* 무시 */ } });
  P.paused = false; hideCount(); if (P.playing) setPlaying(false); else drawPlay(); resetV(); if (curSent()) drawChunks();
}

async function ensureNumbers() {
  const need = Math.min(80, C.list.length);
  if (D.num && D.num.voice === D.voices.en && D.num.upto >= need) return true;
  try {
    setStateText('번호 음성 준비 중…');
    const upto = Math.min(80, Math.ceil(need / 10) * 10);
    const r = await fn('numbers', { upto });
    D.num = { voice: r.voice, upto, paths: r.paths };
    return true;
  } catch (e) { toast('번호 음성을 준비하지 못해 번호 없이 재생해요. ' + errText(e), true); O.numOn = false; syncControls(); return false; }
}
async function playNumber(n, tok) {
  const p = D.num && D.num.paths && D.num.paths[n];
  if (!p) return true;
  const url = await audioUrl(p).catch(() => null);
  if (!url) return true;
  if (!await seg(P.num, url, 0, null, 1, tok)) return false;
  return wait(350, tok);
}
async function playSentence(s, mode, tok) {
  const ch = chunksOf(s);
  const te = s.times_en || [], tk = s.times_ko || [];
  const enUrl = await audioUrl(s.audio_en);
  const needKo = mode === 'drill';
  const koUrl = needKo && s.audio_ko ? await audioUrl(s.audio_ko) : null;
  if (needKo && !koUrl) { toast('이 문장은 우리말 음성이 없어 끊어듣기로 재생해요. ↻로 음성을 다시 만들어 주세요.', true); mode = 'chunk'; }
  if (tok !== P.tok) return false;
  const full = async () => { V.cur = -1; drawChunks(); return seg(P.en, enUrl, 0, null, O.speed, tok); };
  if (O.numOn) { if (!await playNumber(C.idx + 1, tok)) return false; }
  for (let r = 0; r < (O.rep || 1); r++) {
    if (r > 0 && !await wait(800, tok)) return false;
    resetV(); drawChunks();
    if (mode === 'full') {
      if (!await full()) return false;
    } else if (mode === 'chunk') {
      for (let k = 0; k < ch.length; k++) {
        if (!te[k]) continue;
        V.cur = k; drawChunks();
        if (!await seg(P.en, enUrl, te[k][0], te[k][1], O.speed, tok)) return false;
        if (!await wait(O.shadow ? thinkMs(ch[k]) : 450, tok, O.shadow ? '따라 말해 보세요' : '')) return false;
      }
      V.cur = -1; drawChunks();
      if (!await wait(400, tok)) return false;
      if (!await full()) return false;
    } else if (mode === 'drill') {
      V.enHideFrom = 0;
      for (let k = 0; k < ch.length; k++) {
        if (!ch[k].ko || !tk[k]) { V.enHideFrom = k + 1; continue; }
        V.cur = k; V.cue = k; drawChunks();
        if (!await seg(P.ko, koUrl, tk[k][0], tk[k][1], 1, tok)) return false;
        if (!await wait(thinkMs(ch[k]), tok, '영어로 말해 보세요')) return false;
        V.cue = -1; V.enHideFrom = k + 1; drawChunks();
        if (te[k] && !await seg(P.en, enUrl, te[k][0], te[k][1], O.speed, tok)) return false;
        if (!await wait(500, tok)) return false;
      }
      resetV(); drawChunks();
      if (!await wait(300, tok)) return false;
      if (!await full()) return false;
    }
  }
  return true;
}
async function run() {
  if (P.playing) return togglePause();
  const s = curSent();
  if (!s) return toast('수업 목록이 비어 있어요. 왼쪽 불러오기를 눌러 주세요.', true);
  const tok = ++P.tok;
  setPlaying(true);
  try {
    if (O.numOn) await ensureNumbers();
    if (tok !== P.tok) return;
    setStateText();
    for (;;) {
      const cs = curSent();
      if (cs.audio_en) {
        const ok = await playSentence(cs, O.mode, tok);
        if (!ok || tok !== P.tok) break;
      } else if (!O.auto) { toast('이 문장은 아직 음성이 없어요. 문장 관리에서 ↻를 눌러 만들어 주세요.', true); break; }
      if (!O.auto || C.idx >= C.list.length - 1) break;
      if (!await wait(1300, tok)) break;
      C.idx++; saveClass(); resetV(); renderPl(); renderStage(); preloadAround();
    }
  } catch (e) { if (tok === P.tok) toast(errText(e), true); }
  if (tok === P.tok) { setPlaying(false); resetV(); drawChunks(); }
}
async function preview(s) {
  stop();
  const tok = ++P.tok;
  try { await seg(P.en, await audioUrl(s.audio_en), 0, null, 1, tok); } catch (e) { toast(errText(e), true); }
}

document.addEventListener('keydown', (e) => {
  if ($('tab-class').hidden || !$('modal').hidden) return;
  if (e.target.closest('input:not([type=checkbox]),textarea,select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest('button,input')) e.target.blur();
  const k = e.key;
  if (k === ' ') { e.preventDefault(); run(); }
  else if (k === 'ArrowLeft') { e.preventDefault(); go(-1); }
  else if (k === 'ArrowRight') { e.preventDefault(); go(1); }
  else if (k >= '1' && k <= '3') setMode(['full', 'chunk', 'drill'][+k - 1]);
  else if (k === 'Escape') { e.preventDefault(); stop(); }
  else if (k === 'h' || k === 'H' || k === 'ㅗ') { O.enView = { show: 'initial', initial: 'hide', hide: 'show' }[O.enView]; saveOpts(); syncControls(); drawChunks(); }
  else if (k === 'k' || k === 'K' || k === 'ㅏ') { O.koView = O.koView === 'show' ? 'hide' : 'show'; saveOpts(); syncControls(); drawChunks(); }
  else if (k === 'f' || k === 'F' || k === 'ㄹ') toggleFs();
});

/* =========================================================
 *  설정
 * ========================================================= */
function voiceSelect(sel, custom, list, cur) {
  const known = list.some(([id]) => id === cur);
  sel.innerHTML = list.map(([id, name]) => `<option value="${id}" ${id === cur ? 'selected' : ''}>${esc(name)}</option>`).join('') + `<option value="__custom" ${known ? '' : 'selected'}>직접 입력 (voice ID)</option>`;
  custom.hidden = known; custom.value = known ? '' : cur;
  sel.onchange = () => { custom.hidden = sel.value !== '__custom'; };
}
async function renderStaff() {
  const { data, error } = await sb.from('staff').select('*').order('created_at');
  if (error) { $('staffList').innerHTML = `<li>${esc(errText(error))}</li>`; return; }
  const me = ($('meEmail').textContent || '').toLowerCase();
  const owner = data.some((s) => s.email === me && s.role === 'owner');
  $('staffList').innerHTML = data.map((s) => `<li><b>${s.role === 'owner' ? '👑' : '•'}</b> ${esc(s.name || '')} <span class="small">${esc(s.email)}</span>${owner && s.email !== me ? ` <button class="icon" data-rmstaff="${esc(s.email)}" title="삭제">✕</button>` : ''}</li>`).join('');
  $('staffAdd').hidden = !owner;
}
$('staffList').onclick = async (e) => {
  const b = e.target.closest('[data-rmstaff]'); if (!b) return;
  if (!await confirmBox('선생님 삭제', `${b.dataset.rmstaff} 계정의 사용 권한을 없앨까요?`, '삭제', true)) return;
  const { error } = await sb.from('staff').delete().eq('email', b.dataset.rmstaff);
  if (error) toast(errText(error), true); renderStaff();
};
$('staffAdd').onsubmit = async (e) => {
  e.preventDefault();
  const email = $('stEmail').value.trim().toLowerCase(), name = $('stName').value.trim();
  if (!email.includes('@')) return;
  const { error } = await sb.from('staff').insert({ email, name: name || null, role: 'teacher' });
  if (error) return toast(errText(error), true);
  $('stEmail').value = ''; $('stName').value = ''; renderStaff();
  toast('등록했어요. 그 선생님은 로그인 화면에서 "처음이면 계정 만들기"로 가입하면 됩니다.');
};
function renderSettings() {
  renderStaff();
  voiceSelect($('vEn'), $('vEnCustom'), VOICES.en, D.voices.en);
  voiceSelect($('vKo'), $('vKoCustom'), VOICES.ko, D.voices.ko);
  $('vMsg').textContent = ''; $('bulkMsg').textContent = '';
  ping();
}
$('vSave').onclick = async () => {
  const pick = (sel, custom) => sel.value === '__custom' ? custom.value.trim() : sel.value;
  const v = { en: pick($('vEn'), $('vEnCustom')), ko: pick($('vKo'), $('vKoCustom')) };
  if (!/^[A-Za-z0-9]{10,40}$/.test(v.en) || !/^[A-Za-z0-9]{10,40}$/.test(v.ko)) { $('vMsg').className = 'msg'; $('vMsg').textContent = 'voice ID 형식이 맞지 않아요.'; return; }
  const { error } = await sb.from('drill_settings').upsert({ key: 'voices', value: v, updated_at: new Date().toISOString() });
  if (error) { $('vMsg').className = 'msg'; $('vMsg').textContent = errText(error); return; }
  D.voices = v; D.num = null;
  $('vMsg').className = 'msg ok'; $('vMsg').textContent = '저장했어요. 새로 만드는 음성부터 적용돼요.';
};
async function ping() {
  $('status').innerHTML = '<li>확인 중…</li>';
  try {
    const r = await fn('ping');
    $('status').innerHTML = `
      <li><b>${r.eleven ? '✅' : '⚠️'}</b> 일레븐랩스 음성 ${r.eleven ? '연결됨' : '— API 키 미등록 (Supabase Edge Function 비밀값 ELEVENLABS_API_KEY)'}</li>
      <li><b>${r.claude ? '✅' : '⚠️'}</b> AI 의미구 초안 ${r.claude ? '연결됨' : '— 키 미등록'}</li>
      <li><b>📚</b> 문장 ${D.sents.length}개 · 음성 있음 ${D.sents.filter((s) => audioState(s) === 'ready').length}개 · 수업 기록 ${D.lessons.length}개</li>`;
  } catch (e) { $('status').innerHTML = `<li><b>⚠️</b> 서버 기능에 연결하지 못했어요: ${esc(errText(e))}</li>`; }
}
$('ping').onclick = ping;
$('bulkTts').onclick = async () => {
  const ids = D.sents.filter((s) => audioState(s) === 'need' || audioState(s) === 'stale').map((s) => s.id);
  if (!ids.length) { $('bulkMsg').className = 'msg ok'; $('bulkMsg').textContent = '음성이 필요한 문장이 없어요.'; return; }
  $('bulkMsg').className = 'msg ok'; $('bulkMsg').textContent = `${ids.length}개 만드는 중… 이 화면을 닫아도 되지만 새로고침하면 멈춰요.`;
  const n = await makeAudio(ids, true);
  $('bulkMsg').textContent = `${n || 0}개 완료`;
};

sb.auth.onAuthStateChange((ev) => {
  if (ev === 'SIGNED_OUT') showGate();
  if (ev === 'PASSWORD_RECOVERY') setTimeout(() => {
    openModal(`<div class="mh"><h3>새 비밀번호</h3></div><div class="mb"><label>새 비밀번호 (8자 이상)<input type="password" id="npw" autocomplete="new-password"></label><p class="msg" id="npwMsg"></p></div><div class="mf"><button class="btn primary" id="npwGo">바꾸기</button></div>`, 'sm');
    $('npwGo').onclick = async () => {
      const { error } = await sb.auth.updateUser({ password: $('npw').value });
      if (error) { $('npwMsg').textContent = errText(error); return; }
      closeModal(); toast('비밀번호를 바꿨어요.');
    };
  }, 300);
});
boot();
})();
