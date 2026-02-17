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
    targetQty: 0,
    selectedWorkstation: null,
    scannedEmployee: null
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
                    <h3 class="card-title">Scan Worker QR</h3>
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
        const response = await fetch(`${API_BASE}/supervisor/processes/${lineId}`);
        const result = await response.json();
        morningState.processes = result.data || [];
        morningState.targetQty = morningState.processes.length > 0 ? (morningState.processes[0].target_qty || 0) : 0;
        renderMorningAssignments();
    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function renderMorningAssignments() {
    const container = document.getElementById('morning-assignments');
    const processes = morningState.processes;

    if (!processes.length) {
        container.innerHTML = '<div class="card"><div class="card-body"><div class="alert alert-info">No processes found for this line. Assign a product to the line first.</div></div></div>';
        return;
    }

    // Group processes by workstation_code
    const wsMap = new Map();
    processes.forEach(p => {
        const ws = p.workstation_code || p.group_name || '-';
        if (!wsMap.has(ws)) {
            wsMap.set(ws, {
                workstation_code: ws,
                processes: [],
                assigned_emp_code: p.assigned_emp_code,
                assigned_emp_name: p.assigned_emp_name
            });
        }
        wsMap.get(ws).processes.push(p);
        // Use the first assigned employee found for this workstation
        if (p.assigned_emp_name && !wsMap.get(ws).assigned_emp_name) {
            wsMap.get(ws).assigned_emp_code = p.assigned_emp_code;
            wsMap.get(ws).assigned_emp_name = p.assigned_emp_name;
        }
    });

    const rows = Array.from(wsMap.values()).map(ws => {
        const assigned = ws.assigned_emp_name
            ? `<span style="color:#16a34a; font-weight:600;">${ws.assigned_emp_code} - ${ws.assigned_emp_name}</span>`
            : '<span style="color:#dc2626;">Not assigned</span>';
        const icon = ws.assigned_emp_name ? '&#10003;' : '&#9888;';
        const iconColor = ws.assigned_emp_name ? '#16a34a' : '#f59e0b';
        const processList = ws.processes.map(p => `${p.operation_code} - ${p.operation_name}`).join(', ');
        const escapedWs = ws.workstation_code.replace(/'/g, "\\'");

        return `<tr>
            <td style="font-weight:600;">${ws.workstation_code}</td>
            <td>${processList}</td>
            <td><span style="color:${iconColor}; margin-right:6px;">${icon}</span> ${assigned}</td>
            <td>
                <button class="btn btn-primary btn-sm" onclick="startMorningScan('${escapedWs}')">
                    Scan Worker
                </button>
            </td>
        </tr>`;
    }).join('');

    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Workstation Assignments</h3>
            </div>
            <div class="card-body table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Workstation</th>
                            <th>Processes</th>
                            <th>Assigned Worker</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
}

function startMorningScan(workstationCode) {
    morningState.selectedWorkstation = workstationCode;
    morningState.scannedEmployee = null;

    const scanPanel = document.getElementById('morning-scan-panel');
    const scanLabel = document.getElementById('morning-scan-label');
    const scanResult = document.getElementById('morning-scan-result');
    scanPanel.style.display = 'block';
    scanLabel.textContent = `Scanning for workstation: ${workstationCode}`;
    scanResult.innerHTML = '<p style="color:#6b7280;">Point camera at worker ID QR code...</p>';

    scanPanel.scrollIntoView({ behavior: 'smooth' });

    startCamera('morning-camera', null, async (rawValue) => {
        stopCamera();
        const payload = parseScanPayload(rawValue);
        if (!payload) {
            scanResult.innerHTML = '<p style="color:#dc2626;">Invalid QR code. Try again.</p>';
            return;
        }

        scanResult.innerHTML = '<p>Resolving employee...</p>';

        try {
            const response = await fetch(`${API_BASE}/supervisor/resolve-employee`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    line_id: morningState.lineId,
                    employee_qr: rawValue
                })
            });
            const result = await response.json();

            if (!result.success) {
                // Employee might not be assigned to this line yet - try resolving directly
                const empResponse = await fetch(`${API_BASE}/employees`);
                const empResult = await empResponse.json();
                if (!empResult.success) {
                    scanResult.innerHTML = `<p style="color:#dc2626;">Employee not found</p>`;
                    return;
                }
                const employees = empResult.data || [];
                let employee = null;
                if (payload.id) {
                    employee = employees.find(e => e.id === payload.id);
                } else if (payload.raw) {
                    employee = employees.find(e => String(e.emp_code).trim() === String(payload.raw).trim());
                } else if (payload.emp_code) {
                    employee = employees.find(e => String(e.emp_code).trim() === String(payload.emp_code).trim());
                }

                if (!employee) {
                    scanResult.innerHTML = `<p style="color:#dc2626;">Employee not found</p>`;
                    return;
                }

                morningState.scannedEmployee = employee;
                scanResult.innerHTML = `
                    <div style="padding:12px; background:#f0fdf4; border-radius:8px; border:1px solid #bbf7d0;">
                        <p style="font-weight:700; font-size:1.1em;">${employee.emp_code} - ${employee.emp_name}</p>
                        <button class="btn btn-primary" onclick="confirmMorningAssign()" style="margin-top:8px;">Assign to Workstation</button>
                    </div>
                `;
                return;
            }

            const emp = result.data.employee;
            morningState.scannedEmployee = emp;
            scanResult.innerHTML = `
                <div style="padding:12px; background:#f0fdf4; border-radius:8px; border:1px solid #bbf7d0;">
                    <p style="font-weight:700; font-size:1.1em;">${emp.emp_code} - ${emp.emp_name}</p>
                    <button class="btn btn-primary" onclick="confirmMorningAssign()" style="margin-top:8px;">Assign to Workstation</button>
                </div>
            `;
        } catch (err) {
            scanResult.innerHTML = `<p style="color:#dc2626;">Error: ${err.message}</p>`;
        }
    });
}

