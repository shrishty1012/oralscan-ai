// ── Config ──────────────────────────────────────────────────────────────────
const API = 'http://localhost:5000/api';

// ── State ────────────────────────────────────────────────────────────────────
let currentPage  = 'home';
let stream       = null;
let selectedFile = null;
let historyChart = null;

// Common USB endoscope/probe camera keyword patterns to auto-detect
const PROBE_KEYWORDS = ['endoscope', 'probe', 'usb camera', 'usb cam', 'inspection', 'intraoral', 'oral', 'scope'];

// ── Nav ───────────────────────────────────────────────────────────────────────
function showPage(pageId, linkEl) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById(`page-${pageId}`).classList.add('active');
  if (linkEl) linkEl.classList.add('active');
  currentPage = pageId;
  if (pageId === 'dashboard') loadDashboard();
  if (pageId === 'home')      loadHomeStats();
  if (pageId === 'scan') {
    // Auto-enumerate cameras and auto-start on Scan page navigation
    enumerateCameras().then(() => {
      // Auto-start camera only if not already running
      if (!stream) startCamera();
    });
  }
}

// ── API Health ────────────────────────────────────────────────────────────────
async function checkHealth() {
  const dot  = document.getElementById('apiStatus');
  const text = document.getElementById('apiStatusText');
  try {
    const r = await fetch(`${API}/health`, {signal: AbortSignal.timeout(4000)});
    if (r.ok) {
      dot.className  = 'status-dot ok';
      text.textContent = 'AI Online';
    } else throw new Error();
  } catch {
    dot.className  = 'status-dot err';
    text.textContent = 'API Offline';
  }
}

// ── Home Stats ────────────────────────────────────────────────────────────────
async function loadHomeStats() {
  try {
    const r = await fetch(`${API}/scans`);
    const data = await r.json();
    const s = data.summary;
    document.getElementById('hs-total').textContent     = s.total;
    document.getElementById('hs-normal').textContent    = s.normal;
    document.getElementById('hs-suspicious').textContent= s.suspicious;
    document.getElementById('hs-rate').textContent      = s.risk_rate + '%';
  } catch {}
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.getElementById('panel-camera').style.display = tab === 'camera' ? '' : 'none';
  document.getElementById('panel-upload').style.display = tab === 'upload' ? '' : 'none';
  if (tab === 'upload' && stream) stopCamera();
  if (tab === 'camera' && !stream) startCamera();
}

// ── Camera ────────────────────────────────────────────────────────────────────

/**
 * Returns true if the camera label looks like a USB probe/endoscope device.
 */
function isProbeCamera(label) {
  const lc = (label || '').toLowerCase();
  return PROBE_KEYWORDS.some(kw => lc.includes(kw));
}

async function enumerateCameras() {
  // Request permission first so labels are available
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
    tmp.getTracks().forEach(t => t.stop());
  } catch { /* permission denied — labels may be empty */ }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter(d => d.kind === 'videoinput');
  const sel = document.getElementById('cameraSelect');
  sel.innerHTML = '';

  let probeIndex = -1;

  cameras.forEach((cam, i) => {
    const opt = document.createElement('option');
    opt.value = cam.deviceId;

    // Mark USB probe cameras with a 🔬 icon
    const label = cam.label || `Camera ${i + 1}`;
    const isProbe = isProbeCamera(label);
    opt.textContent = isProbe ? `🔬 ${label} (Endoscope)` : label;
    opt.dataset.probe = isProbe ? '1' : '0';

    if (isProbe && probeIndex === -1) probeIndex = i;
    sel.appendChild(opt);
  });

  if (!cameras.length) {
    sel.innerHTML = '<option>No cameras found</option>';
    return;
  }

  // Auto-select the USB probe/endoscope camera if found
  if (probeIndex !== -1) {
    sel.selectedIndex = probeIndex;
    const probeLabel = cameras[probeIndex].label || `Camera ${probeIndex + 1}`;
    showToast(`🔬 Endoscope detected: ${probeLabel.substring(0, 40)}`, 'success');
  } else {
    // If no probe detected, pick the last non-default camera (most likely USB)
    if (cameras.length > 1) {
      sel.selectedIndex = cameras.length - 1;
    }
  }
}

