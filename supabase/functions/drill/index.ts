// PIF 구문 드릴 — 서버 기능 (선생님 전용)
// POST { op:'tts', id }                 문장 음성 생성(영어 전체 + 우리말 의미구), 의미구별 시간 계산 후 저장
// POST { op:'numbers', upto, voice? }   "Number 1." ~ "Number N." 음성 (없는 것만 생성, 저장해 두고 재사용)
// POST { op:'ai', lines:[...] }         의미구 끊기 + 우리말 뜻 + 태그 초안 (Claude)
// 비밀값: ELEVENLABS_API_KEY (필수, 음성), ANTHROPIC_API_KEY (AI 초안)
// 선택: DRILL_TTS_MODEL (기본 eleven_multilingual_v2), VT_AI_MODEL
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BUCKET = "drill-audio";
const TTS_MODEL = Deno.env.get("DRILL_TTS_MODEL") || "eleven_multilingual_v2";
const DEFAULT_VOICES = { en: "XrExE9yKIg1WjnnlVkGX", ko: "H9ihk5yaEtJLXjhBgRaF" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

type Chunk = { en: string; ko?: string };
type Span = [number, number] | null;

// ---------- ElevenLabs ----------
async function el(path: string, body: unknown): Promise<Response> {
  const key = Deno.env.get("ELEVENLABS_API_KEY");
  if (!key) throw new Error("NO_ELEVENLABS_KEY");
  const go = () => fetch(`https://api.elevenlabs.io${path}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let r = await go();
  if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1500)); r = await go(); }
  return r;
}

async function ttsWithTimes(voice: string, text: string, lang?: string) {
  const body: any = { text, model_id: TTS_MODEL, voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0, use_speaker_boost: true } };
  if (lang && (TTS_MODEL.includes("turbo") || TTS_MODEL.includes("flash"))) body.language_code = lang;
  const r = await el(`/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, body);
  if (!r.ok) throw new Error(`ELEVENLABS_${r.status}: ${(await r.text()).slice(0, 300)}`);
  const out = await r.json();
  const bin = Uint8Array.from(atob(out.audio_base64), (c) => c.charCodeAt(0));
  return { bytes: bin, al: out.alignment || out.normalized_alignment };
}

async function ttsPlain(voice: string, text: string) {
  const r = await el(`/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    text, model_id: TTS_MODEL, voice_settings: { stability: 0.6, similarity_boost: 0.75 },
  });
  if (!r.ok) throw new Error(`ELEVENLABS_${r.status}: ${(await r.text()).slice(0, 300)}`);
  return new Uint8Array(await r.arrayBuffer());
}

// 글자별 시간 → 의미구별 [시작, 끝] (의미구 사이 빈틈의 가운데에서 자름)
function chunkTimes(text: string, al: any, ranges: Span[]): ([number, number] | null)[] {
  const chars: string[] = al?.characters || [];
  const st: number[] = al?.character_start_times_seconds || [];
  const en: number[] = al?.character_end_times_seconds || [];
  const n = chars.length;
  if (!n) return ranges.map(() => null);
  const same = chars.join("") === text;
  const idx = (i: number) => same ? i : Math.min(n - 1, Math.round(i * (n - 1) / Math.max(1, text.length - 1)));
  const raw = ranges.map((rg) => {
    if (!rg) return null;
    let a = rg[0], b = rg[1] - 1;
    while (a <= b && /\s/.test(text[a])) a++;
    while (b >= a && /[\s.]/.test(text[b])) b--;
    if (a > b) return null;
    return [st[idx(a)], en[idx(b)]] as [number, number];
  });
  const total = en[n - 1] || 0;
  const valid = raw.map((r, i) => r ? i : -1).filter((i) => i >= 0);
  const out: ([number, number] | null)[] = raw.map(() => null);
  valid.forEach((i, k) => {
    const r = raw[i]!;
    const prev = k > 0 ? raw[valid[k - 1]]! : null;
    const next = k < valid.length - 1 ? raw[valid[k + 1]]! : null;
    const s = prev ? (prev[1] + r[0]) / 2 : Math.max(0, r[0] - 0.08);
    const e = next ? (r[1] + next[0]) / 2 : Math.min(total + 0.3, r[1] + 0.3);
    out[i] = [Math.round(s * 1000) / 1000, Math.round(e * 1000) / 1000];
  });
  return out;
}

function joinChunks(parts: (string | null)[], sep: string): { text: string; ranges: Span[] } {
  let text = "";
  const ranges: Span[] = [];
  for (const p of parts) {
    if (!p) { ranges.push(null); continue; }
    if (text) text += sep;
    const s = text.length;
    text += p;
    ranges.push([s, text.length]);
  }
  return { text, ranges };
}

async function hash(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function voices(admin: any) {
  const { data } = await admin.from("drill_settings").select("value").eq("key", "voices").maybeSingle();
  return { ...DEFAULT_VOICES, ...(data?.value || {}) };
}

async function handleTts(admin: any, body: any) {
  const id = String(body.id || "");
  const { data: row, error } = await admin.from("drill_sentences").select("*").eq("id", id).maybeSingle();
  if (error || !row) return json({ error: "NOT_FOUND" }, 404);
  const chunks: Chunk[] = (row.chunks || []).filter((c: Chunk) => String(c.en || "").trim());
  if (!chunks.length) return json({ error: "EMPTY" }, 400);
  const v = await voices(admin);
  const vEn = String(body.voice_en || v.en), vKo = String(body.voice_ko || v.ko);

  const en = joinChunks(chunks.map((c) => c.en.trim().replace(/\s+/g, " ")), " ");
  if (en.text.length > 900) return json({ error: "TOO_LONG" }, 400);
  const koParts = chunks.map((c) => {
    const k = String(c.ko || "").trim().replace(/\s+/g, " ");
    return k ? k.replace(/[.。\s]+$/, "") + "." : null;
  });
  const ko = joinChunks(koParts, " ");
  const key = await hash([TTS_MODEL, vEn, en.text, vKo, ko.text].join("|"));
  if (row.audio_key === key && row.audio_en && !body.force) {
    return json({ cached: true, audio_en: row.audio_en, times_en: row.times_en, audio_ko: row.audio_ko, times_ko: row.times_ko });
  }

  const jobs: Promise<any>[] = [ttsWithTimes(vEn, en.text, "en")];
  if (ko.text) jobs.push(ttsWithTimes(vKo, ko.text, "ko"));
  let res: any[];
  try { res = await Promise.all(jobs); } catch (e) { return json({ error: String((e as Error).message) }, 502); }

  const pathEn = `s/${id}/en-${key}.mp3`;
  const up1 = await admin.storage.from(BUCKET).upload(pathEn, res[0].bytes, { contentType: "audio/mpeg", upsert: true });
  if (up1.error) return json({ error: "UPLOAD", detail: up1.error.message }, 500);
  const timesEn = chunkTimes(en.text, res[0].al, en.ranges);
  let pathKo: string | null = null, timesKo: any = null;
  if (res[1]) {
    pathKo = `s/${id}/ko-${key}.mp3`;
    const up2 = await admin.storage.from(BUCKET).upload(pathKo, res[1].bytes, { contentType: "audio/mpeg", upsert: true });
    if (up2.error) return json({ error: "UPLOAD", detail: up2.error.message }, 500);
    timesKo = chunkTimes(ko.text, res[1].al, ko.ranges);
  }
  // 예전 파일 정리
  const old = [row.audio_en, row.audio_ko].filter((p: string | null) => p && p !== pathEn && p !== pathKo);
  if (old.length) await admin.storage.from(BUCKET).remove(old);

  const upd = { audio_en: pathEn, times_en: timesEn, audio_ko: pathKo, times_ko: timesKo, voice_en: vEn, voice_ko: vKo, audio_key: key };
  const { error: e2 } = await admin.from("drill_sentences").update(upd).eq("id", id);
  if (e2) return json({ error: "DB", detail: e2.message }, 500);
  return json({ cached: false, ...upd, chars: en.text.length + ko.text.length });
}

async function handleNumbers(admin: any, body: any) {
  const upto = Math.max(1, Math.min(80, Number(body.upto) || 1));
  const v = await voices(admin);
  const voice = String(body.voice || v.en).replace(/[^A-Za-z0-9]/g, "");
  const dir = `num/${voice}`;
  const { data: list } = await admin.storage.from(BUCKET).list(dir, { limit: 200 });
  const have = new Set((list || []).map((f: any) => f.name));
  const need: number[] = [];
  for (let n = 1; n <= upto; n++) if (!have.has(`${n}.mp3`)) need.push(n);
  let i = 0;
  const worker = async () => {
    while (i < need.length) {
      const n = need[i++];
      const bytes = await ttsPlain(voice, `Number ${n}.`);
      await admin.storage.from(BUCKET).upload(`${dir}/${n}.mp3`, bytes, { contentType: "audio/mpeg", upsert: true });
    }
  };
  try { await Promise.all([worker(), worker(), worker()]); } catch (e) { return json({ error: String((e as Error).message) }, 502); }
  const paths: Record<number, string> = {};
  for (let n = 1; n <= upto; n++) paths[n] = `${dir}/${n}.mp3`;
  return json({ voice, paths, generated: need.length });
}

// ---------- Claude: 의미구 초안 ----------
const AI_SYSTEM = `너는 PIF영어학원 고등부 '구문 수업'의 자료 조교다. 선생님이 수업할 영어 문장을 주면, 직독직해용 의미구(chunk)로 끊고 각 의미구의 우리말 뜻을 쓴다.
이 자료는 수업에서 '우리말 의미구를 들려주면 학생이 그 부분을 영어로 말해 보는' 드릴과 '영어 의미구를 듣고 바로 우리말로 이해하는' 직독직해에 쓰인다.
끊는 원칙:
- 의미 단위로 끊는다: 긴 주어부 / 동사(+목적어·보어) / 전치사구 / 관계절·분사구·to부정사구·명사절·부사절이 시작하는 곳.
- 너무 잘게 끊지 않는다. 한 의미구는 보통 3~7단어. 관사+명사, 짧은 동사+목적어는 붙인다.
- 문장부호는 앞 의미구에 붙인다. 원문 철자와 단어는 절대 바꾸지 않는다 (모든 의미구를 이으면 원문과 같아야 한다).
- 선생님이 이미 '/'로 끊어 준 문장은 그 경계를 그대로 쓰고 뜻만 쓴다.
우리말 뜻 원칙:
- 영어 어순대로 읽는 끊어읽기 해석. 그 의미구만 보고 학생이 영어를 떠올릴 수 있게, 그 의미구의 뜻을 빠짐없이 옮긴다.
- 관계절은 '~하는'처럼 앞 명사를 꾸미는 말로, 주어에는 '~은/는/이/가'를 붙이는 등 자연스러운 조사를 쓴다.
- 짧고 분명하게. 괄호 설명은 쓰지 않는다.
tags: 그 문장의 핵심 구문 포인트 1~3개를 한국어 문법 용어로 (예: 관계대명사, 분사구문, 가주어-진주어, 강조구문, 도치, 동격, 수동태, to부정사, 동명사, 명사절, 가정법, 비교구문, 병렬구조).
반드시 JSON 하나만 출력한다. 코드블록이나 다른 말은 쓰지 않는다.`;

async function claude(key: string, payload: any): Promise<Response> {
  const go = (p: any) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(p),
  });
  let r = await go(payload);
  if (r.status === 400 && payload.thinking) {
    const p2 = { ...payload, max_tokens: Math.max(payload.max_tokens, 8000) }; delete p2.thinking;
    r = await go(p2);
  }
  return r;
}

async function handleAi(body: any) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "NO_ANTHROPIC_KEY" }, 503);
  const lines = (Array.isArray(body.lines) ? body.lines : []).map((s: any) => String(s || "").trim().slice(0, 600)).filter(Boolean).slice(0, 20);
  if (!lines.length) return json({ error: "EMPTY" }, 400);
  const prompt = `문장 ${lines.length}개:\n${lines.map((l: string, i: number) => `${i + 1}. ${l}`).join("\n")}\n\nJSON: {"items":[{"no":1,"chunks":[{"en":"The students","ko":"그 학생들은"}],"tags":["관계대명사"]}]}`;
  const model = Deno.env.get("VT_AI_MODEL") || "claude-sonnet-5-5";
  const r = await claude(key, { model, max_tokens: 6000, thinking: { type: "between_tools" }, system: AI_SYSTEM, messages: [{ role: "user", content: prompt }] });
  if (!r.ok) { console.error("anthropic", r.status, (await r.text()).slice(0, 400)); return json({ error: "AI_UPSTREAM", status: r.status }, 502); }
  const out = await r.json();
  const text = (out.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  let parsed: any;
  try { parsed = JSON.parse(text.slice(s, e + 1)); } catch { return json({ error: "BAD_AI_OUTPUT" }, 502); }
  const items = (parsed.items || []).map((it: any) => ({
    no: Number(it.no),
    chunks: (it.chunks || []).map((c: any) => ({ en: String(c.en || "").trim(), ko: String(c.ko || "").trim() })).filter((c: Chunk) => c.en),
    tags: (it.tags || []).map((t: any) => String(t).trim()).filter(Boolean).slice(0, 4),
  }));
  return json({ items, model });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "METHOD" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") || "";
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: ok } = await userClient.rpc("is_staff");
  if (ok !== true) return json({ error: "NOT_STAFF" }, 403);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "BAD_JSON" }, 400); }
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    if (body.op === "tts") return await handleTts(admin, body);
    if (body.op === "numbers") return await handleNumbers(admin, body);
    if (body.op === "ai") return await handleAi(body);
    if (body.op === "ping") return json({ ok: true, eleven: !!Deno.env.get("ELEVENLABS_API_KEY"), claude: !!Deno.env.get("ANTHROPIC_API_KEY") });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
  return json({ error: "BAD_OP" }, 400);
});
