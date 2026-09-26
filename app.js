/* =====================================================================
   산불 대응 지휘 지원시스템 — 결과물 중심 시연 (app.js)
   화면 구성은 산림청 산불상황관제시스템·GPS단말기·항공기 위치추적 화면을 참고했다.
   지도(MapLibre) · 합성 확산 모델 · 규칙 판정 · 대응 제안(진화 7·대피 7) · 근거 열람 · AI 어시스턴트(질의·정정, 대본) · 채택 기록
   실제 ELMFIRE·RAG·LLM·기상 API는 없다. 모든 판단은 이 파일 안의 규칙과 템플릿이다.
   ===================================================================== */
(() => {
  "use strict";
  const S = window.SCENARIO;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fmt1 = (n) => (Math.round(n * 10) / 10).toString();
  const fmt0 = (n) => Math.round(n).toLocaleString("ko-KR");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const joinKo = (arr) => arr.join("·");
  const hasBatchim = (w) => { const c = String(w).replace(/[)\]"'\s]+$/, "").slice(-1).charCodeAt(0); return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : false; };
  const josa = (w, a, b) => `${w}${hasBatchim(w) ? a : b}`;
  const eul = (w) => josa(w, "을", "를"), eun = (w) => josa(w, "은", "는");
  const tip = (text, cls = "") => `<i class="info ${cls}" data-tip="${esc(text)}"></i>`;

  // ------------------------------------------------------------------ 시각
  const T0 = new Date(S.meta.t0);
  const START = new Date(S.incident.start_time);
  const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const hhmmss = (d) => `${hhmm(d)}:${String(d.getSeconds()).padStart(2, "0")}`;
  const ymd = (d) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  const addH = (d, h) => new Date(d.getTime() + h * 3600e3);
  const timeAt = (h) => hhmm(addH(T0, h));
  const parseHM = (s) => { const [h, m] = s.split(":").map(Number); const d = new Date(T0); d.setHours(h, m, 0, 0); return d; };
  const SUNSET = parseHM(S.astronomy.sunset), SUNRISE = parseHM(S.astronomy.sunrise);
  const isNight = (d) => d >= SUNSET || d < SUNRISE;
  const elapsed = (d) => { const m = Math.round((d - START) / 60e3); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
  const hm = (ms) => { const m = Math.round(ms / 60e3); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };

  // ------------------------------------------------------------------ 상태
  const state = {
    role: null, user: null, loginAt: null,
    t: 0, playing: false, timer: null,
    wind: { ms: S.weather.series[0].wind_ms, dir: S.weather.series[0].wind_dir },
    baseSlices: [], slices: [], whatif: false, compare: true, predicted: false,
    situation: { official_stage: S.incident.official_stage, alert_level: S.incident.alert_level, resources: clone(S.resources), field_report: clone(S.field_report), evacuation_state: clone(S.evacuation_state) },
    runs: [], currentRun: null, viewRun: null,
    decisions: JSON.parse(localStorage.getItem("mock.decisions") || "{}"),
    events: [], showActual: true, mockOnly: false, alerts: true,
    chatCtx: null, is3d: false, sat: true, axis: "진화", filter: "all", showNone: { "진화": false, "대피": false },
    prox: { heritage: true, shelter: true, care: false, crew: false, village: false, water: false },
    houses: null, markers: {}, emdLabels: []
  };

  // ------------------------------------------------------------------ 기하
  const [LNG0, LAT0] = S.incident.ignition;
  const MX = 111320 * Math.cos(LAT0 * Math.PI / 180), MY = 110540;
  const toM = (lng, lat) => [(lng - LNG0) * MX, (lat - LAT0) * MY];
  const fromM = (x, y) => [LNG0 + x / MX, LAT0 + y / MY];
  const distKm = (a, b) => { const [x1, y1] = toM(a[0], a[1]), [x2, y2] = toM(b[0], b[1]); return Math.hypot(x1 - x2, y1 - y2) / 1000; };
  const distFromFire = (lng, lat) => distKm(S.incident.ignition, [lng, lat]);
  function pointInRing(pt, ring) {
    const [x, y] = pt; let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside; }
    return inside;
  }
  function pointInGeom(pt, geom) {
    if (!geom) return false;
    if (geom.type === "Polygon") return pointInRing(pt, geom.coordinates[0]);
    if (geom.type === "MultiPolygon") return geom.coordinates.some((p) => pointInRing(pt, p[0]));
    return false;
  }
  function ringAreaHa(ring) {
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) { const [x1, y1] = toM(ring[i][0], ring[i][1]), [x2, y2] = toM(ring[i + 1][0], ring[i + 1][1]); a += x1 * y2 - x2 * y1; }
    return Math.abs(a) / 2 / 1e4;
  }
  function lineSamples(coords, stepM = 120) {
    const out = [];
    for (let i = 0; i < coords.length - 1; i++) { const a = coords[i], b = coords[i + 1], n = Math.max(1, Math.ceil(distKm(a, b) * 1000 / stepM)); for (let k = 0; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
    return out;
  }
  const lineHitsRing = (coords, ring) => lineSamples(coords).some((p) => pointInRing(p, ring));
  const firstSlice = (test) => { for (let t = 1; t <= 8; t++) if (test(state.slices[t - 1])) return t; return null; };
  const dirName = (deg) => ["북", "북북동", "북동", "동북동", "동", "동남동", "남동", "남남동", "남", "남남서", "남서", "서남서", "서", "서북서", "북서", "북북서"][Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  function firePolygon(tHours, wind) {
    const fm = S.fire_model, U = wind.ms;
    const head = fm.head[0] + fm.head[1] * U, flank = fm.flank[0] + fm.flank[1] * U, back = fm.back;
    const a = (head + back) / 2 * tHours, b = flank * tHours, c = (head - back) / 2 * tHours;
    const th = Math.PI / 2 - (wind.dir + 180) * Math.PI / 180;
    const ring = [];
    for (let i = 0; i <= 72; i++) {
      const phi = i / 72 * 2 * Math.PI;
      let x = c + a * Math.cos(phi), y = b * Math.sin(phi);
      const r = Math.hypot(x, y), al = Math.atan2(y, x);
      const m = 1 + fm.noise_amp * (0.55 * Math.sin(3 * al + 0.7) + 0.3 * Math.sin(7 * al + 2.1) + 0.15 * Math.sin(11 * al + 4.0));
      x = r * m * Math.cos(al); y = r * m * Math.sin(al);
      ring.push(fromM((x * Math.cos(th) - y * Math.sin(th)) * 1000, (x * Math.sin(th) + y * Math.cos(th)) * 1000));
    }
    ring[ring.length - 1] = ring[0];
    return ring;
  }
  const buildSlices = (wind) => Array.from({ length: 8 }, (_, i) => firePolygon(i + 1, wind));
  function f0Ring(rM = 150) { const r = []; for (let i = 0; i <= 36; i++) { const a = i / 36 * 2 * Math.PI; r.push(fromM(rM * Math.cos(a), rM * Math.sin(a))); } return r; }
  function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function genHouses() {
    const rnd = mulberry(7), out = [];
    S.villages.forEach((v) => { const n = Math.max(6, Math.round(v.hh / 3)); for (let i = 0; i < n; i++) { const r = 120 + rnd() * 330, a = rnd() * 2 * Math.PI; const [x, y] = toM(v.lng, v.lat); out.push({ v: v.id, pt: fromM(x + r * Math.cos(a), y + r * Math.sin(a)) }); } });
    return out;
  }
  function powerLineCoords() {
    const osm = (window.OSM_LINES || { features: [] }).features.filter((f) => f.properties.kind === "line");
    if (osm.length) return { name: "송전선(OSM)", real: true, coords: osm[0].geometry.coordinates, multi: osm };
    return S.power_line_fallback;
  }

  // ------------------------------------------------------------------ 규칙 판정
  const STAGES = S.stage_rules.area_ha.map((r) => r.stage);
  const stageByArea = (ha) => { for (const r of S.stage_rules.area_ha) if ((r.min == null || ha >= r.min) && (r.max == null || ha < r.max)) return r.stage; return STAGES[0]; };
  const stageIdx = (s) => Math.max(0, STAGES.indexOf(s));
  function computeRules(situation) {
    const sl = state.slices, P5 = sl[4], P8 = sl[7], es = situation.evacuation_state;
    const R = { t0: T0, sunset: S.astronomy.sunset, sunrise: S.astronomy.sunrise };
    R.areaByT = sl.map(ringAreaHa); R.areaP5 = R.areaByT[4]; R.areaP8 = R.areaByT[7];
    R.avgWind = S.weather.series.slice(0, 6).reduce((a, w) => a + w.wind_ms, 0) / 6;
    R.maxWind = S.weather.series.reduce((m, w) => (w.wind_ms > m.wind_ms ? w : m), S.weather.series[0]);
    R.spreadDir = dirName(state.wind.dir + 180);
    R.villages = S.villages.map((v) => { const arrival = firstSlice((ring) => pointInRing([v.lng, v.lat], ring)); const at = arrival ? addH(T0, arrival) : null; const zone = arrival == null ? "none" : arrival <= 5 ? "immediate" : "standby"; const status = es.completed_villages.includes(v.name) ? "completed" : es.unreached_villages.includes(v.name) ? "unreached" : null; return { ...v, arrival, arrivalTime: at ? hhmm(at) : null, zone, night: at ? isNight(at) : false, status }; });
    const byOrder = (a, b) => (a.arrival - b.arrival) || (b.elderly - a.elderly);
    R.immediate = R.villages.filter((v) => v.zone === "immediate").sort(byOrder);
    R.standby = R.villages.filter((v) => v.zone === "standby").sort(byOrder);
    R.ordered = [...R.immediate, ...R.standby];
    R.nightVillages = R.ordered.filter((v) => v.night);
    R.unreached = es.order_issued ? R.immediate.filter((v) => !es.completed_villages.includes(v.name)) : [];
    R.facilities = S.facilities.map((f) => ({ ...f, arrival: firstSlice((ring) => pointInRing([f.lng, f.lat], ring)) }));
    R.careIn = R.facilities.filter((f) => (f.type === "care" || f.type === "welfare") && f.arrival != null);
    R.heritageIn5 = R.facilities.filter((f) => (f.type === "heritage" || f.type === "temple") && f.arrival != null && f.arrival <= 5);
    R.heritageIn8 = R.facilities.filter((f) => (f.type === "heritage" || f.type === "temple") && f.arrival != null);
    const houses = state.houses;
    R.housesP5 = houses.filter((h) => pointInRing(h.pt, P5)).length;
    R.housesP8 = houses.filter((h) => pointInRing(h.pt, P8)).length;
    R.powerLine = powerLineCoords();
    R.powerIn = firstSlice((ring) => lineHitsRing(R.powerLine.coords, ring));
    R.shelters = S.shelters.map((s) => ({ ...s, inP8: pointInRing([s.lng, s.lat], P8), inP5: pointInRing([s.lng, s.lat], P5), load: 0, assigned: [] }));
    const safe = R.shelters.filter((s) => !s.inP8);
    R.assignments = [];
    R.ordered.forEach((v) => { const cand = safe.map((s) => ({ s, d: distKm([v.lng, v.lat], [s.lng, s.lat]) })).sort((a, b) => a.d - b.d); const pick = cand.find((c) => c.s.load + v.pop <= c.s.capacity) || cand[0]; if (!pick) return; pick.s.load += v.pop; pick.s.assigned.push(v.name); R.assignments.push({ village: v, shelter: pick.s, km: pick.d, minutes: Math.round(pick.d / 40 * 60) + 10, overflow: pick.s.load > pick.s.capacity }); });
    R.overflow = R.shelters.filter((s) => s.load > s.capacity);
    const conflict = S.routes.find((r) => r.kind === "conflict");
    R.routeConflict = !!conflict;
    R.routeInFire = conflict ? firstSlice((ring) => lineHitsRing(conflict.coords, ring)) : null;
    R.crewIn5 = situation.resources.crew_positions.filter((p) => pointInRing(p, P5)).length;
    R.crewTotal = situation.resources.crew_positions.length;
    R.recStageByArea = stageByArea(R.areaP5); R.recStage = R.recStageByArea;
    R.official = situation.official_stage;
    R.stageUp = stageIdx(R.recStage) > stageIdx(R.official);
    R.outOfScope = stageIdx(R.official) >= 2;
    const B = window.BOUNDARIES || { features: [] };
    const sig = B.features.find((f) => f.properties.level === "sigungu");
    R.crossesSigungu = sig ? P5.some((p) => !pointInGeom(p, sig.geometry)) : false;
    const emds = B.features.filter((f) => f.properties.level === "emd");
    R.emdIn5 = emds.filter((f) => P5.some((p) => pointInGeom(p, f.geometry)) || pointInGeom(S.incident.ignition, f.geometry)).map((f) => f.properties.name);
    if (!R.emdIn5.length) R.emdIn5 = [...new Set(R.immediate.map((v) => v.emd).concat(["안평면"]))];
    R.emdIn8 = emds.filter((f) => P8.some((p) => pointInGeom(p, f.geometry)) || pointInGeom(S.incident.ignition, f.geometry)).map((f) => f.properties.name);
    if (!R.emdIn8.length) R.emdIn8 = [...new Set(R.ordered.map((v) => v.emd).concat(["안평면"]))];
    R.nextHolder = R.recStage === "확산대응 2단계" || R.crossesSigungu ? "시·도지사(경상북도지사)" : null;
    R.heliOkNow = state.wind.ms < 15 && !isNight(T0);
    R.night5 = isNight(addH(T0, 5));
    R.cbsTargets = [...new Set(R.ordered.map((v) => v.emd))];
    R.cbsStage = es.order_issued ? "대피 명령" : R.immediate.length ? "대피 명령(발령 시)" : "산불 발생";
    R.injuries = es.injuries || [];
    R.isolated = [];
    return R;
  }

  // ------------------------------------------------------------------ 제안 생성(템플릿)
  const vn = (list) => (list.length ? joinKo(list.map((v) => v.name)) : "없음");
  const vnP = (list) => (list.length ? joinKo(list.map((v) => `${v.name}(P${v.arrival})`)) : "없음");
  const E = (keys) => keys.map((key, i) => ({ k: i + 1, key }));
  function buildProposal(R, situation) {
    const es = situation.evacuation_state, rs = situation.resources, fr = situation.field_report;
    const B = [];
    const none = (id) => ({ id, finding: "", status: ["(없음)"], text: "(없음)", targets: [], conflicts: [], evidence: [] });
    const cat = Object.fromEntries(S.catalog.map((c) => [c.id, c]));
    const push = (b) => { const c = cat[b.id]; B.push({ axis: c.axis, name: c.name, authority: c.authority, targets: [], conflicts: [], ref: {}, ...b }); };
    { const facCount = R.heritageIn5.length + R.careIn.filter((f) => f.arrival <= 5).length;
      const finding = `예상 피해면적(P5) ${fmt1(R.areaP5)} ha → ${R.recStageByArea} 기준 / 평균풍속 ${fmt1(R.avgWind)} m/s(기준값 미적용) / 시설피해 우려 주택 ${R.housesP5}동·주요시설 ${facCount}동 / 예상 진화시간 ${fr.expected_suppression_hours == null ? "미입력" : fr.expected_suppression_hours + "시간"} → 규칙 판정 ${R.recStage}, 공식 ${R.official}`;
      if (R.stageUp) { let text = `5시간 후 예상 피해면적 ${fmt1(R.areaP5)} ha는 ${R.recStage} 기준(${R.recStage === "확산대응 2단계" ? "100 ha 이상" : "10 ha 이상 100 ha 미만"})에 해당합니다 [1]. 산림청장과 대응단계 격상을 협의하십시오 [2].`; if (R.nextHolder) text += ` 격상되면 지휘권이 ${R.nextHolder}에게 넘어가므로 피해상황·투입 자원·추가 피해 가능성을 인계할 준비를 하십시오 [3].`; push({ id: "S1", finding, status: ["협의"], text, targets: ["산림청장"], evidence: E(["SM-p073", "SM-p022", "SM-p072"]) }); }
      else push({ ...none("S1"), finding, evidence: E(["SM-p073"]) }); }
    { const g1 = [...R.immediate.map((v) => v.name), ...R.careIn.filter((f) => f.arrival <= 5).map((f) => f.name)];
      const g2 = [...R.heritageIn5.map((f) => f.name), ...(R.powerIn && R.powerIn <= 5 ? [`송전선(P${R.powerIn})`] : [])];
      const g3 = R.housesP5 ? [`주택 ${R.housesP5}동`] : [];
      const finding = `P5 내 보호대상 ① 인명: ${g1.length ? joinKo(g1) : "없음"} ② 국가기간·군사·국가유산: ${g2.length ? joinKo(g2) : "없음"} ③ 재산: ${g3.length ? g3[0] : "없음"} ④·⑤ 산림: P5 ${fmt1(R.areaP5)} ha`;
      const order = [g1.length ? joinKo(g1) : null, g2.length ? joinKo(g2) : null, g3[0] || null].filter(Boolean);
      if (order.length) push({ id: "S2", finding, status: ["즉시"], text: `${order.join(" → ")} 순으로 진화 우선지역을 정하십시오 [1]. 인명·국가유산·고압선 피해 여부와 확대 가능성을 우선 판단하십시오 [2].`, targets: order, evidence: E(["SM-p077", "SM-p118"]), ref: { villages: R.immediate.map((v) => v.id), facilities: [...R.careIn, ...R.heritageIn5].map((f) => f.id), power: !!(R.powerIn && R.powerIn <= 5) } });
      else push({ ...none("S2"), finding, evidence: E(["SM-p077"]) }); }
    { const finding = `투입 헬기 ${rs.heli_deployed}대·지상 ${rs.ground_crew_deployed}명·소방차 ${rs.fire_trucks_deployed}대 / 인근 가용 헬기 ${rs.heli_available_nearby}대 / 진화율 ${fr.containment_pct}% / 진화구역 후보: 주 확산 방향(${R.spreadDir}) 1순위, 양 측면 2순위 / 소요 산식 없음`;
      push({ id: "S3", finding, status: ["즉시", "근거 부족"], text: `주 확산 방향인 ${R.spreadDir}쪽 구역(${vn(R.immediate)})에 지상진화 자원을 우선 배치하고, 진화전략도에 구역별 진화율을 반영해 재배치하십시오 [1]. 가용 진화헬기를 집중 투입하십시오 [2]. 추가 투입이 필요한 헬기 대수는 매뉴얼에 산정 기준이 없어 근거 부족입니다.`, targets: [`${R.spreadDir} 구역`], evidence: E(["SM-p041", "SM-p077"]), ref: { villages: R.immediate.map((v) => v.id), crew: true } }); }
    { const finding = `현재 풍속 ${state.wind.ms} m/s(${dirName(state.wind.dir)}풍) / 최대 ${R.maxWind.wind_ms} m/s(${R.maxWind.t}) / 헬기 운용 ${R.heliOkNow ? "가능" : "제한"} / 일몰 ${R.sunset}, t0+5h ${timeAt(5)}(${R.night5 ? "야간 포함" : "주간"})`;
      push({ id: "S4", finding, status: ["즉시"], text: `현재 풍속에서는 헬기 운용이 가능하므로 가용 헬기를 집중 투입하십시오 [1]. ${R.maxWind.t} 전후 풍속이 ${R.maxWind.wind_ms} m/s로 강해지는 시간대에는 지상진화에 집중할 준비를 하고, 일몰(${R.sunset}) 이후 풍속이 잦아드는 시간대에 집중 진화를 지시하십시오 [2].`, targets: ["전 진화자원"], evidence: E(["SM-p077", "SM-p078"]) }); }
    { const finding = `P5 내 주택 ${R.housesP5}동(P8 누적 ${R.housesP8}동) / 송전선 ${R.powerIn ? `P${R.powerIn} 통과` : "범위 밖"} / 취약시설 ${R.careIn.length ? joinKo(R.careIn.map((f) => `${f.name}(P${f.arrival})`)) : "없음"}`;
      const st = R.housesP5 ? ["즉시"] : []; if (R.powerIn) st.push("요청");
      let text = ""; if (R.housesP5) text += `${vn(R.immediate)} 주택군 주변에 소방차 등 진화장비를 집중 배치하고 인접 산림에 예비 살수를 지시하십시오 [1].`; if (R.powerIn) text += ` 송전선이 P${R.powerIn} 확산 범위를 지나므로 전류 차단과 우회선로 확보를 한전에 요청하십시오 [2].`;
      if (st.length) push({ id: "S5", finding, status: st, text, targets: [R.housesP5 ? "주택군(소방)" : null, R.powerIn ? "송전선(한전)" : null].filter(Boolean), evidence: E(["SM-p079", "SM-p095"]), ref: { villages: R.immediate.map((v) => v.id), power: !!R.powerIn, houses: true } });
      else push({ ...none("S5"), finding, evidence: E(["SM-p079"]) }); }
    { const finding = `걸친 시·군·구 ${R.crossesSigungu ? "2개 이상" : "1개(의성군)"}, 지휘권 변경 ${R.nextHolder ? "검토(" + R.nextHolder + ")" : "없음"} / 확산 범위 읍면 ${joinKo(R.emdIn5)} / 자원 부족분 산출 불가(소요 기준 없음) / 인접 시·군 가용 자원 미입력`;
      const st = R.immediate.length >= 2 ? ["요청"] : []; if (R.nextHolder) st.unshift("협의");
      let text = R.crossesSigungu ? `확산 범위가 인접 시·군에 걸치므로 지휘권이 시·도지사로 바뀌는지 협의하십시오 [1].` : `확산 범위가 의성군 안에 있어 걸친 행정구역에 따른 지휘권 변경은 없습니다 [1].`;
      if (R.immediate.length >= 2) text += ` 진화자원이 확산 정도에 미치지 못하면 인접 시·군의 진화자원과 소방·경찰·군의 인력·장비 동원을 요청하고, 산불현장 대책회의에서 기관별 임무를 부여하십시오 [2]. 요청 수량은 소요 기준이 없어 근거 부족입니다.`;
      push({ id: "S6", finding, status: st.length ? st : ["(없음)"], text: st.length ? text : "(없음)", targets: st.length ? ["인접 시·군", "소방·경찰·군"] : [], evidence: E(["SM-p072", "SM-p022"]) }); }
    { const finding = `진화인력 위치 ${R.crewTotal}개 조 중 P5 내 ${R.crewIn5}개 조 / 퇴로: 풍상측(${dirName(state.wind.dir)}) 도로 확보 / 풍향 급변 없음(예보 ${S.weather.series[0].wind_dir}°→${S.weather.series[8].wind_dir}°)`;
      push({ id: "S7", finding, status: ["즉시"], text: `P5 안에서 작업 중인 지상진화인력의 위치추적장치 휴대와 진화복·안전장구를 확인하고, 풍상측(${dirName(state.wind.dir)})으로 퇴로를 지정하십시오 [1]. ${R.maxWind.t} 전후 풍속이 최대가 되는 시간대에는 화선 전방(${R.spreadDir})으로의 투입을 제한하십시오 [2].`, targets: [`지상진화인력 ${rs.ground_crew_deployed}명`], evidence: E(["SM-p077", "SM-p118"]), ref: { crew: true } }); }
    { const finding = `위험구역(≤5h) ${vnP(R.immediate)} / 잠재 위험구역(≤8h) ${vnP(R.standby)}`;
      const st = []; if (R.immediate.length) st.push("즉시"); if (R.standby.length) st.push("대기");
      let text = ""; if (R.immediate.length) text += `${eul(vn(R.immediate))} 위험구역(즉시 실행)으로 설정하십시오 [1].`; if (R.standby.length) text += ` ${eul(vn(R.standby))} 잠재 위험구역(실행 대기)으로 설정하십시오 [1].`;
      push({ id: "E1", finding, status: st.length ? st : ["(없음)"], text: text || "(없음)", targets: R.ordered.map((v) => v.name), evidence: E(["SM-p074"]), ref: { villages: R.ordered.map((v) => v.id), risk: true } }); }
    { const ord = R.ordered.map((v) => `${v.name}(${v.arrivalTime} 도달, 고령 ${v.elderly})`).join(" → ");
      const finding = `순위 ${ord || "없음"} / 야간 포함 ${vn(R.nightVillages)} / 대피명령 ${es.order_issued ? "발령" : "미발령"} / 완료 ${es.completed_villages.length ? joinKo(es.completed_villages) : "없음"}`;
      let text = "", st = [];
      if (!R.ordered.length) push({ ...none("E2"), finding, evidence: E(["SM-p074"]) });
      else {
        const done = R.immediate.filter((v) => v.status === "completed"), toOrder = R.immediate.filter((v) => v.status !== "completed");
        if (!es.order_issued && toOrder.length) { st.push("즉시"); text += `${vn(toOrder)} 순으로 마을 단위 대피명령을 즉시 내리고 안전취약계층부터 대피시키십시오 [1][2].`; }
        if (!es.order_issued && done.length) text += ` ${eun(vn(done))} 대피 완료 보고가 있으므로 명령 대상에서 제외하고 완료 여부를 재확인하십시오 [3].`;
        if (es.order_issued) { st.push("즉시"); text += `대피명령이 발령된 상태입니다. ${R.unreached.length ? `미대피 마을 ${vn(R.unreached)}의 대피 완료를 확인하고 완료 보고를 받으십시오 [3].` : "위험구역 마을의 대피 완료 보고를 확인하십시오 [3]."}`; }
        if (R.standby.length) { st.push("대기"); text += ` ${eun(vn(R.standby))} 실행 대기로 두고 대피 준비를 지시하십시오 [1].`; }
        if (R.nightVillages.length) text += ` ${eun(joinKo(R.nightVillages.map((v) => `${v.name}(${v.arrivalTime})`)))} 화선 도달 예상 시각이 일몰(${R.sunset}) 이후이므로 일몰 전 사전대피를 지시하십시오 [1].`;
        push({ id: "E2", finding, status: st.length ? st : ["대기"], text, targets: R.ordered.map((v) => v.name), evidence: E(["SM-p074", "SM-p079", "SM-p084"]), ref: { villages: R.ordered.map((v) => v.id) } });
      } }
    { const finding = `취약시설 ${R.careIn.length ? joinKo(R.careIn.map((f) => `${f.name}(P${f.arrival}, ${f.capacity}명)`)) : "확산 범위 내 없음"} / 미대피 ${vn(R.unreached)} / 부상 ${R.injuries.length ? joinKo(R.injuries) : "없음"}`;
      let text = "", st = [];
      R.careIn.forEach((f) => { st.push(f.arrival <= 5 ? "즉시" : "대기"); text += `${f.name}(수용 ${f.capacity}명)이 P${f.arrival} 범위에 들므로 위험구역에 포함해 별도 이송을 지시하십시오 [1]. `; });
      if (R.unreached.length) { st.push("즉시"); text += `대피하지 않은 ${vn(R.unreached)} 주민은 강제로 대피시키십시오 [2].`; }
      st = [...new Set(st)];
      if (st.length) push({ id: "E3", finding, status: st, text: text.trim(), targets: [...R.careIn.map((f) => f.name), ...R.unreached.map((v) => v.name)], evidence: E(["SM-p074", "SM-p084"]), ref: { facilities: R.careIn.map((f) => f.id), villages: R.unreached.map((v) => v.id) } });
      else push({ ...none("E3"), finding, evidence: E(["SM-p074"]) }); }
    { const safe = R.shelters.filter((s) => !s.inP8), unsafe = R.shelters.filter((s) => s.inP8);
      const finding = `안전 대피소 ${joinKo(safe.map((s) => `${s.name}(${s.capacity})`))} / P8 안 대피소 ${unsafe.length ? joinKo(unsafe.map((s) => s.name)) : "없음"} / 배정 ${R.assignments.map((a) => `${a.village.name}→${a.shelter.name} ${a.shelter.load}/${a.shelter.capacity}`).join(", ") || "없음"} / 초과 ${R.overflow.length ? joinKo(R.overflow.map((s) => s.name)) : "없음"}`;
      if (R.assignments.length) {
        const byShelter = {}; R.assignments.forEach((a) => { (byShelter[a.shelter.name] = byShelter[a.shelter.name] || []).push(a); });
        const names = Object.keys(byShelter);
        let text = names.map((sn) => { const as = byShelter[sn]; return `${joinKo(as.map((a) => a.village.name))} 주민은 ${sn}(${as[0].shelter.load}/${as[0].shelter.capacity}명, 최대 ${Math.max(...as.map((a) => a.minutes))}분)`; }).join(", ") + (hasBatchim(names[names.length - 1]) ? "으로" : "로") + " 배정하십시오 [1].";
        if (unsafe.length) text += ` ${eun(joinKo(unsafe.map((s) => s.name)))} P8 범위 안이므로 대피소에서 제외하십시오 [2].`;
        if (R.overflow.length) text += ` ${eun(joinKo(R.overflow.map((s) => s.name)))} 수용 인원을 초과하므로 인접 대피소로 분산하십시오 [1].`;
        push({ id: "E4", finding, status: ["즉시"], text, targets: names, evidence: E(["SM-p065", "SM-p074"]), ref: { shelters: R.shelters.map((s) => s.id), villages: R.ordered.map((v) => v.id) } });
      } else push({ ...none("E4"), finding, evidence: E(["SM-p065"]) }); }
    { const finding = `대피로 A(박곡리→의성 실내체육관)가 진화차량 진입로와 겹침(가상 구간) / 겹침 구간 화선 도달 ${R.routeInFire ? `P${R.routeInFire}` : "8시간 내 없음"}`;
      let text = `대피로와 진화차량 진입로가 같은 구간을 쓰므로 경찰에 해당 구간의 교통통제(일방통행)와 주민대피 지원을 요청하십시오 [1].`; if (R.routeInFire) text += ` 겹침 구간이 P${R.routeInFire}에 확산 범위에 들므로 ${timeAt(R.routeInFire)} 전에 통제를 마치십시오 [2].`;
      push({ id: "E5", finding, status: ["요청"], text, targets: ["경찰(겹침 구간)"], conflicts: [{ type: "대피로·진입로 겹침", with: "진화자원 배치", resolution: "요청 전환" }], evidence: E(["SM-p119", "SM-p065"]), ref: { routes: ["evac-A", "access-1", "conflict"] } }); }
    { const finding = `대상 읍면동 ${joinKo(R.emdIn8)} / 송출 단계 ${R.cbsStage} / 송출 이력 ${es.cbs_sent.length ? es.cbs_sent.join(", ") : "없음"}`;
      if (R.ordered.length) push({ id: "E6", finding, status: ["즉시"], text: `${es.order_issued ? "대피명령 발령에 따라" : "대피명령과 동시에"} ${joinKo(R.emdIn8)}에 긴급재난문자(CBS)와 자막방송(DITS)을 대피 명령 단계로 송출하십시오 [1].`, targets: R.emdIn8, evidence: E(["SM-p078b"]) });
      else push({ ...none("E6"), finding, evidence: E(["SM-p078b"]) }); }
    { const finding = `고립 후보 ${R.isolated.length ? joinKo(R.isolated) : "없음"} / 부상 보고 ${R.injuries.length ? joinKo(R.injuries) : "없음"}`;
      if (R.injuries.length) push({ id: "E7", finding, status: ["요청"], text: `${joinKo(R.injuries)} 부상 보고에 따라 소방 긴급구조통제단에 구조·구급을 요청하십시오 [1][2].`, targets: ["소방(긴급구조통제단)"], evidence: E(["SM-p021", "SM-p119"]) });
      else push({ ...none("E7"), finding, evidence: E(["SM-p021"]) }); }
    return B;
  }
  function summarize(blocks) { const c = { "즉시": 0, "대기": 0, "협의": 0, "요청": 0, "보고": 0, "근거 부족": 0, "정보 부족": 0, "없음": 0 }; blocks.forEach((b) => b.status.forEach((s) => { const k = s === "(없음)" ? "없음" : s; if (k in c) c[k]++; })); return c; }
  let runSeq = 0;
  function generateProposal(reason) {
    const R = computeRules(state.situation), blocks = buildProposal(R, state.situation);
    runSeq++;
    const run = { id: `${runSeq}판`, seq: runSeq, createdAt: new Date(), reason, R, blocks, summary: summarize(blocks), snapshot: clone(state.situation), wind: { ...state.wind } };
    const prev = state.currentRun;
    run.changed = prev ? blocks.filter((b) => { const p = prev.blocks.find((x) => x.id === b.id); return !p || p.text !== b.text || p.status.join() !== b.status.join() || p.finding !== b.finding; }).map((b) => b.id) : [];
    state.runs.push(run); state.currentRun = run; state.viewRun = run;
    addEvent("제안", `대응 제안 ${run.id} 생성 (${reason}) — 즉시 ${run.summary["즉시"]}·대기 ${run.summary["대기"]}·협의 ${run.summary["협의"]}·요청 ${run.summary["요청"]}${run.changed.length ? ` · 변경 ${run.changed.length}건` : ""}`);
    renderAll();
    return run;
  }

  // ------------------------------------------------------------------ 아이콘 · 마커
  const svg = (paths) => `<svg viewBox="0 0 24 24">${paths}</svg>`;
  const ICONS = {
    house: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
    shelter: svg('<path d="M4 21V9l8-5 8 5v12"/><path d="M12 10v6M9 13h6"/>'),
    care: svg('<path d="M3 18V8M3 14h18v4"/><circle cx="7.5" cy="10.5" r="1.8"/><path d="M11 12h7a3 3 0 0 1 3 3"/>'),
    heritage: svg('<path d="M4 20h16M6 20v-5h12v5M5 15l7-4 7 4M12 4v3M4 9h16l-2 3H6z"/>'),
    school: svg('<path d="M3 9l9-4 9 4-9 4-9-4z"/><path d="M7 11v5c0 1 2.5 2 5 2s5-1 5-2v-5M21 9v5"/>'),
    crew: svg('<circle cx="12" cy="6.5" r="3"/><path d="M5 21a7 7 0 0 1 14 0"/>'),
    flame: svg('<path d="M12 3c1 3 4 4.5 4 8.5A4 4 0 0 1 8 11.5c0-1.2.4-2 .8-2.6.4 1.3 1.2 1.8 1.7 2C10 8 10.5 5 12 3z"/>'),
    bolt: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
    drop: svg('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>')
  };
  const ICON_COLOR = { village: "#e0a325", shelter: "#2e9e5b", care: "#d64f86", heritage: "#7b5cd6", school: "#2b8fc4", crew: "#f2f2f2", f0: "#e5341a", water: "#2f7fe0" };
  const CAT_OF = { village: "village", shelter: "shelter", care: "care", heritage: "heritage", school: "school", crew: "crew", water: "water" };
  const WATER = (window.WATER_SOURCES || []).map((w, i) => ({ ...w, id: `w${i}` }));

  let map;
  const EMPTY = { type: "FeatureCollection", features: [] };
  const fc = (feats) => ({ type: "FeatureCollection", features: feats });
  const poly = (ring, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [ring] } });
  const line = (coords, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } });
  const BASE_STYLE = "https://tiles.openfreemap.org/styles/liberty";
  const FALLBACK_STYLE = { version: 8, sources: { carto: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors © CARTO" } }, layers: [{ id: "carto", type: "raster", source: "carto" }] };
  const SAT_TILES = ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"];

  function initMap() {
    map = new maplibregl.Map({ container: "map", style: BASE_STYLE, center: [128.64, 36.38], zoom: 11.4, maxZoom: 18.5, maxPitch: 75, attributionControl: true });
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    let fellBack = false;
    map.on("error", (e) => { const msg = e && e.error ? String(e.error.message || e.error) : ""; if (!fellBack && !map.isStyleLoaded() && /style|fetch|network|403|404|Failed/i.test(msg)) { fellBack = true; toast("벡터 지도를 불러오지 못해 래스터 지도로 대체합니다."); map.setStyle(FALLBACK_STYLE); } });
    map.on("mousemove", (e) => { $("#coord").textContent = `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`; });
    map.on("zoom", () => { $("#ts-zoom").value = map.getZoom(); });
    map.on("load", () => {
      const firstSymbol = (map.getStyle().layers.find((l) => l.type === "symbol") || {}).id;
      const add = (id, data, layers) => { map.addSource(id, { type: "geojson", data }); layers.forEach((l) => map.addLayer({ source: id, ...l }, firstSymbol)); };
      map.addSource("sat", { type: "raster", tiles: SAT_TILES, tileSize: 256, maxzoom: 19, attribution: "Imagery: Esri, Maxar, Earthstar Geographics" });
      map.addLayer({ id: "sat", type: "raster", source: "sat", paint: { "raster-saturation": -0.1, "raster-brightness-min": 0.05 } }, firstSymbol);
      if (map.getLayer("building-3d")) { map.moveLayer("building-3d", firstSymbol); map.setLayerZoomRange("building-3d", 13, 24); map.setLayoutProperty("building-3d", "visibility", "none"); }
      if (map.getSource("openmaptiles") && !map.getLayer("building-3d")) map.addLayer({ id: "bld-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13, layout: { visibility: "none" }, paint: { "fill-extrusion-color": "#e3ddd2", "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6], "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0], "fill-extrusion-opacity": 0.9 } }, firstSymbol);
      map.addSource("dem", { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: "Terrain: AWS Terrain Tiles / Mapzen" });
      map.addLayer({ id: "hillshade", type: "hillshade", source: "dem", layout: { visibility: "none" }, paint: { "hillshade-exaggeration": 0.35 } }, firstSymbol);
      add("admin", window.BOUNDARIES || EMPTY, [
        { id: "admin-emd", type: "line", filter: ["==", ["get", "level"], "emd"], paint: { "line-color": "#ffffff", "line-width": 1.2, "line-dasharray": [3, 3], "line-opacity": 0.8 } },
        { id: "admin-sig", type: "line", filter: ["==", ["get", "level"], "sigungu"], paint: { "line-color": "#ffe066", "line-width": 2, "line-opacity": 0.9 } }
      ]);
      add("risk", EMPTY, [
        { id: "risk-8", type: "fill", filter: ["==", ["get", "z"], 8], paint: { "fill-color": "#ffd166", "fill-opacity": 0.14 } },
        { id: "risk-5", type: "fill", filter: ["==", ["get", "z"], 5], paint: { "fill-color": "#ff8f66", "fill-opacity": 0.18 } },
        { id: "risk-8-line", type: "line", filter: ["==", ["get", "z"], 8], paint: { "line-color": "#ffd166", "line-width": 1.4, "line-dasharray": [4, 3] } },
        { id: "risk-5-line", type: "line", filter: ["==", ["get", "z"], 5], paint: { "line-color": "#ff8f66", "line-width": 1.8 } }
      ]);
      add("osm-lines", window.OSM_LINES || EMPTY, [
        { id: "roads", type: "line", filter: ["in", ["get", "kind"], ["literal", ["motorway", "trunk", "primary", "secondary"]]], paint: { "line-color": ["match", ["get", "kind"], "motorway", "#ffb400", "primary", "#ffd966", "#ffffff"], "line-width": ["match", ["get", "kind"], "motorway", 2.6, "primary", 2, 1.4], "line-opacity": 0.85 } },
        { id: "rail", type: "line", filter: ["==", ["get", "kind"], "rail"], layout: { visibility: "none" }, paint: { "line-color": "#b0b0b0", "line-width": 2, "line-dasharray": [2, 2] } }
      ]);
      const pl = powerLineCoords();
      add("power", fc(pl.multi ? pl.multi : [line(pl.coords, { name: pl.name })]), [{ id: "power", type: "line", paint: { "line-color": "#ffe066", "line-width": 2.2, "line-dasharray": [1, 1.5] } }]);
      add("routes", fc(S.routes.map((r) => line(r.coords, { id: r.id, kind: r.kind, name: r.name }))), [
        { id: "route-access", type: "line", filter: ["==", ["get", "kind"], "access"], paint: { "line-color": "#ffffff", "line-width": 2.2, "line-dasharray": [2, 1.5], "line-opacity": 0.9 } },
        { id: "route-evac", type: "line", filter: ["==", ["get", "kind"], "evac"], paint: { "line-color": "#3d8bff", "line-width": 3.4, "line-opacity": 0.95 } },
        { id: "route-conflict", type: "line", filter: ["==", ["get", "kind"], "conflict"], paint: { "line-color": "#ff3b3b", "line-width": 7, "line-opacity": 0.55 } }
      ]);
      add("houses", fc(state.houses.map((h) => ({ type: "Feature", properties: { v: h.v }, geometry: { type: "Point", coordinates: h.pt } }))), [{ id: "houses", type: "circle", layout: { visibility: "none" }, paint: { "circle-radius": 2.6, "circle-color": "#ffcf7a", "circle-stroke-color": "#5a3a12", "circle-stroke-width": 0.6 } }]);
      add("fire-past", EMPTY, [{ id: "fire-past", type: "line", paint: { "line-color": "#ff5a2b", "line-width": 1, "line-opacity": 0.7 } }]);
      add("fire-cum", EMPTY, [{ id: "fire-cum-fill", type: "fill", paint: { "fill-color": "#ff4d1f", "fill-opacity": 0.4 } }, { id: "fire-cum-line", type: "line", paint: { "line-color": "#ff2a00", "line-width": 2.4 } }]);
      add("fire-next", EMPTY, [{ id: "fire-next", type: "line", paint: { "line-color": "#ffb347", "line-width": 1.8, "line-dasharray": [3, 2] } }]);
      add("fire-base", EMPTY, [{ id: "fire-base", type: "line", paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [1, 1] } }]);
      add("f0", fc([poly(f0Ring(), {})]), [{ id: "f0", type: "fill", paint: { "fill-color": "#ff2a00", "fill-opacity": 0.65 } }]);
      add("hi-line", EMPTY, [{ id: "hi-line", type: "line", paint: { "line-color": "#ffe066", "line-width": 7, "line-opacity": 0.6 } }]);
      makeMarkers();
      [["route-evac", "name"], ["route-access", "name"], ["route-conflict", "name"], ["power", "name"], ["roads", "name"]].forEach(([id, key]) => {
        map.on("click", id, (e) => { const p = e.features[0].properties; new maplibregl.Popup({ closeButton: false }).setLngLat(e.lngLat).setHTML(`<div class="map-popup"><b>${esc(p[key] || p.ref || "도로")}</b>${p.ref ? ` <span style="color:#666">${esc(p.ref)}</span>` : ""}</div>`).addTo(map); });
        map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
      });
      applyLayerVisibility(); applySat(); updateFireLayers();
    });
  }
  function markerEl(cls, icon, label, sub, lng, lat) {
    const el = document.createElement("div");
    el.className = `mk ${cls}`; el.dataset.cat = CAT_OF[cls] || cls;
    const d = lng != null ? distFromFire(lng, lat) : null;
    el.innerHTML = `<span class="ico" style="background:${ICON_COLOR[cls] || "#999"}">${ICONS[icon]}</span><span class="lb">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>${d != null && cls !== "f0" ? `<span class="dist">${d.toFixed(2)}km</span>` : ""}`;
    return el;
  }
  function makeMarkers() {
    const M = state.markers;
    S.villages.forEach((v) => { const el = markerEl("village", "house", v.name, `${v.pop}명`, v.lng, v.lat); el.addEventListener("click", () => showVillagePopup(v)); M[`v:${v.id}`] = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([v.lng, v.lat]).addTo(map); });
    S.facilities.forEach((f) => { const cls = f.type === "care" || f.type === "welfare" ? "care" : f.type === "heritage" || f.type === "temple" ? "heritage" : "school"; const el = markerEl(cls, cls, f.name, f.capacity ? `${f.capacity}명` : "", f.lng, f.lat); el.addEventListener("click", () => popup([f.lng, f.lat], `<b>${esc(f.name)}</b><br>발화점 거리 ${distFromFire(f.lng, f.lat).toFixed(2)} km<br>${esc(f.note || "")}`)); M[`f:${f.id}`] = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([f.lng, f.lat]).addTo(map); });
    S.shelters.forEach((s) => { const el = markerEl("shelter", "shelter", s.name, `수용 ${s.capacity}`, s.lng, s.lat); el.addEventListener("click", () => showShelterPopup(s)); M[`s:${s.id}`] = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([s.lng, s.lat]).addTo(map); });
    S.resources.crew_positions.forEach((p, i) => { const el = markerEl("crew", "crew", `진화조 ${i + 1}`, "", p[0], p[1]); el.style.display = "none"; M[`c:${i}`] = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(p).addTo(map); });
    WATER.slice(0, 25).forEach((w) => { const el = markerEl("water", "drop", w.name, w.type === "reservoir" ? "저수지" : "수역", w.lng, w.lat); el.addEventListener("click", () => popup([w.lng, w.lat], `<b>${esc(w.name)}</b> <span style="color:#666">담수지 후보</span><br>발화점 거리 ${w.d.toFixed(2)} km · OSM 수역(${esc(w.type)})<br><span style="color:#666">헬기 담수 가능 여부(수심·접근성)는 확인되지 않음</span>`)); M[`w:${w.id}`] = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([w.lng, w.lat]).addTo(map); });
    M["f0"] = new maplibregl.Marker({ element: markerEl("f0", "flame", "산불 발화점", hhmm(START)), anchor: "bottom" }).setLngLat(S.incident.ignition).addTo(map);
    (window.BOUNDARIES || EMPTY).features.filter((f) => f.properties.level === "emd").forEach((f) => { const ring = f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates.sort((a, b) => b[0].length - a[0].length)[0][0]; const c = ring.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]).map((x) => x / ring.length); const el = document.createElement("div"); el.className = "mk emd"; el.textContent = f.properties.name; state.emdLabels.push(new maplibregl.Marker({ element: el }).setLngLat(c).addTo(map)); });
    applyDist();
  }
  const popup = (lngLat, html) => new maplibregl.Popup({ closeButton: true, maxWidth: "280px" }).setLngLat(lngLat).setHTML(`<div class="map-popup">${html}</div>`).addTo(map);
  function showVillagePopup(v) {
    const R = state.viewRun && state.viewRun.R; const rv = R && R.villages.find((x) => x.id === v.id);
    const zone = rv ? (rv.zone === "immediate" ? `위험구역 · ${rv.arrivalTime} 도달 예상` : rv.zone === "standby" ? `잠재 위험구역 · ${rv.arrivalTime} 도달 예상` : "8시간 내 도달 없음") : "예측 전";
    const as = R && R.assignments.find((a) => a.village.id === v.id);
    popup([v.lng, v.lat], `<b>${esc(v.name)}</b> <span style="color:#666">${esc(v.emd)}</span><br>발화점 거리 ${distFromFire(v.lng, v.lat).toFixed(2)} km · 인구 ${v.pop} · 고령 ${v.elderly}<br>${zone}${as ? `<br>배정 대피소 ${esc(as.shelter.name)} (${as.km.toFixed(1)} km, 약 ${as.minutes}분)` : ""}${v.note ? `<br><span style="color:#666">${esc(v.note)}</span>` : ""}<br><a href="#" data-goto="E2">대피 제안 보기</a>`);
    setTimeout(() => { const a = document.querySelector(".maplibregl-popup a[data-goto]"); if (a) a.onclick = (e) => { e.preventDefault(); showTab("proposal"); focusCard("E2", true); }; }, 0);
  }
  function showShelterPopup(s) {
    const R = state.viewRun && state.viewRun.R; const rs = R && R.shelters.find((x) => x.id === s.id);
    popup([s.lng, s.lat], `<b>${esc(s.name)}</b><br>발화점 거리 ${distFromFire(s.lng, s.lat).toFixed(2)} km · 수용 ${s.capacity}명${rs ? `<br>${rs.inP8 ? '<span style="color:#c33">8시간 확산 범위 안 — 대피소 제외</span>' : "안전"} · 배정 ${rs.load}명${rs.assigned.length ? ` (${esc(rs.assigned.join("·"))})` : ""}` : ""}${s.note ? `<br><span style="color:#666">${esc(s.note)}</span>` : ""}`);
  }
  function updateFireLayers() {
    if (!map || !map.getSource("fire-cum")) return;
    const t = state.t, sl = state.slices;
    if (!state.predicted || !sl.length) { ["fire-cum", "fire-past", "fire-next", "fire-base", "risk"].forEach((id) => map.getSource(id).setData(EMPTY)); return; }
    map.getSource("fire-cum").setData(fc([poly(t === 0 ? f0Ring(220) : sl[t - 1], { t })]));
    map.getSource("fire-past").setData(fc(sl.slice(0, Math.max(0, t - 1)).map((r, i) => poly(r, { t: i + 1 }))));
    map.getSource("fire-next").setData(fc(t < 8 ? [poly(sl[t], { t: t + 1 })] : []));
    map.getSource("fire-base").setData(fc(state.whatif && state.compare && t > 0 ? [poly(state.baseSlices[t - 1], {})] : []));
    map.getSource("risk").setData(fc([poly(sl[7], { z: 8 }), poly(sl[4], { z: 5 })]));
    S.villages.forEach((v) => state.markers[`v:${v.id}`].getElement().classList.toggle("burned", t > 0 && pointInRing([v.lng, v.lat], sl[t - 1])));
    S.shelters.forEach((s) => state.markers[`s:${s.id}`].getElement().classList.toggle("unsafe", pointInRing([s.lng, s.lat], sl[7])));
  }
  const layerOn = (id) => { const b = document.querySelector(`.lyr-btn[data-layer="${id}"]`); return !b || !b.classList.contains("off"); };
  function applyLayerVisibility() {
    if (!map || !map.getLayer("roads")) return;
    const set = (layers, v) => layers.forEach((l) => map.getLayer(l) && map.setLayoutProperty(l, "visibility", v ? "visible" : "none"));
    set(["fire-cum-fill", "fire-cum-line", "fire-past", "fire-next", "fire-base", "f0"], layerOn("fire"));
    set(["risk-5", "risk-8", "risk-5-line", "risk-8-line"], layerOn("risk"));
    set(["houses"], layerOn("houses")); set(["roads"], layerOn("roads")); set(["rail"], layerOn("rail")); set(["power"], layerOn("power"));
    set(["route-access", "route-evac", "route-conflict"], layerOn("routes"));
    set(["admin-emd", "admin-sig"], layerOn("admin"));
    const show = (prefix, v) => Object.entries(state.markers).forEach(([k, m]) => { if (k.startsWith(prefix)) m.getElement().style.display = v ? "" : "none"; });
    show("v:", layerOn("villages")); show("s:", layerOn("shelters")); show("c:", layerOn("crew")); show("w:", layerOn("water"));
    Object.entries(state.markers).forEach(([k, m]) => { if (k.startsWith("f:")) { const el = m.getElement(); el.style.display = (el.classList.contains("heritage") ? layerOn("heritage") : layerOn("care")) ? "" : "none"; } });
    state.emdLabels.forEach((m) => (m.getElement().style.display = layerOn("admin") ? "" : "none"));
    applyDist();
  }
  function applyDist() { const on = layerOn("dist"); Object.values(state.markers).forEach((m) => { const el = m.getElement(); const cat = el.dataset.cat; el.classList.toggle("show-dist", on && !!state.prox[cat]); }); }
  function applySat() { if (!map || !map.getLayer("sat")) return; map.setLayoutProperty("sat", "visibility", state.sat ? "visible" : "none"); map.setLayoutProperty("hillshade", "visibility", state.sat ? "none" : "visible"); $("#ts-sat").classList.toggle("on", state.sat); document.body.classList.toggle("satmap", state.sat); }
  function set3d(on) {
    state.is3d = on; $("#ts-3d").classList.toggle("on", on);
    const bld = map.getLayer("building-3d") ? "building-3d" : map.getLayer("bld-3d") ? "bld-3d" : null;
    if (bld) map.setLayoutProperty(bld, "visibility", on ? "visible" : "none");
    if (on) { map.setTerrain({ source: "dem", exaggeration: 1.5 }); map.easeTo({ pitch: 62, bearing: -25, zoom: Math.max(map.getZoom(), 14.2), center: map.getZoom() < 13 ? S.incident.ignition : map.getCenter(), duration: 1100 }); toast("3D 지형·건물 표시 — 건물은 OpenStreetMap 건물 외곽선 기준(높이 정보가 없으면 6 m)", 3500); }
    else { map.setTerrain(null); map.easeTo({ pitch: 0, bearing: 0, duration: 700 }); }
  }
  function fitAll() {
    const pts = state.predicted ? state.slices[7] : S.villages.map((v) => [v.lng, v.lat]);
    const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
    S.shelters.forEach((s) => b.extend([s.lng, s.lat]));
    const w = map.getContainer().clientWidth, h = map.getContainer().clientHeight;
    const infoOpen = $("#info-panel").classList.contains("on"), leftOpen = $("#left-panel").classList.contains("on");
    map.fitBounds(b, { padding: w > 1000 && h > 600 ? { top: 70, bottom: 60, left: leftOpen ? 330 : 40, right: infoOpen ? 480 : 80 } : 30, maxZoom: 13, duration: 800 });
  }
  function highlight(ref, fly) {
    Object.values(state.markers).forEach((m) => m.getElement().classList.remove("hi"));
    (ref.villages || []).forEach((id) => state.markers[`v:${id}`] && state.markers[`v:${id}`].getElement().classList.add("hi"));
    (ref.shelters || []).forEach((id) => state.markers[`s:${id}`] && state.markers[`s:${id}`].getElement().classList.add("hi"));
    (ref.facilities || []).forEach((id) => state.markers[`f:${id}`] && state.markers[`f:${id}`].getElement().classList.add("hi"));
    if (ref.crew) Object.entries(state.markers).forEach(([k, m]) => k.startsWith("c:") && m.getElement().classList.add("hi"));
    const lines = [];
    if (ref.routes) S.routes.filter((r) => ref.routes.includes(r.id)).forEach((r) => lines.push(line(r.coords)));
    if (ref.power) { const pl = powerLineCoords(); (pl.multi || [line(pl.coords)]).forEach((f) => lines.push(f.geometry ? f : line(f))); }
    if (map && map.getSource("hi-line")) map.getSource("hi-line").setData(fc(lines));
    if (fly && map) {
      const pts = [];
      (ref.villages || []).forEach((id) => { const v = S.villages.find((x) => x.id === id); v && pts.push([v.lng, v.lat]); });
      (ref.shelters || []).forEach((id) => { const s = S.shelters.find((x) => x.id === id); s && pts.push([s.lng, s.lat]); });
      (ref.facilities || []).forEach((id) => { const f = S.facilities.find((x) => x.id === id); f && pts.push([f.lng, f.lat]); });
      lines.forEach((l) => pts.push(...l.geometry.coordinates));
      if (ref.crew) pts.push(...S.resources.crew_positions);
      if (pts.length) { const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0])); const infoOpen = $("#info-panel").classList.contains("on"); map.fitBounds(b, { padding: { top: 90, bottom: 80, left: 80, right: infoOpen ? 500 : 100 }, maxZoom: 13.5, duration: 700 }); }
    }
  }
  const clearHighlight = () => highlight({}, false);

  // ------------------------------------------------------------------ 재생 · 예측 · 조건 변경
  function setT(t) {
    state.t = Math.max(0, Math.min(8, t)); $("#time-slider").value = state.t;
    const d = addH(T0, state.t);
    $("#time-label").innerHTML = `${hhmm(d)}<small>발화 후 ${elapsed(d)}${isNight(d) ? " · 야간" : ""}</small>`;
    $("#ip-clock").textContent = `${ymd(d)} ${hhmmss(d)}`;
    updateFireLayers();
  }
  function play() {
    if (!state.predicted) { toast("먼저 「확산 예측 실행」을 누르십시오."); return; }
    if (state.playing) { pause(); return; }
    if (state.t >= 8) setT(0);
    state.playing = true; $("#btn-play").innerHTML = svg('<path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none"/>');
    const step = () => { if (state.t >= 8) { pause(); return; } setT(state.t + 1); state.timer = setTimeout(step, 1400 / Number($("#speed-sel").value)); };
    state.timer = setTimeout(step, 600);
  }
  function pause() { state.playing = false; clearTimeout(state.timer); $("#btn-play").innerHTML = svg('<path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none"/>'); }
  function runPrediction(auto) {
    if (state.role !== "decision" && !auto) return;
    pause();
    const btn = $("#btn-predict"), bar = $("#predict-progress"), st = $("#predict-status");
    btn.disabled = true; let p = 0;
    const steps = ["입력 검증(발화점·t0·기상)", "기상 자료 조회", "확산 모델 실행", "시간대별 결과 검증", "규칙 판정·제안 생성"];
    const tick = () => {
      p += auto ? 34 : 9; bar.style.width = Math.min(100, p) + "%"; st.textContent = steps[Math.min(steps.length - 1, Math.floor(p / 21))] + "…";
      if (p < 100) setTimeout(tick, auto ? 60 : 180);
      else {
        state.wind = { ms: S.weather.series[0].wind_ms, dir: S.weather.series[0].wind_dir };
        state.baseSlices = buildSlices(state.wind); state.slices = state.baseSlices; state.whatif = false; state.predicted = true;
        st.textContent = `완료 · 5h ${fmt0(ringAreaHa(state.slices[4]))} ha · 8h ${fmt0(ringAreaHa(state.slices[7]))} ha · 주 방향 ${dirName(state.wind.dir + 180)}`;
        btn.disabled = false; btn.textContent = "다시 예측";
        addEvent("예측", `확산 예측 갱신 — 5h ${fmt0(ringAreaHa(state.slices[4]))} ha, 8h ${fmt0(ringAreaHa(state.slices[7]))} ha`);
        setT(0); generateProposal("예측 갱신");
        if (!auto) { toast("예측이 끝나 대응 제안이 생성되었습니다."); fitAll(); }
      }
    };
    tick();
  }
  function applyWhatIf() {
    if (!state.predicted) { toast("먼저 「확산 예측 실행」을 누르십시오."); return; }
    state.wind = { ms: Number($("#wi-wind").value), dir: Number($("#wi-dir").value) };
    state.slices = buildSlices(state.wind); state.whatif = true; state.compare = $("#wi-compare").checked;
    $("#predict-status").textContent = `조건 변경 · ${state.wind.ms} m/s ${dirName(state.wind.dir)}풍 · 5h ${fmt0(ringAreaHa(state.slices[4]))} ha · 8h ${fmt0(ringAreaHa(state.slices[7]))} ha`;
    updateFireLayers(); toast("조건 변경 결과를 겹쳐 표시합니다. 제안은 기본 예측 기준으로 유지됩니다.");
  }
  function resetWhatIf() {
    if (!state.predicted) return;
    state.wind = { ms: S.weather.series[0].wind_ms, dir: S.weather.series[0].wind_dir }; state.slices = state.baseSlices; state.whatif = false;
    $("#wi-wind").value = state.wind.ms; $("#wi-dir").value = state.wind.dir; syncWiLabels();
    $("#predict-status").textContent = `기본 예측 · 5h ${fmt0(ringAreaHa(state.slices[4]))} ha · 8h ${fmt0(ringAreaHa(state.slices[7]))} ha`;
    updateFireLayers();
  }
  const syncWiLabels = () => { $("#wi-wind-v").textContent = `${$("#wi-wind").value} m/s`; $("#wi-dir-v").textContent = `${$("#wi-dir").value}° (${dirName(Number($("#wi-dir").value))})`; };

  // ------------------------------------------------------------------ 이벤트 · 토스트 · 모달
  function addEvent(kind, text) {
    const d = new Date(T0.getTime() + (state.loginAt ? new Date() - state.loginAt : 0));
    state.events.push({ t: hhmmss(d), kind, text, src: "시스템" });
    renderLog();
    if (state.alerts && kind !== "시스템") toast(`[${kind}] ${text}`, 3200);
  }
  function toast(msg, ms = 2600) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), ms); }
  function openModal(title, bodyHTML, actions) {
    $("#modal-title").textContent = title; $("#modal-body").innerHTML = bodyHTML;
    const ac = $("#modal-actions"); ac.innerHTML = "";
    (actions || [{ label: "닫기" }]).forEach((a) => { const b = document.createElement("button"); b.textContent = a.label; if (a.cls) b.className = a.cls; b.onclick = () => { if (!a.onClick || a.onClick() !== false) closeModal(); }; ac.appendChild(b); });
    $("#modal-bg").classList.add("on");
  }
  const closeModal = () => $("#modal-bg").classList.remove("on");

  // ------------------------------------------------------------------ 패널 제어
  function showPanel(id, on) { const p = $(id); p.classList.toggle("on", on == null ? !p.classList.contains("on") : on); syncVtabs(); }
  function syncVtabs() { $$(".vtab").forEach((v) => v.classList.toggle("on", $({ fire: "#info-panel", weather: "#weather-panel", legend: "#legend-panel" }[v.dataset.v]).classList.contains("on"))); $$(".menu-btn[data-menu=\"log\"]").forEach((b) => b.classList.toggle("on", $("#bottom-dock").classList.contains("on"))); }
  function showTab(tab) {
    if (tab === "chat") { openChatPopup(); return; }
    showPanel("#info-panel", true);
    $$(".ip-tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    $$(".ipt").forEach((p) => p.classList.toggle("on", p.id === `ipt-${tab}`));
    $$(".menu-btn").forEach((b) => b.classList.toggle("on", b.dataset.menu === tab));
  }
  function openChatPopup() { if (state.role !== "decision") { toast("AI 어시스턴트는 의사결정권자만 사용할 수 있습니다."); return; } showPanel("#chat-panel", true); $("#chat-fab").style.display = "none"; $$(".menu-btn").forEach((b) => b.classList.toggle("on", b.dataset.menu === "chat")); openChat(); $("#chat-input").focus(); }
  function menu(name) {
    if (["status", "predict", "proposal", "chat"].includes(name)) { showTab(name); return; }
    if (name === "weather") { showPanel("#weather-panel"); showPanel("#legend-panel", false); }
    if (name === "log") showPanel("#bottom-dock");
    if (name === "sources") openSources();
    if (name === "contacts") openContacts();
  }
  function openContacts() {
    const rows = [["산불현장 통합지휘본부(의성군)", "군수 · 상황총괄반장", "054-830-6119", "지휘·주민대피 명령"], ["의성군 산림과", "산불담당", "054-830-6362", "산불방지대책본부 운영"], ["남부지방산림청 상황실", "산림재난상황실", "054-330-1240", "확산예측·헬기 지원"], ["의성소방서 상황실", "긴급구조통제단", "054-830-0119", "인명구조·시설 방호"], ["의성경찰서 상황실", "교통·대피 지원", "054-830-0112", "교통통제·주민대피 지원"], ["한국전력 의성지사", "송전설비 담당", "054-830-0123", "전류 차단·우회선로"], ["경상북도 산림재난상황실", "당직", "054-880-3600", "도 단위 지원·격상 협의"]];
    openModal("담당자 연락처", `<table class="grid"><thead><tr><th>기관</th><th>담당</th><th>연락처</th><th>역할</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="num"><a href="tel:${r[2]}">${r[2]}</a></td><td>${esc(r[3])}</td></tr>`).join("")}</tbody></table><div class="small muted" style="margin-top:6px">연락처는 시연용 가상값입니다. 실제 운영 시 표준매뉴얼 비상연락망으로 대체합니다.</div>`);
  }
  function makeDraggable(panel) {
    const hd = panel.querySelector(".fhd"); if (!hd) return;
    let sx, sy, ox, oy, drag = false;
    hd.addEventListener("mousedown", (e) => { if (e.target.closest("button")) return; drag = true; sx = e.clientX; sy = e.clientY; const r = panel.getBoundingClientRect(), pr = $("#stage").getBoundingClientRect(); ox = r.left - pr.left; oy = r.top - pr.top; panel.style.right = "auto"; panel.style.left = ox + "px"; panel.style.top = oy + "px"; e.preventDefault(); });
    document.addEventListener("mousemove", (e) => { if (!drag) return; panel.style.left = ox + e.clientX - sx + "px"; panel.style.top = Math.max(0, oy + e.clientY - sy) + "px"; });
    document.addEventListener("mouseup", () => (drag = false));
  }

  // ------------------------------------------------------------------ 렌더링: 헤더 · 상황정보
  function renderHeader() {
    const R = state.currentRun && state.currentRun.R, w = S.weather.series[0];
    $("#hdr-user").innerHTML = state.role === "decision" ? `<b>${esc(S.incident.position_holder)}</b> · ${esc(S.incident.position)}` : `<b>${esc(state.user)}</b> · 열람자(읽기 전용)`;
    $("#ip-sun").textContent = `| 일출 ${S.astronomy.sunrise} 일몰 ${S.astronomy.sunset}`;
    $("#ip-addr").innerHTML = `${esc(S.incident.ignition_addr)} <span class="stage">${esc(S.incident.name)}</span>`;
    $("#ip-report").innerHTML = `${hhmm(new Date(S.incident.report_time))} 119-공동대응 → 수동신고(산림청) · ${esc(S.incident.cause_note)}`;
    $("#ip-stage").innerHTML = `<b>${esc(state.situation.official_stage)}</b> · ${esc(state.situation.alert_level)}${R && R.stageUp ? ` <span class="badge b-협의">판정 ${esc(R.recStage)}</span>` : R ? ` <span class="muted">판정 ${esc(R.recStage)}</span>` : ""}`;
    $("#ip-holder").textContent = `${S.incident.position_holder}(${S.incident.position})`;
    $("#ip-wind").innerHTML = `풍향 <b>${dirName(w.wind_dir)}</b> 풍속 <b>${w.wind_ms}m/s</b>`;
  }
  function renderStatus() {
    const R = state.viewRun && state.viewRun.R, run = state.viewRun;
    const intake = [["의성군(119 신고)", hhmm(new Date(S.incident.report_time)), true], ["경북도 산림재난상황실", "11:31", false], ["남부지방산림청", "11:34", false], ["산림청 중앙산림재난상황실", "11:38", false]];
    $("#st-overview").innerHTML = `
      <table class="grid">
        <tr><td class="k">상황접수</td><td colspan="3">${intake.map(([o, t, real]) => `<span style="display:inline-block;margin:1px 8px 1px 0">🔍 ${esc(o)} <b class="${real ? "" : "fake"}" ${real ? "" : 'title="가상값"'}>${t}</b></span>`).join("")}</td></tr>
        <tr><td class="k">공식 단계</td><td>${esc(state.situation.official_stage)} · ${esc(state.situation.alert_level)}</td><td class="k">규칙 판정</td><td>${R ? `<b>${esc(R.recStage)}</b>${R.stageUp ? ' <span class="badge b-협의">격상 검토</span>' : ""}` : "예측 전"}</td></tr>
        <tr><td class="k">5h 예상</td><td>${R ? fmt0(R.areaP5) + " ha" : "—"}</td><td class="k">8h 예상</td><td>${R ? fmt0(R.areaP8) + " ha" : "—"}</td></tr>
        <tr><td class="k">위험구역</td><td>${R ? `${R.immediate.length}개 마을 <span class="muted">(잠재 ${R.standby.length})</span>` : "—"}</td><td class="k">즉시 조치</td><td>${run ? run.summary["즉시"] + " 건" : "—"}</td></tr>
        <tr><td class="k">현장 보고</td><td colspan="3"><span class="fake" title="가상값">피해 ${state.situation.field_report.burned_area_ha} ha · 화선 ${state.situation.field_report.fireline_length_km} km · 진화율 ${state.situation.field_report.containment_pct}%</span></td></tr>
      </table>`;
    const cats = [
      ["heritage", "🏛 문화재·사찰", S.facilities.filter((f) => f.type === "heritage" || f.type === "temple").map((f) => ({ n: f.name, d: distFromFire(f.lng, f.lat) }))],
      ["shelter", "🏠 대피소", S.shelters.map((s) => ({ n: s.name, d: distFromFire(s.lng, s.lat) }))],
      ["care", "🏥 취약시설", S.facilities.filter((f) => f.type === "care" || f.type === "welfare").map((f) => ({ n: f.name, d: distFromFire(f.lng, f.lat) }))],
      ["crew", "👷 감시·진화대", S.resources.crew_positions.map((p, i) => ({ n: `진화조 ${i + 1}`, d: distFromFire(p[0], p[1]) }))],
      ["village", "🏘 마을", S.villages.map((v) => ({ n: v.name, d: distFromFire(v.lng, v.lat) }))],
      ["water", "💧 담수지", WATER.map((w) => ({ n: w.name, d: w.d }))]
    ];
    $("#st-prox").innerHTML = `<table class="grid prox">${cats.map(([key, label, items]) => { const near = items.slice().sort((a, b) => a.d - b.d)[0]; return `<tr><td style="width:24px;text-align:center"><input type="checkbox" class="prox-chk" data-cat="${key}" ${state.prox[key] ? "checked" : ""}></td><td class="k">${label}</td><td style="width:70px"><select class="prox-r" data-cat="${key}"><option>2km</option><option>5km</option><option selected>10km</option></select></td><td class="k" style="width:36px;text-align:center;background:#f3f3f3;font-weight:700">근접</td><td style="width:78px" class="num">${near ? `${near.d.toFixed(2)} km` : "—"}</td><td class="small muted">${near ? esc(near.n) : "데이터 없음"}</td></tr>`; }).join("")}</table><div class="small muted" style="margin-top:3px">(발화점 직선거리 기준 · 담수지는 OSM 저수지 위치로 헬기 담수 가능 여부 미확인)</div>`;
    $$(".prox-chk").forEach((c) => (c.onchange = () => { state.prox[c.dataset.cat] = c.checked; applyDist(); }));
  }
  function renderKpi() {
    const R = state.viewRun && state.viewRun.R, run = state.viewRun;
    $("#kpi-area").innerHTML = R ? `${fmt0(R.areaP5)}<small> ha</small>` : "—";
    $("#kpi-villages").innerHTML = R ? `${R.immediate.length}<small> 잠재 ${R.standby.length}</small>` : "—";
    $("#kpi-immediate").innerHTML = run ? `${run.summary["즉시"]}<small> 건</small>` : "—";
    $("#kpi-sunset").innerHTML = `${hm(SUNSET - T0)}<small> ${S.astronomy.sunset}</small>`;
  }
  function renderArrival() {
    const R = state.viewRun && state.viewRun.R;
    if (!R) { $("#arrival-table").innerHTML = `<div class="muted small">예측을 실행하면 마을별 도달시간과 위험구역이 계산됩니다.</div>`; return; }
    const rows = [...R.villages].sort((a, b) => (a.arrival ?? 99) - (b.arrival ?? 99) || b.elderly - a.elderly);
    const zoneTag = (v) => v.zone === "immediate" ? '<span class="badge b-즉시">위험</span>' : v.zone === "standby" ? '<span class="badge b-대기">잠재</span>' : '<span class="badge b-없음">밖</span>';
    $("#arrival-table").innerHTML = `<table class="grid"><thead><tr><th>마을</th><th>도달</th><th>구역</th><th>인구/고령</th><th>대피소</th></tr></thead><tbody>${rows.map((v) => { const a = R.assignments.find((x) => x.village.id === v.id); return `<tr class="clickable" data-v="${v.id}"><td><b>${esc(v.name)}</b> <span class="muted small">${esc(v.emd)}</span></td><td class="num">${v.arrival ? `${v.arrivalTime}${v.night ? ' <span class="small muted">야간</span>' : ""}` : "—"}</td><td style="text-align:center">${zoneTag(v)}</td><td class="num"><span class="fake" title="가상값">${v.pop}/${v.elderly}</span></td><td class="small">${a ? `${esc(a.shelter.name)} <span class="muted">${a.minutes}분</span>` : "—"}</td></tr>`; }).join("")}</tbody></table>`;
    $$("#arrival-table tr.clickable").forEach((tr) => tr.addEventListener("click", () => { const v = S.villages.find((x) => x.id === tr.dataset.v); highlight({ villages: [v.id] }, true); showVillagePopup(v); }));
  }
  function renderResources() {
    const rs = state.situation.resources, R = state.viewRun && state.viewRun.R;
    const rows = [];
    for (let i = 0; i < rs.heli_deployed; i++) rows.push([`KFS-H${String(i + 1).padStart(2, "0")}`, "산림항공", "헬기", "진화중", "g"]);
    for (let i = 0; i < rs.heli_available_nearby; i++) rows.push([`KFS-A${String(i + 1).padStart(2, "0")}`, "산림항공", "헬기", "대기", "y"]);
    rs.crew_positions.forEach((p, i) => rows.push([`G-${i + 1}`, "의성군", "진화조", R && pointInRing(p, state.slices[4] || []) ? "P5 내 작업" : "작업중", "g"]));
    for (let i = 0; i < rs.fire_trucks_deployed; i++) rows.push([`F-${String(i + 1).padStart(2, "0")}`, "의성소방서", "소방차", "배치", "g"]);
    const w = S.weather.series, maxW = Math.max(...w.map((x) => x.wind_ms));
    const pts = w.map((x, i) => `${(i / (w.length - 1)) * 100},${100 - x.wind_ms / maxW * 85}`).join(" ");
    $("#lp-body").innerHTML = `
      <div class="cnt"><div>구분<b>합계</b></div><div>투입<b>${rs.heli_deployed + rs.crew_positions.length + rs.fire_trucks_deployed}</b></div><div>대기<b>${rs.heli_available_nearby}</b></div></div>
      <table class="grid"><thead><tr><th>호출부호</th><th>소속</th><th>구분</th><th>상태</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="${r[4]}">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td class="${r[4]}">${r[3]}</td></tr>`).join("")}</tbody></table>
      <div class="chart"><span class="lbl">풍속 (m/s) 12→20시</span><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#b30000" stroke-width="2" vector-effect="non-scaling-stroke"/><polygon points="0,100 ${pts} 100,100" fill="rgba(179,0,0,.18)"/></svg></div>
      <table class="grid" style="margin-top:6px"><tr><td class="k">지상인력</td><td><span class="fake" title="가상값">${rs.ground_crew_deployed}명</span></td><td class="k">헬기 운용</td><td>${R ? (R.heliOkNow ? "가능" : "제한") : "—"}</td></tr><tr><td class="k">진화율</td><td>${state.situation.field_report.containment_pct}%</td><td class="k">소요 기준</td><td><span class="badge b-근거부족">근거 부족</span></td></tr></table>`;
  }
  function renderWeather() {
    const w = S.weather, now = w.series[0], maxW = Math.max(...w.series.map((x) => x.wind_ms));
    $("#wp-body").innerHTML = `
      <table class="grid"><tr><td class="k">풍향·풍속</td><td>${dirName(now.wind_dir)}풍 <b>${now.wind_ms} m/s</b></td><td class="k">습도</td><td><span class="fake" title="가상값">${now.rh}%</span></td></tr><tr><td class="k">시정</td><td>${now.vis_m / 1000} km</td><td class="k">특보</td><td>${w.warnings.map(esc).join(", ")}</td></tr><tr><td class="k">일출·일몰</td><td>${S.astronomy.sunrise} · ${S.astronomy.sunset}</td><td class="k">야간 진입</td><td>${hm(SUNSET - T0)} 후</td></tr></table>
      <div class="sec">풍속 시계열 (m/s)</div>
      <div class="bars">${w.series.map((x) => `<div class="bar wind" style="height:${x.wind_ms / maxW * 100}%"><span>${x.wind_ms}</span></div>`).join("")}</div><div class="bar-labels">${w.series.map((x) => `<span>${x.t.slice(0, 2)}</span>`).join("")}</div>
      <div class="sec">습도 (%)</div>
      <div class="bars">${w.series.map((x) => `<div class="bar" style="height:${x.rh / 60 * 100}%"><span>${x.rh}</span></div>`).join("")}</div><div class="bar-labels">${w.series.map((x) => `<span>${x.t.slice(0, 2)}</span>`).join("")}</div>`;
  }
  function renderLegend() {
    const ico = (cls, key) => `<span class="ico-s" style="background:${ICON_COLOR[cls]}">${ICONS[key]}</span>`;
    $("#lg-body").innerHTML = `
      <div class="row"><span class="sw" style="background:#ff4d1f;opacity:.7"></span>현재 시각까지 확산 범위</div>
      <div class="row"><span class="sw" style="border:1.5px dashed #e08a00"></span>다음 1시간 예상 윤곽</div>
      <div class="row"><span class="sw" style="background:#ff8f66;opacity:.6"></span>위험구역(5h) <span class="sw" style="background:#ffd166;opacity:.7;margin-left:4px"></span>잠재(8h)</div>
      <div class="row">${ico("f0", "flame")}발화점 <span style="margin-left:6px">${ico("village", "house")}</span>마을 <span style="margin-left:6px">${ico("shelter", "shelter")}</span>대피소</div>
      <div class="row">${ico("care", "care")}취약시설 <span style="margin-left:6px">${ico("heritage", "heritage")}</span>국가유산·사찰 <span style="margin-left:6px">${ico("crew", "crew")}</span>진화조 <span style="margin-left:6px">${ico("water", "drop")}</span>담수지</div>
      <div class="row"><span class="sw" style="background:#3d8bff"></span>대피로 <span class="sw" style="border:1.5px dashed #555;background:#fff;margin-left:4px"></span>진입로 <span class="sw" style="background:#ff3b3b;opacity:.6;margin-left:4px"></span>겹침 구간</div>
      <div class="row"><span class="sw" style="border-top:2px dotted #c9a000"></span>송전선 <span class="sw" style="border-top:1.5px dashed #999;margin-left:4px"></span>읍면 경계 <span class="sw" style="background:#ffff99;border:1px solid #999;margin-left:4px"></span>거리 라벨</div>
      <div class="small muted" style="margin-top:6px">위성영상 Esri · 지도 OpenFreeMap © OpenMapTiles © OSM · 지형 AWS</div>
      <div style="margin-top:6px"><a href="#" id="lg-sources">데이터 출처·실제/가상 구분 보기</a></div>`;
    $("#lg-sources").onclick = (e) => { e.preventDefault(); openSources(); };
  }
  function renderLog() {
    const items = state.events.map((e) => ({ ...e, cls: "mock" }));
    if (state.showActual && !state.mockOnly) S.timeline_actual.forEach((e) => items.push({ t: e.t, kind: "실제", text: e.text, src: e.src ? "보도 " + e.src : "참고", cls: "actual" }));
    items.sort((a, b) => a.t.localeCompare(b.t));
    $("#bd-table").innerHTML = `<thead><tr><th style="width:80px">시각</th><th style="width:70px">구분</th><th>내용</th><th style="width:90px">출처</th></tr></thead><tbody>${items.map((e) => `<tr class="${e.cls}"><td class="num">${esc(e.t)}</td><td style="text-align:center">${esc(e.kind)}</td><td>${esc(e.text)}</td><td>${esc(e.src)}</td></tr>`).join("")}</tbody>`;
    $("#bd-cnt").textContent = `${items.length} 건`;
  }

  // ------------------------------------------------------------------ 렌더링: 대응 제안
  const citeHTML = (text, blockId) => esc(text).replace(/\[(\d+)\]/g, (m, k) => `<span class="cite" data-b="${blockId}" data-k="${k}">${k}</span>`);
  const badges = (status) => status.filter((s) => s !== "(없음)").map((s) => `<span class="badge b-${s.replace(/[\s()]/g, "")}">${esc(s)}</span>`).join("");
  function renderProposal() {
    const run = state.viewRun, isCurrent = run === state.currentRun;
    $("#prop-meta").innerHTML = run ? `기준 <b>${hhmm(T0)}</b> · <b>${esc(S.incident.position_holder)}</b> · 공식 <b>${esc(run.snapshot.official_stage)}</b> · 판정 <b>${esc(run.R.recStage)}</b>${isCurrent ? "" : ' <span class="badge b-없음">이전 판</span>'} <select id="run-select" title="제안서 판 선택">${state.runs.slice().reverse().map((r) => `<option value="${r.id}" ${r === run ? "selected" : ""}>${r.id} · ${esc(r.reason)}${r === state.currentRun ? "(최신)" : ""}</option>`).join("")}</select>` : "예측 실행 후 생성됩니다";
    const sel = $("#run-select"); if (sel) sel.onchange = (e) => { state.viewRun = state.runs.find((r) => r.id === e.target.value) || state.currentRun; renderAll(); };
    const banner = $("#stage-banner");
    if (run && run.R.stageUp) { banner.classList.add("on"); banner.innerHTML = `<b>격상 검토 권고</b> — 5시간 후 예상 피해면적 ${fmt0(run.R.areaP5)} ha는 ${esc(run.R.recStage)} 기준입니다. 산림청장과 협의하십시오.${run.R.nextHolder ? ` 격상 시 지휘권자는 <b>${esc(run.R.nextHolder)}</b>, 주민대피 명령권은 군수에게 남습니다.` : ""}${tip("판단기준 4요소(피해면적·평균풍속·예상 진화시간·시설피해, 표준매뉴얼 p.73) 중 면적 기준만 적용한 판정입니다. 발령은 산림청장이 통합지휘본부와 협의해 결정하며, 이 화면은 직위를 바꾸지 않습니다.", "l")}`; }
    else banner.classList.remove("on");
    const box = $("#cards");
    if (!run) { box.innerHTML = `<div class="muted" style="padding:18px 6px;text-align:center">${state.role === "decision" ? "「확산예측」 탭에서 예측을 실행하면<br>대응 제안이 생성됩니다." : "의사결정권자가 예측을 실행하면 표시됩니다."}</div>`; $("#prop-summary").innerHTML = ""; return; }
    const dec = state.decisions[run.id] || {};
    const prevDec = (() => { const i = state.runs.indexOf(run); return i > 0 ? state.decisions[state.runs[i - 1].id] || {} : {}; })();
    const all = run.blocks.filter((b) => b.axis === state.axis);
    const active = all.filter((b) => b.status[0] !== "(없음)").filter((b) => state.filter === "all" || b.status.includes(state.filter));
    const noneBlocks = all.filter((b) => b.status[0] === "(없음)");
    const card = (b) => {
      const none = b.status[0] === "(없음)", changed = run.changed.includes(b.id), d = dec[b.id];
      const evid = b.evidence.map((e) => { const c = S.evidence[e.key]; return `<span class="ev"><span class="cite" data-b="${b.id}" data-k="${e.k}">${e.k}</span> ${esc(c.doc)} ${esc(c.page)} ${esc(c.section)}</span>`; }).join("") || "—";
      return `<div class="card axis-${b.axis}${none ? " none" : ""}${changed ? " changed" : ""}" data-id="${b.id}">
        <div class="head"><span class="arrow">▶</span><span class="nm">${esc(b.name)}</span><span class="st">${d ? `<span class="badge" style="background:#eef;color:#334;border-color:#ccd">${esc(d)}</span>` : ""}${badges(b.status)}${none ? '<span class="badge b-없음">해당 없음</span>' : ""}</span></div>
        <div class="body">
          <div class="text">${none ? `<span class="muted">${esc(b.finding || "이번 상황에서는 해당 사항이 없습니다.")}</span>` : citeHTML(b.text, b.id)}</div>
          <div class="detail">
            ${b.finding && !none ? `<div class="row"><span class="k">판정 값</span><span class="v">${esc(b.finding)}</span></div>` : ""}
            ${b.targets.length ? `<div class="row"><span class="k">대상</span><span class="v">${esc(b.targets.join(", "))}</span></div>` : ""}
            ${b.conflicts.length ? `<div class="row"><span class="k">충돌</span><span class="v">${b.conflicts.map((c) => `${esc(c.type)} (관련: ${esc(c.with)}) → ${esc(c.resolution)}`).join("<br>")}</span></div>` : ""}
            <div class="row"><span class="k">근거</span><span class="v">${evid}</span></div>
            <div class="row"><span class="k">권한</span><span class="v">${esc(b.authority)}</span></div>
          </div>
          <div class="actions">
            <button class="map-btn" data-id="${b.id}">지도</button>
            <button class="ask-btn decision-only" data-id="${b.id}">질문</button>
            <span class="decision-only">${["채택", "보류", "수정"].map((x) => `<button class="dec ${d === x ? "on-" + x : ""}" data-id="${b.id}" data-d="${x}">${x}${x === "수정" ? " 지시" : ""}</button>`).join(" ")}</span>
            <span class="decision">${prevDec[b.id] && !d ? `이전 판 ${esc(prevDec[b.id])}` : ""}</span>
          </div>
        </div></div>`;
    };
    box.innerHTML = active.map(card).join("") + (active.length ? "" : `<div class="muted" style="padding:14px 6px;text-align:center">해당하는 항목이 없습니다.</div>`) +
      (noneBlocks.length && state.filter === "all" ? `<div class="none-toggle" id="none-toggle">해당 없음 ${noneBlocks.length}건 ${state.showNone[state.axis] ? "숨기기 ▴" : "보기 ▾"}</div>${state.showNone[state.axis] ? noneBlocks.map(card).join("") : ""}` : "");
    const nt = $("#none-toggle"); if (nt) nt.onclick = () => { state.showNone[state.axis] = !state.showNone[state.axis]; renderProposal(); };
    $$("#cards .card .head").forEach((h) => h.addEventListener("click", () => h.closest(".card").classList.toggle("open")));
    $$("#cards .card").forEach((c) => { c.addEventListener("mouseenter", () => { const b = run.blocks.find((x) => x.id === c.dataset.id); b && highlight(b.ref || {}, false); }); c.addEventListener("mouseleave", clearHighlight); });
    $$("#cards .map-btn").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); const bl = run.blocks.find((x) => x.id === b.dataset.id); highlight(bl.ref || {}, true); if (!Object.keys(bl.ref || {}).length) toast("이 항목은 지도에 표시할 대상이 없습니다."); }));
    $$("#cards .ask-btn").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); state.chatCtx = b.dataset.id; openChatPopup(); }));
    $$("#cards .dec").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); if (!isCurrent) { toast("이전 판에는 결정을 기록할 수 없습니다."); return; } const cur = (state.decisions[run.id] = state.decisions[run.id] || {}); cur[b.dataset.id] = cur[b.dataset.id] === b.dataset.d ? undefined : b.dataset.d; localStorage.setItem("mock.decisions", JSON.stringify(state.decisions)); const name = (run.blocks.find((x) => x.id === b.dataset.id) || {}).name || ""; addEvent("결정", `${name} — ${cur[b.dataset.id] ? "결정: " + cur[b.dataset.id] : "결정 취소"}`); const wasOpen = b.closest(".card").classList.contains("open"); renderProposal(); if (wasOpen) { const c = document.querySelector(`#cards .card[data-id="${b.dataset.id}"]`); if (c) c.classList.add("open"); } }));
    $$("#cards .cite").forEach((c) => c.addEventListener("click", (e) => { e.stopPropagation(); openEvidence(run, c.dataset.b, Number(c.dataset.k)); }));
    const s = run.summary, decCount = Object.values(dec).filter(Boolean).length;
    $("#prop-summary").innerHTML = ["즉시", "대기", "협의", "요청", "근거 부족"].filter((k) => s[k]).map((k) => `<span class="badge b-${k.replace(/\s/g, "")}">${k} ${s[k]}</span>`).join("") + `<span style="margin-left:auto">결정 ${decCount}건 · ${hhmm(run.createdAt)} 생성</span>`;
    applyRole();
  }
  function focusCard(id, open) {
    const b = state.viewRun && state.viewRun.blocks.find((x) => x.id === id); if (!b) return;
    if (b.axis !== state.axis) { state.axis = b.axis; $$(".ptab").forEach((t) => t.classList.toggle("on", t.dataset.axis === state.axis)); state.filter = "all"; $$(".pfilter").forEach((f) => f.classList.toggle("on", f.dataset.f === "all")); renderProposal(); }
    const el = document.querySelector(`#cards .card[data-id="${id}"]`); if (!el) return;
    if (open) el.classList.add("open");
    el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("hi"); setTimeout(() => el.classList.remove("hi"), 1800);
  }
  function openEvidence(run, blockId, k) {
    const b = run.blocks.find((x) => x.id === blockId); const ev = b.evidence.find((e) => e.k === k); if (!ev) return;
    const sentences = b.text.split(/(?<=다\.)\s*/).filter(Boolean);
    const sent = sentences.find((s) => s.includes(`[${k}]`)) || b.text;
    $("#ev-title").textContent = `근거 — ${b.name}`;
    $("#ev-body").innerHTML = `<div class="ev-sentence">${citeHTML(sent, b.id)}</div>` + b.evidence.map((e) => { const c = S.evidence[e.key]; return `<div class="ev-chunk" style="${e.k === k ? "border-color:#e0a325;background:#fffbe6" : ""}"><div class="meta">${e.k} · ${esc(c.doc)} ${esc(c.page)} · ${esc(c.section)}</div><div>${e.k === k ? `<mark>${esc(c.text)}</mark>` : esc(c.text)}</div></div>`; }).join("") + `<div class="small muted">원문 열람은 시연에서 제공하지 않습니다(표준매뉴얼 비공개). 위 텍스트는 쪽수 기준 요약입니다.</div>`;
    $("#evidence-drawer").classList.add("on");
  }

  // ------------------------------------------------------------------ 현장 보고 · 전후 비교
  function openReportForm() {
    const s = state.situation, rs = s.resources, fr = s.field_report, es = s.evacuation_state;
    const vopts = (sel) => S.villages.map((v) => `<option ${sel.includes(v.name) ? "selected" : ""}>${v.name}</option>`).join("");
    openModal("현장 보고 입력", `
      <div class="form">
        <label>현재 피해면적(ha)<input id="rf-area" type="number" step="0.1" value="${fr.burned_area_ha}"></label>
        <label>화선 길이(km)<input id="rf-line" type="number" step="0.1" value="${fr.fireline_length_km}"></label>
        <label>진화율(%)<input id="rf-cont" type="number" min="0" max="100" value="${fr.containment_pct}"></label>
        <label>예상 진화시간(시간, 비우면 미입력)<input id="rf-exp" type="number" step="1" value="${fr.expected_suppression_hours ?? ""}"></label>
        <label>헬기 투입(대)<input id="rf-heli" type="number" value="${rs.heli_deployed}"></label>
        <label>인근 가용 헬기(대)<input id="rf-heli2" type="number" value="${rs.heli_available_nearby}"></label>
        <label>지상 진화인력(명)<input id="rf-crew" type="number" value="${rs.ground_crew_deployed}"></label>
        <label>소방차(대)<input id="rf-truck" type="number" value="${rs.fire_trucks_deployed}"></label>
        <label>공식 대응단계<select id="rf-stage">${STAGES.map((x) => `<option ${s.official_stage === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
        <label>위기경보<select id="rf-alert">${["관심", "주의", "경계", "심각"].map((x) => `<option ${s.alert_level === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
        <label>대피명령 발령<select id="rf-order"><option value="0" ${!es.order_issued ? "selected" : ""}>미발령</option><option value="1" ${es.order_issued ? "selected" : ""}>발령</option></select></label>
        <label>재난문자 송출 이력(쉼표 구분)<input id="rf-cbs" value="${esc(es.cbs_sent.join(", "))}"></label>
        <label>대피 완료 마을(복수 선택)<select id="rf-done" multiple size="5">${vopts(es.completed_villages)}</select></label>
        <label>부상·고립 보고(쉼표 구분, 마을명)<input id="rf-inj" value="${esc(es.injuries.join(", "))}"></label>
      </div>
      <div class="small muted" style="margin-top:8px">저장하면 상황에 출처 태그(현장 보고, 시각)가 붙고 대응 제안이 다시 생성됩니다.</div>`,
      [{ label: "취소" }, { label: "저장 후 제안 생성", cls: "primary", onClick: () => saveReport() }]);
  }
  function saveReport() {
    const num = (id) => Number($(id).value);
    const cont = num("#rf-cont"); const errs = [];
    if (cont < 0 || cont > 100) errs.push("진화율은 0~100이어야 합니다.");
    if (num("#rf-heli") < 0 || num("#rf-crew") < 0) errs.push("자원 수는 0 이상이어야 합니다.");
    if (errs.length) { toast(errs.join(" ")); return false; }
    const s = state.situation;
    s.field_report = { burned_area_ha: num("#rf-area"), fireline_length_km: num("#rf-line"), containment_pct: cont, expected_suppression_hours: $("#rf-exp").value === "" ? null : num("#rf-exp") };
    Object.assign(s.resources, { heli_deployed: num("#rf-heli"), heli_available_nearby: num("#rf-heli2"), ground_crew_deployed: num("#rf-crew"), fire_trucks_deployed: num("#rf-truck") });
    s.official_stage = $("#rf-stage").value; s.alert_level = $("#rf-alert").value;
    s.evacuation_state = { order_issued: $("#rf-order").value === "1", cbs_sent: $("#rf-cbs").value.split(",").map((x) => x.trim()).filter(Boolean), completed_villages: Array.from($("#rf-done").selectedOptions).map((o) => o.value), unreached_villages: [], injuries: $("#rf-inj").value.split(",").map((x) => x.trim()).filter(Boolean) };
    addEvent("보고", "현장 보고 갱신(출처: 현장 보고)");
    if (stageIdx(s.official_stage) >= 2) toast("공식 단계가 2단계 이상이면 지휘권이 시·도지사로 넘어가 이 화면은 격상·인계 안내만 유효합니다.", 4000);
    if (state.predicted) { const prev = state.currentRun; const run = generateProposal("현장 보고 갱신"); if (prev) showDiff(prev, run); } else renderAll();
    return true;
  }
  function showDiff(prev, run) {
    const rows = run.changed.map((id) => { const a = prev.blocks.find((b) => b.id === id), b = run.blocks.find((x) => x.id === id); return `<div class="chg"><b>${esc(b.name)}</b><div class="diff" style="margin-top:4px"><div class="col"><h4>${prev.id}</h4>${badges(a.status)}<div style="margin-top:4px">${esc(a.text)}</div></div><div class="col"><h4>${run.id}</h4>${badges(b.status)}<div style="margin-top:4px">${esc(b.text)}</div></div></div></div>`; }).join("");
    openModal(`대응 제안 전후 비교 — ${prev.id} → ${run.id}`, rows || `<div class="muted">바뀐 항목이 없습니다.</div>`, [{ label: "닫기" }]);
  }

  // ------------------------------------------------------------------ 질의 · 정정
  const QUICK = ["왜 이 마을이 먼저입니까", "대피소 수용 초과 시 대안은", "헬기를 몇 대 더 투입해야 합니까", "격상 기준이 무엇입니까", "재난문자는 언제 보내야 합니까", "박곡리 대피 완료"];
  function openChat() {
    if (state.role !== "decision") return;
    const run = state.viewRun; const b = run && run.blocks.find((x) => x.id === state.chatCtx);
    $("#chat-ctx").innerHTML = b ? `항목: <b>${esc(b.name)}</b> — 제안·근거·상황값을 붙여 질문합니다 <a href="#" id="chat-ctx-clear">해제</a>` : "항목 미지정 — 대응제안 카드의 「질문」으로 항목을 붙일 수 있습니다";
    const cl = $("#chat-ctx-clear"); if (cl) cl.onclick = (e) => { e.preventDefault(); state.chatCtx = null; openChat(); };
    $("#chat-quick").innerHTML = QUICK.map((q) => `<button>${q}</button>`).join("");
    $$("#chat-quick button").forEach((q) => (q.onclick = () => { $("#chat-input").value = q.textContent; sendChat(); }));
    if (!$("#chat-log").children.length) botSay("제안 내용에 대한 질문이나 상황 변화를 말씀해 주십시오. 답변은 표준매뉴얼 근거만 인용하며, 근거가 없으면 근거 부족으로 답합니다.");
  }
  function addMsg(cls, html) { const d = document.createElement("div"); d.className = `msg ${cls}`; d.innerHTML = html; $("#chat-log").appendChild(d); $("#chat-log").scrollTop = 1e6; return d; }
  function botSay(text, blockId) {
    const d = addMsg("bot", ""); let i = 0; const html = blockId ? citeHTML(text, blockId) : esc(text);
    const iv = setInterval(() => { i += 3; d.textContent = text.slice(0, i); $("#chat-log").scrollTop = 1e6; if (i >= text.length) { clearInterval(iv); d.innerHTML = html; d.querySelectorAll(".cite").forEach((c) => c.addEventListener("click", () => { showTab("proposal"); focusCard(c.dataset.b, true); openEvidence(state.viewRun, c.dataset.b, Number(c.dataset.k)); })); } }, 12);
  }
  function sendChat() {
    const q = $("#chat-input").value.trim(); if (!q) return; $("#chat-input").value = "";
    addMsg("user", esc(q));
    const corr = detectCorrection(q);
    if (corr) { setTimeout(() => proposeCorrection(corr, q), 300); return; }
    setTimeout(() => answer(q), 350);
  }
  function answer(q) {
    const run = state.viewRun; if (!run) { botSay("아직 대응 제안이 없습니다. 예측을 실행하면 답할 수 있습니다."); return; }
    const R = run.R, ctx = state.chatCtx, es = state.situation.evacuation_state;
    const vill = S.villages.find((v) => q.includes(v.name));
    const T = [
      [/왜|먼저|순서|우선/, () => { const first = R.ordered[0]; const v = vill && R.villages.find((x) => x.id === vill.id) || first; if (!v) return "확산 범위에 드는 마을이 없어 대피 순서를 정할 항목이 없습니다."; const rank = R.ordered.findIndex((x) => x.id === v.id) + 1; return `${eun(v.name)} 화선 도달 예상이 ${v.arrivalTime}로 ${rank === 1 ? "가장 이르고" : `${rank}번째이며`}, 고령자 ${v.elderly}명이 있어 안전취약계층 우선 대피 원칙이 적용됩니다 [1]. 대피명령은 마을 단위로 내리고 화선 도달 5시간 이내 마을은 즉시 실행합니다 [2].`; }, "E2"],
      [/대피소|수용|초과|분산/, () => { const ov = R.overflow; const as = R.assignments.map((a) => `${a.village.name}→${a.shelter.name}(${a.shelter.load}/${a.shelter.capacity})`).join(", "); return `현재 배정은 ${as || "없음"}입니다 [1]. ${ov.length ? `${eun(joinKo(ov.map((s) => s.name)))} 수용 인원을 초과하므로 인접 대피소로 분산해야 합니다 [1].` : "수용 초과 대피소는 없습니다."} 8시간 확산 범위 안 대피소는 제외합니다 [2].`; }, "E4"],
      [/헬기|몇 대|대수|추가 투입/, () => `가용 진화헬기를 집중 투입하라는 원칙은 있으나 [2], 몇 대를 추가해야 하는지의 산정 기준은 제공된 청크에 없어 근거 부족입니다. 현재 투입 ${state.situation.resources.heli_deployed}대, 인근 가용 ${state.situation.resources.heli_available_nearby}대이며, 풍속 ${state.wind.ms} m/s에서는 운용이 가능합니다.`, "S3"],
      [/격상|단계|기준/, () => `대응단계 판단기준은 피해면적·평균풍속·예상 진화시간·시설피해 4요소이며 하나라도 상위 기준을 충족하면 상위 단계를 검토합니다 [1]. 현재 5시간 후 예상 피해면적 ${fmt0(R.areaP5)} ha는 ${R.recStage} 기준입니다. 발령은 산림청장이 통합지휘본부와 협의해 하므로 이 화면은 격상 검토를 권고할 뿐 직위를 바꾸지 않습니다 [2].`, "S1"],
      [/야간|일몰|밤|사전대피/, () => `일몰은 ${R.sunset}이고 ${R.nightVillages.length ? `${eun(joinKo(R.nightVillages.map((v) => `${v.name}(${v.arrivalTime})`)))} 화선 도달 예상 시각이 일몰 이후이므로 일몰 전 사전대피 대상입니다 [1].` : "화선 도달 예상 시각이 일몰 이후인 마을은 없습니다."} 야간에는 풍속이 잦아드는 시간대에 집중 진화를 합니다.`, "E2"],
      [/송전|한전|전류|고압/, () => R.powerIn ? `송전선이 ${timeAt(R.powerIn)} 무렵 확산 범위에 들므로 한전에 전류 차단과 우회선로 확보를 요청해야 합니다 [2]. 요청 대상은 한전이며 통합지휘본부에 협력관 파견을 받습니다.` : "8시간 확산 범위 안에 송전선이 없어 한전 요청 항목은 발동하지 않았습니다.", "S5"],
      [/재난문자|문자|방송|CBS|송출/, () => `긴급재난문자와 자막방송은 산불 발생, 대피 권고, 대피 명령 시 단계별로 송출합니다 [1]. 현재 대피명령 ${es.order_issued ? "발령 상태이므로 대피 명령 단계로" : "미발령이므로 명령과 동시에 명령 단계로"} ${joinKo(R.emdIn8)}에 송출하십시오. 인명·민가 피해 우려가 없으면 생략할 수 있으나 이번 상황은 해당하지 않습니다 [1].`, "E6"],
      [/경찰|교통|통제|도로|진입로/, () => `대피로와 진화차량 진입로가 겹치는 구간이 있어 경찰에 교통통제와 주민대피 지원을 요청해야 합니다 [1]. ${R.routeInFire ? `겹침 구간은 ${timeAt(R.routeInFire)} 무렵 확산 범위에 듭니다.` : ""}`, "E5"],
      [/취약|요양|장애|시설/, () => R.careIn.length ? `${josa(joinKo(R.careIn.map((f) => `${f.name}(${timeAt(f.arrival)}, ${f.capacity}명)`)), "이", "가")} 확산 범위에 들어 위험구역에 포함하고 별도 이송을 지시해야 합니다 [1].` : "8시간 확산 범위 안에 취약시설이 없습니다.", "E3"],
      [/근거|출처|어디|매뉴얼/, () => "모든 제안 문장은 표준매뉴얼(2026.6 일부개정) 본문 쪽수를 번호로 인용하며, 청크에서 확인되지 않는 내용은 근거 부족으로 표시합니다. 문장 안의 번호를 누르면 요약 청크를 볼 수 있습니다.", null],
      [/합성|가상|실제|진짜/, () => "이 시연의 화선은 실제 관측이 아니라 발화점·풍향·풍속으로 만든 합성 모델입니다. 마을·시설·대피소 좌표와 행정구역 경계, 도로·철도는 실제 데이터이고, 인구·수용 인원·자원 수는 가상값입니다.", null]
    ];
    for (const [re, fn, bid] of T) if (re.test(q)) { const b = bid || ctx; botSay(fn(), b && run.blocks.find((x) => x.id === b) ? b : null); return; }
    if (ctx) { const b = run.blocks.find((x) => x.id === ctx); botSay(`${b.name} 항목의 판정 값은 "${b.finding}"이며 제안은 다음과 같습니다. ${b.text} 질문하신 내용은 제공된 청크에서 직접 확인되지 않아 근거 부족입니다.`, b.id); return; }
    botSay("근거 부족: 제공된 매뉴얼 청크에서 확인되지 않습니다. 대응제안 카드의 「질문」으로 항목을 지정하거나, 상황 변화(예: 박곡리 대피 완료, 헬기 6대 투입, 대피명령 발령)를 말씀해 주십시오.");
  }
  function detectCorrection(q) {
    const vill = S.villages.filter((v) => q.includes(v.name));
    if (vill.length && /대피\s*(완료|끝)|완료했|다 나왔/.test(q)) return { type: "completed", villages: vill.map((v) => v.name) };
    if (vill.length && /부상|다쳤|고립|갇/.test(q)) return { type: "injury", villages: vill.map((v) => v.name) };
    const h = q.match(/헬기\D{0,8}(\d+)\s*대/); if (h && /투입|추가|도착/.test(q)) return { type: "heli", n: Number(h[1]) };
    if (/대피\s*명령.{0,6}(발령|내렸|했)/.test(q)) return { type: "order" };
    const st = STAGES.find((s) => q.includes(s)); if (st && /발령|격상|됐|되었/.test(q)) return { type: "stage", stage: st };
    return null;
  }
  function proposeCorrection(c, q) {
    const es = state.situation.evacuation_state, rs = state.situation.resources, rows = [];
    if (c.type === "completed") rows.push(["대피 완료 마을", es.completed_villages.join(", ") || "없음", [...new Set([...es.completed_villages, ...c.villages])].join(", ")]);
    if (c.type === "injury") rows.push(["부상·고립 보고", es.injuries.join(", ") || "없음", [...new Set([...es.injuries, ...c.villages])].join(", ")]);
    if (c.type === "heli") rows.push(["헬기 투입(대)", rs.heli_deployed, c.n]);
    if (c.type === "order") rows.push(["대피명령", es.order_issued ? "발령" : "미발령", "발령"]);
    if (c.type === "stage") rows.push(["공식 대응단계", state.situation.official_stage, c.stage]);
    const R = state.viewRun && state.viewRun.R;
    if (c.type === "completed" && R) { const notTarget = c.villages.filter((n) => !R.ordered.find((v) => v.name === n)); if (notTarget.length) { botSay(`${eun(joinKo(notTarget))} 대피 명령 대상(위험·잠재 위험구역)이 아니므로 "대피 완료"로 기록할 수 없습니다. 상황을 다시 확인해 주십시오.`); return; } }
    addMsg("sys", "상황 정정으로 판정 — 확인 창을 엽니다");
    openModal("상황 정정 확인", `<div class="small muted" style="margin-bottom:8px">입력: “${esc(q)}”</div><table class="grid"><thead><tr><th>항목</th><th>이전</th><th>변경</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(String(r[1]))}</td><td><b>${esc(String(r[2]))}</b></td></tr>`).join("")}</tbody></table><div class="small muted" style="margin-top:8px">확인하면 상황을 저장(출처: 정정·시각·사용자)하고 대응 제안을 다시 생성합니다. 제안 문구 자체를 근거 없이 바꾸는 요청은 거부됩니다.</div>`,
      [{ label: "취소", onClick: () => { botSay("정정을 취소했습니다. 상황은 바뀌지 않았습니다."); } }, { label: "확인 · 저장 후 재생성", cls: "primary", onClick: () => { applyCorrection(c); } }]);
  }
  function applyCorrection(c) {
    const s = state.situation, es = s.evacuation_state;
    if (c.type === "completed") es.completed_villages = [...new Set([...es.completed_villages, ...c.villages])];
    if (c.type === "injury") es.injuries = [...new Set([...es.injuries, ...c.villages])];
    if (c.type === "heli") s.resources.heli_deployed = c.n;
    if (c.type === "order") es.order_issued = true;
    if (c.type === "stage") s.official_stage = c.stage;
    addEvent("정정", `${state.user} — ${c.type === "completed" ? c.villages.join("·") + " 대피 완료" : c.type === "injury" ? c.villages.join("·") + " 부상·고립 보고" : c.type === "heli" ? "헬기 투입 " + c.n + "대" : c.type === "order" ? "대피명령 발령" : "공식 단계 " + c.stage}`);
    const prev = state.currentRun; const run = generateProposal("상황 정정");
    botSay(`정정을 저장하고 대응 제안 ${run.id}을 다시 생성했습니다. 바뀐 항목: ${run.changed.length ? run.changed.map((id) => (run.blocks.find((b) => b.id === id) || {}).name).join(", ") : "없음"}.`);
    if (prev) showDiff(prev, run);
    if (c.type === "stage" && stageIdx(c.stage) >= 2) toast("공식 단계가 2단계 이상이면 지휘권이 시·도지사로 넘어가 이 화면은 격상·인계 안내만 유효합니다.", 4000);
  }

  // ------------------------------------------------------------------ 역할 · 로그인 · 출처 · 검색
  function applyRole() { const v = state.role !== "decision"; $$(".decision-only").forEach((el) => el.classList.toggle("viewer-hide", v)); $("#btn-predict").disabled = v; $("#btn-whatif").disabled = v; }
  function login() {
    state.user = $("#login-id").value.trim() || "user"; state.role = $("#login-role").value; state.loginAt = new Date();
    $("#login-overlay").style.display = "none";
    applyRole(); renderAll(); setT(0); showTab("status");
    addEvent("시스템", `${state.user} 로그인(${state.role === "decision" ? "의사결정권자" : "열람자"}) · 관할 의성군`);
    if (!map) initMap();
    if (state.role === "viewer" && !state.predicted) runPrediction(true);
    else if (!state.predicted) toast("「확산예측」 탭에서 「확산 예측 실행」을 누르면 예측과 대응 제안이 생성됩니다.", 4200);
  }
  function logout() { pause(); $("#login-overlay").style.display = ""; }
  function openSources() {
    openModal("데이터 출처 · 실제/가상 구분", `
      <table class="grid"><thead><tr><th>항목</th><th>구분</th><th>출처·비고</th></tr></thead><tbody>
      <tr><td>발화점·시각·원인·실제 경과</td><td>실제</td><td>산림청 X, 위키백과, 이데일리(좌표는 OSM 괴산리 마을 중심점)</td></tr>
      <tr><td>마을·면사무소·학교·사찰·복지시설 좌표</td><td>실제</td><td>OpenStreetMap(Overpass API)</td></tr>
      <tr><td>도로·철도 선형, 담수지 후보(저수지) 위치, 읍면·군 경계, 읍면 인구</td><td>실제</td><td>OpenStreetMap, SGIS 2025.2Q·2024 인구총괄 (담수지는 OSM 수역이며 헬기 담수 가능 여부 미확인)</td></tr>
      <tr><td>위성영상·지도·지형</td><td>실제</td><td>Esri World Imagery, OpenFreeMap, AWS Terrain Tiles</td></tr>
      <tr><td>화선 P1~P8</td><td>합성</td><td>발화점·풍향·풍속 타원 모델(실측 아님)</td></tr>
      <tr><td>마을별 인구·고령·장애, 주택 점</td><td>가상</td><td>읍면 통계를 참고해 배분</td></tr>
      <tr><td>기상 시계열·습도·시정, 특보 종류</td><td>가상</td><td>발생 시 풍속 5.6 m/s만 보도값</td></tr>
      <tr><td>대피소 수용 인원, 요양병원 위치, 송전선, 대피로·진입로, 12:00 자원·호출부호, 상황접수 시각(11:24 외), 연락처</td><td>가상</td><td>구하지 못한 항목</td></tr>
      <tr><td>근거 텍스트</td><td>요약</td><td>표준매뉴얼 쪽수 기준 요약(원문 비공개)</td></tr>
      </tbody></table>
      <div class="sec">링크</div>
      <ul class="small">${S.meta.sources.map((s) => `<li>[${s.id}] ${esc(s.label)}${s.url ? ` — <a href="${s.url}" target="_blank" rel="noopener">${esc(s.url)}</a>` : ""}</li>`).join("")}</ul>
      <div class="small muted">${esc(S.meta.stage_scheme_note)} ${esc(S.meta.spread_note)} 화면 구성은 산림청 산불상황관제시스템·GPS단말기·항공기 위치추적 화면을 참고했습니다.</div>`);
  }
  function search() {
    const q = $("#search-input").value.trim(); if (!q) return;
    const v = S.villages.find((x) => x.name.includes(q)); if (v) { highlight({ villages: [v.id] }, true); showVillagePopup(v); return; }
    const s = S.shelters.find((x) => x.name.includes(q)); if (s) { highlight({ shelters: [s.id] }, true); showShelterPopup(s); return; }
    const f = S.facilities.find((x) => x.name.includes(q)); if (f) { highlight({ facilities: [f.id] }, true); return; }
    toast(`"${q}"에 해당하는 마을·시설이 없습니다.`);
  }
  function renderAll() { renderHeader(); renderStatus(); renderKpi(); renderArrival(); renderResources(); renderWeather(); renderProposal(); renderLog(); }

  // ------------------------------------------------------------------ 바인딩
  function bind() {
    $("#login-btn").onclick = login; ["#login-pw", "#login-id"].forEach((id) => $(id).addEventListener("keydown", (e) => e.key === "Enter" && login()));
    const lgClock = () => { const n = new Date(); $("#lg-clock").textContent = `${ymd(n)} ${hhmmss(n)}`; }; lgClock(); setInterval(lgClock, 1000);
    $("#chat-fab").onclick = openChatPopup;
    $("#chat-close").onclick = () => { showPanel("#chat-panel", false); $("#chat-fab").style.display = ""; $$(".menu-btn").forEach((b) => b.classList.toggle("on", b.dataset.menu === "proposal" && $("#info-panel").classList.contains("on"))); };

    $("#btn-logout").onclick = logout;
    $("#lg-sources-link").onclick = (e) => { e.preventDefault(); openSources(); };
    $$(".menu-btn").forEach((b) => (b.onclick = () => menu(b.dataset.menu)));
    $("#btn-alert").onclick = () => { state.alerts = !state.alerts; $("#btn-alert").classList.toggle("on", state.alerts); $("#btn-alert").textContent = (state.alerts ? "✔ " : "") + "알림"; };
    $("#btn-resources").onclick = () => { showPanel("#left-panel"); $("#btn-resources").classList.toggle("on", $("#left-panel").classList.contains("on")); };
    $("#lp-close").onclick = () => { showPanel("#left-panel", false); $("#btn-resources").classList.remove("on"); };
    $("#btn-search").onclick = search; $("#search-input").addEventListener("keydown", (e) => e.key === "Enter" && search());
    $$(".lyr-btn").forEach((b) => (b.onclick = () => { b.classList.toggle("off"); applyLayerVisibility(); }));
    $$(".ip-tab").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
    $("#ip-close").onclick = () => { showPanel("#info-panel", false); $$(".menu-btn").forEach((m) => m.classList.remove("on")); };
    $("#ip-fit").onclick = () => map && map.flyTo({ center: S.incident.ignition, zoom: 12.5, duration: 800 });
    $$("#ipt-status [data-go]").forEach((b) => (b.onclick = () => menu(b.dataset.go)));
    $$(".vtab").forEach((v) => (v.onclick = () => { const id = { fire: "#info-panel", weather: "#weather-panel", legend: "#legend-panel" }[v.dataset.v]; showPanel(id); if (v.dataset.v !== "fire") { showPanel(v.dataset.v === "weather" ? "#legend-panel" : "#weather-panel", false); } }));
    $("#wp-close").onclick = () => showPanel("#weather-panel", false); $("#lg-close").onclick = () => showPanel("#legend-panel", false);
    $("#ts-zoom-in").onclick = () => map && map.zoomIn(); $("#ts-zoom-out").onclick = () => map && map.zoomOut();
    $("#ts-zoom").oninput = (e) => map && map.setZoom(Number(e.target.value));
    $("#ts-fit").onclick = () => map && fitAll(); $("#compass").onclick = () => map && map.easeTo({ bearing: 0, pitch: state.is3d ? 62 : 0 });
    $("#ts-sat").onclick = () => { state.sat = !state.sat; applySat(); };
    $("#ts-3d").onclick = () => map && set3d(!state.is3d);
    $("#bd-close").onclick = () => showPanel("#bottom-dock", false);
    $("#bd-actual").onclick = () => { state.showActual = !state.showActual; state.mockOnly = false; renderLog(); };
    $("#bd-mock-only").onclick = () => { state.mockOnly = !state.mockOnly; renderLog(); };
    $("#btn-play").onclick = play; $("#btn-stop").onclick = () => { pause(); setT(0); };
    $("#time-slider").oninput = (e) => { pause(); setT(Number(e.target.value)); };
    $("#btn-predict").onclick = () => runPrediction(false);
    $("#btn-whatif").onclick = () => $("#whatif-panel").classList.toggle("on");
    $("#wi-wind").oninput = syncWiLabels; $("#wi-dir").oninput = syncWiLabels; syncWiLabels();
    $("#btn-wi-apply").onclick = applyWhatIf; $("#btn-wi-reset").onclick = resetWhatIf;
    $$(".ptab").forEach((b) => (b.onclick = () => { state.axis = b.dataset.axis; $$(".ptab").forEach((x) => x.classList.toggle("on", x === b)); renderProposal(); }));
    $$(".pfilter").forEach((b) => (b.onclick = () => { state.filter = b.dataset.f; $$(".pfilter").forEach((x) => x.classList.toggle("on", x === b)); renderProposal(); }));
    $("#btn-ev-close").onclick = () => $("#evidence-drawer").classList.remove("on");
    $("#btn-report").onclick = () => openReportForm();
    $("#btn-regenerate").onclick = () => { if (!state.predicted) { showTab("predict"); runPrediction(false); return; } const prev = state.currentRun; const run = generateProposal("수동 생성"); if (prev) showDiff(prev, run); };
    $("#chat-form").onsubmit = (e) => { e.preventDefault(); sendChat(); };
    $("#modal-bg").addEventListener("click", (e) => { if (e.target.id === "modal-bg") closeModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); $("#evidence-drawer").classList.remove("on"); } });
    ["#info-panel", "#left-panel", "#weather-panel", "#legend-panel", "#chat-panel"].forEach((id) => makeDraggable($(id)));
  }

  // 마커 스타일 (위성영상 위 가독성: 흰 라벨 + 노란 거리 라벨)
  const css = document.createElement("style");
  css.textContent = `
    .mk { display:flex; flex-direction:column; align-items:center; cursor:pointer; pointer-events:auto; }
    .mk .ico { width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(0,0,0,.6); border:1.5px solid #fff; }
    .mk .ico svg { width:13px; height:13px; stroke:#fff; fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
    .mk.crew .ico svg { stroke:#333; }
    .mk .lb { margin-top:1px; font-size:11px; font-weight:700; color:#fff; text-shadow:0 0 3px #000, 0 0 3px #000, 0 1px 2px #000; white-space:nowrap; line-height:1.3; text-align:center; }
    body:not(.satmap) .mk .lb { color:#111; text-shadow:0 0 3px #fff, 0 0 3px #fff; }
    .mk .lb small { display:none; font-size:9.5px; font-weight:500; }
    .mk:hover .lb small { display:block; }
    .mk .dist { display:none; margin-top:1px; background:#ffff99; color:#111; border:1px solid #8a8a3a; font-size:10px; font-weight:700; padding:0 4px; border-radius:2px; box-shadow:0 1px 2px rgba(0,0,0,.4); }
    .mk.show-dist .dist { display:inline-block; }
    .mk.village.burned .ico { background:#e5341a !important; box-shadow:0 0 0 3px rgba(255,59,26,.35), 0 1px 3px rgba(0,0,0,.6); } .mk.village.burned .lb { color:#ffb3a3; }
    .mk.shelter.unsafe .ico { background:#ef4444 !important; }
    .mk.crew .ico { width:18px; height:18px; } .mk.crew .lb { display:none; } .mk.crew:hover .lb { display:block; }
    .mk.f0 .ico { width:26px; height:26px; box-shadow:0 0 0 6px rgba(255,42,0,.3), 0 1px 4px rgba(0,0,0,.6); } .mk.f0 .ico svg { width:15px; height:15px; } .mk.f0 .lb { color:#ffd0c4; font-size:12px; }
    .mk.hi .ico { transform:scale(1.35); box-shadow:0 0 0 5px rgba(255,224,102,.7), 0 1px 4px rgba(0,0,0,.6); } .mk.hi .lb { color:#ffe066; }
    .mk.emd { font-size:11px; font-weight:700; color:#fff; letter-spacing:.06em; opacity:.85; pointer-events:none; text-shadow:0 0 3px #000, 0 0 3px #000; }
    body:not(.satmap) .mk.emd { color:#334155; text-shadow:0 0 3px #fff, 0 0 3px #fff; }
    .maplibregl-marker { z-index:2; } .mk.hi { z-index:5; }`;
  document.head.appendChild(css);

  // ------------------------------------------------------------------ 시작
  state.houses = genHouses();
  bind(); renderLegend(); renderWeather();
  $("#ip-clock").textContent = `${ymd(T0)} ${hhmmss(T0)}`;
  document.body.classList.add("satmap");
  window.__mock = { state, get map() { return map; }, ringAreaHa, firePolygon, runPrediction, generateProposal };
})();
