import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getDatabase, ref, set, update, onValue, get, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCHy_PesFeDukcR8EoApvNiSybHaTXzTQo",
  authDomain: "project-6581223658676463302.firebaseapp.com",
  databaseURL: "https://project-6581223658676463302-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "project-6581223658676463302",
  storageBucket: "project-6581223658676463302.firebasestorage.app",
  messagingSenderId: "886880172634",
  appId: "1:886880172634:web:b16b520bc7a041e697f663"
};

const firebase = initializeApp(firebaseConfig);
const db = getDatabase(firebase);
const storage = getStorage(firebase);
const app = document.querySelector("#app");
const toastEl = document.querySelector("#toast");
const DEFAULT_TEACHER_PASSWORD = "4312";

const state = {
  view: "welcome",
  roomCode: "",
  role: "",
  playerId: "",
  playerName: "",
  teacherToken: "",
  room: null,
  connected: false,
  selectedCell: null,
  uploading: false,
  creatingRoom: false,
  uploadProgress: 0,
  uploadMessage: "",
  storageUnavailable: false,
  unsubRoom: null,
  audio: null,
  lastDrawCount: 0,
  lastBingoCount: 0
};

const icons = {
  teacher: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="13" rx="2"></rect><path d="M8 21l4-5 4 5M12 16v5M7 8h4v4H7zM14 8h3M14 11h3"></path></svg>`,
  student: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10l9-5 9 5-9 5-9-5zM7 12.5V17c2.8 2.1 7.2 2.1 10 0v-4.5M21 10v6"></path></svg>`,
  upload: "↥",
  qr: "▦",
  play: "▶",
  draw: "◆",
  back: "←"
};

function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
}

function makeId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function cleanCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

async function hashPassword(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

function tone(kind = "click") {
  try {
    if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = state.audio;
    const now = ctx.currentTime;
    const notes = kind === "bingo" ? [523, 659, 784, 1047] : kind === "draw" ? [330, 494, 659] : kind === "join" ? [440, 660] : [520];
    notes.forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === "bingo" ? "triangle" : "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(.0001, now + i * .08);
      gain.gain.exponentialRampToValueAtTime(kind === "click" ? .05 : .1, now + i * .08 + .01);
      gain.gain.exponentialRampToValueAtTime(.0001, now + i * .08 + .16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * .08);
      osc.stop(now + i * .08 + .18);
    });
  } catch {}
}

function shell(content, extra = "") {
  return `<main class="shell ${extra}">
    <header class="topbar">
      <button class="brand" data-action="home" aria-label="처음 화면으로" style="border:0;background:none;padding:0;color:inherit">
        <span class="brand-mark">B!</span><span>딩동! 라이브 빙고</span>
      </button>
      ${state.roomCode ? `<div class="toolbar"><span class="room-code">방 코드 ${escapeHTML(state.roomCode)}</span><span class="status-pill"><span class="dot ${state.connected ? "live" : ""}"></span><span class="status-text">${state.connected ? "실시간 연결됨" : "연결 중"}</span></span></div>` : ""}
    </header>${content}</main>`;
}

function renderWelcome() {
  document.body.classList.add("welcome-page");
  app.innerHTML = shell(`<section class="welcome"><div class="welcome-card">
    <p class="welcome-signal"><span></span> REAL-TIME CLASS GAME</p>
    <h1>이미지 빙고</h1>
    <p class="lead">이미지를 고르고, 나만의 빙고판을 완성해 함께 시작하세요.</p>
    <div class="mode-grid">
      <button class="mode-card" data-action="teacher-mode"><span class="mode-icon">${icons.teacher}</span><strong>강사로 시작</strong><span>방을 만들고 이미지와 게임 규칙을 설정해요.</span></button>
      <button class="mode-card" data-action="student-mode"><span class="mode-icon">${icons.student}</span><strong>학생으로 입장</strong><span>방 코드와 이름을 입력하고 게임에 참여해요.</span></button>
    </div>
  </div></section>`);
}

function showTeacherModal() {
  showModal(`<h2>새 빙고방 만들기</h2><p class="subtle">빙고판 크기와 승리 조건은 방을 만든 뒤에도 바꿀 수 있어요.</p>
    <div class="form-row">
      <div class="field"><label for="boardSize">빙고판 크기</label><select id="boardSize"><option value="3">3 × 3</option><option value="4">4 × 4</option><option value="5">5 × 5</option></select></div>
      <div class="field"><label for="targetBingo">승리 조건</label><select id="targetBingo"><option value="1">1빙고</option><option value="2">2빙고</option><option value="3">3빙고</option></select></div>
    </div>
    <div id="roomCreateStatus" class="modal-status ${state.connected ? "ok" : "waiting"}" role="status" aria-live="polite"><span class="dot ${state.connected ? "live" : ""}"></span>${state.connected ? "실시간 서버 연결 확인됨" : "실시간 서버에 연결 중이에요"}</div>
    <div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">취소</button><button type="button" class="btn primary" data-action="create-room">방 만들기</button></div>`);
}

function showTeacherPasswordModal() {
  showModal(`<h2>강사 인증</h2><p class="subtle">강사용 비밀번호를 입력해 주세요.</p>
    <div class="field"><label for="teacherPassword">비밀번호</label><input id="teacherPassword" type="password" inputmode="numeric" maxlength="12" placeholder="비밀번호 입력" autocomplete="current-password"></div>
    <div class="modal-actions"><button class="btn ghost" data-action="close-modal">취소</button><button class="btn primary" data-action="verify-teacher-password">확인</button></div>`);
  setTimeout(() => document.querySelector("#teacherPassword")?.focus(), 0);
}