async function confirmMorningAssign() {
    if (!morningState.lineId || !morningState.selectedWorkstation || !morningState.scannedEmployee) {
        showToast('Missing data for assignment', 'error');
        return;
    }

    try {
        const emp = morningState.scannedEmployee;

        const response = await fetch(`${API_BASE}/workstation-assignments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: morningState.lineId,
                workstation_code: morningState.selectedWorkstation,
                employee_id: emp.id
            })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error || 'Assignment failed', 'error');
            return;
        }

        showToast(`${emp.emp_name} assigned to ${morningState.selectedWorkstation}`, 'success');

        // Refresh assignments
        const scanPanel = document.getElementById('morning-scan-panel');
        if (scanPanel) scanPanel.style.display = 'none';
        morningState.selectedWorkstation = null;
        morningState.scannedEmployee = null;

        // Re-fetch processes to get updated assignments
        const procResponse = await fetch(`${API_BASE}/supervisor/processes/${morningState.lineId}`);
        const procResult = await procResponse.json();
        morningState.processes = procResult.data || [];
        renderMorningAssignments();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function cancelMorningScan() {
    stopCamera();
    const scanPanel = document.getElementById('morning-scan-panel');
    if (scanPanel) scanPanel.style.display = 'none';
    morningState.selectedWorkstation = null;
    morningState.scannedEmployee = null;
}

// ==========================================
// HOURLY PROCEDURE
// ==========================================
const hourlyState = {
    lineId: null,
    processes: [],
    targetQty: 0,
    hourlyTarget: 0,
    selectedProcess: null,
    progressData: []
};

const SHORTFALL_REASONS = [
    'WORKMANSHIP PROBLEM',
    'MC BREAKDOWN',
    'FEEDING NOT RECEIVED',
    'INEFFICIENT',
    'TECHNICAL ISSUES',
    'COMMERCIAL PACKAGE ISSUES'
];

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
                    <h3 class="card-title">Select Line & Hour</h3>
                </div>
                <div class="card-body">
                    <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:end;">
                        <div style="flex:1; min-width:180px;">
                            <label class="form-label">Line</label>
                            <select class="form-control" id="hourly-line">
                                <option value="">Select Line</option>
                                ${lines.map(l => `<option value="${l.id}">${l.line_name} (${l.line_code})${l.product_code ? ' - ' + l.product_code : ''}</option>`).join('')}
                            </select>
                        </div>
                        <div style="min-width:140px;">
                            <label class="form-label">Date</label>
                            <input type="date" class="form-control" id="hourly-date" value="${today}">
                        </div>
                        <div style="min-width:100px;">
                            <label class="form-label">Hour</label>
                            <select class="form-control" id="hourly-hour">
                                ${Array.from({ length: hourEnd - hourStart + 1 }).map((_, i) => {
                                    const v = hourStart + i;
                                    return `<option value="${v}" ${v === defaultHour ? 'selected' : ''}>${String(v).padStart(2, '0')}:00</option>`;
                                }).join('')}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

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
        `;

        document.getElementById('hourly-line').addEventListener('change', onHourlyLineChange);
        document.getElementById('hourly-date').addEventListener('change', refreshHourlySummary);
        document.getElementById('hourly-hour').addEventListener('change', refreshHourlySummary);
        document.getElementById('hourly-cancel-scan').addEventListener('click', cancelHourlyScan);

        hourlyState.lineId = null;
        hourlyState.processes = [];
        hourlyState.selectedProcess = null;
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

async function onHourlyLineChange() {
    const lineId = document.getElementById('hourly-line').value;
    hourlyState.lineId = lineId;
    hourlyState.selectedProcess = null;
    stopCamera();
    hideHourlyPanels();

    const container = document.getElementById('hourly-summary');
    if (!lineId) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = '<div class="loading-overlay" style="position:relative;padding:40px 0;"><div class="spinner"></div></div>';

    try {
        const response = await fetch(`${API_BASE}/supervisor/processes/${lineId}`);
        const result = await response.json();
        hourlyState.processes = result.data || [];
        hourlyState.targetQty = hourlyState.processes.length > 0 ? (hourlyState.processes[0].target_qty || 0) : 0;
        hourlyState.hourlyTarget = hourlyState.targetQty > 0 ? Math.round(hourlyState.targetQty / 8) : 0;
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

function renderHourlySummary() {
    const container = document.getElementById('hourly-summary');
    const processes = hourlyState.processes;
    const hour = parseInt(document.getElementById('hourly-hour')?.value || 0, 10);
    const hourlyTarget = hourlyState.hourlyTarget;

    if (!processes.length) {
        container.innerHTML = '<div class="card"><div class="card-body"><div class="alert alert-info">No processes found for this line.</div></div></div>';
        return;
    }

    const rows = processes.map(p => {
        // Find progress for this process and selected hour
        const progress = hourlyState.progressData.find(
            d => parseInt(d.process_id) === p.id && parseInt(d.hour_slot) === hour
        );
        const output = progress ? parseInt(progress.quantity || 0) : 0;
        const reason = progress?.shortfall_reason || '';
        const worker = p.assigned_emp_name ? `${p.assigned_emp_code} - ${p.assigned_emp_name}` : '<span style="color:#dc2626;">Unassigned</span>';

        let statusHtml = '';
        if (output > 0) {
            if (hourlyTarget > 0 && output < hourlyTarget) {
                statusHtml = `<span style="color:#dc2626; font-weight:600;">Below target</span>`;
                if (reason) statusHtml += `<br><small style="color:#6b7280;">${reason}</small>`;
            } else {
                statusHtml = `<span style="color:#16a34a; font-weight:600;">On track</span>`;
            }
        } else {
            statusHtml = '<span style="color:#6b7280;">-</span>';
        }

        return `<tr>
            <td style="font-weight:600;">${p.workstation_code || p.group_name || '-'}</td>
            <td>${p.operation_code} - ${p.operation_name}</td>
            <td>${worker}</td>
            <td style="text-align:center;">${hourlyTarget || '-'}</td>
            <td style="text-align:center; font-weight:600;">${output || '-'}</td>
            <td>${statusHtml}</td>
            <td>
                <button class="btn btn-primary btn-sm" onclick="openHourlyEntry(${p.id})">
                    Enter Output
                </button>
            </td>
        </tr>`;
    }).join('');

    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Process Output Summary</h3>
                <div>
                    <span style="font-size:0.85em; color:#6b7280;">Target/hr: <strong>${hourlyTarget || '-'}</strong> | Product target: <strong>${hourlyState.targetQty || '-'}</strong></span>
                    <button class="btn btn-secondary btn-sm" onclick="startHourlyScan()" style="margin-left:12px;">Scan Workstation QR</button>
                </div>
            </div>
            <div class="card-body table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Workstation</th>
                            <th>Process</th>
                            <th>Worker</th>
                            <th style="text-align:center;">Target/hr</th>
                            <th style="text-align:center;">Output</th>
                            <th>Status</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
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

    const scanPanel = document.getElementById('hourly-scan-panel');
    if (scanPanel) scanPanel.style.display = 'none';

    const entryPanel = document.getElementById('hourly-entry-panel');
    const entryTitle = document.getElementById('hourly-entry-title');
    const entryForm = document.getElementById('hourly-entry-form');

    entryTitle.textContent = `Enter Output - ${process.workstation_code || process.group_name || ''} - ${process.operation_name}`;
    entryPanel.style.display = 'block';

    const workerInfo = process.assigned_emp_name
        ? `${process.assigned_emp_code} - ${process.assigned_emp_name}`
        : 'Unassigned';

    entryForm.innerHTML = `
        <div style="margin-bottom:16px;">
            <div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:12px;">
                <div><strong>Worker:</strong> ${workerInfo}</div>
                <div><strong>Hourly Target:</strong> ${hourlyTarget || 'N/A'}</div>
                <div><strong>Hour:</strong> ${String(hour).padStart(2, '0')}:00</div>
            </div>
        </div>

        <div style="margin-bottom:16px;">
            <label class="form-label">Output Quantity</label>
            <input type="number" class="form-control" id="hourly-output-qty" min="0" value="${existingOutput || ''}" placeholder="Enter output quantity" style="max-width:200px;">
        </div>

        <div id="hourly-reason-section" style="margin-bottom:16px; display:none;">
            <label class="form-label" style="color:#dc2626; font-weight:700;">
                Reason for Shortfall (Required)
            </label>
            <select class="form-control" id="hourly-reason" style="max-width:300px;">
                <option value="">-- Select Reason --</option>
                ${SHORTFALL_REASONS.map(r => `<option value="${r}" ${existingReason === r ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
            <div id="hourly-reason-warning" style="display:none; color:#dc2626; font-weight:600; margin-top:8px; padding:8px 12px; background:#fef2f2; border-radius:6px; border:1px solid #fecaca;">
                &#9888; Please Update Reason
            </div>
        </div>

        <div style="display:flex; gap:12px;">
            <button class="btn btn-primary" id="hourly-save-btn">Save Output</button>
            <button class="btn btn-secondary" id="hourly-entry-cancel">Cancel</button>
        </div>
    `;

    const outputInput = document.getElementById('hourly-output-qty');
    const reasonSection = document.getElementById('hourly-reason-section');
    const reasonSelect = document.getElementById('hourly-reason');

    // Show reason section if existing output is below target
    if (existingOutput > 0 && hourlyTarget > 0 && existingOutput < hourlyTarget) {
        reasonSection.style.display = 'block';
    }

    outputInput.addEventListener('input', () => {
        const val = parseInt(outputInput.value || 0, 10);
        if (hourlyTarget > 0 && val < hourlyTarget && val > 0) {
            reasonSection.style.display = 'block';
        } else {
            reasonSection.style.display = 'none';
        }
        // Hide warning when typing
        document.getElementById('hourly-reason-warning').style.display = 'none';
    });

    document.getElementById('hourly-save-btn').addEventListener('click', saveHourlyOutput);
    document.getElementById('hourly-entry-cancel').addEventListener('click', () => {
        entryPanel.style.display = 'none';
        hourlyState.selectedProcess = null;
    });

    entryPanel.scrollIntoView({ behavior: 'smooth' });
    outputInput.focus();
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
