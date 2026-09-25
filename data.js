/* =====================================================================
   산불 대응 AI 목업 — 시나리오 데이터 (2025-03-22 의성 산불, 발생 후 8시간)
   ---------------------------------------------------------------------
   real: true  → 공개 자료에서 가져온 값(출처는 note/meta.sources)
   real: false → 구하지 못해 만든 가짜(합성) 값. 화면에 "가상" 표시됨
   좌표는 [경도, 위도] (WGS84)
   ===================================================================== */
window.SCENARIO = {
  meta: {
    id: "UISEONG-2025-03-22",
    title: "2025-03-22 의성 산불 (안평면 괴산리) — 발생 후 8시간",
    t0: "2025-03-22T12:00:00+09:00",           // 목업 기준시각(발생 36분 뒤, 공식 단계는 아직 초기대응)
    horizon_hours: 8,                            // P1~P8
    stage_scheme_note: "2025년 당시는 구 1·2·3단계 체계였으나 목업은 2026년 개편 체계(초기대응·확산대응 1·2단계)로 표시한다.",
    spread_note: "P1~P8 화선은 실제 관측 화선이 아니라 발화점·풍향·풍속으로 만든 합성 타원이다.",
    sources: [
      { id: "S1", label: "산림청 X(2025-03-22 22:00 상황): 11:25 안평면 괴산리 발생, 22:00 진화율 6%, 열화상 드론 화선 모니터링", url: "https://x.com/forest_news/status/1903457349572129015" },
      { id: "S2", label: "산림청 X(2025-03-23 15:00 상황): 발생지 괴산리 산61 일원", url: "https://x.com/forest_news/status/1903700317457555645" },
      { id: "S3", label: "이데일리 2025-03-22 17:42 종합: 1단계 13:05, 2단계 13:45, 3단계 14:10, 위기경보 15:30, 헬기 27·차량 36·인력 375, 진화율 30%, 대피 200명(요양병원 환자·관계자 70여명 포함) 의성 실내체육관, 풍속 5.6 m/s", url: "https://edaily.co.kr/News/Read?mediaCodeNo=257&newsId=01846646642105944" },
      { id: "S4", label: "위키백과 2025년 의성-안동 산불: 11:24 신고, 15:45 중앙선 안동–의성 차단, 18:00 안동–경주 차단, 20:40 서산영덕고속도로 차단, 철파리·방하리 주민 대피", url: "https://ko.wikipedia.org/wiki/2025%EB%85%84_%EC%9D%98%EC%84%B1-%EC%95%88%EB%8F%99_%EC%82%B0%EB%B6%88" },
      { id: "S5", label: "OpenStreetMap(Overpass API): 마을·면사무소·학교·사찰·복지시설 좌표, 도로·철도·송전선 선형", url: "https://www.openstreetmap.org/copyright" },
      { id: "S6", label: "국가데이터처 SGIS 행정구역 경계(2025.2Q)·인구총괄(2024)", url: "https://sgis.kostat.go.kr/" },
      { id: "S7", label: "「산불 재난」 위기관리 표준매뉴얼(2026.6 일부개정) 본문 쪽수 — 근거 텍스트는 요약(원문 비공개)", url: "" }
    ]
  },

  incident: {
    fire_id: "F-2025-0322-UISEONG",
    name: "의성 안평면 산불",
    ignition: [128.60226, 36.36565],             // 괴산리 마을 중심(OSM). 실제 발화지 '괴산리 산61 일원'은 야산 정상부
    ignition_addr: "경북 의성군 안평면 괴산리 산61 일원",
    report_time: "2025-03-22T11:24:00+09:00",
    start_time: "2025-03-22T11:25:00+09:00",
    cause_note: "성묘객 실화 추정(보도)",
    official_stage: "초기대응",                  // 2026 체계. 실제(구 체계)로는 13:05 1단계 발령 전
    alert_level: "주의",
    jurisdiction: { sido: "경상북도", sigungu: "의성군", code: "37520" },
    position: "산불현장 통합지휘본부장",
    position_holder: "의성군수",
    real: true
  },

  // 대응단계 판정(목업 근사): 표준매뉴얼 p.73 판단기준 4요소 중 면적만 적용. 풍속·진화시간·시설피해 기준은 표시만 한다.
  stage_rules: {
    area_ha: [
      { stage: "초기대응", max: 10 },
      { stage: "확산대응 1단계", min: 10, max: 100 },
      { stage: "확산대응 2단계", min: 100 }
    ],
    note: "면적 구간은 산림재난방지법 시행령 별표 기준의 요약이며, 풍속·예상 진화시간·시설피해 기준값은 매뉴얼 p.73 표를 확인해야 한다(목업 미적용)."
  },

  astronomy: { sunrise: "06:31", sunset: "18:39", note: "의성 2025-03-22 근사값(천문연 계산식 기준, ±3분)" },

  weather: {
    real: false,
    note: "발생 당시 풍속 5.6 m/s(보도)만 실제. 풍향(서풍 계열)은 확산 방향 보도에서 추정, 시계열·습도·시정은 합성.",
    warnings: ["건조특보(보도 기준, 종류 확인 필요)"],
    series: [
      { t: "12:00", wind_ms: 5.6, wind_dir: 240, rh: 24, vis_m: 8000 },
      { t: "13:00", wind_ms: 6.4, wind_dir: 240, rh: 21, vis_m: 6000 },
      { t: "14:00", wind_ms: 7.1, wind_dir: 245, rh: 19, vis_m: 4000 },
      { t: "15:00", wind_ms: 7.8, wind_dir: 250, rh: 18, vis_m: 3000 },
      { t: "16:00", wind_ms: 7.0, wind_dir: 245, rh: 20, vis_m: 3000 },
      { t: "17:00", wind_ms: 5.9, wind_dir: 240, rh: 26, vis_m: 3500 },
      { t: "18:00", wind_ms: 4.6, wind_dir: 235, rh: 33, vis_m: 4000 },
      { t: "19:00", wind_ms: 3.8, wind_dir: 230, rh: 40, vis_m: 5000 },
      { t: "20:00", wind_ms: 3.2, wind_dir: 225, rh: 46, vis_m: 6000 }
    ]
  },

  // 합성 확산 모델: 확산속도(km/h) = a + b × 풍속(m/s). 발화점을 뒤쪽 초점으로 하는 타원 + 각도 노이즈
  fire_model: {
    head: [0.30, 0.16],
    flank: [0.08, 0.04],
    back: 0.06,
    noise_amp: 0.14,
    note: "실측 화선이 아니다. 13:18 산불영향구역 73 ha(보도)와 저녁 무렵 의성읍·단촌면 접근(보도)에 대략 맞춘 합성 모델."
  },

  // 마을: 좌표는 OSM 마을 중심점(실제). 인구·가구·고령·장애 수는 합성(안평면 2024 총인구 1,962명·평균나이 64.3세(SGIS)를 참고해 배분)
  villages: [
    { id: "goesan",   name: "괴산리", emd: "안평면", lng: 128.60226, lat: 36.36565, pop: 84,  hh: 47,  elderly: 46,  disabled: 3,  real_coord: true },
    { id: "dook",     name: "도옥리", emd: "안평면", lng: 128.60089, lat: 36.35350, pop: 92,  hh: 51,  elderly: 49,  disabled: 4,  real_coord: true },
    { id: "bakgok",   name: "박곡리", emd: "안평면", lng: 128.61967, lat: 36.38298, pop: 138, hh: 74,  elderly: 71,  disabled: 6,  real_coord: true },
    { id: "changgil", name: "창길리", emd: "안평면", lng: 128.59744, lat: 36.39479, pop: 121, hh: 66,  elderly: 63,  disabled: 5,  real_coord: true },
    { id: "sinan",    name: "신안리", emd: "안평면", lng: 128.61166, lat: 36.34063, pop: 105, hh: 58,  elderly: 55,  disabled: 4,  real_coord: true },
    { id: "sinwol",   name: "신월리", emd: "안평면", lng: 128.63824, lat: 36.35874, pop: 97,  hh: 53,  elderly: 52,  disabled: 4,  real_coord: true },
    { id: "seoktap",  name: "석탑리", emd: "안평면", lng: 128.64337, lat: 36.38281, pop: 76,  hh: 42,  elderly: 41,  disabled: 3,  real_coord: true },
    { id: "majeon",   name: "마전리", emd: "안평면", lng: 128.56532, lat: 36.36243, pop: 88,  hh: 48,  elderly: 45,  disabled: 3,  real_coord: true },
    { id: "daesa",    name: "대사리", emd: "안평면", lng: 128.57405, lat: 36.34284, pop: 110, hh: 60,  elderly: 57,  disabled: 5,  real_coord: true },
    { id: "cheolpa",  name: "철파리", emd: "의성읍", lng: 128.67117, lat: 36.37326, pop: 412, hh: 205, elderly: 160, disabled: 12, real_coord: true, note: "실제 3/22 대피 마을(보도)" },
    { id: "bangha",   name: "방하리", emd: "단촌면", lng: 128.66258, lat: 36.39526, pop: 143, hh: 78,  elderly: 79,  disabled: 6,  real_coord: true, note: "실제 3/22 대피 마을(보도)" },
    { id: "secheon",  name: "세촌리", emd: "단촌면", lng: 128.66140, lat: 36.42581, pop: 118, hh: 64,  elderly: 66,  disabled: 5,  real_coord: true },
    { id: "hahwa",    name: "하화리", emd: "단촌면", lng: 128.68771, lat: 36.41073, pop: 131, hh: 71,  elderly: 70,  disabled: 5,  real_coord: true, note: "중앙선 하화터널 부근, 15:45 열차 운행 차단(보도)" },
    { id: "sanghwa",  name: "상화리", emd: "단촌면", lng: 128.71650, lat: 36.39835, pop: 96,  hh: 52,  elderly: 54,  disabled: 4,  real_coord: true }
  ],

  // 보호대상·취약시설
  facilities: [
    { id: "care1",     name: "요양병원(위치 가상)",   type: "care",     lng: 128.5905, lat: 36.3800, capacity: 70, real: false, note: "보도: 3/22 요양병원 환자·관계자 70여명 의성 실내체육관 대피(실제). 명칭·위치는 가상" },
    { id: "welfare1",  name: "의성장애인복지센터",   type: "welfare",  lng: 128.68017, lat: 36.3596, capacity: 40, real: true,  note: "좌표 실제(OSM), 수용 인원은 가상" },
    { id: "heritage1", name: "고운사",               type: "heritage", lng: 128.74883, lat: 36.45815, real: true, note: "국가유산. 실제로는 3/25 소실. 8시간 창에서는 확산 범위 밖" },
    { id: "temple1",   name: "운람사",               type: "temple",   lng: 128.60624, lat: 36.3611,  real: true, note: "발화점 남쪽 0.6 km 사찰(OSM). 문화재 지정 여부 확인 필요" },
    { id: "school1",   name: "의성북부초등학교",     type: "school",   lng: 128.6925,  lat: 36.36137, real: true, note: "좌표 실제(OSM)" }
  ],

  // 대피소: 좌표 실제(OSM), 수용 인원은 가상
  shelters: [
    { id: "sh1", name: "의성 실내체육관",  lng: 128.70254, lat: 36.35664, capacity: 500, real_coord: false, note: "실제 대피 장소(보도). 좌표는 의성종합운동장(OSM)으로 대체" },
    { id: "sh2", name: "안평면사무소",     lng: 128.58418, lat: 36.37676, capacity: 150, real_coord: true },
    { id: "sh3", name: "단촌면사무소",     lng: 128.67430, lat: 36.42205, capacity: 150, real_coord: true },
    { id: "sh4", name: "봉양면사무소",     lng: 128.57635, lat: 36.30072, capacity: 200, real_coord: true }
  ],

  // 송전선: OSM power=line 이 로드되면(data_osm_lines.js) 그것을 쓰고, 없으면 아래 가상 선형
  power_line_fallback: { name: "송전선(가상 선형)", real: false, coords: [[128.575, 36.345], [128.605, 36.372], [128.640, 36.392], [128.675, 36.408]] },

  // 대피로·진입로: 선형은 가상(도로 노드를 잇지 않은 개략선). 겹침 구간 판정은 이 데이터로 고정
  routes: [
    { id: "evac-A",   kind: "evac",     name: "대피로: 박곡리 → 의성 실내체육관", real: false,
      coords: [[128.61967, 36.38298], [128.635, 36.378], [128.655, 36.372], [128.680, 36.365], [128.70254, 36.35664]] },
    { id: "access-1", kind: "access",   name: "진화차량 진입로: 의성소방서(가상) → 발화점", real: false,
      coords: [[128.695, 36.352], [128.680, 36.365], [128.655, 36.372], [128.635, 36.378], [128.615, 36.372], [128.60226, 36.36565]] },
    { id: "conflict", kind: "conflict", name: "대피로·진입로 겹침 구간(가상)", real: false,
      coords: [[128.635, 36.378], [128.655, 36.372], [128.680, 36.365]] }
  ],

  // 자원(12:00 시점, 가상). 참고: 17:42 보도 기준 헬기 27대·차량 36대·인력 375명
  resources: {
    real: false,
    heli_deployed: 4, heli_available_nearby: 6,
    ground_crew_deployed: 60, fire_trucks_deployed: 8,
    crew_positions: [[128.607, 36.368], [128.612, 36.371], [128.598, 36.360]],
    base_note: "산림항공관리소·소방서 위치와 보유 대수는 가상"
  },

  // 현장 보고(12:00 시점, 가상)
  field_report: { burned_area_ha: 12, fireline_length_km: 1.5, containment_pct: 0, expected_suppression_hours: null },

  // 대피 상태(12:00 시점)
  evacuation_state: { order_issued: false, cbs_sent: [], completed_villages: [], unreached_villages: [], injuries: [] },

  // 실제 경과(보도 기준). 구 대응단계 체계 표기 그대로
  timeline_actual: [
    { t: "11:24", text: "119 신고 접수(성묘객 실화 추정)", src: "S4" },
    { t: "11:25", text: "안평면 괴산리 산61 일원 발생(산림청 공식 발생 시각)", src: "S1" },
    { t: "12:00", text: "목업 기준시각 t0 — 초기대응(2026 체계 표시)", src: "" },
    { t: "13:05", text: "산불 대응 1단계 발령(구 체계, 보도에 따라 12:55)", src: "S3" },
    { t: "13:18", text: "산불영향구역 73 ha", src: "S4" },
    { t: "13:45", text: "대응 2단계 격상(보도에 따라 13:18)", src: "S3" },
    { t: "13:57", text: "금성면 청로리 별도 발생", src: "S4" },
    { t: "14:10", text: "대응 3단계 격상", src: "S3" },
    { t: "14:39", text: "안계면 용기리 별도 발생", src: "S4" },
    { t: "15:30", text: "국가위기경보 주의 → 경계·심각 상향", src: "S3" },
    { t: "15:45", text: "중앙선 안동역–의성역 운행 차단(하화터널 부근 접근)", src: "S4" },
    { t: "17:42", text: "헬기 27대·차량 36대·인력 375명 투입, 진화율 30%, 주민 200명(요양병원 70여명 포함) 의성 실내체육관 대피", src: "S3" },
    { t: "18:00", text: "중앙선 안동역–경주역 운행 차단", src: "S4" },
    { t: "18:39", text: "일몰(근사)", src: "" },
    { t: "20:40", text: "서산영덕고속도로 서의성IC–안동JC, 중앙고속도로 안동JC 구간 차단", src: "S4" },
    { t: "22:00", text: "진화율 6%, 열화상 드론으로 화선 모니터링", src: "S1" }
  ],

  // 근거 청크(요약). 원문 비공개이므로 쪽수 + 요약만 둔다
  evidence: {
    "SM-p013": { doc: "표준매뉴얼", page: "p.13", section: "대응단계의 목적", text: "대응단계는 초기 진화와 동원할 진화자원의 규모를 정하기 위해 발령한다." },
    "SM-p022": { doc: "표준매뉴얼", page: "p.22", section: "대응단계 발령", text: "대응단계는 산림청장이 자체 평가와 산불현장 통합지휘본부 협의를 거쳐 발령한다. 통합지휘본부장은 소방·경찰·군의 장비와 인력을 동원하고 산불현장 대책회의에서 기관별 임무를 부여한다." },
    "SM-p041": { doc: "표준매뉴얼", page: "p.41", section: "통합지휘본부 반별 역할", text: "상황총괄반은 현장 영상과 확산예측으로 상황을 분석해 진화전략도를 작성하고 자원을 배정한다. 지상진화반은 진화구역을 설정하고 구역별 진화율에 따라 자원을 재배치한다." },
    "SM-p065": { doc: "표준매뉴얼", page: "p.65", section: "주민대피경로카드", text: "행정리별 주민대피경로카드에 대피장소, 비상 집결지, 버스 진입·회차 공간, 위험 요소, 이동거리·시간을 둔다." },
    "SM-p072": { doc: "표준매뉴얼", page: "p.72", section: "지휘권자", text: "초기대응·확산대응 1단계는 시장·군수·구청장(국유림관리소장)이 지휘하고, 2단계와 2개 이상 시·군·구에 걸친 산불은 시·도지사가, 2개 이상 시·도에 걸치면 산림청장이 지휘한다. 신고·접수 시 헬기 2대 투입이 원칙이다." },
    "SM-p073": { doc: "표준매뉴얼", page: "p.73", section: "대응단계 판단기준", text: "대응단계 판단기준은 피해면적, 평균풍속, 예상 진화시간, 시설피해 4요소이며 하나라도 상위 기준을 충족하면 상위 단계를 검토한다. 확산대응 1단계는 피해면적 10 ha 이상 100 ha 미만, 2단계는 100 ha 이상(시행령 별표 요약)." },
    "SM-p074": { doc: "표준매뉴얼", page: "p.74~76", section: "위험구역과 주민대피", text: "화선 도달 5시간 이내 지역은 위험구역으로 즉시 실행 대피명령, 8시간 이내는 잠재 위험구역으로 실행 대기 대피명령을 내린다. 야간이 위험구역 시간대에 포함되면 일몰 전에 사전대피한다. 요양원·장애인시설 등 취약시설이 인접하면 위험구역에 포함한다. 대피명령은 마을·읍면동 단위로 내린다." },
    "SM-p077": { doc: "표준매뉴얼", page: "p.77", section: "진화 우선순위·헬기·안전", text: "진화 우선순위는 ① 인명 ② 국가기간산업·군사시설·국가유산 ③ 가옥 등 재산 ④ 중요 산림자원 ⑤ 기타 산림 순이다. 가용 진화헬기를 집중 투입하고 공중진화대·특수진화대를 즉시 출동시킨다. 투입 전 임무를 부여하고 진화복·안전장구를 확인하며 위치추적장치를 휴대한다." },
    "SM-p078": { doc: "표준매뉴얼", page: "p.78", section: "진화 방식·자원 투입", text: "강풍·동시다발로 헬기 운용이 어려우면 지상진화에 집중하고, 풍속이 잦아드는 일몰 후·일출 전에 집중 진화하며, 강풍 해제 시 헬기 재투입을 준비한다. 확산 정도에 따라 진화자원을 단계적으로 투입하고 인접 시·군 자원을 동원한다." },
    "SM-p078b": { doc: "표준매뉴얼", page: "p.78~79", section: "재난문자·자막방송", text: "긴급재난문자(CBS)와 자막방송(DITS)을 산불 발생, 대피 권고, 대피 명령 시 단계별로 송출한다. 인명·민가 피해 우려가 없으면 생략할 수 있다." },
    "SM-p079": { doc: "표준매뉴얼", page: "p.79", section: "시설 보호·취약계층", text: "주택 등 보호대상 시설물 주변에 소방차 등 진화장비를 집중 배치하고 헬기로 인접 산림에 예비 살수한다. 안전취약계층을 우선 대피시킨다." },
    "SM-p084": { doc: "표준매뉴얼", page: "p.84", section: "주민대피 명령", text: "시장·군수·구청장이 주민대피를 명령하며, 대피하지 않은 주민은 강제로 대피시킨다." },
    "SM-p095": { doc: "표준매뉴얼", page: "p.95", section: "한전 협조", text: "한전은 송전시설의 전류 차단과 우회선로 확보를 맡고 통합지휘본부에 협력관을 파견한다." },
    "SM-p118": { doc: "표준매뉴얼", page: "p.118", section: "인명피해 판단 요소", text: "인명피해 가능성은 풍속·풍향, 진화인력, 지형, 연료를 보고 판단하며, 인명·국가유산·고압선 피해 여부와 확대 가능성을 판단한다." },
    "SM-p119": { doc: "표준매뉴얼", page: "p.119", section: "유관기관 주요 기능", text: "경찰은 초기대응에서 교통통제와 주민대피 지원을 맡는다. 소방은 접근 곤란 지역 인명구조·대피계획, 수색·구조·구급을 맡는다." },
    "SM-p021": { doc: "표준매뉴얼", page: "p.21", section: "긴급구조통제단", text: "긴급구조는 소방의 긴급구조통제단장이 긴급구조기관의 역할을 분담해 지휘한다." }
  },

  // 결정 카탈로그(핵심 파일 F4-3). 트리거·권한은 의사결정 항목 정리.md 기준
  catalog: [
    { id: "S1", axis: "진화", name: "대응단계 판단·격상 검토", authority: "협의" },
    { id: "S2", axis: "진화", name: "진화 우선지역·보호대상 선정", authority: "직접" },
    { id: "S3", axis: "진화", name: "진화자원 투입·배분·재배치", authority: "직접" },
    { id: "S4", axis: "진화", name: "진화 방식·시간대 전략", authority: "직접" },
    { id: "S5", axis: "진화", name: "시설 보호 조치", authority: "직접/요청" },
    { id: "S6", axis: "진화", name: "유관기관 동원·협조 요청", authority: "직접/요청" },
    { id: "S7", axis: "진화", name: "진화인력 안전·투입 관리", authority: "직접" },
    { id: "E1", axis: "대피", name: "위험구역 설정", authority: "직접" },
    { id: "E2", axis: "대피", name: "대피 명령 대상·순서·시점", authority: "직접" },
    { id: "E3", axis: "대피", name: "취약시설·미대피 주민 조치", authority: "직접" },
    { id: "E4", axis: "대피", name: "대피소 배정·분산", authority: "직접" },
    { id: "E5", axis: "대피", name: "대피 경로·교통통제", authority: "요청" },
    { id: "E6", axis: "대피", name: "전파(재난문자·방송)", authority: "직접" },
    { id: "E7", axis: "대피", name: "인명구조·긴급구조 요청", authority: "요청" }
  ]
};