async function verifyTeacherPassword() {
  const input = document.querySelector("#teacherPassword");
  const button = document.querySelector('[data-action="verify-teacher-password"]');
  const entered = String(input?.value || "");
  if (!entered) return toast("비밀번호를 입력해 주세요.");
  if (button) { button.disabled = true; button.textContent = "확인 중…"; }
  try {
    const snapshot = await get(ref(db, "appSettings/teacherPasswordHash"));
    const expectedHash = String(snapshot.val() || await hashPassword(DEFAULT_TEACHER_PASSWORD));
    if (await hashPassword(entered) !== expectedHash) {
      toast("비밀번호가 맞지 않아요.");
      if (button) { button.disabled = false; button.textContent = "다시 확인"; }
      input?.select();
      return;
    }
    closeModal();
    showTeacherModal();
  } catch (error) {
    console.error(error);
    toast("비밀번호를 확인하지 못했어요. 연결 상태를 확인해 주세요.");
    if (button) { button.disabled = false; button.textContent = "다시 시도"; }
  }
}

function showChangePasswordModal() {
  showModal(`<h2>강사 비밀번호 변경</h2><p class="subtle">모든 기기에서 사용할 새 비밀번호를 설정하세요.</p>
    <div class="field"><label for="newTeacherPassword">새 비밀번호</label><input id="newTeacherPassword" type="password" inputmode="numeric" maxlength="12" placeholder="숫자 4~12자리" autocomplete="new-password"></div>
    <div class="field" style="margin-top:12px"><label for="confirmTeacherPassword">새 비밀번호 확인</label><input id="confirmTeacherPassword" type="password" inputmode="numeric" maxlength="12" placeholder="한 번 더 입력" autocomplete="new-password"></div>
    <div class="modal-actions"><button class="btn ghost" data-action="close-modal">취소</button><button class="btn primary" data-action="save-teacher-password">변경하기</button></div>`);
  setTimeout(() => document.querySelector("#newTeacherPassword")?.focus(), 0);
}

async function saveTeacherPassword() {
  const next = String(document.querySelector("#newTeacherPassword")?.value || "");
  const confirm = String(document.querySelector("#confirmTeacherPassword")?.value || "");
  if (!/^\d{4,12}$/.test(next)) return toast("비밀번호는 숫자 4~12자리로 입력해 주세요.");
  if (next !== confirm) return toast("새 비밀번호가 서로 다릅니다.");
  const button = document.querySelector('[data-action="save-teacher-password"]');
  if (button) { button.disabled = true; button.textContent = "저장 중…"; }
  try {
    await set(ref(db, "appSettings/teacherPasswordHash"), await hashPassword(next));
    closeModal();
    tone("join");
    toast("강사 비밀번호를 변경했어요.");
  } catch (error) {
    console.error(error);
    toast("비밀번호를 저장하지 못했어요. 다시 시도해 주세요.");
    if (button) { button.disabled = false; button.textContent = "다시 시도"; }
  }
}

function showStudentModal(prefill = "") {
  const remembered = prefill ? JSON.parse(localStorage.getItem(`bingo_student_${cleanCode(prefill)}`) || "null") : null;
  showModal(`<h2>빙고방 입장</h2><p class="subtle">강사 화면에 보이는 방 코드와 사용할 이름을 입력하세요.</p>
    <div class="field"><label for="joinCode">방 코드</label><input id="joinCode" inputmode="text" maxlength="6" value="${escapeHTML(cleanCode(prefill))}" placeholder="예: AB12CD" autocomplete="off"></div>
    <div class="field" style="margin-top:12px"><label for="studentName">이름</label><input id="studentName" maxlength="20" value="${escapeHTML(remembered?.name || "")}" placeholder="예: 김민지" autocomplete="name"></div>
    <div class="modal-actions"><button class="btn ghost" data-action="close-modal">취소</button><button class="btn sun" data-action="join-room">입장하기</button></div>`);
  setTimeout(() => document.querySelector(prefill ? "#studentName" : "#joinCode")?.focus(), 0);
}

function showModal(content) {
  document.querySelector(".modal-backdrop")?.remove();
  document.body.insertAdjacentHTML("beforeend", `<div class="modal-backdrop"><div class="modal">${content}</div></div>`);
}

function closeModal() { document.querySelector(".modal-backdrop")?.remove(); }

async function createRoom() {
  if (state.creatingRoom) return;
  const size = Number(document.querySelector("#boardSize")?.value || 3);
  const target = Number(document.querySelector("#targetBingo")?.value || 1);
  const code = makeRoomCode();
  const token = makeId("teacher");
  const button = document.querySelector('[data-action="create-room"]');
  const status = document.querySelector("#roomCreateStatus");
  state.creatingRoom = true;
  if (button) { button.disabled = true; button.textContent = "방 만드는 중…"; }
  if (status) { status.className = "modal-status waiting"; status.innerHTML = '<span class="spinner"></span>Firebase에 방을 저장하고 있어요'; }
  try {
    await Promise.race([
      set(ref(db, `rooms/${code}`), {
        createdAt: Date.now(),
        teacherToken: token,
        settings: { size, target, status: "setup" },
        images: {}, players: {}, drawn: []
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("CONNECTION_TIMEOUT")), 12000))
    ]);
  } catch (error) {
    console.error(error);
    const denied = String(error?.code || error?.message || "").toLowerCase().includes("permission");
    const timedOut = String(error?.message || "").includes("CONNECTION_TIMEOUT");
    const message = denied
      ? "Firebase 쓰기 권한이 막혀 있어요. Realtime Database 규칙에서 rooms 경로의 쓰기를 허용해 주세요."
      : timedOut
        ? "Firebase 응답이 늦어 방을 만들지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
        : "방을 만들지 못했어요. Firebase 연결과 데이터베이스 설정을 확인해 주세요.";
    if (status) { status.className = "modal-status error"; status.textContent = message; }
    if (button) { button.disabled = false; button.textContent = "다시 시도"; }
    state.creatingRoom = false;
    return;
  }
  localStorage.setItem(`bingo_teacher_${code}`, token);
  closeModal();
  state.roomCode = code;
  state.role = "teacher";
  state.teacherToken = token;
  state.view = "teacher";
  state.creatingRoom = false;
  history.replaceState({}, "", `${location.pathname}?room=${code}&mode=teacher`);
  tone("join");
  connectRoom();
}

