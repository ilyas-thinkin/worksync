// WorkSync line display — one line's Hourly Report, sized for a shop-floor TV.
//
// Polls every 10 seconds:
//   /api/display/line-status  server clock, work date, the day's stations and the line tiles
//   /api/hourly-report        the same per-worker grid the IE and admin panels show
//   /api/efficiency-report    line overall efficiency, only when the efficiency tile is set to it
// A line has far more workers than fit on one screen, so the worker list flips page by page.
// Auto-flip can be switched off to scroll the list by hand. Both settings sit in the footer
// and are remembered by this screen.
//
// Line output / Line achieved / Line efficiency add up whichever workstations someone picked on the
// tile itself (a + card until then). That choice is saved per line on the server
// (PUT /api/display/tiles), so every screen showing the line follows it.

const REFRESH_MS = 10000;
const REQUEST_TIMEOUT_MS = 8000;
const STALE_AFTER_MS = 30000;
const OFFLINE_AFTER_MS = 120000;
// A refresh still in flight after this long is written off and a new one is started. When the
// TV's PC suspends mid-request the fetch can come back never settling, and its abort timer was
// suspended with it — leaving the in-flight flag set for good. The interval kept firing, hit the
// flag and returned without asking for anything, so the board froze until someone reloaded it.
const REFRESH_WEDGED_MS = 30000;
// The board never reloads itself. On an old LAN name (https://worksync) the certificate is
// self-signed, so a fresh page load stops on the browser's "not private" warning, which has no
// script to retry from and waits for a person to click through. Instead, while the server is
// still answering, the board moves itself to the public name that has a trusted certificate.
const PUBLIC_HOST_RETRY_MS = 600000;
const CURSOR_IDLE_MS = 3000;
const ROW_HEIGHT_REM = 2.9;
// One line's summary row on the All lines view, spacing included (the gap is padding inside the row),
// so the rows that fit on a page follow from it the same way the worker rows do from ROW_HEIGHT_REM.
const OV_ROW_HEIGHT_REM = 8.9;

const FLIP_SECONDS_MIN = 5;
const FLIP_SECONDS_MAX = 60;
const FLIP_SECONDS_STEP = 2;
const FLIP_SECONDS_DEFAULT = 15;

const LAST_LINE_KEY = 'worksync_display_line';
const AUTOFLIP_KEY = 'worksync_display_autoflip';
const FLIP_SECONDS_KEY = 'worksync_display_flip_seconds';

const params = new URLSearchParams(window.location.search);
const lineId = parseInt(params.get('line') || '', 10);
// The All lines view: every line's summary row, opened from the "All lines" card on the Lines page.
const isOverview = !Number.isFinite(lineId) && params.has('overview');
// Remembered in place of a line id, so a TV that was showing the All lines view comes back to it.
const OVERVIEW_SETTING = 'overview';

const state = {
    status: null,
    overview: null,
    overviewEff: new Map(),
    timeZone: null,
    report: null,
    efficiency: null,
    lastSuccessAt: 0,
    lastError: null,
    refreshing: false,
    refreshStartedAt: 0,
    clockOffsetMs: 0,
    autoFlip: readSetting(AUTOFLIP_KEY) !== '0',
    flipSeconds: clampFlipSeconds(readSetting(FLIP_SECONDS_KEY)) ?? FLIP_SECONDS_DEFAULT,
    pageIndex: 0,
    pageCount: 1,
    perPage: 1,
    pageStartedAt: Date.now()
};

const $ = (id) => document.getElementById(id);
// The board and the All lines view each carry their own clock, live status and flip footer; the All
// lines view's copies are the same ids with an "ov-" prefix, so the shared code asks for them by name.
const v = (id) => $(isOverview ? `ov-${id}` : id);

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function pct(value) {
    return value == null ? '–' : `${value.toFixed(1)}%`;
}

// Mirrors normalizeWsCode on the server: "WS01" and "W01" are the same station.
function wsKey(code) {
    const match = /(\d+)$/.exec(String(code || ''));
    return match ? String(parseInt(match[1], 10)) : String(code || '').toUpperCase().trim();
}

// Same colour bands as the IE Hourly Report, judged on the one-decimal figure that is shown.
function effClass(eff) {
    if (eff == null) return 'muted';
    const shown = Math.round(eff * 10) / 10;
    return shown >= 90 ? 'good' : shown >= 80 ? 'warn' : 'bad';
}

function achievedClass(value) {
    if (value == null) return 'muted';
    return value >= 100 ? 'good' : value >= 90 ? 'warn' : 'bad';
}

// "1st hour (08:00-09:00)" -> "08:00–09:00"
function timeRange(label) {
    const match = /\((\d{1,2}:\d{2})-(\d{1,2}:\d{2})\)/.exec(label || '');
    return match ? `${match[1]}–${match[2]}` : '';
}

// Formats in the server's time zone, so a TV PC set to the wrong zone still shows factory time.
function formatClock(ms, options) {
    const timeZone = state.timeZone;
    const date = new Date(ms);
    try {
        return date.toLocaleString('en-GB', timeZone ? { ...options, timeZone } : options);
    } catch (_) {
        return date.toLocaleString('en-GB', options);
    }
}

function readSetting(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
}

function writeSetting(key, value) {
    try { window.localStorage.setItem(key, String(value)); } catch (_) { /* storage blocked */ }
}

// Whole seconds inside the allowed range; null for anything unreadable. Not snapped to the
// −/+ step, so the default 15 goes 13/17 and a value saved under an older step is kept.
function clampFlipSeconds(value) {
    const seconds = parseInt(value, 10);
    if (!Number.isFinite(seconds)) return null;
    return Math.min(FLIP_SECONDS_MAX, Math.max(FLIP_SECONDS_MIN, seconds));
}

