const API_BASE = '/api';

document.addEventListener('DOMContentLoaded', async () => {
    const ok = await requireAuth();
    if (!ok) return;
    setupNavigation();
    setupMobileSidebar();
    loadSection('morning');
});

async function requireAuth() {
    try {
        const response = await fetch('/auth/session');
        if (!response.ok) {
            window.location.href = '/';
            return false;
        }
        const result = await response.json();
        if (!result.success) {
            window.location.href = '/';
            return false;
        }
        const required = window.REQUIRED_ROLE;
        if (required) {
            const roles = Array.isArray(required) ? required : [required];
            if (!roles.includes(result.role)) {
                window.location.href = '/';
                return false;
            }
        }
        return true;
    } catch (err) {
        window.location.href = '/';
        return false;
    }
}

function setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const section = link.dataset.section;
            loadSection(section);
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            closeMobileSidebar();
        });
    });
}

function setupMobileSidebar() {
    const toggle = document.getElementById('sidebar-toggle');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!toggle || !sidebar || !overlay) return;
    toggle.addEventListener('click', () => {
        const isOpen = sidebar.classList.toggle('open');
        overlay.classList.toggle('active', isOpen);
    });
    overlay.addEventListener('click', closeMobileSidebar);
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) closeMobileSidebar();
    });
}

function closeMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}

async function loadSection(section) {
    stopCamera();
    if (section === 'hourly') {
        await loadHourlyProcedure();
    } else if (section === 'adjustment') {
        await loadAdjustmentPanel();
    } else if (section === 'feed') {
        await loadFeedInput();
    } else {
        await loadMorningProcedure();
    }
}

// ==========================================
// TOAST UTILITY
// ==========================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==========================================
// CAMERA / QR SCANNING (shared by both sections)
// ==========================================
let cameraStream = null;
let scanning = false;
let detector = null;
let lastScanAt = 0;
let onQrScanned = null; // callback when QR scanned

function parseScanPayload(rawValue) {
    if (!rawValue) return null;
    try {
        const parsed = JSON.parse(rawValue);
        if (parsed && typeof parsed === 'object') return parsed;
    } catch (err) { /* ignore */ }
    const raw = String(rawValue).trim();
    if (!raw) return null;
    const numeric = parseInt(raw, 10);
    if (Number.isFinite(numeric)) return { id: numeric };
    return { raw };
}

async function startCamera(videoElementId, statusElementId, callback) {
    onQrScanned = callback;
    const status = document.getElementById(statusElementId);
    const video = document.getElementById(videoElementId);
    if (!video) return;

    try {
        const isHttps = window.location.protocol === 'https:';
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (!window.isSecureContext || (!isHttps && !isLocalhost)) {
            showToast('Camera access requires HTTPS.', 'error');
            if (status) status.textContent = 'HTTPS Required';
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showToast('Camera not supported on this browser', 'error');
            if (status) status.textContent = 'Camera Unsupported';
            return;
        }
        if ('BarcodeDetector' in window) {
            detector = new BarcodeDetector({ formats: ['qr_code'] });
        } else if (window.jsQR) {
            detector = null;
        } else {
            showToast('QR scan not supported on this device', 'error');
            return;
        }
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false
        });
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.srcObject = cameraStream;
        await video.play();
        scanning = true;
        if (status) status.textContent = 'Scanning...';
        scanLoop(videoElementId);
    } catch (err) {
        let message = 'Unable to access camera';
        if (err?.name === 'NotAllowedError') message = 'Camera permission blocked. Allow camera in browser settings.';
        else if (err?.name === 'NotFoundError') message = 'No camera found.';
        else if (err?.name === 'NotReadableError') message = 'Camera in use by another app.';
        showToast(message, 'error');
        if (status) status.textContent = 'Camera Error';
    }
}

function stopCamera() {
    scanning = false;
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    onQrScanned = null;
}

async function scanLoop(videoElementId) {
    if (!scanning) return;
    const video = document.getElementById(videoElementId);
    if (!video) return;
    try {
        if (detector) {
            const barcodes = await detector.detect(video);
            if (barcodes.length) {
                const now = Date.now();
                if (now - lastScanAt > 1200) {
                    lastScanAt = now;
                    if (onQrScanned) onQrScanned(barcodes[0].rawValue);
                }
            }
        } else if (window.jsQR) {
            const canvas = document.createElement('canvas');
            const width = video.videoWidth;
            const height = video.videoHeight;
            if (width && height) {
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, width, height);
                const imageData = ctx.getImageData(0, 0, width, height);
                const code = window.jsQR(imageData.data, width, height);
                if (code) {
                    const now = Date.now();
                    if (now - lastScanAt > 1200) {
                        lastScanAt = now;
                        if (onQrScanned) onQrScanned(code.data);
                    }
                }
            }
        }
    } catch (err) { /* ignore frame errors */ }
    requestAnimationFrame(() => scanLoop(videoElementId));
}

// ==========================================
// MORNING PROCEDURE
// ==========================================
const morningState = {
    lineId: null,
    processes: [],
    workstations: null,
    targetQty: 0,
    selectedWorkstation: null,
    selectedWorkstationPlanId: null,
    scannedEmployee: null,
    mappedEmployee: null,
    scanMode: 'link'
};