async function joinRoom(codeInput, nameInput) {
  const code = cleanCode(codeInput ?? document.querySelector("#joinCode")?.value);
  const name = String(nameInput ?? document.querySelector("#studentName")?.value ?? "").trim();
  if (code.length !== 6 || !name) return toast("방 코드와 이름을 모두 입력해 주세요.");
  const snapshot = await get(ref(db, `rooms/${code}`));
  if (!snapshot.exists()) return toast("방을 찾지 못했어요. 코드를 다시 확인해 주세요.");
  const saved = JSON.parse(localStorage.getItem(`bingo_student_${code}`) || "null");
  const playerId = saved?.playerId || makeId("player");
  const oldPlayer = snapshot.val()?.players?.[playerId];
  const localPlayer = JSON.parse(localStorage.getItem(`bingo_state_${code}_${playerId}`) || "null");
  if (snapshot.val()?.settings?.status === "finished" && !oldPlayer) return toast("이미 끝난 게임이에요.");
  state.roomCode = code;
  state.role = "student";
  state.playerId = playerId;
  state.playerName = oldPlayer?.name || name;
  state.view = "student";
  localStorage.setItem(`bingo_student_${code}`, JSON.stringify({ playerId, name: state.playerName }));
  const playerRef = ref(db, `rooms/${code}/players/${playerId}`);
  await update(playerRef, { name: state.playerName, online: true, lastSeen: serverTimestamp(), ...(oldPlayer ? {} : { board: localPlayer?.board || [], marks: localPlayer?.marks || {}, bingoCount: localPlayer?.bingoCount || 0, joinedAt: localPlayer?.joinedAt || Date.now(), finishedAt: localPlayer?.finishedAt || null }) });
  onDisconnect(playerRef).update({ online: false, lastSeen: serverTimestamp() });
  closeModal();
  history.replaceState({}, "", `${location.pathname}?room=${code}`);
  tone("join");
  connectRoom();
}

function connectRoom() {
  state.unsubRoom?.();
  const roomRef = ref(db, `rooms/${state.roomCode}`);
  state.unsubRoom = onValue(roomRef, snapshot => {
    if (!snapshot.exists()) { toast("이 방은 더 이상 존재하지 않아요."); leaveRoom(); return; }
    const previous = state.room;
    state.room = snapshot.val();
    if (state.role === "student" && state.playerId && state.room.players?.[state.playerId]) {
      localStorage.setItem(`bingo_state_${state.roomCode}_${state.playerId}`, JSON.stringify(state.room.players[state.playerId]));
    }
    const drawCount = (state.room.drawn || []).filter(Boolean).length;
    if (drawCount > state.lastDrawCount && previous) tone("draw");
    state.lastDrawCount = drawCount;
    const myBingo = state.room.players?.[state.playerId]?.bingoCount || 0;
    if (myBingo > state.lastBingoCount && state.role === "student") tone("bingo");
    state.lastBingoCount = myBingo;
    render();
  });
}

onValue(ref(db, ".info/connected"), snapshot => {
  state.connected = snapshot.val() === true;
  const status = document.querySelector("#roomCreateStatus");
  if (status && !state.creatingRoom) {
    status.className = `modal-status ${state.connected ? "ok" : "waiting"}`;
    status.innerHTML = `<span class="dot ${state.connected ? "live" : ""}"></span>${state.connected ? "실시간 서버 연결 확인됨" : "실시간 서버에 연결 중이에요"}`;
  }
  if (state.view !== "welcome") render();
});

window.addEventListener("unhandledrejection", event => {
  console.error(event.reason);
  if (state.view !== "welcome") toast("실시간 연결 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.");
});

function roomImages() { return Object.values(state.room?.images || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); }
function roomPlayers() { return Object.entries(state.room?.players || {}).map(([id, value]) => ({ id, ...value })).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0)); }
function drawnIds() { return (state.room?.drawn || []).filter(Boolean); }
function currentDraw() { const ids = drawnIds(); return roomImages().find(image => image.id === ids.at(-1)); }

