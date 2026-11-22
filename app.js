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
const D = { cats: [], sents: [], lessons: [], staff: [], me: '', schools: [], exams: [], xitems: [], voices: { en: VOICES.en[0][0], ko: VOICES.ko[0][0] }, num: null };
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
  const [c, s, l, v, st, xs, xe, xi] = await Promise.all([
    sb.from('drill_categories').select('*'),
    sb.from('drill_sentences').select('*'),
    sb.from('drill_lessons').select('*').order('lesson_date', { ascending: false }).order('created_at', { ascending: false }),
    sb.from('drill_settings').select('value').eq('key', 'voices').maybeSingle(),
    sb.from('staff').select('email, name, role').order('created_at'),
    sb.from('drill_schools').select('*').order('position'),
    sb.from('drill_exam_sets').select('*'),
    sb.from('drill_exam_items').select('*'),
  ]);
  for (const r of [c, s, l]) if (r.error) throw r.error;
  D.cats = c.data.sort((a, b) => natural(a.code, b.code));
  D.sents = sortSents(s.data);
  D.lessons = l.data;
  if (v.data && v.data.value) D.voices = { ...D.voices, ...v.data.value };
  D.staff = (st && st.data) || [];
  D.schools = (xs && xs.data) || []; D.exams = sortExams((xe && xe.data) || []); D.xitems = (xi && xi.data) || [];
  if (L.exam && !D.exams.some((x) => x.id === L.exam)) { L.exam = null; store.set('editExam', null); }
}
/* 작성자(강사): 선생님 계정 이름으로 고르고, 이름 그대로 저장 */
const staffName = (x) => (x.name || '').trim() || String(x.email || '').split('@')[0];
const myName = () => { const m = D.staff.find((x) => String(x.email).toLowerCase() === D.me.toLowerCase()); return m ? staffName(m) : ''; };
const authorNames = () => [...new Set([...D.staff.map(staffName), ...D.sents.map((x) => x.author).filter(Boolean)])].filter(Boolean);
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

/* ---------- 출처 (칸을 나눠 골라서 표기를 하나로 통일) ---------- */
const SRC_TYPES = [['', '출처 없음'], ['mock', '모의고사'], ['csat', '수능'], ['ebs', 'EBS·부교재'], ['text', '교과서'], ['etc', '기타']];
const squash = (v) => String(v || '').replace(/\s+/g, ' ').trim();
const digits = (v) => String(v || '').replace(/[^0-9~\-]/g, '');
function srcParts(src) {
  if (!src || !src.type) return { group: '', label: '' };
  let group = '';
  if (src.type === 'mock') group = `${src.year || '?'} ${src.grade || '?'} ${src.month || '?'}월 모의고사`;
  else if (src.type === 'csat') group = `${src.year || '?'}학년도 수능`;
  else if (src.type === 'ebs' || src.type === 'text') group = [src.book, src.unit].filter(Boolean).join(' ');
  else group = src.etc || '';
  const label = src.no && src.type !== 'etc' ? `${group} ${src.no}번` : group;
  return { group: squash(group), label: squash(label) };
}
const srcLabel = (s) => s.source_label || '';
const srcGroup = (s) => srcParts(s.source).group;
// 예전에 쓴 책 이름과 띄어쓰기·대소문자만 다르면 예전 이름으로 맞춤
function canonBook(name) {
  const n = squash(name); if (!n) return '';
  const key = n.replace(/\s/g, '').toLowerCase();
  const hit = D.sents.map((x) => x.source && x.source.book).find((b) => b && b.replace(/\s/g, '').toLowerCase() === key);
  return hit || n;
}