async function loadMorningProcedure() {
    const content = document.getElementById('supervisor-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const response = await fetch(`${API_BASE}/supervisor/lines`);
        const result = await response.json();
        const lines = result.data || [];
        const today = new Date().toISOString().slice(0, 10);

        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Morning Procedure</h1>
                    <p class="page-subtitle">Assign workers to workstations</p>
                </div>
                <span class="status-badge">${today}</span>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Select Line</h3>
                </div>
                <div class="card-body">
                    <select class="form-control" id="morning-line">
                        <option value="">Select Line</option>
                        ${lines.map(l => `<option value="${l.id}">${l.line_name} (${l.line_code})${l.product_code ? ' - ' + l.product_code : ''}</option>`).join('')}
                    </select>
                </div>
            </div>

            <div id="morning-assignments" style="margin-top:16px;"></div>

            <div id="morning-scan-panel" class="card" style="margin-top:16px; display:none;">
                <div class="card-header">
                    <h3 class="card-title" id="morning-scan-title">Scan Worker QR</h3>
                    <button class="btn btn-secondary btn-sm" id="morning-cancel-scan">Cancel</button>
                </div>
                <div class="card-body">
                    <p id="morning-scan-label" style="margin-bottom:8px; font-weight:600;"></p>
                    <div class="camera-panel">
                        <video id="morning-camera" playsinline muted style="width:100%; max-height:300px; border-radius:8px; background:#000;"></video>
                    </div>
                    <div id="morning-scan-result" style="margin-top:12px;"></div>
                </div>
            </div>
        `;

        document.getElementById('morning-line').addEventListener('change', onMorningLineChange);
        document.getElementById('morning-cancel-scan').addEventListener('click', cancelMorningScan);
        morningState.lineId = null;
        morningState.processes = [];
        morningState.selectedWorkstation = null;
        morningState.scannedEmployee = null;
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

async function onMorningLineChange() {
    const lineId = document.getElementById('morning-line').value;
    morningState.lineId = lineId;
    morningState.selectedWorkstation = null;
    morningState.scannedEmployee = null;
    stopCamera();

    const container = document.getElementById('morning-assignments');
    const scanPanel = document.getElementById('morning-scan-panel');
    if (scanPanel) scanPanel.style.display = 'none';

    if (!lineId) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = '<div class="loading-overlay" style="position:relative;padding:40px 0;"><div class="spinner"></div></div>';

    try {
        const today = new Date().toISOString().slice(0, 10);
        const response = await fetch(`${API_BASE}/supervisor/processes/${lineId}?date=${today}`);
        const result = await response.json();

        if (result.has_plan && result.workstation_plan?.length > 0) {
            // Use the line plan workstations
            morningState.workstations = result.workstation_plan;
            morningState.processes = result.data || [];
            morningState.targetQty = morningState.processes.length > 0 ? (morningState.processes[0].target_qty || 0) : 0;
            renderMorningAssignments(true);
        } else {
            // Fallback: group flat processes by workstation_code
            morningState.processes = result.data || [];
            morningState.workstations = null;
            morningState.targetQty = morningState.processes.length > 0 ? (morningState.processes[0].target_qty || 0) : 0;
            renderMorningAssignments(false);
        }
    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function renderMorningAssignments(hasPlan) {
    const container = document.getElementById('morning-assignments');

    if (hasPlan && morningState.workstations?.length > 0) {
        const workstations = morningState.workstations;

        // All linked = every workstation has an employee assigned
        const allLinked = workstations.every(ws => !!ws.assigned_emp_name);

        const cards = workstations.map(ws => {
            const isMapped   = !!ws.assigned_emp_name;
            const processList = (ws.processes || []).map(p => `${p.operation_code} – ${p.operation_name}`).join(', ');
            const workloadColor = ws.workload_pct > 100 ? '#dc2626' : ws.workload_pct > 85 ? '#d97706' : '#16a34a';
            const workloadPct = parseFloat(ws.workload_pct||0).toFixed(0);

            const assignedHtml = isMapped
                ? `<span style="color:#1d4ed8;font-weight:600;">${ws.assigned_emp_code} — ${ws.assigned_emp_name}</span>`
                : '<span style="color:#9ca3af;font-style:italic;">Not mapped</span>';

            const statusBadge = isMapped
                ? `<span style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#16a34a;padding:3px 8px;border-radius:12px;font-size:12px;font-weight:700;">&#10003; Linked</span>`
                : `<span style="display:inline-flex;align-items:center;gap:4px;background:#fef3c7;color:#d97706;padding:3px 8px;border-radius:12px;font-size:12px;font-weight:700;">&#9888; Not Linked</span>`;

            const groupBadge = ws.group_name
                ? `<span style="display:inline-flex;align-items:center;gap:4px;background:#ede9fe;color:#5b21b6;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:700;">&#128209; ${ws.group_name}</span>`
                : '';

            const footerContent = isMapped
                ? `<span style="color:#16a34a;font-size:13px;padding:6px 0;display:block;text-align:center;font-weight:600;">&#10003; Completed</span>`
                : `<button class="btn btn-primary ws-card-action"
                        onclick="startMorningScan('${ws.workstation_code}', ${ws.id}, ${ws.assigned_employee_id || 'null'}, '${ws.assigned_emp_code || ''}', '${(ws.assigned_emp_name || '').replace(/'/g, "\\'")}')">
                        &#128247; Scan &amp; Link
                   </button>`;

            return `
                <div class="ws-card ${isMapped ? '' : 'ws-card--alert'}" id="ws-card-${ws.workstation_code}">
                    <div class="ws-card-header">
                        <span class="ws-card-code">${ws.workstation_code}</span>
                        <div class="ws-card-badges">
                            ${groupBadge}
                            ${statusBadge}
                            <span style="font-size:12px;font-weight:600;color:${workloadColor};">${workloadPct}%</span>
                        </div>
                    </div>
                    <div class="ws-card-body">
                        <div class="ws-card-row">
                            <span class="ws-card-label">Processes</span>
                            <span style="font-size:12px;color:#6b7280;">${processList}</span>
                        </div>
                        <div class="ws-card-row">
                            <span class="ws-card-label">Worker</span>
                            <span>${assignedHtml}</span>
                        </div>
                    </div>
                    <div class="ws-card-footer">
                        ${footerContent}
                    </div>
                </div>`;
        }).join('');

        container.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Workstation Assignments</h3>
                    <span style="font-size:0.85em; color:#6b7280;">
                        ${workstations.length} workstations &nbsp;|&nbsp;
                        ${allLinked ? '<span style="color:#16a34a;">&#10003; All linked</span>' : '<span style="color:#dc2626;">&#9888; Some not linked</span>'}
                    </span>
                </div>
                <div class="card-body">
                    <div class="ws-cards-grid">${cards}</div>
                </div>
            </div>
        `;
        return;
    }

    // Fallback: no plan — group by workstation_code from product_processes
    const processes = morningState.processes;
    if (!processes.length) {
        container.innerHTML = `
            <div class="card"><div class="card-body">
                <div class="alert alert-info">
                    No workstation plan found for today. Please ask IE/Admin to generate a workstation plan for this line first.
                </div>
            </div></div>`;
        return;
    }

    const wsMap = new Map();
    processes.forEach(p => {
        const ws = p.workstation_code || p.group_name || '-';
        if (!wsMap.has(ws)) {
            wsMap.set(ws, { workstation_code: ws, processes: [], assigned_emp_code: null, assigned_emp_name: null, assigned_employee_id: null, plan_id: null, material_provided: null });
        }
        wsMap.get(ws).processes.push(p);
        if (p.assigned_emp_name && !wsMap.get(ws).assigned_emp_name) {
            wsMap.get(ws).assigned_emp_code = p.assigned_emp_code;
            wsMap.get(ws).assigned_emp_name = p.assigned_emp_name;
        }
    });

    const cards = Array.from(wsMap.values()).map(ws => {
        const isMapped    = !!ws.assigned_emp_name;
        const assignedHtml = isMapped
            ? `<span style="color:#1d4ed8;font-weight:600;">${ws.assigned_emp_code} — ${ws.assigned_emp_name}</span>`
            : '<span style="color:#9ca3af;font-style:italic;">Not mapped</span>';
        const processList = ws.processes.map(p => `${p.operation_code} – ${p.operation_name}`).join(', ');

        const statusBadge = isMapped
            ? `<span style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#16a34a;padding:3px 8px;border-radius:12px;font-size:12px;font-weight:700;">&#10003; Linked</span>`
            : `<span style="display:inline-flex;align-items:center;gap:4px;background:#fef3c7;color:#d97706;padding:3px 8px;border-radius:12px;font-size:12px;font-weight:700;">&#9888; Not Linked</span>`;

        const footerContent = isMapped
            ? `<span style="color:#16a34a;font-size:13px;padding:6px 0;display:block;text-align:center;font-weight:600;">&#10003; Completed</span>`
            : `<button class="btn btn-primary ws-card-action"
                    onclick="startMorningScan('${ws.workstation_code}', null, ${ws.assigned_employee_id || 'null'}, '${ws.assigned_emp_code || ''}', '${ws.assigned_emp_name || ''}')">
                    &#128247; Scan &amp; Link
               </button>`;

        return `
            <div class="ws-card ${isMapped ? '' : 'ws-card--alert'}" id="ws-card-${ws.workstation_code}">
                <div class="ws-card-header">
                    <span class="ws-card-code">${ws.workstation_code}</span>
                    <div class="ws-card-badges">${statusBadge}</div>
                </div>
                <div class="ws-card-body">
                    <div class="ws-card-row">
                        <span class="ws-card-label">Processes</span>
                        <span style="font-size:12px;color:#6b7280;">${processList}</span>
                    </div>
                    <div class="ws-card-row">
                        <span class="ws-card-label">Worker</span>
                        <span>${assignedHtml}</span>
                    </div>
                </div>
                <div class="ws-card-footer">
                    ${footerContent}
                </div>
            </div>`;
    }).join('');

    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Workstation Assignments</h3>
                <small style="color:#f59e0b;">No balance plan — using product-level grouping</small>
            </div>
            <div class="card-body">
                <div class="ws-cards-grid">${cards}</div>
            </div>
        </div>
    `;
}

// Returns the default "Scan & Link" button HTML for a workstation card footer
function _morningDefaultScanBtn(wsCode, planId, empId, empCode, empName) {
    const safeEmpName = (empName || '').replace(/'/g, "\\'");
    return `<button class="btn btn-primary ws-card-action"
        onclick="startMorningScan('${wsCode}', ${planId || 'null'}, ${empId || 'null'}, '${empCode || ''}', '${safeEmpName}')">
        &#128247; Scan &amp; Link
    </button>`;
}

// mappedEmpId/Code/Name = what IE/Admin assigned (may be null if not mapped yet)
function startMorningScan(workstationCode, linePlanWorkstationId, mappedEmpId, mappedEmpCode, mappedEmpName) {
    morningState.selectedWorkstation = workstationCode;
    morningState.selectedWorkstationPlanId = linePlanWorkstationId || null;
    morningState.scannedEmployee = null;
    morningState.mappedEmployee = mappedEmpId ? { id: mappedEmpId, emp_code: mappedEmpCode, emp_name: mappedEmpName } : null;

    // Close any other open inline scan first
    const prevScanEl = document.getElementById('morning-inline-scan');
    if (prevScanEl) {
        const prevCard = prevScanEl.closest('.ws-card');
        if (prevCard) {
            const prevFooter = prevCard.querySelector('.ws-card-footer');
            if (prevFooter) prevFooter.innerHTML = _morningDefaultScanBtn(
                prevCard.id.replace('ws-card-', ''),
                prevScanEl.dataset.planId || 'null',
                prevScanEl.dataset.empId || 'null',
                prevScanEl.dataset.empCode || '',
                prevScanEl.dataset.empName || ''
            );
        }
    }

    // Inject inline camera into this card's footer
    const card = document.getElementById(`ws-card-${workstationCode}`);
    const footer = card ? card.querySelector('.ws-card-footer') : null;
    if (footer) {
        footer.innerHTML = `
            <div id="morning-inline-scan" style="width:100%;"
                data-plan-id="${linePlanWorkstationId || ''}"
                data-emp-id="${mappedEmpId || ''}"
                data-emp-code="${mappedEmpCode || ''}"
                data-emp-name="${(mappedEmpName || '').replace(/"/g, '&quot;')}">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:13px;font-weight:600;color:#374151;">
                        &#128247; Scanning ${workstationCode}
                        ${mappedEmpId ? `<span style="color:#9ca3af;font-weight:400;"> — mapped: ${mappedEmpCode}</span>` : ''}
                    </span>
                    <button class="btn btn-secondary btn-sm" onclick="cancelMorningScan()">Cancel</button>
                </div>
                <video id="morning-camera" playsinline muted style="width:100%;border-radius:8px;background:#000;max-height:260px;display:block;"></video>
                <div id="morning-scan-result" style="margin-top:10px;">
                    <p style="color:#6b7280;font-size:13px;">Point camera at employee QR code...</p>
                </div>
            </div>`;
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
        // Fallback: old fixed panel
        const scanPanel = document.getElementById('morning-scan-panel');
        if (scanPanel) { scanPanel.style.display = 'block'; scanPanel.scrollIntoView({ behavior: 'smooth' }); }
    }

    const scanResult = document.getElementById('morning-scan-result');

    startCamera('morning-camera', null, async (rawValue) => {
        stopCamera();
        const payload = parseScanPayload(rawValue);
        if (!payload) {
            if (scanResult) scanResult.innerHTML = '<p style="color:#dc2626;">Invalid QR code. Try again.</p>';
            return;
        }

        if (scanResult) scanResult.innerHTML = '<p style="color:#6b7280;">Resolving employee...</p>';

        try {
            // Resolve scanned QR to an employee (no line assignment required)
            let scannedEmp = null;
            const res = await fetch(`${API_BASE}/supervisor/resolve-employee-by-qr`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employee_qr: rawValue })
            });
            const resolveResult = await res.json();

            if (resolveResult.success) {
                scannedEmp = resolveResult.data.employee;
            }

            if (!scannedEmp) {
                scanResult.innerHTML = '<p style="color:#dc2626;">Employee not found. Try again.</p>';
                return;
            }

            morningState.scannedEmployee = scannedEmp;
            const mapped = morningState.mappedEmployee;

            if (mapped && mapped.id !== scannedEmp.id) {
                // MISMATCH — ask supervisor
                scanResult.innerHTML = `
                    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px;margin-bottom:10px;">
                        <p style="font-weight:700;color:#c2410c;margin:0 0 6px;">&#9888; Mismatch!</p>
                        <p style="font-size:0.9em;margin:0 0 4px;">Workstation <strong>${workstationCode}</strong> is mapped to:</p>
                        <p style="font-weight:700;color:#1d4ed8;margin:0 0 10px;">&#128100; ${mapped.emp_code} — ${mapped.emp_name}</p>
                        <p style="font-size:0.9em;margin:0 0 4px;">You scanned:</p>
                        <p style="font-weight:700;color:#16a34a;margin:0 0 14px;">&#128100; ${scannedEmp.emp_code} — ${scannedEmp.emp_name}</p>
                        <div class="mismatch-actions">
                            <button class="btn btn-secondary" onclick="cancelMorningScan()">
                                Keep ${mapped.emp_code}
                            </button>
                            <button class="btn" style="background:#dc2626;color:#fff;border:none;"
                                onclick="_morningShowConfirmEmployee()">
                                Replace with ${scannedEmp.emp_code}
                            </button>
                        </div>
                    </div>`;
            } else {
                // Match (or no prior mapping) — confirm directly
                _morningShowConfirmEmployee();
            }
        } catch (err) {
            scanResult.innerHTML = `<p style="color:#dc2626;">Error: ${err.message}</p>`;
        }
    });
}

function _morningShowConfirmEmployee() {
    const scanResult = document.getElementById('morning-scan-result');
    const emp = morningState.scannedEmployee;
    const matchedBefore = morningState.mappedEmployee && morningState.mappedEmployee.id === emp?.id;
    const empLabel = matchedBefore ? '&#10003; Match confirmed' : 'Replacing with';
    scanResult.innerHTML = `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;margin-bottom:10px;">
            <p style="font-weight:700;font-size:1em;color:#16a34a;margin:0;">${empLabel}: ${emp?.emp_code} — ${emp?.emp_name}</p>
        </div>
        <button class="btn btn-primary ws-card-action" onclick="confirmMorningAssign()">
            &#128279; Confirm Link
        </button>`;
}

async function confirmMorningAssign() {
    if (!morningState.lineId || !morningState.selectedWorkstation || !morningState.scannedEmployee) {
        showToast('Missing data for assignment', 'error');
        return;
    }

    try {
        const emp = morningState.scannedEmployee;
        const today = new Date().toISOString().slice(0, 10);

        // Save employee assignment
        const res = await fetch(`${API_BASE}/workstation-assignments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: morningState.lineId,
                workstation_code: morningState.selectedWorkstation,
                employee_id: emp.id,
                work_date: today,
                line_plan_workstation_id: morningState.selectedWorkstationPlanId
            })
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error || 'Assignment failed', 'error'); return; }

        showToast(`${emp.emp_name} linked to ${morningState.selectedWorkstation}`, 'success');

        const scanPanel = document.getElementById('morning-scan-panel');
        if (scanPanel) scanPanel.style.display = 'none';
        morningState.selectedWorkstation = null;
        morningState.scannedEmployee = null;
        morningState.scanMode = 'link';

        const procResponse = await fetch(`${API_BASE}/supervisor/processes/${morningState.lineId}`);
        const procResult = await procResponse.json();
        if (procResult.has_plan && procResult.workstation_plan?.length > 0) {
            morningState.workstations = procResult.workstation_plan;
            morningState.processes = procResult.data || [];
            renderMorningAssignments(true);
        } else {
            morningState.workstations = null;
            morningState.processes = procResult.data || [];
            renderMorningAssignments(false);
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function cancelMorningScan() {
    stopCamera();
    const ws = morningState.selectedWorkstation;
    const planId = morningState.selectedWorkstationPlanId;
    const mapped = morningState.mappedEmployee;

    // Restore the inline card footer to the default Scan & Link button
    if (ws) {
        const card = document.getElementById(`ws-card-${ws}`);
        const footer = card ? card.querySelector('.ws-card-footer') : null;
        if (footer) {
            footer.innerHTML = _morningDefaultScanBtn(
                ws, planId,
                mapped?.id || null,
                mapped?.emp_code || '',
                mapped?.emp_name || ''
            );
        }
    }

    // Also hide fixed fallback panel if it was used
    const scanPanel = document.getElementById('morning-scan-panel');
    if (scanPanel) scanPanel.style.display = 'none';

    morningState.selectedWorkstation = null;
    morningState.selectedWorkstationPlanId = null;
    morningState.scannedEmployee = null;
    morningState.mappedEmployee = null;
    morningState.scanMode = 'link';
}


// ==========================================
// FEED INPUT
// ==========================================
const feedState = { lineId: null, workstations: null };

async function loadFeedInput() {
    const content = document.getElementById('supervisor-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    try {
        const response = await fetch(`${API_BASE}/supervisor/lines`);
        const result = await response.json();
        const lines = result.data || [];
        const today = new Date().toISOString().slice(0, 10);

        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Feed Input</h1>
                    <p class="page-subtitle">Enter initial material input for each group's first workstation</p>
                </div>
                <span class="status-badge">${today}</span>
            </div>
            <div class="card">
                <div class="card-header"><h3 class="card-title">Select Line</h3></div>
                <div class="card-body">
                    <select class="form-control" id="feed-line">
                        <option value="">Select Line</option>
                        ${lines.map(l => `<option value="${l.id}">${l.line_name} (${l.line_code})${l.product_code ? ' - ' + l.product_code : ''}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div id="feed-assignments" style="margin-top:16px;"></div>`;

        document.getElementById('feed-line').addEventListener('change', onFeedLineChange);
        feedState.lineId = null;
        feedState.workstations = null;
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

async function onFeedLineChange() {
    const lineId = document.getElementById('feed-line').value;
    feedState.lineId = lineId;
    const container = document.getElementById('feed-assignments');
    if (!lineId) { container.innerHTML = ''; return; }
    container.innerHTML = '<div class="loading-overlay" style="position:relative;padding:40px 0;"><div class="spinner"></div></div>';
    try {
        const today = new Date().toISOString().slice(0, 10);
        const response = await fetch(`${API_BASE}/supervisor/processes/${lineId}?date=${today}`);
        const result = await response.json();
        feedState.workstations = (result.has_plan && result.workstation_plan?.length > 0) ? result.workstation_plan : null;
        renderFeedInput();
    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function renderFeedInput() {
    const container = document.getElementById('feed-assignments');
    if (!feedState.workstations?.length) {
        container.innerHTML = `<div class="card"><div class="card-body"><div class="alert alert-info">No workstation plan found for today. Ask IE/Admin to generate a workstation plan first.</div></div></div>`;
        return;
    }

    // Only group-first (or standalone) workstations handle material input
    const feedWs = feedState.workstations.filter(ws => ws.is_group_first !== false);
    if (!feedWs.length) {
        container.innerHTML = `<div class="card"><div class="card-body"><div class="alert alert-info">No group-leader workstations found in this plan.</div></div></div>`;
        return;
    }

    const cards = feedWs.map(ws => {
        const isAssigned = !!ws.assigned_emp_name;
        const processList = (ws.processes || []).map(p => `${p.operation_code} – ${p.operation_name}`).join(', ');
        const groupBadge = ws.group_name
            ? `<span style="display:inline-flex;align-items:center;gap:4px;background:#ede9fe;color:#5b21b6;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:700;">&#128209; ${ws.group_name}</span>`
            : '';
        const materialBadge = ws.material_provided != null
            ? `<span style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#16a34a;padding:3px 8px;border-radius:12px;font-size:12px;font-weight:700;">&#10003; ${ws.material_provided} pcs</span>`
            : `<span style="display:inline-flex;align-items:center;gap:4px;background:#fef3c7;color:#d97706;padding:3px 8px;border-radius:12px;font-size:12px;font-weight:700;">&#9888; Not entered</span>`;
        const assignedHtml = isAssigned
            ? `<span style="color:#1d4ed8;font-weight:600;">${ws.assigned_emp_code} — ${ws.assigned_emp_name}</span>`
            : `<span style="color:#dc2626;font-style:italic;">No employee assigned</span>`;
        const inputSection = isAssigned
            ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px;">
                <input type="number" id="feed-qty-${ws.workstation_code}" min="0"
                    value="${ws.material_provided ?? 0}"
                    class="form-control" style="width:100px;text-align:center;">
                <span style="font-size:13px;color:#6b7280;">pcs</span>
                <button class="btn btn-primary" onclick="saveFeedInput('${ws.workstation_code}')">
                    &#10003; Save
                </button>
               </div>`
            : `<p style="color:#9ca3af;font-size:12px;font-style:italic;margin:4px 0 0;">Assign an employee via Morning Procedure first.</p>`;

        return `
            <div class="ws-card ${ws.material_provided == null ? 'ws-card--alert' : ''}" id="feed-card-${ws.workstation_code}">
                <div class="ws-card-header">
                    <span class="ws-card-code">${ws.workstation_code}</span>
                    <div class="ws-card-badges">${groupBadge}${materialBadge}</div>
                </div>
                <div class="ws-card-body">
                    <div class="ws-card-row">
                        <span class="ws-card-label">Processes</span>
                        <span style="font-size:12px;color:#6b7280;">${processList}</span>
                    </div>
                    <div class="ws-card-row">
                        <span class="ws-card-label">Worker</span>
                        <span>${assignedHtml}</span>
                    </div>
                    <div class="ws-card-row">
                        <span class="ws-card-label">Material</span>
                        <div>${inputSection}</div>
                    </div>
                </div>
            </div>`;
    }).join('');

    const allFed = feedWs.every(ws => ws.material_provided != null);
    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Feed Input</h3>
                <span style="font-size:0.85em;color:#6b7280;">
                    ${feedWs.length} workstation${feedWs.length !== 1 ? 's' : ''} &nbsp;|&nbsp;
                    ${allFed ? '<span style="color:#16a34a;">&#10003; All entered</span>' : '<span style="color:#dc2626;">&#9888; Pending</span>'}
                </span>
            </div>
            <div class="card-body">
                <div class="ws-cards-grid">${cards}</div>
            </div>
        </div>`;
}

async function saveFeedInput(wsCode) {
    const qty = parseInt(document.getElementById(`feed-qty-${wsCode}`)?.value || '0', 10);
    if (isNaN(qty) || qty < 0) { showToast('Enter a valid quantity', 'error'); return; }
    try {
        const today = new Date().toISOString().slice(0, 10);
        const res = await fetch(`${API_BASE}/workstation-assignments/material`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: feedState.lineId, workstation_code: wsCode, material_provided: qty, work_date: today })
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error || 'Failed to save', 'error'); return; }
        showToast(`Material saved: ${qty} pcs for ${wsCode}`, 'success');
        await onFeedLineChange();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ==========================================
// HOURLY PROCEDURE
// ==========================================
const hourlyState = {
    lineId: null,
    processes: [],
    workstations: null,
    targetQty: 0,
    hourlyTarget: 0,
    selectedProcess: null,
    selectedWorkstation: null,
    progressData: [],
    changeoverActive: false,
    incomingProductId: null,
    incomingProductName: '',
    activeTarget: 0
};

const SHORTFALL_REASONS = [
    'WORKSTATION COMBINED',
    'WORKMANSHIP PROBLEM',
    'MC BREAKDOWN',
    'FEEDING NOT RECEIVED',
    'INEFFICIENT',
    'TECHNICAL ISSUES',
    'COMMERCIAL PACKAGE ISSUES'
];

// Returns list of workstation codes (or process names) that have output below
// target for the given hour but NO shortfall reason recorded.
function checkHourPendingReasons(hour) {
    const hourlyTarget = hourlyState.hourlyTarget;
    if (!hourlyTarget || !hourlyState.lineId) return [];
    const violations = [];

    if (hourlyState.workstations?.length > 0) {
        hourlyState.workstations.forEach(ws => {
            const wsProcessIds = (ws.processes || []).map(p => parseInt(p.process_id || p.id, 10));
            const progress = hourlyState.progressData.find(
                d => wsProcessIds.includes(parseInt(d.process_id, 10)) && parseInt(d.hour_slot, 10) === hour
            );
            if (progress) {
                const qty = parseInt(progress.quantity || 0, 10);
                if (qty > 0 && qty < hourlyTarget && !progress.shortfall_reason) {
                    violations.push(ws.workstation_code);
                }
            }
        });
    } else {
        hourlyState.processes.forEach(p => {
            const progress = hourlyState.progressData.find(
                d => parseInt(d.process_id, 10) === p.id && parseInt(d.hour_slot, 10) === hour
            );
            if (progress) {
                const qty = parseInt(progress.quantity || 0, 10);
                if (qty > 0 && qty < hourlyTarget && !progress.shortfall_reason) {
                    violations.push(p.workstation_code || p.operation_name || `Process ${p.id}`);
                }
            }
        });
    }
    return violations;
}

// Show a blocking banner at the top of hourly-summary, listing workstations that
// need a reason before the hour can be changed.
function showReasonRequiredBanner(violations) {
    const container = document.getElementById('hourly-summary');
    if (!container) return;
    const existing = document.getElementById('reason-required-banner');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.id = 'reason-required-banner';
    banner.style.cssText = 'background:#fee2e2;border:2px solid #fca5a5;border-radius:10px;padding:14px 18px;margin-bottom:14px;display:flex;align-items:flex-start;gap:12px;';
    banner.innerHTML = `
        <div style="font-size:28px;line-height:1;flex-shrink:0;">&#9888;</div>
        <div style="flex:1;">
            <div style="font-weight:700;font-size:15px;color:#991b1b;margin-bottom:4px;">PLEASE UPDATE REASON</div>
            <div style="font-size:13px;color:#b91c1c;">
                The following workstation(s) have output below target with no reason provided.
                You cannot move to the next hour until all reasons are updated.
            </div>
            <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
                ${violations.map(v => `<span style="background:#fecaca;color:#991b1b;border-radius:6px;padding:3px 10px;font-weight:700;font-size:13px;">${v}</span>`).join('')}
            </div>
        </div>
        <button onclick="document.getElementById('reason-required-banner').remove()"
            style="flex-shrink:0;background:none;border:none;font-size:20px;color:#991b1b;cursor:pointer;line-height:1;">&times;</button>
    `;
    container.insertBefore(banner, container.firstChild);
    banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

window._hourlyMode = 'regular';

async function loadHourlyProcedure() {
    const content = document.getElementById('supervisor-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const response = await fetch(`${API_BASE}/supervisor/lines`);
        const result = await response.json();
        const lines = result.data || [];
        const today = new Date().toISOString().slice(0, 10);
        const hour = new Date().getHours();
        const hourStart = 8;
        const hourEnd = 19;
        const defaultHour = Math.min(Math.max(hour, hourStart), hourEnd);

        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Hourly Procedure</h1>
                    <p class="page-subtitle">Record hourly output by workstation</p>
                </div>
                <span class="status-badge">${today}</span>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Select Line & Date</h3>
                </div>
                <div class="card-body">
                    <div class="hourly-controls">
                        <div class="hc-field" style="flex:2; min-width:160px;">
                            <label class="form-label">Line</label>
                            <select class="form-control" id="hourly-line">
                                <option value="">Select Line</option>
                                ${lines.map(l => `<option value="${l.id}">${l.line_name} (${l.line_code})${l.product_code ? ' - ' + l.product_code : ''}</option>`).join('')}
                            </select>
                        </div>
                        <div class="hc-field" style="min-width:130px;">
                            <label class="form-label">Date</label>
                            <input type="date" class="form-control" id="hourly-date" value="${today}">
                        </div>
                        <div class="hc-field" id="hourly-hour-wrap" style="min-width:90px;">
                            <label class="form-label">Hour</label>
                            <select class="form-control" id="hourly-hour">
                                ${Array.from({ length: hourEnd - hourStart + 1 }).map((_, i) => {
                                    const v = hourStart + i;
                                    return `<option value="${v}" ${v === defaultHour ? 'selected' : ''}>${String(v).padStart(2, '0')}:00</option>`;
                                }).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="hourly-tabs">
                        <button id="ht-regular-btn" class="hourly-tab-btn active-regular" onclick="switchHourlyMode('regular')">
                            Regular Shift
                        </button>
                        <button id="ht-ot-btn" class="hourly-tab-btn" onclick="switchHourlyMode('ot')">
                            OT Progress
                        </button>
                    </div>
                </div>
            </div>

            <div id="hourly-regular-section">
                <div id="hourly-summary" style="margin-top:16px;"></div>

                <div id="hourly-scan-panel" class="card" style="margin-top:16px; display:none;">
                    <div class="card-header">
                        <h3 class="card-title">Scan Workstation QR</h3>
                        <button class="btn btn-secondary btn-sm" id="hourly-cancel-scan">Cancel</button>
                    </div>
                    <div class="card-body">
                        <div class="camera-panel">
                            <video id="hourly-camera" playsinline muted style="width:100%; max-height:300px; border-radius:8px; background:#000;"></video>
                        </div>
                    </div>
                </div>

                <div id="hourly-entry-panel" class="card" style="margin-top:16px; display:none;">
                    <div class="card-header">
                        <h3 class="card-title" id="hourly-entry-title">Enter Output</h3>
                    </div>
                    <div class="card-body">
                        <div id="hourly-entry-form"></div>
                    </div>
                </div>
            </div>

            <div id="hourly-ot-section" style="display:none; margin-top:16px;">
                <div id="ot-summary-area"></div>
                <div id="ot-scan-panel" class="card" style="margin-top:16px; display:none;">
                    <div class="card-header">
                        <h3 class="card-title" id="ot-scan-label">Scan Worker QR</h3>
                        <button class="btn btn-secondary btn-sm" onclick="cancelOtScan()">Cancel</button>
                    </div>
                    <div class="card-body">
                        <div class="camera-panel">
                            <video id="ot-camera" playsinline muted style="width:100%; max-height:300px; border-radius:8px; background:#000;"></video>
                        </div>
                        <div id="ot-scan-result" style="margin-top:12px;"></div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('hourly-line').addEventListener('change', onHourlyLineChange);

        // Date change — guard: must not have pending reasons for current hour
        const dateSel = document.getElementById('hourly-date');
        dateSel.addEventListener('focus', function () { this._prevValue = this.value; });
        dateSel.addEventListener('change', function () {
            if (window._hourlyMode === 'ot') {
                loadOtPlanList(this.value);
                return;
            }
            const prevHour = parseInt(document.getElementById('hourly-hour')?.value || 0, 10);
            const violations = checkHourPendingReasons(prevHour);
            if (violations.length > 0) {
                this.value = this._prevValue || this.value; // revert
                showReasonRequiredBanner(violations);
                return;
            }
            refreshHourlySummary();
        });

        // Hour change — guard: must resolve all shortfalls for the PREVIOUS hour first
        const hourSel = document.getElementById('hourly-hour');
        hourSel.addEventListener('mousedown', function () { this._prevValue = this.value; });
        hourSel.addEventListener('change', function () {
            if (window._hourlyMode === 'ot') return;
            const prevHour = parseInt(this._prevValue || this.value, 10);
            const violations = checkHourPendingReasons(prevHour);
            if (violations.length > 0) {
                this.value = prevHour; // revert to blocked hour
                showReasonRequiredBanner(violations);
                return;
            }
            this._prevValue = this.value;
            refreshHourlySummary();
        });

        document.getElementById('hourly-cancel-scan').addEventListener('click', cancelHourlyScan);

        window._hourlyMode = 'regular';
        hourlyState.lineId = null;
        hourlyState.processes = [];
        hourlyState.selectedProcess = null;
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function switchHourlyMode(mode) {
    window._hourlyMode = mode;
    const regularBtn = document.getElementById('ht-regular-btn');
    const otBtn = document.getElementById('ht-ot-btn');
    const regularSec = document.getElementById('hourly-regular-section');
    const otSec = document.getElementById('hourly-ot-section');
    const hourWrap = document.getElementById('hourly-hour-wrap');
    if (!regularBtn || !otBtn) return;
    if (mode === 'ot') {
        regularBtn.className = 'hourly-tab-btn';
        otBtn.className = 'hourly-tab-btn active-ot';
        if (regularSec) regularSec.style.display = 'none';
        if (otSec) otSec.style.display = '';
        if (hourWrap) hourWrap.style.display = 'none';
        stopCamera();
        const date = document.getElementById('hourly-date')?.value || new Date().toISOString().slice(0, 10);
        loadOtPlanList(date);
    } else {
        regularBtn.className = 'hourly-tab-btn active-regular';
        otBtn.className = 'hourly-tab-btn';
        if (regularSec) regularSec.style.display = '';
        if (otSec) otSec.style.display = 'none';
        if (hourWrap) hourWrap.style.display = '';
        stopCamera();
    }
}

async function onHourlyLineChange() {
    const lineId = document.getElementById('hourly-line').value;
    hourlyState.lineId = lineId;
    hourlyState.selectedProcess = null;
    hourlyState.workstations = null;
    stopCamera();
    hideHourlyPanels();

    if (window._hourlyMode === 'ot') {
        // OT tab shows all lines — line selection in regular tab is irrelevant here
        return;
    }

    const container = document.getElementById('hourly-summary');
    if (!lineId) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = '<div class="loading-overlay" style="position:relative;padding:40px 0;"><div class="spinner"></div></div>';

    try {
        const date = document.getElementById('hourly-date')?.value || new Date().toISOString().slice(0, 10);
        const response = await fetch(`${API_BASE}/supervisor/processes/${lineId}?date=${date}`);
        const result = await response.json();
        hourlyState.processes = result.data || [];
        hourlyState.hasDailyPlan = result.has_daily_plan === true;
        hourlyState.workstations = (result.has_plan && result.workstation_plan?.length > 0) ? result.workstation_plan : null;
        hourlyState.changeoverActive = !!result.changeover_active;
        hourlyState.incomingProductId = result.incoming_product_id || null;
        hourlyState.incomingProductName = result.incoming_product_name || result.incoming_product_code || '';
        hourlyState.activeTarget = result.active_target || 0;
        hourlyState.primaryTarget = result.primary_target || result.active_target || 0;
        hourlyState.incomingTarget = result.incoming_target || 0;
        hourlyState.perHourTarget = result.per_hour_target || 0;
        hourlyState.perHourIncomingTarget = result.per_hour_incoming_target || 0;
        hourlyState.workingHours = result.working_hours || 8;
        hourlyState.inTime = result.in_time || '08:00';
        hourlyState.outTime = result.out_time || '17:00';
        hourlyState.targetQty = hourlyState.activeTarget || (hourlyState.processes.length > 0 ? (hourlyState.processes[0].target_qty || 0) : 0);
        hourlyState.hourlyTarget = result.per_hour_target ? Math.round(result.per_hour_target) : (hourlyState.targetQty > 0 ? Math.round(hourlyState.targetQty / (result.working_hours || 8)) : 0);
        await refreshHourlySummary();
    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

async function refreshHourlySummary() {
    if (!hourlyState.lineId) return;
    const container = document.getElementById('hourly-summary');
    const date = document.getElementById('hourly-date')?.value;
    const hour = document.getElementById('hourly-hour')?.value;

    if (!date || !hour) return;

    // Fetch progress data for this line/date
    try {
        const response = await fetch(`${API_BASE}/supervisor/progress?line_id=${hourlyState.lineId}&work_date=${date}`);
        const result = await response.json();
        hourlyState.progressData = result.data || [];
    } catch (err) {
        hourlyState.progressData = [];
    }

    renderHourlySummary();
}

function computeTotalOutput(progressData, workstations) {
    // Use WS01's first process as the line-output representative (all workstations produce same qty)
    if (!workstations?.length || !progressData?.length) return 0;
    const ws1 = workstations[0];
    const pid = parseInt(ws1.processes?.[0]?.process_id || ws1.processes?.[0]?.id || 0, 10);
    if (!pid) return 0;
    return progressData
        .filter(d => parseInt(d.process_id, 10) === pid)
        .reduce((s, d) => s + parseInt(d.quantity || 0, 10), 0);
}

async function activateChangeover(lineId, workDate) {
    if (!confirm('Start changeover? Hourly output tracking will switch to the changeover product.')) return;
    const btn = document.getElementById('btn-start-co');
    if (btn) { btn.disabled = true; btn.textContent = 'Activating\u2026'; }
    try {
        const r = await fetch(`${API_BASE}/supervisor/changeover/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: lineId, work_date: workDate })
        });
        const data = await r.json();
        if (!data.success) {
            alert(data.error);
            if (btn) { btn.disabled = false; btn.textContent = '\u21ba Start Changeover'; }
            return;
        }
        await onHourlyLineChange();
    } catch (err) {
        alert(err.message);
        if (btn) { btn.disabled = false; btn.textContent = '\u21ba Start Changeover'; }
    }
}

// Per-workstation changeover — called from each WS row's "Start CO" button
// force=true skips the target warning (user confirmed the prompt)
async function activateWsChangeover(wsCode, date, force) {
    const lineId = hourlyState.lineId;
    if (!lineId || !date) return;
    try {
        const r = await fetch(`${API_BASE}/supervisor/changeover/activate-workstation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: lineId, work_date: date, workstation_code: wsCode, force: !!force })
        });
        const data = await r.json();
        if (data.target_warning) {
            // Show confirmation prompt with warning
            if (confirm(`${data.message}\n\nClick OK to proceed with changeover anyway.`)) {
                await activateWsChangeover(wsCode, date, true);
            }
            return;
        }
        if (!data.success) { alert(data.error || 'Failed to activate changeover'); return; }
        showToast(`Changeover started for ${wsCode}`, 'success');
        await onHourlyLineChange();
    } catch (err) {
        alert(err.message);
    }
}

// Employee reassignment for a workstation in changeover (same API as morning assign)
function openWsChangeoverEmployeeChange(wsCode, linePlanWsId) {
    const lineId = hourlyState.lineId;
    const date = document.getElementById('hourly-date')?.value || '';
    if (!lineId || !date) return;

    // Reuse morning procedure's scan/assign flow — set the state and open the morning scan panel
    morningState.selectedWorkstation = wsCode;
    morningState.selectedWorkstationPlanId = linePlanWsId || null;
    morningState.scannedEmployee = null;

    // Build an inline modal for employee selection (dropdown + scan option)
    const existing = document.getElementById('co-emp-modal');
    if (existing) existing.remove();

    // Build employee options from morningState employees (loaded at morning procedure time)
    const employees = morningState.employees || [];
    const empOptions = employees.map(e =>
        `<option value="${e.id}">${e.emp_code} - ${e.emp_name}</option>`
    ).join('');

    const modal = document.createElement('div');
    modal.id = 'co-emp-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:3000;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:24px;width:min(400px,95vw);box-shadow:0 20px 60px rgba(0,0,0,.3);">
            <h3 style="margin:0 0 16px;font-size:15px;font-weight:700;">Change Employee — ${wsCode} (Changeover)</h3>
            <div style="margin-bottom:12px;">
                <input type="text" id="co-emp-search" placeholder="🔍 Search by name or code…"
                    style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;margin-bottom:6px;"
                    oninput="filterCoEmpSelect(this)">
                <select id="co-emp-select" size="6"
                    style="width:100%;border:1px solid #d1d5db;border-radius:6px;font-size:13px;padding:4px;">
                    <option value="">— No employee —</option>
                    ${empOptions}
                </select>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button onclick="document.getElementById('co-emp-modal').remove()"
                    style="padding:7px 18px;background:#f1f5f9;color:#374151;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font-size:13px;">Cancel</button>
                <button onclick="confirmCoEmpAssign(${JSON.stringify(wsCode)}, ${linePlanWsId || 'null'})"
                    style="padding:7px 20px;background:#7c3aed;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Assign</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function filterCoEmpSelect(searchInput) {
    const q = searchInput.value.toLowerCase();
    const sel = document.getElementById('co-emp-select');
    if (!sel) return;
    Array.from(sel.options).forEach(opt => {
        opt.style.display = (!opt.value || opt.text.toLowerCase().includes(q)) ? '' : 'none';
    });
}

async function confirmCoEmpAssign(wsCode, linePlanWsId) {
    const sel = document.getElementById('co-emp-select');
    const empId = sel?.value;
    const lineId = hourlyState.lineId;
    const date = document.getElementById('hourly-date')?.value || '';
    if (!lineId || !date) return;
    try {
        const r = await fetch(`${API_BASE}/supervisor/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: lineId,
                work_date: date,
                workstation_code: wsCode,
                line_plan_workstation_id: linePlanWsId || null,
                employee_id: empId ? parseInt(empId, 10) : null
            })
        });
        const result = await r.json();
        if (!result.success) throw new Error(result.error || 'Assignment failed');
        document.getElementById('co-emp-modal')?.remove();
        showToast(`Employee updated for ${wsCode}`, 'success');
        await onHourlyLineChange();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ─── PER-WORKSTATION CHANGEOVER INLINE FLOW ───────────────────────────────────

const coPromptState = {
    wsCode: null, wsId: null, date: null,
    origEmpId: null, origEmpCode: null, origEmpName: null,
    coSuggestedEmpId: null, coSuggestedEmpCode: null, coSuggestedEmpName: null,
    scannedEmployee: null
};

function _coBtnHtml(wsCode, wsId, date, empId, empCode, empName, coEmpId, coEmpCode, coEmpName) {
    const safeCode = (empCode || '').replace(/"/g, '&quot;');
    const safeName = (empName || '').replace(/"/g, '&quot;');
    const safeCoCode = (coEmpCode || '').replace(/"/g, '&quot;');
    const safeCoPName = (coEmpName || '').replace(/"/g, '&quot;');
    const coHint = coEmpId ? ` <span style="font-size:10px;color:#7c3aed;">IE: ${coEmpCode}</span>` : '';
    return `<button class="btn ws-card-action" style="background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;"
        data-ws-code="${wsCode}" data-ws-id="${wsId}" data-date="${date}"
        data-emp-id="${empId || ''}" data-emp-code="${safeCode}" data-emp-name="${safeName}"
        data-co-emp-id="${coEmpId || ''}" data-co-emp-code="${safeCoCode}" data-co-emp-name="${safeCoPName}"
        onclick="promptWsChangeover(this)">&#8652; Start CO${coHint}</button>`;
}

function promptWsChangeover(btn) {
    stopCamera();
    const wsCode = btn.dataset.wsCode;
    const wsId = parseInt(btn.dataset.wsId);
    const date = btn.dataset.date;
    const empId = btn.dataset.empId ? parseInt(btn.dataset.empId) : null;
    const empCode = btn.dataset.empCode || '';
    const empName = btn.dataset.empName || '';
    const coEmpId = btn.dataset.coEmpId ? parseInt(btn.dataset.coEmpId) : null;
    const coEmpCode = btn.dataset.coEmpCode || '';
    const coEmpName = btn.dataset.coEmpName || '';

    coPromptState.wsCode = wsCode;
    coPromptState.wsId = wsId;
    coPromptState.date = date;
    coPromptState.origEmpId = empId;
    coPromptState.origEmpCode = empCode;
    coPromptState.origEmpName = empName;
    coPromptState.coSuggestedEmpId = coEmpId;
    coPromptState.coSuggestedEmpCode = coEmpCode;
    coPromptState.coSuggestedEmpName = coEmpName;
    coPromptState.scannedEmployee = null;

    const card = document.getElementById(`hourly-ws-card-${wsId}`);
    if (!card) return;
    const footer = card.querySelector('.ws-card-footer');
    if (!footer) return;

    // IE suggestion block (shown when IE pre-assigned a CO employee)
    const ieSuggestionHtml = coEmpId ? `
        <div style="background:#f5f3ff;border:1px solid #c4b5fd;border-radius:8px;padding:10px 12px;margin-bottom:10px;">
            <p style="font-size:11px;font-weight:700;color:#7c3aed;margin:0 0 4px;text-transform:uppercase;letter-spacing:.4px;">IE Pre-Assigned</p>
            <p style="font-size:13px;font-weight:700;color:#5b21b6;margin:0;">&#128100; ${coEmpCode} — ${coEmpName}</p>
        </div>` : '';

    // Current employee line (only shown when different from IE suggestion or no suggestion)
    const isSameasSuggestion = coEmpId && empId === coEmpId;
    const currentEmpHtml = empId && !isSameasSuggestion
        ? `<p style="font-size:12px;color:#6b7280;margin:0 0 10px;">Currently: <strong>${empCode} — ${empName}</strong></p>`
        : (!empId ? `<p style="font-size:12px;color:#6b7280;margin:0 0 10px;">No employee currently assigned.</p>` : '');

    footer.innerHTML = `
        <div style="width:100%;padding:4px 0;">
            <p style="font-weight:700;color:#5b21b6;font-size:13px;margin:0 0 8px;">&#8652; Start Changeover — ${wsCode}</p>
            ${ieSuggestionHtml}
            ${currentEmpHtml}
            <div class="mismatch-actions">
                ${coEmpId ? `<button class="btn ws-card-action" style="background:#7c3aed;color:#fff;border:none;"
                    onclick="confirmWsCo(${coEmpId}, false)">&#10003; Confirm IE Assignment</button>` : ''}
                ${empId && !isSameasSuggestion ? `<button class="btn ws-card-action" style="background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;"
                    onclick="confirmWsCo(${empId}, false)">Keep Current (${empCode})</button>` : ''}
                ${!coEmpId && empId ? `<button class="btn ws-card-action" style="background:#7c3aed;color:#fff;border:none;"
                    onclick="confirmWsCo(${empId}, false)">Continue with ${empCode}</button>` : ''}
                <button class="btn ws-card-action" style="background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;"
                    onclick="startCoScan()">&#128247; Assign Different Employee</button>
                <button class="btn ws-card-action" style="background:#f1f5f9;color:#374151;border:1px solid #d1d5db;"
                    onclick="cancelCoPrompt()">Cancel</button>
            </div>
        </div>`;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function startCoScan() {
    const { wsId, wsCode } = coPromptState;
    if (!wsId || isNaN(wsId)) { showToast('Error: workstation state lost, please close and retry', 'error'); return; }

    const card = document.getElementById(`hourly-ws-card-${wsId}`);
    if (!card) { showToast('Error: card not found — please refresh', 'error'); return; }
    const footer = card.querySelector('.ws-card-footer');
    if (!footer) { showToast('Error: footer not found — please refresh', 'error'); return; }

    footer.innerHTML = `
        <div style="width:100%;padding:4px 0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
                <span style="font-size:13px;font-weight:600;color:#374151;">&#128247; Scan Employee QR — ${wsCode}</span>
                <button class="btn btn-secondary btn-sm" onclick="cancelCoPrompt()">Cancel</button>
            </div>
            <video id="co-camera-${wsId}" playsinline muted
                style="width:100%;border-radius:8px;background:#000;display:block;max-height:260px;"></video>
            <div id="co-scan-result-${wsId}" style="margin-top:10px;">
                <p style="color:#6b7280;font-size:13px;">Starting camera...</p>
            </div>
        </div>`;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    await startCamera(`co-camera-${wsId}`, `co-scan-result-${wsId}`, async (rawValue) => {
        stopCamera();
        const result = document.getElementById(`co-scan-result-${wsId}`);
        if (result) result.innerHTML = '<p style="color:#6b7280;font-size:13px;">Resolving employee...</p>';
        try {
            const r = await fetch(`${API_BASE}/supervisor/resolve-employee-by-qr`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employee_qr: rawValue })
            });
            const data = await r.json();
            if (!data.success || !data.data?.employee) {
                if (result) result.innerHTML = `
                    <p style="color:#dc2626;font-size:13px;">${data.error || 'Employee not found.'}</p>
                    <button class="btn ws-card-action" style="margin-top:6px;background:#f1f5f9;color:#374151;border:1px solid #d1d5db;"
                        onclick="startCoScan()">&#8635; Retry Scan</button>`;
                return;
            }
            coPromptState.scannedEmployee = data.data.employee;
            showCoEmployeeConfirm(data.data.employee);
        } catch (err) {
            const result2 = document.getElementById(`co-scan-result-${wsId}`);
            if (result2) result2.innerHTML = `<p style="color:#dc2626;font-size:13px;">${err.message}</p>`;
        }
    });

    // If camera failed to start, show inline message (startCamera shows a toast too)
    if (!scanning) {
        const result = document.getElementById(`co-scan-result-${wsId}`);
        if (result && result.querySelector('p')?.textContent === 'Starting camera...') {
            result.innerHTML = `<p style="color:#dc2626;font-size:13px;">Camera unavailable. Check permissions or use HTTPS.</p>
                <button class="btn ws-card-action" style="margin-top:6px;background:#f1f5f9;color:#374151;border:1px solid #d1d5db;"
                    onclick="cancelCoPrompt()">Back</button>`;
        }
    }
}

function showCoEmployeeConfirm(emp) {
    const { wsId, wsCode } = coPromptState;
    const card = document.getElementById(`hourly-ws-card-${wsId}`);
    if (!card) return;
    const footer = card.querySelector('.ws-card-footer');
    if (!footer) return;

    footer.innerHTML = `
        <div style="width:100%;padding:4px 0;">
            <p style="font-weight:700;color:#5b21b6;font-size:13px;margin:0 0 8px;">&#8652; Start Changeover — ${wsCode}</p>
            <p style="font-size:13px;color:#16a34a;margin:0 0 12px;">&#10003; ${emp.emp_code} — ${emp.emp_name}</p>
            <div class="mismatch-actions">
                <button class="btn ws-card-action" style="background:#7c3aed;color:#fff;border:none;"
                    onclick="confirmWsCo(${emp.id}, false)">Confirm CO</button>
                <button class="btn ws-card-action" style="background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;"
                    onclick="startCoScan()">&#128247; Scan Different</button>
                <button class="btn ws-card-action" style="background:#f1f5f9;color:#374151;border:1px solid #d1d5db;"
                    onclick="cancelCoPrompt()">Cancel</button>
            </div>
        </div>`;
}

async function confirmWsCo(employeeId, force) {
    const { wsCode, wsId, date } = coPromptState;
    const lineId = hourlyState.lineId;
    if (!lineId || !date || !wsCode) return;

    const card = document.getElementById(`hourly-ws-card-${wsId}`);
    const footer = card ? card.querySelector('.ws-card-footer') : null;

    try {
        const body = { line_id: lineId, work_date: date, workstation_code: wsCode, force: !!force };
        if (employeeId) body.employee_id = employeeId;

        const r = await fetch(`${API_BASE}/supervisor/changeover/activate-workstation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await r.json();

        if (data.target_warning) {
            if (footer) {
                footer.innerHTML = `
                    <div style="width:100%;padding:4px 0;">
                        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px;margin-bottom:10px;">
                            <p style="font-weight:700;color:#c2410c;margin:0 0 6px;">&#9888; Target Not Met</p>
                            <p style="font-size:13px;color:#374151;margin:0;">${data.message}</p>
                        </div>
                        <div class="mismatch-actions">
                            <button class="btn ws-card-action" style="background:#dc2626;color:#fff;border:none;"
                                onclick="confirmWsCo(${employeeId || 'null'}, true)">Proceed Anyway</button>
                            <button class="btn ws-card-action" style="background:#f1f5f9;color:#374151;border:1px solid #d1d5db;"
                                onclick="cancelCoPrompt()">Cancel</button>
                        </div>
                    </div>`;
            }
            return;
        }

        if (!data.success) { showToast(data.error || 'Failed to activate changeover', 'error'); return; }
        showToast(`Changeover started for ${wsCode}`, 'success');
        await onHourlyLineChange();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function cancelCoPrompt() {
    stopCamera();
    const { wsId, wsCode, date, origEmpId, origEmpCode, origEmpName, coSuggestedEmpId, coSuggestedEmpCode, coSuggestedEmpName } = coPromptState;
    if (wsId) {
        const card = document.getElementById(`hourly-ws-card-${wsId}`);
        const footer = card ? card.querySelector('.ws-card-footer') : null;
        if (footer) footer.innerHTML = _coBtnHtml(wsCode, wsId, date, origEmpId, origEmpCode, origEmpName, coSuggestedEmpId, coSuggestedEmpCode, coSuggestedEmpName);
    }
    Object.assign(coPromptState, { wsCode: null, wsId: null, date: null, origEmpId: null, origEmpCode: null, origEmpName: null, coSuggestedEmpId: null, coSuggestedEmpCode: null, coSuggestedEmpName: null, scannedEmployee: null });
}

function renderHourlySummary() {
    const container = document.getElementById('hourly-summary');
    const hour = parseInt(document.getElementById('hourly-hour')?.value || 0, 10);
    const hourlyTarget = hourlyState.hourlyTarget;
    const date = document.getElementById('hourly-date')?.value || '';

    // Changeover completion banner (shown when changeover is planned)
    let changeoverBanner = '';
    if (hourlyState.incomingProductId) {
        if (hourlyState.changeoverActive) {
            changeoverBanner = `
                <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;padding:10px 16px;margin-bottom:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                    <span style="background:#7c3aed;color:#fff;padding:3px 12px;border-radius:10px;font-weight:700;font-size:13px;">&#8652; CHANGEOVER ACTIVE</span>
                    <span style="color:#6d28d9;font-size:13px;font-weight:600;">${hourlyState.incomingProductName || 'Changeover product'}</span>
                </div>`;
        } else {
            const totalOutput = computeTotalOutput(hourlyState.progressData, hourlyState.workstations);
            const target = hourlyState.targetQty || 0;
            const pct = target > 0 ? Math.min(Math.round(totalOutput / target * 100), 999) : 0;
            const targetMet = pct >= 100;
            const pctColor = pct >= 100 ? '#16a34a' : pct >= 80 ? '#d97706' : '#6b7280';
            changeoverBanner = `
                <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 16px;margin-bottom:12px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
                    <span style="font-size:13px;color:#374151;">
                        Total Output: <strong>${totalOutput}</strong> / <strong>${target}</strong>
                        &nbsp;<span style="color:${pctColor};font-weight:700;">(${pct}%)</span>
                    </span>
                    <button onclick="activateChangeover(${hourlyState.lineId},'${date}')"
                        id="btn-start-co"
                        ${targetMet ? '' : 'disabled'}
                        style="margin-left:auto;padding:6px 18px;background:${targetMet ? '#7c3aed' : '#e5e7eb'};color:${targetMet ? '#fff' : '#9ca3af'};border:none;border-radius:6px;cursor:${targetMet ? 'pointer' : 'default'};font-weight:600;font-size:13px;transition:background 0.2s;"
                        title="${targetMet ? 'Click to start changeover to ' + (hourlyState.incomingProductName || 'changeover product') : 'Primary target not yet met (' + pct + '%)'}">
                        &#8652; Start Changeover
                    </button>
                </div>`;
        }
    }

    if (hourlyState.workstations?.length > 0) {
        // New model: display per workstation
        const workstations = hourlyState.workstations;
        if (!workstations.length) {
            container.innerHTML = '<div class="card"><div class="card-body"><div class="alert alert-info">No workstations found for this line.</div></div></div>';
            return;
        }

        const perHourTarget = hourlyState.perHourTarget || hourlyTarget || 0;
        const perHourIncoming = hourlyState.perHourIncomingTarget || 0;
        const hasChangeover = !!hourlyState.incomingProductId;

        const cards = workstations.map(ws => {
            const isWsChangeover = !!ws.ws_changeover_active;
            const wsHourlyTarget = isWsChangeover
                ? (ws.ws_changeover_target != null ? ws.ws_changeover_target : Math.round(perHourIncoming))
                : Math.round(perHourTarget);

            const wsProcessIds = (ws.processes || []).map(p => p.process_id || p.id);
            const progress = hourlyState.progressData.find(
                d => wsProcessIds.includes(parseInt(d.process_id)) && parseInt(d.hour_slot) === hour
            );
            const output = progress ? parseInt(progress.quantity || 0) : 0;
            const reason = progress?.shortfall_reason || '';

            const wsStatus = ws.ws_status || 'active';
            let workerHtml = '';
            if (wsStatus === 'vacant') {
                const deptTime = ws.departure_time ? new Date(ws.departure_time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
                workerHtml = `<span style="color:#dc2626;font-weight:700;">VACANT</span> <small style="color:#9ca3af;">${ws.assigned_emp_code || ''} left ${deptTime}</small>`;
            } else if (wsStatus === 'covered' && ws.coverage_type === 'combine') {
                workerHtml = `<span style="color:#7c3aed;font-size:11px;font-weight:700;">COMBINED</span> ${ws.covering_emp_code} – ${ws.covering_emp_name}<br><small style="color:#9ca3af;">also covers ${ws.covering_from_ws}</small>`;
            } else {
                workerHtml = ws.assigned_emp_name
                    ? `${ws.assigned_emp_code} – ${ws.assigned_emp_name}`
                    : '<span style="color:#dc2626;">Unassigned</span>';
            }

            const processList = (ws.processes || []).map(p => p.operation_name).join(', ');
            const workloadColor = ws.workload_pct > 100 ? '#dc2626' : ws.workload_pct > 85 ? '#d97706' : '#16a34a';
            const needsReason = output > 0 && wsHourlyTarget > 0 && output < wsHourlyTarget && !reason;

            // Block hourly input if no daily plan or no employee assigned
            const noDailyPlan = !hourlyState.hasDailyPlan;
            const noEmployee  = !ws.assigned_emp_name && wsStatus !== 'covered';

            // Status badge for card header
            let statusBadge = '';
            if (noDailyPlan) {
                statusBadge = `<span style="background:#f3f4f6;color:#6b7280;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">No Plan</span>`;
            } else if (noEmployee && wsStatus !== 'vacant') {
                statusBadge = `<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">Not Assigned</span>`;
            } else if (isWsChangeover) {
                const coTime = ws.ws_changeover_started_at ? new Date(ws.ws_changeover_started_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
                statusBadge = `<span style="background:#7c3aed;color:#fff;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">&#8652; CO${coTime ? ' '+coTime : ''}</span>`;
            } else if (wsStatus === 'vacant') {
                statusBadge = `<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">VACANT</span>`;
            } else if (needsReason) {
                statusBadge = `<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">&#9888; Needs Reason</span>`;
            } else if (output > 0 && wsHourlyTarget > 0 && output < wsHourlyTarget) {
                statusBadge = `<span style="background:#fef3c7;color:#d97706;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">Below target</span>`;
            } else if (output > 0 && output >= wsHourlyTarget) {
                statusBadge = `<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">On track</span>`;
            }

            const outputColor = output > 0 ? (output >= wsHourlyTarget ? '#16a34a' : '#dc2626') : 'inherit';

            // Footer buttons — block if no daily plan, no employee assigned, or vacant
            const enterOutputBtn = noDailyPlan
                ? `<button class="btn ws-card-action" style="background:#e5e7eb;color:#9ca3af;cursor:not-allowed;" disabled title="No production day plan set for this line">&#128683; No Plan</button>`
                : wsStatus === 'vacant'
                    ? `<button class="btn ws-card-action" style="background:#e5e7eb;color:#9ca3af;cursor:not-allowed;" disabled title="Workstation is vacant">Enter Output</button>`
                    : noEmployee
                        ? `<button class="btn ws-card-action" style="background:#fee2e2;color:#dc2626;border:1px solid #fecaca;cursor:not-allowed;" disabled title="No employee assigned — assign in morning procedure">&#128683; Not Assigned</button>`
                        : `<button class="btn btn-primary ws-card-action" onclick="openWorkstationHourlyEntry(${ws.id})">Enter Output</button>`;

            let coBtn = '';
            if (hasChangeover) {
                if (isWsChangeover) {
                    coBtn = `<button class="btn ws-card-action" style="background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;" onclick="openWsChangeoverEmployeeChange(${JSON.stringify(ws.workstation_code)}, ${ws.id || ws.primary_ws_id || 'null'})">Change Employee</button>`;
                } else {
                    const _coHint = ws.co_suggested_emp_id ? ` <span style="font-size:10px;color:#7c3aed;">IE: ${ws.co_suggested_emp_code || ''}</span>` : '';
                    coBtn = `<button class="btn ws-card-action" style="background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;"
                        data-ws-code="${ws.workstation_code}" data-ws-id="${ws.id}" data-date="${date}"
                        data-emp-id="${ws.assigned_employee_id || ''}"
                        data-emp-code="${(ws.assigned_emp_code || '').replace(/"/g, '&quot;')}"
                        data-emp-name="${(ws.assigned_emp_name || '').replace(/"/g, '&quot;')}"
                        data-co-emp-id="${ws.co_suggested_emp_id || ''}"
                        data-co-emp-code="${(ws.co_suggested_emp_code || '').replace(/"/g, '&quot;')}"
                        data-co-emp-name="${(ws.co_suggested_emp_name || '').replace(/"/g, '&quot;')}"
                        onclick="promptWsChangeover(this)">&#8652; Start CO${_coHint}</button>`;
                }
            }

            const reasonLine = reason && output > 0 && output < wsHourlyTarget
                ? `<div class="ws-card-row"><span class="ws-card-label">Reason</span><span style="font-size:12px;color:#6b7280;">${reason}</span></div>`
                : '';

            let cardClass = '';
            if (wsStatus === 'vacant' || needsReason || noEmployee) cardClass = 'ws-card--alert';
            else if (isWsChangeover) cardClass = 'ws-card--changeover';

            return `
                <div class="ws-card ${cardClass}" id="hourly-ws-card-${ws.id}">
                    <div class="ws-card-header">
                        <span class="ws-card-code">${ws.workstation_code} <span style="font-size:12px;font-weight:600;color:${workloadColor};">${parseFloat(ws.workload_pct||0).toFixed(0)}%</span></span>
                        <div class="ws-card-badges">${statusBadge}</div>
                    </div>
                    <div class="ws-card-body">
                        <div class="ws-card-row">
                            <span class="ws-card-label">Worker</span>
                            <span style="font-size:13px;">${workerHtml}</span>
                        </div>
                        <div class="ws-card-row">
                            <span class="ws-card-label">Processes</span>
                            <span style="font-size:12px;color:#6b7280;">${processList}</span>
                        </div>
                        <div class="ws-card-kpi">
                            <div class="ws-kpi-box">
                                <div class="ws-kpi-label">Target/hr</div>
                                <div class="ws-kpi-val">${wsHourlyTarget || '–'}</div>
                            </div>
                            <div class="ws-kpi-box">
                                <div class="ws-kpi-label">Output</div>
                                <div class="ws-kpi-val" style="color:${outputColor};">${output || '–'}</div>
                            </div>
                        </div>
                        ${reasonLine}
                    </div>
                    <div class="ws-card-footer">
                        ${enterOutputBtn}
                        ${coBtn}
                    </div>
                </div>`;
        }).join('');

        const perHourDisplay = Math.round(perHourTarget * 10) / 10;
        container.innerHTML = changeoverBanner + `
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Workstation Output Summary</h3>
                    <span style="font-size:0.85em; color:#6b7280;">
                        /hr: <strong>${perHourDisplay || '–'}</strong> &nbsp;|&nbsp;
                        Daily: <strong>${hourlyState.primaryTarget || hourlyState.targetQty || '–'}</strong>
                        ${hourlyState.incomingTarget ? ` &nbsp;|&nbsp; CO: <strong>${hourlyState.incomingTarget}</strong>` : ''}
                    </span>
                </div>
                <div class="card-body">
                    <div class="ws-cards-grid">${cards}</div>
                </div>
            </div>
        `;
        return;
    }

    // Fallback: no workstation plan — show flat process list
    const processes = hourlyState.processes;
    if (!processes.length) {
        container.innerHTML = '<div class="card"><div class="card-body"><div class="alert alert-info">No processes found for this line.</div></div></div>';
        return;
    }

    const procCards = processes.map(p => {
        const progress = hourlyState.progressData.find(
            d => parseInt(d.process_id) === p.id && parseInt(d.hour_slot) === hour
        );
        const output = progress ? parseInt(progress.quantity || 0) : 0;
        const reason = progress?.shortfall_reason || '';
        const workerHtml = p.assigned_emp_name
            ? `${p.assigned_emp_code} – ${p.assigned_emp_name}`
            : '<span style="color:#dc2626;">Unassigned</span>';

        const needsReason = output > 0 && hourlyTarget > 0 && output < hourlyTarget && !reason;
        const outputColor = output > 0 ? (output >= hourlyTarget ? '#16a34a' : '#dc2626') : 'inherit';

        let statusBadge = '';
        if (!p.assigned_emp_name) {
            statusBadge = `<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">Not Assigned</span>`;
        } else if (needsReason) {
            statusBadge = `<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">&#9888; Needs Reason</span>`;
        } else if (output > 0 && output < hourlyTarget) {
            statusBadge = `<span style="background:#fef3c7;color:#d97706;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">Below target</span>`;
        } else if (output >= hourlyTarget && output > 0) {
            statusBadge = `<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">On track</span>`;
        }

        const reasonLine = reason && output > 0 && output < hourlyTarget
            ? `<div class="ws-card-row"><span class="ws-card-label">Reason</span><span style="font-size:12px;color:#6b7280;">${reason}</span></div>`
            : '';

        const procNoEmployee = !p.assigned_emp_name;
        const procEnterBtn = procNoEmployee
            ? `<button class="btn ws-card-action" style="background:#fee2e2;color:#dc2626;border:1px solid #fecaca;cursor:not-allowed;" disabled title="No employee assigned — assign in morning procedure">&#128683; Not Assigned</button>`
            : `<button class="btn btn-primary ws-card-action" onclick="openHourlyEntry(${p.id})">Enter Output</button>`;

        return `
            <div class="ws-card ${needsReason || procNoEmployee ? 'ws-card--alert' : ''}" id="hourly-proc-card-${p.id}">
                <div class="ws-card-header">
                    <span class="ws-card-code">${p.workstation_code || p.group_name || '–'}</span>
                    <div class="ws-card-badges">${statusBadge}</div>
                </div>
                <div class="ws-card-body">
                    <div class="ws-card-row">
                        <span class="ws-card-label">Process</span>
                        <span style="font-size:12px;">${p.operation_code} – ${p.operation_name}</span>
                    </div>
                    <div class="ws-card-row">
                        <span class="ws-card-label">Worker</span>
                        <span style="font-size:13px;">${workerHtml}</span>
                    </div>
                    <div class="ws-card-kpi">
                        <div class="ws-kpi-box">
                            <div class="ws-kpi-label">Target/hr</div>
                            <div class="ws-kpi-val">${hourlyTarget || '–'}</div>
                        </div>
                        <div class="ws-kpi-box">
                            <div class="ws-kpi-label">Output</div>
                            <div class="ws-kpi-val" style="color:${outputColor};">${output || '–'}</div>
                        </div>
                    </div>
                    ${reasonLine}
                </div>
                <div class="ws-card-footer">
                    ${procEnterBtn}
                </div>
            </div>`;
    }).join('');

    container.innerHTML = changeoverBanner + `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Process Output Summary</h3>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span style="font-size:0.85em; color:#6b7280;">/hr: <strong>${hourlyTarget || '–'}</strong> | Daily: <strong>${hourlyState.targetQty || '–'}</strong></span>
                    <button class="btn btn-secondary btn-sm" onclick="startHourlyScan()">Scan QR</button>
                </div>
            </div>
            <div class="card-body">
                <div class="ws-cards-grid">${procCards}</div>
            </div>
        </div>
    `;
}

function startHourlyScan() {
    const scanPanel = document.getElementById('hourly-scan-panel');
    const entryPanel = document.getElementById('hourly-entry-panel');
    scanPanel.style.display = 'block';
    if (entryPanel) entryPanel.style.display = 'none';
    scanPanel.scrollIntoView({ behavior: 'smooth' });

    startCamera('hourly-camera', null, async (rawValue) => {
        stopCamera();
        scanPanel.style.display = 'none';

        const payload = parseScanPayload(rawValue);
        if (!payload) {
            showToast('Invalid QR code', 'error');
            return;
        }

        // Try to resolve process from QR
        try {
            const response = await fetch(`${API_BASE}/supervisor/resolve-process`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    line_id: hourlyState.lineId,
                    process_qr: rawValue
                })
            });
            const result = await response.json();
            if (result.success && result.data?.process) {
                openHourlyEntry(result.data.process.id);
                return;
            }
        } catch (err) { /* ignore */ }

        // Fallback: try matching by workstation_code from QR raw value
        const rawStr = payload.raw || payload.code || payload.workstation_code || String(payload.id || '');
        const match = hourlyState.processes.find(p =>
            (p.workstation_code && p.workstation_code.toLowerCase() === rawStr.toLowerCase()) ||
            (p.id === payload.id)
        );
        if (match) {
            openHourlyEntry(match.id);
        } else {
            showToast('Workstation not found for this line', 'error');
        }
    });
}

function cancelHourlyEntry() {
    hourlyState.selectedProcess = null;
    hourlyState.selectedWorkstation = null;
    refreshHourlySummary();
}

function openHourlyEntry(processId) {
    const process = hourlyState.processes.find(p => p.id === processId);
    if (!process) {
        showToast('Process not found', 'error');
        return;
    }
    hourlyState.selectedProcess = process;

    const hour = parseInt(document.getElementById('hourly-hour')?.value || 0, 10);
    const hourlyTarget = hourlyState.hourlyTarget;

    // Check if there's existing data
    const existing = hourlyState.progressData.find(
        d => parseInt(d.process_id) === processId && parseInt(d.hour_slot) === hour
    );
    const existingOutput = existing ? parseInt(existing.quantity || 0) : 0;
    const existingReason = existing?.shortfall_reason || '';

    // Inject entry form inline into this card's footer
    const card = document.getElementById(`hourly-proc-card-${processId}`);
    const footer = card ? card.querySelector('.ws-card-footer') : null;
    if (!footer) { showToast('Card not found', 'error'); return; }

    document.querySelectorAll('.hourly-inline-entry').forEach(el => el.remove());

    const workerInfo = process.assigned_emp_name
        ? `${process.assigned_emp_code} – ${process.assigned_emp_name}`
        : 'Unassigned';

    footer.innerHTML = `
        <div class="hourly-inline-entry" style="width:100%;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div>
                    <div style="font-weight:700;font-size:14px;">${process.workstation_code || process.group_name || ''} — Enter Output</div>
                    <div style="font-size:12px;color:#6b7280;">${workerInfo} &nbsp;|&nbsp; Hour: ${String(hour).padStart(2,'0')}:00 &nbsp;|&nbsp; Target: ${hourlyTarget || '–'}/hr</div>
                </div>
                <button class="btn btn-secondary btn-sm" onclick="cancelHourlyEntry()">Cancel</button>
            </div>

            <label class="form-label">Output Quantity</label>
            <input type="number" class="form-control output-qty-input" id="hourly-output-qty" min="0" value="${existingOutput || ''}" placeholder="0" style="margin-bottom:10px;">

            <div id="hourly-reason-section" style="margin-bottom:10px; display:${existingOutput > 0 && hourlyTarget > 0 && existingOutput < hourlyTarget ? 'block' : 'none'};">
                <label class="form-label" style="color:#dc2626;font-weight:700;">Reason for Shortfall (Required)</label>
                <select class="form-control reason-select" id="hourly-reason">
                    <option value="">-- Select Reason --</option>
                    ${SHORTFALL_REASONS.map(r => `<option value="${r}" ${existingReason === r ? 'selected' : ''}>${r}</option>`).join('')}
                </select>
                <div id="hourly-reason-warning" style="display:none;color:#dc2626;font-weight:600;margin-top:6px;padding:6px 10px;background:#fef2f2;border-radius:6px;border:1px solid #fecaca;">
                    &#9888; Please Update Reason
                </div>
            </div>

            <div class="entry-form-actions">
                <button class="btn btn-primary" id="hourly-save-btn">Save Output</button>
                <button class="btn btn-secondary" id="hourly-entry-cancel" onclick="cancelHourlyEntry()">Cancel</button>
            </div>
        </div>`;

    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const outputInput = document.getElementById('hourly-output-qty');
    outputInput?.focus();

    outputInput?.addEventListener('input', () => {
        const val = parseInt(outputInput.value || 0, 10);
        const showReason = hourlyTarget > 0 && val > 0 && val < hourlyTarget;
        document.getElementById('hourly-reason-section').style.display = showReason ? 'block' : 'none';
        document.getElementById('hourly-reason-warning').style.display = 'none';
    });
    document.getElementById('hourly-save-btn')?.addEventListener('click', saveHourlyOutput);
}

// New workstation-based entry (uses workstation_plan_id for fan-out)
function openWorkstationHourlyEntry(workstationPlanId) {
    const ws = hourlyState.workstations?.find(w => w.id === workstationPlanId);
    if (!ws) { showToast('Workstation not found', 'error'); return; }
    hourlyState.selectedWorkstation = ws;
    hourlyState.selectedProcess = null;

    const hour = parseInt(document.getElementById('hourly-hour')?.value || 0, 10);
    const hourlyTarget = hourlyState.hourlyTarget;

    const wsProcessIds = (ws.processes || []).map(p => p.process_id || p.id);
    const existing = hourlyState.progressData.find(
        d => wsProcessIds.includes(parseInt(d.process_id)) && parseInt(d.hour_slot) === hour
    );
    const existingOutput = existing ? parseInt(existing.quantity || 0) : 0;
    const isCombined = ws.coverage_type === 'combine';
    const existingReason = existing?.shortfall_reason || (isCombined ? 'WORKSTATION COMBINED' : '');

    // Inject entry form inline into this card's footer
    const card = document.getElementById(`hourly-ws-card-${workstationPlanId}`);
    const footer = card ? card.querySelector('.ws-card-footer') : null;
    if (!footer) { showToast('Card not found', 'error'); return; }

    // Close any previously open inline hourly entry
    document.querySelectorAll('.hourly-inline-entry').forEach(el => el.remove());

    const processList = (ws.processes || []).map(p => p.operation_name).join(' → ');
    const workerInfo = ws.assigned_emp_name
        ? `${ws.assigned_emp_code} – ${ws.assigned_emp_name}`
        : '<span style="color:#dc2626;">Unassigned</span>';

    footer.innerHTML = `
        <div class="hourly-inline-entry" style="width:100%;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div>
                    <div style="font-weight:700;font-size:14px;">${ws.workstation_code} — Enter Output</div>
                    <div style="font-size:12px;color:#6b7280;">${workerInfo} &nbsp;|&nbsp; Hour: ${String(hour).padStart(2,'0')}:00 &nbsp;|&nbsp; Target: ${hourlyTarget || '–'}/hr</div>
                </div>
                <button class="btn btn-secondary btn-sm" onclick="cancelHourlyEntry()">Cancel</button>
            </div>
            <div style="font-size:11px;color:#9ca3af;margin-bottom:10px;">${processList}</div>

            <label class="form-label">Output Quantity</label>
            <input type="number" class="form-control output-qty-input" id="hourly-output-qty" min="0" value="${existingOutput || ''}" placeholder="0" style="margin-bottom:10px;">

            ${isCombined ? `<div style="background:#ede9fe;border:1px solid #c4b5fd;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#5b21b6;">
                &#9888; Combined — reason pre-set to WORKSTATION COMBINED.
            </div>` : ''}

            <div id="hourly-reason-section" style="margin-bottom:10px; display:${existingOutput > 0 && hourlyTarget > 0 && existingOutput < hourlyTarget ? 'block' : 'none'};">
                <label class="form-label" style="color:#dc2626;font-weight:700;">Reason for Shortfall (Required)</label>
                <select class="form-control reason-select" id="hourly-reason">
                    <option value="">-- Select Reason --</option>
                    ${SHORTFALL_REASONS.map(r => `<option value="${r}" ${existingReason === r ? 'selected' : ''}>${r}</option>`).join('')}
                </select>
                <div id="hourly-reason-warning" style="display:none;color:#dc2626;font-weight:600;margin-top:6px;padding:6px 10px;background:#fef2f2;border-radius:6px;border:1px solid #fecaca;">
                    &#9888; Please select a shortfall reason
                </div>
            </div>

            <div class="entry-form-actions">
                <button class="btn btn-primary" id="hourly-save-btn">Save Output</button>
                <button class="btn btn-secondary" id="hourly-entry-cancel" onclick="cancelHourlyEntry()">Cancel</button>
            </div>
        </div>`;

    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const outputInput = document.getElementById('hourly-output-qty');
    outputInput?.focus();

    outputInput?.addEventListener('input', () => {
        const val = parseInt(outputInput.value || 0, 10);
        const showReason = hourlyTarget > 0 && val > 0 && val < hourlyTarget;
        document.getElementById('hourly-reason-section').style.display = showReason ? 'block' : 'none';
        document.getElementById('hourly-reason-warning').style.display = 'none';
        if (showReason && isCombined) {
            const sel = document.getElementById('hourly-reason');
            if (sel && !sel.value) sel.value = 'WORKSTATION COMBINED';
        }
    });
    document.getElementById('hourly-save-btn')?.addEventListener('click', saveWorkstationHourlyOutput);
}

async function saveWorkstationHourlyOutput() {
    const ws = hourlyState.selectedWorkstation;
    if (!ws) return;

    const lineId = hourlyState.lineId;
    const date = document.getElementById('hourly-date')?.value;
    const hour = document.getElementById('hourly-hour')?.value;
    const output = parseInt(document.getElementById('hourly-output-qty')?.value || 0, 10);
    const hourlyTarget = hourlyState.hourlyTarget;
    const reason = document.getElementById('hourly-reason')?.value || '';
    const warningEl = document.getElementById('hourly-reason-warning');

    if (!lineId || !date || !hour) { showToast('Line, date and hour are required', 'error'); return; }
    if (output < 0) { showToast('Output must be 0 or more', 'error'); return; }

    if (hourlyTarget > 0 && output > 0 && output < hourlyTarget && !reason) {
        if (warningEl) warningEl.style.display = 'block';
        showToast('Please select a shortfall reason', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/supervisor/progress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: lineId,
                workstation_plan_id: ws.id,
                work_date: date,
                hour_slot: parseInt(hour, 10),
                quantity: output,
                forwarded_quantity: output,
                remaining_quantity: 0,
                qa_rejection: 0,
                shortfall_reason: (hourlyTarget > 0 && output > 0 && output < hourlyTarget) ? reason : null
            })
        });
        const result = await response.json();
        if (!result.success) { showToast(result.error || 'Failed to save output', 'error'); return; }

        showToast('Output saved', 'success');
        document.getElementById('hourly-entry-panel').style.display = 'none';
        hourlyState.selectedWorkstation = null;
        await refreshHourlySummary();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function saveHourlyOutput() {
    const process = hourlyState.selectedProcess;
    if (!process) return;

    const lineId = hourlyState.lineId;
    const date = document.getElementById('hourly-date')?.value;
    const hour = document.getElementById('hourly-hour')?.value;
    const output = parseInt(document.getElementById('hourly-output-qty')?.value || 0, 10);
    const hourlyTarget = hourlyState.hourlyTarget;
    const reasonSelect = document.getElementById('hourly-reason');
    const reason = reasonSelect?.value || '';
    const warningEl = document.getElementById('hourly-reason-warning');

    if (!lineId || !date || !hour) {
        showToast('Line, date and hour are required', 'error');
        return;
    }
    if (output < 0) {
        showToast('Output must be 0 or more', 'error');
        return;
    }

    // Check if reason is required (output below target)
    if (hourlyTarget > 0 && output > 0 && output < hourlyTarget) {
        if (!reason) {
            if (warningEl) warningEl.style.display = 'block';
            showToast('Please Update Reason', 'error');
            return;
        }
    }

    try {
        const response = await fetch(`${API_BASE}/supervisor/progress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: lineId,
                process_id: process.id,
                work_date: date,
                hour_slot: parseInt(hour, 10),
                quantity: output,
                forwarded_quantity: output,
                remaining_quantity: 0,
                qa_rejection: 0,
                remarks: '',
                shortfall_reason: (hourlyTarget > 0 && output > 0 && output < hourlyTarget) ? reason : null
            })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error || 'Failed to save output', 'error');
            return;
        }

        showToast('Output saved successfully', 'success');

        // Hide entry panel and refresh
        const entryPanel = document.getElementById('hourly-entry-panel');
        if (entryPanel) entryPanel.style.display = 'none';
        hourlyState.selectedProcess = null;

        await refreshHourlySummary();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function cancelHourlyScan() {
    stopCamera();
    const scanPanel = document.getElementById('hourly-scan-panel');
    if (scanPanel) scanPanel.style.display = 'none';
}

function hideHourlyPanels() {
    const scanPanel = document.getElementById('hourly-scan-panel');
    const entryPanel = document.getElementById('hourly-entry-panel');
    if (scanPanel) scanPanel.style.display = 'none';
    if (entryPanel) entryPanel.style.display = 'none';
}

// ==========================================
// OT PROGRESS SECTION
// ==========================================
const otPlanState = {
    lineId: null,
    date: null,
    otPlan: null,
    workstations: [],
    employees: [],
    selectedWsCode: null,
    detailsLineId: null,
    detailsLineName: null,
    detailsLineCode: null
};

// ─── OT Plan List View ────────────────────────────────────────────────────────

async function loadOtPlanList(date) {
    const area = document.getElementById('ot-summary-area');
    if (!area) return;
    otPlanState.date = date;
    otPlanState.detailsLineId = null;
    area.innerHTML = '<div class="loading-overlay" style="position:relative;padding:40px 0;"><div class="spinner"></div></div>';
    try {
        const r = await fetch(`${API_BASE}/daily-plans?date=${date}`);
        const result = await r.json();
        if (!result.success) throw new Error(result.error || 'Failed to load plans');
        renderOtPlanList(result.plans || [], result.lines || [], date);
    } catch (err) {
        area.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function renderOtPlanList(plans, allLines, date) {
    const area = document.getElementById('ot-summary-area');
    if (!area) return;
    const planMap = {};
    plans.forEach(p => { planMap[p.line_id] = p; });

    const rows = allLines.map(line => {
        const plan = planMap[line.id];
        const otEnabled = plan?.ot_enabled || false;
        const product = plan ? `${plan.product_code} - ${plan.product_name}` : '—';
        const otTarget = plan?.overtime_target || '';
        const disabledAttr = otEnabled ? '' : 'disabled';
        const dimStyle = otEnabled ? '' : 'opacity:0.45;';
        return `<tr>
            <td>
                <strong>${line.line_code}</strong>
                <div style="color:var(--secondary);font-size:12px;">${line.line_name}</div>
            </td>
            <td style="${dimStyle}">${product}</td>
            <td>
                <input type="number" class="form-control" id="ot-list-target-${line.id}"
                    value="${otTarget}" min="0" style="width:90px;" ${!otEnabled ? 'disabled' : ''}>
            </td>
            <td>
                <button onclick="toggleOtEnabled(${line.id}, '${date}', ${otEnabled})"
                    class="btn btn-sm" style="min-width:110px;background:${otEnabled ? '#dcfce7' : '#f3f4f6'};color:${otEnabled ? '#16a34a' : '#6b7280'};border:1px solid ${otEnabled ? '#bbf7d0' : '#e5e7eb'};">
                    ${otEnabled ? '● OT Enabled' : '○ Enable OT'}
                </button>
            </td>
            <td>
                <div class="action-btns">
                    <button class="btn btn-primary btn-sm"
                        onclick="openOtPlanDetails(${line.id}, ${JSON.stringify(line.line_name)}, '${date}', ${JSON.stringify(line.line_code)})"
                        ${!plan ? 'disabled' : ''}>Details</button>
                    <button class="btn btn-secondary btn-sm"
                        onclick="saveOtLineSummary(${line.id}, '${date}', ${plan?.product_id || 'null'})"
                        ${(!otEnabled || !plan) ? 'disabled' : ''}>Save</button>
                </div>
            </td>
        </tr>`;
    }).join('');

    const enabledCount = plans.filter(p => p.ot_enabled).length;
    area.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">OT Plan — ${date}</h3>
                <span style="font-size:0.85em;color:#6b7280;">${enabledCount} line(s) with OT enabled</span>
            </div>
            <div class="card-body table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Line</th>
                            <th>Product (Primary)</th>
                            <th>Target</th>
                            <th>Status</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:24px;color:#9ca3af;">No active lines found.</td></tr>'}</tbody>
                </table>
            </div>
        </div>`;
}

async function toggleOtEnabled(lineId, workDate, currentEnabled) {
    try {
        const r = await fetch(`${API_BASE}/daily-plans/ot-toggle`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: lineId, work_date: workDate, ot_enabled: !currentEnabled })
        });
        const result = await r.json();
        if (!result.success) throw new Error(result.error || 'Failed');
        showToast(!currentEnabled ? 'OT enabled' : 'OT disabled', 'success');
        await loadOtPlanList(workDate);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function saveOtLineSummary(lineId, date, productId) {
    if (!productId) { showToast('No product assigned to this line', 'error'); return; }
    const target = parseInt(document.getElementById(`ot-list-target-${lineId}`)?.value || 0, 10);
    try {
        const r = await fetch(`${API_BASE}/lines/${lineId}/ot-plan`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, product_id: productId, global_ot_minutes: 60, ot_target_units: target })
        });
        const result = await r.json();
        if (!result.success) throw new Error(result.error || 'Failed');
        showToast('OT target saved', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ─── OT Plan Details View ─────────────────────────────────────────────────────

async function openOtPlanDetails(lineId, lineName, date, lineCode) {
    const area = document.getElementById('ot-summary-area');
    if (!area) return;
    otPlanState.lineId = lineId;
    otPlanState.date = date;
    otPlanState.detailsLineId = lineId;
    otPlanState.detailsLineName = lineName;
    otPlanState.detailsLineCode = lineCode || '';
    area.innerHTML = '<div class="loading-overlay" style="position:relative;padding:40px 0;"><div class="spinner"></div></div>';
    try {
        const r = await fetch(`${API_BASE}/supervisor/ot-plan/${lineId}?date=${date}`);
        const result = await r.json();
        if (!result.success) throw new Error(result.error || 'Failed');
        if (!result.ot_enabled || !result.data) {
            area.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h3 class="card-title">${lineName} — OT Details</h3>
                        <button class="btn btn-secondary btn-sm" onclick="closeOtPlanDetails()">← Back</button>
                    </div>
                    <div class="card-body"><div class="alert alert-info">OT is not enabled for this line on ${date}.</div></div>
                </div>`;
            return;
        }
        otPlanState.otPlan = result.data.ot_plan;
        otPlanState.workstations = result.data.workstations || [];
        otPlanState.employees = result.data.employees || [];
        setupOtRealtimeListener();
        renderOtPlanSection();
    } catch (err) {
        area.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function closeOtPlanDetails() {
    otPlanState.detailsLineId = null;
    loadOtPlanList(otPlanState.date || new Date().toISOString().slice(0, 10));
}

function renderOtPlanSection() {
    const area = document.getElementById('ot-summary-area');
    if (!area) return;
    const plan = otPlanState.otPlan;
    const workstations = otPlanState.workstations;
    const employees = otPlanState.employees || [];
    const lineName = otPlanState.detailsLineName || '';
    const lineCode = otPlanState.detailsLineCode || '';

    const globalMins = plan.global_ot_minutes || 0;
    const globalTarget = plan.ot_target_units || 0;
    const supAuthorized = plan.supervisor_authorized === true;
    const allAssigned = workstations.every(ws => ws.assigned_emp_name);
    const effColor = e => e == null ? '#9ca3af' : e >= 90 ? '#16a34a' : e >= 80 ? '#d97706' : '#dc2626';

    const wsQrPath = wsCode => {
        if (!lineCode || !wsCode) return '';
        const num = parseInt(wsCode.replace(/\D/g, '') || '0', 10);
        if (!num) return '';
        return `qrcodes/workstations/${lineCode}/ws_${lineCode}_W${String(num).padStart(2,'0')}.png`;
    };
    const qrThumb = (path, label) => {
        if (!path) return '<span style="color:#d1d5db;font-size:11px;">—</span>';
        return `<img src="/${path}" style="width:40px;height:40px;border-radius:6px;border:1px solid #e5e7eb;cursor:pointer;display:block;margin:0 auto;" onerror="this.style.opacity='0.2'" title="${label}">`;
    };

    const empLabel = selId => {
        if (!selId) return '— Not assigned —';
        const e = employees.find(e => String(e.id) === String(selId));
        return e ? `${e.emp_code} — ${e.emp_name}` : '— Not assigned —';
    };
    const empPickerOpts = (selId, wsCode) => {
        const selStr = selId ? String(selId) : '';
        const none = `<div class="ot-emp-option" data-emp-id="" data-emp-label="— Not assigned —" data-ws="${wsCode}"
            onclick="otEmpPickerSelect(this)"
            style="padding:7px 10px;cursor:pointer;font-size:0.82em;color:#9ca3af;border-bottom:1px solid #f3f4f6;">— Not assigned —</div>`;
        return none + employees.map(e => {
            const eStr = String(e.id);
            const isSel = eStr === selStr;
            const takenBy = workstations.find(w => w.workstation_code !== wsCode && String(w.assigned_employee_id) === eStr);
            const label = `${e.emp_code} — ${e.emp_name}`;
            return `<div class="ot-emp-option${takenBy ? ' ot-emp-taken' : ''}"
                data-emp-id="${eStr}" data-emp-label="${label.replace(/"/g,'&quot;')}" data-ws="${wsCode}"
                onclick="otEmpPickerSelect(this)"
                style="padding:7px 10px;cursor:${takenBy?'default':'pointer'};font-size:0.82em;
                       background:${isSel?'#eff6ff':''};font-weight:${isSel?'600':'400'};
                       color:${takenBy?'#9ca3af':''};display:flex;justify-content:space-between;align-items:center;">
                <span>${e.emp_code} — ${e.emp_name}</span>
                ${takenBy ? '<span style="color:#f87171;font-size:11px;margin-left:6px;">Taken ✗</span>' : ''}
            </div>`;
        }).join('');
    };

    const rowColors = ['#ffffff', '#f8fafc'];
    const rows = workstations.map((ws, wsIdx) => {
        const isActive = ws.is_active !== false;
        const taktSecs = globalTarget > 0 ? (globalMins * 60 / globalTarget) : 0;
        const samSecs = parseFloat(ws.actual_sam_seconds || 0);
        const eff = (taktSecs > 0 && samSecs > 0) ? (samSecs / taktSecs) * 100 : null;
        const wsMins = ws.ot_minutes || 0;
        const qty = ws.progress?.quantity ?? '';
        const qaRej = ws.progress?.qa_rejection ?? '';
        const remarks = ws.progress?.remarks || '';
        const wsQr = wsQrPath(ws.workstation_code);
        const currEmpLabel = empLabel(ws.assigned_employee_id).replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const rowBg = rowColors[wsIdx % 2];
        const dimStyle = isActive ? '' : 'opacity:0.5;';

        return (ws.processes || []).map((p, idx) => {
            const isFirst = idx === 0;
            const rs = ws.processes.length > 1 ? ` rowspan="${ws.processes.length}"` : '';
            const samSec = (parseFloat(p.operation_sah || 0) * 3600).toFixed(1);

            const wsQrCell = isFirst
                ? `<td style="text-align:center;vertical-align:middle;padding:4px;"${rs}>${qrThumb(wsQr, ws.workstation_code)}</td>` : '';
            const cycleCell = isFirst
                ? `<td style="text-align:center;vertical-align:middle;"${rs}>${samSecs.toFixed(1)}s</td>` : '';
            const effCell = isFirst
                ? `<td style="text-align:center;font-weight:700;color:${effColor(eff)};vertical-align:middle;"${rs}>${eff != null ? eff.toFixed(1)+'%' : '—'}</td>` : '';
            const empCell = isFirst ? `<td${rs} style="vertical-align:middle;padding:6px;">
                ${supAuthorized
                    ? `<div class="ot-emp-picker" data-ws="${ws.workstation_code}" data-value="${ws.assigned_employee_id||''}" style="position:relative;">
                    <div class="ot-emp-display" onclick="otEmpPickerToggle(this.parentElement)"
                        style="cursor:pointer;padding:5px 8px;border:1px solid #d1d5db;border-radius:6px;
                               font-size:0.82em;min-width:175px;background:#fff;display:flex;
                               justify-content:space-between;align-items:center;gap:4px;user-select:none;">
                        <span class="ot-emp-current-label" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${currEmpLabel}</span>
                        <span style="color:#9ca3af;font-size:10px;flex-shrink:0;">▾</span>
                    </div>
                    <div class="ot-emp-dropdown" style="display:none;position:absolute;left:0;top:calc(100% + 3px);
                         z-index:600;background:#fff;border:1px solid #d1d5db;border-radius:8px;
                         box-shadow:0 6px 24px rgba(0,0,0,.15);min-width:260px;overflow:hidden;">
                        <div style="padding:6px 6px 4px;border-bottom:1px solid #f3f4f6;">
                            <input class="ot-emp-search form-control" style="font-size:0.82em;padding:5px 8px;"
                                placeholder="🔍 Search by name or code..."
                                oninput="otEmpPickerFilter(this)" onclick="event.stopPropagation()">
                        </div>
                        <div class="ot-emp-options" style="max-height:220px;overflow-y:auto;">
                            ${empPickerOpts(ws.assigned_employee_id, ws.workstation_code)}
                        </div>
                    </div>
                </div>`
                    : `<span style="font-size:0.82em;color:#6b7280;padding:5px 8px;display:inline-block;">${currEmpLabel}</span>`
                }
            </td>` : '';
            const statusCell = isFirst ? `<td style="text-align:center;vertical-align:middle;"${rs}>
                ${supAuthorized
                    ? `<button onclick="toggleOtWsActive(${JSON.stringify(ws.workstation_code)}, ${!isActive})"
                        class="btn btn-sm" style="min-width:80px;background:${isActive?'#dcfce7':'#fee2e2'};color:${isActive?'#16a34a':'#dc2626'};border:1px solid ${isActive?'#bbf7d0':'#fecaca'};">
                        ${isActive ? '● Active' : '○ Inactive'}</button>`
                    : `<span style="font-size:12px;font-weight:600;color:${isActive?'#16a34a':'#dc2626'};">${isActive ? '● Active' : '○ Inactive'}</span>`
                }
            </td>` : '';
            const otMinCell = isFirst ? `<td style="text-align:center;vertical-align:middle;"${rs}>
                <input type="number" id="ot-mins-${ws.workstation_code}" min="0" value="${wsMins>0?wsMins:''}"
                    placeholder="${globalMins}" class="form-control" style="width:60px;display:inline-block;text-align:center;"></td>` : '';
            const outCell = isFirst ? `<td style="text-align:center;vertical-align:middle;"${rs}>
                <input type="number" id="ot-qty-${ws.workstation_code}" min="0" value="${qty}" placeholder="0"
                    class="form-control" style="width:70px;display:inline-block;text-align:center;" ${isActive?'':'disabled'}></td>` : '';
            const qaCell = isFirst ? `<td style="text-align:center;vertical-align:middle;"${rs}>
                <input type="number" id="ot-qar-${ws.workstation_code}" min="0" value="${qaRej}" placeholder="0"
                    class="form-control" style="width:60px;display:inline-block;text-align:center;" ${isActive?'':'disabled'}></td>` : '';
            const remCell = isFirst ? `<td style="vertical-align:middle;"${rs}>
                <input type="text" id="ot-rem-${ws.workstation_code}" value="${remarks}" placeholder="Remarks"
                    class="form-control" style="min-width:90px;" ${isActive?'':'disabled'}></td>` : '';
            const saveCell = isFirst ? `<td style="text-align:center;vertical-align:middle;"${rs}>
                <button onclick="saveOtProgress(${JSON.stringify(ws.workstation_code)}, ${ws.id})"
                    class="btn btn-primary btn-sm" ${isActive?'':'disabled'}>Save</button></td>` : '';

            return `<tr style="background:${rowBg};${dimStyle}" ${isFirst ? `id="ot-row-${ws.workstation_code}"` : ''}>
                <td style="text-align:center;font-weight:600;">${p.sequence_number}</td>
                <td style="font-size:0.82em;">${ws.group_name || '—'}</td>
                <td style="font-size:0.82em;font-weight:600;">${ws.workstation_code}</td>
                ${wsQrCell}
                <td>${p.operation_name}<br><small style="color:#9ca3af;font-size:0.78em;">${p.operation_code || ''}</small></td>
                <td style="text-align:center;">${samSec}s</td>
                ${cycleCell}${effCell}
                <td style="text-align:center;">${parseFloat(p.operation_sah||0).toFixed(4)}</td>
                ${empCell}${statusCell}${otMinCell}${outCell}${qaCell}${remCell}${saveCell}
            </tr>`;
        }).join('');
    }).join('');

    const thS = 'padding:8px 6px;font-size:11px;font-weight:700;color:#6b7280;white-space:nowrap;text-transform:uppercase;letter-spacing:.4px;border-bottom:2px solid #e5e7eb;';
    area.innerHTML = `
        <div class="card">
            <div class="card-header" style="flex-wrap:wrap;gap:8px;">
                <div style="display:flex;align-items:center;gap:12px;">
                    <button class="btn btn-secondary btn-sm" onclick="closeOtPlanDetails()">← Back</button>
                    <div>
                        <h3 class="card-title" style="margin:0;">${lineName} — OT Workstations</h3>
                        <div style="font-size:0.82em;color:#6b7280;margin-top:2px;">
                            ${plan.product_code} ${plan.product_name} &nbsp;·&nbsp; ${otPlanState.date}
                            &nbsp;·&nbsp; ${allAssigned ? '<span style="color:#16a34a;">All assigned</span>' : '<span style="color:#dc2626;">Some unassigned</span>'}
                        </div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <span style="font-size:0.85em;color:#6b7280;">
                        OT Min: <input type="number" id="ot-global-mins" value="${globalMins}" min="0"
                            class="form-control" style="width:70px;display:inline-block;text-align:center;margin:0 4px;">
                        &nbsp;Target: <input type="number" id="ot-global-target" value="${globalTarget}" min="0"
                            class="form-control" style="width:80px;display:inline-block;text-align:center;margin:0 4px;">
                    </span>
                    <button onclick="saveOtGlobalSettings()" class="btn btn-secondary btn-sm">Save OT Settings</button>
                    <button onclick="saveAllOtMinutes()" class="btn btn-secondary btn-sm">Save WS Minutes</button>
                </div>
            </div>
            <div class="card-body" style="padding:0;overflow-x:auto;">
                ${!supAuthorized ? `<div style="margin:10px 16px 4px;padding:10px 14px;background:#fef9c3;border:1px solid #fde68a;border-radius:8px;display:flex;align-items:center;gap:10px;">
                    <span style="font-size:18px;">⚠️</span>
                    <div>
                        <div style="font-weight:700;color:#92400e;font-size:13px;">Awaiting IE Authorization</div>
                        <div style="font-size:12px;color:#78350f;">Employee assignment and workstation toggles are locked until the IE authorizes OT for this line.</div>
                    </div>
                </div>` : ''}
                <p style="font-size:0.82em;color:#6b7280;padding:8px 16px 4px;margin:0;">
                    Processes with the same workstation share one employee assignment. Tab out to regroup.
                </p>
                <table style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr style="background:#f8fafc;">
                            <th style="${thS}text-align:center;">SEQ</th>
                            <th style="${thS}">GROUP</th>
                            <th style="${thS}">WORKSTATION</th>
                            <th style="${thS}text-align:center;">WS QR</th>
                            <th style="${thS}">OPERATION</th>
                            <th style="${thS}text-align:center;">PROCESS TIME</th>
                            <th style="${thS}text-align:center;">CYCLE TIME</th>
                            <th style="${thS}text-align:center;">WORKLOAD%</th>
                            <th style="${thS}text-align:center;">SAH</th>
                            <th style="${thS}">EMPLOYEE</th>
                            <th style="${thS}text-align:center;">STATUS</th>
                            <th style="${thS}text-align:center;">OT MIN</th>
                            <th style="${thS}text-align:center;">OUTPUT</th>
                            <th style="${thS}text-align:center;">QA REJ</th>
                            <th style="${thS}">REMARKS</th>
                            <th style="${thS}text-align:center;">SAVE</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
    document.addEventListener('click', otEmpPickerCloseAll);
}

function otEmpPickerToggle(picker) {
    const dropdown = picker.querySelector('.ot-emp-dropdown');
    if (!dropdown) return;
    const isOpen = dropdown.style.display !== 'none';
    document.querySelectorAll('.ot-emp-dropdown').forEach(d => { d.style.display = 'none'; });
    if (!isOpen) {
        dropdown.style.display = '';
        const search = dropdown.querySelector('.ot-emp-search');
        if (search) { search.value = ''; otEmpPickerFilter(search); setTimeout(() => search.focus(), 40); }
    }
}

function otEmpPickerFilter(input) {
    const q = (input.value || '').toLowerCase();
    input.closest('.ot-emp-dropdown')?.querySelectorAll('.ot-emp-option').forEach(opt => {
        opt.style.display = (!q || (opt.dataset.empLabel || '').toLowerCase().includes(q)) ? '' : 'none';
    });
}

function otEmpPickerCloseAll(e) {
    if (!e.target.closest('.ot-emp-picker')) {
        document.querySelectorAll('.ot-emp-dropdown').forEach(d => { d.style.display = 'none'; });
    }
}

async function otEmpPickerSelect(el) {
    if (el.classList.contains('ot-emp-taken')) return;
    const picker = el.closest('.ot-emp-picker');
    if (!picker) return;
    const wsCode = picker.dataset.ws;
    const empId = el.dataset.empId || '';
    const label = el.dataset.empLabel || '— Not assigned —';
    const display = picker.querySelector('.ot-emp-current-label');
    if (display) display.textContent = label;
    picker.dataset.value = empId;
    picker.querySelector('.ot-emp-dropdown').style.display = 'none';
    if (empId) await assignOtEmployee(wsCode, empId);
}

async function toggleOtWsActive(wsCode, makeActive) {
    const plan = otPlanState.otPlan;
    if (!plan || !otPlanState.lineId) return;
    // Update locally for immediate feedback
    const ws = otPlanState.workstations.find(w => w.workstation_code === wsCode);
    if (!ws) return;
    ws.is_active = makeActive;
    // Save to server
    try {
        const r = await fetch(`${API_BASE}/lines/${otPlanState.lineId}/ot-plan/workstations`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: otPlanState.date,
                workstations: [{ workstation_code: wsCode, is_active: makeActive, ot_minutes: ws.ot_minutes || 0 }]
            })
        });
        const result = await r.json();
        if (!result.success) { showToast(result.error || 'Failed to update status', 'error'); ws.is_active = !makeActive; }
        else showToast(`${wsCode} ${makeActive ? 'activated' : 'deactivated'}`, 'success');
    } catch (err) {
        showToast(err.message, 'error'); ws.is_active = !makeActive;
    }
    renderOtPlanSection();
}

async function saveOtGlobalSettings() {
    const mins = parseInt(document.getElementById('ot-global-mins')?.value || 0, 10);
    const target = parseInt(document.getElementById('ot-global-target')?.value || 0, 10);
    if (!otPlanState.lineId || !otPlanState.date) return;
    try {
        const r = await fetch(`${API_BASE}/lines/${otPlanState.lineId}/ot-plan`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: otPlanState.date, product_id: otPlanState.otPlan.product_id, global_ot_minutes: mins, ot_target_units: target })
        });
        const result = await r.json();
        if (!result.success) throw new Error(result.error || 'Failed');
        otPlanState.otPlan.global_ot_minutes = mins;
        otPlanState.otPlan.ot_target_units = target;
        showToast('Global OT settings saved', 'success');
        renderOtPlanSection();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function saveAllOtMinutes() {
    if (!otPlanState.lineId || !otPlanState.date) return;
    const payload = otPlanState.workstations.map(ws => ({
        workstation_code: ws.workstation_code,
        is_active: ws.is_active !== false,
        ot_minutes: parseInt(document.getElementById('ot-mins-' + ws.workstation_code)?.value || 0, 10)
    }));
    try {
        const r = await fetch(`${API_BASE}/lines/${otPlanState.lineId}/ot-plan/workstations`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: otPlanState.date, workstations: payload })
        });
        const result = await r.json();
        if (!result.success) throw new Error(result.error || 'Failed');
        // Update local state
        payload.forEach(p => {
            const ws = otPlanState.workstations.find(w => w.workstation_code === p.workstation_code);
            if (ws) ws.ot_minutes = p.ot_minutes;
        });
        showToast('OT minutes saved', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function saveOtProgress(wsCode, otWorkstationId) {
    const qty = parseInt(document.getElementById('ot-qty-' + wsCode)?.value || 0, 10);
    const qaRej = parseInt(document.getElementById('ot-qar-' + wsCode)?.value || 0, 10);
    const remarks = document.getElementById('ot-rem-' + wsCode)?.value || '';
    if (!otPlanState.lineId || !otPlanState.date) return;
    if (qty < 0) { showToast('Output must be 0 or more', 'error'); return; }
    try {
        const r = await fetch(`${API_BASE}/supervisor/ot-progress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: otPlanState.lineId, work_date: otPlanState.date, ot_workstation_id: otWorkstationId, quantity: qty, qa_rejection: qaRej, remarks })
        });
        const result = await r.json();
        if (!result.success) throw new Error(result.error || 'Failed');
        // Update local progress state
        const ws = otPlanState.workstations.find(w => w.workstation_code === wsCode);
        if (ws) ws.progress = { quantity: qty, qa_rejection: qaRej, remarks };
        showToast(`OT output saved for ${wsCode}`, 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function startOtScan(wsCode) {
    otPlanState.selectedWsCode = wsCode;
    const scanPanel = document.getElementById('ot-scan-panel');
    const scanLabel = document.getElementById('ot-scan-label');
    const scanResult = document.getElementById('ot-scan-result');
    if (!scanPanel) return;
    scanPanel.style.display = 'block';
    if (scanLabel) scanLabel.textContent = `Scan Worker QR — ${wsCode}`;
    if (scanResult) scanResult.innerHTML = '<p style="color:#6b7280;">Point camera at worker ID QR code...</p>';
    scanPanel.scrollIntoView({ behavior: 'smooth' });

    startCamera('ot-camera', null, async (rawValue) => {
        stopCamera();
        const payload = parseScanPayload(rawValue);
        if (!payload) {
            if (scanResult) scanResult.innerHTML = '<p style="color:#dc2626;">Invalid QR code. Try again.</p>';
            return;
        }
        if (scanResult) scanResult.innerHTML = '<p>Resolving employee...</p>';
        try {
            // Try resolve-employee first
            const r1 = await fetch(`${API_BASE}/supervisor/resolve-employee`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ line_id: otPlanState.lineId, employee_qr: rawValue })
            });
            const res1 = await r1.json();
            let employee = null;
            if (res1.success && res1.data?.employee) {
                employee = res1.data.employee;
            } else {
                // Fallback: scan all employees
                const r2 = await fetch(`${API_BASE}/employees`);
                const res2 = await r2.json();
                const employees = res2.data || [];
                if (payload.id) employee = employees.find(e => e.id === payload.id);
                else if (payload.raw) employee = employees.find(e => String(e.emp_code).trim() === String(payload.raw).trim());
                else if (payload.emp_code) employee = employees.find(e => String(e.emp_code).trim() === String(payload.emp_code).trim());
            }
            if (!employee) {
                if (scanResult) scanResult.innerHTML = '<p style="color:#dc2626;">Employee not found</p>';
                return;
            }
            if (scanResult) scanResult.innerHTML = `
                <div style="padding:12px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
                    <p style="font-weight:700;font-size:1.1em;">${employee.emp_code} - ${employee.emp_name}</p>
                    <button class="btn btn-primary" onclick="confirmOtAssign(${employee.id}, ${JSON.stringify(employee.emp_code)}, ${JSON.stringify(employee.emp_name)})" style="margin-top:8px;">Assign to ${wsCode}</button>
                </div>`;
        } catch (err) {
            if (scanResult) scanResult.innerHTML = `<p style="color:#dc2626;">Error: ${err.message}</p>`;
        }
    });
}

async function confirmOtAssign(empId, empCode, empName) {
    const wsCode = otPlanState.selectedWsCode;
    if (!wsCode || !otPlanState.lineId || !otPlanState.date) return;
    try {
        const r = await fetch(`${API_BASE}/lines/${otPlanState.lineId}/ot-plan/employee`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: otPlanState.date, workstation_code: wsCode, employee_id: empId })
        });
        const result = await r.json();
        if (!result.success) throw new Error(result.error || 'Assignment failed');
        // Update local state
        const ws = otPlanState.workstations.find(w => w.workstation_code === wsCode);
        if (ws) {
            ws.assigned_employee_id = empId;
            ws.assigned_emp_code = empCode;
            ws.assigned_emp_name = empName;
        }
        showToast(`${empName} assigned to OT ${wsCode}`, 'success');
        // Hide scan panel and re-render
        const scanPanel = document.getElementById('ot-scan-panel');
        if (scanPanel) scanPanel.style.display = 'none';
        otPlanState.selectedWsCode = null;
        renderOtPlanSection();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function cancelOtScan() {
    stopCamera();
    const scanPanel = document.getElementById('ot-scan-panel');
    if (scanPanel) scanPanel.style.display = 'none';
    otPlanState.selectedWsCode = null;
}

// Filter OT employee select options by search text
function filterOtEmpSelect(searchInput, selectId) {
    const q = searchInput.value.toLowerCase();
    const sel = document.getElementById(selectId);
    if (!sel) return;
    Array.from(sel.options).forEach(opt => {
        if (!opt.value) return; // keep the placeholder
        opt.style.display = opt.text.toLowerCase().includes(q) ? '' : 'none';
    });
}

// Assign OT employee via dropdown selection (replaces QR scan assignment)
async function assignOtEmployee(wsCode, empId) {
    if (!empId || !otPlanState.lineId || !otPlanState.date) return;
    const emp = (otPlanState.employees || []).find(e => String(e.id) === String(empId));
    if (!emp) return;
    try {
        const r = await fetch(`${API_BASE}/lines/${otPlanState.lineId}/ot-plan/employee`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: otPlanState.date, workstation_code: wsCode, employee_id: parseInt(empId, 10) })
        });
        const result = await r.json();
        if (!result.success) throw new Error(result.error || 'Assignment failed');
        const ws = otPlanState.workstations.find(w => w.workstation_code === wsCode);
        if (ws) {
            ws.assigned_employee_id = emp.id;
            ws.assigned_emp_code = emp.emp_code;
            ws.assigned_emp_name = emp.emp_name;
        }
        showToast(`${emp.emp_name} assigned to OT ${wsCode}`, 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Setup SSE listener to refresh OT plan when another session updates it
function setupOtRealtimeListener() {
    if (window._otSSESource) return; // already set up
    const source = new EventSource('/events');
    source.addEventListener('data_change', (event) => {
        try {
            const payload = JSON.parse(event.data || '{}');
            if (payload.entity === 'ot_plan') {
                if (otPlanState.detailsLineId && String(payload.line_id) === String(otPlanState.detailsLineId)) {
                    openOtPlanDetails(otPlanState.detailsLineId, otPlanState.detailsLineName, otPlanState.date);
                } else if (!otPlanState.detailsLineId && otPlanState.date) {
                    loadOtPlanList(otPlanState.date);
                }
            }
        } catch (e) { /* ignore */ }
    });
    source.onerror = () => {
        source.close();
        window._otSSESource = null;
        setTimeout(setupOtRealtimeListener, 3000);
    };
    window._otSSESource = source;
}

// ==========================================
// WORKER ADJUSTMENT PANEL
// ==========================================

const adjustState = {
    lineId: null,
    date: null,
    workstations: [],
    // departure form
    departureWorkstation: null,
    departureEmployeeId: null,
    departureEmpName: null,
    // adjustment flow
    departureId: null,
    vacantWsCode: null,
    adjStep: null,   // 'scan-employee' | 'choose-type'
    scannedEmployee: null
};

async function loadAdjustmentPanel() {
    const container = document.getElementById('supervisor-content');
    container.innerHTML = `
        <div style="padding:16px;">
            <h1 style="font-size:1.3rem;font-weight:700;margin:0 0 16px;">Worker Adjustment</h1>
            <div style="margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                <select id="adj-line-select" class="form-control" style="max-width:280px;" onchange="loadAdjLineStatus()">
                    <option value="">— Select Line —</option>
                </select>
            </div>
            <div id="adj-status-panel"></div>
            <div id="adj-departure-panel" style="display:none;"></div>
            <div id="adj-scan-panel" style="display:none;"></div>
            <div id="adj-history-panel" style="margin-top:24px;"></div>
        </div>`;

    // Load lines
    try {
        const r = await fetch(`${API_BASE}/lines`);
        const d = await r.json();
        const sel = document.getElementById('adj-line-select');
        (d.data || []).forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.id;
            opt.textContent = `${l.line_name} (${l.line_code})`;
            sel.appendChild(opt);
        });
    } catch (e) { /* ignore */ }
}

async function loadAdjLineStatus() {
    const sel = document.getElementById('adj-line-select');
    const lineId = sel?.value;
    if (!lineId) return;
    adjustState.lineId = lineId;
    adjustState.date = new Date().toISOString().slice(0, 10);

    const panel = document.getElementById('adj-status-panel');
    panel.innerHTML = '<p style="color:#6b7280;padding:8px;">Loading...</p>';

    try {
        const [statusRes, histRes] = await Promise.all([
            fetch(`${API_BASE}/supervisor/line-status/${lineId}?date=${adjustState.date}`),
            fetch(`${API_BASE}/supervisor/worker-departures/${lineId}?date=${adjustState.date}`)
        ]);
        const statusData = await statusRes.json();
        const histData = await histRes.json();

        adjustState.workstations = statusData.data?.workstations || [];
        renderAdjStatusTable(adjustState.workstations);
        renderAdjHistory(histData.data || []);
    } catch (err) {
        panel.innerHTML = `<p style="color:#dc2626;">Failed to load: ${err.message}</p>`;
    }
}

function renderAdjStatusTable(workstations) {
    const panel = document.getElementById('adj-status-panel');
    if (!workstations.length) {
        panel.innerHTML = '<div class="card"><div class="card-body"><p style="color:#9ca3af;">No employee assignments found for today on this line.</p></div></div>';
        return;
    }
    const cards = workstations.map(ws => {
        const status = ws.status;
        let statusBadge = '';
        let workerHtml = `<span style="font-weight:600;">${ws.emp_code} — ${ws.emp_name}</span>`;
        let footerBtn = '';
        let cardClass = '';

        if (status === 'active') {
            statusBadge = `<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">Active</span>`;
            footerBtn = `<button class="btn ws-card-action" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;"
                onclick="openDepartureForm('${ws.workstation_code}', ${ws.employee_id})">
                Mark Departure
            </button>`;
        } else if (status === 'vacant') {
            const t = ws.departure_time ? new Date(ws.departure_time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
            const reasonLabel = { sick: 'Sick', personal: 'Personal', operational: 'Operational', other: 'Other' }[ws.departure_reason] || '';
            statusBadge = `<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">Vacant</span>`;
            workerHtml = `<span style="color:#dc2626;font-weight:600;">${ws.emp_code} — ${ws.emp_name}</span>
                <span style="color:#9ca3af;font-size:11px;display:block;">${reasonLabel}${t ? ' @ '+t : ''}</span>`;
            cardClass = 'ws-card--alert';
            footerBtn = `<button class="btn ws-card-action" style="background:#eff6ff;color:#2563eb;border:1px solid #93c5fd;"
                onclick="openAdjustmentScan(${ws.departure_id}, '${ws.workstation_code}')">
                Assign Worker
            </button>`;
        } else {
            const typeLabel = ws.adjustment_type === 'combine' ? 'Combined' : 'Reassigned';
            statusBadge = `<span style="background:#ede9fe;color:#7c3aed;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">${typeLabel}</span>`;
            const rTime = ws.reassignment_time ? new Date(ws.reassignment_time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
            workerHtml += `<span style="color:#7c3aed;font-size:11px;display:block;">${ws.covering_emp_code} covers @ ${rTime}</span>`;
            cardClass = 'ws-card--changeover';
            footerBtn = `<span style="color:#9ca3af;font-size:13px;padding:8px 0;display:block;text-align:center;">Resolved</span>`;
        }

        return `
            <div class="ws-card ${cardClass}" id="adj-ws-card-${ws.workstation_code}">
                <div class="ws-card-header">
                    <span class="ws-card-code">${ws.workstation_code}</span>
                    <div class="ws-card-badges">${statusBadge}</div>
                </div>
                <div class="ws-card-body">
                    <div class="ws-card-row">
                        <span class="ws-card-label">Worker</span>
                        <span style="font-size:13px;">${workerHtml}</span>
                    </div>
                </div>
                <div class="ws-card-footer" id="adj-card-footer-${ws.workstation_code}">
                    ${footerBtn}
                </div>
            </div>`;
    }).join('');

    panel.innerHTML = `
        <div class="card">
            <div class="card-body">
                <div class="ws-cards-grid">${cards}</div>
            </div>
        </div>`;
}

function renderAdjHistory(records) {
    const panel = document.getElementById('adj-history-panel');
    if (!records.length) { panel.innerHTML = ''; return; }

    const cards = records.map(r => {
        const deptTime = r.departure_time ? new Date(r.departure_time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '-';
        const adjLabel = r.adjustment_type ? (r.adjustment_type === 'assign' ? 'Assign' : 'Combine') : 'Pending';
        const rTime = r.reassignment_time ? new Date(r.reassignment_time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : null;
        const coverInfo = r.covering_emp_code ? `${r.covering_emp_code} (${r.covering_from_ws || ''})` : null;
        const reasonLabel = { sick: 'Sick', personal: 'Personal', operational: 'Operational', other: 'Other' }[r.departure_reason] || r.departure_reason;
        const resolved = !!r.adjustment_type;
        const badgeStyle = resolved ? 'background:#d1fae5;color:#065f46;' : 'background:#fee2e2;color:#991b1b;';
        return `
            <div class="ws-card ${resolved ? 'ws-card--changeover' : 'ws-card--alert'}">
                <div class="ws-card-header">
                    <span class="ws-card-code">${r.workstation_code}</span>
                    <div class="ws-card-badges">
                        <span style="${badgeStyle}padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">${adjLabel}</span>
                    </div>
                </div>
                <div class="ws-card-body">
                    <div class="ws-card-row"><span class="ws-card-label">Departed</span><span>${r.dep_emp_code} — ${r.dep_emp_name}</span></div>
                    <div class="ws-card-row"><span class="ws-card-label">Reason / Time</span><span>${reasonLabel} · ${deptTime}</span></div>
                    ${coverInfo ? `<div class="ws-card-row"><span class="ws-card-label">Covered By</span><span>${coverInfo}${rTime ? ' · ' + rTime : ''}</span></div>` : ''}
                </div>
            </div>`;
    }).join('');

    panel.innerHTML = `
        <div style="padding:4px 0 8px;font-weight:700;font-size:13px;color:#374151;">Departure History</div>
        <div style="display:grid;grid-template-columns:1fr;gap:8px;">${cards}</div>`;
}

// ─── DEPARTURE FORM ───────────────────────────────────────────────────────────
function openDepartureForm(workstationCode, employeeId) {
    const wsData = adjustState.workstations.find(w => w.workstation_code === workstationCode && w.employee_id === employeeId);
    adjustState.departureWorkstation = workstationCode;
    adjustState.departureEmployeeId = employeeId;
    adjustState.departureEmpName = wsData?.emp_name || '';

    const now = new Date();
    const localTime = now.getFullYear() + '-' +
        String(now.getMonth()+1).padStart(2,'0') + '-' +
        String(now.getDate()).padStart(2,'0') + 'T' +
        String(now.getHours()).padStart(2,'0') + ':' +
        String(now.getMinutes()).padStart(2,'0');

    const footer = document.getElementById(`adj-card-footer-${workstationCode}`);
    if (!footer) return;
    footer.innerHTML = `
        <div style="padding:12px 0 4px;">
            <div style="font-weight:700;font-size:13px;color:#dc2626;margin-bottom:10px;">Mark Departure — ${workstationCode}</div>
            <p style="margin:0 0 10px;font-size:13px;">Employee: <strong>${adjustState.departureEmpName}</strong></p>
            <div style="display:grid;gap:10px;">
                <div>
                    <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Departure Reason</label>
                    <div class="mismatch-actions" style="gap:6px;">
                        ${['sick','personal','operational','other'].map(r =>
                            `<label style="display:flex;align-items:center;gap:6px;min-height:44px;font-size:14px;cursor:pointer;padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;">
                                <input type="radio" name="dept-reason" value="${r}" ${r==='sick'?'checked':''}> ${r.charAt(0).toUpperCase()+r.slice(1)}
                            </label>`
                        ).join('')}
                    </div>
                </div>
                <div>
                    <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Departure Time</label>
                    <input type="datetime-local" id="dept-time-input" value="${localTime}" class="form-control" style="width:100%;">
                </div>
                <div>
                    <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Notes (optional)</label>
                    <input type="text" id="dept-notes-input" placeholder="e.g. Went to clinic" class="form-control">
                </div>
                <div class="mismatch-actions">
                    <button class="ws-card-action" style="background:#dc2626;color:#fff;border:none;" onclick="confirmDeparture()">Confirm Departure</button>
                    <button class="ws-card-action" style="background:#f3f4f6;color:#374151;border:1px solid #d1d5db;" onclick="closeDepartureForm()">Cancel</button>
                </div>
            </div>
        </div>`;
    footer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeDepartureForm() {
    const wsCode = adjustState.departureWorkstation;
    const empId = adjustState.departureEmployeeId;
    const footer = document.getElementById(`adj-card-footer-${wsCode}`);
    if (footer) {
        footer.innerHTML = `<button class="btn ws-card-action" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;"
            onclick="openDepartureForm('${wsCode}', ${empId})">Mark Departure</button>`;
    }
    adjustState.departureWorkstation = null;
    adjustState.departureEmployeeId = null;
    adjustState.departureEmpName = null;
}

async function confirmDeparture() {
    const reason = document.querySelector('input[name="dept-reason"]:checked')?.value;
    const timeVal = document.getElementById('dept-time-input')?.value;
    const notes = document.getElementById('dept-notes-input')?.value || '';
    if (!reason) { showToast('Select a departure reason', 'error'); return; }
    if (!timeVal) { showToast('Enter departure time', 'error'); return; }

    // Convert local datetime-local input to ISO string with offset
    const deptTime = new Date(timeVal).toISOString();

    try {
        const r = await fetch(`${API_BASE}/supervisor/worker-departure`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: adjustState.lineId,
                work_date: adjustState.date,
                employee_id: adjustState.departureEmployeeId,
                workstation_code: adjustState.departureWorkstation,
                departure_time: deptTime,
                departure_reason: reason,
                notes
            })
        });
        const result = await r.json();
        if (!result.success) { showToast(result.error || 'Failed to record departure', 'error'); return; }
        showToast(`Departure recorded for ${result.data.emp_name}`, 'success');
        closeDepartureForm();
        await loadAdjLineStatus();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ─── ADJUSTMENT SCAN FLOW ─────────────────────────────────────────────────────
function openAdjustmentScan(departureId, vacantWsCode) {
    adjustState.departureId = departureId;
    adjustState.vacantWsCode = vacantWsCode;
    adjustState.adjStep = 'scan-employee';
    adjustState.scannedEmployee = null;

    const footer = document.getElementById(`adj-card-footer-${vacantWsCode}`);
    if (!footer) return;
    footer.innerHTML = `
        <div style="padding:12px 0 4px;">
            <div style="font-weight:700;font-size:13px;color:#1d4ed8;margin-bottom:8px;">Worker Adjustment — ${vacantWsCode}</div>
            <p style="font-size:13px;color:#6b7280;margin:0 0 10px;">Scan the <strong>receiving worker's QR</strong> (must be active on this line today).</p>
            <video id="adj-camera" style="width:100%;border-radius:8px;background:#000;display:block;"></video>
            <div id="adj-scan-result" style="margin-top:10px;"></div>
            <button class="ws-card-action" style="margin-top:8px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;" onclick="closeAdjustmentScan()">Cancel</button>
        </div>`;
    footer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    startCamera('adj-camera', null, async (rawValue) => {
        stopCamera();
        const result = document.getElementById('adj-scan-result');
        result.innerHTML = '<p style="color:#6b7280;">Resolving employee...</p>';
        try {
            const r = await fetch(`${API_BASE}/supervisor/resolve-employee-by-qr`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employee_qr: rawValue })
            });
            const data = await r.json();
            if (!data.success) {
                result.innerHTML = `<p style="color:#dc2626;">${data.error || 'Employee not found. Try again.'}</p>
                    <button class="btn btn-secondary btn-sm" style="margin-top:6px;" onclick="retryAdjScan()">Retry Scan</button>`;
                return;
            }
            adjustState.scannedEmployee = data.data.employee;

            // Find their current workstation from the status table
            const assigned = (adjustState.workstations || []).find(
                ws => ws.employee_id === adjustState.scannedEmployee.id && ws.status === 'active'
            );
            if (!assigned) {
                result.innerHTML = `<p style="color:#dc2626;">This employee (${data.data.employee.emp_name}) is not active on this line today, or may themselves be departed.</p>
                    <button class="btn btn-secondary btn-sm" style="margin-top:6px;" onclick="retryAdjScan()">Retry Scan</button>`;
                return;
            }
            adjustState.scannedFromWs = assigned.workstation_code;
            showAdjChoicePrompt(data.data.employee, assigned.workstation_code);
        } catch (err) {
            document.getElementById('adj-scan-result').innerHTML = `<p style="color:#dc2626;">${err.message}</p>`;
        }
    });
}

function retryAdjScan() {
    adjustState.scannedEmployee = null;
    startCamera('adj-camera', null, async (rawValue) => {
        stopCamera();
        // reuse same logic — just call openAdjustmentScan equivalent inline
        const result = document.getElementById('adj-scan-result');
        result.innerHTML = '<p style="color:#6b7280;">Resolving employee...</p>';
        try {
            const r = await fetch(`${API_BASE}/supervisor/resolve-employee-by-qr`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employee_qr: rawValue })
            });
            const data = await r.json();
            if (!data.success) {
                result.innerHTML = `<p style="color:#dc2626;">${data.error || 'Employee not found.'}</p>
                    <button class="btn btn-secondary btn-sm" style="margin-top:6px;" onclick="retryAdjScan()">Retry Scan</button>`;
                return;
            }
            adjustState.scannedEmployee = data.data.employee;
            const assigned = (adjustState.workstations || []).find(
                ws => ws.employee_id === adjustState.scannedEmployee.id && ws.status === 'active'
            );
            if (!assigned) {
                result.innerHTML = `<p style="color:#dc2626;">Employee not active on this line today.</p>
                    <button class="btn btn-secondary btn-sm" style="margin-top:6px;" onclick="retryAdjScan()">Retry Scan</button>`;
                return;
            }
            adjustState.scannedFromWs = assigned.workstation_code;
            showAdjChoicePrompt(data.data.employee, assigned.workstation_code);
        } catch (err) {
            document.getElementById('adj-scan-result').innerHTML = `<p style="color:#dc2626;">${err.message}</p>`;
        }
    });
}