function teacherView() {
  const settings = state.room?.settings || { size: 3, target: 1, status: "setup" };
  const images = roomImages();
  const players = roomPlayers();
  const needed = settings.size * settings.size;
  const ready = images.length >= needed;
  const called = drawnIds();
  const selectedCounts = Object.fromEntries(images.map(image => [
    image.id,
    players.filter(player => Array.isArray(player.board) && player.board.includes(image.id)).length
  ]));
  const ranks = players.filter(p => p.finishedAt).sort((a,b) => a.finishedAt - b.finishedAt).slice(0,3);
  const setup = settings.status === "setup";
  return shell(`<div class="teacher-single"><section class="stack">
    <article class="card">
      <div class="card-head"><div><p class="eyebrow">강사 모드</p><h2>게임 설정</h2></div><div class="toolbar"><button class="btn ghost small" data-action="change-password">비밀번호 변경</button><button class="btn ghost small" data-action="show-qr">${icons.qr} QR 입장</button></div></div>
      <div class="form-row">
        <div class="field"><label for="teacherSize">빙고판 크기</label><select id="teacherSize" ${setup ? "" : "disabled"}><option value="3" ${settings.size===3?"selected":""}>3 × 3</option><option value="4" ${settings.size===4?"selected":""}>4 × 4</option><option value="5" ${settings.size===5?"selected":""}>5 × 5</option></select></div>
        <div class="field"><label for="teacherTarget">승리 조건</label><select id="teacherTarget" ${setup ? "" : "disabled"}><option value="1" ${settings.target===1?"selected":""}>1빙고</option><option value="2" ${settings.target===2?"selected":""}>2빙고</option><option value="3" ${settings.target===3?"selected":""}>3빙고</option></select></div>
      </div>
      ${setup ? `<p class="setup-note">이미지는 최소 ${needed}장 필요해요. 현재 <strong>${images.length}장</strong> 준비됐습니다.</p>` : `<p class="setup-note">게임이 시작되어 설정이 잠겼어요. 현재 ${settings.size}×${settings.size}, ${settings.target}빙고입니다.</p>`}
    </article>

    <article class="card"><div class="card-head"><h3>참여 학생</h3><span class="status-pill">${players.filter(p=>p.online).length}명 접속</span></div>
      <div class="student-list">${players.length ? players.map(studentRow).join("") : `<div class="empty-state">아직 입장한 학생이 없어요.<br>QR 코드나 방 코드를 보여주세요.</div>`}</div>
      ${ranks.length ? `<div class="finished-ranks"><div class="card-head"><h3>게임 결과</h3><span class="subtle">TOP 3</span></div><div class="rank-list">${ranks.map((p,i)=>rankRow(p,i)).join("")}</div></div>` : ""}
    </article>

    ${setup ? `<article class="card"><div class="card-head"><div><h2>이미지 준비</h2><p class="subtle">여러 장을 한 번에 선택할 수 있어요.</p></div><span class="status-pill">${images.length} / ${needed}+</span></div>
      <label class="dropzone"><input id="imageUpload" type="file" accept="image/*" multiple ${state.uploading?"disabled":""}><div><span style="font-size:1.7rem">${icons.upload}</span><strong>${state.uploading ? escapeHTML(state.uploadMessage || "이미지를 올리는 중…") : "이미지를 선택하거나 여기에 놓으세요"}</strong><span class="subtle">한 장씩 또는 여러 파일 선택 · JPG, PNG, WEBP</span></div></label>
      <label class="split-option"><input id="autoSplit" type="checkbox" checked ${state.uploading?"disabled":""}><span><strong>한 파일 속 여러 이미지 자동 분리</strong><small>흰색·투명 여백으로 나뉜 격자 이미지를 각각 인식해요.</small></span></label>
      ${state.uploading ? `<div class="progress-track"><div class="progress-bar" style="width:${state.uploadProgress}%"></div></div>` : ""}
    </article>` : ""}

    <article class="card"><div class="card-head"><div><h2>전체 이미지</h2><p class="subtle">${setup ? "삭제할 이미지를 누르세요. 학생이 선택한 이미지는 빨간 테두리로 표시됩니다." : "이미지를 누르면 모든 학생의 같은 칸에 빨간 동그라미가 표시됩니다."}</p></div><span class="status-pill">${setup ? `${images.length}장` : `${called.length} / ${images.length} 표시`}</span></div>
      ${images.length ? `<div class="image-bank teacher-bank">${images.map((image,i)=> {
        const selectedCount = selectedCounts[image.id] || 0;
        const selectedClass = selectedCount ? "student-chosen" : "";
        const badge = selectedCount ? `<span class="choice-count">${selectedCount}명 선택</span>` : "";
        return setup
          ? `<button type="button" class="bank-item ${selectedClass}" data-action="delete-image" data-id="${escapeHTML(image.id)}" aria-label="${i+1}번 이미지 삭제"><img src="${escapeHTML(image.url)}" alt="업로드 이미지 ${i+1}">${badge}<span class="delete-mark" aria-hidden="true">×</span></button>`
          : `<button type="button" class="bank-item ${selectedClass} ${called.includes(image.id)?"called":""}" data-action="mark-called-image" data-id="${escapeHTML(image.id)}" aria-pressed="${called.includes(image.id)}" aria-label="${i+1}번 이미지 ${called.includes(image.id)?"표시 해제":"표시"}"><img src="${escapeHTML(image.url)}" alt="업로드 이미지 ${i+1}">${badge}</button>`;
      }).join("")}</div>` : `<div class="empty-state">업로드한 이미지가 여기에 모두 표시됩니다.</div>`}
      ${!setup ? `<p class="setup-note">잘못 눌렀다면 같은 이미지를 다시 눌러 빨간 동그라미를 해제할 수 있어요.</p>` : ""}
    </article>

    ${setup ? `<button class="btn mint" style="min-height:58px;font-size:1.05rem" data-action="start-game" ${!ready || players.length===0 ? "disabled" : ""}>${icons.play} 학생 ${players.length}명과 게임 시작</button>` : ""}
  </section></div>`, "teacher");
}

function studentRow(p) {
  const count = Array.isArray(p.board) ? p.board.filter(Boolean).length : 0;
  const total = (state.room?.settings?.size || 3) ** 2;
  return `<div class="student-row"><span class="avatar">${escapeHTML(p.name?.slice(0,1) || "?")}</span><span class="student-meta"><strong>${escapeHTML(p.name || "이름 없음")}</strong><span>${count >= total ? "빙고판 준비 완료" : `${count}/${total}칸 준비`} · ${p.bingoCount || 0}빙고</span></span><span class="online ${p.online ? "" : "offline"}" title="${p.online ? "접속 중" : "나감"}"></span></div>`;
}

function rankRow(p, i) {
  return `<div class="rank-row"><span class="medal">${["🥇","🥈","🥉"][i]}</span><span class="student-meta"><strong>${escapeHTML(p.name)}</strong><span>${p.bingoCount || 0}빙고 완성</span></span></div>`;
}