async function requestJson(url, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, { ...init, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        movePublicHostSoon(response.headers.get('X-WorkSync-Public-Host'));
        if (response.status === 401) {
            const err = new Error('Signed out');
            err.status = 401;
            throw err;
        }
        const body = await response.json().catch(() => null);
        if (!response.ok || !body || !body.success) {
            throw new Error((body && body.error) || `Server returned ${response.status}`);
        }
        return body;
    } catch (err) {
        if (err.name === 'AbortError') throw new Error('Server did not answer in time');
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

function getJson(url) {
    return requestJson(url);
}

function sendJson(url, method, body) {
    return requestJson(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// The server names the public address on every API reply while this page sits on an old LAN name.
// Move while the connection is known to work; a device that cannot reach the public name stays
// here and asks again in ten minutes.
let publicHostTriedAt = 0;
async function movePublicHostSoon(host) {
    if (!host || typeof window.moveToPublicHost !== 'function') return;
    if (Date.now() - publicHostTriedAt < PUBLIC_HOST_RETRY_MS) return;
    publicHostTriedAt = Date.now();
    try {
        const response = await fetch('/auth/handoff/start', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
        const body = await response.json();
        if (!body.success) return;
        await window.moveToPublicHost({ host, token: body.token, next: window.location.pathname + window.location.search });
    } catch (_) {
        /* stay here; retried after PUBLIC_HOST_RETRY_MS */
    }
}

// ── Line picker ─────────────────────────────────────────────────────────

// A picker card carries the supervisor's face so the right screen is picked from a distance,
// falling back to initials and then to a neutral placeholder. Same rules as the board header,
// but self-contained per card: the picker is rendered once, not re-rendered every 10s.
function pickerAvatar(line) {
    const name = line.line_leader || '';
    // Two supervisors: the circle splits down the middle, one face each side. A photo that fails
    // there just leaves its half on the neutral background.
    if (line.line_leader_photo && line.line_leader_photo_2) {
        return [line.line_leader_photo, line.line_leader_photo_2]
            .map((photo) => `<img class="picker-photo picker-half" src="${esc(photo)}" alt="${esc(name) || 'Line supervisor'}">`)
            .join('');
    }
    const photo = line.line_leader_photo || line.line_leader_photo_2 || '';
    const initials = leaderInitials(name);
    // Real initials get the accent; the placeholder dash for a line with no supervisor is
    // dimmed, so an unassigned line reads as empty rather than as something to look at.
    const fallback = `<span class="picker-initials${initials ? '' : ' is-empty'}"${photo ? ' hidden' : ''}>`
        + `${esc(initials) || '—'}</span>`;
    if (!photo) return fallback;
    return `<img class="picker-photo" src="${esc(photo)}" alt="${esc(name) || 'Line supervisor'}">${fallback}`;
}

async function showPicker() {
    $('picker').hidden = false;
    const grid = $('picker-grid');
    try {
        const { data } = await getJson('/api/display/lines');
        const last = readSetting(LAST_LINE_KEY);
        const summaryCard = `
            <a class="picker-line picker-summary${last === OVERVIEW_SETTING ? ' is-last' : ''}" href="/display?overview=1">
                <span class="picker-avatar" aria-hidden="true">
                    <svg class="picker-rows-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <path stroke-linecap="round" d="M4 6h16M4 12h16M4 18h16"/>
                    </svg>
                </span>
                <span class="picker-text">
                    <span class="picker-code">All lines</span>
                    <span class="picker-name">Summary of every line, one row each</span>
                </span>
            </a>`;
        grid.innerHTML = data.length
            ? summaryCard + data.map((line) => `
                <a class="picker-line${String(line.id) === last ? ' is-last' : ''}" href="/display?line=${encodeURIComponent(line.id)}">
                    <span class="picker-avatar">${pickerAvatar(line)}</span>
                    <span class="picker-text">
                        <span class="picker-code">${esc(line.line_code)}</span>
                        <span class="picker-name">${esc(line.line_name)}</span>
                        ${line.line_leader ? `<span class="picker-leader">${esc(line.line_leader)}</span>` : ''}
                    </span>
                </a>`).join('')
            : '<p class="picker-hint">No active lines.</p>';
        // A photo whose file went missing must not leave a broken-image icon on a screen
        // nobody is standing at — swap that one card to its initials and leave the rest alone.
        grid.querySelectorAll('img.picker-photo:not(.picker-half)').forEach((img) => {
            img.addEventListener('error', () => {
                img.hidden = true;
                const initials = img.nextElementSibling;
                if (initials) initials.hidden = false;
            });
        });
    } catch (err) {
        if (err.status === 401) {
            window.location.href = '/';
            return;
        }
        grid.innerHTML = `<p class="picker-hint bad">Could not load lines (${esc(err.message)}). Retrying…</p>`;
        setTimeout(showPicker, REFRESH_MS);
    }
}

function openPicker() {
    window.location.href = '/display?pick=1';
}

// ── Data ────────────────────────────────────────────────────────────────

// Bumped for every attempt, so a wedged request that finally settles long after it was written
// off cannot clobber the state or repaint the board with data that is now older than what is up.
let refreshSeq = 0;

// { force: true } — after a tile is saved — writes off a poll already in flight, since that one may
// have read the old selection. Event listeners call this with an Event, which never carries it.
async function refresh(options) {
    const force = !!(options && options.force === true);
    // The guard stops overlapping polls, but only until the running one is plainly stuck.
    if (!force && state.refreshing && Date.now() - state.refreshStartedAt < REFRESH_WEDGED_MS) return;
    const seq = ++refreshSeq;
    state.refreshing = true;
    state.refreshStartedAt = Date.now();
    try {
        const { data: status } = await getJson(`/api/display/line-status?line_id=${lineId}`);
        // The work date rolled over while the TV was on: start the new day's pages from the top.
        if (state.status && status.date !== state.status.date) {
            state.pageIndex = 0;
            state.pageStartedAt = Date.now();
        }
        const query = `line_id=${lineId}&date=${encodeURIComponent(status.date)}`;
        // Only an efficiency tile set to the whole line needs the Efficiency Report.
        const needsLineEfficiency = !!(status.tiles && status.tiles.efficiency && status.tiles.efficiency.line_overall);
        const [report, efficiency] = await Promise.all([
            getJson(`/api/hourly-report?${query}`),
            needsLineEfficiency && status.last_completed_hour != null
                // The line efficiency tile is secondary; its failure must not blank the board.
                ? getJson(`/api/efficiency-report?${query}&hour=${status.last_completed_hour}`).catch(() => null)
                : null
        ]);
        if (seq !== refreshSeq) return; // written off as wedged; a newer attempt owns the board
        state.status = status;
        state.timeZone = status.time_zone;
        state.report = report.data;
        state.efficiency = efficiency ? efficiency.data : null;
        state.clockOffsetMs = Date.parse(status.server_time) - Date.now();
        state.lastSuccessAt = Date.now();
        state.lastError = null;
        render();
    } catch (err) {
        if (err.status === 401) {
            window.location.href = '/';
            return;
        }
        if (seq !== refreshSeq) return;
        state.lastError = err.message;
    } finally {
        if (seq === refreshSeq) {
            state.refreshing = false;
            renderLiveStatus();
        }
    }
}

// ── Rendering ───────────────────────────────────────────────────────────

function render() {
    renderHeader();
    renderSummary();
    renderWorkers();
}

// The supervisor's name and photo both come from Line Management and are both optional.
// A photo that 404s (file removed behind the board's back) falls back to the initials
// rather than leaving a broken image on a screen nobody is standing at.
function leaderInitials(name) {
    const parts = String(name || '').replace(/[^A-Za-z ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// "B5 - RUMIYA" → "B5". The supervisor's own name sits directly above it on the card, so
// repeating it in the code would say the same thing twice. A code with no dash is left alone.
function shortLineCode(code) {
    const text = String(code || '').trim();
    const dash = text.indexOf('-');
    return (dash > 0 ? text.slice(0, dash) : text).trim();
}

// A line run by two supervisors has a second photo (line_leader_photo_2); both names are in
// line_leader already ("RUMIYA / HASEENA"). Each photo follows the same rules on its own, and
// whichever loads is shown — the card turns to the pair layout only when both are up.
function renderSupervisor(line) {
    const initials = $('sup-initials');
    const name = line.line_leader || '';

    // This card is now the only place the board names its line, so it always shows — even for a
    // line with no supervisor set, where it falls back to the line code alone.
    $('sup-line').textContent = shortLineCode(line.line_code) || `Line ${line.id}`;
    $('sup-name').textContent = name;
    $('sup-name').hidden = !name;
    $('sup-label').hidden = !name;

    const showing = [
        showSupervisorPhoto($('sup-photo'), line.line_leader_photo || '', name, line),
        showSupervisorPhoto($('sup-photo-2'), line.line_leader_photo_2 || '', name, line)
    ].filter(Boolean).length;
    $('sup-block').classList.toggle('is-pair', showing === 2);
    initials.hidden = showing > 0;
    if (!showing) initials.textContent = leaderInitials(name) || '—';
}

// Returns whether this photo is on screen. A path that already failed to load stays failed until the
// photo is replaced — the board re-renders every 10s and must not flip back to a broken image each time.
function showSupervisorPhoto(photo, photoPath, name, line) {
    if (!photoPath || photo.dataset.failedSrc === photoPath) {
        photo.hidden = true;
        return false;
    }
    // Only swap the src when it actually changed — reassigning it every refresh
    // would restart the image load on every poll.
    if (photo.getAttribute('src') !== photoPath) {
        photo.onerror = () => {
            photo.dataset.failedSrc = photoPath;
            renderSupervisor(line);
        };
        photo.setAttribute('src', photoPath);
        photo.alt = name || 'Line supervisor';
    }
    photo.hidden = false;
    return true;
}

function renderHeader() {
    const { line, plan, rows, is_locked: isLocked, is_closed: isClosed } = state.report;
    // The line is named once, on the supervisor card — see renderSupervisor. The style running and
    // the shift meta sit on the style card next to it; the header keeps only the clock.
    document.title = `${line.line_code || 'Line'} · WorkSync Display`;
    renderSupervisor(line);

    $('plan-product').innerHTML = planProductHtml(plan);
    $('plan-meta').innerHTML = planMetaHtml(plan, rows.filter((row) => !row.ot_only).length, isLocked, isClosed);
}

// Code and name on separate lines: the style card is narrow, and the code is what people look for.
function planProductHtml(plan) {
    return plan.product_code
        ? `<div class="plan-code">${esc(plan.product_code)}`
            + (plan.incoming_product_code
                ? ` <span class="tag tag-co">CO</span> ${esc(plan.incoming_product_code)}`
                : '')
            + `</div><div class="plan-name">${esc(plan.product_name || '')}</div>`
        : '<span class="bad">No plan for today</span>';
}

function planMetaHtml(plan, workerCount, isLocked, isClosed) {
    const meta = [];
    if (plan.in_time && plan.out_time) meta.push(`Shift ${esc(plan.in_time)}–${esc(plan.out_time)}`);
    meta.push(`${workerCount} workers`);
    if (isLocked) meta.push('<span class="tag tag-warn">DAY LOCKED</span>');
    if (isClosed) meta.push('<span class="tag tag-bad">LINE CLOSED</span>');
    // Each item stays whole; the card is narrow, so the line wraps at the dots instead of inside "08:00–17:00".
    return meta.map((item) => `<span class="meta-item">${item}</span>`).join(' <span class="sep">·</span> ');
}

// A long figure — "100.0%", a four-figure target, a signed backlog — does not fit a card at the full
// size, and the value never wraps. It steps down one size for each glyph past three, which keeps every
// figure whole inside its card and lets the five cards stay narrow enough for the supervisor's name.
function valueClass(value) {
    const len = String(value).length;
    return len >= 6 ? 'len-6' : len === 5 ? 'len-5' : len === 4 ? 'len-4' : '';
}

function kpi(label, value, sub, cls = '') {
    return `<div class="kpi">
        <div class="kpi-label">${esc(label)}</div>
        <div class="kpi-value ${cls} ${valueClass(value)}">${esc(value)}</div>
        <div class="kpi-sub">${esc(sub)}</div>
    </div>`;
}

// The three line tiles, the picker's wording for each, and what their cards say.
const TILES = {
    output: {
        label: 'Line output',
        hint: 'One workstation shows its own output. Tick several and their outputs are added together. A workstation in SCO asks which style\'s pieces to count.'
    },
    achieved: {
        label: 'Line achieved',
        hint: 'Output against target till now. Tick several and their outputs and their targets are added together.'
    },
    efficiency: {
        label: 'Line efficiency',
        hint: 'One workstation shows its own efficiency. Tick several and they are pooled into one figure — or show the whole line instead.'
    }
};

// A tile nobody has set up yet: an empty card asking for its workstations. After the line moved to a
// new style the old choice no longer applies (station 80 is a different operation now), so it says so.
function emptyTile(tile, styleChanged) {
    return `<button class="kpi kpi-pick is-empty" type="button" data-tile="${tile}">
        <div class="kpi-label">${esc(TILES[tile].label)}</div>
        <div class="kpi-plus" aria-hidden="true">+</div>
        <div class="kpi-sub">${styleChanged ? 'New style · choose again' : 'Choose workstations'}</div>
    </button>`;
}

function pickedTile(tile, value, sub, cls = '') {
    return `<button class="kpi kpi-pick" type="button" data-tile="${tile}" title="Change the workstations this card adds up">
        <div class="kpi-label">${esc(TILES[tile].label)}</div>
        <div class="kpi-value ${cls} ${valueClass(value)}">${esc(value)}</div>
        <div class="kpi-sub">${esc(sub)}</div>
    </button>`;
}

// The SCO side a Line output station counts, as the picker asked it (station_sources, null when not in SCO).
const SCO_SOURCE_LABELS = { primary: 'Primary', co: 'SCO', both: 'Both' };

function stationList(summary) {
    const sources = summary.station_sources || [];
    return summary.station_codes
        .map((code, i) => (sources[i] ? `${code} · ${SCO_SOURCE_LABELS[sources[i]] || ''}` : code))
        .join(' + ');
}

// Backlog: the pieces the line is short RIGHT NOW — the Line output card's pieces against what THOSE SAME
// STATIONS should have finished by the last completed hour. Both sides come from the one selection, which is
// what the user asked for (2026-09-25): the card follows the workstations picked for Line output and is
// calculated from those alone. The bar is the tile's own `required`, which the server already sums as the
// picked stations' hourly target × finished hours, by the same rule as the Hourly Report's Tgt column — so it
// needs no pro-rating here and a changeover day's two hourly targets are handled per station.
//
// It therefore always agrees with "Line achieved" beside it: the same comparison, pieces instead of a
// percentage. Note this inherits `hourlyTargetFor`'s quirk — a picked station with no custom takt is given the
// WHOLE line's hourly target, so picking two of those doubles the bar (A1/A5/B4 read 94/h against a 63/h line
// on 2026-09-25). That is a takt-data problem on those lines, not something this card works around.
// Derived rather than picked, so it stays "–" until the output card has its stations.
function backlogTile(output, hoursCounted) {
    if (!output) return kpi('Backlog', '–', 'set Line output first', 'muted');
    if (!hoursCounted) return kpi('Backlog', '–', 'no hour finished yet', 'muted');
    const required = num(output.required) || 0;
    if (required <= 0) return kpi('Backlog', '–', 'no target today', 'muted');
    const gap = (num(output.output) || 0) - required;
    // Signed the way the floor writes it: short reads as a negative number, so −17 is 17 behind by now.
    return kpi(
        'Backlog',
        gap < 0 ? `−${Math.abs(gap)}` : gap > 0 ? `+${gap}` : '0',
        `of ${required} · ${hoursCounted} h`,
        gap < 0 ? 'bad' : 'good'
    );
}

// Day target is the plan's. The three picked cards add up the workstations chosen on each — one station
// is its own figure, several add their outputs and targets, and efficiency pools them (the server does
// the sums; see summarizeDisplaySelection). Line overall efficiency comes from the Efficiency Report.
// Backlog is worked out here from the output card alone: its pieces less its own target for the finished hours.
function renderSummary() {
    const tiles = state.status.tiles || {};
    const reportSummary = state.efficiency && state.efficiency.summary;
    const lineOverallEff = reportSummary ? num(reportSummary.live_efficiency_pct) : null;
    $('kpis').innerHTML = summaryTilesHtml(state.report.plan, tiles, state.status.hours_counted, lineOverallEff, true);
}

// The five summary cards, shared by the board and the All lines view. On the board the three line tiles
// are buttons that open the workstation picker; on the All lines view they are plain cards (pickable
// false) — choosing stations belongs to the line's own board, where the station list is in hand.
// lineOverallEff is the Efficiency Report's figure, used only when the efficiency tile is set to it.
function summaryTilesHtml(plan, tiles, hoursCounted, lineOverallEff, pickable) {
    const styleChanged = !!tiles.style_changed;
    const picked = pickable
        ? pickedTile
        : (tile, value, sub, cls = '') => kpi(TILES[tile].label, value, sub, cls);
    const empty = pickable
        ? emptyTile
        : (tile) => kpi(TILES[tile].label, '–', styleChanged ? 'New style · not chosen' : 'Not set up', 'muted');

    const output = tiles.output;
    const achieved = tiles.achieved;
    const required = achieved ? num(achieved.required) || 0 : 0;
    const achievedPct = achieved && required > 0 ? Math.round((num(achieved.output) / required) * 100) : null;
    const efficiency = tiles.efficiency;
    const lineEff = efficiency && efficiency.line_overall
        ? lineOverallEff
        : (efficiency ? num(efficiency.efficiency_percent) : null);

    return [
        // "0 per hour" reads like a real, very bad target. When no target is planned at all, say so —
        // that is also what makes the "–" in every Tgt column self-explanatory rather than a glitch.
        kpi('Day target', plan.target_units || '–',
            plan.incoming_target_units
                ? `CO target ${plan.incoming_target_units}`
                : (plan.line_hourly_target ? `${plan.line_hourly_target} per hour` : 'no target set for today')),
        output
            ? picked('output', num(output.output) || 0, stationList(output))
            : empty('output', styleChanged),
        backlogTile(output, hoursCounted),
        achieved
            ? picked('achieved', achievedPct == null ? '–' : `${achievedPct}%`,
                required > 0 ? `${num(achieved.output) || 0} of ${required} · ${stationList(achieved)}` : `no target yet · ${stationList(achieved)}`,
                achievedClass(achievedPct))
            : empty('achieved', styleChanged),
        efficiency
            ? picked('efficiency', pct(lineEff), efficiency.line_overall ? 'Whole line' : stationList(efficiency), effClass(lineEff))
            : empty('efficiency', styleChanged)
    ].join('');
}

function renderWorkers() {
    if (!state.report) return;
    const { hours, rows, has_ot: hasOt, is_today: isToday } = state.report;
    // One column per OT hour. A day with only whole-OT totals (entered before OT went per hour)
    // has no OT hours and keeps a single OT column.
    const otHours = hasOt ? (state.report.ot_hours || []) : [];
    const workers = $('workers');
    const table = $('worker-table');
    const message = $('board-message');
    workers.classList.toggle('is-manual', !state.autoFlip);
    if (!rows.length) {
        table.hidden = true;
        message.hidden = false;
        message.textContent = 'No workers on this line yet today.';
        state.pageCount = 1;
        renderPageInfo();
        return;
    }
    table.hidden = false;
    message.hidden = true;

    const currentHour = isToday ? state.status.clock_hour : null;
    renderWorkerHead(hours, hasOt, otHours, currentHour);

    let start = 0;
    let shown = rows;
    if (state.autoFlip) {
        // Paged: only this page's rows are drawn, so nothing is ever scrolled out of view.
        workers.scrollTop = 0;
        state.perPage = rowsPerPage();
        state.pageCount = Math.max(1, Math.ceil(rows.length / state.perPage));
        if (state.pageIndex >= state.pageCount) state.pageIndex = 0;
        start = state.pageIndex * state.perPage;
        shown = rows.slice(start, start + state.perPage);
    } else {
        state.pageCount = 1;
    }

    // A 10-second refresh must not throw a hand-scrolled list back to the top.
    const scrollTop = workers.scrollTop;
    $('worker-body').innerHTML = shown
        .map((row, i) => workerRow(row, start + i, hours, hasOt, otHours, currentHour))
        .join('');
    if (!state.autoFlip) workers.scrollTop = scrollTop;
    renderPageInfo();
}

// The list that pages or scrolls: the board's worker table (under its pinned header), or the All lines
// view's summary rows. Both have fixed-height rows, which the page size and scroll maths rely on.
function listParts() {
    return isOverview
        ? { box: $('ov-rows'), rows: $('ov-rows').children, headPx: 0, rowRem: OV_ROW_HEIGHT_REM,
            total: state.overview ? state.overview.lines.length : 0, noun: 'Lines', one: 'line', many: 'lines' }
        : { box: $('workers'), rows: $('worker-body').rows, headPx: $('worker-head').offsetHeight, rowRem: ROW_HEIGHT_REM,
            total: state.report ? state.report.rows.length : 0, noun: 'Workers', one: 'worker', many: 'workers' };
}

function renderList() {
    if (isOverview) renderOverview();
    else renderWorkers();
}

// Rows have a fixed height, so the page size follows from the space left under the header.
function rowsPerPage() {
    const { box, headPx, rowRem } = listParts();
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const available = box.clientHeight - headPx - 2;
    return Math.max(1, Math.floor(available / (rowRem * rootPx)));
}

// First and last row (1-based) showing under the pinned header while scrolling by hand.
function visibleRows() {
    const { box, rows, headPx } = listParts();
    const total = rows.length;
    const rowPx = total ? rows[0].offsetHeight : 0;
    if (!rowPx) return { first: 0, last: 0 };
    const first = Math.min(total, Math.floor(box.scrollTop / rowPx) + 1);
    const last = Math.min(total, Math.floor((box.scrollTop + box.clientHeight - headPx) / rowPx));
    return { first, last: Math.max(first, last) };
}

function scrollToRow(index) {
    const { box, rows, headPx } = listParts();
    const row = rows[index];
    if (row) box.scrollTop = row.offsetTop - headPx;
}

function renderPageInfo() {
    const info = v('page-info');
    const bar = v('page-progress-bar');
    const { box: list, total, noun, one, many } = listParts();
    const count = `${total} ${total === 1 ? one : many}`;
    if (!total) {
        info.textContent = '';
        bar.style.width = '0%';
        return;
    }
    if (state.autoFlip) {
        const start = state.pageIndex * state.perPage;
        const end = Math.min(total, start + state.perPage);
        info.textContent = state.pageCount > 1
            ? `${noun} ${start + 1}–${end} of ${total} · Page ${state.pageIndex + 1} of ${state.pageCount}`
            : count;
        return; // while flipping, the bar is the countdown to the next page (advancePage)
    }
    const scrollable = list.scrollHeight - list.clientHeight;
    if (scrollable <= 0) {
        info.textContent = count;
        bar.style.width = '0%';
        return;
    }
    const { first, last } = visibleRows();
    info.textContent = `${noun} ${first}–${last} of ${total} · scroll for more`;
    bar.style.width = `${(list.scrollTop / scrollable) * 100}%`;
}

function renderWorkerHead(hours, hasOt, otHours, currentHour) {
    $('worker-cols').innerHTML = [
        '<col class="col-ws">',
        '<col class="col-worker">',
        '<col class="col-tgt">',
        ...hours.map(() => '<col class="col-hour">'),
        ...(hasOt ? (otHours.length ? otHours : [null]).map(() => '<col class="col-hour">') : []),
        '<col class="col-day">',
        '<col class="col-day">',
        '<col class="col-day-eff">',
        '<col>'
    ].join('');

    $('worker-head').innerHTML = `<tr>
        <th>WS</th>
        <th class="left">Worker</th>
        <th>Tgt<small>per hour</small></th>
        ${hours.map((hour) => `<th class="${hour.hour_slot === currentHour ? 'is-current' : ''}">${esc(hour.ordinal)}<small>${esc(timeRange(hour.label))}</small></th>`).join('')}
        ${hasOt ? (otHours.length
            ? otHours.map((h) => `<th class="th-ot${h.hour_slot === currentHour ? ' is-current' : ''}">${esc(h.label)}<small>${esc(h.range)}</small></th>`).join('')
            : '<th class="th-ot">OT<small>whole day</small></th>') : ''}
        <th>Live<small>target</small></th>
        <th>Live<small>output</small></th>
        <th>Live<small>efficiency</small></th>
        <th class="left">Downfall reason</th>
    </tr>`;
}

// One hour's cell, following the IE report's rules: "·" not reached, "–" nothing entered,
// "n/a" after the worker left. Output is green at/above target, red with ▼ below it.
function hourCell(cell, hour, departedAfter, isCurrent) {
    const current = isCurrent ? ' is-current' : '';
    if (!hour.reached) return `<td class="c-hour pending${current}">·</td>`;
    if (departedAfter) return `<td class="c-hour${current}"><span class="tag tag-bad">n/a</span></td>`;
    if (!cell || !cell.entered) return `<td class="c-hour${current}"><span class="muted">–</span></td>`;

    const output = num(cell.output) || 0;
    const target = num(cell.target) || 0;
    const below = target > 0 && output < target;
    const outCls = target > 0 ? (below ? 'bad' : 'good') : '';
    const eff = num(cell.efficiency_percent) ?? 0;
    return `<td class="c-hour${current}${cell.is_changeover ? ' is-co' : ''}">
        <div class="h-out ${outCls}">${below ? '<span class="mark">▼</span>' : ''}${output}</div>
        <div class="h-eff ${effClass(eff)}">${pct(eff)}</div>
    </td>`;
}

// One OT hour, coloured against that hour's target like a regular hour. A worker whose OT was
// entered as one whole-OT total shows it in the first OT column, marked "whole OT".
function otHourCell(ot, hour, isFirst, isCurrent) {
    const current = isCurrent ? ' is-current' : '';
    // No OT enabled for this worker: zero, not a missed entry.
    if (ot && ot.enabled === false) return `<td class="c-hour c-ot${current}"><span class="muted">0</span></td>`;
    const cell = ot?.hours?.[hour.hour_slot];
    if (!cell && isFirst && ot?.unsplit) {
        const eff = num(ot.efficiency_percent);
        return `<td class="c-hour c-ot${current}">
            <div class="h-out">${num(ot.output) || 0}</div>
            <div class="h-eff ${effClass(eff)}">${pct(eff)} <small class="muted">whole OT</small></div>
        </td>`;
    }
    if (!hour.reached && !cell?.entered) return `<td class="c-hour c-ot pending${current}">·</td>`;
    if (!cell || !cell.entered) return `<td class="c-hour c-ot${current}"><span class="muted">–</span></td>`;
    const output = num(cell.output) || 0;
    const target = num(cell.target) || 0;
    const below = target > 0 && output < target;
    const outCls = target > 0 ? (below ? 'bad' : 'good') : '';
    const eff = num(cell.efficiency_percent) ?? 0;
    return `<td class="c-hour c-ot${current}">
        <div class="h-out ${outCls}">${below ? '<span class="mark">▼</span>' : ''}${output}</div>
        <div class="h-eff ${effClass(eff)}">${pct(eff)}</div>
    </td>`;
}

function otCell(ot) {
    if (!ot) return '<td class="c-hour c-ot"><span class="muted">–</span></td>';
    if (ot.enabled === false) return '<td class="c-hour c-ot"><span class="muted">0</span></td>';
    const eff = num(ot.efficiency_percent);
    return `<td class="c-hour c-ot">
        <div class="h-out">${num(ot.output) || 0}</div>
        <div class="h-eff ${effClass(eff)}">${pct(eff)}</div>
    </td>`;
}

function workerRow(row, index, hours, hasOt, otHours, currentHour) {
    const cum = row.cumulative || {};
    const badges = [
        row.is_changeover ? '<span class="tag tag-co">CO</span>' : '',
        row.departed ? '<span class="tag tag-bad">DEP</span>' : '',
        row.ot_only ? '<span class="tag tag-ot">OT ONLY</span>' : ''
    ].join('');
    const hourCells = hours.map((hour) => {
        const departedAfter = row.departed && row.departure_hour != null && hour.hour_slot > row.departure_hour;
        return hourCell(row.hours[hour.hour_slot], hour, departedAfter, hour.hour_slot === currentHour);
    }).join('');

    const dayTarget = num(cum.target) || 0;
    const dayOutput = num(cum.output) || 0;
    const dayBelow = dayTarget > 0 && dayOutput < dayTarget;
    const dayEff = num(cum.efficiency_percent);
    const reason = esc(cum.reason || '');
    const processes = (state.status.workstation_processes || {})[wsKey(row.workstation_code)] || '';

    return `<tr class="${index % 2 ? 'odd' : ''}">
        <td class="c-ws">${esc(row.workstation_code || '–')}${row.moved_mid_day ? '<span class="moved">⇄</span>' : ''}</td>
        <td class="c-worker">
            <div class="w-name">${esc(row.emp_name || '–')}${badges}<span class="w-id">${esc(row.emp_code || '–')}</span></div>
            <div class="w-process">${esc(processes) || '<span class="muted">–</span>'}</div>
        </td>
        <td class="c-num c-tgt">${row.hourly_target || '–'}</td>
        ${hourCells}
        ${hasOt ? (otHours.length
            ? otHours.map((h, i) => otHourCell(row.ot, h, i === 0, h.hour_slot === currentHour)).join('')
            : otCell(row.ot)) : ''}
        <td class="c-num c-day">${dayTarget || '–'}</td>
        <td class="c-num c-day strong ${dayTarget > 0 ? (dayBelow ? 'bad' : 'good') : ''}">${dayOutput}</td>
        <td class="c-num c-day strong ${effClass(dayEff)}">${pct(dayEff)}</td>
        <td class="c-reason"><div class="reason">${reason || '<span class="muted">–</span>'}</div></td>
    </tr>`;
}

function renderLiveStatus() {
    const el = v('live-status');
    if (!state.lastSuccessAt) {
        el.className = 'live-status warn';
        el.textContent = state.lastError ? `Connecting · ${state.lastError}` : 'Connecting…';
        return;
    }
    const age = Date.now() - state.lastSuccessAt;
    const at = formatClock(state.lastSuccessAt + state.clockOffsetMs, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    // Dim the numbers once they are clearly old, so nobody on the floor trusts a frozen board.
    $(isOverview ? 'overview' : 'board').classList.toggle('is-stale', age > OFFLINE_AFTER_MS);
    if (age > OFFLINE_AFTER_MS) {
        el.className = 'live-status bad';
        el.textContent = `Offline · last update ${at}`;
    } else if (age > STALE_AFTER_MS) {
        el.className = 'live-status warn';
        el.textContent = `Reconnecting · last update ${at}`;
    } else {
        el.className = 'live-status good';
        el.textContent = `Live · updated ${at}`;
    }
}

// ── Page flipping and manual scrolling ──────────────────────────────────

function renderFlipControls() {
    v('autoflip-toggle').setAttribute('aria-checked', String(state.autoFlip));
    v('autoflip-state').textContent = state.autoFlip ? 'On' : 'Off';
    v('flip-seconds').textContent = `${state.flipSeconds} s`;
    v('flip-less').disabled = state.flipSeconds <= FLIP_SECONDS_MIN;
    v('flip-more').disabled = state.flipSeconds >= FLIP_SECONDS_MAX;
    v('flip-time').classList.toggle('is-off', !state.autoFlip);
}

// Switching keeps the same rows on screen: the page's first row becomes the top of the
// scrolled list, and the row at the top of the scrolled list picks the page to flip from.
function setAutoFlip(enabled) {
    if (enabled === state.autoFlip) return;
    const firstRow = enabled ? Math.max(0, visibleRows().first - 1) : state.pageIndex * state.perPage;
    state.autoFlip = enabled;
    writeSetting(AUTOFLIP_KEY, enabled ? '1' : '0');
    state.pageStartedAt = Date.now();
    v('page-progress-bar').style.width = '0%';
    if (enabled) state.pageIndex = Math.floor(firstRow / rowsPerPage());
    renderList();
    if (!enabled) scrollToRow(firstRow);
    renderFlipControls();
}

function setFlipSeconds(value) {
    const seconds = clampFlipSeconds(value);
    if (seconds == null) return;
    state.flipSeconds = seconds;
    writeSetting(FLIP_SECONDS_KEY, seconds);
    state.pageStartedAt = Date.now(); // restart this page's countdown at the new length
    renderFlipControls();
}

function showPage(index) {
    state.pageIndex = ((index % state.pageCount) + state.pageCount) % state.pageCount;
    state.pageStartedAt = Date.now();
    v('page-progress-bar').style.width = '0%';
    renderList();
}

function advancePage() {
    if (!state.autoFlip) return; // the bar shows the scroll position instead
    if (state.pageCount <= 1) {
        state.pageStartedAt = Date.now();
        v('page-progress-bar').style.width = '0%';
        return;
    }
    const elapsed = Date.now() - state.pageStartedAt;
    if (elapsed >= state.flipSeconds * 1000) {
        showPage(state.pageIndex + 1);
        return;
    }
    v('page-progress-bar').style.width = `${(elapsed / (state.flipSeconds * 1000)) * 100}%`;
}

function scrollListBy(px) {
    listParts().box.scrollBy({ top: px, behavior: 'smooth' });
}

// ── Tile picker ─────────────────────────────────────────────────────────

const picker = { tile: null, hasPlan: false, saving: false };

// A station in SCO on the Line output card: which style's pieces it counts. Asked under the station once it
// is ticked, with each side's pieces so far; no side is pre-picked unless one was saved, so Save waits for it.
function scoChoiceHtml(station, chosen, plan) {
    const sco = station.sco;
    const name = `tp-sco-${station.key}`;
    const options = [
        ['primary', `Primary${plan.product_code ? ` · ${plan.product_code}` : ''}`, sco.primary.output],
        ['co', `SCO${plan.incoming_product_code ? ` · ${plan.incoming_product_code}` : ''}`, sco.co.output],
        ['both', 'Both', sco.primary.output + sco.co.output]
    ];
    return `<div class="tp-sco" data-key="${esc(station.key)}" role="radiogroup" aria-label="${esc(station.code)}: which data to show"${chosen ? '' : ' data-ask'}>
        <span class="tp-sco-q">Show which data?</span>
        ${options.map(([value, label, pcs]) => `<label class="tp-sco-opt${chosen === value ? ' is-on' : ''}">
            <input type="radio" name="${esc(name)}" value="${value}"${chosen === value ? ' checked' : ''}>
            <span class="tp-sco-label">${esc(label)}</span>
            <span class="tp-sco-pcs">${num(pcs) || 0} pcs</span>
        </label>`).join('')}
    </div>`;
}

// Drawn once, from the line status in hand when the card was tapped. The 10-second poll keeps
// repainting the board underneath but never touches this, so ticks are not lost mid-choice.
function openTilePicker(tile) {
    const status = state.status;
    if (!status || !TILES[tile]) return;
    const current = (status.tiles || {})[tile];
    const ticked = new Set(current && current.keys ? current.keys : []);
    const stations = status.workstations || [];
    const processes = status.workstation_processes || {};
    const isEfficiency = tile === 'efficiency';
    const asksSco = tile === 'output';
    const chosenSources = (current && current.chosen_sources) || {};
    const plan = (state.report && state.report.plan) || {};

    picker.tile = tile;
    picker.hasPlan = !!status.has_plan;
    $('tp-title').textContent = `${TILES[tile].label} — choose workstations`;
    $('tp-hint').textContent = TILES[tile].hint;
    $('tp-overall').hidden = !isEfficiency;
    $('tp-or').hidden = !isEfficiency || !stations.length;
    $('tp-overall-box').checked = isEfficiency && !!(current && current.line_overall);
    $('tp-error').textContent = '';

    $('tp-grid').innerHTML = stations.length
        ? stations.map((station) => {
            const on = ticked.has(station.key);
            const hasSco = asksSco && !!station.sco;
            const card = `<label class="tp-station${on ? ' is-on' : ''}">
                <input type="checkbox" value="${esc(station.key)}"${on ? ' checked' : ''}>
                <span class="tp-code">${esc(station.code)}${station.is_final_stitching ? '<span class="tag tag-fs">FINAL STITCHING</span>' : ''}${hasSco ? '<span class="tag tag-co">SCO</span>' : ''}</span>
                <span class="tp-out">${num(station.output) || 0} pcs</span>
                <span class="tp-process">${esc(processes[station.key] || '') || '–'}</span>
            </label>`;
            return hasSco
                ? `<div class="tp-cell">${card}${scoChoiceHtml(station, chosenSources[station.key], plan)}</div>`
                : card;
        }).join('')
        : `<p class="tp-empty">${picker.hasPlan
            ? 'No workstations in today\'s plan yet.'
            : 'This line has no plan for today, so there are no workstations to choose.'}</p>`;

    syncTilePicker();
    $('tile-picker').hidden = false;
    // Start at what is already chosen (scrolling the list to it), else at the top of the list.
    const panel = $('tile-picker');
    const first = panel.querySelector('input:checked') || panel.querySelector('.tp-overall:not([hidden]) input, .tp-station input');
    (first || $('tp-cancel')).focus();
}

function closeTilePicker() {
    picker.tile = null;
    $('tile-picker').hidden = true;
}

// Highlights, the running count, and which buttons can be pressed.
function syncTilePicker() {
    const overall = picker.tile === 'efficiency' && $('tp-overall-box').checked;
    const boxes = [...$('tp-grid').querySelectorAll('input[type="checkbox"]')];
    boxes.forEach((box) => box.closest('.tp-station').classList.toggle('is-on', box.checked));
    $('tp-overall').classList.toggle('is-on', overall);
    // An SCO station's question shows only while it is ticked, and a ticked one must be answered.
    const unanswered = [];
    $('tp-grid').querySelectorAll('.tp-sco').forEach((group) => {
        const box = group.parentElement.querySelector('input[type="checkbox"]');
        group.hidden = !box.checked;
        group.querySelectorAll('.tp-sco-opt').forEach((opt) => opt.classList.toggle('is-on', opt.querySelector('input').checked));
        if (box.checked && !group.querySelector('input:checked')) {
            unanswered.push(group.parentElement.querySelector('.tp-code').firstChild.textContent);
        }
    });
    const count = boxes.filter((box) => box.checked).length;
    $('tp-count').textContent = overall
        ? 'Whole line'
        : unanswered.length
            ? `Choose Primary, SCO or Both for ${unanswered.join(', ')}`
            : count === 0
                ? 'Nothing ticked — the card stays empty'
                : count === 1 ? '1 workstation' : `${count} workstations`;
    $('tp-count').classList.toggle('bad', unanswered.length > 0);
    $('tp-save').disabled = picker.saving || !picker.hasPlan || unanswered.length > 0;
    $('tp-clear').disabled = picker.saving || !picker.hasPlan;
    $('tp-cancel').disabled = picker.saving;
}

// Line overall and workstations are either/or: ticking one side clears the other.
function onTilePickerChange(event) {
    const box = event.target;
    if (!(box instanceof HTMLInputElement)) return;
    if (box.type === 'radio') {
        syncTilePicker();
        return;
    }
    if (box === $('tp-overall-box')) {
        if (box.checked) $('tp-grid').querySelectorAll('input[type="checkbox"]:checked').forEach((other) => { other.checked = false; });
    } else if (box.checked) {
        $('tp-overall-box').checked = false;
    }
    syncTilePicker();
}

async function saveTilePicker({ clear = false } = {}) {
    if (!picker.tile || picker.saving) return;
    const tile = picker.tile;
    const lineOverall = !clear && tile === 'efficiency' && $('tp-overall-box').checked;
    const stationKeys = clear || lineOverall
        ? []
        : [...$('tp-grid').querySelectorAll('input[type="checkbox"]:checked')].map((box) => box.value);
    const stationSources = {};
    if (!clear && tile === 'output') {
        $('tp-grid').querySelectorAll('.tp-sco').forEach((group) => {
            const answer = group.querySelector('input:checked');
            if (answer && stationKeys.includes(group.dataset.key)) stationSources[group.dataset.key] = answer.value;
        });
    }
    picker.saving = true;
    $('tp-error').textContent = '';
    syncTilePicker();
    try {
        await sendJson('/api/display/tiles', 'PUT', {
            line_id: lineId, tile, station_keys: stationKeys, line_overall: lineOverall, station_sources: stationSources
        });
        closeTilePicker();
        refresh({ force: true });
    } catch (err) {
        if (err.status === 401) {
            window.location.href = '/';
            return;
        }
        $('tp-error').textContent = `Not saved — ${err.message}`;
    } finally {
        picker.saving = false;
        if (picker.tile) syncTilePicker();
    }
}

// ── All lines view ──────────────────────────────────────────────────────

// Every line's board summary row at once, from /api/display/overview in a single call (the per-worker
// Hourly Report is never asked for here). A line whose efficiency card is set to Line overall also needs
// the Efficiency Report, as on its board; that figure is secondary and its failure leaves only that card "–".
let overviewSeq = 0;

async function refreshOverview() {
    if (state.refreshing && Date.now() - state.refreshStartedAt < REFRESH_WEDGED_MS) return;
    const seq = ++overviewSeq;
    state.refreshing = true;
    state.refreshStartedAt = Date.now();
    try {
        const { data } = await getJson('/api/display/overview');
        const overallLines = data.last_completed_hour == null
            ? []
            : data.lines.filter((row) => row.tiles && row.tiles.efficiency && row.tiles.efficiency.line_overall);
        const effs = await Promise.all(overallLines.map((row) => getJson(
            `/api/efficiency-report?line_id=${row.line.id}&date=${encodeURIComponent(data.date)}&hour=${data.last_completed_hour}`
        ).then((res) => num(res.data && res.data.summary && res.data.summary.live_efficiency_pct)).catch(() => null)));
        if (seq !== overviewSeq) return;
        if (state.overview && data.date !== state.overview.date) {
            state.pageIndex = 0;
            state.pageStartedAt = Date.now();
        }
        state.overview = data;
        state.overviewEff = new Map(overallLines.map((row, i) => [row.line.id, effs[i]]));
        state.timeZone = data.time_zone;
        state.clockOffsetMs = Date.parse(data.server_time) - Date.now();
        state.lastSuccessAt = Date.now();
        state.lastError = null;
        renderOverview();
    } catch (err) {
        if (err.status === 401) {
            window.location.href = '/';
            return;
        }
        if (seq !== overviewSeq) return;
        state.lastError = err.message;
    } finally {
        if (seq === overviewSeq) {
            state.refreshing = false;
            renderLiveStatus();
        }
    }
}

// Photos that failed to load once stay on initials, so the 10-second repaint does not bring back a
// broken image (see renderSupervisor for the board's version of the same rule).
const failedPhotos = new Set();

function overviewSupervisorHtml(line) {
    const name = line.line_leader || '';
    const photos = [line.line_leader_photo, line.line_leader_photo_2].filter((photo) => photo && !failedPhotos.has(photo));
    const face = photos.length
        ? photos.map((photo) => `<img class="sup-photo" src="${esc(photo)}" alt="${esc(name) || 'Line supervisor'}">`).join('')
        : `<span class="sup-photo sup-initials">${esc(leaderInitials(name)) || '—'}</span>`;
    return `<div class="sup-block${photos.length === 2 ? ' is-pair' : ''}">
        ${face}
        <div class="sup-text">
            ${name ? `<div class="sup-label">Supervisor</div><div class="sup-name">${esc(name)}</div>` : ''}
            <div class="sup-line">${esc(shortLineCode(line.line_code) || `Line ${line.id}`)}</div>
        </div>
    </div>`;
}

function overviewRowHtml(row, hoursCounted) {
    const { line, plan } = row;
    return `<a class="ov-row" href="/display?line=${encodeURIComponent(line.id)}" title="Open ${esc(line.line_code)}'s board">
        <div class="summary">
            ${overviewSupervisorHtml(line)}
            <div class="plan-card">
                <div class="kpi-label">Style</div>
                <div class="plan-product">${planProductHtml(plan)}</div>
                <div class="plan-meta">${planMetaHtml(plan, row.worker_count, row.is_locked, row.is_closed)}</div>
            </div>
            <div class="kpis">${summaryTilesHtml(plan, row.tiles || {}, hoursCounted, state.overviewEff.get(line.id) ?? null, false)}</div>
        </div>
    </a>`;
}

let overviewHtml = '';

function renderOverview() {
    const list = $('ov-rows');
    const message = $('ov-message');
    // Lines running a plan today come first; idle lines follow, each group in line-code order.
    const lines = state.overview
        ? [...state.overview.lines].sort((a, b) => Number(b.has_plan) - Number(a.has_plan))
        : [];
    list.classList.toggle('is-manual', !state.autoFlip);
    if (!lines.length) {
        list.innerHTML = '';
        overviewHtml = '';
        message.hidden = !state.overview;
        message.textContent = 'No active lines.';
        state.pageCount = 1;
        renderPageInfo();
        return;
    }
    message.hidden = true;

    let start = 0;
    let shown = lines;
    if (state.autoFlip) {
        list.scrollTop = 0;
        state.perPage = rowsPerPage();
        state.pageCount = Math.max(1, Math.ceil(lines.length / state.perPage));
        if (state.pageIndex >= state.pageCount) state.pageIndex = 0;
        start = state.pageIndex * state.perPage;
        shown = lines.slice(start, start + state.perPage);
    } else {
        state.pageCount = 1;
    }

    // Only repaint when something on screen changed: rebuilding the rows every 10 seconds would reload
    // every supervisor photo and blink them.
    const html = shown.map((row) => overviewRowHtml(row, state.overview.hours_counted)).join('');
    // The supervisor column is one width on every row of a page so the columns line up; it widens
    // for the whole page only when a line on it shows two supervisor photos.
    list.classList.toggle('has-pair', html.includes('sup-block is-pair'));
    if (html !== overviewHtml) {
        const scrollTop = list.scrollTop;
        list.innerHTML = html;
        overviewHtml = html;
        if (!state.autoFlip) list.scrollTop = scrollTop;
    }
    renderPageInfo();
}

function startOverview() {
    $('overview').hidden = false;
    document.title = 'All lines · WorkSync Display';
    writeSetting(LAST_LINE_KEY, OVERVIEW_SETTING);
    document.documentElement.style.setProperty('--ov-row-h', `${OV_ROW_HEIGHT_REM}rem`);

    $('ov-back-to-lines').addEventListener('click', openPicker);
    $('overview').addEventListener('dblclick', (event) => {
        if (!event.target.closest('.board-footer, .ov-row')) toggleFullscreen();
    });
    // img errors do not bubble, so this listens in the capture phase for every row's photo.
    $('ov-rows').addEventListener('error', (event) => {
        const img = event.target;
        if (!(img instanceof HTMLImageElement)) return;
        failedPhotos.add(img.getAttribute('src'));
        overviewHtml = '';
        renderOverview();
    }, true);
    $('ov-autoflip-toggle').addEventListener('click', () => setAutoFlip(!state.autoFlip));
    $('ov-flip-less').addEventListener('click', () => setFlipSeconds(state.flipSeconds - FLIP_SECONDS_STEP));
    $('ov-flip-more').addEventListener('click', () => setFlipSeconds(state.flipSeconds + FLIP_SECONDS_STEP));

    let infoFrame = 0;
    $('ov-rows').addEventListener('scroll', () => {
        if (state.autoFlip || infoFrame) return;
        infoFrame = requestAnimationFrame(() => {
            infoFrame = 0;
            renderPageInfo();
        });
    }, { passive: true });

    window.addEventListener('resize', () => {
        overviewHtml = '';
        renderOverview();
    });
    document.addEventListener('visibilitychange', () => {
        keepScreenAwake();
        if (document.visibilityState === 'visible') refreshOverview();
    });
    window.addEventListener('online', refreshOverview);
    window.addEventListener('pageshow', refreshOverview);
    renderFlipControls();
    keepScreenAwake();
    refreshOverview();
    setInterval(refreshOverview, REFRESH_MS);
    setInterval(tick, 1000);
    tick();
}

// ── Clock, screen, start-up ─────────────────────────────────────────────

function tick() {
    const now = Date.now() + state.clockOffsetMs;
    v('clock').textContent = formatClock(now, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    v('clock-date').textContent = formatClock(now, { weekday: 'short', day: 'numeric', month: 'short' });
    renderLiveStatus();
    advancePage();
}

let cursorTimer = null;
function wakeCursor() {
    document.body.classList.remove('cursor-idle');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('cursor-idle'), CURSOR_IDLE_MS);
}

function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
}

async function keepScreenAwake() {
    // Browsers grant this only over HTTPS; on plain LAN HTTP the PC's power settings must keep the screen on.
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try { await navigator.wakeLock.request('screen'); } catch (_) { /* not permitted here */ }
}

function startBoard() {
    $('board').hidden = false;
    writeSetting(LAST_LINE_KEY, lineId);
    document.documentElement.style.setProperty('--row-h', `${ROW_HEIGHT_REM}rem`);

    $('back-to-lines').addEventListener('click', openPicker);
    $('board').addEventListener('dblclick', (event) => {
        // A double tap on a line tile opens its picker; it must not also flip full screen.
        if (!event.target.closest('.board-footer, .kpis')) toggleFullscreen();
    });

    // The tiles are redrawn every refresh, so one listener on their container serves them all.
    $('kpis').addEventListener('click', (event) => {
        const card = event.target.closest('[data-tile]');
        if (card) openTilePicker(card.dataset.tile);
    });
    // No close on a backdrop click: the second click of a double-click on the efficiency card lands
    // beside the panel and would shut the picker it just opened. ×, Cancel and Esc close it.
    $('tile-picker').addEventListener('change', onTilePickerChange);
    $('tp-close').addEventListener('click', closeTilePicker);
    $('tp-cancel').addEventListener('click', closeTilePicker);
    $('tp-clear').addEventListener('click', () => saveTilePicker({ clear: true }));
    $('tp-save').addEventListener('click', () => saveTilePicker());
    $('autoflip-toggle').addEventListener('click', () => setAutoFlip(!state.autoFlip));
    $('flip-less').addEventListener('click', () => setFlipSeconds(state.flipSeconds - FLIP_SECONDS_STEP));
    $('flip-more').addEventListener('click', () => setFlipSeconds(state.flipSeconds + FLIP_SECONDS_STEP));

    let infoFrame = 0;
    $('workers').addEventListener('scroll', () => {
        if (state.autoFlip || infoFrame) return;
        infoFrame = requestAnimationFrame(() => {
            infoFrame = 0;
            renderPageInfo();
        });
    }, { passive: true });

    window.addEventListener('resize', renderWorkers);
    // Coming back from a blanked screen, a suspended PC or a dropped LAN, ask immediately rather
    // than waiting out the rest of the 10s tick — and, after a suspend, get a request moving so
    // the watchdog above has something fresh to measure.
    document.addEventListener('visibilitychange', () => {
        keepScreenAwake();
        if (document.visibilityState === 'visible') refresh();
    });
    window.addEventListener('online', refresh);
    window.addEventListener('pageshow', refresh);
    renderFlipControls();
    keepScreenAwake();
    refresh();
    setInterval(refresh, REFRESH_MS);
    setInterval(tick, 1000);
    tick();
}

document.addEventListener('mousemove', wakeCursor);
document.addEventListener('keydown', (event) => {
    if (!Number.isFinite(lineId) && !isOverview) return;
    // While the tile picker is open the keys belong to it: Esc closes it (instead of leaving the board)
    // and the board's shortcuts wait, so Space on a checkbox or + in the list does not flip pages.
    if (picker.tile) {
        if (event.key === 'Escape' && !picker.saving) {
            closeTilePicker();
            event.preventDefault();
        }
        return;
    }
    const manual = !state.autoFlip;
    const { box, rows, headPx } = listParts();
    const rowPx = rows[0]?.offsetHeight || 0;
    const screenPx = Math.max(rowPx, box.clientHeight - headPx - rowPx);
    switch (event.key) {
        case 'Escape': openPicker(); break;
        case 'f': case 'F': toggleFullscreen(); break;
        case 'p': case 'P': setAutoFlip(!state.autoFlip); break;
        case '+': case '=': setFlipSeconds(state.flipSeconds + FLIP_SECONDS_STEP); break;
        case '-': case '_': setFlipSeconds(state.flipSeconds - FLIP_SECONDS_STEP); break;
        case 'ArrowDown': if (manual) scrollListBy(rowPx); else showPage(state.pageIndex + 1); break;
        case 'ArrowUp': if (manual) scrollListBy(-rowPx); else showPage(state.pageIndex - 1); break;
        case 'ArrowRight': case 'PageDown': if (manual) scrollListBy(screenPx); else showPage(state.pageIndex + 1); break;
        case 'ArrowLeft': case 'PageUp': if (manual) scrollListBy(-screenPx); else showPage(state.pageIndex - 1); break;
        case 'Home': if (manual) box.scrollTo({ top: 0, behavior: 'smooth' }); else showPage(0); break;
        case 'End': if (manual) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); else showPage(state.pageCount - 1); break;
        default: return;
    }
    event.preventDefault();
});

if (Number.isFinite(lineId)) {
    startBoard();
} else if (isOverview) {
    startOverview();
} else {
    // A TV that was signed out comes back to /display with no line: send it straight back to its line,
    // or to the All lines view if that is what it was showing.
    const last = params.has('pick') ? null : readSetting(LAST_LINE_KEY);
    if (last === OVERVIEW_SETTING) window.location.replace('/display?overview=1');
    else if (last) window.location.replace(`/display?line=${encodeURIComponent(last)}`);
    else showPicker();
}
wakeCursor();