function showAdjChoicePrompt(emp, fromWs) {
    const panel = document.getElementById('adj-scan-result');
    const vacantWs = adjustState.vacantWsCode;
    panel.innerHTML = `
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:14px;">
            <p style="font-weight:700;color:#15803d;margin:0 0 8px;">&#10003; Employee Scanned</p>
            <p style="font-size:13px;margin:0 0 4px;">
                <strong>${emp.emp_code} — ${emp.emp_name}</strong> is currently on <strong>${fromWs}</strong>.
            </p>
            <p style="font-size:13px;margin:0 0 14px;">
                <strong>${vacantWs}</strong> is vacant. What would you like to do?
            </p>
            <div class="mismatch-actions">
                <button class="ws-card-action" style="background:#2563eb;color:#fff;border:none;" onclick="confirmAdjustment('assign')">
                    &#8594; Assign to ${vacantWs}
                    <span style="display:block;font-size:11px;font-weight:400;opacity:0.85;">${fromWs} becomes unmanned</span>
                </button>
                <button class="ws-card-action" style="background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;" onclick="confirmAdjustment('combine')">
                    &#8853; Combine ${fromWs} + ${vacantWs}
                    <span style="display:block;font-size:11px;font-weight:400;opacity:0.85;">${emp.emp_name} covers both</span>
                </button>
                <button class="ws-card-action" style="background:#f3f4f6;color:#374151;border:1px solid #d1d5db;" onclick="retryAdjScan()">&#8635; Scan Different Worker</button>
            </div>
        </div>`;
}