async function startCamera() {
  try {
    const deviceId = document.getElementById('cameraSelect').value;

    // Prefer higher resolution for endoscope cameras for better AI accuracy
    const videoConstraints = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 960 } }
      : { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } };

    stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
    const video = document.getElementById('cameraFeed');
    video.srcObject = stream;
    document.getElementById('cameraIdle').classList.add('hidden');
    document.getElementById('scanLine').style.opacity = '1';
    document.getElementById('startCamBtn').disabled   = true;
    document.getElementById('captureBtn').disabled    = false;
    document.getElementById('stopCamBtn').disabled    = false;

    // Update hint based on whether it's a probe camera
    const selOpt = document.getElementById('cameraSelect').selectedOptions[0];
    const isProbe = selOpt && selOpt.dataset.probe === '1';
    document.getElementById('cameraHint').textContent = isProbe
      ? '🔬 Endoscope active — position inside oral cavity'
      : 'Position mouth area within the frame';

    showToast(isProbe ? '🔬 Endoscope camera started' : 'Camera started', 'success');
  } catch (e) {
    showToast('Camera error: ' + e.message, 'error');
    document.getElementById('startCamBtn').disabled = false;
  }
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  const video = document.getElementById('cameraFeed');
  video.srcObject = null;
  document.getElementById('cameraIdle').classList.remove('hidden');
  document.getElementById('scanLine').style.opacity   = '0';
  document.getElementById('startCamBtn').disabled     = false;
  document.getElementById('captureBtn').disabled      = true;
  document.getElementById('stopCamBtn').disabled      = true;
  document.getElementById('cameraHint').textContent   = 'Position mouth area within the frame';
}

function changeCamera() {
  if (stream) { stopCamera(); startCamera(); }
  else { startCamera(); }
}

async function captureAndPredict() {
  const video  = document.getElementById('cameraFeed');
  const canvas = document.getElementById('cameraCanvas');
  canvas.width  = video.videoWidth  || 640;
  canvas.height = video.videoHeight || 480;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const b64 = canvas.toDataURL('image/jpeg', 0.92);

  showLoading('Running AI analysis on oral scan…');
  try {
    const body = {
      image:        b64,
      patient_name: document.getElementById('patientName').value || 'Anonymous',
      patient_age:  document.getElementById('patientAge').value  || 'N/A',
      patient_id:   document.getElementById('patientId').value   || ''
    };
    const r    = await fetch(`${API}/predict/base64`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    displayResult(data);
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

// ── Upload ────────────────────────────────────────────────────────────────────
function handleFileSelect() {
  const file = document.getElementById('fileInput').files[0];
  if (!file) return;
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('previewImg').src = e.target.result;
    document.getElementById('uploadPreview').style.display = 'flex';
    document.getElementById('uploadZone').style.display    = 'none';
  };
  reader.readAsDataURL(file);
}

function clearUpload() {
  selectedFile = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('uploadPreview').style.display = 'none';
  document.getElementById('uploadZone').style.display    = '';
  hideResult();
}

async function analyseUpload() {
  if (!selectedFile) return;
  showLoading('Uploading & analysing…');
  try {
    const fd = new FormData();
    fd.append('image', selectedFile);
    fd.append('patient_name', document.getElementById('patientName').value || 'Anonymous');
    fd.append('patient_age',  document.getElementById('patientAge').value  || 'N/A');
    fd.append('patient_id',   document.getElementById('patientId').value   || '');
    const r    = await fetch(`${API}/predict/upload`, { method: 'POST', body: fd });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    displayResult(data);
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

// Drag & drop
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('uploadZone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      document.getElementById('fileInput').files = e.dataTransfer.files;
      handleFileSelect();
    } else showToast('Please drop an image file', 'error');
  });
});

