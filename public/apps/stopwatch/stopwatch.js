import { registerPwa } from "/public/libs/flare/pwa.js";
import { fs } from "/public/libs/flare/fs.js";

registerPwa("stopwatch");

// ---------------- Filesystem layout ----------------
// /home/.stopwatch/runs/<run_guid>.json
const HOME_DIR = "/home";
const DATA_DIR = "/home/.stopwatch";
const RUNS_DIR = "/home/.stopwatch/runs";

// ---------------- Filesystem helpers ----------------
async function ensureDir(path) {
    try {
        await fs.promises.mkdir(path);
    } catch (err) {
        if (err && err.code !== "EEXIST") throw err;
    }
}

async function ensureDataDirs() {
    await ensureDir(HOME_DIR);
    await ensureDir(DATA_DIR);
    await ensureDir(RUNS_DIR);
}

async function readJSON(path, fallback) {
    try {
        const raw = await fs.promises.readFile(path, { encoding: "utf8" });
        return JSON.parse(raw);
    } catch (err) {
        return fallback;
    }
}

async function writeJSON(path, value) {
    await ensureDataDirs();
    await fs.promises.writeFile(path, JSON.stringify(value), { encoding: "utf8" });
}

async function saveRun(run) {
    await writeJSON(`${RUNS_DIR}/${run.id}.json`, run);
    els.runsEmpty.classList.add("hidden");
}

async function loadAllRuns() {
    await ensureDataDirs();
    let files = [];
    try {
        files = await fs.promises.readdir(RUNS_DIR);
    } catch (err) {
        files = [];
    }
    const runs = [];
    for (const name of files) {
        if (!name.endsWith(".json")) continue;
        const run = await readJSON(`${RUNS_DIR}/${name}`, null);
        if (run) runs.push(run);
    }
    runs.sort((a, b) => b.startTime - a.startTime);
    return runs;
}

// ---------------- Per-run settings (localStorage) ----------------
const LAP_DISTANCE_KEY = "stopwatch.lapDistance";
const DEFAULT_LAP_DISTANCE_M = 1000;

function loadLapDistanceSetting() {
    try {
        const raw = localStorage.getItem(LAP_DISTANCE_KEY);
        const v = parseInt(raw, 10);
        return Number.isFinite(v) && v > 0 ? v : DEFAULT_LAP_DISTANCE_M;
    } catch (err) {
        return DEFAULT_LAP_DISTANCE_M;
    }
}

function saveLapDistanceSetting(v) {
    try {
        localStorage.setItem(LAP_DISTANCE_KEY, String(v));
    } catch (err) {
        console.error("failed to persist lap distance", err);
    }
}

