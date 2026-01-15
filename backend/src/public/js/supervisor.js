const API_BASE = '/api';

document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    loadSection('scan');
    setupRealtime();
});

function setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const section = link.dataset.section;
            loadSection(section);

            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
        });
    });
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
                        <label class="form-label">Employee QR Payload</label>
                        <textarea class="form-control" id="employee-qr" placeholder='{"type":"employee","id":1,"name":"..."}'></textarea>
                        <label class="form-label">Process QR Payload</label>
                        <textarea class="form-control" id="process-qr" placeholder='{"type":"process","id":10,"name":"..."}'></textarea>
                        <button class="btn btn-primary" id="scan-submit">Mark Present</button>
                    </div>
                </div>

                <div class="scan-box">
                    <h3>Help</h3>
                    <p style="color: var(--secondary); font-size: 14px;">
                        Scan the employee QR and the work process QR. The system will mark attendance
                        for today if the employee is assigned to that line and process.
                    </p>
                </div>
            </div>
        `;

        document.getElementById('scan-submit').addEventListener('click', submitScan);
        document.getElementById('camera-start').addEventListener('click', startCameraScan);
        document.getElementById('camera-stop').addEventListener('click', stopCameraScan);
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

async function submitScan() {
    const lineId = document.getElementById('scan-line').value;
    const employeeQr = document.getElementById('employee-qr').value;
    const processQr = document.getElementById('process-qr').value;
    if (!lineId || !employeeQr || !processQr) {
        showToast('Line, employee QR, and process QR are required', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/supervisor/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: lineId,
                employee_qr: employeeQr,
                process_qr: processQr
            })
        });
        const result = await response.json();
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        showToast('Attendance marked', 'success');
        document.getElementById('employee-qr').value = '';
        document.getElementById('process-qr').value = '';
    } catch (err) {
        showToast(err.message, 'error');
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
    const employeeField = document.getElementById('employee-qr');
    const processField = document.getElementById('process-qr');

    if (parsed && parsed.type === 'line' && parsed.id) {
        lineSelect.value = parsed.id;
        showToast('Line QR captured', 'success');
    } else if (parsed && parsed.type === 'employee' && parsed.id) {
        employeeField.value = JSON.stringify(parsed);
        showToast('Employee QR captured', 'success');
    } else if (parsed && (parsed.type === 'process' || parsed.type === 'operation') && parsed.id) {
        processField.value = JSON.stringify(parsed);
        showToast(`${parsed.type === 'operation' ? 'Operation' : 'Process'} QR captured`, 'success');
    } else {
        showToast('Unknown QR format', 'error');
        return;
    }

    if (lineSelect.value && employeeField.value && processField.value) {
        submitScan();
    }
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
                            ${Array.from({ length: 24 }).map((_, i) => `
                                <option value="${i}" ${i === hour ? 'selected' : ''}>${String(i).padStart(2, '0')}:00</option>
                            `).join('')}
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
                        <div class="alert alert-info">Select a line to load processes.</div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('progress-line').addEventListener('change', loadProgressProcesses);
    } catch (err) {
        content.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

async function loadProgressProcesses() {
    const lineId = document.getElementById('progress-line').value;
    const list = document.getElementById('progress-list');
    if (!lineId) {
        list.innerHTML = '<div class="alert alert-info">Select a line to load processes.</div>';
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/supervisor/processes/${lineId}`);
        const result = await response.json();
        const processes = result.data || [];
        if (!processes.length) {
            list.innerHTML = '<div class="alert alert-warning">No processes found for this line.</div>';
            return;
        }
        list.innerHTML = processes.map(proc => `
            <div class="progress-row">
                <label>${proc.sequence_number}. ${proc.operation_code} - ${proc.operation_name}</label>
                <input type="number" class="form-control" min="0" value="0" id="qty-${proc.id}">
                <button class="btn btn-secondary" onclick="saveProgress(${proc.id})">Save</button>
            </div>
        `).join('');
    } catch (err) {
        list.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
}

async function saveProgress(processId) {
    const lineId = document.getElementById('progress-line').value;
    const date = document.getElementById('progress-date').value;
    const hour = document.getElementById('progress-hour').value;
    const qty = document.getElementById(`qty-${processId}`).value;
    if (!lineId || !date) {
        showToast('Line and date are required', 'error');
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/supervisor/progress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                line_id: lineId,
                process_id: processId,
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
