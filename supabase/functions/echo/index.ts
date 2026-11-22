// ECHO · 수업 구문 다시듣기 — 허브(pif-hub, beacon-syntax 로그인)에서 부르는 함수
// 허브 로그인 토큰(x-hub-token)을 받아 허브에 직접 물어서(my_status / is_staff / can_manage_*) 누구인지 확인한다.
// 그래서 verify_jwt는 끔 (토큰이 이 프로젝트 것이 아님). 학생 데이터는 이 함수로만 오간다.
//
// 학생:  POST {op:'home'}                         우리 반 공개 수업 목록 + 내 기록
//        POST {op:'lesson', id | set:'all'|'star' | exam} 문장 + 음성 임시 주소(6시간)
//        POST {op:'log', lesson_id | exam_id, event:'open'|'play'|'complete'}
//        POST {op:'star', sentence_id, on}
// 허브 관리자: POST {op:'admin_student', student_id, class_code} / {op:'admin_class', class_code}
// 드릴 선생님(이 프로젝트 로그인): POST {op:'classes'}  허브 반 목록
import { createClient } from "npm:@supabase/supabase-js@2";

const HUB_URL = "https://ucacbqkmckucahvsowtu.supabase.co";
const HUB_KEY = "sb_publishable_Eh7x8AdkJx44szuHJtIbAQ__LmzxNac";   // 허브 공개키(브라우저에도 있는 값)
const BRIDGE_KEY = "__ECHO_BRIDGE_KEY__";                            // 배포할 때만 채움. 저장소에 넣지 말 것
const BUCKET = "drill-audio";
const URL_TTL = 6 * 3600;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function hubRpc(token: string, fn: string, args: Record<string, unknown> = {}) {
  const r = await fetch(`${HUB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: HUB_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`HUB_${r.status}`);
  return await r.json();
}
async function hubStudent(token: string) {
  const rows = await hubRpc(token, "my_status");
  const me = Array.isArray(rows) ? rows[0] : null;
  if (!me || me.status !== "approved" || !me.student_id) throw new Error("NOT_APPROVED");
  return me as { student_id: string; class_code: string; class_name: string; name: string };
}

async function voices(db: any) {
  const { data } = await db.from("drill_settings").select("value").eq("key", "voices").maybeSingle();
  return { en: "XrExE9yKIg1WjnnlVkGX", ko: "H9ihk5yaEtJLXjhBgRaF", ...(data?.value || {}) };
}
async function signMany(db: any, paths: string[]) {
  const uniq = [...new Set(paths.filter(Boolean))];
  const out: Record<string, string> = {};
  for (let i = 0; i < uniq.length; i += 100) {
    const { data } = await db.storage.from(BUCKET).createSignedUrls(uniq.slice(i, i + 100), URL_TTL);
    (data || []).forEach((d: any) => { if (d.signedUrl) out[d.path] = d.signedUrl; });
  }
  return out;
}
// 직독직해 시작 안내 음성: 밝고 경쾌한 목소리로 처음 한 번 만들어 저장해 두고 계속 씀
const INTRO_TEXT = "이제 우리말을 읽어 주면, 영어로 말해 보세요!";
const INTRO_VOICE = "6ZPN1uE51vVTtd32NM3q";   // 30대 한국 남성(R) — 밝고 또렷한 목소리 (안 되면 기본 우리말 목소리)
async function introPath(db: any, fallbackVoice: string) {
  const key = Deno.env.get("ELEVENLABS_API_KEY");
  for (const voice of [INTRO_VOICE, fallbackVoice]) {
    const v = String(voice).replace(/[^A-Za-z0-9]/g, "");
    const name = `drill-intro-${v}-3.mp3`, path = `sys/${name}`;
    try {
      const { data: list } = await db.storage.from(BUCKET).list("sys", { search: name, limit: 5 });
      if ((list || []).some((f: any) => f.name === name)) return path;
      if (!key) return null;
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v}?output_format=mp3_44100_128`, {
        method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ text: INTRO_TEXT, model_id: Deno.env.get("DRILL_TTS_MODEL") || "eleven_multilingual_v2",
          voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true } }),
      });
      if (!r.ok) { console.error("intro", v, r.status, (await r.text()).slice(0, 200)); continue; }
      const up = await db.storage.from(BUCKET).upload(path, new Uint8Array(await r.arrayBuffer()), { contentType: "audio/mpeg", upsert: true });
      if (!up.error) return path;
    } catch (e) { console.error("intro", (e as Error).message); }
  }
  return null;
}
const sentenceCols = "id, chunks, text, source, source_label, audio_en, audio_ko, times_en, times_ko";

