const API_BASE = '/api';

document.addEventListener('DOMContentLoaded', async () => {
    const ok = await requireAuth();
    if (!ok) return;
    setupNavigation();
    setupMobileSidebar();
    loadSection('scan');
    setupRealtime();
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

const scanState = {
    lineId: '',
    process: null,
    assignedEmployee: null,
    stage: 'process'
};

const progressState = {
    lineId: '',
    process: null
};

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
        if (window.innerWidth > 768) {
            closeMobileSidebar();
        }
    });
}

function closeMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}

async function loadSection(section) {
    if (section === 'progress') {
        await loadProgressSection();
        return;
    }
    await loadScanSection();
}

async function loadScanSection() {
    const content = document.getElementById('supervisor-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const response = await fetch(`${API_BASE}/supervisor/lines`);
        const result = await response.json();
        const lines = result.data || [];
        const date = new Date().toISOString().slice(0, 10);

        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Scan & Attendance</h1>
                    <p class="page-subtitle">Scan employee and process QR to mark attendance</p>
                </div>
                <span class="status-badge">Live • ${date}</span>
            </div>

            <div class="supervisor-panel">
                <div class="scan-box">
                    <h3>Line Selection</h3>
                    <div class="scan-inputs">
                        <label class="form-label">Line</label>
                        <select class="form-control" id="scan-line">
                            <option value="">Select Line</option>
                            ${lines.map(line => `
                                <option value="${line.id}">
                                    ${line.line_name} (${line.line_code})${line.product_code ? ` • ${line.product_code}` : ''}
                                </option>
                            `).join('')}
                        </select>
                        <div class="scan-status">
                            <div class="scan-row">
                                <span class="scan-label">Work Process</span>
                                <span class="scan-value" id="scan-process-text">Not scanned</span>
                            </div>
                            <div class="scan-row">
                                <span class="scan-label">Assigned Employee</span>
                                <span class="scan-value" id="scan-employee-text">Not assigned</span>
                            </div>
                            <div class="scan-row">
                                <span class="scan-label">Materials at Link</span>
                                <input type="number" class="form-control scan-input" id="scan-materials" min="0" value="0">
                            </div>
                            <div class="scan-hint" id="scan-hint">Step 1: Scan the work process QR.</div>
                            <button class="btn btn-secondary btn-sm" id="scan-reset" type="button">Change Process</button>
                        </div>
                    </div>
                </div>

                <div class="scan-box">
                    <h3>QR Scan</h3>
                    <div class="scan-inputs">
                        <div class="camera-panel">
                            <div class="camera-header">
                                <span class="status-badge" id="camera-status">Camera Idle</span>
                                <div class="camera-actions">
                                    <button class="btn btn-secondary btn-sm" id="camera-start">Start Camera</button>
                                    <button class="btn btn-secondary btn-sm" id="camera-stop" disabled>Stop</button>
                                </div>
                            </div>
                            <video id="camera-preview" playsinline muted></video>
                        </div>
                        <div class="scan-callout" id="scan-status-text">Waiting for process scan...</div>
                    </div>
                </div>

                <div class="scan-box">
                    <h3>Help</h3>
                    <p style="color: var(--secondary); font-size: 14px;">
                        Select a line, then scan the work process QR. The assigned employee appears here.
                        Scan an employee QR to confirm or change the assignment and mark attendance.
                    </p>
                </div>
            </div>
        `;

        document.getElementById('camera-start').addEventListener('click', startCameraScan);
        document.getElementById('camera-stop').addEventListener('click', stopCameraScan);
        document.getElementById('scan-line').addEventListener('change', handleLineChange);
        document.getElementById('scan-reset').addEventListener('click', resetProcessScan);
        scanState.lineId = '';
        resetProcessScan();
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function handleLineChange() {
    const lineId = document.getElementById('scan-line').value;
    scanState.lineId = lineId;
    resetProcessScan();
}

function resetProcessScan() {
    scanState.process = null;
    scanState.assignedEmployee = null;
    scanState.stage = 'process';
    updateScanDisplay();
}

function updateScanDisplay() {
    const processText = document.getElementById('scan-process-text');
    const employeeText = document.getElementById('scan-employee-text');
    const hint = document.getElementById('scan-hint');
    const statusText = document.getElementById('scan-status-text');

    if (scanState.process) {
        processText.textContent = `${scanState.process.operation_code} - ${scanState.process.operation_name} (ID ${scanState.process.id})`;
    } else {
        processText.textContent = 'Not scanned';
    }

    if (scanState.assignedEmployee) {
        employeeText.textContent = `${scanState.assignedEmployee.emp_code} - ${scanState.assignedEmployee.emp_name} (ID ${scanState.assignedEmployee.id})`;
    } else {
        employeeText.textContent = 'Not assigned';
    }

    if (!scanState.lineId) {
        hint.textContent = 'Select a line before scanning.';
        statusText.textContent = 'Waiting for line selection...';
        return;
    }

    if (scanState.stage === 'process') {
        hint.textContent = 'Step 1: Scan the work process QR.';
        statusText.textContent = 'Waiting for process scan...';
    } else {
        hint.textContent = 'Step 2: Scan the employee QR to confirm or change.';
        statusText.textContent = 'Waiting for employee scan...';
    }
}

let cameraStream = null;
let scanning = false;
let detector = null;
let lastScanAt = 0;

async function startCameraScan() {
    const status = document.getElementById('camera-status');
    const video = document.getElementById('camera-preview');
    try {
        if ('BarcodeDetector' in window) {
            detector = new BarcodeDetector({ formats: ['qr_code'] });
        } else if (window.jsQR) {
            detector = null;
        } else {
            showToast('Camera QR scan not supported on this device', 'error');
            return;
        }
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false
        });
        video.srcObject = cameraStream;
        await video.play();
        scanning = true;
        status.textContent = 'Scanning...';
        document.getElementById('camera-start').disabled = true;
        document.getElementById('camera-stop').disabled = false;
        scanFrame();
    } catch (err) {
        showToast('Unable to access camera', 'error');
        status.textContent = 'Camera Error';
    }
}

function stopCameraScan() {
    scanning = false;
    const status = document.getElementById('camera-status');
    status.textContent = 'Camera Stopped';
    document.getElementById('camera-start').disabled = false;
    document.getElementById('camera-stop').disabled = true;
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
}

async function scanFrame() {
    if (!scanning) return;
    const video = document.getElementById('camera-preview');
    try {
        if (detector) {
            const barcodes = await detector.detect(video);
            if (barcodes.length) {
                const now = Date.now();
                if (now - lastScanAt > 1200) {
                    lastScanAt = now;
                    handleQrValue(barcodes[0].rawValue);
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
                if (code && code.data) {
                    const now = Date.now();
                    if (now - lastScanAt > 1200) {
                        lastScanAt = now;
                        handleQrValue(code.data);
                    }
                }
            }
        }
    } catch (err) {
        // ignore scan errors
    }
    requestAnimationFrame(scanFrame);
}

function handleQrValue(rawValue) {
    let parsed = null;
    try {
        parsed = JSON.parse(rawValue);
    } catch (err) {
        parsed = null;
    }
    const lineSelect = document.getElementById('scan-line');
    if (!scanState.lineId) {
        showToast('Select a line first', 'error');
        return;
    }

    if (parsed && parsed.type === 'line' && parsed.id) {
        lineSelect.value = parsed.id;
        scanState.lineId = parsed.id;
        resetProcessScan();
        showToast('Line QR captured', 'success');
    } else {
        const isProcessType = parsed && (parsed.type === 'process' || parsed.type === 'operation');
        if (parsed && parsed.type === 'employee' && scanState.stage === 'process') {
            showToast('Scan the work process first', 'error');
            return;
        }
        if (isProcessType || scanState.stage === 'process') {
            resolveProcessScan(rawValue);
        } else {
            assignEmployeeScan(rawValue);
        }
    }
}

async function resolveProcessScan(processQr) {
    if (!scanState.lineId) {
        showToast('Select a line first', 'error');
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/supervisor/resolve-process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: scanState.lineId, process_qr: processQr })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        scanState.process = result.data.process;
        scanState.assignedEmployee = result.data.employee || null;
        scanState.stage = 'employee';
        updateScanDisplay();
        showToast('Process scanned', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function assignEmployeeScan(employeeQr) {
    if (!scanState.lineId) {
        showToast('Select a line first', 'error');
        return;
    }
    if (!scanState.process) {
        showToast('Scan a work process first', 'error');
        scanState.stage = 'process';
        updateScanDisplay();
        return;
    }
    await submitEmployeeAssignment(employeeQr, null);
}

async function submitEmployeeAssignment(employeeQr, quantityCompleted, confirmChange = false) {
    const materialsAtLink = document.getElementById('scan-materials')?.value || 0;
    try {
        const response = await fetch(`${API_BASE}/supervisor/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: scanState.lineId,
                process_id: scanState.process.id,
                employee_qr: employeeQr,
                quantity_completed: quantityCompleted,
                materials_at_link: materialsAtLink,
                confirm_change: confirmChange
            })
        });
        const result = await response.json();
        if (!result.success) {
            if (result.error && result.error.includes('Confirm change')) {
                const confirmChange = window.confirm('This will change the current employee assignment. Continue?');
                if (!confirmChange) return;
                return submitEmployeeAssignment(employeeQr, quantityCompleted, true);
            }
            if (result.error && result.error.includes('Quantity completed')) {
                showAssignmentChangeModal(employeeQr);
                return;
            }
            showToast(result.error, 'error');
            return;
        }
        scanState.assignedEmployee = result.data.employee;
        scanState.stage = 'employee';
        updateScanDisplay();
        showToast('Employee linked and attendance marked', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function showAssignmentChangeModal(employeeQr) {
    const existing = document.getElementById('assignment-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.className = 'progress-modal-backdrop';
    modal.id = 'assignment-modal';
    modal.innerHTML = `
        <div class="progress-modal">
            <div class="progress-modal-header">
                <h3>Change Employee</h3>
                <button class="modal-close" type="button" id="assignment-modal-close">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="progress-modal-body">
                <div class="progress-modal-info">
                    <div>
                        <div class="scan-label">Process</div>
                        <div class="scan-value">${scanState.process.operation_code} - ${scanState.process.operation_name}</div>
                    </div>
                    <div>
                        <div class="scan-label">Current Employee</div>
                        <div class="scan-value">${scanState.assignedEmployee ? `${scanState.assignedEmployee.emp_code} - ${scanState.assignedEmployee.emp_name}` : 'Unassigned'}</div>
                    </div>
                </div>
                <label class="form-label">Quantity Completed (before change)</label>
                <input type="number" class="form-control" id="assignment-quantity" min="0" value="0">
                <label class="form-label">Materials at Link</label>
                <input type="number" class="form-control" id="assignment-materials" min="0" value="0">
            </div>
            <div class="progress-modal-footer">
                <button class="btn btn-secondary" type="button" id="assignment-modal-cancel">Cancel</button>
                <button class="btn btn-primary" type="button" id="assignment-modal-save">Submit</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);
    document.getElementById('assignment-modal-save').addEventListener('click', async () => {
        const qty = document.getElementById('assignment-quantity').value;
        const materials = document.getElementById('assignment-materials').value;
        const scanMaterials = document.getElementById('scan-materials');
        if (scanMaterials) scanMaterials.value = materials;
        await submitEmployeeAssignment(employeeQr, qty);
        closeAssignmentModal();
    });
    document.getElementById('assignment-modal-cancel').addEventListener('click', closeAssignmentModal);
    document.getElementById('assignment-modal-close').addEventListener('click', closeAssignmentModal);
}

function closeAssignmentModal() {
    const modal = document.getElementById('assignment-modal');
    if (!modal) return;
    modal.classList.remove('active');
    setTimeout(() => modal.remove(), 150);
}

async function loadProgressSection() {
    const content = document.getElementById('supervisor-content');
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
        const response = await fetch(`${API_BASE}/supervisor/lines`);
        const result = await response.json();
        const lines = result.data || [];
        const date = new Date().toISOString().slice(0, 10);
        const hour = new Date().getHours();
        const hourStart = 8;
        const hourEnd = 19;
        const defaultHour = hour >= hourStart && hour <= hourEnd ? hour : hourStart;

        content.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Hourly Progress</h1>
                    <p class="page-subtitle">Log hourly output by process</p>
                </div>
                <div class="supervisor-controls">
                    <div>
                        <label class="form-label">Line</label>
                        <select class="form-control" id="progress-line">
                            <option value="">Select Line</option>
                            ${lines.map(line => `
                                <option value="${line.id}">
                                    ${line.line_name} (${line.line_code})
                                </option>
                            `).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="form-label">Date</label>
                        <input type="date" class="form-control" id="progress-date" value="${date}">
                    </div>
                    <div>
                        <label class="form-label">Hour</label>
                        <select class="form-control" id="progress-hour">
                            ${Array.from({ length: hourEnd - hourStart + 1 }).map((_, i) => {
                                const value = hourStart + i;
                                return `<option value="${value}" ${value === defaultHour ? 'selected' : ''}>${String(value).padStart(2, '0')}:00</option>`;
                            }).join('')}
                        </select>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Process Output</h3>
                </div>
                <div class="card-body">
                    <div id="progress-list" class="progress-grid">
                        <div class="alert alert-info">Scan a work process to record hourly output.</div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Line Metrics</h3>
                </div>
                <div class="card-body">
                    <div class="metrics-grid">
                        <div>
                            <label class="form-label">Forwarded Quantity</label>
                            <input type="number" class="form-control" id="metrics-forwarded" min="0" value="0">
                        </div>
                        <div>
                            <label class="form-label">Remaining WIP</label>
                            <input type="number" class="form-control" id="metrics-wip" min="0" value="0">
                        </div>
                        <div>
                            <label class="form-label">Initial Materials Issued</label>
                            <input type="number" class="form-control" id="metrics-materials" min="0" value="0">
                        </div>
                        <div class="metrics-action">
                            <button class="btn btn-primary" id="metrics-save">Save Metrics</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Logged Progress</h3>
                </div>
                <div class="card-body">
                    <div id="progress-log" class="progress-log">
                        <div class="alert alert-info">Select a line to view hourly progress.</div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('progress-line').addEventListener('change', () => {
            progressState.lineId = document.getElementById('progress-line').value;
            resetProgressProcess();
            loadProgressLog();
            loadLineMetrics();
        });
        document.getElementById('progress-date').addEventListener('change', loadProgressLog);
        document.getElementById('progress-date').addEventListener('change', loadLineMetrics);
        document.getElementById('metrics-save').addEventListener('click', saveLineMetrics);
        progressState.lineId = '';
        resetProgressProcess();
        loadLineMetrics();
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

function resetProgressProcess() {
    progressState.process = null;
    const list = document.getElementById('progress-list');
    if (list) {
        list.innerHTML = progressState.lineId
            ? `<div class="progress-scan-shell">
                    <div class="camera-panel">
                        <div class="camera-header">
                            <span class="status-badge" id="progress-camera-status">Camera Idle</span>
                            <div class="camera-actions">
                                <button class="btn btn-secondary btn-sm" id="progress-camera-start">Start Camera</button>
                                <button class="btn btn-secondary btn-sm" id="progress-camera-stop" disabled>Stop</button>
                            </div>
                        </div>
                        <video id="progress-camera-preview" playsinline muted></video>
                    </div>
                    <div class="scan-status">
                        <div class="scan-row">
                            <span class="scan-label">Work Process</span>
                            <span class="scan-value" id="progress-process-text">Scan the QR</span>
                        </div>
                        <div class="scan-row">
                            <span class="scan-label">Target</span>
                            <span class="scan-value" id="progress-target-text">-</span>
                        </div>
                        <div class="scan-hint" id="progress-hint">Scan the work process QR to log output.</div>
                    </div>
               </div>`
            : '<div class="alert alert-info">Select a line to start scanning.</div>';
    }
    if (progressState.lineId) {
        document.getElementById('progress-camera-start').addEventListener('click', startProgressCameraScan);
        document.getElementById('progress-camera-stop').addEventListener('click', stopProgressCameraScan);
    }
}

async function saveProgress() {
    const lineId = document.getElementById('progress-line').value;
    const date = document.getElementById('progress-date').value;
    const hour = document.getElementById('progress-hour').value;
    const qty = document.getElementById('progress-quantity').value;
    if (!lineId || !date) {
        showToast('Line and date are required', 'error');
        return;
    }
    if (!progressState.process) {
        showToast('Scan a work process first', 'error');
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/supervisor/progress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: lineId,
                process_id: progressState.process.id,
                work_date: date,
                hour_slot: hour,
                quantity: qty
            })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        showToast('Saved', 'success');
        loadProgressLog();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

let progressCameraStream = null;
let progressScanning = false;
let progressDetector = null;
let progressLastScanAt = 0;

async function startProgressCameraScan() {
    const status = document.getElementById('progress-camera-status');
    const video = document.getElementById('progress-camera-preview');
    try {
        if ('BarcodeDetector' in window) {
            progressDetector = new BarcodeDetector({ formats: ['qr_code'] });
        } else if (window.jsQR) {
            progressDetector = null;
        } else {
            showToast('Camera QR scan not supported on this device', 'error');
            return;
        }
        progressCameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false
        });
        video.srcObject = progressCameraStream;
        await video.play();
        progressScanning = true;
        status.textContent = 'Scanning...';
        document.getElementById('progress-camera-start').disabled = true;
        document.getElementById('progress-camera-stop').disabled = false;
        scanProgressFrame();
    } catch (err) {
        showToast('Unable to access camera', 'error');
        status.textContent = 'Camera Error';
    }
}

function stopProgressCameraScan() {
    progressScanning = false;
    const status = document.getElementById('progress-camera-status');
    status.textContent = 'Camera Stopped';
    document.getElementById('progress-camera-start').disabled = false;
    document.getElementById('progress-camera-stop').disabled = true;
    if (progressCameraStream) {
        progressCameraStream.getTracks().forEach(track => track.stop());
        progressCameraStream = null;
    }
}

async function scanProgressFrame() {
    if (!progressScanning) return;
    const video = document.getElementById('progress-camera-preview');
    try {
        if (progressDetector) {
            const barcodes = await progressDetector.detect(video);
            if (barcodes.length) {
                const now = Date.now();
                if (now - progressLastScanAt > 1200) {
                    progressLastScanAt = now;
                    handleProgressQrValue(barcodes[0].rawValue);
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
                if (code && code.data) {
                    const now = Date.now();
                    if (now - progressLastScanAt > 1200) {
                        progressLastScanAt = now;
                        handleProgressQrValue(code.data);
                    }
                }
            }
        }
    } catch (err) {
        // ignore scan errors
    }
    requestAnimationFrame(scanProgressFrame);
}

async function handleProgressQrValue(rawValue) {
    if (!progressState.lineId) {
        showToast('Select a line first', 'error');
        return;
    }
    try {
        const date = document.getElementById('progress-date').value;
        const response = await fetch(`${API_BASE}/supervisor/resolve-process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: progressState.lineId, process_qr: rawValue, work_date: date })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        progressState.process = result.data.process;
        const processText = document.getElementById('progress-process-text');
        const targetText = document.getElementById('progress-target-text');
        if (processText) {
            processText.textContent = `${progressState.process.operation_code} - ${progressState.process.operation_name}`;
        }
        if (targetText) {
            targetText.textContent = String(progressState.process.target_units || 0);
        }
        showProgressEntryModal();
        showToast('Process scanned', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function showProgressEntryModal() {
    const existing = document.getElementById('progress-modal');
    if (existing) existing.remove();
    const targetUnits = progressState.process?.target_units || 0;
    const modal = document.createElement('div');
    modal.className = 'progress-modal-backdrop';
    modal.id = 'progress-modal';
    modal.innerHTML = `
        <div class="progress-modal">
            <div class="progress-modal-header">
                <h3>Hourly Output</h3>
                <button class="modal-close" type="button" id="progress-modal-close">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="progress-modal-body">
                <div class="progress-modal-info">
                    <div>
                        <div class="scan-label">Process</div>
                        <div class="scan-value">${progressState.process.operation_code} - ${progressState.process.operation_name}</div>
                    </div>
                    <div>
                        <div class="scan-label">Target</div>
                        <div class="scan-value">${targetUnits}</div>
                    </div>
                </div>
                <label class="form-label">Quantity (units)</label>
                <input type="number" class="form-control" id="progress-quantity" min="0" value="0">
            </div>
            <div class="progress-modal-footer">
                <button class="btn btn-secondary" type="button" id="progress-modal-cancel">Cancel</button>
                <button class="btn btn-primary" type="button" id="progress-modal-save">Submit</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);
    document.getElementById('progress-modal-save').addEventListener('click', async () => {
        await saveProgress();
        closeProgressModal();
    });
    document.getElementById('progress-modal-cancel').addEventListener('click', closeProgressModal);
    document.getElementById('progress-modal-close').addEventListener('click', closeProgressModal);
}

function closeProgressModal() {
    const modal = document.getElementById('progress-modal');
    if (!modal) return;
    modal.classList.remove('active');
    setTimeout(() => modal.remove(), 150);
}

async function loadProgressLog() {
    const lineId = document.getElementById('progress-line').value;
    const date = document.getElementById('progress-date').value;
    const log = document.getElementById('progress-log');
    if (!lineId) {
        log.innerHTML = '<div class="alert alert-info">Select a line to view hourly progress.</div>';
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/supervisor/progress?line_id=${lineId}&work_date=${date}`);
        const result = await response.json();
        const rows = result.data || [];
        if (!rows.length) {
            log.innerHTML = '<div class="alert alert-warning">No progress logged yet.</div>';
            return;
        }
        log.innerHTML = rows.map(row => `
            <div class="progress-log-row">
                <div class="progress-log-hour">${String(row.hour_slot).padStart(2, '0')}:00</div>
                <div class="progress-log-work">${row.operation_code} - ${row.operation_name}</div>
                <div class="progress-log-qty">${row.quantity}</div>
            </div>
        `).join('');
    } catch (err) {
        log.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

async function loadLineMetrics() {
    const lineId = document.getElementById('progress-line').value;
    const date = document.getElementById('progress-date').value;
    if (!lineId) {
        const forwarded = document.getElementById('metrics-forwarded');
        const wip = document.getElementById('metrics-wip');
        const materials = document.getElementById('metrics-materials');
        if (forwarded) forwarded.value = 0;
        if (wip) wip.value = 0;
        if (materials) materials.value = 0;
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/line-metrics?line_id=${lineId}&date=${date}`);
        const result = await response.json();
        if (result.success && result.data) {
            document.getElementById('metrics-forwarded').value = result.data.forwarded_quantity || 0;
            document.getElementById('metrics-wip').value = result.data.remaining_wip || 0;
            document.getElementById('metrics-materials').value = result.data.materials_issued || 0;
        } else {
            document.getElementById('metrics-forwarded').value = 0;
            document.getElementById('metrics-wip').value = 0;
            document.getElementById('metrics-materials').value = 0;
        }
    } catch (err) {
        showToast('Failed to load metrics', 'error');
    }
}

async function saveLineMetrics() {
    const lineId = document.getElementById('progress-line').value;
    const date = document.getElementById('progress-date').value;
    if (!lineId) {
        showToast('Select a line first', 'error');
        return;
    }
    const forwarded = document.getElementById('metrics-forwarded').value;
    const wip = document.getElementById('metrics-wip').value;
    const materials = document.getElementById('metrics-materials').value;
    try {
        const response = await fetch(`${API_BASE}/line-metrics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: lineId,
                work_date: date,
                forwarded_quantity: forwarded,
                remaining_wip: wip,
                materials_issued: materials
            })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        showToast('Metrics saved', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function setupRealtime() {
    const source = new EventSource('/events');
    source.addEventListener('data_change', (event) => {
        let payload = {};
        try {
            payload = JSON.parse(event.data || '{}');
        } catch (err) {
            return;
        }
        if (payload.entity === 'attendance') {
            const active = document.querySelector('.nav-link.active')?.dataset.section;
            if (active === 'scan') {
                // no reload, just keep UI live
            }
        }
        if (payload.entity === 'progress') {
            // no-op for now
        }
    });
    source.onerror = () => {
        source.close();
        setTimeout(setupRealtime, 3000);
    };
}

function showToast(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            ${type === 'success'
                ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>'
                : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>'}
        </svg>
        <span>${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}