function studentView() {
  const settings = state.room?.settings || { size: 3, target: 1, status: "setup" };
  const player = state.room?.players?.[state.playerId] || {};
  const images = roomImages();
  const total = settings.size ** 2;
  const board = normalizeBoard(player.board, total);
  const filled = board.filter(Boolean).length;
  const called = drawnIds();
  const marks = Object.fromEntries(called.map(id => [id,true]));
  const ranks = roomPlayers().filter(p=>p.finishedAt).sort((a,b)=>a.finishedAt-b.finishedAt).slice(0,3);
  const setup = settings.status === "setup";
  const winner = (player.bingoCount || 0) >= settings.target;
  return shell(`<div class="student-dashboard"><section class="student-workspace">
    <article class="card student-board-card"><div class="card-head"><div><p class="eyebrow">학생 모드 · ${escapeHTML(state.playerName)}</p><h2>${setup ? "나만의 빙고판 만들기" : `${settings.target}빙고에 도전!`}</h2></div><span class="status-pill">${settings.size} × ${settings.size}</span></div>
      ${winner ? `<div class="winner-banner"><strong>🎉 빙고 완성!</strong><span>축하해요! 순위표를 확인해 보세요.</span></div>` : ""}
      ${setup ? `<p class="notice">이미지를 누르면 빈칸에 순서대로 들어가요. 빈칸을 먼저 누르면 그 자리에 들어갑니다. 모두 채운 뒤에는 두 칸을 눌러 자리를 바꾸거나, 한 칸과 보관함 이미지를 차례로 눌러 교체할 수 있어요.</p>` : `<p class="notice">강사가 선택한 이미지만 빨간 동그라미로 자동 표시돼요. 학생이 직접 누를 수는 없어요.</p>`}
      <div class="board-wrap" style="margin-top:18px"><div class="bingo-board ${winner ? "bingo-flash" : ""}" style="grid-template-columns:repeat(${settings.size},1fr)">${board.map((id,index)=>boardCell(id,index,images,marks,setup)).join("")}</div></div>
      <p class="subtle" style="text-align:center;margin:16px 0 0">${setup ? `${filled}/${total}칸 채움${filled===total ? " · 두 칸은 자리 바꿈, 칸+보관함 이미지는 교체" : ""}` : `${player.bingoCount || 0}빙고 · 목표 ${settings.target}빙고`}</p>
    </article>
    ${setup ? `<article class="card student-bank-card"><div class="card-head"><div><h2>이미지 보관함</h2><p class="subtle">${images.length < total ? `강사가 이미지를 준비 중이에요 (${images.length}/${total})` : "오른쪽 빙고판에 넣을 이미지를 선택하세요."}</p></div></div>
      ${images.length ? `<div class="image-bank">${images.map((image,i)=>{const pos=board.indexOf(image.id);return `<button class="bank-item ${pos>=0?"used":""}" data-action="pick-image" data-id="${escapeHTML(image.id)}" ${pos>=0?"disabled":""}><img src="${escapeHTML(image.url)}" alt="빙고 이미지 ${i+1}">${pos>=0?`<span class="order-badge">${pos+1}</span>`:""}</button>`}).join("")}</div>` : `<div class="empty-state">강사가 이미지를 올리면<br>여기에 바로 나타납니다.</div>`}
    </article>` : `<article class="card student-bank-card"><div class="card-head"><div><h2>전체 이미지</h2><p class="subtle">강사가 누른 이미지는 빨간 동그라미로 표시돼요.</p></div><span class="status-pill">${called.length} / ${images.length}</span></div><div class="image-bank">${images.map((image,i)=>`<div class="bank-item ${called.includes(image.id)?"called":""}"><img src="${escapeHTML(image.url)}" alt="전체 이미지 ${i+1}"></div>`).join("")}</div></article>`}
  </section><article class="card student-rank-card"><div class="card-head"><h3>현재 순위</h3><span class="subtle">TOP 3</span></div><div class="rank-list">${ranks.length?ranks.map((p,i)=>rankRow(p,i)).join(""):`<div class="empty-state">아직 완성한 친구가 없어요.</div>`}</div></article></div>`);
}

function normalizeBoard(board, total) {
  const result = Array.isArray(board) ? [...board] : [];
  while (result.length < total) result.push(null);
  return result.slice(0, total);
}

function boardCell(id, index, images, marks, setup) {
  const image = images.find(item => item.id === id);
  return `<button class="board-cell ${image ? "" : "empty"} ${state.selectedCell===index?"selected":""} ${marks[id]?"marked":""}" ${setup ? `data-action="board-cell" data-index="${index}"` : "disabled"} aria-label="${image ? `빙고 이미지 ${index+1}` : `빈칸 ${index+1}`}">${image ? `<img src="${escapeHTML(image.url)}" alt="">` : index+1}</button>`;
}

async function updateBoard(board) {
  localStorage.setItem(`bingo_board_${state.roomCode}_${state.playerId}`, JSON.stringify(board));
  await set(ref(db, `rooms/${state.roomCode}/players/${state.playerId}/board`), board);
}

async function pickImage(id) {
  const settings = state.room.settings;
  if (settings.status !== "setup") return;
  const total = settings.size ** 2;
  const board = normalizeBoard(state.room.players?.[state.playerId]?.board, total);
  if (board.includes(id)) return;
  const full = board.every(Boolean);
  let target = state.selectedCell;
  if (full && target === null) return toast("먼저 교체할 빙고판 이미지를 눌러 주세요.");
  if (!full && (target === null || board[target])) target = board.findIndex(value => !value);
  if (target === null || target < 0) return;
  board[target] = id;
  state.selectedCell = null;
  tone("click");
  await updateBoard(board);
}

async function clickBoard(index) {
  const settings = state.room.settings;
  const total = settings.size ** 2;
  const player = state.room.players?.[state.playerId];
  const board = normalizeBoard(player?.board, total);
  if (settings.status === "setup") {
    const full = board.every(Boolean);
    if (!full && board[index]) return toast("빙고판을 모두 채우면 이미지를 교체할 수 있어요.");
    if (!full || state.selectedCell === null || state.selectedCell === index) {
      state.selectedCell = state.selectedCell === index ? null : index;
      tone("click");
      render();
      return;
    }
    [board[state.selectedCell], board[index]] = [board[index], board[state.selectedCell]];
    state.selectedCell = null;
    tone("click");
    await updateBoard(board);
    return;
  }
}

function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  try {
    void Promise.resolve(context.registerTool({
      name: "join_bingo_room",
      title: "빙고방 입장",
      description: "방 코드와 학생 이름으로 실시간 빙고방에 입장하고 기존 기기 기록이 있으면 이어서 참여합니다.",
      inputSchema: {
        type: "object",
        properties: {
          roomCode: { type: "string", pattern: "^[A-Za-z0-9]{6}$", description: "6자리 방 코드" },
          studentName: { type: "string", minLength: 1, maxLength: 20, description: "학생 이름" }
        },
        required: ["roomCode", "studentName"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const code = cleanCode(input?.roomCode);
        const name = String(input?.studentName || "").trim();
        if (code.length !== 6 || !name || name.length > 20) throw new Error("올바른 방 코드와 1~20자의 이름이 필요합니다.");
        await joinRoom(code, name);
        if (state.role !== "student" || state.roomCode !== code) throw new Error("빙고방에 입장하지 못했습니다.");
        return { joined: true, roomCode: code, studentName: state.playerName };
      }
    }, { signal: lifecycle.signal })).catch(console.error);
  } catch (error) { console.error(error); }
}

