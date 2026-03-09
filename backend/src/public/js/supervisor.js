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
    workstations: null,
    targetQty: 0,
    selectedWorkstation: null,
    selectedWorkstationPlanId: null,
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
        const allAssigned = workstations.every(ws => ws.assigned_emp_name);

        const rows = workstations.map(ws => {
            const assigned = ws.assigned_emp_name
                ? `<span style="color:#16a34a; font-weight:600;">${ws.assigned_emp_code} - ${ws.assigned_emp_name}</span>`
                : '<span style="color:#dc2626;">Not assigned</span>';
            const icon = ws.assigned_emp_name ? '&#10003;' : '&#9888;';
            const iconColor = ws.assigned_emp_name ? '#16a34a' : '#f59e0b';
            const processList = (ws.processes || []).map(p => `${p.operation_code} - ${p.operation_name}`).join(', ');
            const workloadColor = ws.workload_pct > 100 ? '#dc2626' : ws.workload_pct > 85 ? '#d97706' : '#16a34a';

            return `<tr>
                <td style="font-weight:700;">${ws.workstation_code}</td>
                <td style="font-size:0.85em;">${processList}</td>
                <td style="text-align:center; font-weight:600; color:${workloadColor};">${parseFloat(ws.workload_pct||0).toFixed(0)}%</td>
                <td><span style="color:${iconColor}; margin-right:6px;">${icon}</span>${assigned}</td>
                <td>
                    <button class="btn btn-primary btn-sm" onclick="startMorningScan(${JSON.stringify(ws.workstation_code)}, ${ws.id})">
                        Scan Worker
                    </button>
                </td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Workstation Assignments</h3>
                    <span style="font-size:0.85em; color:#6b7280;">
                        ${workstations.length} workstations &nbsp;|&nbsp;
                        ${allAssigned ? '<span style="color:#16a34a;">All assigned</span>' : '<span style="color:#dc2626;">Some unassigned</span>'}
                    </span>
                </div>
                <div class="card-body table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Workstation</th>
                                <th>Processes</th>
                                <th style="text-align:center;">Workload</th>
                                <th>Assigned Worker</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
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
            wsMap.set(ws, { workstation_code: ws, processes: [], assigned_emp_code: null, assigned_emp_name: null, plan_id: null });
        }
        wsMap.get(ws).processes.push(p);
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

        return `<tr>
            <td style="font-weight:600;">${ws.workstation_code}</td>
            <td>${processList}</td>
            <td><span style="color:${iconColor}; margin-right:6px;">${icon}</span> ${assigned}</td>
            <td>
                <button class="btn btn-primary btn-sm" onclick="startMorningScan(${JSON.stringify(ws.workstation_code)}, null)">
                    Scan Worker
                </button>
            </td>
        </tr>`;
    }).join('');

    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Workstation Assignments</h3>
                <small style="color:#f59e0b;">No balance plan — using product-level grouping</small>
            </div>
            <div class="card-body table-container">
                <table>
                    <thead>
                        <tr><th>Workstation</th><th>Processes</th><th>Assigned Worker</th><th>Action</th></tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
}

function startMorningScan(workstationCode, linePlanWorkstationId) {
    morningState.selectedWorkstation = workstationCode;
    morningState.selectedWorkstationPlanId = linePlanWorkstationId || null;
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

        const today = new Date().toISOString().slice(0, 10);
        const response = await fetch(`${API_BASE}/workstation-assignments`, {
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
    morningState.selectedWorkstationPlanId = null;
    morningState.scannedEmployee = null;
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
                    <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:end; margin-bottom:14px;">
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
                        <div style="min-width:100px;" id="hourly-hour-wrap">
                            <label class="form-label">Hour</label>
                            <select class="form-control" id="hourly-hour">
                                ${Array.from({ length: hourEnd - hourStart + 1 }).map((_, i) => {
                                    const v = hourStart + i;
                                    return `<option value="${v}" ${v === defaultHour ? 'selected' : ''}>${String(v).padStart(2, '0')}:00</option>`;
                                }).join('')}
                            </select>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; border-bottom:2px solid #e5e7eb; padding-bottom:0;">
                        <button id="ht-regular-btn" onclick="switchHourlyMode('regular')"
                            style="padding:8px 18px; border:none; border-radius:6px 6px 0 0; cursor:pointer; font-weight:600; font-size:14px; background:#3b82f6; color:#fff;">
                            Regular Shift
                        </button>
                        <button id="ht-ot-btn" onclick="switchHourlyMode('ot')"
                            style="padding:8px 18px; border:none; border-radius:6px 6px 0 0; cursor:pointer; font-weight:600; font-size:14px; background:#f3f4f6; color:#374151;">
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
        regularBtn.style.background = '#f3f4f6'; regularBtn.style.color = '#374151';
        otBtn.style.background = '#7c3aed'; otBtn.style.color = '#fff';
        if (regularSec) regularSec.style.display = 'none';
        if (otSec) otSec.style.display = '';
        if (hourWrap) hourWrap.style.display = 'none';
        stopCamera();
        const date = document.getElementById('hourly-date')?.value || new Date().toISOString().slice(0, 10);
        loadOtPlanList(date);
    } else {
        regularBtn.style.background = '#3b82f6'; regularBtn.style.color = '#fff';
        otBtn.style.background = '#f3f4f6'; otBtn.style.color = '#374151';
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

        const rows = workstations.map(ws => {
            const isWsChangeover = !!ws.ws_changeover_active;
            const wsHourlyTarget = isWsChangeover
                ? (ws.ws_changeover_target != null ? ws.ws_changeover_target : Math.round(perHourIncoming))
                : Math.round(perHourTarget);

            // Progress for this workstation = look at any process in it for this hour
            const wsProcessIds = (ws.processes || []).map(p => p.process_id || p.id);
            const progress = hourlyState.progressData.find(
                d => wsProcessIds.includes(parseInt(d.process_id)) && parseInt(d.hour_slot) === hour
            );
            const output = progress ? parseInt(progress.quantity || 0) : 0;
            const reason = progress?.shortfall_reason || '';
            const worker = ws.assigned_emp_name
                ? `${ws.assigned_emp_code} - ${ws.assigned_emp_name}`
                : '<span style="color:#dc2626;">Unassigned</span>';
            const processList = (ws.processes || []).map(p => p.operation_name).join(', ');
            const workloadColor = ws.workload_pct > 100 ? '#dc2626' : ws.workload_pct > 85 ? '#d97706' : '#16a34a';

            const needsReason = output > 0 && wsHourlyTarget > 0 && output < wsHourlyTarget && !reason;
            let statusHtml = '';
            if (output > 0) {
                if (wsHourlyTarget > 0 && output < wsHourlyTarget) {
                    statusHtml = needsReason
                        ? `<span style="color:#dc2626;font-weight:700;">&#9888; Below target</span><br><small style="color:#dc2626;font-weight:600;">Please Update Reason</small>`
                        : `<span style="color:#dc2626;font-weight:600;">Below target</span><br><small style="color:#6b7280;">${reason}</small>`;
                } else {
                    statusHtml = `<span style="color:#16a34a;font-weight:600;">On track</span>`;
                }
            } else {
                statusHtml = '<span style="color:#6b7280;">-</span>';
            }

            // Per-WS changeover badge and action button
            let coCell = '';
            if (hasChangeover) {
                if (isWsChangeover) {
                    const coTime = ws.ws_changeover_started_at ? new Date(ws.ws_changeover_started_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
                    coCell = `<span style="background:#7c3aed;color:#fff;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700;">&#8652; CO</span>
                        ${coTime ? `<br><small style="color:#7c3aed;">${coTime}</small>` : ''}
                        <br><button class="btn btn-secondary btn-sm" style="margin-top:3px;font-size:11px;" onclick="openWsChangeoverEmployeeChange(${JSON.stringify(ws.workstation_code)}, ${ws.id || ws.primary_ws_id || 'null'})">Change Employee</button>`;
                } else {
                    coCell = `<button class="btn btn-sm" style="font-size:11px;padding:2px 8px;background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;"
                        onclick="activateWsChangeover(${JSON.stringify(ws.workstation_code)}, '${date}', false)">&#8652; Start CO</button>`;
                }
            }

            return `<tr style="${needsReason ? 'background:#fff5f5;' : (isWsChangeover ? 'background:#f5f3ff;' : '')}">
                <td style="font-weight:700;">${ws.workstation_code}${needsReason ? ' <span style="color:#dc2626;">&#9888;</span>' : ''}</td>
                <td style="font-size:0.85em; color:#6b7280;">${processList}</td>
                <td style="text-align:center; color:${workloadColor}; font-weight:600;">${parseFloat(ws.workload_pct||0).toFixed(0)}%</td>
                <td>${worker}</td>
                <td style="text-align:center;"><strong>${wsHourlyTarget || '-'}</strong><br><small style="color:#9ca3af;font-size:10px;">per hr</small></td>
                <td style="text-align:center; font-weight:600;">${output || '-'}</td>
                <td>${statusHtml}</td>
                ${hasChangeover ? `<td style="font-size:12px;">${coCell}</td>` : ''}
                <td>
                    <button class="btn btn-primary btn-sm" onclick="openWorkstationHourlyEntry(${ws.id})">
                        Enter Output
                    </button>
                </td>
            </tr>`;
        }).join('');

        const perHourDisplay = Math.round(perHourTarget * 10) / 10;
        container.innerHTML = changeoverBanner + `
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Workstation Output Summary</h3>
                    <span style="font-size:0.85em; color:#6b7280;">
                        Per Hour Target: <strong>${perHourDisplay || '-'}</strong> &nbsp;|&nbsp;
                        Daily Target: <strong>${hourlyState.primaryTarget || hourlyState.targetQty || '-'}</strong>
                        ${hourlyState.incomingTarget ? ` &nbsp;|&nbsp; CO Target: <strong>${hourlyState.incomingTarget}</strong> (${Math.round(perHourIncoming)}/hr)` : ''}
                        &nbsp;|&nbsp; ${workstations.length} workstations
                    </span>
                </div>
                <div class="card-body table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Workstation</th>
                                <th>Processes</th>
                                <th style="text-align:center;">Workload</th>
                                <th>Worker</th>
                                <th style="text-align:center;">Target/hr</th>
                                <th style="text-align:center;">Output</th>
                                <th>Status</th>
                                ${hasChangeover ? '<th>Changeover</th>' : ''}
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
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

    const rows = processes.map(p => {
        const progress = hourlyState.progressData.find(
            d => parseInt(d.process_id) === p.id && parseInt(d.hour_slot) === hour
        );
        const output = progress ? parseInt(progress.quantity || 0) : 0;
        const reason = progress?.shortfall_reason || '';
        const worker = p.assigned_emp_name ? `${p.assigned_emp_code} - ${p.assigned_emp_name}` : '<span style="color:#dc2626;">Unassigned</span>';

        const needsReason = output > 0 && hourlyTarget > 0 && output < hourlyTarget && !reason;
        let statusHtml = '';
        if (output > 0) {
            if (hourlyTarget > 0 && output < hourlyTarget) {
                if (needsReason) {
                    statusHtml = `<span style="color:#dc2626;font-weight:700;">&#9888; Below target</span><br><small style="color:#dc2626;font-weight:600;">Please Update Reason</small>`;
                } else {
                    statusHtml = `<span style="color:#dc2626;font-weight:600;">Below target</span><br><small style="color:#6b7280;">${reason}</small>`;
                }
            } else {
                statusHtml = `<span style="color:#16a34a;font-weight:600;">On track</span>`;
            }
        } else {
            statusHtml = '<span style="color:#6b7280;">-</span>';
        }

        return `<tr style="${needsReason ? 'background:#fff5f5;' : ''}">
            <td style="font-weight:600;">${(p.workstation_code || p.group_name || '-')}${needsReason ? ' <span style="color:#dc2626;">&#9888;</span>' : ''}</td>
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

    container.innerHTML = changeoverBanner + `
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
    const existingReason = existing?.shortfall_reason || '';

    const scanPanel = document.getElementById('hourly-scan-panel');
    if (scanPanel) scanPanel.style.display = 'none';

    const entryPanel = document.getElementById('hourly-entry-panel');
    const entryTitle = document.getElementById('hourly-entry-title');
    const entryForm = document.getElementById('hourly-entry-form');

    const processList = (ws.processes || []).map(p => p.operation_name).join(' → ');
    entryTitle.textContent = `${ws.workstation_code} — Enter Output`;
    entryPanel.style.display = 'block';

    const workerInfo = ws.assigned_emp_name
        ? `${ws.assigned_emp_code} - ${ws.assigned_emp_name}`
        : '<span style="color:#dc2626;">Unassigned</span>';

    entryForm.innerHTML = `
        <div style="margin-bottom:12px;">
            <div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:8px;">
                <div><strong>Workstation:</strong> ${ws.workstation_code}</div>
                <div><strong>Worker:</strong> ${workerInfo}</div>
                <div><strong>Hourly Target:</strong> ${hourlyTarget || 'N/A'}</div>
                <div><strong>Hour:</strong> ${String(hour).padStart(2, '0')}:00</div>
            </div>
            <div style="font-size:0.85em; color:#6b7280;">Processes: ${processList}</div>
        </div>

        <div style="margin-bottom:16px;">
            <label class="form-label">Output Quantity</label>
            <input type="number" class="form-control" id="hourly-output-qty" min="0" value="${existingOutput || ''}"
                placeholder="Enter output quantity" style="max-width:200px;">
        </div>

        <div id="hourly-reason-section" style="margin-bottom:16px; display:${existingOutput > 0 && hourlyTarget > 0 && existingOutput < hourlyTarget ? 'block' : 'none'};">
            <label class="form-label" style="color:#dc2626; font-weight:700;">Reason for Shortfall (Required)</label>
            <select class="form-control" id="hourly-reason" style="max-width:300px;">
                <option value="">-- Select Reason --</option>
                ${SHORTFALL_REASONS.map(r => `<option value="${r}" ${existingReason === r ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
            <div id="hourly-reason-warning" style="display:none; color:#dc2626; font-weight:600; margin-top:8px; padding:8px 12px; background:#fef2f2; border-radius:6px; border:1px solid #fecaca;">
                &#9888; Please select a shortfall reason
            </div>
        </div>

        <div style="display:flex; gap:12px;">
            <button class="btn btn-primary" id="hourly-save-btn">Save Output</button>
            <button class="btn btn-secondary" id="hourly-entry-cancel">Cancel</button>
        </div>
    `;

    const outputInput = document.getElementById('hourly-output-qty');
    outputInput.addEventListener('input', () => {
        const val = parseInt(outputInput.value || 0, 10);
        document.getElementById('hourly-reason-section').style.display =
            (hourlyTarget > 0 && val > 0 && val < hourlyTarget) ? 'block' : 'none';
        document.getElementById('hourly-reason-warning').style.display = 'none';
    });

    document.getElementById('hourly-save-btn').addEventListener('click', saveWorkstationHourlyOutput);
    document.getElementById('hourly-entry-cancel').addEventListener('click', () => {
        entryPanel.style.display = 'none';
        hourlyState.selectedWorkstation = null;
    });

    entryPanel.scrollIntoView({ behavior: 'smooth' });
    outputInput.focus();
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
                <div class="ot-emp-picker" data-ws="${ws.workstation_code}" data-value="${ws.assigned_employee_id||''}" style="position:relative;">
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
                </div>
            </td>` : '';
            const statusCell = isFirst ? `<td style="text-align:center;vertical-align:middle;"${rs}>
                <button onclick="toggleOtWsActive(${JSON.stringify(ws.workstation_code)}, ${!isActive})"
                    class="btn btn-sm" style="min-width:80px;background:${isActive?'#dcfce7':'#fee2e2'};color:${isActive?'#16a34a':'#dc2626'};border:1px solid ${isActive?'#bbf7d0':'#fecaca'};">
                    ${isActive ? '● Active' : '○ Inactive'}</button></td>` : '';
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