// ---------------- Formatting ----------------
function pad2(n) {
    return n.toString().padStart(2, "0");
}
function formatTime(ms) {
    if (!isFinite(ms) || ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
    return `${m}:${pad2(s)}`;
}
function formatClockMs(ms) {
    if (!isFinite(ms) || ms < 0) ms = 0;
    const totalDeci = Math.floor(ms / 100);
    const ds = totalDeci % 10;
    const totalSec = Math.floor(totalDeci / 10);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const clock = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
    return `${clock}.${ds}`;
}
function formatPace(secPerKm) {
    if (!isFinite(secPerKm) || secPerKm <= 0) return "--:--";
    const totalSec = Math.round(secPerKm);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${pad2(s)}`;
}
function formatDate(ts) {
    const d = new Date(ts);
    return (
        d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " · " +
        d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    );
}

// ---------------- Lap math ----------------
// Laps only store lapTime. Everything else (cumulative time, pace) is
// derived here so there's a single source of truth for the math.
function computeLapStats(run) {
    let cumulativeTime = 0;
    return run.laps.map((lap) => {
        cumulativeTime += lap.lapTime;
        const pace = lap.lapTime / run.lapDistance;
        return { lapTime: lap.lapTime, cumulativeTime, pace };
    });
}

// ---------------- State ----------------
const state = {
    lapDistance: DEFAULT_LAP_DISTANCE_M,
    status: "idle", // idle | running | stopped
    currentRun: null,
    lastLapStart: null,
    rafId: null,
};

// ---------------- Elements ----------------
const els = {
    pageTitle: document.getElementById("page-title"),
    statusDot: document.getElementById("status-dot"),
    totalTime: document.getElementById("total-time"),
    clockIdle: document.getElementById("clock-idle"),
    clockRun: document.getElementById("clock-run"),
    startBtn: document.getElementById("start-btn"),
    lapsList: document.getElementById("laps-list"),
    controlsRunning: document.getElementById("controls-running"),
    controlsStopped: document.getElementById("controls-stopped"),
    lapBtn: document.getElementById("lap-btn"),
    stopBtn: document.getElementById("stop-btn"),
    resetBtn: document.getElementById("reset-btn"),
    runsEmpty: document.getElementById("runs-empty"),
    runsList: document.getElementById("runs-list"),
    lapDistanceInput: document.getElementById("lap-distance-input"),
    tabBtns: document.querySelectorAll(".tab-btn"),
    tabPanels: document.querySelectorAll(".tab-panel"),
};

const titles = { clock: "Clock", runs: "Runs" };

// ---------------- Tab switching ----------------
els.tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        els.tabBtns.forEach((b) => b.classList.toggle("active", b === btn));
        els.tabPanels.forEach((p) => p.classList.toggle("active", p.id === "tab-" + tab));
        els.pageTitle.textContent = titles[tab];
        if (tab === "runs") loadRuns();
    });
});

// ---------------- Clock logic ----------------
function showClockState() {
    if (state.status === "idle") {
        els.clockIdle.hidden = false;
        els.clockRun.classList.add("hidden");
        els.statusDot.classList.remove("live");
    } else {
        els.clockIdle.hidden = true;
        els.startBtn.hidden = true;
        els.clockRun.classList.remove("hidden");
        els.statusDot.classList.toggle("live", state.status === "running");
        els.controlsRunning.hidden = state.status !== "running";
        els.controlsStopped.hidden = state.status !== "stopped";
    }
}

function tick() {
    if (state.status !== "running" || !state.currentRun) return;
    const totalMs = Date.now() - state.currentRun.startTime;
    els.totalTime.textContent = formatClockMs(totalMs);
    state.rafId = requestAnimationFrame(tick);
}

function lapRowHTML(index, stat) {
    return `<li class="lap-row">
      <span class="lap-num">${index + 1}</span>
      <span class="lap-pace">${formatPace(stat.pace)}</span>
      <span class="lap-time">${formatTime(stat.lapTime)}</span>
      <span class="lap-cum">${formatTime(stat.cumulativeTime)}</span>
    </li>`;
}

function recordLap() {
    const now = Date.now();
    const lapTime = now - state.lastLapStart;
    state.currentRun.laps.push({ lapTime });
    state.lastLapStart = now;

    const stats = computeLapStats(state.currentRun);
    const lastIndex = stats.length - 1;
    els.lapsList.insertAdjacentHTML("afterbegin", lapRowHTML(lastIndex, stats[lastIndex]));
    return stats[lastIndex];
}

async function persistCurrentRun() {
    if (!state.currentRun) return;
    await saveRun(state.currentRun);
}

els.startBtn.addEventListener("click", async () => {
    const now = Date.now();
    state.currentRun = {
        id: crypto.randomUUID(),
        startTime: now,
        lapDistance: state.lapDistance,
        laps: [],
    };
    state.lastLapStart = now;
    state.status = "running";
    els.lapsList.innerHTML = "";
    els.totalTime.textContent = formatClockMs(0);
    showClockState();
    await persistCurrentRun();
    state.rafId = requestAnimationFrame(tick);
});

els.lapBtn.addEventListener("click", async () => {
    if (state.status !== "running") return;
    recordLap();
    await persistCurrentRun();
});

els.stopBtn.addEventListener("click", async () => {
    if (state.status !== "running") return;
    const finalStat = recordLap();
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
    state.status = "stopped";
    els.totalTime.textContent = formatClockMs(finalStat.cumulativeTime);
    showClockState();
    await persistCurrentRun();
});

els.resetBtn.addEventListener("click", () => {
    state.currentRun = null;
    state.lastLapStart = null;
    state.status = "idle";
    els.startBtn.hidden = false;
    els.lapsList.innerHTML = "";
    els.totalTime.textContent = formatClockMs(0);
    showClockState();
});

// ---------------- Runs tab ----------------
function runCardHTML(run) {
    const stats = computeLapStats(run);
    const lapCount = stats.length;
    const totalTimeMs = lapCount > 0 ? stats[lapCount - 1].cumulativeTime : 0;
    const avgPace = lapCount > 0 ? totalTimeMs / (lapCount * run.lapDistance) : 0;
    const lapsRows = stats.map((stat, i) => lapRowHTML(i, stat)).join("");
    return `<li class="run-card" data-id="${run.id}">
      <div class="run-card-head">
        <div class="rc-left">
          <span class="rc-date">${formatDate(run.startTime)}</span>
          <span class="rc-total">${formatTime(totalTimeMs)}</span>
        </div>
        <div class="rc-right">
          <span class="rc-avgpace">${formatPace(avgPace)} min/km avg</span>
          <span class="rc-laps">${lapCount} lap${lapCount === 1 ? "" : "s"} · ${run.lapDistance}m laps</span>
        </div>
        <svg class="chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="run-card-body">
        <div class="laps-header">
          <span>#</span><span>Min/km</span><span>Lap</span><span>Total</span>
        </div>
        <ul class="laps-list">${lapsRows}</ul>
      </div>
    </li>`;
}

async function loadRuns() {
    const runs = await loadAllRuns();
    if (runs.length === 0) {
        els.runsEmpty.classList.remove("hidden");
        els.runsList.innerHTML = "";
        return;
    }
    els.runsEmpty.classList.add("hidden");
    els.runsList.innerHTML = runs.map(runCardHTML).join("");
}

els.runsList.addEventListener("click", (e) => {
    const head = e.target.closest(".run-card-head");
    if (!head) return;
    head.closest(".run-card").classList.toggle("expanded");
});

// ---------------- Settings panel (per-run lap distance) ----------------
let savedMsgTimeout = null;
function initSettings() {
    state.lapDistance = loadLapDistanceSetting();
    els.lapDistanceInput.value = state.lapDistance;
}

els.lapDistanceInput.addEventListener("change", () => {
    let v = parseInt(els.lapDistanceInput.value, 10);
    if (!v || v < 1) v = DEFAULT_LAP_DISTANCE_M;
    els.lapDistanceInput.value = v;
    state.lapDistance = v;
    saveLapDistanceSetting(v);
});

// ---------------- Init ----------------
(async function init() {
    initSettings();
    await loadRuns();
    showClockState();
})();