async function confirmAdjustment(type) {
    const now = new Date().toISOString();
    try {
        const r = await fetch(`${API_BASE}/supervisor/worker-adjustment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: adjustState.lineId,
                work_date: adjustState.date,
                departure_id: adjustState.departureId,
                vacant_workstation_code: adjustState.vacantWsCode,
                from_employee_id: adjustState.scannedEmployee.id,
                from_workstation_code: adjustState.scannedFromWs,
                adjustment_type: type,
                reassignment_time: now
            })
        });
        const result = await r.json();
        if (!result.success) { showToast(result.error || 'Adjustment failed', 'error'); return; }
        const typeLabel = type === 'assign' ? 'Assigned' : 'Combined';
        showToast(`${typeLabel}: ${result.data.from_emp_name} → ${result.data.vacant_workstation_code}`, 'success');
        closeAdjustmentScan();
        await loadAdjLineStatus();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function closeAdjustmentScan() {
    stopCamera();
    const wsCode = adjustState.vacantWsCode;
    const depId = adjustState.departureId;
    if (wsCode) {
        const footer = document.getElementById(`adj-card-footer-${wsCode}`);
        if (footer) {
            footer.innerHTML = `<button class="btn ws-card-action" style="background:#eff6ff;color:#2563eb;border:1px solid #93c5fd;"
                onclick="openAdjustmentScan(${depId}, '${wsCode}')">Assign Worker</button>`;
        }
    }
    adjustState.departureId = null;
    adjustState.vacantWsCode = null;
    adjustState.scannedEmployee = null;
    adjustState.scannedFromWs = null;
    adjustState.adjStep = null;
}
