/* ---------- Dark mode ---------- */
const themeToggle = document.getElementById('themeToggle');
const savedTheme = localStorage.getItem('cutbg-theme');
if (savedTheme === 'dark') {
  document.documentElement.setAttribute('data-theme', 'dark');
  themeToggle.textContent = '☀️';
}
themeToggle.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    themeToggle.textContent = '🌙';
    localStorage.setItem('cutbg-theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    themeToggle.textContent = '☀️';
    localStorage.setItem('cutbg-theme', 'dark');
  }
});

/* ---------- Anonymous usage counter (local + server-side aggregate tracking) ---------- */
const usageCounterEl = document.getElementById('usageCounter');
function getUsageCount() {
  return parseInt(localStorage.getItem('cutbg-usage-count') || '0', 10);
}
function bumpUsageCount() {
  const n = getUsageCount() + 1;
  localStorage.setItem('cutbg-usage-count', String(n));
  renderUsageCount();
}
function renderUsageCount() {
  const n = getUsageCount();
  usageCounterEl.textContent = n > 0
    ? `আপনি এই ব্রাউজারে ${n} বার ব্যবহার করেছেন · Fast, Free & Private`
    : `Fast, Free & Private — কোনো ছবি সার্ভারে যায় না`;
}
renderUsageCount();

function trackEvent(event, feature) {
  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, feature })
  }).catch(() => {});
}

/* ---------- Elements ---------- */
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const workArea = document.getElementById('workArea');
const batchArea = document.getElementById('batchArea');
const originalImg = document.getElementById('originalImg');
const resultCanvas = document.getElementById('resultCanvas');
const afterWrap = document.getElementById('afterWrap');
const sliderHandle = document.getElementById('sliderHandle');
const sliderContainer = document.getElementById('sliderContainer');
const statusText = document.getElementById('statusText');
const bgOptions = document.getElementById('bgOptions');
const customColorInput = document.getElementById('customColor');
const customBgInput = document.getElementById('customBgInput');
const downloadBtn = document.getElementById('downloadBtn');
const newImageBtn = document.getElementById('newImageBtn');
const sizeOptions = document.querySelectorAll('.chip[data-size]');
const eraseTool = document.getElementById('eraseTool');
const restoreTool = document.getElementById('restoreTool');
const brushSizeInput = document.getElementById('brushSize');
const batchGrid = document.getElementById('batchGrid');
const downloadAllBtn = document.getElementById('downloadAllBtn');

let maskCanvas = document.createElement('canvas');
let sourceImage = null;
let currentBgMode = 'transparent';
let customBgImage = null;
let currentSizePreset = 'original';
let drawingMode = null;
let batchQueue = [];
let batchResults = [];

/* ---------- Selfie Segmentation (MediaPipe, runs fully client-side) ---------- */
let segmenter = null;
function getSegmenter() {
  if (segmenter) return segmenter;
  segmenter = new SelfieSegmentation({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
  });
  segmenter.setOptions({ modelSelection: 1 });
  return segmenter;
}

function segmentImage(imgEl) {
  return new Promise((resolve, reject) => {
    const seg = getSegmenter();
    seg.onResults((results) => {
      resolve(results.segmentationMask);
    });
    seg.send({ image: imgEl }).catch(reject);
  });
}

/* ---------- File handling ---------- */
browseBtn.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('click', (e) => { if (e.target === dropZone || e.target.closest('.drop-inner')) fileInput.click(); });
['dragenter','dragover'].forEach(ev => dropZone.addEventListener(ev, (e)=>{ e.preventDefault(); dropZone.classList.add('dragover'); }));
['dragleave','drop'].forEach(ev => dropZone.addEventListener(ev, (e)=>{ e.preventDefault(); dropZone.classList.remove('dragover'); }));
dropZone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const validImages = files.filter(f => f.type.startsWith('image/'));
  const invalid = files.filter(f => !f.type.startsWith('image/'));

  if (invalid.length) {
    showError(`দুঃখিত, শুধু ছবি সাপোর্টেড (jpg, png, webp)। "${invalid[0].name}" সাপোর্টেড না।\nSorry, only image files are supported. "${invalid[0].name}" is not a supported format.`);
  }
  if (!validImages.length) return;

  trackEvent('start');

  if (validImages.length === 1) {
    loadSingleImage(validImages[0]);
  } else {
    loadBatch(validImages);
  }
}

function showError(msg) {
  statusText.textContent = msg;
  statusText.style.color = '#c0392b';
  workArea.classList.remove('hidden');
  setTimeout(() => { statusText.style.color = ''; }, 4000);
}