// 내신 세트 안내 음성 "1번. 2026년 고이 9월 모의고사 29번 지문." — 구문 드릴(drill 함수)과 같은 규칙·같은 파일
const SAY_VOICE = "6ZPN1uE51vVTtd32NM3q";
const KO_DIGIT: Record<string, string> = { "1": "일", "2": "이", "3": "삼" };
function sayLabel(r: any, override?: string | null) {
  if (override && override.trim()) return override.trim();
  const src = r.source || {};
  let t = "";
  if (src.type === "mock") t = `${src.year ? src.year + "년 " : ""}${src.grade || ""} ${src.month ? src.month + "월 " : ""}모의고사${src.no ? " " + src.no + "번" : ""}`;
  else if (src.type === "csat") t = `${src.year ? src.year + "학년도 " : ""}수능${src.no ? " " + src.no + "번" : ""}`;
  else t = r.source_label || "";
  return t.replace(/([고중])([123])(?![0-9])/g, (_m: string, a: string, d: string) => a + KO_DIGIT[d]).replace(/\s+/g, " ").trim();
}
const sayText = (i: number, lab: string) => lab ? `${i + 1}번. ${lab}${/지문$/.test(lab) ? "" : " 지문"}.` : `${i + 1}번.`;
async function hash(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sayPaths(db: any, texts: string[], fallbackVoice: string) {
  const out: Record<string, string> = {};
  const key = Deno.env.get("ELEVENLABS_API_KEY");
  for (const voice of [SAY_VOICE, fallbackVoice]) {
    const vv = String(voice).replace(/[^A-Za-z0-9]/g, ""), dir = `say/${vv}`;
    const { data: list } = await db.storage.from(BUCKET).list(dir, { limit: 1000 });
    const have = new Set((list || []).map((f: any) => f.name));
    const todo: { t: string; p: string }[] = [];
    for (const t of texts) { if (out[t]) continue; const name = `${await hash("say|" + t)}.mp3`; if (have.has(name)) out[t] = `${dir}/${name}`; else todo.push({ t, p: `${dir}/${name}` }); }
    if (!todo.length || !key) break;
    let i = 0, failed = false;
    const worker = async () => {
      while (i < todo.length) {
        const x = todo[i++];
        try {
          const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vv}?output_format=mp3_44100_128`, {
            method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" },
            body: JSON.stringify({ text: x.t, model_id: Deno.env.get("DRILL_TTS_MODEL") || "eleven_multilingual_v2", voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true } }),
          });
          if (!r.ok) { failed = true; console.error("say", vv, r.status); continue; }
          const up = await db.storage.from(BUCKET).upload(x.p, new Uint8Array(await r.arrayBuffer()), { contentType: "audio/mpeg", upsert: true });
          if (!up.error) out[x.t] = x.p;
        } catch (e) { failed = true; console.error("say", (e as Error).message); }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (!failed) break;
  }
  return out;
}

const EXAM_NAME: Record<string, string> = { mid: "중간", final: "기말" };
const examLabel = (x: any) => `${x.school} ${x.grade}학년 ${x.term}학기 ${EXAM_NAME[x.exam] || ""}`;
// 내신 세트: 우리 반에 공개된 것 + 세트별 문장 순서
async function examsFor(db: any, classCode: string) {
  const { data: sets } = await db.from("drill_exam_sets").select("id, school, grade, year, term, exam, scope, class_code")
    .eq("class_code", classCode).eq("published", true).order("year", { ascending: false }).order("updated_at", { ascending: false });
  const ids = (sets || []).map((x: any) => x.id);
  const { data: items } = ids.length ? await db.from("drill_exam_items").select("set_id, sentence_id, position, types, point, level, say_src").in("set_id", ids).order("position") : { data: [] };
  return (sets || []).map((x: any) => ({ ...x, items: (items || []).filter((it: any) => it.set_id === x.id) }));
}
async function lessonsFor(db: any, classCode: string) {
  const { data } = await db.from("drill_lessons").select("id, title, lesson_date, items, class_code, published")
    .eq("class_code", classCode).eq("published", true).order("lesson_date", { ascending: false }).order("created_at", { ascending: false });
  return data || [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "METHOD" }, 405);
  // 허브 토큰은 x-hub-token 머리글로 받음 (Authorization은 이 프로젝트 게이트웨이용). 드릴 선생님(classes)은 Authorization
  const token = req.headers.get("x-hub-token") || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const drillToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "BAD_JSON" }, 400); }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    // ---------- 드릴 선생님: 허브 반 목록 ----------
    if (body.op === "classes") {
      const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${drillToken}` } } });
      const { data: ok } = await userClient.rpc("is_staff");
      if (ok !== true) return json({ error: "NOT_STAFF" }, 403);
      const r = await fetch(`${HUB_URL}/rest/v1/rpc/echo_bridge_classes`, { method: "POST", headers: { apikey: HUB_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ p_key: BRIDGE_KEY }) });
      if (!r.ok) throw new Error(`HUB_BRIDGE_${r.status}`);
      const rows = await r.json();
      return json({ classes: rows });
    }

    // ---------- 허브 관리자 ----------
    if (body.op === "admin_student" || body.op === "admin_class") {
      const code = String(body.class_code || "");
      const can = await hubRpc(token, "can_manage_class", { p_code: code });
      if (can !== true) return json({ error: "NOT_ALLOWED" }, 403);
      const lessons = await lessonsFor(db, code);
      const ids = lessons.map((l: any) => l.id);
      let q = db.from("drill_listens").select("student_id, lesson_id, plays, completed, last_at").in("lesson_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      if (body.op === "admin_student") q = q.eq("student_id", String(body.student_id || ""));
      const { data: listens } = await q;
      const exams = await examsFor(db, code);
      const xids = exams.map((x: any) => x.id);
      let xq = db.from("drill_exam_listens").select("student_id, set_id, plays, completed, last_at").in("set_id", xids.length ? xids : ["00000000-0000-0000-0000-000000000000"]);
      if (body.op === "admin_student") xq = xq.eq("student_id", String(body.student_id || ""));
      const { data: xlistens } = await xq;
      return json({ lessons: lessons.map((l: any) => ({ id: l.id, title: l.title, lesson_date: l.lesson_date, count: l.items.length })), listens: listens || [],
        exams: exams.map((x: any) => ({ id: x.id, label: examLabel(x), year: x.year, count: x.items.length })), exam_listens: xlistens || [] });
    }

    // ---------- 학생 ----------
    const me = await hubStudent(token);
    const sid = me.student_id;

    if (body.op === "home") {
      const lessons = await lessonsFor(db, me.class_code);
      const ids = lessons.map((l: any) => l.id);
      const [{ data: listens }, { data: stars }] = await Promise.all([
        db.from("drill_listens").select("lesson_id, plays, completed, last_at").eq("student_id", sid).in("lesson_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
        db.from("drill_student_stars").select("sentence_id").eq("student_id", sid),
      ]);
      // 수업마다 출처 한 줄 (첫 문장 기준)
      const firstIds = lessons.map((l: any) => l.items[0]).filter(Boolean);
      const { data: firsts } = firstIds.length ? await db.from("drill_sentences").select("id, source").in("id", firstIds) : { data: [] };
      const srcOf: Record<string, string> = {};
      (firsts || []).forEach((s: any) => {
        const x = s.source || {};
        let g = "";
        if (x.type === "mock") g = `${x.year} ${x.grade} ${x.month}월 모의고사`;
        else if (x.type === "csat") g = `${x.year}학년도 수능`;
        else if (x.type === "ebs" || x.type === "text") g = [x.book, x.unit].filter(Boolean).join(" ");
        else g = x.etc || "";
        srcOf[s.id] = g;
      });
      const all = new Set<string>(); lessons.forEach((l: any) => l.items.forEach((i: string) => all.add(i)));
      const exams = await examsFor(db, me.class_code);
      const xids = exams.map((x: any) => x.id);
      const { data: xl } = xids.length ? await db.from("drill_exam_listens").select("set_id, plays, completed").eq("student_id", sid).in("set_id", xids) : { data: [] };
      return json({
        exams: exams.map((x: any) => {
          const r = (xl || []).find((y: any) => y.set_id === x.id);
          return { id: x.id, label: examLabel(x), school: x.school, year: x.year, scope: x.scope || "", count: x.items.length,
            status: r ? (r.completed ? "done" : "opened") : "new", plays: r?.plays || 0 };
        }),
        name: me.name, class_name: me.class_name,
        lessons: lessons.map((l: any) => {
          const r = (listens || []).find((x: any) => x.lesson_id === l.id);
          return { id: l.id, title: l.title, lesson_date: l.lesson_date, count: l.items.length, source: srcOf[l.items[0]] || "",
            status: r ? (r.completed ? "done" : "opened") : "new", plays: r?.plays || 0 };
        }),
        total: all.size, stars: (stars || []).length,
      });
    }

    if (body.op === "lesson") {
      const lessons = await lessonsFor(db, me.class_code);
      let ids: string[] = [];
      let xinfo: Record<string, any> = {};
      if (body.exam) {
        const x = (await examsFor(db, me.class_code)).find((y: any) => y.id === String(body.exam));
        if (!x) return json({ error: "NOT_FOUND" }, 404);
        ids = x.items.map((it: any) => it.sentence_id);
        x.items.forEach((it: any) => { xinfo[it.sentence_id] = { types: it.types || [], point: it.point || "", level: it.level || 0, say: it.say_src || null }; });
      } else if (body.set === "all") { const seen = new Set<string>(); [...lessons].reverse().forEach((l: any) => l.items.forEach((i: string) => { if (!seen.has(i)) { seen.add(i); ids.push(i); } })); }
      else if (body.set === "star") {
        const allowed = new Set<string>(); lessons.forEach((l: any) => l.items.forEach((i: string) => allowed.add(i)));
        (await examsFor(db, me.class_code)).forEach((x: any) => x.items.forEach((it: any) => allowed.add(it.sentence_id)));
        const { data: st } = await db.from("drill_student_stars").select("sentence_id, created_at").eq("student_id", sid).order("created_at");
        ids = (st || []).map((x: any) => x.sentence_id).filter((i: string) => allowed.has(i));
      } else {
        const l = lessons.find((x: any) => x.id === String(body.id || ""));
        if (!l) return json({ error: "NOT_FOUND" }, 404);
        ids = l.items;
      }
      ids = ids.slice(0, 200);
      const { data: rows } = ids.length ? await db.from("drill_sentences").select(sentenceCols).in("id", ids) : { data: [] };
      const byId: Record<string, any> = {}; (rows || []).forEach((r: any) => { byId[r.id] = r; });
      const list = ids.map((i) => byId[i]).filter((r) => r && r.audio_en);
      const v = await voices(db);
      let nums = Array.from({ length: Math.min(list.length, 80) }, (_, i) => `num/${String(v.en).replace(/[^A-Za-z0-9]/g, "")}/${i + 1}.mp3`);
      if (body.exam && list.length) {   // 내신 세트는 번호 대신 "1번. ○○ 29번 지문."
        const texts = list.map((r: any, i: number) => sayText(i, sayLabel(r, xinfo[r.id] && xinfo[r.id].say)));
        const said = await sayPaths(db, texts.slice(0, 120), v.ko);
        nums = texts.map((t: string, i: number) => said[t] || nums[i] || "");
      }
      const intro = list.length ? await introPath(db, v.ko) : null;
      const urls = await signMany(db, [...list.flatMap((r: any) => [r.audio_en, r.audio_ko]), ...nums, ...(intro ? [intro] : [])]);
      const { data: st } = await db.from("drill_student_stars").select("sentence_id").eq("student_id", sid);
      const starred = new Set((st || []).map((x: any) => x.sentence_id));
      return json({
        sentences: list.map((r: any) => ({
          id: r.id, chunks: (r.chunks || []).filter((c: any) => c.en), source: r.source_label || "",
          en: urls[r.audio_en] || null, ko: r.audio_ko ? urls[r.audio_ko] || null : null,
          times_en: r.times_en || [], times_ko: r.times_ko || [], star: starred.has(r.id),
          ...(xinfo[r.id] ? { xtypes: xinfo[r.id].types, point: xinfo[r.id].point, level: xinfo[r.id].level } : {}),
        })),
        numbers: nums.map((p) => urls[p] || null),
        intro: intro ? urls[intro] || null : null,
      });
    }

    if (body.op === "log" && body.exam_id) {
      const xid = String(body.exam_id);
      if (!(await examsFor(db, me.class_code)).some((x: any) => x.id === xid)) return json({ ok: false });
      const { data: cur } = await db.from("drill_exam_listens").select("*").eq("student_id", sid).eq("set_id", xid).maybeSingle();
      const now = new Date().toISOString();
      const row: any = cur ? { ...cur } : { student_id: sid, set_id: xid, class_code: me.class_code, opened_at: now, plays: 0, completed: false };
      row.last_at = now;
      if (body.event === "play") row.plays = (row.plays || 0) + 1;
      if (body.event === "complete" && !row.completed) { row.completed = true; row.completed_at = now; }
      await db.from("drill_exam_listens").upsert(row);
      return json({ ok: true, completed: row.completed });
    }

    if (body.op === "log") {
      const lid = String(body.lesson_id || "");
      const lessons = await lessonsFor(db, me.class_code);
      if (!lessons.some((l: any) => l.id === lid)) return json({ ok: false });
      const { data: cur } = await db.from("drill_listens").select("*").eq("student_id", sid).eq("lesson_id", lid).maybeSingle();
      const now = new Date().toISOString();
      const row: any = cur ? { ...cur } : { student_id: sid, lesson_id: lid, class_code: me.class_code, opened_at: now, plays: 0, completed: false };
      row.last_at = now;
      if (body.event === "play") row.plays = (row.plays || 0) + 1;
      if (body.event === "complete" && !row.completed) { row.completed = true; row.completed_at = now; }
      await db.from("drill_listens").upsert(row);
      return json({ ok: true, completed: row.completed });
    }

    if (body.op === "star") {
      const id = String(body.sentence_id || "");
      if (body.on) await db.from("drill_student_stars").upsert({ student_id: sid, sentence_id: id });
      else await db.from("drill_student_stars").delete().eq("student_id", sid).eq("sentence_id", id);
      return json({ ok: true });
    }
    return json({ error: "BAD_OP" }, 400);
  } catch (e) {
    const m = String((e as Error).message || e);
    if (m === "NOT_APPROVED" || /HUB_40[13]/.test(m)) return json({ error: "NOT_APPROVED" }, 401);
    console.error("echo", m);
    return json({ error: m }, 500);
  }
});