/* ---------- 로그인 ---------- */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session || session.user.is_anonymous) return showGate();
  const { data: ok, error } = await sb.rpc('is_staff');
  if (error || ok !== true) {
    await sb.auth.signOut();
    return showGate('선생님으로 등록된 이메일이 아니에요. 원장님께 설정 → 선생님 계정에서 이메일 등록을 요청하세요.');
  }
  $('meEmail').textContent = session.user.email || ''; D.me = session.user.email || '';
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
const L = { lesson: store.get('editLesson', null), onlyLesson: false, lq: '', lmore: false, xopen: new Set(store.get('xopen', [])), exam: store.get('editExam', null), onlyExam: false, xschool: '', xtype: '', cat: '', q: '', tag: '', src: '', author: '', audio: '', star: false, sel: new Set(), busy: new Set() };

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
  L.cat = li.dataset.c; L.xschool = ''; renderLib();
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
    if (L.src && srcGroup(s) !== L.src) return false;
    if (L.onlyLesson && editL() && !editL().items.includes(s.id)) return false;
    if (L.onlyExam && editX() && !xItem(editX().id, s.id)) return false;
    if (L.xschool && !xItemsOfSent(s.id).some((it) => (examById(it.set_id) || {}).school === L.xschool)) return false;
    if (L.xtype) { const its = (L.onlyExam && editX()) ? [xItem(editX().id, s.id)].filter(Boolean) : xItemsOfSent(s.id); if (!its.some((it) => (it.types || []).includes(L.xtype))) return false; }
    if (L.author && (L.author === '__none' ? s.author : s.author !== L.author)) return false;
    if (L.audio) { const a = audioState(s); if (L.audio === 'ready' ? a !== 'ready' : a === 'ready') return false; }
    if (q) {
      const hay = (s.text + ' ' + koLine(s) + ' ' + (s.memo || '') + ' ' + (s.tags || []).join(' ') + ' ' + srcLabel(s) + ' ' + (s.author || '') + ' ' + xItemsOfSent(s.id).map((it) => (it.point || '') + ' ' + (it.types || []).join(' ')).join(' ')).toLowerCase();
      const hayNs = hay.replace(/\s/g, '');
      const qq = q.replace(/모고|학평/g, '모의고사');
      if (!hay.includes(qq) && !hayNs.includes(qq.replace(/\s/g, ''))) return false;
    }
    return true;
  });
}
function renderSrcFilter() {
  const groups = [...new Set(D.sents.map(srcGroup).filter(Boolean))].sort((a, b) => natural(b, a));
  if (L.src && !groups.includes(L.src)) L.src = '';
  $('srcFilter').innerHTML = '<option value="">모든 출처</option>' + groups.map((g) => `<option ${g === L.src ? 'selected' : ''}>${esc(g)}</option>`).join('');
}
function renderAuthorFilter() {
  const names = [...new Set(D.sents.map((x) => x.author).filter(Boolean))].sort(natural);
  if (L.author && L.author !== '__none' && !names.includes(L.author)) L.author = '';
  const none = D.sents.some((x) => !x.author);
  $('authorFilter').innerHTML = '<option value="">모든 작성자</option>' + names.map((n) => `<option ${n === L.author ? 'selected' : ''}>${esc(n)}</option>`).join('') + (none ? `<option value="__none" ${L.author === '__none' ? 'selected' : ''}>작성자 없음</option>` : '');
}
function renderTagFilter() {
  renderSrcFilter(); renderAuthorFilter();
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
  const xv = L.onlyExam && editX(), it = xv ? xItem(xv.id, s.id) : null;
  const xsets = xItemsOfSent(s.id).map((x) => examById(x.set_id)).filter(Boolean);
  const canMove = !xv && !L.xschool && !L.onlyLesson && L.cat && L.cat !== '__none' && !L.q && !L.tag && !L.star && !L.audio && !L.src && !L.author;
  return `<div class="sent ${L.sel.has(s.id) ? 'sel' : ''}" data-id="${s.id}">
    <input type="checkbox" data-a="sel" ${L.sel.has(s.id) ? 'checked' : ''} aria-label="선택">
    <div class="no">${no}</div>
    <div class="body">
      <div class="en">${en}</div>
      ${ko ? `<div class="ko">${ko}</div>` : ''}
      <div class="tags">${s.category ? `<span class="tag cat">${esc(s.category)}</span>` : ''}${s.source_label ? `<span class="tag src">${esc(s.source_label)}</span>` : ''}${s.author ? `<span class="tag au" title="작성자">${esc(s.author)}</span>` : ''}${(s.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}${xv ? '' : xsets.slice(0, 3).map((x) => `<span class="tag ex" title="${esc(examLabel(x))}">${esc(examShort(x))}</span>`).join('') + (xsets.length > 3 ? `<span class="tag ex">외 ${xsets.length - 3}</span>` : '')}</div>
      ${s.memo ? `<div class="memo">${esc(s.memo)}</div>` : ''}
      ${it ? `<div class="xinfo">${(it.types || []).map((t) => `<span class="xt">${esc(t)}</span>`).join('')}${it.level ? `<span class="xl" title="출제 가능성">${'★'.repeat(it.level)}${'☆'.repeat(3 - it.level)}</span>` : ''}${it.point ? `<span class="xp">${esc(it.point)}</span>` : ''}${!(it.types || []).length && !it.level && !it.point ? '<span class="xnone">서술형 정보 없음 — ✍ 버튼으로 유형·포인트를 적어 두세요</span>' : ''}</div>` : ''}
    </div>
    <div class="act">
      <span class="au ${a}">${AU_LABEL[a]}</span>
      ${s.audio_en ? '<button class="icon" data-a="play" title="들어보기">▶︎</button>' : ''}
      <button class="icon" data-a="tts" title="${a === 'ready' ? '음성 다시 만들기' : '음성 만들기'}">↻</button>
      <button class="icon star ${s.starred ? 'on' : ''}" data-a="star" title="별표">★</button>
      <button class="icon" data-a="edit" title="수정">✎</button>
      ${canMove ? '<button class="icon" data-a="up" title="위로">↑</button><button class="icon" data-a="down" title="아래로">↓</button>' : ''}
      ${xv ? '<button class="icon xbtn" data-a="xinfo" title="서술형 정보 (유형·포인트·출제 가능성)">✍</button><button class="icon" data-a="xup" title="세트 안에서 위로">↑</button><button class="icon" data-a="xdown" title="세트 안에서 아래로">↓</button>' : ''}
      <button class="icon" data-a="del" title="삭제">✕</button>
    </div>
  </div>`;
}
function renderLib() {
  renderCats(); renderLessonSide(); renderExamSide(); renderTagFilter(); renderLessonBar(); renderExamBar(); renderXtypeFilter();
  let list = filtered();
  const xview = L.onlyExam && editX();
  if (xview) { const pos = (sid) => (xItem(xview.id, sid) || {}).position || 0; list = [...list].sort((a, b) => pos(a.id) - pos(b.id)); }
  $('starFilter').setAttribute('aria-pressed', L.star ? 'true' : 'false');
  let h = '';
  if (!list.length) {
    h = D.sents.length
      ? (xview && !xItemsOf(xview.id).length ? '<div class="empty">이 세트에 아직 문장이 없어요.<br><b>+ 새 문장</b>으로 올리거나, 위 <b>이 세트 문장만 보기</b>를 끄고 있던 문장을 체크해 <b>이 세트에 넣기</b>를 누르세요.</div>' : '<div class="empty">조건에 맞는 문장이 없어요.</div>')
      : '<div class="empty">아직 문장이 없어요.<br><b>+ 새 문장</b>을 눌러 수업할 문장을 붙여넣으세요.<br><span class="small">카테고리(예: 1-1)를 먼저 만들어 두면 정리하기 좋아요.</span></div>';
  } else {
    const groups = L.cat === '' && !L.q && !xview && !L.xschool;
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
$('srcFilter').onchange = (e) => { L.src = e.target.value; renderLib(); };
$('authorFilter').onchange = (e) => { L.author = e.target.value; renderLib(); };
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
    C.list = C.list.filter((x) => x !== id); saveClass(); D.xitems = D.xitems.filter((x) => x.sentence_id !== id);
    renderLib(); renderPl(); renderStage(); return;
  }
  if (a === 'up' || a === 'down') return moveSent(s, a === 'up' ? -1 : 1);
  if (a === 'xinfo') return openXInfo(editX(), s);
  if (a === 'xup' || a === 'xdown') return moveInExam(editX(), s.id, a === 'xup' ? -1 : 1);
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
async function translate(en, quiet) {
  try {
    const r = await fn('translate', { chunks: en });
    if (Array.isArray(r && r.ko) && r.ko.length === en.length) return r.ko;
    console.warn('translate: unexpected', r);
    if (!quiet) toast('번역 결과를 받지 못했어요. 다시 눌러 주세요.', true); return null;
  } catch (e) { console.warn('translate', e); if (!quiet || /KEY|STAFF/.test(String(e.message))) toast('자동 번역 실패: ' + errText(e), true); return null; }
}
function splitSlash(s) { return String(s || '').split(/[\/／]/).map((x) => x.trim()); }
// 편집 초안: en = '/'로 끊은 영어 한 줄, ko = 의미구별 우리말 배열
function draftFrom(s) {
  return { id: s ? s.id : null, en: s ? enLine(s) : '', ko: s ? chunksOf(s).map((c) => c.ko || '') : [], tags: s ? (s.tags || []).join(', ') : '', memo: s ? s.memo || '' : '' };
}
function checkDraft(d) {
  const en = splitSlash(d.en).filter(Boolean);
  const chunks = en.map((e, i) => ({ en: e, ko: String(d.ko[i] || '').trim() }));
  const empty = chunks.filter((c) => !c.ko).length;
  let warn = '';
  if (!en.length) warn = '영어 문장을 입력해 주세요.';
  else if (empty) warn = `우리말이 빈 의미구 ${empty}개 — 비워 두면 음성 만들 때 자동으로 번역돼요.`;
  return { chunks, warn, block: !en.length };
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
        <label>작성자<select id="edAuthor">${(() => { const cur = s ? (s.author || '') : (store.get('lastAuthor', '') || myName()); const names = authorNames(); if (cur && !names.includes(cur)) names.push(cur);
          return `<option value="">(지정 안 함)</option>` + names.map((n) => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join(''); })()}</select></label>
      </div>
      <div class="srcbox">
        <div class="srcrow">
          <label>출처<select id="srType">${SRC_TYPES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
          <label data-src="mock csat"><span id="srYearL">연도</span><select id="srYear">${(() => { const y = new Date().getFullYear(); let o = ''; for (let i = y + 1; i >= 2010; i--) o += `<option ${i === y ? 'selected' : ''}>${i}</option>`; return o; })()}</select></label>
          <label data-src="mock">학년<select id="srGrade"><option>고1</option><option>고2</option><option>고3</option></select></label>
          <label data-src="mock">월<select id="srMonth">${[3, 4, 6, 7, 9, 10, 11].map((m) => `<option value="${m}">${m}월</option>`).join('')}</select></label>
          <label data-src="ebs text" class="wide">책 이름<input id="srBook" list="srBooks" placeholder="예: 수능특강 영어"></label>
          <label data-src="ebs text">강·단원<input id="srUnit" list="srUnits" placeholder="예: 3강"></label>
          <label data-src="mock csat ebs text">번호<input id="srNo" inputmode="numeric" placeholder="예: 29"></label>
          <label data-src="etc" class="wide">출처<input id="srEtc" list="srEtcs" placeholder="자유 입력"></label>
        </div>
        <div class="srcprev">저장될 출처: <b id="srLabel">없음</b></div>
        <datalist id="srBooks">${[...new Set(D.sents.map((x) => x.source && x.source.book).filter(Boolean))].map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
        <datalist id="srUnits">${[...new Set(D.sents.map((x) => x.source && x.source.unit).filter(Boolean))].sort(natural).map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
        <datalist id="srEtcs">${[...new Set(D.sents.map((x) => x.source && x.source.etc).filter(Boolean))].map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
      </div>
      ${isNew ? `<div class="ed-paste">
        <label>문장 붙여넣기 <span class="small">— 한 줄에 한 문장, 의미구는 '/'로 끊기. 우리말은 자동으로 달리고, 칸에서 바로 고칠 수 있어요.</span>
          <textarea id="edPaste" placeholder="The students / who studied hard / passed the exam.&#10;It is important / that we keep our promises."></textarea></label>
        <div class="row">
          <button class="btn primary" id="edManual" title="'/'로 끊은 그대로 넣고, 의미구마다 우리말을 자동으로 달아요 (고칠 수 있음)">문장 입력 (우리말 자동 번역)</button>
          <button class="btn" id="edWrite" title="'/'로 끊은 그대로 넣고, 우리말은 비워 둬서 직접 써요">우리말 직접 쓰기</button>
          <button class="btn" id="edAi" title="'/'를 무시하고 끊기부터 AI가 해요">자동 끊기·번역</button>
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
  const rowsHtml = (d) => {
    const r = checkDraft(d);
    return `${r.chunks.map((c, k) => `<div class="krow"><span class="kn">${k + 1}</span><span class="ken">${esc(c.en)}</span><input class="ko" data-k="${k}" value="${esc(c.ko)}" placeholder="${d._pending ? '번역 중…' : '우리말 뜻'}"></div>`).join('')}
      ${r.warn ? `<div class="warn">${esc(r.warn)}</div>` : ''}`;
  };
  const draw = (focus) => {
    $('edItems').innerHTML = drafts.map((d, i) => `<div class="ed-item" data-i="${i}">
        <div class="ih">${isNew ? `문장 ${i + 1}` : ''}<span class="grow"></span>
          <button class="btn ghost sm" data-x="tr" title="빈 칸만 자동 번역 (다 차 있으면 전부 다시)">우리말 자동 번역</button>
          <button class="btn ghost sm" data-x="ai" title="의미구 끊기부터 다시">AI로 다시 끊기</button>
          ${isNew ? '<button class="icon" data-x="rm" title="빼기">✕</button>' : ''}</div>
        <label>영어 <span class="small">의미구는 / 로 끊기</span><input class="en" data-f="en" value="${esc(d.en)}"></label>
        <div class="kgrid">${rowsHtml(d)}</div>
        <div class="two">
          <label>태그 <span class="small">쉼표로 구분 (예: 관계대명사, 분사구문)</span><input data-f="tags" value="${esc(d.tags)}"></label>
          <label>출제 포인트 메모<input data-f="memo" value="${esc(d.memo)}" placeholder="예: who → 주격 관계대명사, 동사 수일치"></label>
        </div>
      </div>`).join('') || '<p class="small" style="text-align:center;padding:16px 0">문장을 붙여넣고 위 버튼을 눌러 주세요.</p>';
    if (focus) { const el = $('edItems').querySelector(focus); if (el) el.focus(); }
  };
  const redrawRows = (i) => {
    const box = $('edItems').querySelector(`.ed-item[data-i="${i}"]`); if (box) box.querySelector('.kgrid').innerHTML = rowsHtml(drafts[i]);
  };
  draw();
  // 출처: 수정이면 그 문장 것, 새 문장이면 지난번에 쓴 출처(번호 빼고)로 시작
  const src0 = s ? (s.source || {}) : store.get('lastSrc', {});
  const setv = (id, v) => { if (v != null && v !== '') $(id).value = v; };
  setv('srType', src0.type || ''); setv('srYear', src0.year); setv('srGrade', src0.grade); setv('srMonth', src0.month);
  setv('srBook', src0.book); setv('srUnit', src0.unit); setv('srNo', s ? src0.no : ''); setv('srEtc', src0.etc);
  const readSrc = () => {
    const t = $('srType').value; if (!t) return null;
    const src = { type: t };
    if (t === 'mock' || t === 'csat') src.year = +$('srYear').value;
    if (t === 'mock') { src.grade = $('srGrade').value; src.month = +$('srMonth').value; }
    if (t === 'ebs' || t === 'text') { src.book = canonBook($('srBook').value); src.unit = squash($('srUnit').value).replace(/(\d)\s+(강|과|단원|번|회)/g, '$1$2'); }
    if (t !== 'etc') { const n = digits($('srNo').value); if (n) src.no = n; }
    if (t === 'etc') src.etc = squash($('srEtc').value);
    Object.keys(src).forEach((k) => { if (src[k] === '' || src[k] == null || Number.isNaN(src[k])) delete src[k]; });
    return src;
  };
  const syncSrc = () => {
    const t = $('srType').value;
    document.querySelectorAll('.srcbox [data-src]').forEach((el) => { el.hidden = !t || !el.dataset.src.split(' ').includes(t); });
    $('srYearL').textContent = t === 'csat' ? '학년도' : '연도';
    $('srLabel').textContent = srcParts(readSrc()).label || '없음';
  };
  document.querySelector('.srcbox').addEventListener('input', syncSrc);
  document.querySelector('.srcbox').addEventListener('change', syncSrc);
  syncSrc();
  $('edCat').onchange = () => { $('edNewCat').hidden = $('edCat').value !== '__new'; if ($('edCat').value === '__new') $('edNewCode').focus(); };
  $('edItems').oninput = (e) => {
    const box = e.target.closest('.ed-item'); if (!box) return;
    const i = +box.dataset.i;
    if (e.target.dataset.k != null) {
      drafts[i].ko[+e.target.dataset.k] = e.target.value;
      const w = box.querySelector('.warn'); const r = checkDraft(drafts[i]);
      if (w) { if (r.warn) w.textContent = r.warn; else w.remove(); }
      return;
    }
    const f = e.target.dataset.f; if (!f) return;
    drafts[i][f] = e.target.value;
    if (f === 'en') redrawRows(i);
  };
  // 우리말 칸에서 Enter → 다음 칸
  $('edItems').onkeydown = (e) => {
    if (e.key !== 'Enter' || !e.target.matches('input.ko')) return;
    e.preventDefault();
    const all = [...$('edItems').querySelectorAll('input.ko')];
    const n = all[all.indexOf(e.target) + 1]; if (n) n.focus(); else $('edSave').focus();
  };
  const busy = (on, msg) => {
    ['edManual', 'edWrite', 'edAi'].forEach((id) => { if ($(id)) $(id).disabled = on; });
    if ($('edAiMsg')) $('edAiMsg').textContent = on ? msg : '';
  };
  // 안 끊은 문장들 → AI가 끊기·번역
  const aiCut = async (lines) => {
    const r = await fn('ai', { lines });
    const items = r.items || [];
    return lines.map((_, n) => {
      const it = items.find((x) => x.no === n + 1) || items[n];
      return it && it.chunks.length ? { en: it.chunks.map((c) => c.en).join(' / '), ko: it.chunks.map((c) => c.ko || ''), tags: (it.tags || []).join(', ') } : null;
    });
  };
  $('edItems').onclick = async (e) => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    const i = +b.closest('.ed-item').dataset.i;
    if (b.dataset.x === 'rm') { drafts.splice(i, 1); draw(); return; }
    const en = splitSlash(drafts[i].en).filter(Boolean); if (!en.length) return;
    b.disabled = true;
    try {
      if (b.dataset.x === 'tr') {
        const ko = await translate(en);
        if (ko) {
          const hasEmpty = en.some((_, k) => !String(drafts[i].ko[k] || '').trim());
          drafts[i].en = en.join(' / ');
          drafts[i].ko = en.map((_, k) => (hasEmpty && String(drafts[i].ko[k] || '').trim()) ? drafts[i].ko[k] : ko[k]);
          draw();
        }
      } else if (b.dataset.x === 'ai') {
        const out = await aiCut([en.join(' ')]);
        if (out[0]) { drafts[i] = { ...drafts[i], en: out[0].en, ko: out[0].ko, tags: drafts[i].tags || out[0].tags }; draw(); }
        else toast('AI가 끊지 못했어요. 다시 눌러 주세요.', true);
      }
    } catch (err) { toast(errText(err), true); }
    b.disabled = false;
  };
  if (isNew) {
    const lines = () => $('edPaste').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
    const need = () => { const ls = lines(); if (!ls.length) toast('문장을 먼저 붙여넣어 주세요.', true); return ls; };
    // 번역 결과를 빈 칸에만 채움 (선생님이 그새 쓴 칸은 그대로)
    const fillKo = (d, ko) => {
      d._pending = false;
      const i = drafts.indexOf(d); if (i < 0) return;
      const en = splitSlash(d.en).filter(Boolean);
      en.forEach((_, k) => { if (ko && ko[k] && !String(d.ko[k] || '').trim()) d.ko[k] = ko[k]; });
      const box = $('edItems').querySelector(`.ed-item[data-i="${i}"]`); if (!box) return;
      box.querySelectorAll('input.ko').forEach((inp) => {
        const k = +inp.dataset.k; inp.placeholder = '우리말 뜻';
        if (!inp.value.trim() && d.ko[k]) inp.value = d.ko[k];
      });
      const r = checkDraft(d), w = box.querySelector('.warn');
      if (w) { if (r.warn) w.textContent = r.warn; else w.remove(); }
    };
    // 왼쪽(기본): 선생님이 '/'로 끊은 그대로 넣고 → 의미구마다 우리말 자동 (칸에서 수정 가능)
    $('edManual').onclick = async () => {
      const ls = need(); if (!ls.length) return;
      const first = drafts.length;
      const added = ls.map((l) => ({ id: null, en: splitSlash(l).filter(Boolean).join(' / '), ko: [], tags: '', memo: '', _pending: true }));
      drafts = drafts.concat(added);
      $('edPaste').value = ''; draw();
      $('edAiMsg').textContent = '의미구마다 우리말을 다는 중…';
      const fails = [];
      await Promise.all(added.map(async (d) => {
        const ko = await translate(splitSlash(d.en).filter(Boolean), true);
        if (!ko) fails.push(d);
        fillKo(d, ko);
      }));
      $('edAiMsg').textContent = '';
      if (fails.length) toast(`${fails.length}문장은 자동 번역을 못 했어요. 직접 쓰시거나 문장 오른쪽 위 "우리말 자동 번역"을 눌러 주세요.`, true);
      const firstEmpty = $('edItems').querySelector(`.ed-item[data-i="${first}"] input.ko`); if (firstEmpty && !document.activeElement.matches('input')) firstEmpty.focus();
    };
    // 가운데: 끊은 그대로 넣고 우리말 칸은 비워 둠 (직접 쓰기)
    $('edWrite').onclick = () => {
      const ls = need(); if (!ls.length) return;
      const first = drafts.length;
      drafts = drafts.concat(ls.map((l) => ({ id: null, en: splitSlash(l).filter(Boolean).join(' / '), ko: [], tags: '', memo: '' })));
      $('edPaste').value = ''; draw(`.ed-item[data-i="${first}"] input.ko`);
    };
    // 오른쪽: '/' 무시, 끊기부터 자동
    $('edAi').onclick = async () => {
      const ls = need(); if (!ls.length) return;
      busy(true, '의미구를 끊고 우리말로 옮기는 중…');
      let out;
      try { out = await aiCut(ls.map((l) => splitSlash(l).filter(Boolean).join(' '))); } catch (err) { busy(false); return toast(errText(err), true); }
      busy(false);
      drafts = drafts.concat(ls.map((l, k) => out[k] ? { id: null, memo: '', ...out[k] } : { id: null, en: l, ko: [], tags: '', memo: '' }));
      if (out.some((x) => !x)) toast('일부 문장은 자동으로 끊지 못했어요.', true);
      $('edPaste').value = ''; draw();
    };
    setTimeout(() => $('edPaste').focus(), 30);
  }
  $('edSave').onclick = async () => {
    $('edMsg').className = 'msg'; $('edMsg').textContent = '';
    if (!drafts.length) return ($('edMsg').textContent = '저장할 문장이 없어요.');
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
    const src = readSrc();
    const author = $('edAuthor').value || null; store.set('lastAuthor', author || '');
    const srcCols = { source: src, source_label: srcParts(src).label || null, author };
    if (src) { const keep = { ...src }; delete keep.no; store.set('lastSrc', keep); } else store.set('lastSrc', {});
    const tagsOf = (t) => [...new Set(String(t || '').split(/[,#]/).map((x) => x.trim()).filter(Boolean))].slice(0, 8);
    $('edSave').disabled = true;
    const toTts = [];
    try {
      if (isNew) {
        let pos = maxPos(cat);
        const rows = drafts.map((d, i) => ({ ...srcCols, category: cat, position: ++pos, chunks: checked[i].chunks, text: checked[i].chunks.map((c) => c.en).join(' '), tags: tagsOf(d.tags), memo: d.memo.trim() || null }));
        const { data, error } = await sb.from('drill_sentences').insert(rows).select();
        if (error) throw error;
        D.sents.push(...data); data.forEach((r) => toTts.push(r.id));
        if (editL()) await addToLesson(data.map((r) => r.id), true);
        if (editX()) await addToExam(data.map((r) => r.id), true);
      } else {
        const d = drafts[0], r = checked[0];
        const changed = JSON.stringify(r.chunks) !== JSON.stringify(chunksOf(s).map((c) => ({ en: c.en, ko: c.ko || '' })));
        const upd = { ...srcCols, category: cat, chunks: r.chunks, text: r.chunks.map((c) => c.en).join(' '), tags: tagsOf(d.tags), memo: d.memo.trim() || null };
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
const O = Object.assign({ mode: 'full', speed: 1, rep: 1, think: 1, shadow: 0, enView: 'show', koView: 'show', auto: false }, store.get('opts', {}));
if (!['full', 'chunk', 'drill'].includes(O.mode)) O.mode = 'full';
const C = { list: [], idx: 0, lessonId: null, lessonTitle: '', examId: null };
const V = { cur: -1, enHideFrom: null, koHideFrom: null, cue: -1 };
const resetV = () => Object.assign(V, { cur: -1, enHideFrom: null, koHideFrom: null, cue: -1 });
const curSent = () => byId(C.list[C.idx]);
const saveOpts = () => store.set('opts', O);
function saveClass() { store.set('class', { list: C.list, idx: C.idx, lessonId: C.lessonId, lessonTitle: C.lessonTitle, examId: C.examId }); }
function restoreClass() {
  const c = store.get('class', null);
  if (c && Array.isArray(c.list)) {
    C.list = c.list.filter((id) => byId(id)); C.idx = Math.min(c.idx || 0, Math.max(0, C.list.length - 1));
    C.lessonId = c.lessonId || null; C.lessonTitle = c.lessonTitle || ''; C.examId = c.examId || null;
  }
  syncControls();
}

function addToPlaylist(ids, how) {
  if (!ids.length) return toast('넣을 문장이 없어요.', true);
  const go = (replace) => {
    stop();
    if (replace) { C.list = [...ids]; C.idx = 0; C.lessonId = null; C.lessonTitle = ''; C.examId = null; }
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
  const curL = D.lessons.find((l) => l.id === C.lessonId);
  $('plLesson').textContent = C.lessonTitle ? `📘 ${C.lessonTitle}${curL && curL.published ? ` · ECHO 공개(${curL.class_name || curL.class_code})` : ''}` : '';
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
  stop(); C.list = []; C.idx = 0; C.lessonId = null; C.lessonTitle = ''; C.examId = null; saveClass(); renderPl(); renderStage();
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
        <ul class="lessons">${D.lessons.map((l) => `<li><span class="d">${esc(l.lesson_date)}</span><span class="t">${esc(l.title || '(제목 없음)')}${l.published ? ` <span class="tag src">ECHO · ${esc(l.class_name || l.class_code)}</span>` : ''}</span><span class="c">${l.items.filter((id) => byId(id)).length}문장</span>
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
    if (lesson && !append) { C.examId = null; C.lessonId = lesson.id; C.lessonTitle = `${lesson.lesson_date} ${lesson.title}`; saveClass(); renderPl(); }
  };
}
// 허브 반 목록 (ECHO 공개용) — echo 함수가 허브에서 읽어 옴
let HUB_CLASSES = null;
async function loadHubClasses() {
  if (HUB_CLASSES) return HUB_CLASSES;
  try {
    const { data, error } = await sb.functions.invoke('echo', { body: { op: 'classes' } });
    if (error) throw error;
    HUB_CLASSES = (data.classes || []).sort((a, b) => natural(a.name, b.name));
  } catch (e) { console.warn('classes', e); return []; }
  return HUB_CLASSES;
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
      <label>ECHO 학생 공개 <span class="small">— 고른 반 학생들이 허브에서 다시 들을 수 있어요</span>
        <select id="lsClass"><option value="">공개 안 함 (선생님만)</option></select></label>
      <p class="hint" id="lsClassMsg">반 목록 불러오는 중…</p>
      <p class="hint">지금 수업 목록 ${C.list.length}문장을 이 순서대로 저장해요. 나중에 '지금까지 수업한 문장 전체'로 모아 들을 수 있어요.</p>
    </div>
    <div class="mf">${cur ? '<button class="btn" id="lsNew">새 기록으로 저장</button>' : ''}<span class="grow"></span><button class="btn ghost" data-close>취소</button><button class="btn primary" id="lsSave">${cur ? '이 기록 덮어쓰기' : '저장'}</button></div>`, 'sm');
  loadHubClasses().then((list) => {
    const sel = $('lsClass'); if (!sel) return;
    const curCode = cur && cur.published ? cur.class_code : (cur ? '' : store.get('lastEchoClass', ''));
    sel.innerHTML = '<option value="">공개 안 함 (선생님만)</option>' + list.map((c) => `<option value="${esc(c.code)}" ${c.code === curCode ? 'selected' : ''}>${esc(c.name)} (${esc(c.code)})</option>`).join('');
    $('lsClassMsg').textContent = list.length ? '' : '허브 반 목록을 불러오지 못했어요. 공개는 나중에 다시 저장하면서 고를 수 있어요.';
  });
  const save = async (asNew) => {
    const code = $('lsClass').value;
    const cls = (HUB_CLASSES || []).find((c) => c.code === code);
    store.set('lastEchoClass', code);
    const row = { lesson_date: $('lsDate').value || today, title: $('lsTitle').value.trim(), items: C.list, class_code: code || null, class_name: cls ? cls.name : null, published: !!code };
    const q = (!asNew && cur) ? sb.from('drill_lessons').update(row).eq('id', cur.id).select().single() : sb.from('drill_lessons').insert(row).select().single();
    const { data, error } = await q;
    if (error) return toast(errText(error), true);
    D.lessons = D.lessons.filter((l) => l.id !== data.id); D.lessons.unshift(data);
    D.lessons.sort((a, b) => String(b.lesson_date).localeCompare(String(a.lesson_date)));
    C.lessonId = data.id; C.lessonTitle = `${data.lesson_date} ${data.title}`; saveClass();
    closeModal(); renderPl(); toast(data.published ? `저장했어요. ${data.class_name || data.class_code} 학생들에게 ECHO로 공개됐어요.` : '수업 기록을 저장했어요.');
  };
  $('lsSave').onclick = () => save(false);
  if (cur) $('lsNew').onclick = () => save(true);
};

/* ---------- 새 수업: 반·날짜를 먼저 정하고 그날 문장을 모아 올리기 ---------- */
function kstToday() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
function editL() { return (L.lesson && D.lessons.find((l) => l.id === L.lesson)) || null; }
function setEditLesson(id) {
  L.lesson = id || null; store.set('editLesson', L.lesson);
  if (!id) L.onlyLesson = false;
  renderLib();
}
async function patchLesson(l, patch) {
  const { data, error } = await sb.from('drill_lessons').update(patch).eq('id', l.id).select().single();
  if (error) { toast(errText(error), true); return null; }
  D.lessons = D.lessons.map((x) => (x.id === data.id ? data : x));
  if (C.lessonId === data.id) {
    const cur = C.list[C.idx];
    C.list = [...data.items]; C.idx = Math.max(0, C.list.indexOf(cur)); C.lessonTitle = `${data.lesson_date} ${data.title}`; saveClass(); renderPl(); renderStage();
  }
  return data;
}
async function addToLesson(ids, quiet) {
  const l = editL(); if (!l) return;
  const items = [...(l.items || [])]; let n = 0;
  ids.forEach((id) => { if (!items.includes(id)) { items.push(id); n++; } });
  if (!n) { if (!quiet) toast('이미 이 수업에 들어 있는 문장이에요.'); return; }
  if (await patchLesson(l, { items })) { if (!quiet) toast(`이 수업에 ${n}문장을 넣었어요. (모두 ${items.length}문장)`); renderLib(); }
}
function renderLessonBar() {
  const l = editL(), bar = $('lessonBar');
  $('selToLesson').hidden = !l; $('selOutLesson').hidden = !(l && L.onlyLesson);
  if (!l) { bar.hidden = true; return; }
  const d = new Date(l.lesson_date + 'T00:00:00'), n = (l.items || []).length;
  bar.hidden = false;
  bar.innerHTML = `<div class="lb-t"><span class="lb-k">편집 중인 수업</span><b>${d.getMonth() + 1}/${d.getDate()} · ${esc(l.class_name || '반 지정 안 함')}</b><span class="lb-s">${esc(l.title)} · ${n}문장</span>
      <span class="lb-p ${l.published ? 'on' : ''}">${l.published ? 'ECHO 공개 중' : l.class_code ? 'ECHO 공개 전' : ''}</span></div>
    <div class="lb-a"><button class="btn sm ${L.onlyLesson ? 'primary' : ''}" id="lbOnly" aria-pressed="${L.onlyLesson}">이 수업 문장만 보기</button>
      ${l.class_code ? `<button class="btn sm" id="lbPub">${l.published ? '공개 내리기' : '학생에게 공개'}</button>` : ''}
      <button class="btn sm" id="lbOpen">수업 화면에서 열기</button><button class="btn ghost sm" id="lbEdit">수업 정보</button><button class="btn ghost sm" id="lbEnd">편집 끝내기</button></div>
    <p class="lb-h">이제 <b>+ 새 문장</b>으로 올리는 문장은 이 수업에 바로 들어가요. 있던 문장은 체크한 뒤 <b>이 수업에 넣기</b>.</p>`;
  $('lbOnly').onclick = () => { L.onlyLesson = !L.onlyLesson; renderLib(); };
  $('lbEnd').onclick = () => setEditLesson(null);
  $('lbEdit').onclick = () => openNewLesson(l);
  $('lbOpen').onclick = () => {
    if (!n) return toast('아직 이 수업에 문장이 없어요.', true);
    stop(); C.list = [...l.items]; C.idx = 0; C.examId = null; C.lessonId = l.id; C.lessonTitle = `${l.lesson_date} ${l.title}`; saveClass(); renderPl(); renderStage(); switchTab('class');
  };
  if ($('lbPub')) $('lbPub').onclick = async () => {
    if (!l.published && !n) return toast('문장을 먼저 넣어 주세요.', true);
    const r = await patchLesson(l, { published: !l.published });
    if (r) { toast(r.published ? `${r.class_name} 학생들에게 ECHO로 공개했어요.` : '학생 공개를 내렸어요.'); renderLib(); }
  };
}
function openNewLesson(edit) {
  const recent = D.lessons.filter((x) => x.id !== (edit && edit.id)).slice(0, 5);
  openModal(`
    <div class="mh"><h3>${edit ? '수업 정보 고치기' : '새 수업 만들기'}</h3><button class="icon" data-close>✕</button></div>
    <div class="mb">
      <label>반<select id="nlClass"><option value="">반 목록 불러오는 중…</option></select></label>
      <label>수업 날짜<input type="date" id="nlDate" value="${esc(edit ? edit.lesson_date : kstToday())}"></label>
      <label>제목<input id="nlTitle" maxlength="60" value="${esc(edit ? edit.title : '')}" placeholder="예: 관계대명사 수식 구조"></label>
      ${edit ? '' : '<label class="chk" style="color:var(--ink2)"><input type="checkbox" id="nlPub"> 문장을 올리는 대로 바로 학생에게 공개 (ECHO)</label>'}
      ${!edit && recent.length ? `<div class="nl-recent"><span class="small">최근 수업 이어서 편집</span>${recent.map((x) => `<button class="btn ghost sm" data-nl="${x.id}">${esc(x.lesson_date.slice(5).replace('-', '/'))} ${esc(x.class_name || '')} · ${esc(x.title)}</button>`).join('')}</div>` : ''}
    </div>
    <div class="mf"><span class="grow"></span><button class="btn ghost" data-close>취소</button><button class="btn primary" id="nlGo">${edit ? '저장' : '만들고 문장 올리기'}</button></div>`, 'sm');
  loadHubClasses().then((list) => {
    const sel = $('nlClass'); if (!sel) return;
    const cur = edit ? (edit.class_code || '') : store.get('lastEchoClass', '');
    sel.innerHTML = '<option value="">반 지정 안 함 (선생님만)</option>' + list.map((c) => `<option value="${esc(c.code)}" ${c.code === cur ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  });
  document.querySelectorAll('[data-nl]').forEach((b) => { b.onclick = () => { closeModal(); setEditLesson(b.dataset.nl); toast('이 수업을 이어서 편집해요.'); }; });
  $('nlGo').onclick = async () => {
    const code = $('nlClass').value, cls = (HUB_CLASSES || []).find((c) => c.code === code);
    const date = $('nlDate').value || kstToday();
    const title = $('nlTitle').value.trim() || `${cls ? cls.name : ''} 구문 수업`.trim();
    store.set('lastEchoClass', code);
    const row = { lesson_date: date, title, class_code: code || null, class_name: cls ? cls.name : null };
    if (edit) {
      if (!code) row.published = false;
      const r = await patchLesson(edit, row); if (!r) return;
      closeModal(); renderLib(); return toast('수업 정보를 고쳤어요.');
    }
    row.items = []; row.published = !!(code && $('nlPub').checked);
    const { data, error } = await sb.from('drill_lessons').insert(row).select().single();
    if (error) return toast(errText(error), true);
    D.lessons.unshift(data); D.lessons.sort((a, b) => String(b.lesson_date).localeCompare(String(a.lesson_date)));
    closeModal(); L.onlyLesson = true; setEditLesson(data.id);
    toast('수업을 만들었어요. 이제 + 새 문장으로 올리면 이 수업에 바로 들어가요.');
    openEditor(null);
  };
}
$('newLessonBtn').onclick = () => openNewLesson(null);
/* 왼쪽 '수업' 목록: 검색해서 누르면 그 수업을 편집 중으로 다시 열기 */
function renderLessonSide() {
  const q = L.lq.trim().toLowerCase().replace(/\s+/g, ' ');
  const hay = (l) => { const d = new Date(l.lesson_date + 'T00:00:00'); return `${l.lesson_date} ${d.getMonth() + 1}/${d.getDate()} ${d.getMonth() + 1}월 ${d.getDate()}일 ${l.class_name || ''} ${l.class_code || ''} ${l.title || ''}`.toLowerCase(); };
  const all = [...D.lessons].sort((a, b) => String(b.lesson_date).localeCompare(String(a.lesson_date)));
  const list = q ? all.filter((l) => q.split(' ').every((w) => hay(l).includes(w))) : all;
  const LIMIT = 5;
  let shown = q || L.lmore ? list : list.slice(0, LIMIT);
  const cur = !q && !L.lmore && L.lesson && list.find((l) => l.id === L.lesson);
  if (cur && !shown.includes(cur)) shown = [...shown, cur];   // 편집 중인 수업은 접혀 있어도 보이게
  $('lessonSide').innerHTML = shown.map((l) => {
    const d = new Date(l.lesson_date + 'T00:00:00');
    return `<li class="${L.lesson === l.id ? 'on' : ''}" data-l="${l.id}" title="${esc(l.title)}"><span class="ttl"><b>${d.getMonth() + 1}/${d.getDate()}</b> ${esc(l.class_name || '반 없음')}<small>${esc(l.title)}</small></span><span class="n">${(l.items || []).length}${l.published ? '<i class="pub" title="ECHO 공개 중">●</i>' : ''}</span></li>`;
  }).join('') + (!q && list.length > LIMIT ? `<li class="more" data-more="1">${L.lmore ? '▴ 지난 수업 접기' : `▾ 지난 수업 더보기 (${list.length - LIMIT}개)`}</li>` : '') + (!list.length ? `<li class="empty">${q ? '찾는 수업이 없어요' : '아직 저장한 수업이 없어요'}</li>` : '');
}
$('lessonQ').oninput = (e) => { L.lq = e.target.value; renderLessonSide(); };
$('lessonSide').onclick = (e) => {
  if (e.target.closest('li[data-more]')) { L.lmore = !L.lmore; return renderLessonSide(); }
  const li = e.target.closest('li[data-l]'); if (!li) return;
  if (L.lesson === li.dataset.l) { L.onlyLesson = !L.onlyLesson; return renderLib(); }
  L.onlyLesson = true; L.cat = ''; L.xschool = ''; setEditLesson(li.dataset.l);
};
$('lessonAddBtn').onclick = () => openNewLesson(null);

/* ---------- 내신 세트: 학교·학년·연도·학기·시험 + 범위 메모, 문장마다 서술형 정보 ---------- */
const XTYPES = ['배열 영작', '조건 영작', '어법 수정', '요약문 완성', '빈칸 서술'];
const EXAM_NAME = { mid: '중간', final: '기말' };
function examById(id) { return D.exams.find((x) => x.id === id) || null; }
function editX() { return (L.exam && examById(L.exam)) || null; }
function examLabel(x) { return `${x.school} ${x.grade}학년 ${x.year} ${x.term}학기 ${EXAM_NAME[x.exam]}`; }
function examShort(x) { return `${x.school} ${x.grade}-${x.term} ${EXAM_NAME[x.exam]} '${String(x.year).slice(2)}`; }
function sortExams(a) {
  const sp = (n) => { const i = D.schools.findIndex((x) => x.name === n); return i < 0 ? 999 : i; };
  return a.sort((p, q) => sp(p.school) - sp(q.school) || q.year - p.year || p.grade - q.grade || q.term - p.term || (q.exam === 'final') - (p.exam === 'final'));
}
function xItemsOf(setId) { return D.xitems.filter((x) => x.set_id === setId).sort((a, b) => a.position - b.position); }
function xItem(setId, sid) { return D.xitems.find((x) => x.set_id === setId && x.sentence_id === sid) || null; }
function xItemsOfSent(sid) { return D.xitems.filter((x) => x.sentence_id === sid); }
function setEditExam(id, only) {
  L.exam = id || null; store.set('editExam', L.exam);
  if (id && examById(id)) { L.xopen.add(examById(id).school); store.set('xopen', [...L.xopen]); }
  L.onlyExam = !!(id && only); if (id) L.xschool = '';
  renderLib();
}
function renderExamSide() {
  const names = [...new Set([...D.schools.map((x) => x.name), ...D.exams.map((x) => x.school)])];
  let h = '';
  for (const n of names) {
    const sets = D.exams.filter((x) => x.school === n);
    const cnt = new Set(D.xitems.filter((it) => sets.some((x) => x.id === it.set_id)).map((it) => it.sentence_id)).size;
    const open = L.xopen.has(n) || (editX() && editX().school === n);
    h += `<li class="xs ${sets.length ? '' : 'empty'} ${open ? 'open' : ''}" data-xs="${esc(n)}" aria-expanded="${open}"><span class="car">${sets.length ? (open ? '▾' : '▸') : ''}</span><span class="ttl">${esc(n)}</span><span class="n">${sets.length ? sets.length + '세트' : ''}</span></li>`;
    if (!open) continue;
    if (sets.length > 1 || cnt) h += `<li class="xall ${L.xschool === n ? 'on' : ''}" data-xall="${esc(n)}"><span class="ttl">이 학교 문장 모두 보기</span><span class="n">${cnt || ''}</span></li>`;
    for (const x of sets) {
      h += `<li class="xset ${L.exam === x.id ? 'on' : ''}" data-x="${x.id}"><span class="ttl">${x.year} · ${x.grade}학년 ${x.term}학기 ${EXAM_NAME[x.exam]}${x.published ? ' <i class="pub" title="ECHO 공개 중">●</i>' : ''}</span><span class="n">${xItemsOf(x.id).length}</span></li>`;
    }
  }
  $('examList').innerHTML = h || '<li class="empty">학교가 없어요</li>';
}
$('examList').onclick = (e) => {
  const li = e.target.closest('li'); if (!li) return;
  if (li.dataset.x) { L.cat = ''; return setEditExam(li.dataset.x, true); }
  if (li.dataset.xall != null) {
    const n = li.dataset.xall;
    L.xschool = L.xschool === n ? '' : n; L.cat = ''; if (L.xschool) { L.onlyExam = false; } return renderLib();
  }
  if (li.dataset.xs != null) {
    const n = li.dataset.xs;
    if (!D.exams.some((x) => x.school === n)) return toast(`${n}은(는) 아직 내신 세트가 없어요. 위 + 세트로 만들어 주세요.`);
    const editing = editX() && editX().school === n;
    if (L.xopen.has(n) || editing) {   // 접기 — 편집 중인 세트의 학교를 접으면 편집도 끝냄
      L.xopen.delete(n); if (L.xschool === n) L.xschool = '';
      store.set('xopen', [...L.xopen]);
      return editing ? setEditExam(null) : renderLib();
    }
    L.xopen.add(n); store.set('xopen', [...L.xopen]); renderLib();
  }
};
function renderXtypeFilter() {
  const has = D.xitems.some((x) => (x.types || []).length);
  $('xtypeFilter').hidden = !has && !L.xtype;
  $('xtypeFilter').innerHTML = '<option value="">모든 서술형 유형</option>' + XTYPES.map((t) => `<option ${t === L.xtype ? 'selected' : ''}>${t}</option>`).join('');
}
$('xtypeFilter').onchange = (e) => { L.xtype = e.target.value; renderLib(); };
function renderExamBar() {
  const x = editX(), bar = $('examBar');
  $('selToExam').hidden = !x; $('selOutExam').hidden = !(x && L.onlyExam);
  if (!x) { bar.hidden = true; return; }
  const n = xItemsOf(x.id).length;
  bar.hidden = false;
  bar.innerHTML = `<div class="lb-t"><span class="lb-k">편집 중인 내신 세트</span><b>${esc(examLabel(x))}</b><span class="lb-s">${n}문장</span>
      <span class="lb-p ${x.published ? 'on' : ''}">${x.published ? `ECHO 공개 중 · ${esc(x.class_name || x.class_code)}` : x.class_code ? `ECHO 공개 전 · ${esc(x.class_name || x.class_code)}` : ''}</span></div>
    <div class="lb-a"><button class="btn sm ${L.onlyExam ? 'primary' : ''}" id="xbOnly" aria-pressed="${L.onlyExam}">이 세트 문장만 보기</button>
      ${x.class_code ? `<button class="btn sm" id="xbPub">${x.published ? '공개 내리기' : '학생에게 공개'}</button>` : ''}
      <button class="btn sm" id="xbOpen">수업 화면에서 열기</button><button class="btn ghost sm" id="xbEdit">세트 정보</button><button class="btn ghost sm" id="xbEnd">편집 끝내기</button></div>
    ${x.scope ? `<p class="lb-scope"><span>범위</span>${esc(x.scope)}</p>` : ''}
    <p class="lb-h">+ 새 문장으로 올리는 문장은 이 세트에 바로 들어가요. 있던 문장은 체크한 뒤 <b>이 세트에 넣기</b>. 세트 안 문장의 <b>✍</b>로 서술형 유형·핵심 포인트·출제 가능성을 적어요.</p>`;
  $('xbOnly').onclick = () => { L.onlyExam = !L.onlyExam; renderLib(); };
  $('xbEnd').onclick = () => setEditExam(null);
  $('xbEdit').onclick = () => openExamSet(x);
  $('xbOpen').onclick = () => {
    const ids = xItemsOf(x.id).map((it) => it.sentence_id).filter((id) => byId(id));
    if (!ids.length) return toast('아직 이 세트에 문장이 없어요.', true);
    stop(); C.list = ids; C.idx = 0; C.lessonId = null; C.examId = x.id; C.lessonTitle = examLabel(x); saveClass(); renderPl(); renderStage(); switchTab('class');
  };
  if ($('xbPub')) $('xbPub').onclick = async () => {
    if (!x.published && !n) return toast('문장을 먼저 넣어 주세요.', true);
    const r = await patchExam(x, { published: !x.published });
    if (r) toast(r.published ? `${r.class_name || r.class_code} 학생들에게 ECHO 내신 서술형으로 공개했어요.` : '학생 공개를 내렸어요.');
  };
}
async function patchExam(x, patch) {
  const { data, error } = await sb.from('drill_exam_sets').update(patch).eq('id', x.id).select().single();
  if (error) { toast(errText(error), true); return null; }
  D.exams = sortExams(D.exams.map((y) => (y.id === data.id ? data : y))); renderLib();
  return data;
}
async function addToExam(ids, quiet) {
  const x = editX(); if (!x) return;
  let pos = Math.max(0, ...xItemsOf(x.id).map((it) => it.position));
  const rows = ids.filter((id) => !xItem(x.id, id)).map((id) => ({ set_id: x.id, sentence_id: id, position: ++pos }));
  if (!rows.length) { if (!quiet) toast('이미 이 세트에 들어 있는 문장이에요.'); return; }
  const { data, error } = await sb.from('drill_exam_items').insert(rows).select();
  if (error) return toast(errText(error), true);
  D.xitems.push(...data);
  if (!quiet) toast(`이 세트에 ${rows.length}문장을 넣었어요. (모두 ${xItemsOf(x.id).length}문장)`);
  renderLib();
}
async function moveInExam(x, sid, dir) {
  const items = xItemsOf(x.id), i = items.findIndex((it) => it.sentence_id === sid), j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return;
  const a = items[i], b = items[j];
  [a.position, b.position] = [b.position, a.position];
  if (a.position === b.position) { items.forEach((it, k) => { it.position = k + 1; }); [a.position, b.position] = [j + 1, i + 1]; }
  const ups = (a.position === b.position ? items : [a, b]).map((it) => sb.from('drill_exam_items').update({ position: it.position }).eq('set_id', it.set_id).eq('sentence_id', it.sentence_id));
  const res = await Promise.all(ups);
  const err = res.find((r) => r.error); if (err) toast(errText(err.error), true);
  renderLib();
}
function openXInfo(x, s) {
  const it = x && xItem(x.id, s.id); if (!it) return;
  openModal(`
    <div class="mh"><h3>서술형 정보</h3><button class="icon" data-close>✕</button></div>
    <div class="mb">
      <p class="small" style="margin:0 0 8px">${esc(examLabel(x))}</p>
      <p style="margin:0 0 14px;line-height:1.5">${esc(s.text)}</p>
      <div class="xl-h">출제 예상 유형 <span class="small">(여러 개 고를 수 있어요)</span></div>
      <div class="xtypes">${XTYPES.map((t) => `<label class="chk"><input type="checkbox" value="${t}" ${(it.types || []).includes(t) ? 'checked' : ''}> ${t}</label>`).join('')}</div>
      <label>핵심 포인트<input id="xiPoint" maxlength="120" value="${esc(it.point || '')}" placeholder="예: what → the thing which 바꿔 쓰기 / 관계부사 where 생략 불가"></label>
      <label>재생 전 읽어 줄 출처 <span class="small">— 비우면 문장 출처를 읽어요</span><input id="xiSay" maxlength="60" value="${esc(it.say_src || '')}" placeholder="${esc(sayLabel(s, null) || '예: 2026년 고이 9월 모의고사 29번')}"></label>
      <p class="small" id="xiSayPrev" style="margin:-4px 0 12px"></p>
      <div class="xl-h">출제 가능성</div>
      <div class="xseg" id="xiLevel">${[0, 1, 2, 3].map((v) => `<button type="button" data-v="${v}" class="${(it.level || 0) === v ? 'on' : ''}">${v ? '★'.repeat(v) : '미정'}</button>`).join('')}</div>
    </div>
    <div class="mf"><span class="grow"></span><button class="btn ghost" data-close>취소</button><button class="btn primary" id="xiSave">저장</button></div>`, 'sm');
  let level = it.level || 0;
  const n = xItemsOf(x.id).findIndex((y) => y.sentence_id === s.id) + 1;
  const prev = () => { const lab = $('xiSay').value.trim() || sayLabel(s, null); $('xiSayPrev').textContent = `🔊 "${n}번. ${lab ? lab + (/지문$/.test(lab) ? '' : ' 지문') : ''}." 라고 읽은 뒤 문장을 읽어요 (번호는 수업 목록 순서)`; };
  $('xiSay').oninput = prev; prev();
  $('xiLevel').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; level = Number(b.dataset.v); $('xiLevel').querySelectorAll('button').forEach((y) => y.classList.toggle('on', y === b)); };
  $('xiSave').onclick = async () => {
    const types = [...document.querySelectorAll('.xtypes input:checked')].map((i) => i.value);
    const patch = { types, point: $('xiPoint').value.trim() || null, level: level || null, say_src: $('xiSay').value.trim() || null };
    const { error } = await sb.from('drill_exam_items').update(patch).eq('set_id', x.id).eq('sentence_id', s.id);
    if (error) return toast(errText(error), true);
    Object.assign(it, patch); closeModal(); renderLib(); toast('서술형 정보를 저장했어요.');
  };
}
function examDefaults() {
  const d = new Date(Date.now() + 9 * 3600e3), m = d.getUTCMonth() + 1;
  // 3~5월 1학기 중간, 6~7월 1학기 기말, 8~10월 2학기 중간, 11~2월 2학기 기말
  const [term, exam] = m >= 3 && m <= 5 ? [1, 'mid'] : m >= 6 && m <= 7 ? [1, 'final'] : m >= 8 && m <= 10 ? [2, 'mid'] : [2, 'final'];
  return { year: m <= 2 ? d.getUTCFullYear() - 1 : d.getUTCFullYear(), term, exam };
}
function openExamSet(edit) {
  const df = edit || { ...examDefaults(), school: L.xschool || store.get('lastSchool', D.schools[0] ? D.schools[0].name : ''), grade: store.get('lastGrade', 2) };
  openModal(`
    <div class="mh"><h3>${edit ? '내신 세트 정보' : '새 내신 세트'}</h3><button class="icon" data-close>✕</button></div>
    <div class="mb">
      <div class="xgrid">
        <label>학교<select id="xsSchool">${D.schools.map((x) => `<option ${x.name === df.school ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="__new">+ 학교 추가…</option></select></label>
        <label id="xsNewWrap" hidden>새 학교 이름<input id="xsNew" maxlength="20" placeholder="예: 잠실고"></label>
        <label>학년<select id="xsGrade">${[1, 2, 3].map((g) => `<option value="${g}" ${g === Number(df.grade) ? 'selected' : ''}>${g}학년</option>`).join('')}</select></label>
        <label>연도<input id="xsYear" type="number" min="2000" max="2100" value="${df.year}"></label>
        <label>학기<select id="xsTerm"><option value="1" ${df.term === 1 ? 'selected' : ''}>1학기</option><option value="2" ${df.term === 2 ? 'selected' : ''}>2학기</option></select></label>
        <label>시험<select id="xsExam"><option value="mid" ${df.exam === 'mid' ? 'selected' : ''}>중간고사</option><option value="final" ${df.exam === 'final' ? 'selected' : ''}>기말고사</option></select></label>
      </div>
      <label>시험 범위 메모<textarea id="xsScope" rows="3" maxlength="500" placeholder="예: 교과서 3~4과 / 2026 고2 9월 모의고사 / 수능특강 영어 1~5강">${esc(edit ? edit.scope || '' : '')}</textarea></label>
      <label>ECHO 공개할 반 <span class="small">— 고르면 그 반 학생 화면의 '내신 서술형' 칸에 공개할 수 있어요</span><select id="xsClass"><option value="">반 목록 불러오는 중…</option></select></label>
    </div>
    <div class="mf">${edit ? '<button class="btn ghost" id="xsDel" style="color:var(--red,#c0392b)">세트 삭제</button>' : ''}<span class="grow"></span><button class="btn ghost" data-close>취소</button><button class="btn primary" id="xsGo">${edit ? '저장' : '만들고 문장 넣기'}</button></div>`, 'sm');
  $('xsSchool').onchange = () => { $('xsNewWrap').hidden = $('xsSchool').value !== '__new'; if (!$('xsNewWrap').hidden) $('xsNew').focus(); };
  loadHubClasses().then((list) => {
    const sel = $('xsClass'); if (!sel) return;
    const cur = edit ? (edit.class_code || '') : '';
    sel.innerHTML = '<option value="">공개 안 함 (선생님만)</option>' + list.map((c) => `<option value="${esc(c.code)}" ${c.code === cur ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  });
  if (edit) $('xsDel').onclick = async () => {
    if (!await confirmBox('내신 세트 삭제', `"${examLabel(edit)}" 세트를 지울까요? 문장 자체는 남고, 이 세트에 적은 서술형 정보와 학생 공개만 사라져요.`, '삭제', true)) return;
    const { error } = await sb.from('drill_exam_sets').delete().eq('id', edit.id);
    if (error) return toast(errText(error), true);
    D.exams = D.exams.filter((y) => y.id !== edit.id); D.xitems = D.xitems.filter((y) => y.set_id !== edit.id);
    if (L.exam === edit.id) setEditExam(null); else renderLib();
    toast('세트를 지웠어요.');
  };
  $('xsGo').onclick = async () => {
    let school = $('xsSchool').value;
    if (school === '__new') {
      school = $('xsNew').value.trim();
      if (!school) return toast('새 학교 이름을 적어 주세요.', true);
      if (!D.schools.some((x) => x.name === school)) {
        const { data, error } = await sb.from('drill_schools').insert({ name: school, position: D.schools.length + 1 }).select().single();
        if (error) return toast(errText(error), true);
        D.schools.push(data);
      }
    }
    const code = $('xsClass').value, cls = (HUB_CLASSES || []).find((c) => c.code === code);
    const row = { school, grade: Number($('xsGrade').value), year: Number($('xsYear').value), term: Number($('xsTerm').value), exam: $('xsExam').value,
      scope: $('xsScope').value.trim() || null, class_code: code || null, class_name: cls ? cls.name : null };
    if (!row.year || row.year < 2000 || row.year > 2100) return toast('연도를 확인해 주세요.', true);
    const same = D.exams.find((y) => y.school === row.school && y.grade === row.grade && y.year === row.year && y.term === row.term && y.exam === row.exam && (!edit || y.id !== edit.id));
    if (same) { closeModal(); setEditExam(same.id, true); return toast('같은 학교·시험 세트가 이미 있어서 그 세트를 열었어요.'); }
    store.set('lastSchool', school); store.set('lastGrade', row.grade);
    if (edit) {
      if (!code) row.published = false;
      const r = await patchExam(edit, row); if (r) { closeModal(); toast('세트 정보를 고쳤어요.'); }
      return;
    }
    const { data, error } = await sb.from('drill_exam_sets').insert(row).select().single();
    if (error) return toast(errText(error), true);
    D.exams = sortExams([...D.exams, data]);
    closeModal(); setEditExam(data.id, false);
    toast('세트를 만들었어요. 있던 문장은 체크해서 넣고, 새 문장은 + 새 문장으로 올리면 바로 들어가요.');
  };
}
$('examAddBtn').onclick = () => openExamSet(null);
$('selToExam').onclick = () => { addToExam(D.sents.filter((s) => L.sel.has(s.id)).map((s) => s.id)); L.sel.clear(); };
$('selOutExam').onclick = async () => {
  const x = editX(); if (!x) return;
  const ids = [...L.sel].filter((id) => xItem(x.id, id));
  if (!ids.length) return;
  const { error } = await sb.from('drill_exam_items').delete().eq('set_id', x.id).in('sentence_id', ids);
  if (error) return toast(errText(error), true);
  D.xitems = D.xitems.filter((it) => !(it.set_id === x.id && ids.includes(it.sentence_id)));
  L.sel.clear(); renderLib(); toast('이 세트에서 뺐어요. 문장 자체는 그대로 있어요.');
};
$('selToLesson').onclick = () => { addToLesson(D.sents.filter((s) => L.sel.has(s.id)).map((s) => s.id)); L.sel.clear(); };
$('selOutLesson').onclick = async () => {
  const l = editL(); if (!l) return;
  const out = new Set(L.sel); const items = (l.items || []).filter((id) => !out.has(id));
  if (await patchLesson(l, { items })) { L.sel.clear(); renderLib(); toast('이 수업에서 뺐어요. 문장 자체는 그대로 있어요.'); }
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
  let kind = O.mode === 'drill' ? 'show' : O.enView;   // 직독직해는 보기 옵션 없이 항상 보이기
  if (V.enHideFrom != null && k >= V.enHideFrom) kind = 'hide';
  if (kind === 'show') return esc(text);
  return wordsOf(text).map((w) => maskWord(w, kind)).join(' ');
}
function koVisible(k) {
  if (V.cue === k) return 'cue';
  if (V.koHideFrom != null) return k < V.koHideFrom ? 'on' : 'off';
  return (O.mode === 'drill' || O.koView === 'show') ? 'on' : 'off';
}
function renderStage() {
  const s = curSent();
  $('stNum').textContent = s ? `${C.idx + 1} / ${C.list.length}` : '–';
  $('stMeta').innerHTML = s ? `${s.category ? `<span class="tag cat">${esc(s.category)}</span>` : ''}${s.source_label ? `<span class="tag">${esc(s.source_label)}</span>` : ''}${(s.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}` : '';
  setStateText();
  if (!s) {
    $('stChunks').innerHTML = '<div class="empty-stage">왼쪽 <b>불러오기</b>에서 카테고리나 수업 기록을 고르거나,<br>문장 관리에서 문장을 골라 수업 목록에 넣으세요.</div>';
    return;
  }
  drawChunks();
}
function drawChunks() {
  const s = curSent(); if (!s) return;
  const ch = chunksOf(s), tap = O.mode !== 'full';
  $('stChunks').classList.toggle('tap', tap);
  $('stChunks').innerHTML = ch.map((c, k) => {
    const kv = koVisible(k);
    const dim = V.cur >= 0 && k !== V.cur;
    const a = tap ? ` data-k="${k}" role="button" tabindex="0" title="눌러서 이 부분 다시 듣기"` : '';
    return `<div class="ck ${k === V.cur ? 'cur' : ''} ${dim ? 'dim' : ''}"${a}><div class="e">${enHtml(c.en, k)}</div><div class="k ${kv === 'off' ? 'off' : ''} ${kv === 'cue' ? 'cue' : ''}">${esc(c.ko || '')}</div></div>`;
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
  $('auto').checked = !!O.auto;
  $('enView').hidden = $('koView').hidden = O.mode === 'drill';
  $('shadow').hidden = O.mode !== 'chunk';   // 듣기만/따라 말하기는 끊어듣기에서만
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
function setMode(m) { stop(); O.mode = m; saveOpts(); syncControls(); setStateText(); if (curSent()) drawChunks(); }
$('auto').onchange = (e) => { O.auto = e.target.checked; saveOpts(); };
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

let numFailed = false;
async function ensureNumbers() {
  if (numFailed) return false;
  const need = Math.min(80, C.list.length);
  if (D.num && D.num.voice === D.voices.en && D.num.upto >= need) return true;
  try {
    setStateText('번호 음성 준비 중…');
    const upto = Math.min(80, Math.ceil(need / 10) * 10);
    const r = await fn('numbers', { upto });
    D.num = { voice: r.voice, upto, paths: r.paths };
    return true;
  } catch (e) { numFailed = true; toast('번호 음성을 준비하지 못해 이번에는 번호 없이 재생해요. ' + errText(e), true); return false; }
}
/* 내신 세트 재생: 문장마다 "1번. 2026년 고이 9월 모의고사 29번 지문." 안내를 먼저 읽음 */
const KO_DIGIT = { 1: '일', 2: '이', 3: '삼' };
function sayLabel(s, it) {
  if (it && it.say_src) return it.say_src.trim();
  const src = s.source || {};
  let t = '';
  if (src.type === 'mock') t = `${src.year ? src.year + '년 ' : ''}${src.grade || ''} ${src.month ? src.month + '월 ' : ''}모의고사${src.no ? ' ' + src.no + '번' : ''}`;
  else if (src.type === 'csat') t = `${src.year ? src.year + '학년도 ' : ''}수능${src.no ? ' ' + src.no + '번' : ''}`;
  else t = srcLabel(s) || '';
  return squash(t.replace(/([고중])([123])(?![0-9])/g, (m, a, d) => a + KO_DIGIT[d]));
}
function sayText(i) {
  const s = byId(C.list[i]); if (!s) return '';
  const lab = sayLabel(s, xItem(C.examId, s.id));
  return lab ? `${i + 1}번. ${lab}${/지문$/.test(lab) ? '' : ' 지문'}.` : `${i + 1}번.`;
}
async function ensureSay() {
  D.say = D.say || {};
  const texts = C.list.map((_, i) => sayText(i)).filter(Boolean);
  const need = texts.filter((t) => !D.say[t]);
  if (!need.length) return true;
  try {
    setStateText('안내 음성 준비 중…');
    const r = await fn('say', { texts: need });
    Object.assign(D.say, r.paths || {});
    return need.some((t) => D.say[t]) || !need.length;
  } catch (e) { toast('출처 안내 음성을 준비하지 못해 이번에는 번호로 읽어요. ' + errText(e), true); return false; }
}
async function playSay(i, tok) {
  const p = D.say && D.say[sayText(i)];
  if (!p) return playNumber(i + 1, tok);
  const url = await audioUrl(p).catch(() => null);
  if (!url) return playNumber(i + 1, tok);
  if (!await seg(P.num, url, 0, null, 1, tok)) return false;
  return wait(450, tok);
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
  if (!await (C.examId && D.say ? playSay(C.idx, tok) : playNumber(C.idx + 1, tok))) return false;   // 항상 번호부터 (내신 세트는 '1번, ○○ 29번 지문')
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
        // 정답 영어를 듣고 한 번 더 소리 내어 따라 할 시간 (직독직해는 항상)
        if (!await wait(thinkMs(ch[k]), tok, '정답을 따라 말해 보세요')) return false;
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
    if (C.examId && examById(C.examId)) { if (!await ensureSay()) await ensureNumbers(); } else await ensureNumbers();
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
// 끊어듣기·직독직해: 의미구를 누르면 그 부분만 다시 (직독직해는 우리말 → 영어)
async function playPart(k) {
  const s = curSent(); if (!s || !s.audio_en) return;
  const te = (s.times_en || [])[k], tk = (s.times_ko || [])[k];
  if (!te) return toast('이 부분은 음성 구간 정보가 없어요. ↻로 음성을 다시 만들어 주세요.', true);
  stop();
  const tok = ++P.tok;
  V.cur = k; drawChunks(); setPlaying(true); setStateText(`${k + 1}번째 의미구 다시 듣기`);   // 재생 중으로 표시해야 ❚❚·Space로 일시정지됨
  try {
    if (O.mode === 'drill' && tk && s.audio_ko) {
      if (!await seg(P.ko, await audioUrl(s.audio_ko), tk[0], tk[1], 1, tok)) return;
      if (!await wait(400, tok)) return;
    }
    await seg(P.en, await audioUrl(s.audio_en), te[0], te[1], O.speed, tok);
  } catch (e) { if (tok === P.tok) toast(errText(e), true); }
  if (tok === P.tok) { setPlaying(false); V.cur = -1; drawChunks(); }
}
$('stChunks').addEventListener('click', (e) => { const c = e.target.closest('.ck[data-k]'); if (c) playPart(Number(c.dataset.k)); });
$('stChunks').addEventListener('keydown', (e) => { const c = e.target.closest('.ck[data-k]'); if (c && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); playPart(Number(c.dataset.k)); } });
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
  else if ((k === 'h' || k === 'H' || k === 'ㅗ') && O.mode !== 'drill') { O.enView = { show: 'initial', initial: 'hide', hide: 'show' }[O.enView]; saveOpts(); syncControls(); drawChunks(); }
  else if ((k === 'k' || k === 'K' || k === 'ㅏ') && O.mode !== 'drill') { O.koView = O.koView === 'show' ? 'hide' : 'show'; saveOpts(); syncControls(); drawChunks(); }
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