function calculateBingos(board, marks, size) {
  const lines = [];
  for (let r=0; r<size; r++) lines.push(Array.from({length:size},(_,c)=>r*size+c));
  for (let c=0; c<size; c++) lines.push(Array.from({length:size},(_,r)=>r*size+c));
  lines.push(Array.from({length:size},(_,i)=>i*size+i));
  lines.push(Array.from({length:size},(_,i)=>i*size+(size-1-i)));
  return lines.filter(line => line.every(index => board[index] && marks[board[index]])).length;
}

function loadBitmap(file) {
  if (window.createImageBitmap) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("IMAGE_DECODE_FAILED")); };
    image.src = url;
  });
}

function contentSpans(active, minimumLength) {
  const spans = [];
  let start = -1;
  for (let i = 0; i <= active.length; i++) {
    if (i < active.length && active[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= minimumLength) spans.push([start, i]);
      start = -1;
    }
  }
  return spans;
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("IMAGE_CROP_FAILED")), "image/png"));
}

async function splitCompositeImage(file) {
  const bitmap = await loadBitmap(file);
  const originalWidth = bitmap.naturalWidth || bitmap.width;
  const originalHeight = bitmap.naturalHeight || bitmap.height;
  if (originalWidth < 260 || originalHeight < 260) return [file];

  const scale = Math.min(1, 1200 / Math.max(originalWidth, originalHeight));
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  const analysis = document.createElement("canvas");
  analysis.width = width; analysis.height = height;
  const ctx = analysis.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;

  const cornerPoints = [[1,1],[width-2,1],[1,height-2],[width-2,height-2]];
  const background = cornerPoints.reduce((sum,[x,y]) => {
    const p = (y * width + x) * 4;
    return [sum[0]+pixels[p], sum[1]+pixels[p+1], sum[2]+pixels[p+2], sum[3]+pixels[p+3]];
  }, [0,0,0,0]).map(value => value / cornerPoints.length);
  const isContent = p => {
    if (pixels[p+3] < 24) return false;
    if (background[3] < 24) return true;
    const dr = pixels[p] - background[0], dg = pixels[p+1] - background[1], db = pixels[p+2] - background[2];
    const saturation = Math.max(pixels[p], pixels[p+1], pixels[p+2]) - Math.min(pixels[p], pixels[p+1], pixels[p+2]);
    const brightness = (pixels[p] + pixels[p+1] + pixels[p+2]) / 3;
    return (dr*dr + dg*dg + db*db > 1800 && (saturation > 18 || brightness < 195)) || saturation > 24 || brightness < 175;
  };

  const totalPixels = width * height;
  const objectMask = new Uint8Array(totalPixels);
  const radius = Math.max(2, Math.round(Math.min(width, height) / 140));
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    if (!isContent((y*width+x)*4)) continue;
    for (let dy=-radius; dy<=radius; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      const from = Math.max(0, x-radius), to = Math.min(width-1, x+radius);
      objectMask.fill(1, ny*width+from, ny*width+to+1);
    }
  }

  const queue = new Int32Array(totalPixels);
  const components = [];
  const minComponent = Math.max(100, totalPixels * .004);
  for (let start=0; start<totalPixels; start++) {
    if (objectMask[start] !== 1) continue;
    let head=0, tail=0, count=0;
    let minX=width, minY=height, maxX=0, maxY=0;
    queue[tail++] = start; objectMask[start] = 2;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width, y = Math.floor(index / width);
      count++; minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y);
      const neighbors = [index-1,index+1,index-width,index+width];
      for (const next of neighbors) {
        if (next < 0 || next >= totalPixels || objectMask[next] !== 1) continue;
        const nx = next % width;
        if (Math.abs(nx-x) > 1) continue;
        objectMask[next] = 2; queue[tail++] = next;
      }
    }
    const boxWidth=maxX-minX+1, boxHeight=maxY-minY+1;
    if (count >= minComponent && boxWidth >= width*.08 && boxHeight >= height*.08) {
      components.push({ left:minX, top:minY, right:maxX+1, bottom:maxY+1, centerY:(minY+maxY)/2, height:boxHeight });
    }
  }

  let regions = [];
  if (components.length >= 2 && components.length <= 40) {
    const medianHeight = components.map(item=>item.height).sort((a,b)=>a-b)[Math.floor(components.length/2)];
    const rows = [];
    for (const item of [...components].sort((a,b)=>a.centerY-b.centerY)) {
      let row = rows.find(candidate => Math.abs(candidate.centerY-item.centerY) < Math.max(18,medianHeight*.48));
      if (!row) { row={centerY:item.centerY,items:[]}; rows.push(row); }
      row.items.push(item);
      row.centerY = row.items.reduce((sum,entry)=>sum+entry.centerY,0)/row.items.length;
    }
    regions = rows.sort((a,b)=>a.centerY-b.centerY).flatMap(row=>row.items.sort((a,b)=>a.left-b.left));
  }

  // 외곽선 묶음이 잡히지 않는 사진형 콜라주는 여백 투영 방식으로 한 번 더 확인한다.
  const rows = Array(height).fill(false);
  const cols = Array(width).fill(false);
  const step = 1;
  for (let y=0; y<height; y+=step) {
    let rowCount = 0;
    for (let x=0; x<width; x+=step) {
      const p = (y * width + x) * 4;
      if (isContent(p)) { rowCount++; cols[x] = true; }
    }
    rows[y] = rowCount > Math.max(2, (width / step) * .008);
  }
  for (let i=1; i<rows.length; i++) if (rows[i-1]) rows[i] = rows[i] || (i+1<rows.length && rows[i+1]);
  for (let i=1; i<cols.length; i++) if (cols[i-1]) cols[i] = cols[i] || (i+1<cols.length && cols[i+1]);

  const rowSpans = contentSpans(rows, Math.max(22, height * .09));
  const colSpans = contentSpans(cols, Math.max(22, width * .09));
  if (regions.length < 2) {
    regions = [];
    for (const [top,bottom] of rowSpans) for (const [left,right] of colSpans) {
      let occupied = 0, sampled = 0;
      for (let y=top; y<bottom; y+=Math.max(1,step*2)) for (let x=left; x<right; x+=Math.max(1,step*2)) {
        sampled++; if (isContent((y*width+x)*4)) occupied++;
      }
      if (sampled && occupied/sampled > .025) regions.push({ left, top, right, bottom });
    }
  }
  if (regions.length < 2 || regions.length > 40) return [file];

  const output = [];
  const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
  for (let i=0; i<regions.length; i++) {
    const region = regions[i];
    const padding = Math.max(3, Math.round(Math.min(region.right-region.left,region.bottom-region.top)*.04));
    const sx = Math.max(0, Math.floor((region.left-padding) / scale));
    const sy = Math.max(0, Math.floor((region.top-padding) / scale));
    const sw = Math.min(originalWidth-sx, Math.ceil((region.right-region.left+padding*2)/scale));
    const sh = Math.min(originalHeight-sy, Math.ceil((region.bottom-region.top+padding*2)/scale));
    const crop = document.createElement("canvas");
    crop.width = sw; crop.height = sh;
    crop.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await canvasBlob(crop);
    output.push(new File([blob], `${baseName}_${String(i+1).padStart(2,"0")}.png`, { type: "image/png" }));
  }
  bitmap.close?.();
  return output;
}