/* ---------- Single image flow ---------- */
function loadSingleImage(file) {
  batchArea.classList.add('hidden');
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => processImage(img);
    img.onerror = () => showError('ছবিটি লোড করা যায়নি। / Could not load this image.');
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function processImage(img) {
  sourceImage = img;
  workArea.classList.remove('hidden');
  originalImg.src = img.src;
  statusText.textContent = 'প্রসেসিং হচ্ছে... / Processing...';
  resultCanvas.width = img.naturalWidth;
  resultCanvas.height = img.naturalHeight;
  maskCanvas.width = img.naturalWidth;
  maskCanvas.height = img.naturalHeight;

  try {
    const mask = await segmentImage(img);
    const mctx = maskCanvas.getContext('2d');
    mctx.clearRect(0,0,maskCanvas.width,maskCanvas.height);
    mctx.drawImage(mask, 0, 0, maskCanvas.width, maskCanvas.height);
    renderResult();
    statusText.textContent = 'রেডি! / Done — drag the slider to compare';
    bumpUsageCount();
    trackEvent('complete', 'single-remove');
  } catch (err) {
    statusText.textContent = 'দুঃখিত, প্রসেস করা যায়নি, আবার চেষ্টা করুন। / Processing failed, please try again.';
    trackEvent('error');
  }
}

function renderResult() {
  const w = resultCanvas.width, h = resultCanvas.height;
  const ctx = resultCanvas.getContext('2d');
  ctx.clearRect(0,0,w,h);

  if (currentBgMode === 'custom-image' && customBgImage) {
    ctx.drawImage(customBgImage, 0, 0, w, h);
  } else if (currentBgMode !== 'transparent') {
    ctx.fillStyle = currentBgMode;
    ctx.fillRect(0,0,w,h);
  }

  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(sourceImage, 0, 0, w, h);
  const imgData = tctx.getImageData(0,0,w,h);
  const maskCtx = maskCanvas.getContext('2d');
  const maskData = maskCtx.getImageData(0,0,w,h);
  for (let i=0;i<imgData.data.length;i+=4){
    const alpha = maskData.data[i];
    imgData.data[i+3] = alpha;
  }
  tctx.putImageData(imgData,0,0);

  ctx.drawImage(tmp,0,0);
}

/* ---------- Before/After slider ---------- */
let sliderDragging = false;
sliderHandle.addEventListener('mousedown', ()=> sliderDragging = true);
sliderHandle.addEventListener('touchstart', ()=> sliderDragging = true);
window.addEventListener('mouseup', ()=> sliderDragging = false);
window.addEventListener('touchend', ()=> sliderDragging = false);
window.addEventListener('mousemove', (e)=> moveSlider(e.clientX));
window.addEventListener('touchmove', (e)=> { if (sliderDragging) moveSlider(e.touches[0].clientX); });

function moveSlider(clientX){
  if (!sliderDragging) return;
  const rect = sliderContainer.getBoundingClientRect();
  let pct = ((clientX - rect.left) / rect.width) * 100;
  pct = Math.max(0, Math.min(100, pct));
  afterWrap.style.width = pct + '%';
  sliderHandle.style.left = pct + '%';
}

/* ---------- Background choice ---------- */
bgOptions.querySelectorAll('.bg-swatch[data-bg]').forEach(btn => {
  btn.addEventListener('click', () => {
    bgOptions.querySelectorAll('.bg-swatch').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentBgMode = btn.dataset.bg;
    if (sourceImage) renderResult();
    trackEvent('feature_use', currentBgMode === 'transparent' ? 'bg-transparent' : 'bg-color');
  });
});
customColorInput.addEventListener('input', () => {
  currentBgMode = customColorInput.value;
  bgOptions.querySelectorAll('.bg-swatch').forEach(b=>b.classList.remove('active'));
  if (sourceImage) renderResult();
  trackEvent('feature_use', 'bg-custom-color');
});
customBgInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      customBgImage = img;
      currentBgMode = 'custom-image';
      bgOptions.querySelectorAll('.bg-swatch').forEach(b=>b.classList.remove('active'));
      if (sourceImage) renderResult();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

/* ---------- Size presets ---------- */
sizeOptions.forEach(btn => {
  btn.addEventListener('click', () => {
    sizeOptions.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentSizePreset = btn.dataset.size;
    applySizePreset();
    trackEvent('feature_use', 'size-' + currentSizePreset);
  });
});
function applySizePreset(){
  if (!sourceImage) return;
  let targetRatio = null;
  if (currentSizePreset === 'passport') targetRatio = 1;
  if (currentSizePreset === 'stamp') targetRatio = 1;
  if (currentSizePreset === 'square') targetRatio = 1;
  if (currentSizePreset === 'original') targetRatio = null;

  const w = sourceImage.naturalWidth, h = sourceImage.naturalHeight;
  if (!targetRatio) {
    resultCanvas.width = w; resultCanvas.height = h;
    maskCanvas.width = w; maskCanvas.height = h;
  } else {
    const side = Math.min(w,h);
    resultCanvas.width = side; resultCanvas.height = side;
    maskCanvas.width = side; maskCanvas.height = side;
  }
  renderResult();
}

/* ---------- Erase / Restore brush ---------- */
eraseTool.addEventListener('click', () => setDrawMode('erase'));
restoreTool.addEventListener('click', () => setDrawMode('restore'));
function setDrawMode(mode){
  drawingMode = (drawingMode === mode) ? null : mode;
  eraseTool.classList.toggle('active', drawingMode==='erase');
  restoreTool.classList.toggle('active', drawingMode==='restore');
}
let painting = false;
resultCanvas.addEventListener('mousedown', (e)=>{ painting=true; paintAt(e); });
resultCanvas.addEventListener('mousemove', (e)=>{ if(painting) paintAt(e); });
window.addEventListener('mouseup', ()=> painting=false);
resultCanvas.addEventListener('touchstart', (e)=>{ painting=true; paintAt(e.touches[0]); });
resultCanvas.addEventListener('touchmove', (e)=>{ if(painting){ paintAt(e.touches[0]); e.preventDefault(); } }, {passive:false});

function paintAt(evt){
  if (!drawingMode || !sourceImage) return;
  const rect = resultCanvas.getBoundingClientRect();
  const scaleX = resultCanvas.width / rect.width;
  const scaleY = resultCanvas.height / rect.height;
  const x = (evt.clientX - rect.left) * scaleX;
  const y = (evt.clientY - rect.top) * scaleY;
  const radius = parseInt(brushSizeInput.value,10);

  const mctx = maskCanvas.getContext('2d');
  mctx.globalCompositeOperation = 'source-over';
  mctx.fillStyle = drawingMode === 'erase' ? 'black' : 'white';
  mctx.beginPath();
  mctx.arc(x,y,radius,0,Math.PI*2);
  mctx.fill();
  renderResult();
}

/* ---------- Download ---------- */
downloadBtn.addEventListener('click', () => {
  const format = document.querySelector('input[name="format"]:checked').value;
  let dataUrl;
  if (format === 'jpg') {
    const tmp = document.createElement('canvas');
    tmp.width = resultCanvas.width; tmp.height = resultCanvas.height;
    const tctx = tmp.getContext('2d');
    tctx.fillStyle = '#ffffff';
    tctx.fillRect(0,0,tmp.width,tmp.height);
    tctx.drawImage(resultCanvas,0,0);
    dataUrl = tmp.toDataURL('image/jpeg', 0.92);
  } else {
    dataUrl = resultCanvas.toDataURL('image/png');
  }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `cutbg-result.${format === 'jpg' ? 'jpg' : 'png'}`;
  a.click();
  trackEvent('feature_use', 'download-' + format);
});

newImageBtn.addEventListener('click', () => {
  workArea.classList.add('hidden');
  fileInput.value = '';
  sourceImage = null;
});

/* ---------- Batch mode ---------- */
async function loadBatch(files){
  workArea.classList.add('hidden');
  batchArea.classList.remove('hidden');
  batchGrid.innerHTML = '';
  batchResults = [];

  for (const file of files) {
    const card = document.createElement('div');
    card.textContent = 'প্রসেসিং...';
    batchGrid.appendChild(card);

    try {
      const dataUrl = await readFileAsDataURL(file);
      const img = await loadImage(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const mask = await segmentImage(img);
      const mctx = canvas.getContext('2d');
      mctx.drawImage(img,0,0,canvas.width,canvas.height);
      const imgData = mctx.getImageData(0,0,canvas.width,canvas.height);
      const mcanvas = document.createElement('canvas');
      mcanvas.width = canvas.width; mcanvas.height = canvas.height;
      const mmctx = mcanvas.getContext('2d');
      mmctx.drawImage(mask,0,0,canvas.width,canvas.height);
      const maskData = mmctx.getImageData(0,0,canvas.width,canvas.height);
      for (let i=0;i<imgData.data.length;i+=4){ imgData.data[i+3] = maskData.data[i]; }
      mctx.clearRect(0,0,canvas.width,canvas.height);
      mctx.putImageData(imgData,0,0);

      const resultUrl = canvas.toDataURL('image/png');
      batchResults.push({name: file.name, url: resultUrl});
      card.innerHTML = '';
      const im = document.createElement('img');
      im.src = resultUrl;
      card.appendChild(im);
      bumpUsageCount();
    } catch(err) {
      card.textContent = 'ব্যর্থ / Failed';
    }
  }
}
function readFileAsDataURL(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = ()=>resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function loadImage(src){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.onload = ()=>resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
downloadAllBtn.addEventListener('click', () => {
  batchResults.forEach((r,i) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = r.url;
      a.download = `cutbg-${i+1}.png`;
      a.click();
    }, i * 300);
  });
});

/* ---------- Share ---------- */
document.getElementById('shareWA').addEventListener('click', () => {
  window.open(`https://wa.me/?text=${encodeURIComponent('এই ফ্রি ব্যাকগ্রাউন্ড রিমুভার টুলটা দেখো: ' + location.href)}`, '_blank');
});
document.getElementById('shareFB').addEventListener('click', () => {
  window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(location.href)}`, '_blank');
});
document.getElementById('copyLink').addEventListener('click', (e) => {
  navigator.clipboard.writeText(location.href).then(() => {
    const btn = e.target;
    const old = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(()=> btn.textContent = old, 1500);
  });
});
