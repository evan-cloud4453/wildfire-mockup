/* =====================================================================
   산불 대응 AI — 결과물 중심 목업 (app.js)
   지도(MapLibre) · 합성 확산 모델 · 규칙 판정 · 제안서 14블록 · 근거 열람 · 챗봇(대본) · 정정 · 채택 기록
   실제 ELMFIRE·RAG·LLM·기상 API는 없다. 모든 판단은 이 파일 안의 규칙과 템플릿이다.
   ===================================================================== */
(() => {
  "use strict";
  const S = window.SCENARIO;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fmt1 = (n) => (Math.round(n * 10) / 10).toString();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const joinKo = (arr) => arr.join("·");
  // 한글 조사: 받침 유무로 을/를, 은/는, 이/가, 으로/로 선택
  const hasBatchim = (w) => { const c = String(w).replace(/[)\]"'\s]+$/, "").slice(-1).charCodeAt(0); return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : false; };
  const josa = (w, a, b) => `${w}${hasBatchim(w) ? a : b}`;
  const eul = (w) => josa(w, "을", "를"), eun = (w) => josa(w, "은", "는"), ro = (w) => josa(w, "으로", "로");

  // ------------------------------------------------------------------ 시각
  const T0 = new Date(S.meta.t0);
  const START = new Date(S.incident.start_time);
  const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const addH = (d, h) => new Date(d.getTime() + h * 3600e3);
  const timeAt = (h) => hhmm(addH(T0, h));
  const parseHM = (s) => { const [h, m] = s.split(":").map(Number); const d = new Date(T0); d.setHours(h, m, 0, 0); return d; };
  const SUNSET = parseHM(S.astronomy.sunset), SUNRISE = parseHM(S.astronomy.sunrise);
  const isNight = (d) => d >= SUNSET || d < SUNRISE;
  const elapsed = (d) => { const m = Math.round((d - START) / 60e3); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };

  // ------------------------------------------------------------------ 상태
  const state = {
    role: null, user: null,
    t: 0, playing: false, timer: null,
    wind: { ms: S.weather.series[0].wind_ms, dir: S.weather.series[0].wind_dir },
    baseSlices: [], slices: [], whatif: false, compare: true,
    predicted: false,
    situation: {
      official_stage: S.incident.official_stage, alert_level: S.incident.alert_level,
      resources: clone(S.resources), field_report: clone(S.field_report), evacuation_state: clone(S.evacuation_state)
    },
    runs: [], currentRun: null, viewRun: null,
    decisions: JSON.parse(localStorage.getItem("mock.decisions") || "{}"),
    events: [], unread: 0,
    chatCtx: null, is3d: false, axis: "진화", filter: "all",
    houses: null, markers: {}, emdLabels: []
  };

  // ------------------------------------------------------------------ 기하
  const [LNG0, LAT0] = S.incident.ignition;
  const MX = 111320 * Math.cos(LAT0 * Math.PI / 180), MY = 110540;
  const toM = (lng, lat) => [(lng - LNG0) * MX, (lat - LAT0) * MY];
  const fromM = (x, y) => [LNG0 + x / MX, LAT0 + y / MY];
  const distKm = (a, b) => { const [x1, y1] = toM(a[0], a[1]), [x2, y2] = toM(b[0], b[1]); return Math.hypot(x1 - x2, y1 - y2) / 1000; };

  function pointInRing(pt, ring) {
    const [x, y] = pt; let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
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
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = toM(ring[i][0], ring[i][1]), [x2, y2] = toM(ring[i + 1][0], ring[i + 1][1]);
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2 / 1e4;
  }
  function lineSamples(coords, stepM = 120) {
    const out = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1];
      const n = Math.max(1, Math.ceil(distKm(a, b) * 1000 / stepM));
      for (let k = 0; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    return out;
  }
  const lineHitsRing = (coords, ring) => lineSamples(coords).some((p) => pointInRing(p, ring));
  const firstSlice = (test) => { for (let t = 1; t <= 8; t++) if (test(state.slices[t - 1])) return t; return null; };
  const dirName = (deg) => ["북", "북북동", "북동", "동북동", "동", "동남동", "남동", "남남동", "남", "남남서", "남서", "서남서", "서", "서북서", "북서", "북북서"][Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

  // 합성 확산 모델: 발화점을 뒤쪽 초점으로 둔 타원 + 발화점 기준 각도 노이즈. 시간에 비례해 커지므로 P_t ⊇ P_{t-1}
  function firePolygon(tHours, wind) {
    const fm = S.fire_model, U = wind.ms;
    const head = fm.head[0] + fm.head[1] * U, flank = fm.flank[0] + fm.flank[1] * U, back = fm.back;
    const a = (head + back) / 2 * tHours, b = flank * tHours, c = (head - back) / 2 * tHours; // km
    const toward = (wind.dir + 180) * Math.PI / 180;           // 확산 방향(방위각)
    const th = Math.PI / 2 - toward;                           // 수학 좌표계 회전
    const ring = [];
    for (let i = 0; i <= 72; i++) {
      const phi = i / 72 * 2 * Math.PI;
      let x = c + a * Math.cos(phi), y = b * Math.sin(phi);   // 타원 좌표(확산 방향 = +x)
      const r = Math.hypot(x, y), al = Math.atan2(y, x);
      const m = 1 + fm.noise_amp * (0.55 * Math.sin(3 * al + 0.7) + 0.3 * Math.sin(7 * al + 2.1) + 0.15 * Math.sin(11 * al + 4.0));
      x = r * m * Math.cos(al); y = r * m * Math.sin(al);
      const xr = x * Math.cos(th) - y * Math.sin(th), yr = x * Math.sin(th) + y * Math.cos(th);
      ring.push(fromM(xr * 1000, yr * 1000));
    }
    ring[ring.length - 1] = ring[0];
    return ring;
  }
  const buildSlices = (wind) => Array.from({ length: 8 }, (_, i) => firePolygon(i + 1, wind));
  function f0Ring(rM = 150) { const r = []; for (let i = 0; i <= 36; i++) { const a = i / 36 * 2 * Math.PI; r.push(fromM(rM * Math.cos(a), rM * Math.sin(a))); } return r; }

  // 주택(가상) 점 생성: 마을 중심 주변 250~450 m
  function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function genHouses() {
    const rnd = mulberry(7), out = [];
    S.villages.forEach((v) => {
      const n = Math.max(6, Math.round(v.hh / 3));
      for (let i = 0; i < n; i++) {
        const r = 120 + rnd() * 330, a = rnd() * 2 * Math.PI;
        const [x, y] = toM(v.lng, v.lat); out.push({ v: v.id, pt: fromM(x + r * Math.cos(a), y + r * Math.sin(a)) });
      }
    });
    return out;
  }

  // ------------------------------------------------------------------ 규칙 엔진 (F4-2)
  const STAGES = S.stage_rules.area_ha.map((r) => r.stage);
  const stageByArea = (ha) => { for (const r of S.stage_rules.area_ha) if ((r.min == null || ha >= r.min) && (r.max == null || ha < r.max)) return r.stage; return STAGES[0]; };
  const stageIdx = (s) => Math.max(0, STAGES.indexOf(s));

  function computeRules(situation) {
    const sl = state.slices, P5 = sl[4], P8 = sl[7];
    const es = situation.evacuation_state;
    const R = { t0: T0, sunset: S.astronomy.sunset, sunrise: S.astronomy.sunrise };
    R.areaByT = sl.map(ringAreaHa); R.areaP5 = R.areaByT[4]; R.areaP8 = R.areaByT[7];
    R.avgWind = S.weather.series.slice(0, 6).reduce((a, w) => a + w.wind_ms, 0) / 6;
    R.maxWind = S.weather.series.reduce((m, w) => (w.wind_ms > m.wind_ms ? w : m), S.weather.series[0]);
    R.spreadDir = dirName(state.wind.dir + 180);

    // 마을
    R.villages = S.villages.map((v) => {
      const arrival = firstSlice((ring) => pointInRing([v.lng, v.lat], ring));
      const at = arrival ? addH(T0, arrival) : null;
      const zone = arrival == null ? "none" : arrival <= 5 ? "immediate" : "standby";
      const status = es.completed_villages.includes(v.name) ? "completed" : es.unreached_villages.includes(v.name) ? "unreached" : null;
      return { ...v, arrival, arrivalTime: at ? hhmm(at) : null, zone, night: at ? isNight(at) : false, status };
    });
    const byOrder = (a, b) => (a.arrival - b.arrival) || (b.elderly - a.elderly);
    R.immediate = R.villages.filter((v) => v.zone === "immediate").sort(byOrder);
    R.standby = R.villages.filter((v) => v.zone === "standby").sort(byOrder);
    R.ordered = [...R.immediate, ...R.standby];
    R.nightVillages = R.ordered.filter((v) => v.night);
    R.unreached = es.order_issued ? R.immediate.filter((v) => v.status !== "completed" && !es.completed_villages.includes(v.name)) : [];

    // 시설
    R.facilities = S.facilities.map((f) => ({ ...f, arrival: firstSlice((ring) => pointInRing([f.lng, f.lat], ring)) }));
    R.careIn = R.facilities.filter((f) => (f.type === "care" || f.type === "welfare") && f.arrival != null);
    R.heritageIn5 = R.facilities.filter((f) => (f.type === "heritage" || f.type === "temple") && f.arrival != null && f.arrival <= 5);
    R.heritageIn8 = R.facilities.filter((f) => (f.type === "heritage" || f.type === "temple") && f.arrival != null);
    const houses = state.houses;
    R.housesP5 = houses.filter((h) => pointInRing(h.pt, P5)).length;
    R.housesP8 = houses.filter((h) => pointInRing(h.pt, P8)).length;
    R.housesByVillage = {}; houses.forEach((h) => { if (pointInRing(h.pt, P5)) R.housesByVillage[h.v] = (R.housesByVillage[h.v] || 0) + 1; });
    R.powerLine = powerLineCoords();
    R.powerIn = firstSlice((ring) => lineHitsRing(R.powerLine.coords, ring));

    // 대피소·배정
    R.shelters = S.shelters.map((s) => ({ ...s, inP8: pointInRing([s.lng, s.lat], P8), inP5: pointInRing([s.lng, s.lat], P5), load: 0, assigned: [] }));
    const safe = R.shelters.filter((s) => !s.inP8);
    R.assignments = [];
    R.ordered.forEach((v) => {
      const cand = safe.map((s) => ({ s, d: distKm([v.lng, v.lat], [s.lng, s.lat]) })).sort((a, b) => a.d - b.d);
      let pick = cand.find((c) => c.s.load + v.pop <= c.s.capacity) || cand[0];
      if (!pick) return;
      pick.s.load += v.pop; pick.s.assigned.push(v.name);
      R.assignments.push({ village: v, shelter: pick.s, km: pick.d, minutes: Math.round(pick.d / 40 * 60) + 10, overflow: pick.s.load > pick.s.capacity });
    });
    R.overflow = R.shelters.filter((s) => s.load > s.capacity);

    // 경로
    const conflict = S.routes.find((r) => r.kind === "conflict");
    R.routeConflict = !!conflict;
    R.routeInFire = conflict ? firstSlice((ring) => lineHitsRing(conflict.coords, ring)) : null;

    // 인력
    R.crewIn5 = situation.resources.crew_positions.filter((p) => pointInRing(p, P5)).length;
    R.crewTotal = situation.resources.crew_positions.length;

    // 단계·지휘권
    R.recStageByArea = stageByArea(R.areaP5);
    R.recStage = R.recStageByArea;
    R.official = situation.official_stage;
    R.stageUp = stageIdx(R.recStage) > stageIdx(R.official);
    R.outOfScope = stageIdx(R.official) >= 2;
    const sig = (window.BOUNDARIES || { features: [] }).features.find((f) => f.properties.level === "sigungu");
    R.crossesSigungu = sig ? P5.some((p) => !pointInGeom(p, sig.geometry)) : false;
    const emds = (window.BOUNDARIES || { features: [] }).features.filter((f) => f.properties.level === "emd");
    R.emdIn5 = emds.filter((f) => P5.some((p) => pointInGeom(p, f.geometry)) || pointInGeom(S.incident.ignition, f.geometry)).map((f) => f.properties.name);
    if (!R.emdIn5.length) R.emdIn5 = [...new Set(R.immediate.map((v) => v.emd).concat(["안평면"]))];
    R.emdIn8 = emds.filter((f) => P8.some((p) => pointInGeom(p, f.geometry)) || pointInGeom(S.incident.ignition, f.geometry)).map((f) => f.properties.name);
    if (!R.emdIn8.length) R.emdIn8 = [...new Set(R.ordered.map((v) => v.emd).concat(["안평면"]))];
    R.nextHolder = R.recStage === "확산대응 2단계" || R.crossesSigungu ? "시·도지사(경상북도지사)" : null;

    // 기상·헬기
    R.heliOkNow = state.wind.ms < 15 && !isNight(T0);
    R.night5 = isNight(addH(T0, 5));
    R.cbsTargets = [...new Set(R.ordered.map((v) => v.emd))];
    R.cbsStage = es.order_issued ? "대피 명령" : R.immediate.length ? "대피 명령(발령 시)" : "산불 발생";
    R.injuries = es.injuries || [];
    R.isolated = [];
    return R;
  }
  function powerLineCoords() {
    const osm = (window.OSM_LINES || { features: [] }).features.filter((f) => f.properties.kind === "line");
    if (osm.length) return { name: "송전선(OSM)", real: true, coords: osm[0].geometry.coordinates, multi: osm };
    return S.power_line_fallback;
  }

  // ------------------------------------------------------------------ 제안서 생성 (F4-4~F4-7 템플릿)
  const vn = (list) => (list.length ? joinKo(list.map((v) => v.name)) : "없음");
  const vnP = (list) => (list.length ? joinKo(list.map((v) => `${v.name}(P${v.arrival})`)) : "없음");
  const E = (keys) => keys.map((key, i) => ({ k: i + 1, key }));

  function buildProposal(R, situation) {
    const es = situation.evacuation_state, rs = situation.resources, fr = situation.field_report;
    const B = [];
    const none = (id) => ({ id, finding: "", status: ["(없음)"], text: "(없음)", targets: [], conflicts: [], evidence: [] });
    const cat = Object.fromEntries(S.catalog.map((c) => [c.id, c]));
    const push = (b) => { const c = cat[b.id]; B.push({ axis: c.axis, name: c.name, authority: c.authority, targets: [], conflicts: [], ref: {}, ...b }); };

    // S1
    {
      const facCount = R.heritageIn5.length + R.careIn.filter((f) => f.arrival <= 5).length;
      const finding = `예상 피해면적(P5) ${fmt1(R.areaP5)} ha → ${R.recStageByArea} 기준 / 평균풍속 ${fmt1(R.avgWind)} m/s(기준값 미적용) / 시설피해 우려 주택 ${R.housesP5}동·주요시설 ${facCount}동 / 예상 진화시간 ${fr.expected_suppression_hours == null ? "미입력" : fr.expected_suppression_hours + "시간"} → 규칙 판정 ${R.recStage}, 공식 ${R.official}`;
      if (R.stageUp) {
        let text = `5시간 후 예상 피해면적 ${fmt1(R.areaP5)} ha는 ${R.recStage} 기준(${R.recStage === "확산대응 2단계" ? "100 ha 이상" : "10 ha 이상 100 ha 미만"})에 해당합니다 [1]. 산림청장과 대응단계 격상을 협의하십시오 [2].`;
        if (R.nextHolder) text += ` 격상되면 지휘권이 ${R.nextHolder}에게 넘어가므로 피해상황·투입 자원·추가 피해 가능성을 인계할 준비를 하십시오 [3].`;
        push({ id: "S1", finding, status: ["협의"], text, targets: ["산림청장"], evidence: E(["SM-p073", "SM-p022", "SM-p072"]) });
      } else push({ ...none("S1"), finding, evidence: E(["SM-p073"]) });
    }
    // S2
    {
      const g1 = [...R.immediate.map((v) => v.name), ...R.careIn.filter((f) => f.arrival <= 5).map((f) => f.name)];
      const g2 = [...R.heritageIn5.map((f) => f.name), ...(R.powerIn && R.powerIn <= 5 ? [`송전선(P${R.powerIn})`] : [])];
      const g3 = R.housesP5 ? [`주택 ${R.housesP5}동`] : [];
      const finding = `P5 내 보호대상 ① 인명: ${g1.length ? joinKo(g1) : "없음"} ② 국가기간·군사·국가유산: ${g2.length ? joinKo(g2) : "없음"} ③ 재산: ${g3.length ? g3[0] : "없음"} ④·⑤ 산림: P5 ${fmt1(R.areaP5)} ha`;
      const order = [g1.length ? joinKo(g1) : null, g2.length ? joinKo(g2) : null, g3[0] || null].filter(Boolean);
      if (order.length) push({ id: "S2", finding, status: ["즉시"], text: `${order.join(" → ")} 순으로 진화 우선지역을 정하십시오 [1]. 인명·국가유산·고압선 피해 여부와 확대 가능성을 우선 판단하십시오 [2].`, targets: order, evidence: E(["SM-p077", "SM-p118"]), ref: { villages: R.immediate.map((v) => v.id), facilities: [...R.careIn, ...R.heritageIn5].map((f) => f.id), power: !!(R.powerIn && R.powerIn <= 5) } });
      else push({ ...none("S2"), finding, evidence: E(["SM-p077"]) });
    }
    // S3
    {
      const finding = `투입 헬기 ${rs.heli_deployed}대·지상 ${rs.ground_crew_deployed}명·소방차 ${rs.fire_trucks_deployed}대 / 인근 가용 헬기 ${rs.heli_available_nearby}대 / 진화율 ${fr.containment_pct}% / 진화구역 후보: 주 확산 방향(${R.spreadDir}) 1순위, 양 측면 2순위 / 소요 산식 없음`;
      push({ id: "S3", finding, status: ["즉시", "근거 부족"], text: `주 확산 방향인 ${R.spreadDir}쪽 구역(${vn(R.immediate)})에 지상진화 자원을 우선 배치하고, 진화전략도에 구역별 진화율을 반영해 재배치하십시오 [1]. 가용 진화헬기를 집중 투입하십시오 [2]. 추가 투입이 필요한 헬기 대수는 매뉴얼에 산정 기준이 없어 근거 부족입니다.`, targets: [`${R.spreadDir} 구역`], evidence: E(["SM-p041", "SM-p077"]), ref: { villages: R.immediate.map((v) => v.id), crew: true } });
    }
    // S4
    {
      const finding = `현재 풍속 ${state.wind.ms} m/s(${dirName(state.wind.dir)}풍) / 최대 ${R.maxWind.wind_ms} m/s(${R.maxWind.t}) / 헬기 운용 ${R.heliOkNow ? "가능" : "제한"} / 일몰 ${R.sunset}, t0+5h ${timeAt(5)}(${R.night5 ? "야간 포함" : "주간"})`;
      push({ id: "S4", finding, status: ["즉시"], text: `현재 풍속에서는 헬기 운용이 가능하므로 가용 헬기를 집중 투입하십시오 [1]. ${R.maxWind.t} 전후 풍속이 ${R.maxWind.wind_ms} m/s로 강해지는 시간대에는 지상진화에 집중할 준비를 하고, 일몰(${R.sunset}) 이후 풍속이 잦아드는 시간대에 집중 진화를 지시하십시오 [2].`, targets: ["전 진화자원"], evidence: E(["SM-p077", "SM-p078"]) });
    }
    // S5
    {
      const finding = `P5 내 주택 ${R.housesP5}동(P8 누적 ${R.housesP8}동) / 송전선 ${R.powerIn ? `P${R.powerIn} 통과` : "범위 밖"} / 취약시설 ${R.careIn.length ? joinKo(R.careIn.map((f) => `${f.name}(P${f.arrival})`)) : "없음"}`;
      const st = R.housesP5 ? ["즉시"] : []; if (R.powerIn) st.push("요청");
      let text = "";
      if (R.housesP5) text += `${vn(R.immediate)} 주택군 주변에 소방차 등 진화장비를 집중 배치하고 인접 산림에 예비 살수를 지시하십시오 [1].`;
      if (R.powerIn) text += ` 송전선이 P${R.powerIn} 확산 범위를 지나므로 전류 차단과 우회선로 확보를 한전에 요청하십시오 [2].`;
      if (st.length) push({ id: "S5", finding, status: st, text, targets: [R.housesP5 ? "주택군(소방)" : null, R.powerIn ? "송전선(한전)" : null].filter(Boolean), evidence: E(["SM-p079", "SM-p095"]), ref: { villages: R.immediate.map((v) => v.id), power: !!R.powerIn, houses: true } });
      else push({ ...none("S5"), finding, evidence: E(["SM-p079"]) });
    }
    // S6
    {
      const finding = `걸친 시·군·구 ${R.crossesSigungu ? "2개 이상" : "1개(의성군)"}, 지휘권 변경 ${R.nextHolder ? "검토(" + R.nextHolder + ")" : "없음"} / 확산 범위 읍면 ${joinKo(R.emdIn5)} / 자원 부족분 산출 불가(소요 기준 없음) / 인접 시·군 가용 자원 미입력`;
      const st = R.immediate.length >= 2 ? ["요청"] : []; if (R.nextHolder) st.unshift("협의");
      let text = R.crossesSigungu ? `확산 범위가 인접 시·군에 걸치므로 지휘권이 시·도지사로 바뀌는지 협의하십시오 [1].` : `확산 범위가 의성군 안에 있어 걸친 행정구역에 따른 지휘권 변경은 없습니다 [1].`;
      if (R.immediate.length >= 2) text += ` 진화자원이 확산 정도에 미치지 못하면 인접 시·군의 진화자원과 소방·경찰·군의 인력·장비 동원을 요청하고, 산불현장 대책회의에서 기관별 임무를 부여하십시오 [2]. 요청 수량은 소요 기준이 없어 근거 부족입니다.`;
      push({ id: "S6", finding, status: st.length ? st : ["(없음)"], text: st.length ? text : "(없음)", targets: st.length ? ["인접 시·군", "소방·경찰·군"] : [], evidence: E(["SM-p072", "SM-p022"]) });
    }
    // S7
    {
      const finding = `진화인력 위치 ${R.crewTotal}개 조 중 P5 내 ${R.crewIn5}개 조 / 퇴로: 풍상측(${dirName(state.wind.dir)}) 도로 확보 / 풍향 급변 없음(예보 ${S.weather.series[0].wind_dir}°→${S.weather.series[8].wind_dir}°)`;
      push({ id: "S7", finding, status: ["즉시"], text: `P5 안에서 작업 중인 지상진화인력의 위치추적장치 휴대와 진화복·안전장구를 확인하고, 풍상측(${dirName(state.wind.dir)})으로 퇴로를 지정하십시오 [1]. ${R.maxWind.t} 전후 풍속이 최대가 되는 시간대에는 화선 전방(${R.spreadDir})으로의 투입을 제한하십시오 [2].`, targets: [`지상진화인력 ${rs.ground_crew_deployed}명`], evidence: E(["SM-p077", "SM-p118"]), ref: { crew: true } });
    }
    // E1
    {
      const finding = `위험구역(≤5h) ${vnP(R.immediate)} / 잠재 위험구역(≤8h) ${vnP(R.standby)}`;
      const st = []; if (R.immediate.length) st.push("즉시"); if (R.standby.length) st.push("대기");
      let text = "";
      if (R.immediate.length) text += `${eul(vn(R.immediate))} 위험구역(즉시 실행)으로 설정하십시오 [1].`;
      if (R.standby.length) text += ` ${eul(vn(R.standby))} 잠재 위험구역(실행 대기)으로 설정하십시오 [1].`;
      push({ id: "E1", finding, status: st.length ? st : ["(없음)"], text: text || "(없음)", targets: R.ordered.map((v) => v.name), evidence: E(["SM-p074"]), ref: { villages: R.ordered.map((v) => v.id), risk: true } });
    }
    // E2
    {
      const ord = R.ordered.map((v) => `${v.name}(${v.arrivalTime} 도달, 고령 ${v.elderly})`).join(" → ");
      const finding = `순위 ${ord || "없음"} / 야간 포함 ${vn(R.nightVillages)} / 대피명령 ${es.order_issued ? "발령" : "미발령"} / 완료 ${es.completed_villages.length ? joinKo(es.completed_villages) : "없음"}`;
      let text = "", st = [];
      if (!R.ordered.length) { push({ ...none("E2"), finding, evidence: E(["SM-p074"]) }); }
      else {
        const done = R.immediate.filter((v) => v.status === "completed"), toOrder = R.immediate.filter((v) => v.status !== "completed");
        if (!es.order_issued && toOrder.length) { st.push("즉시"); text += `${vn(toOrder)} 순으로 마을 단위 대피명령을 즉시 내리고 안전취약계층부터 대피시키십시오 [1][2].`; }
        if (!es.order_issued && done.length) text += ` ${eun(vn(done))} 대피 완료 보고가 있으므로 명령 대상에서 제외하고 완료 여부를 재확인하십시오 [3].`;
        if (es.order_issued) { st.push("즉시"); text += `대피명령이 발령된 상태입니다. ${R.unreached.length ? `미대피 마을 ${vn(R.unreached)}의 대피 완료를 확인하고 완료 보고를 받으십시오 [3].` : "위험구역 마을의 대피 완료 보고를 확인하십시오 [3]."}`; }
        if (R.standby.length) { st.push("대기"); text += ` ${eun(vn(R.standby))} 실행 대기로 두고 대피 준비를 지시하십시오 [1].`; }
        if (R.nightVillages.length) text += ` ${eun(joinKo(R.nightVillages.map((v) => `${v.name}(${v.arrivalTime})`)))} 화선 도달 예상 시각이 일몰(${R.sunset}) 이후이므로 일몰 전 사전대피를 지시하십시오 [1].`;
        push({ id: "E2", finding, status: st, text, targets: R.ordered.map((v) => v.name), evidence: E(["SM-p074", "SM-p079", "SM-p084"]), ref: { villages: R.ordered.map((v) => v.id) } });
      }
    }
    // E3
    {
      const finding = `취약시설 ${R.careIn.length ? joinKo(R.careIn.map((f) => `${f.name}(P${f.arrival}, ${f.capacity}명)`)) : "확산 범위 내 없음"} / 미대피 ${vn(R.unreached)} / 부상 ${R.injuries.length ? joinKo(R.injuries) : "없음"}`;
      let text = "", st = [];
      R.careIn.forEach((f) => { st.push(f.arrival <= 5 ? "즉시" : "대기"); text += `${f.name}(수용 ${f.capacity}명)이 P${f.arrival} 범위에 들므로 위험구역에 포함해 별도 이송을 지시하십시오 [1]. `; });
      if (R.unreached.length) { st.push("즉시"); text += `대피하지 않은 ${vn(R.unreached)} 주민은 강제로 대피시키십시오 [2].`; }
      st = [...new Set(st)];
      if (st.length) push({ id: "E3", finding, status: st, text: text.trim(), targets: [...R.careIn.map((f) => f.name), ...R.unreached.map((v) => v.name)], evidence: E(["SM-p074", "SM-p084"]), ref: { facilities: R.careIn.map((f) => f.id), villages: R.unreached.map((v) => v.id) } });
      else push({ ...none("E3"), finding, evidence: E(["SM-p074"]) });
    }
    // E4
    {
      const safe = R.shelters.filter((s) => !s.inP8), unsafe = R.shelters.filter((s) => s.inP8);
      const finding = `안전 대피소 ${joinKo(safe.map((s) => `${s.name}(${s.capacity})`))} / P8 안 대피소 ${unsafe.length ? joinKo(unsafe.map((s) => s.name)) : "없음"} / 배정 ${R.assignments.map((a) => `${a.village.name}→${a.shelter.name} ${a.shelter.load}/${a.shelter.capacity}`).join(", ") || "없음"} / 초과 ${R.overflow.length ? joinKo(R.overflow.map((s) => s.name)) : "없음"}`;
      if (R.assignments.length) {
        const byShelter = {}; R.assignments.forEach((a) => { (byShelter[a.shelter.name] = byShelter[a.shelter.name] || []).push(a); });
        let text = Object.entries(byShelter).map(([sn, as]) => `${joinKo(as.map((a) => a.village.name))} 주민은 ${sn}(${as[0].shelter.load}/${as[0].shelter.capacity}명, 최대 ${Math.max(...as.map((a) => a.minutes))}분)`).join(", ").replace(/분\)$/, "분)") + (hasBatchim(Object.keys(byShelter).slice(-1)[0]) ? "으로" : "로") + " 배정하십시오 [1].";
        if (unsafe.length) text += ` ${eun(joinKo(unsafe.map((s) => s.name)))} P8 범위 안이므로 대피소에서 제외하십시오 [2].`;
        if (R.overflow.length) text += ` ${eun(joinKo(R.overflow.map((s) => s.name)))} 수용 인원을 초과하므로 인접 대피소로 분산하십시오 [1].`;
        push({ id: "E4", finding, status: ["즉시"], text, targets: Object.keys(byShelter), evidence: E(["SM-p065", "SM-p074"]), ref: { shelters: R.shelters.map((s) => s.id), villages: R.ordered.map((v) => v.id) } });
      } else push({ ...none("E4"), finding, evidence: E(["SM-p065"]) });
    }
    // E5
    {
      const finding = `대피로 A(박곡리→의성 실내체육관)가 진화차량 진입로와 겹침(가상 구간) / 겹침 구간 화선 도달 ${R.routeInFire ? `P${R.routeInFire}` : "8시간 내 없음"}`;
      let text = `대피로와 진화차량 진입로가 같은 구간을 쓰므로 경찰에 해당 구간의 교통통제(일방통행)와 주민대피 지원을 요청하십시오 [1].`;
      if (R.routeInFire) text += ` 겹침 구간이 P${R.routeInFire}에 확산 범위에 들므로 ${timeAt(R.routeInFire)} 전에 통제를 마치십시오 [2].`;
      push({ id: "E5", finding, status: ["요청"], text, targets: ["경찰(겹침 구간)"], conflicts: [{ type: "대피로·진입로 겹침", with: "S3", resolution: "요청 전환" }], evidence: E(["SM-p119", "SM-p065"]), ref: { routes: ["evac-A", "access-1", "conflict"] } });
    }
    // E6
    {
      const finding = `대상 읍면동 ${joinKo(R.emdIn8)} / 송출 단계 ${R.cbsStage} / 송출 이력 ${es.cbs_sent.length ? es.cbs_sent.join(", ") : "없음"}`;
      if (R.ordered.length) push({ id: "E6", finding, status: ["즉시"], text: `${es.order_issued ? "대피명령 발령에 따라" : "대피명령과 동시에"} ${joinKo(R.emdIn8)}에 긴급재난문자(CBS)와 자막방송(DITS)을 대피 명령 단계로 송출하십시오 [1].`, targets: R.emdIn8, evidence: E(["SM-p078b"]) });
      else push({ ...none("E6"), finding, evidence: E(["SM-p078b"]) });
    }
    // E7
    {
      const finding = `고립 후보 ${R.isolated.length ? joinKo(R.isolated) : "없음"} / 부상 보고 ${R.injuries.length ? joinKo(R.injuries) : "없음"}`;
      if (R.injuries.length) push({ id: "E7", finding, status: ["요청"], text: `${joinKo(R.injuries)} 부상 보고에 따라 소방 긴급구조통제단에 구조·구급을 요청하십시오 [1][2].`, targets: ["소방(긴급구조통제단)"], evidence: E(["SM-p021", "SM-p119"]) });
      else push({ ...none("E7"), finding, evidence: E(["SM-p021"]) });
    }
    // 개인화(F1-4): 관할 밖 마을 → 요청 (이 시나리오는 모두 의성군)
    return B;
  }

  function summarize(blocks) {
    const c = { "즉시": 0, "대기": 0, "협의": 0, "요청": 0, "보고": 0, "근거 부족": 0, "정보 부족": 0, "없음": 0 };
    blocks.forEach((b) => b.status.forEach((s) => { const k = s === "(없음)" ? "없음" : s; if (k in c) c[k]++; }));
    return c;
  }

  // ------------------------------------------------------------------ run 관리 (F4-1, F4-13 이력)
  let runSeq = 0;
  function generateProposal(reason) {
    const R = computeRules(state.situation);
    const blocks = buildProposal(R, state.situation);
    runSeq++;
    const run = { id: `R${String(runSeq).padStart(3, "0")}`, t0: hhmm(T0), createdAt: new Date(), reason, R, blocks, summary: summarize(blocks), snapshot: clone(state.situation), wind: { ...state.wind } };
    const prev = state.currentRun;
    run.changed = prev ? blocks.filter((b) => { const p = prev.blocks.find((x) => x.id === b.id); return !p || p.text !== b.text || p.status.join() !== b.status.join() || p.finding !== b.finding; }).map((b) => b.id) : [];
    state.runs.push(run); state.currentRun = run; state.viewRun = run;
    addEvent(`제안서 ${run.id} 생성 (${reason}) — 즉시 ${run.summary["즉시"]}·대기 ${run.summary["대기"]}·협의 ${run.summary["협의"]}·요청 ${run.summary["요청"]}${run.changed.length ? ` · 변경 ${run.changed.length}항목` : ""}`, "prop");
    renderAll();
    return run;
  }

  // ------------------------------------------------------------------ 지도
  let map;
  const EMPTY = { type: "FeatureCollection", features: [] };
  const fc = (feats) => ({ type: "FeatureCollection", features: feats });
  const poly = (ring, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [ring] } });
  const line = (coords, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } });

  function initMap() {
    map = new maplibregl.Map({
      container: "map",
      style: {
        version: 8,
        sources: {
          osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" },
          dem: { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: "Terrain: AWS Terrain Tiles / Mapzen" }
        },
        layers: [
          { id: "osm", type: "raster", source: "osm", paint: { "raster-brightness-max": 0.82, "raster-saturation": -0.35, "raster-contrast": 0.05 } },
          { id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.45, "hillshade-shadow-color": "#0b1016", "hillshade-highlight-color": "#e8eef5", "hillshade-accent-color": "#1a2430" } }
        ]
      },
      center: [128.64, 36.38], zoom: 11.4, maxPitch: 75, attributionControl: true
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    map.on("load", () => {
      const add = (id, data, layers) => { map.addSource(id, { type: "geojson", data }); layers.forEach((l) => map.addLayer({ source: id, ...l })); };
      // 행정 경계
      const B = window.BOUNDARIES || EMPTY;
      add("admin", B, [
        { id: "admin-emd", type: "line", filter: ["==", ["get", "level"], "emd"], paint: { "line-color": "#cbd5e1", "line-width": 1, "line-dasharray": [3, 3], "line-opacity": 0.55 } },
        { id: "admin-sig", type: "line", filter: ["==", ["get", "level"], "sigungu"], paint: { "line-color": "#f8fafc", "line-width": 2, "line-opacity": 0.7 } }
      ]);
      // 위험구역
      add("risk", EMPTY, [
        { id: "risk-8", type: "fill", filter: ["==", ["get", "z"], 8], paint: { "fill-color": "#ffd166", "fill-opacity": 0.10 } },
        { id: "risk-5", type: "fill", filter: ["==", ["get", "z"], 5], paint: { "fill-color": "#ff8f66", "fill-opacity": 0.14 } },
        { id: "risk-8-line", type: "line", filter: ["==", ["get", "z"], 8], paint: { "line-color": "#ffd166", "line-width": 1.2, "line-dasharray": [4, 3], "line-opacity": 0.8 } },
        { id: "risk-5-line", type: "line", filter: ["==", ["get", "z"], 5], paint: { "line-color": "#ff8f66", "line-width": 1.5, "line-opacity": 0.9 } }
      ]);
      // 기반시설
      const L = window.OSM_LINES || EMPTY;
      add("osm-lines", L, [
        { id: "roads", type: "line", filter: ["in", ["get", "kind"], ["literal", ["motorway", "trunk", "primary", "secondary"]]], paint: { "line-color": ["match", ["get", "kind"], "motorway", "#b0bac6", "primary", "#9aa5b1", "#7e8a97"], "line-width": ["match", ["get", "kind"], "motorway", 2.2, "primary", 1.8, 1.2], "line-opacity": 0.85 } },
        { id: "rail", type: "line", filter: ["==", ["get", "kind"], "rail"], layout: { visibility: "none" }, paint: { "line-color": "#6d7a88", "line-width": 1.6, "line-dasharray": [2, 2] } }
      ]);
      const pl = powerLineCoords();
      add("power", fc(pl.multi ? pl.multi : [line(pl.coords, { name: pl.name })]), [
        { id: "power", type: "line", paint: { "line-color": "#f0b429", "line-width": 2, "line-dasharray": [1, 1.5] } }
      ]);
      add("routes", fc(S.routes.map((r) => line(r.coords, { id: r.id, kind: r.kind, name: r.name }))), [
        { id: "route-access", type: "line", filter: ["==", ["get", "kind"], "access"], paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [2, 1.5], "line-opacity": 0.8 } },
        { id: "route-evac", type: "line", filter: ["==", ["get", "kind"], "evac"], paint: { "line-color": "#58a6ff", "line-width": 3, "line-opacity": 0.9 } },
        { id: "route-conflict", type: "line", filter: ["==", ["get", "kind"], "conflict"], paint: { "line-color": "#f85149", "line-width": 6, "line-opacity": 0.55 } }
      ]);
      // 주택
      add("houses", fc(state.houses.map((h) => ({ type: "Feature", properties: { v: h.v }, geometry: { type: "Point", coordinates: h.pt } }))), [
        { id: "houses", type: "circle", layout: { visibility: "none" }, paint: { "circle-radius": 2.4, "circle-color": "#c9a27a", "circle-opacity": 0.85 } }
      ]);
      // 화선
      add("fire-past", EMPTY, [{ id: "fire-past", type: "line", paint: { "line-color": "#ff5a2b", "line-width": 1, "line-opacity": 0.55 } }]);
      add("fire-cum", EMPTY, [
        { id: "fire-cum-fill", type: "fill", paint: { "fill-color": "#ff5a2b", "fill-opacity": 0.32 } },
        { id: "fire-cum-line", type: "line", paint: { "line-color": "#ff3b1a", "line-width": 2.2 } }
      ]);
      add("fire-next", EMPTY, [{ id: "fire-next", type: "line", paint: { "line-color": "#ffb86b", "line-width": 1.6, "line-dasharray": [3, 2] } }]);
      add("fire-base", EMPTY, [{ id: "fire-base", type: "line", paint: { "line-color": "#ffffff", "line-width": 1.8, "line-opacity": 0.9 } }]);
      add("f0", fc([poly(f0Ring(), {})]), [{ id: "f0", type: "fill", paint: { "fill-color": "#ff3b1a", "fill-opacity": 0.6 } }]);
      add("hi-line", EMPTY, [{ id: "hi-line", type: "line", paint: { "line-color": "#ffb86b", "line-width": 6, "line-opacity": 0.6 } }]);
      // 마커
      makeMarkers();
      // 팝업
      [["route-evac", "name"], ["route-access", "name"], ["route-conflict", "name"], ["power", "name"], ["roads", "name"]].forEach(([id, key]) => {
        map.on("click", id, (e) => { const p = e.features[0].properties; new maplibregl.Popup({ closeButton: false }).setLngLat(e.lngLat).setHTML(`<div class="map-popup"><b>${esc(p[key] || p.ref || "도로")}</b>${p.ref ? ` <span style="color:#666">ref ${esc(p.ref)}</span>` : ""}</div>`).addTo(map); });
        map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
      });
      applyLayerVisibility();
      updateFireLayers();
    });
  }

  function markerEl(cls, label, sub) {
    const el = document.createElement("div");
    el.className = `mk ${cls}`;
    el.innerHTML = `<span class="pin"></span><span class="lb">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>`;
    return el;
  }
  function makeMarkers() {
    const M = state.markers;
    S.villages.forEach((v) => {
      const el = markerEl("village", v.name, `${v.pop}명`);
      el.addEventListener("click", () => { showVillagePopup(v); });
      M[`v:${v.id}`] = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([v.lng, v.lat]).addTo(map);
    });
    S.facilities.forEach((f) => {
      const cls = f.type === "care" || f.type === "welfare" ? "care" : f.type === "heritage" || f.type === "temple" ? "heritage" : "school";
      const el = markerEl(cls, f.name, f.capacity ? `${f.capacity}명` : "");
      el.addEventListener("click", () => popup([f.lng, f.lat], `<b>${esc(f.name)}</b> ${f.real ? '<span style="color:#2a7">실제</span>' : '<span style="color:#b80">가상</span>'}<br>${esc(f.note || "")}`));
      M[`f:${f.id}`] = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([f.lng, f.lat]).addTo(map);
    });
    S.shelters.forEach((s) => {
      const el = markerEl("shelter", s.name, `수용 ${s.capacity}`);
      el.addEventListener("click", () => showShelterPopup(s));
      M[`s:${s.id}`] = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([s.lng, s.lat]).addTo(map);
    });
    S.resources.crew_positions.forEach((p, i) => {
      const el = markerEl("crew", `진화조 ${i + 1}`, ""); el.style.display = "none";
      M[`c:${i}`] = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(p).addTo(map);
    });
    const f0 = markerEl("f0", "발화점", "11:25");
    M["f0"] = new maplibregl.Marker({ element: f0, anchor: "bottom" }).setLngLat(S.incident.ignition).addTo(map);
    (window.BOUNDARIES || EMPTY).features.filter((f) => f.properties.level === "emd").forEach((f) => {
      const ring = f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates.sort((a, b) => b[0].length - a[0].length)[0][0];
      const c = ring.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]).map((x) => x / ring.length);
      const el = document.createElement("div"); el.className = "mk emd"; el.textContent = f.properties.name;
      state.emdLabels.push(new maplibregl.Marker({ element: el }).setLngLat(c).addTo(map));
    });
  }
  const popup = (lngLat, html) => new maplibregl.Popup({ closeButton: true, maxWidth: "280px" }).setLngLat(lngLat).setHTML(`<div class="map-popup">${html}</div>`).addTo(map);
  function showVillagePopup(v) {
    const R = state.viewRun && state.viewRun.R; const rv = R && R.villages.find((x) => x.id === v.id);
    const zone = rv ? (rv.zone === "immediate" ? `위험구역 · P${rv.arrival} (${rv.arrivalTime})` : rv.zone === "standby" ? `잠재 위험구역 · P${rv.arrival} (${rv.arrivalTime})` : "8시간 내 도달 없음") : "예측 전";
    const as = R && R.assignments.find((a) => a.village.id === v.id);
    popup([v.lng, v.lat], `<b>${esc(v.name)}</b> <span style="color:#666">${esc(v.emd)}</span><br>인구 ${v.pop} · 가구 ${v.hh} · 고령 ${v.elderly} · 장애 ${v.disabled} <span style="color:#b80">(인구 가상)</span><br>${zone}${as ? `<br>배정 대피소: ${esc(as.shelter.name)} (${as.km.toFixed(1)} km, 약 ${as.minutes}분)` : ""}${v.note ? `<br><span style="color:#666">${esc(v.note)}</span>` : ""}<br><a href="#" data-goto="E2">관련 제안(E1·E2) 보기</a>`);
    setTimeout(() => { const a = document.querySelector('.maplibregl-popup a[data-goto]'); if (a) a.onclick = (e) => { e.preventDefault(); focusCard("E2", true); focusCard("E1"); }; }, 0);
  }
  function showShelterPopup(s) {
    const R = state.viewRun && state.viewRun.R; const rs = R && R.shelters.find((x) => x.id === s.id);
    popup([s.lng, s.lat], `<b>${esc(s.name)}</b><br>수용 ${s.capacity}명 <span style="color:#b80">(가상)</span>${rs ? `<br>${rs.inP8 ? '<span style="color:#c33">P8 확산 범위 안 — 대피소 제외</span>' : "안전"} · 배정 ${rs.load}명${rs.assigned.length ? ` (${esc(rs.assigned.join("·"))})` : ""}` : ""}${s.note ? `<br><span style="color:#666">${esc(s.note)}</span>` : ""}`);
  }

  function updateFireLayers() {
    if (!map || !map.getSource("fire-cum")) return;
    const t = state.t, sl = state.slices;
    if (!state.predicted || !sl.length) {
      ["fire-cum", "fire-past", "fire-next", "fire-base", "risk"].forEach((id) => map.getSource(id).setData(EMPTY));
      return;
    }
    map.getSource("fire-cum").setData(fc([poly(t === 0 ? f0Ring(220) : sl[t - 1], { t })]));
    map.getSource("fire-past").setData(fc(sl.slice(0, Math.max(0, t - 1)).map((r, i) => poly(r, { t: i + 1 }))));
    map.getSource("fire-next").setData(fc(t < 8 ? [poly(sl[t], { t: t + 1 })] : []));
    map.getSource("fire-base").setData(fc(state.whatif && state.compare && t > 0 ? [poly(state.baseSlices[t - 1], {})] : []));
    map.getSource("risk").setData(fc([poly(sl[7], { z: 8 }), poly(sl[4], { z: 5 })]));
    // 마을 마커: 현재 시각 화선 안이면 표시
    S.villages.forEach((v) => { const el = state.markers[`v:${v.id}`].getElement(); el.classList.toggle("burned", t > 0 && pointInRing([v.lng, v.lat], sl[t - 1])); });
    S.shelters.forEach((s) => { const el = state.markers[`s:${s.id}`].getElement(); el.classList.toggle("unsafe", pointInRing([s.lng, s.lat], sl[7])); });
  }
  function applyLayerVisibility() {
    if (!map || !map.getLayer("roads")) return;
    const on = (id) => { const c = document.querySelector(`.layer-chk[data-layer="${id}"]`); return !c || c.checked; };
    const set = (layers, v) => layers.forEach((l) => map.getLayer(l) && map.setLayoutProperty(l, "visibility", v ? "visible" : "none"));
    set(["fire-cum-fill", "fire-cum-line", "fire-past", "fire-next", "fire-base", "f0"], on("fire"));
    set(["risk-5", "risk-8", "risk-5-line", "risk-8-line"], on("risk"));
    set(["houses"], on("houses"));
    set(["roads"], on("roads")); set(["rail"], on("rail")); set(["power"], on("power"));
    set(["route-access", "route-evac", "route-conflict"], on("routes"));
    set(["admin-emd", "admin-sig"], on("admin")); set(["hillshade"], on("hillshade"));
    const show = (prefix, v) => Object.entries(state.markers).forEach(([k, m]) => { if (k.startsWith(prefix)) m.getElement().style.display = v ? "" : "none"; });
    show("v:", on("villages")); show("s:", on("shelters")); show("c:", on("crew"));
    Object.entries(state.markers).forEach(([k, m]) => { if (k.startsWith("f:")) { const el = m.getElement(); const isCare = el.classList.contains("care"); const isHer = el.classList.contains("heritage"); el.style.display = (isCare ? on("care") : isHer ? on("heritage") : on("care")) ? "" : "none"; } });
    state.emdLabels.forEach((m) => (m.getElement().style.display = on("admin") ? "" : "none"));
  }
  function set3d(on) {
    state.is3d = on; $("#btn-3d").classList.toggle("on", on);
    if (on) { map.setTerrain({ source: "dem", exaggeration: 1.7 }); map.easeTo({ pitch: 62, bearing: -25, duration: 900 }); }
    else { map.setTerrain(null); map.easeTo({ pitch: 0, bearing: 0, duration: 700 }); }
  }
  function fitAll() {
    const pts = state.predicted ? state.slices[7] : S.villages.map((v) => [v.lng, v.lat]);
    const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
    S.shelters.forEach((s) => b.extend([s.lng, s.lat]));
    const w = map.getContainer().clientWidth, h = map.getContainer().clientHeight;
    const pad = w > 1000 && h > 600 ? { top: 70, bottom: 100, left: 270, right: 210 } : 30;
    map.fitBounds(b, { padding: pad, maxZoom: 13, duration: 800 });
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
    if (map.getSource("hi-line")) map.getSource("hi-line").setData(fc(lines));
    if (fly) {
      const pts = [];
      (ref.villages || []).forEach((id) => { const v = S.villages.find((x) => x.id === id); v && pts.push([v.lng, v.lat]); });
      (ref.shelters || []).forEach((id) => { const s = S.shelters.find((x) => x.id === id); s && pts.push([s.lng, s.lat]); });
      (ref.facilities || []).forEach((id) => { const f = S.facilities.find((x) => x.id === id); f && pts.push([f.lng, f.lat]); });
      lines.forEach((l) => pts.push(...l.geometry.coordinates));
      if (ref.crew) pts.push(...S.resources.crew_positions);
      if (pts.length) { const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0])); map.fitBounds(b, { padding: { top: 80, bottom: 110, left: 300, right: 240 }, maxZoom: 13.5, duration: 700 }); }
    }
  }
  const clearHighlight = () => highlight({}, false);

  // ------------------------------------------------------------------ 재생 (F3-3)
  function setT(t) {
    state.t = Math.max(0, Math.min(8, t));
    $("#time-slider").value = state.t;
    const d = addH(T0, state.t);
    $("#time-label").innerHTML = `${hhmm(d)}<small>${state.t === 0 ? "t0" : "P" + state.t} · 발화 후 ${elapsed(d)}${isNight(d) ? " · 야간" : ""}</small>`;
    $("#hdr-clock .v").textContent = `${hhmm(d)} (${elapsed(d)})`;
    updateFireLayers();
  }
  function play() {
    if (!state.predicted) { toast("먼저 「예측 실행」을 누르십시오."); return; }
    if (state.playing) { pause(); return; }
    if (state.t >= 8) setT(0);
    state.playing = true; $("#btn-play").textContent = "❚❚ 일시정지";
    const step = () => { if (state.t >= 8) { pause(); return; } setT(state.t + 1); state.timer = setTimeout(step, 1400 / Number($("#speed-sel").value)); };
    state.timer = setTimeout(step, 600);
  }
  function pause() { state.playing = false; clearTimeout(state.timer); $("#btn-play").textContent = "▶ 재생"; }

  // ------------------------------------------------------------------ 예측 실행 (UC-04) · 조건 변경 (UC-07)
  function runPrediction(auto) {
    if (state.role !== "decision" && !auto) return;
    pause();
    const btn = $("#btn-predict"), bar = $("#predict-progress"), st = $("#predict-status");
    btn.disabled = true; let p = 0;
    const steps = ["입력 검증(발화점·t0·기상)", "기상 자동 조회(캐시)", "ELMFIRE 대체 모델 실행", "슬라이스 P1~P8 누적 검증", "규칙 판정·제안서 생성"];
    const tick = () => {
      p += auto ? 34 : 9; bar.style.width = Math.min(100, p) + "%";
      st.textContent = steps[Math.min(steps.length - 1, Math.floor(p / 21))] + "…";
      if (p < 100) setTimeout(tick, auto ? 60 : 180);
      else {
        state.wind = { ms: S.weather.series[0].wind_ms, dir: S.weather.series[0].wind_dir };
        state.baseSlices = buildSlices(state.wind); state.slices = state.baseSlices; state.whatif = false; state.predicted = true;
        st.textContent = `완료 · P5 ${fmt1(ringAreaHa(state.slices[4]))} ha · P8 ${fmt1(ringAreaHa(state.slices[7]))} ha · 주 방향 ${dirName(state.wind.dir + 180)}`;
        btn.disabled = false; btn.textContent = "재예측";
        addEvent(`확산 예측 갱신 — P5 ${fmt1(ringAreaHa(state.slices[4]))} ha, P8 ${fmt1(ringAreaHa(state.slices[7]))} ha (합성 모델)`, "pred");
        setT(0); generateProposal("예측 갱신");
        if (!auto) { toast("예측 완료 · 제안서가 생성되었습니다"); fitAll(); }
      }
    };
    tick();
  }
  function applyWhatIf() {
    if (!state.predicted) { toast("먼저 「예측 실행」을 누르십시오."); return; }
    state.wind = { ms: Number($("#wi-wind").value), dir: Number($("#wi-dir").value) };
    state.slices = buildSlices(state.wind); state.whatif = true; state.compare = $("#wi-compare").checked;
    $("#predict-status").textContent = `조건 변경 · 풍속 ${state.wind.ms} m/s · ${dirName(state.wind.dir)}풍 · P5 ${fmt1(ringAreaHa(state.slices[4]))} ha · P8 ${fmt1(ringAreaHa(state.slices[7]))} ha (기본 예측·제안서는 유지)`;
    updateFireLayers(); toast("조건 변경 예측을 겹쳐 표시했습니다. 제안서는 기본 예측 기준으로 유지됩니다.");
  }
  function resetWhatIf() {
    if (!state.predicted) return;
    state.wind = { ms: S.weather.series[0].wind_ms, dir: S.weather.series[0].wind_dir }; state.slices = state.baseSlices; state.whatif = false;
    $("#wi-wind").value = state.wind.ms; $("#wi-dir").value = state.wind.dir; syncWiLabels();
    $("#predict-status").textContent = `기본 예측 · P5 ${fmt1(ringAreaHa(state.slices[4]))} ha · P8 ${fmt1(ringAreaHa(state.slices[7]))} ha`;
    updateFireLayers();
  }
  const syncWiLabels = () => { $("#wi-wind-v").textContent = `${$("#wi-wind").value} m/s`; $("#wi-dir-v").textContent = `${$("#wi-dir").value}° (${dirName(Number($("#wi-dir").value))})`; };

  // ------------------------------------------------------------------ 이벤트·토스트·모달
  function addEvent(text, kind) {
    const d = new Date(T0.getTime() + (state.loginAt ? new Date() - state.loginAt : 0));
    state.events.push({ t: `${hhmm(d)}:${String(d.getSeconds()).padStart(2, "0")}`, text, kind, unread: true });
    state.unread++; renderTimeline(); updateTabBadge();
  }
  function toast(msg, ms = 2600) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), ms); }
  function openModal(title, bodyHTML, actions) {
    $("#modal-title").textContent = title; $("#modal-body").innerHTML = bodyHTML;
    const ac = $("#modal-actions"); ac.innerHTML = "";
    (actions || [{ label: "닫기" }]).forEach((a) => { const b = document.createElement("button"); b.textContent = a.label; if (a.cls) b.className = a.cls; b.onclick = () => { if (!a.onClick || a.onClick() !== false) closeModal(); }; ac.appendChild(b); });
    $("#modal-bg").classList.add("on");
  }
  const closeModal = () => $("#modal-bg").classList.remove("on");

  // ------------------------------------------------------------------ 렌더링: 헤더·좌측 패널
  function renderHeader() {
    const R = state.currentRun && state.currentRun.R;
    $("#hdr-incident").textContent = `${S.incident.name} · ${hhmm(START)} 발생`;
    $("#hdr-official").textContent = `${state.situation.official_stage} · ${state.situation.alert_level}`;
    const rec = $("#hdr-recommended"); rec.querySelector(".v").textContent = R ? R.recStage + (R.stageUp ? " ↑" : "") : "예측 전"; rec.classList.toggle("up", !!(R && R.stageUp));
    $("#hdr-holder").textContent = `${S.incident.position_holder} (${S.incident.position})`;
    $("#hdr-user").textContent = state.role === "decision" ? `${state.user} · 의사결정권자` : `${state.user} · 열람자`;
  }
  function renderOverview() {
    const R = state.viewRun && state.viewRun.R, fr = state.situation.field_report;
    const kv = [
      ["산불", `${S.incident.name} <span class="tag real">실제</span>`], ["발화지", esc(S.incident.ignition_addr)],
      ["신고·발생", `${hhmm(new Date(S.incident.report_time))} 신고 · ${hhmm(START)} 발생`], ["원인", `${esc(S.incident.cause_note)}`],
      ["기준시각 t0", `${hhmm(T0)} (발화 후 ${elapsed(T0)})`], ["공식 대응단계", `${esc(state.situation.official_stage)} <span class="fake-note">2026 체계 표시</span>`],
      ["위기경보", esc(state.situation.alert_level)], ["규칙 판정 단계", R ? `${esc(R.recStage)}${R.stageUp ? ' <span style="color:var(--warn)">격상 검토</span>' : ""}` : "예측 전"],
      ["지휘권자", `${S.incident.position_holder} — ${S.incident.position}`], ["관할", `${S.incident.jurisdiction.sido} ${S.incident.jurisdiction.sigungu}`],
      ["현장 보고", `피해 ${fr.burned_area_ha} ha · 화선 ${fr.fireline_length_km} km · 진화율 ${fr.containment_pct}% <span class="tag fake">가상</span>`]
    ];
    $("#tab-overview").innerHTML = `
      <div class="stat">
        <div class="box"><div class="k">P5 예상 면적</div><div class="v">${R ? fmt1(R.areaP5) : "—"}<small> ha</small></div></div>
        <div class="box"><div class="k">P8 예상 면적</div><div class="v">${R ? fmt1(R.areaP8) : "—"}<small> ha</small></div></div>
        <div class="box"><div class="k">위험구역 마을</div><div class="v">${R ? R.immediate.length : "—"}<small> / 잠재 ${R ? R.standby.length : "—"}</small></div></div>
        <div class="box"><div class="k">즉시 조치</div><div class="v">${state.viewRun ? state.viewRun.summary["즉시"] : "—"}<small> 건</small></div></div>
      </div>
      <div class="section-title">개요</div>
      <div class="kv">${kv.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join("")}</div>
      <div class="section-title">주의</div>
      <div class="small muted">${esc(S.meta.stage_scheme_note)}<br>${esc(S.meta.spread_note)}</div>`;
  }
  function renderWeather() {
    const w = S.weather, now = w.series[0], maxW = Math.max(...w.series.map((x) => x.wind_ms));
    $("#tab-weather").innerHTML = `
      <div class="stat">
        <div class="box"><div class="k">풍속·풍향 (t0)</div><div class="v">${now.wind_ms}<small> m/s · ${dirName(now.wind_dir)}풍</small></div></div>
        <div class="box"><div class="k">습도 · 시정</div><div class="v">${now.rh}<small>% · ${now.vis_m / 1000} km</small></div></div>
      </div>
      <div class="section-title">풍속 시계열 (m/s) <span class="tag fake">가상</span></div>
      <div class="bars">${w.series.map((x) => `<div class="bar wind" style="height:${x.wind_ms / maxW * 100}%"><span>${x.wind_ms}</span></div>`).join("")}</div>
      <div class="bar-labels">${w.series.map((x) => `<span>${x.t.slice(0, 2)}</span>`).join("")}</div>
      <div class="section-title">습도 (%)</div>
      <div class="bars">${w.series.map((x) => `<div class="bar" style="height:${x.rh / 60 * 100}%"><span>${x.rh}</span></div>`).join("")}</div>
      <div class="bar-labels">${w.series.map((x) => `<span>${x.t.slice(0, 2)}</span>`).join("")}</div>
      <div class="section-title">특보 · 천문</div>
      <div class="kv"><div class="k">특보</div><div class="v">${w.warnings.map(esc).join(", ")}</div><div class="k">일출·일몰</div><div class="v">${S.astronomy.sunrise} · ${S.astronomy.sunset} <span class="muted small">(${esc(S.astronomy.note)})</span></div><div class="k">야간 진입</div><div class="v">${timeAt(0)} 기준 ${Math.round((SUNSET - T0) / 60e3 / 60 * 10) / 10}시간 후 (P${Math.ceil((SUNSET - T0) / 3600e3)}부터 야간)</div></div>
      <div class="section-title">출처</div><div class="small muted">${esc(w.note)}</div>`;
  }
  function renderRisk() {
    const R = state.viewRun && state.viewRun.R;
    if (!R) { $("#tab-risk").innerHTML = `<div class="muted">예측 실행 후 마을별 도달시간과 위험구역이 계산됩니다.</div>`; return; }
    const rows = [...R.villages].sort((a, b) => (a.arrival ?? 99) - (b.arrival ?? 99) || b.elderly - a.elderly);
    const zoneTag = (v) => v.zone === "immediate" ? '<span class="badge b-즉시">위험구역</span>' : v.zone === "standby" ? '<span class="badge b-대기">잠재</span>' : '<span class="badge b-없음">밖</span>';
    $("#tab-risk").innerHTML = `
      <div class="small muted" style="margin-bottom:6px">화선 도달 5시간 이내 위험구역(즉시 실행) · 8시간 이내 잠재 위험구역(실행 대기) — 표준매뉴얼 p.74~76. 인구·고령 수는 <span class="tag fake">가상</span></div>
      <table><thead><tr><th>마을</th><th>도달</th><th>구역</th><th>인구/고령</th><th>대피소</th></tr></thead><tbody>
      ${rows.map((v) => { const a = R.assignments.find((x) => x.village.id === v.id); return `<tr class="clickable" data-v="${v.id}"><td><b>${esc(v.name)}</b><br><span class="muted small">${esc(v.emd)}</span></td><td>${v.arrival ? `P${v.arrival}<br><span class="small muted">${v.arrivalTime}${v.night ? " 야간" : ""}</span>` : "—"}</td><td>${zoneTag(v)}</td><td>${v.pop}/${v.elderly}</td><td class="small">${a ? `${esc(a.shelter.name)}<br><span class="muted">${a.minutes}분</span>` : "—"}</td></tr>`; }).join("")}
      </tbody></table>`;
    $$("#tab-risk tr.clickable").forEach((tr) => tr.addEventListener("click", () => { const v = S.villages.find((x) => x.id === tr.dataset.v); highlight({ villages: [v.id] }, true); showVillagePopup(v); }));
  }
  function renderResources() {
    const rs = state.situation.resources, R = state.viewRun && state.viewRun.R;
    $("#tab-resources").innerHTML = `
      <div class="stat">
        <div class="box"><div class="k">헬기 투입 / 인근 가용</div><div class="v">${rs.heli_deployed}<small> / ${rs.heli_available_nearby}대</small></div></div>
        <div class="box"><div class="k">지상 진화인력</div><div class="v">${rs.ground_crew_deployed}<small> 명 (${rs.crew_positions.length}개 조)</small></div></div>
        <div class="box"><div class="k">소방차</div><div class="v">${rs.fire_trucks_deployed}<small> 대</small></div></div>
        <div class="box"><div class="k">헬기 운용</div><div class="v">${R ? (R.heliOkNow ? "가능" : "제한") : "—"}<small> 풍속·주간 기준</small></div></div>
      </div>
      <div class="section-title">부족분</div>
      <div class="kv"><div class="k">가용 − 투입</div><div class="v">헬기 +${rs.heli_available_nearby}대 (투입 가능)</div><div class="k">소요 기준</div><div class="v"><span class="badge b-근거부족">근거 부족</span> <span class="muted small">매뉴얼에 수량 산식 없음</span></div></div>
      <div class="section-title">참고(실제)</div>
      <div class="small muted">17:42 보도 기준 헬기 27대·차량 36대·인력 375명 투입, 진화율 30% (이데일리). 12:00 시점 값은 <span class="tag fake">가상</span>. ${esc(rs.base_note)}</div>`;
  }
  function renderEvac() {
    const es = state.situation.evacuation_state, R = state.viewRun && state.viewRun.R;
    $("#tab-evac").innerHTML = `
      <div class="kv">
        <div class="k">대피명령</div><div class="v">${es.order_issued ? '<span class="badge b-즉시">발령</span>' : '<span class="badge b-없음">미발령</span>'}</div>
        <div class="k">CBS 송출</div><div class="v">${es.cbs_sent.length ? es.cbs_sent.map(esc).join(", ") : "없음"}</div>
        <div class="k">대피 완료</div><div class="v">${es.completed_villages.length ? es.completed_villages.map(esc).join(", ") : "없음"}</div>
        <div class="k">미대피</div><div class="v">${R && R.unreached.length ? R.unreached.map((v) => esc(v.name)).join(", ") : "없음"}</div>
        <div class="k">부상·고립</div><div class="v">${es.injuries.length ? es.injuries.map(esc).join(", ") : "없음"}</div>
        <div class="k">전파 대상</div><div class="v">${R ? R.emdIn8.map(esc).join(", ") : "—"}</div>
      </div>
      <div class="section-title">대피소 <span class="tag fake">수용 인원 가상</span></div>
      <table><thead><tr><th>대피소</th><th>수용</th><th>배정</th><th>상태</th></tr></thead><tbody>
      ${(R ? R.shelters : S.shelters.map((s) => ({ ...s, load: 0, assigned: [], inP8: false }))).map((s) => `<tr class="clickable" data-s="${s.id}"><td>${esc(s.name)}</td><td>${s.capacity}</td><td>${s.load}${s.assigned.length ? `<br><span class="small muted">${esc(s.assigned.join("·"))}</span>` : ""}</td><td>${s.inP8 ? '<span class="badge b-즉시">P8 안</span>' : s.load > s.capacity ? '<span class="badge b-대기">초과</span>' : '<span class="badge b-보고">안전</span>'}</td></tr>`).join("")}
      </tbody></table>
      <div style="margin-top:10px" class="decision-only"><button id="btn-report-2">현장 보고 입력</button> <span class="small muted">대피 상태·자원·피해면적 갱신</span></div>`;
    $$("#tab-evac tr.clickable").forEach((tr) => tr.addEventListener("click", () => { const s = S.shelters.find((x) => x.id === tr.dataset.s); highlight({ shelters: [s.id] }, true); showShelterPopup(s); }));
    const b = $("#btn-report-2"); if (b) b.onclick = openReportForm;
    applyRole();
  }
  function renderTimeline() {
    const showActual = state.showActual !== false;
    const items = [...state.events.map((e) => ({ ...e, cls: "mock" }))];
    if (showActual) S.timeline_actual.forEach((e) => items.push({ t: e.t, text: e.text + (e.src ? ` [${e.src}]` : ""), cls: "actual" }));
    items.sort((a, b) => a.t.localeCompare(b.t));
    $("#tab-timeline").innerHTML = `
      <label class="small" style="display:flex;gap:6px;align-items:center;margin-bottom:8px"><input id="tl-show-actual" type="checkbox" ${showActual ? "checked" : ""}> 실제 경과(보도 기준, 구 대응단계 체계) 함께 표시</label>
      <ul class="tl">${items.map((e) => `<li class="${e.cls}${e.unread ? " unread" : ""}"><span class="t">${esc(e.t)}</span><span>${esc(e.text)}</span></li>`).join("")}</ul>
      <div class="small muted" style="margin-top:8px">주황 시각 = 목업 안에서 일어난 이벤트(현재 실제 시각 기준으로 t0에 더해 표시)</div>`;
    $("#tl-show-actual").onchange = (e) => { state.showActual = e.target.checked; renderTimeline(); };
  }
  function updateTabBadge() { const b = $('.ltab[data-tab="timeline"]'); b.textContent = state.unread ? `타임라인 (${state.unread})` : "타임라인"; }

  // ------------------------------------------------------------------ 렌더링: 제안서 (F4-8~F4-13)
  const citeHTML = (text, blockId) => esc(text).replace(/\[(\d+)\]/g, (m, k) => `<span class="cite" data-b="${blockId}" data-k="${k}">[${k}]</span>`);
  function renderProposal() {
    const run = state.viewRun;
    const isCurrent = run === state.currentRun;
    $("#prop-run").textContent = run ? `${run.id}${isCurrent ? "" : " · 이전 판"}` : "run —";
    $("#pm-t0").textContent = hhmm(T0); $("#pm-pos").textContent = `${S.incident.position_holder}(${S.incident.position})`;
    $("#pm-official").textContent = run ? run.snapshot.official_stage : state.situation.official_stage;
    $("#pm-rec").textContent = run ? run.R.recStage : "—";
    const banner = $("#stage-banner");
    if (run && run.R.stageUp) {
      banner.classList.add("on");
      banner.innerHTML = `<b>격상 검토 권고(협의)</b> — 규칙 판정 ${esc(run.R.recStage)}, 공식 ${esc(run.snapshot.official_stage)}. 5시간 후 예상 피해면적 ${fmt1(run.R.areaP5)} ha (p.73 판단기준). 발령권자는 산림청장이며 시스템은 직위를 바꾸지 않습니다.${run.R.nextHolder ? ` 격상 시 지휘권자 <b>${esc(run.R.nextHolder)}</b>, 인계 항목: 피해상황·투입 자원·추가 피해 가능성(p.118). 주민대피 명령권은 시장·군수·구청장에게 남습니다.` : ""}`;
    } else banner.classList.remove("on");
    const box = $("#cards");
    if (!run) { box.innerHTML = `<div class="muted" style="padding:20px 6px;text-align:center">제안서가 없습니다.<br>${state.role === "decision" ? "「예측 실행」 또는 「제안서 생성」을 누르십시오." : "의사결정권자가 예측을 실행하면 표시됩니다."}</div>`; $("#prop-summary").innerHTML = ""; return; }
    const dec = state.decisions[run.id] || {};
    const prevDec = (() => { const i = state.runs.indexOf(run); return i > 0 ? state.decisions[state.runs[i - 1].id] || {} : {}; })();
    const blocks = run.blocks.filter((b) => b.axis === state.axis).filter((b) => state.filter === "all" || b.status.includes(state.filter));
    box.innerHTML = blocks.map((b) => {
      const none = b.status[0] === "(없음)";
      const changed = run.changed.includes(b.id);
      const badges = b.status.map((s) => `<span class="badge b-${s.replace(/[\s()]/g, "")}">${esc(s)}</span>`).join(" ");
      const evid = b.evidence.length ? b.evidence.map((e) => { const c = S.evidence[e.key]; return `<span class="ev-item"><span class="cite" data-b="${b.id}" data-k="${e.k}">[${e.k}]</span> ${esc(c.doc)} ${esc(c.page)} ${esc(c.section)} <span class="muted">(${esc(e.key)})</span></span>`; }).join("") : "(없음)";
      const conf = b.conflicts.length ? b.conflicts.map((c) => `${esc(c.type)} (관련 ${esc(c.with)}) / 처리: ${esc(c.resolution)}`).join("<br>") : "(없음)";
      const d = dec[b.id];
      return `<div class="card axis-${b.axis}${none ? " none" : " open"}${changed ? " changed" : ""}" data-id="${b.id}">
        <div class="head"><span class="id">${b.id}</span><span class="nm">${esc(b.name)}</span>${changed ? '<span class="tag" style="color:var(--purple);border-color:var(--purple)">변경</span>' : ""}${badges}<span class="caret">${none ? "▸" : "▾"}</span></div>
        <div class="body">
          <div class="line finding"><span class="k">판정</span><span class="v">${esc(b.finding || "(없음)")}</span></div>
          <div class="line"><span class="k">구분</span><span class="v">${badges} <span class="muted small">권한: ${esc(b.authority)}</span></span></div>
          <div class="line"><span class="k">제안</span><span class="v">${citeHTML(b.text, b.id)}</span></div>
          <div class="line"><span class="k">대상</span><span class="v">${b.targets.length ? esc(b.targets.join(", ")) : "(없음)"}</span></div>
          <div class="line"><span class="k">충돌</span><span class="v">${conf}</span></div>
          <div class="line"><span class="k">근거</span><span class="v">${evid}</span></div>
          <div class="foot">
            <button class="map-btn" data-id="${b.id}">지도에서 보기</button>
            <button class="ask-btn decision-only" data-id="${b.id}">질문</button>
            <span class="decision-only">${["채택", "보류", "수정"].map((x) => `<button class="dec ${d === x ? "on-" + x : ""}" data-id="${b.id}" data-d="${x}">${x}${x === "수정" ? " 지시" : ""}</button>`).join(" ")}</span>
            <span class="decision">${d ? `결정: <b>${esc(d)}</b>` : prevDec[b.id] ? `이전 판 결정: ${esc(prevDec[b.id])}` : ""}</span>
          </div>
        </div></div>`;
    }).join("") || `<div class="muted" style="padding:16px 6px;text-align:center">필터에 해당하는 항목이 없습니다.</div>`;
    // 이벤트
    $$("#cards .card .head").forEach((h) => h.addEventListener("click", () => h.parentElement.classList.toggle("open")));
    $$("#cards .card").forEach((c) => { c.addEventListener("mouseenter", () => { const b = run.blocks.find((x) => x.id === c.dataset.id); b && highlight(b.ref || {}, false); }); c.addEventListener("mouseleave", clearHighlight); });
    $$("#cards .map-btn").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); const bl = run.blocks.find((x) => x.id === b.dataset.id); highlight(bl.ref || {}, true); if (!Object.keys(bl.ref || {}).length) toast("이 항목은 지도 대상이 없습니다."); }));
    $$("#cards .ask-btn").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); openChat(b.dataset.id); }));
    $$("#cards .dec").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); if (!isCurrent) { toast("이전 판에는 결정을 기록할 수 없습니다."); return; } const cur = (state.decisions[run.id] = state.decisions[run.id] || {}); cur[b.dataset.id] = cur[b.dataset.id] === b.dataset.d ? undefined : b.dataset.d; localStorage.setItem("mock.decisions", JSON.stringify(state.decisions)); addEvent(`${b.dataset.id} ${(run.blocks.find((x) => x.id === b.dataset.id) || {}).name || ""} — ${cur[b.dataset.id] ? "결정: " + cur[b.dataset.id] : "결정 취소"}`, "dec"); renderProposal(); }));
    $$("#cards .cite").forEach((c) => c.addEventListener("click", (e) => { e.stopPropagation(); openEvidence(run, c.dataset.b, Number(c.dataset.k)); }));
    const s = run.summary;
    const decCount = Object.values(dec).filter(Boolean).length;
    $("#prop-summary").innerHTML = Object.entries(s).filter(([k, v]) => v).map(([k, v]) => `<span class="badge b-${k.replace(/\s/g, "")}">${k} ${v}</span>`).join("") + `<span style="margin-left:auto">결정 ${decCount}/14 · ${hhmm(run.createdAt)} 생성 (${esc(run.reason)})</span>`;
    const sel = $("#run-select"); sel.innerHTML = state.runs.slice().reverse().map((r) => `<option value="${r.id}" ${r === run ? "selected" : ""}>${r.id} · ${esc(r.reason)}${r === state.currentRun ? " (최신)" : ""}</option>`).join("");
    applyRole();
  }
  function focusCard(id, open) {
    const b = state.viewRun && state.viewRun.blocks.find((x) => x.id === id); if (!b) return;
    if (b.axis !== state.axis) { state.axis = b.axis; $$(".ptab").forEach((t) => t.classList.toggle("on", t.dataset.axis === state.axis)); state.filter = "all"; $$(".pfilter").forEach((f) => f.classList.toggle("on", f.dataset.f === "all")); renderProposal(); }
    const el = document.querySelector(`#cards .card[data-id="${id}"]`); if (!el) return;
    if (open) el.classList.add("open"); el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("hi"); setTimeout(() => el.classList.remove("hi"), 1800);
  }
  function openEvidence(run, blockId, k) {
    const b = run.blocks.find((x) => x.id === blockId); const ev = b.evidence.find((e) => e.k === k); if (!ev) return;
    const sentences = b.text.split(/(?<=다\.)\s*/).filter(Boolean);
    const sent = sentences.find((s) => s.includes(`[${k}]`)) || b.text;
    $("#ev-title").textContent = `${b.id} 근거 [${k}]`;
    $("#ev-body").innerHTML = `<div class="ev-sentence">${citeHTML(sent, b.id)}</div>` + b.evidence.map((e) => { const c = S.evidence[e.key]; return `<div class="ev-chunk" style="${e.k === k ? "border-color:var(--acc2)" : ""}"><div class="meta">[${e.k}] ${esc(c.doc)} · ${esc(c.page)} · ${esc(c.section)} · 청크 ${esc(e.key)}</div><div class="quote">${e.k === k ? `<mark>${esc(c.text)}</mark>` : esc(c.text)}</div><div class="small muted" style="margin-top:6px">원문 PDF 이동: 목업에서는 비활성(표준매뉴얼 비공개). 텍스트는 요약본.</div></div>`; }).join("");
    $("#evidence-drawer").classList.add("on");
  }

  // ------------------------------------------------------------------ 현장 보고 폼 (UC-03)
  function openReportForm(prefill) {
    const s = state.situation, rs = s.resources, fr = s.field_report, es = s.evacuation_state;
    const vopts = (sel) => S.villages.map((v) => `<option ${sel.includes(v.name) ? "selected" : ""}>${v.name}</option>`).join("");
    openModal("현장 보고 입력 (F2-8)", `
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
        <label>CBS 송출 이력(쉼표 구분)<input id="rf-cbs" value="${esc(es.cbs_sent.join(", "))}"></label>
        <label>대피 완료 마을(복수 선택)<select id="rf-done" multiple size="5">${vopts(es.completed_villages)}</select></label>
        <label>부상·고립 보고(쉼표 구분, 마을명)<input id="rf-inj" value="${esc(es.injuries.join(", "))}"></label>
      </div>
      <div class="small muted" style="margin-top:8px">저장하면 상황에 출처 태그(현장 보고, 시각)가 붙고 제안서가 다시 생성됩니다(UC-03 → UC-08 포함).</div>`,
      [{ label: "취소" }, { label: "저장 후 제안서 생성", cls: "primary", onClick: () => saveReport() }]);
    if (prefill) Object.entries(prefill).forEach(([id, v]) => { const el = $(id); if (el) el.value = v; });
  }
  function saveReport() {
    const num = (id) => Number($(id).value);
    const errs = [];
    const cont = num("#rf-cont"); if (cont < 0 || cont > 100) errs.push("진화율은 0~100이어야 합니다.");
    if (num("#rf-heli") < 0 || num("#rf-crew") < 0) errs.push("자원 수는 0 이상이어야 합니다.");
    const done = Array.from($("#rf-done").selectedOptions).map((o) => o.value);
    if (errs.length) { toast(errs.join(" ")); return false; }
    const s = state.situation;
    s.field_report = { burned_area_ha: num("#rf-area"), fireline_length_km: num("#rf-line"), containment_pct: cont, expected_suppression_hours: $("#rf-exp").value === "" ? null : num("#rf-exp") };
    Object.assign(s.resources, { heli_deployed: num("#rf-heli"), heli_available_nearby: num("#rf-heli2"), ground_crew_deployed: num("#rf-crew"), fire_trucks_deployed: num("#rf-truck") });
    s.official_stage = $("#rf-stage").value; s.alert_level = $("#rf-alert").value;
    s.evacuation_state = { order_issued: $("#rf-order").value === "1", cbs_sent: $("#rf-cbs").value.split(",").map((x) => x.trim()).filter(Boolean), completed_villages: done, unreached_villages: [], injuries: $("#rf-inj").value.split(",").map((x) => x.trim()).filter(Boolean) };
    addEvent("현장 보고 갱신(출처: 현장 보고)", "report");
    if (stageIdx(s.official_stage) >= 2) toast("공식 단계가 2단계 이상: MVP 범위 밖. 격상·지휘권 안내만 유효합니다.", 4000);
    if (state.predicted) { const prev = state.currentRun; const run = generateProposal("현장 보고 갱신"); if (prev) showDiff(prev, run); }
    else renderAll();
    return true;
  }

  // ------------------------------------------------------------------ 전후 비교 (F5-3, F4-13)
  function showDiff(prev, run) {
    const rows = run.changed.map((id) => { const a = prev.blocks.find((b) => b.id === id), b = run.blocks.find((x) => x.id === id); return `<div class="chg"><b>${id} ${esc(b.name)}</b><div class="diff" style="margin-top:4px"><div class="col"><h4>${prev.id}</h4>${a.status.map((s) => `<span class="badge b-${s.replace(/[\s()]/g, "")}">${esc(s)}</span>`).join(" ")}<div style="margin-top:4px">${esc(a.text)}</div></div><div class="col"><h4>${run.id}</h4>${b.status.map((s) => `<span class="badge b-${s.replace(/[\s()]/g, "")}">${esc(s)}</span>`).join(" ")}<div style="margin-top:4px">${esc(b.text)}</div></div></div></div>`; }).join("");
    openModal(`제안서 전후 비교 — ${prev.id} → ${run.id}`, rows || `<div class="muted">바뀐 항목이 없습니다.</div>`, [{ label: "닫기" }]);
  }

  // ------------------------------------------------------------------ 챗봇 (UC-13) · 정정 (UC-14)
  const QUICK = ["왜 이 마을이 먼저입니까", "대피소 수용 초과 시 대안은", "헬기를 몇 대 더 투입해야 합니까", "격상 기준이 무엇입니까", "재난문자는 언제 보내야 합니까", "박곡리 대피 완료"];
  function openChat(blockId) {
    if (state.role !== "decision") return;
    if (blockId) state.chatCtx = blockId;
    const run = state.viewRun; const b = run && run.blocks.find((x) => x.id === state.chatCtx);
    $("#chat-ctx").innerHTML = b ? `컨텍스트: <b>${b.id} ${esc(b.name)}</b> — 제안·근거·상황값 자동 첨부 <a href="#" id="chat-ctx-clear">해제</a>` : "컨텍스트: (없음) — 제안 카드의 「질문」을 누르면 그 항목이 붙습니다";
    const cl = $("#chat-ctx-clear"); if (cl) cl.onclick = (e) => { e.preventDefault(); state.chatCtx = null; openChat(); };
    $("#chat-quick").innerHTML = QUICK.map((q) => `<button>${q}</button>`).join("");
    $$("#chat-quick button").forEach((q) => (q.onclick = () => { $("#chat-input").value = q.textContent; sendChat(); }));
    $("#chat-panel").classList.add("on"); $("#chat-input").focus();
    if (!$("#chat-log").children.length) botSay("안녕하십니까. 제안 내용에 대한 질문이나 상황 변화를 말씀해 주십시오. 답변은 표준매뉴얼 요약 청크만 근거로 하며, 청크에 없는 내용은 근거 부족으로 답합니다. (목업: 대본형 응답)");
  }
  function addMsg(cls, html) { const d = document.createElement("div"); d.className = `msg ${cls}`; d.innerHTML = html; $("#chat-log").appendChild(d); $("#chat-log").scrollTop = 1e6; return d; }
  function botSay(text, blockId) {
    const d = addMsg("bot", ""); let i = 0; const html = blockId ? citeHTML(text, blockId) : esc(text);
    const plain = text; const iv = setInterval(() => { i += 3; d.textContent = plain.slice(0, i); $("#chat-log").scrollTop = 1e6; if (i >= plain.length) { clearInterval(iv); d.innerHTML = html; d.querySelectorAll(".cite").forEach((c) => c.addEventListener("click", () => openEvidence(state.viewRun, c.dataset.b, Number(c.dataset.k)))); } }, 12);
  }
  function sendChat() {
    const q = $("#chat-input").value.trim(); if (!q) return; $("#chat-input").value = "";
    addMsg("user", esc(q));
    const corr = detectCorrection(q);
    if (corr) { setTimeout(() => proposeCorrection(corr, q), 300); return; }
    setTimeout(() => answer(q), 350);
  }
  function answer(q) {
    const run = state.viewRun; if (!run) { botSay("아직 제안서가 없습니다. 예측을 실행하면 답할 수 있습니다."); return; }
    const R = run.R, ctx = state.chatCtx, es = state.situation.evacuation_state;
    const vill = S.villages.find((v) => q.includes(v.name));
    const T = [
      [/왜|먼저|순서|우선/, () => { const first = R.ordered[0]; const v = vill && R.villages.find((x) => x.id === vill.id) || first; if (!v) return "확산 범위에 드는 마을이 없어 대피 순서를 정할 항목이 없습니다."; const rank = R.ordered.findIndex((x) => x.id === v.id) + 1; return `${eun(v.name)} 화선 도달 예상이 P${v.arrival}(${v.arrivalTime})로 ${rank === 1 ? "가장 이르고" : `${rank}번째이며`}, 고령자 ${v.elderly}명이 있어 안전취약계층 우선 대피 원칙이 적용됩니다 [1]. 대피명령은 마을 단위로 내리고 화선 도달 5시간 이내 마을은 즉시 실행합니다 [2].`; }, "E2"],
      [/대피소|수용|초과|분산/, () => { const ov = R.overflow; const as = R.assignments.map((a) => `${a.village.name}→${a.shelter.name}(${a.shelter.load}/${a.shelter.capacity})`).join(", "); return `현재 배정은 ${as || "없음"}입니다 [1]. ${ov.length ? `${eun(joinKo(ov.map((s) => s.name)))} 수용 인원을 초과하므로 인접 대피소로 분산해야 합니다 [1].` : "수용 초과 대피소는 없습니다."} P8 범위 안 대피소는 제외합니다 [2].`; }, "E4"],
      [/헬기|몇 대|대수|추가 투입/, () => `가용 진화헬기를 집중 투입하라는 원칙은 있으나 [2], 몇 대를 추가해야 하는지의 산정 기준은 제공된 청크에 없어 근거 부족입니다. 현재 투입 ${state.situation.resources.heli_deployed}대, 인근 가용 ${state.situation.resources.heli_available_nearby}대이며, 풍속 ${state.wind.ms} m/s에서는 운용이 가능합니다.`, "S3"],
      [/격상|단계|기준/, () => `대응단계 판단기준은 피해면적·평균풍속·예상 진화시간·시설피해 4요소이며 하나라도 상위 기준을 충족하면 상위 단계를 검토합니다 [1]. 현재 5시간 후 예상 피해면적 ${fmt1(R.areaP5)} ha는 ${R.recStage} 기준입니다. 발령은 산림청장이 통합지휘본부와 협의해 하므로 이 화면은 격상 검토를 권고할 뿐 직위를 바꾸지 않습니다 [2].`, "S1"],
      [/야간|일몰|밤|사전대피/, () => `일몰은 ${R.sunset}이고 ${R.nightVillages.length ? `${eun(joinKo(R.nightVillages.map((v) => `${v.name}(${v.arrivalTime})`)))} 화선 도달 예상 시각이 일몰 이후이므로 일몰 전 사전대피 대상입니다 [1].` : "화선 도달 예상 시각이 일몰 이후인 마을은 없습니다."} 야간에는 풍속이 잦아드는 시간대에 집중 진화를 합니다.`, "E2"],
      [/송전|한전|전류|고압/, () => R.powerIn ? `송전선이 P${R.powerIn} 확산 범위를 지나므로 한전에 전류 차단과 우회선로 확보를 요청해야 합니다 [2]. 요청 대상은 한전이며 통합지휘본부에 협력관 파견을 받습니다.` : "8시간 확산 범위 안에 송전선이 없어 한전 요청 항목은 발동하지 않았습니다.", "S5"],
      [/재난문자|문자|방송|CBS|송출/, () => `긴급재난문자와 자막방송은 산불 발생, 대피 권고, 대피 명령 시 단계별로 송출합니다 [1]. 현재 대피명령 ${es.order_issued ? "발령 상태이므로 대피 명령 단계로" : "미발령이므로 명령과 동시에 명령 단계로"} ${joinKo(R.emdIn8)}에 송출하십시오. 인명·민가 피해 우려가 없으면 생략할 수 있으나 이번 상황은 해당하지 않습니다 [1].`, "E6"],
      [/경찰|교통|통제|도로|진입로/, () => `대피로와 진화차량 진입로가 겹치는 구간이 있어 경찰에 교통통제와 주민대피 지원을 요청해야 합니다 [1]. ${R.routeInFire ? `겹침 구간은 P${R.routeInFire}(${timeAt(R.routeInFire)})에 확산 범위에 듭니다.` : ""}`, "E5"],
      [/취약|요양|장애|시설/, () => R.careIn.length ? `${josa(joinKo(R.careIn.map((f) => `${f.name}(P${f.arrival}, ${f.capacity}명)`)), "이", "가")} 확산 범위에 들어 위험구역에 포함하고 별도 이송을 지시해야 합니다 [1].` : "8시간 확산 범위 안에 취약시설이 없습니다.", "E3"],
      [/근거|출처|어디|매뉴얼/, () => "모든 제안 문장은 표준매뉴얼(2026.6 일부개정) 본문 쪽수를 [k]로 인용하며, 청크에서 확인되지 않는 내용은 근거 부족으로 표시합니다. 근거 줄의 [k]를 누르면 요약 청크를 볼 수 있습니다(목업은 원문 대신 요약).", null],
      [/합성|가상|실제|진짜/, () => "이 목업의 화선 P1~P8은 실제 관측이 아니라 발화점·풍향·풍속으로 만든 합성 타원입니다. 마을·시설·대피소 좌표와 행정구역 경계, 도로·철도는 OSM·SGIS 실제 데이터이고, 인구·수용 인원·자원 수는 가상값입니다.", null]
    ];
    for (const [re, fn, bid] of T) if (re.test(q)) { const b = bid || ctx; botSay(fn(), b && run.blocks.find((x) => x.id === b) ? b : null); return; }
    if (ctx) { const b = run.blocks.find((x) => x.id === ctx); botSay(`${b.id} ${b.name} 항목의 판정은 "${b.finding}"이며 제안은 다음과 같습니다. ${b.text} 질문하신 내용은 제공된 청크에서 직접 확인되지 않아 근거 부족입니다.`, b.id); return; }
    botSay("근거 부족: 제공된 매뉴얼 청크에서 확인되지 않습니다. 제안 카드의 「질문」을 눌러 항목을 지정하거나, 상황 변화(예: 박곡리 대피 완료, 헬기 6대 투입, 대피명령 발령)를 말씀해 주십시오.");
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
    const es = state.situation.evacuation_state, rs = state.situation.resources;
    const rows = [];
    if (c.type === "completed") rows.push(["evacuation_state.completed_villages", es.completed_villages.join(", ") || "[]", [...new Set([...es.completed_villages, ...c.villages])].join(", ")]);
    if (c.type === "injury") rows.push(["evacuation_state.injuries", es.injuries.join(", ") || "[]", [...new Set([...es.injuries, ...c.villages])].join(", ")]);
    if (c.type === "heli") rows.push(["resources.heli_deployed", rs.heli_deployed, c.n]);
    if (c.type === "order") rows.push(["evacuation_state.order_issued", String(es.order_issued), "true"]);
    if (c.type === "stage") rows.push(["official_stage", state.situation.official_stage, c.stage]);
    // 가드: 완료 마을이 명령 대상인지 검사
    const R = state.viewRun && state.viewRun.R;
    if (c.type === "completed" && R) { const notTarget = c.villages.filter((n) => !R.ordered.find((v) => v.name === n)); if (notTarget.length) { botSay(`${eun(joinKo(notTarget))} 대피 명령 대상(위험·잠재 위험구역)이 아니므로 "대피 완료"로 기록할 수 없습니다. 상황을 다시 확인해 주십시오.`); return; } }
    addMsg("sys", "정정 요청으로 판정 — 확인 대화상자를 엽니다 (UC-14)");
    openModal("상황 정정 확인 (UC-14)", `<div class="small muted" style="margin-bottom:8px">발화: “${esc(q)}”</div><table><thead><tr><th>필드</th><th>이전값</th><th>새값</th></tr></thead><tbody>${rows.map((r) => `<tr><td><code>${esc(r[0])}</code></td><td>${esc(String(r[1]))}</td><td><b>${esc(String(r[2]))}</b></td></tr>`).join("")}</tbody></table><div class="small muted" style="margin-top:8px">확인하면 상황을 저장(출처: 정정·시각·사용자)하고 제안서를 다시 생성합니다. 제안 문구 자체를 근거 없이 바꾸는 요청은 거부됩니다(정정 가드).</div>`,
      [{ label: "취소", onClick: () => { botSay("정정을 취소했습니다. 상황은 바뀌지 않았습니다."); } }, { label: "확인 · 저장 후 재생성", cls: "primary", onClick: () => { applyCorrection(c); } }]);
  }
  function applyCorrection(c) {
    const s = state.situation, es = s.evacuation_state;
    if (c.type === "completed") es.completed_villages = [...new Set([...es.completed_villages, ...c.villages])];
    if (c.type === "injury") es.injuries = [...new Set([...es.injuries, ...c.villages])];
    if (c.type === "heli") s.resources.heli_deployed = c.n;
    if (c.type === "order") es.order_issued = true;
    if (c.type === "stage") s.official_stage = c.stage;
    addEvent(`상황 정정(출처: 챗봇 정정, ${state.user}) — ${c.type === "completed" ? c.villages.join("·") + " 대피 완료" : c.type === "injury" ? c.villages.join("·") + " 부상·고립 보고" : c.type === "heli" ? "헬기 투입 " + c.n + "대" : c.type === "order" ? "대피명령 발령" : "공식 단계 " + c.stage}`, "corr");
    const prev = state.currentRun; const run = generateProposal("상황 정정");
    botSay(`정정을 저장하고 제안서 ${run.id}를 다시 생성했습니다. 바뀐 항목: ${run.changed.length ? run.changed.join(", ") : "없음"}. 전후 비교 창을 확인하십시오.`);
    if (prev) showDiff(prev, run);
    if (c.type === "stage" && stageIdx(c.stage) >= 2) toast("공식 단계가 2단계 이상: MVP 범위 밖. 격상·지휘권 안내만 유효합니다.", 4000);
  }

  // ------------------------------------------------------------------ 역할 (F1-1, F1-4)
  function applyRole() { const v = state.role !== "decision"; $$(".decision-only").forEach((el) => el.classList.toggle("viewer-hide", v)); $("#btn-predict").disabled = v; $("#btn-whatif").disabled = v; }
  function login() {
    state.user = $("#login-id").value.trim() || "user"; state.role = $("#login-role").value; state.loginAt = new Date();
    $("#login-overlay").style.display = "none";
    applyRole(); renderAll(); setT(0);
    addEvent(`${state.user} 로그인(${state.role === "decision" ? "의사결정권자" : "열람자"}) · 관할 의성군`, "sys");
    if (!map) initMap();
    if (state.role === "viewer" && !state.predicted) runPrediction(true);
    else if (!state.predicted) toast("「예측 실행」을 누르면 P1~P8과 제안서가 생성됩니다.", 4000);
  }
  function logout() { pause(); $("#login-overlay").style.display = ""; }

  // ------------------------------------------------------------------ 출처 모달
  function openSources() {
    openModal("데이터 출처 · 실제/가상 구분", `
      <table><thead><tr><th>항목</th><th>구분</th><th>출처·비고</th></tr></thead><tbody>
      <tr><td>발화점·시각·원인</td><td><span class="tag real">실제</span></td><td>산림청 X, 위키백과 (좌표는 OSM 괴산리 마을 중심점)</td></tr>
      <tr><td>마을·면사무소·학교·사찰·복지시설 좌표</td><td><span class="tag real">실제</span></td><td>OpenStreetMap (Overpass API)</td></tr>
      <tr><td>도로(고속·국도·지방도)·철도 중앙선 선형</td><td><span class="tag real">실제</span></td><td>OpenStreetMap</td></tr>
      <tr><td>읍면·군 경계</td><td><span class="tag real">실제</span></td><td>SGIS 행정구역 경계 2025.2Q</td></tr>
      <tr><td>읍면 인구 통계(안평면 1,962명, 평균나이 64.3세)</td><td><span class="tag real">실제</span></td><td>SGIS 인구총괄 2024</td></tr>
      <tr><td>실제 경과 타임라인·풍속 5.6 m/s·17:42 자원·대피 200명</td><td><span class="tag real">실제</span></td><td>이데일리, 위키백과, 산림청 X</td></tr>
      <tr><td>화선 P1~P8</td><td><span class="tag fake">합성</span></td><td>발화점·풍향·풍속 타원 모델. 실측 화선 아님</td></tr>
      <tr><td>마을별 인구·가구·고령·장애 수, 주택 점</td><td><span class="tag fake">가상</span></td><td>읍면 통계를 참고해 배분</td></tr>
      <tr><td>기상 시계열·습도·시정, 특보 종류</td><td><span class="tag fake">가상</span></td><td>발생 시 풍속만 보도값</td></tr>
      <tr><td>대피소 수용 인원, 요양병원 위치, 송전선 선형, 대피로·진입로, 자원 수(12:00)</td><td><span class="tag fake">가상</span></td><td>구하지 못한 항목</td></tr>
      <tr><td>근거 텍스트</td><td><span class="tag">요약</span></td><td>표준매뉴얼 본문 쪽수 기준 요약. 원문은 비공개라 싣지 않음</td></tr>
      </tbody></table>
      <div class="section-title">링크</div>
      <ul class="small">${S.meta.sources.map((s) => `<li>[${s.id}] ${esc(s.label)}${s.url ? ` — <a href="${s.url}" target="_blank" rel="noopener">${esc(s.url)}</a>` : ""}</li>`).join("")}</ul>
      <div class="small muted">${esc(S.meta.stage_scheme_note)}</div>`);
  }

  // ------------------------------------------------------------------ 전체 렌더
  function renderAll() { renderHeader(); renderOverview(); renderWeather(); renderRisk(); renderResources(); renderEvac(); renderTimeline(); renderProposal(); updateTabBadge(); }

  // ------------------------------------------------------------------ 바인딩
  function bind() {
    $("#login-btn").onclick = login; $("#login-pw").addEventListener("keydown", (e) => e.key === "Enter" && login());
    $("#btn-logout").onclick = logout; $("#btn-sources").onclick = openSources;
    $$(".ltab").forEach((b) => (b.onclick = () => { $$(".ltab").forEach((x) => x.classList.remove("on")); b.classList.add("on"); $$(".panel").forEach((p) => p.classList.remove("on")); $(`#tab-${b.dataset.tab}`).classList.add("on"); if (b.dataset.tab === "timeline") { state.unread = 0; state.events.forEach((e) => (e.unread = false)); updateTabBadge(); renderTimeline(); } }));
    $("#btn-play").onclick = play; $("#btn-stop").onclick = () => { pause(); setT(0); };
    $("#time-slider").oninput = (e) => { pause(); setT(Number(e.target.value)); };
    $("#btn-predict").onclick = () => runPrediction(false);
    $("#btn-whatif").onclick = () => $("#whatif-panel").classList.toggle("on");
    $("#wi-wind").oninput = syncWiLabels; $("#wi-dir").oninput = syncWiLabels; syncWiLabels();
    $("#btn-wi-apply").onclick = applyWhatIf; $("#btn-wi-reset").onclick = resetWhatIf;
    $$(".layer-chk").forEach((c) => (c.onchange = applyLayerVisibility));
    $("#btn-3d").onclick = () => set3d(!state.is3d); $("#btn-fit").onclick = fitAll;
    $$(".ptab").forEach((b) => (b.onclick = () => { state.axis = b.dataset.axis; $$(".ptab").forEach((x) => x.classList.toggle("on", x === b)); renderProposal(); }));
    $$(".pfilter").forEach((b) => (b.onclick = () => { state.filter = b.dataset.f; $$(".pfilter").forEach((x) => x.classList.toggle("on", x === b)); renderProposal(); }));
    $("#btn-ev-close").onclick = () => $("#evidence-drawer").classList.remove("on");
    $("#btn-report").onclick = () => openReportForm();
    $("#btn-regenerate").onclick = () => { if (!state.predicted) { runPrediction(false); return; } const prev = state.currentRun; const run = generateProposal("수동 생성"); if (prev) showDiff(prev, run); };
    $("#run-select").onchange = (e) => { state.viewRun = state.runs.find((r) => r.id === e.target.value) || state.currentRun; renderAll(); };
    $("#chat-fab").onclick = () => openChat(); $("#btn-chat-close").onclick = () => $("#chat-panel").classList.remove("on");
    $("#chat-form").onsubmit = (e) => { e.preventDefault(); sendChat(); };
    $("#modal-bg").addEventListener("click", (e) => { if (e.target.id === "modal-bg") closeModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); $("#evidence-drawer").classList.remove("on"); } });
  }

  // 마커 CSS(동적 삽입)
  const css = document.createElement("style");
  css.textContent = `
    .mk { display:flex; flex-direction:column; align-items:center; cursor:pointer; font-family:inherit; pointer-events:auto; }
    .mk .pin { width:11px; height:11px; border-radius:50%; border:2px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,.6); }
    .mk .lb { margin-top:2px; font-size:11px; font-weight:700; color:#fff; text-shadow:0 1px 2px #000, 0 0 4px #000; white-space:nowrap; line-height:1.1; text-align:center; }
    .mk .lb small { display:block; font-size:9.5px; font-weight:500; color:#ddd; }
    .mk.village .pin { background:#ffd166; } .mk.village.burned .pin { background:#ff3b1a; box-shadow:0 0 0 4px rgba(255,59,26,.35); } .mk.village.burned .lb { color:#ffb3a3; }
    .mk.care .pin { background:#f78fb3; } .mk.heritage .pin { background:#b083f0; } .mk.school .pin { background:#8fd3ff; }
    .mk.shelter .pin { background:#3fb950; border-radius:2px; } .mk.shelter.unsafe .pin { background:#f85149; }
    .mk.crew .pin { background:#fff; border-color:#333; width:9px; height:9px; }
    .mk.f0 .pin { background:#ff3b1a; width:14px; height:14px; box-shadow:0 0 0 6px rgba(255,59,26,.3); } .mk.f0 .lb { color:#ffb3a3; font-size:12px; }
    .mk.hi .pin { transform:scale(1.6); box-shadow:0 0 0 6px rgba(255,184,107,.5); } .mk.hi .lb { color:#ffb86b; }
    .mk.emd { font-size:11px; color:#e2e8f0; opacity:.75; text-shadow:0 1px 2px #000; pointer-events:none; letter-spacing:.05em; }
    .maplibregl-marker { z-index:2; } .mk.hi { z-index:5; }`;
  document.head.appendChild(css);

  // ------------------------------------------------------------------ 시작
  state.houses = genHouses();
  bind();
  $("#hdr-clock .v").textContent = `${hhmm(T0)} (${elapsed(T0)})`;
  // 디버그 핸들(콘솔에서 상태 확인용)
  window.__mock = { state, get map() { return map; }, ringAreaHa, firePolygon, runPrediction, generateProposal };
})();