async function compactDataUrl(file) {
  const bitmap = await loadBitmap(file);
  const sourceWidth = bitmap.naturalWidth || bitmap.width;
  const sourceHeight = bitmap.naturalHeight || bitmap.height;
  const scale = Math.min(1, 480/Math.max(sourceWidth,sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1,Math.round(sourceWidth*scale));
  canvas.height = Math.max(1,Math.round(sourceHeight*scale));
  canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);
  const result = canvas.toDataURL("image/webp",.82);
  bitmap.close?.();
  return result;
}

async function uploadWithFallback(file, id, safeName) {
  if (state.storageUnavailable) return { url:await compactDataUrl(file), storedIn:"database" };
  const fileRef = storageRef(storage, `bingo/${state.roomCode}/${id}_${safeName}`);
  try {
    const task = uploadBytesResumable(fileRef, file, { contentType: file.type });
    await new Promise((resolve,reject) => {
      const timer = setTimeout(() => { task.cancel(); reject(new Error("STORAGE_TIMEOUT")); }, 8000);
      task.on("state_changed", undefined, error => { clearTimeout(timer); reject(error); }, () => { clearTimeout(timer); resolve(); });
    });
    return { url:await getDownloadURL(fileRef), storedIn:"storage" };
  } catch (error) {
    console.warn("Firebase Storage fallback", error);
    state.storageUnavailable = true;
    state.uploadMessage = "Storage 응답이 없어 안전 저장 방식으로 전환 중…";
    render();
    return { url:await compactDataUrl(file), storedIn:"database" };
  }
}

async function uploadImages(files) {
  const accepted = [...files].filter(file => file.type.startsWith("image/")).slice(0, 50);
  if (!accepted.length) return toast("이미지 파일을 선택해 주세요.");
  const shouldSplit = document.querySelector("#autoSplit")?.checked !== false;
  state.uploading = true; state.uploadProgress = 0; state.uploadMessage = "이미지를 분석하는 중…"; render();
  try {
    const prepared = [];
    for (const file of accepted) {
      const parts = shouldSplit ? await splitCompositeImage(file) : [file];
      prepared.push(...parts);
    }
    state.uploadMessage = prepared.length > accepted.length ? `${prepared.length}개 이미지로 나눠 올리는 중…` : "이미지를 올리는 중…";
    render();
    for (let i=0; i<prepared.length; i++) {
      const file = prepared[i];
      const id = makeId("img");
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const stored = await uploadWithFallback(file,id,safeName);
      await set(ref(db, `rooms/${state.roomCode}/images/${id}`), { id, url:stored.url, storedIn:stored.storedIn, name: file.name, createdAt: Date.now() + i });
      state.uploadProgress = Math.round(((i+1)/prepared.length)*100); render();
    }
    tone("join"); toast(`${prepared.length}개의 이미지를 올렸어요.${prepared.length > accepted.length ? ` (${accepted.length}개 파일에서 자동 분리)` : ""}`);
  } catch (error) {
    console.error(error);
    toast("이미지 업로드에 실패했어요. Firebase Storage 규칙을 확인해 주세요.");
  } finally { state.uploading = false; state.uploadProgress = 0; state.uploadMessage = ""; render(); }
}

async function saveSettings() {
  const size = Number(document.querySelector("#teacherSize")?.value);
  const target = Number(document.querySelector("#teacherTarget")?.value);
  await update(ref(db, `rooms/${state.roomCode}/settings`), { size, target });
  const players = roomPlayers();
  await Promise.all(players.map(p => update(ref(db, `rooms/${state.roomCode}/players/${p.id}`), { board: [], marks: {}, bingoCount: 0, finishedAt: null })));
  toast("게임 설정을 바꿨어요. 학생 빙고판이 초기화됩니다.");
}

async function startGame() {
  const settings = state.room.settings;
  const images = roomImages();
  const players = roomPlayers();
  if (images.length < settings.size ** 2) return toast("빙고판 칸 수만큼 이미지를 올려 주세요.");
  if (!players.length) return toast("학생이 한 명 이상 입장해야 해요.");
  const notReady = players.filter(p => normalizeBoard(p.board, settings.size ** 2).some(v => !v));
  if (notReady.length) return toast(`${notReady.map(p=>p.name).slice(0,3).join(", ")} 학생의 빙고판이 아직 완성되지 않았어요.`);
  await update(ref(db, `rooms/${state.roomCode}/settings`), { status: "playing", startedAt: Date.now() });
  tone("join"); toast("게임을 시작했어요!");
}