// ── Display Result ────────────────────────────────────────────────────────────
function displayResult(data) {
  const card = document.getElementById('resultCard');
  card.style.display = '';
  card.className = `result-card ${data.label.toLowerCase()}`;

  // Icon
  const iconEl = document.getElementById('resultIcon');
  if (data.label === 'Normal') {
    iconEl.style.background = 'rgba(52,211,153,0.15)';
    iconEl.innerHTML = `<svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <path d="M6 13l5 5 9-9" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  } else {
    iconEl.style.background = 'rgba(248,113,113,0.15)';
    iconEl.innerHTML = `<svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <path d="M13 9v5M13 17v.5" stroke="#f87171" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M11.27 4L2 20h22L15.73 4H11.27z" stroke="#f87171" stroke-width="2" stroke-linejoin="round"/></svg>`;
  }

  document.getElementById('resultLabel').textContent  = data.label;
  document.getElementById('resultScanId').textContent = `Scan #${data.scan_id}`;

  // Risk badge
  const rb = document.getElementById('resultRisk');
  rb.textContent  = data.risk + ' Risk';
  rb.className    = `result-risk-badge ${data.risk}`;

  // Meter
  document.getElementById('resultConfText').textContent = data.confidence + '%';
  const fill = document.getElementById('resultMeterFill');
  fill.className = `meter-fill ${data.label.toLowerCase()}`;
  setTimeout(() => { fill.style.width = data.confidence + '%'; }, 50);

  // Meta
  document.getElementById('resultMetaScanId').textContent = data.scan_id;
  document.getElementById('resultMetaMethod').textContent = data.method === 'camera' ? '🔬 Live Camera' : '🖼 Upload';
  document.getElementById('resultMetaTime').textContent   = new Date(data.timestamp).toLocaleTimeString();

  // Note
  const note = document.getElementById('resultNote');
  note.textContent = data.label === 'Normal'
    ? '✅ No suspicious lesions detected. Continue regular dental check-ups as recommended.'
    : '⚠️ Suspicious indicators detected. Please consult an oral health specialist promptly for a clinical evaluation.';

  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideResult() {
  document.getElementById('resultCard').style.display = 'none';
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const r    = await fetch(`${API}/scans`);
    const data = await r.json();
    const s    = data.summary;

    document.getElementById('ds-total').textContent     = s.total;
    document.getElementById('ds-normal').textContent    = s.normal;
    document.getElementById('ds-suspicious').textContent= s.suspicious;
    document.getElementById('ds-rate').textContent      = s.risk_rate + '%';

    renderTable(data.scans);
    renderChart(data.scans);
  } catch (e) {
    showToast('Failed to load dashboard: ' + e.message, 'error');
  }
}

function renderTable(scans) {
  const tbody = document.getElementById('scansTableBody');
  if (!scans.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">No scans yet. Go to the Scan page to get started.</td></tr>`;
    return;
  }
  tbody.innerHTML = scans.map(s => {
    const dt = new Date(s.timestamp);
    const dateStr = dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const lc = s.label.toLowerCase();
    const rc = s.risk.toLowerCase();
    return `<tr>
      <td><code style="font-size:0.8rem;color:var(--text-muted)">${s.scan_id}</code></td>
      <td>${s.patient_name || '—'}</td>
      <td>${s.patient_age  || '—'}</td>
      <td><span class="badge badge-${lc}">${s.label}</span></td>
      <td><strong>${s.confidence}%</strong></td>
      <td><span class="badge badge-${rc}">${s.risk}</span></td>
      <td style="color:var(--text-muted);font-size:0.82rem">${s.method === 'camera' ? '🔬 Camera' : '🖼 Upload'}</td>
      <td style="color:var(--text-muted);font-size:0.82rem;white-space:nowrap">${dateStr}</td>
    </tr>`;
  }).join('');
}

function renderChart(scans) {
  const ctx = document.getElementById('historyChart').getContext('2d');
  if (historyChart) historyChart.destroy();

  // Group by date
  const grouped = {};
  scans.forEach(s => {
    const d = new Date(s.timestamp).toLocaleDateString();
    if (!grouped[d]) grouped[d] = { normal: 0, suspicious: 0 };
    if (s.label === 'Normal') grouped[d].normal++;
    else grouped[d].suspicious++;
  });
  const labels  = Object.keys(grouped).slice(-14);
  const normal  = labels.map(d => grouped[d].normal);
  const susp    = labels.map(d => grouped[d].suspicious);

  historyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Normal',     data: normal, backgroundColor: 'rgba(52,211,153,0.7)',  borderRadius: 6, borderSkipped: false },
        { label: 'Suspicious', data: susp,   backgroundColor: 'rgba(248,113,113,0.7)', borderRadius: 6, borderSkipped: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { labels: { color: '#7b83a6', font: { family: 'Inter', size: 12 } } } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7b83a6', font: { family: 'Inter' } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7b83a6', font: { family: 'Inter' }, precision: 0 }, beginAtZero: true }
      }
    }
  });
}

async function clearAllScans() {
  if (!confirm('Delete all scan records? This cannot be undone.')) return;
  try {
    await fetch(`${API}/scans`, { method: 'DELETE' });
    showToast('All scans cleared', 'success');
    loadDashboard();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showLoading(msg = 'Processing…') {
  document.getElementById('loadingMsg').textContent = msg;
  document.getElementById('loadingOverlay').style.display = 'flex';
}
function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}

let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); }, 3500);
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await checkHealth();
  await loadHomeStats();
  // Re-check health every 30s
  setInterval(checkHealth, 30000);
});