async function deleteImage(id) {
  const settings = state.room?.settings;
  if (!id || settings?.status !== "setup") return;
  const image = roomImages().find(item => item.id === id);
  if (!image) return;
  const changes = {
    [`rooms/${state.roomCode}/images/${id}`]: null,
    [`rooms/${state.roomCode}/drawn`]: drawnIds().filter(item => item !== id).length
      ? drawnIds().filter(item => item !== id)
      : null
  };
  for (const player of roomPlayers()) {
    const board = normalizeBoard(player.board, settings.size ** 2).map(item => item === id ? null : item);
    const marks = { ...(player.marks || {}) };
    delete marks[id];
    changes[`rooms/${state.roomCode}/players/${player.id}/board`] = board;
    changes[`rooms/${state.roomCode}/players/${player.id}/marks`] = Object.keys(marks).length ? marks : null;
    changes[`rooms/${state.roomCode}/players/${player.id}/bingoCount`] = 0;
    changes[`rooms/${state.roomCode}/players/${player.id}/finishedAt`] = null;
  }
  await update(ref(db), changes);
  tone("click");
  toast("이미지를 삭제했어요. 학생 빙고판의 같은 이미지도 비워졌습니다.");
}

async function markCalledImage(id) {
  const settings = state.room.settings;
  if (settings.status !== "playing") return;
  const called = drawnIds();
  const nextCalled = called.includes(id) ? called.filter(item=>item!==id) : [...called,id];
  const now = Date.now();
  const changes = { [`rooms/${state.roomCode}/drawn`]: nextCalled.length ? nextCalled : null };
  for (const player of roomPlayers()) {
    const board = normalizeBoard(player.board, settings.size ** 2);
    const marks = Object.fromEntries(nextCalled.filter(imageId=>board.includes(imageId)).map(imageId=>[imageId,true]));
    const bingoCount = calculateBingos(board,marks,settings.size);
    changes[`rooms/${state.roomCode}/players/${player.id}/marks`] = Object.keys(marks).length ? marks : null;
    changes[`rooms/${state.roomCode}/players/${player.id}/bingoCount`] = bingoCount;
    changes[`rooms/${state.roomCode}/players/${player.id}/finishedAt`] = bingoCount >= settings.target ? (player.finishedAt || now) : null;
  }
  await update(ref(db),changes);
  tone("draw");
}

function showQr() {
  const url = `${location.origin}${location.pathname}?room=${state.roomCode}`;
  showModal(`<h2>QR로 학생 초대</h2><p class="subtle">휴대폰 카메라로 찍거나 학생용 링크를 공유하세요.</p><div class="qr-room-code"><span>방 코드</span><strong>${escapeHTML(state.roomCode)}</strong></div><div id="qrBox" class="qr-box"></div><button class="btn primary copy-student-link" data-action="copy-student-link" data-url="${escapeHTML(url)}">학생용 링크 복사</button><div class="modal-actions"><button class="btn ghost" data-action="close-modal">닫기</button></div>`);
  setTimeout(() => {
    const box = document.querySelector("#qrBox");
    if (window.QRCode) new window.QRCode(box, { text: url, width: 210, height: 210, colorDark: "#14213d", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.H });
    else box.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=210x210&data=${encodeURIComponent(url)}" alt="학생 입장 QR 코드">`;
  }, 50);
}

function leaveRoom() {
  state.unsubRoom?.();
  state.unsubRoom = null;
  state.room = null;
  state.roomCode = "";
  state.role = "";
  state.playerId = "";
  state.playerName = "";
  state.selectedCell = null;
  state.view = "welcome";
  history.replaceState({}, "", location.pathname);
  renderWelcome();
}

function render() {
  if (state.view === "welcome") return renderWelcome();
  document.body.classList.remove("welcome-page");
  if (!state.room) return app.innerHTML = shell(`<div class="card empty-state">방 정보를 불러오고 있어요…</div>`);
  app.innerHTML = state.role === "teacher" ? teacherView() : studentView();
}

document.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "teacher-mode") showTeacherPasswordModal();
  if (action === "student-mode") showStudentModal(new URLSearchParams(location.search).get("room") || "");
  if (action === "close-modal") closeModal();
  if (action === "verify-teacher-password") await verifyTeacherPassword();
  if (action === "change-password") showChangePasswordModal();
  if (action === "save-teacher-password") await saveTeacherPassword();
  if (action === "create-room") await createRoom();
  if (action === "join-room") await joinRoom();
  if (action === "pick-image") await pickImage(button.dataset.id);
  if (action === "board-cell") await clickBoard(Number(button.dataset.index));
  if (action === "start-game") await startGame();
  if (action === "delete-image") await deleteImage(button.dataset.id);
  if (action === "mark-called-image") await markCalledImage(button.dataset.id);
  if (action === "show-qr") showQr();
  if (action === "copy-student-link") { await navigator.clipboard.writeText(button.dataset.url); tone("click"); toast("학생용 링크를 복사했어요."); }
  if (action === "leave-room" || action === "home") leaveRoom();
});

app.addEventListener("change", async event => {
  if (event.target.id === "imageUpload") await uploadImages(event.target.files);
  if (event.target.id === "teacherSize" || event.target.id === "teacherTarget") await saveSettings();
});

document.addEventListener("keydown", async event => {
  if (event.key === "Escape") closeModal();
  if (event.key === "Enter" && document.querySelector("#studentName")) await joinRoom();
  if (event.key === "Enter" && document.querySelector("#teacherPassword")) await verifyTeacherPassword();
});

window.addEventListener("beforeunload", () => {
  if (state.role === "student" && state.roomCode && state.playerId) {
    update(ref(db, `rooms/${state.roomCode}/players/${state.playerId}`), { online: false, lastSeen: Date.now() });
  }
});

const queryRoom = cleanCode(new URLSearchParams(location.search).get("room"));
const queryMode = new URLSearchParams(location.search).get("mode");
renderWelcome();
if (queryRoom && queryMode === "teacher" && localStorage.getItem(`bingo_teacher_${queryRoom}`)) {
  state.roomCode = queryRoom;
  state.role = "teacher";
  state.teacherToken = localStorage.getItem(`bingo_teacher_${queryRoom}`);
  state.view = "teacher";
  connectRoom();
} else if (queryRoom) showStudentModal(queryRoom);
registerWebMcp();
