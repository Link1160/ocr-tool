const API_BASE = "http://127.0.0.1:5000";

let currentTaskId = "";
let timer = null;
let selectedFiles = [];
let cancelRequested = false;

// 裁剪状态
let currentFileIndex = 0;
let currentImage = null;
let cropBox = null;
let isCropping = false;
let cropStart = null;

// 缩放 & 平移状态
let zoomScale = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let baseScale = 1; // 图片适配容器的初始缩放比

// 裁剪弹窗队列
let cropQueue = [];       // 待裁剪的原始 File[]
let cropIndex = 0;        // 当前裁剪第几张
let croppedFiles = [];    // 裁剪后的文件列表（File 对象）

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  bindUpload();
  bindButtons();
  bindCropTools();
  bindCropModal();
  loadHistory(true);
});

// ============================================================
// 上传绑定
// ============================================================
function bindUpload() {
  const zone = $("upload-zone");
  const input = $("file-input");

  if (!zone || !input) return;

  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("drag-over");
  });

  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));

  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("drag-over");
    chooseFiles([...event.dataTransfer.files]);
  });

  input.addEventListener("change", () => {
    chooseFiles([...input.files]);
    input.value = "";
  });

  document.addEventListener("paste", (event) => {
    chooseFiles([...event.clipboardData.files]);
  });
}

// ============================================================
// 按钮绑定
// ============================================================
function bindButtons() {
  $("btn-start-ocr")?.addEventListener("click", startOcr);
  $("btn-cancel-ocr")?.addEventListener("click", cancelOcr);
  $("btn-clear-preview")?.addEventListener("click", clearPreview);
  $("btn-add-more")?.addEventListener("click", () => {
    const tempInput = document.createElement("input");
    tempInput.type = "file";
    tempInput.accept = "image/*";
    tempInput.multiple = true;
    tempInput.addEventListener("change", () => {
      chooseFiles([...tempInput.files]);
    });
    tempInput.click();
  });
  $("btn-clear-result")?.addEventListener("click", clearResult);
  $("btn-copy")?.addEventListener("click", copyText);
  $("btn-save-txt")?.addEventListener("click", downloadText);
  $("btn-clear-history")?.addEventListener("click", clearHistory);
  $("btn-toggle-history")?.addEventListener("click", toggleHistory);
let searchTimer = null;

  $("btn-search")?.addEventListener("click", () => {
    clearTimeout(searchTimer);
    searchHistory();
  });
  $("history-search")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      clearTimeout(searchTimer);
      searchHistory();
    }
  });
  $("history-search")?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchHistory, 300);
  });
  // 点击日期文本框时动态创建原生 date 输入框来弹出选择器
  $("history-date")?.addEventListener("click", () => {
    const temp = document.createElement("input");
    temp.type = "date";
    temp.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
    document.body.appendChild(temp);

    temp.addEventListener("change", () => {
      const val = temp.value;
      const display = $("history-date");
      if (display) display.value = val;
      if (val) searchHistory();
      document.body.removeChild(temp);
    });

    // 如果用户取消选择（失焦且无值），清理临时元素
    temp.addEventListener("blur", () => {
      setTimeout(() => {
        if (temp.parentNode) document.body.removeChild(temp);
      }, 300);
    });

    if (temp.showPicker) {
      temp.showPicker();
    } else {
      temp.click();
    }
  });

  // 清除日期
  $("btn-clear-date")?.addEventListener("click", () => {
    const display = $("history-date");
    if (display) display.value = "";
    searchHistory();
  });
  $("btn-recognize-all")?.addEventListener("click", recognizeAll);
  $("btn-recognize-current")?.addEventListener("click", recognizeCurrent);
}

function toggleHistory() {
  const panel = $("sidebar");
  const button = $("btn-toggle-history");
  if (!panel || !button) return;

  const collapsed = panel.classList.toggle("is-collapsed");
  button.textContent = collapsed ? "展开历史" : "收起历史";
}

// ============================================================
// 文件选择 → 裁剪弹窗 → 预览
// ============================================================
function chooseFiles(files) {
  const images = files.filter((file) => file.type.startsWith("image/"));

  if (!images.length) {
    showMessage("请上传图片文件", "error");
    return;
  }

  cropQueue = images;
  cropIndex = 0;
  // 追加模式下保留已有图片，首次上传时清空
  if (!croppedFiles.length) croppedFiles = [];
  openCropModal();
}

function switchToPreviewMode() {
  const uploadMode = $("upload-mode");
  const previewMode = $("preview-mode");
  if (uploadMode) uploadMode.hidden = true;
  if (previewMode) previewMode.hidden = false;
}

function switchToUploadMode() {
  const uploadMode = $("upload-mode");
  const previewMode = $("preview-mode");
  if (uploadMode) uploadMode.hidden = false;
  if (previewMode) previewMode.hidden = true;
}

function renderThumbs() {
  const container = $("preview-thumbs");
  if (!container) return;
  container.innerHTML = "";

  croppedFiles.forEach((file, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `preview-thumb${index === currentFileIndex ? " is-active" : ""}`;
    btn.innerHTML = `
      <img src="${URL.createObjectURL(file)}" alt="${file.name}">
      <span>${index + 1}. ${file.name}</span>
    `;
    btn.addEventListener("click", () => {
      currentFileIndex = index;
      renderThumbs();
      showPreviewImage(index);
    });
    container.appendChild(btn);
  });
}

function showPreviewImage(index) {
  const container = $("preview-images");
  if (!container || !croppedFiles[index]) return;
  container.innerHTML = `<img src="${URL.createObjectURL(croppedFiles[index])}" alt="预览">`;
}

function loadImageToCanvas(index) {
  const file = cropQueue[index];
  const canvas = $("crop-canvas");
  const body = $("crop-modal-body");
  if (!file || !canvas || !body) return;

  const image = new Image();
  image.onload = () => {
    currentImage = image;
    const maxWidth = body.clientWidth || 800;
    const maxHeight = body.clientHeight || 500;
    baseScale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
    zoomScale = 1;
    panX = 0;
    panY = 0;

    canvas.width = Math.max(1, Math.round(image.width * baseScale));
    canvas.height = Math.max(1, Math.round(image.height * baseScale));
    applyTransform();
    drawCropCanvas();
  };
  image.src = URL.createObjectURL(file);
}

function applyTransform() {
  const canvas = $("crop-canvas");
  if (!canvas) return;
  canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;

  const label = $("zoom-level");
  if (label) label.textContent = Math.round(zoomScale * 100) + "%";
}

// ============================================================
// 裁剪工具
// ============================================================
function bindCropTools() {
  const canvas = $("crop-canvas");
  const body = $("crop-modal-body");
  if (!canvas || !body) return;

  // ---- 鼠标按下 ----
  canvas.addEventListener("mousedown", (event) => {
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      // 中键 或 Alt+左键 → 平移
      isPanning = true;
      panStartX = event.clientX - panX;
      panStartY = event.clientY - panY;
      canvas.style.cursor = "grabbing";
      event.preventDefault();
      return;
    }
    if (event.button === 0 && currentImage) {
      // 左键 → 截取
      isCropping = true;
      cropStart = getCanvasPoint(event);
      cropBox = { x: cropStart.x, y: cropStart.y, w: 0, h: 0 };
      drawCropCanvas();
    }
  });

  // ---- 鼠标移动 ----
  canvas.addEventListener("mousemove", (event) => {
    if (isPanning) {
      panX = event.clientX - panStartX;
      panY = event.clientY - panStartY;
      applyTransform();
      return;
    }
    if (!isCropping || !cropStart) return;
    const point = getCanvasPoint(event);
    cropBox = {
      x: Math.min(cropStart.x, point.x),
      y: Math.min(cropStart.y, point.y),
      w: Math.abs(point.x - cropStart.x),
      h: Math.abs(point.y - cropStart.y),
    };
    drawCropCanvas();
  });

  // ---- 鼠标松开 ----
  document.addEventListener("mouseup", () => {
    if (isPanning) {
      isPanning = false;
      canvas.style.cursor = "crosshair";
    }
    if (!isCropping) return;
    isCropping = false;
    if (cropBox && (cropBox.w < 10 || cropBox.h < 10)) {
      cropBox = null;
    }
    drawCropCanvas();
  });

  // ---- 滚轮缩放 ----
  body.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = body.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const oldScale = zoomScale;
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    zoomScale = Math.max(0.5, Math.min(10, zoomScale * delta));

    // 以鼠标位置为中心缩放
    panX = mouseX - (mouseX - panX) * (zoomScale / oldScale);
    panY = mouseY - (mouseY - panY) * (zoomScale / oldScale);

    applyTransform();
    drawCropCanvas();
  }, { passive: false });

  // ---- 缩放按钮 ----
  $("btn-zoom-in")?.addEventListener("click", () => zoomBy(1.25));
  $("btn-zoom-out")?.addEventListener("click", () => zoomBy(0.8));
  $("btn-zoom-reset")?.addEventListener("click", () => {
    zoomScale = 1;
    panX = 0;
    panY = 0;
    applyTransform();
    drawCropCanvas();
  });
}

function zoomBy(factor) {
  const body = $("crop-modal-body");
  if (!body) return;
  const rect = body.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;

  const oldScale = zoomScale;
  zoomScale = Math.max(0.5, Math.min(10, zoomScale * factor));

  panX = centerX - (centerX - panX) * (zoomScale / oldScale);
  panY = centerY - (centerY - panY) * (zoomScale / oldScale);

  applyTransform();
  drawCropCanvas();
}

function getCanvasPoint(event) {
  const canvas = $("crop-canvas");
  const rect = canvas.getBoundingClientRect();
  // getBoundingClientRect 已包含 CSS transform，所以直接用
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function drawCropCanvas() {
  const canvas = $("crop-canvas");
  if (!canvas || !currentImage) return;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);

  if (!cropBox) return;

  ctx.save();
  // 遮罩外围：先画半透明黑色覆盖全图，再用 clip 恢复截取区域的原图
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 清除截取区域的遮罩，重新绘制原图内容
  ctx.save();
  ctx.beginPath();
  ctx.rect(cropBox.x, cropBox.y, cropBox.w, cropBox.h);
  ctx.clip();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  // 画截取框边框
  ctx.strokeStyle = "#1677ff";
  ctx.lineWidth = 2;
  ctx.strokeRect(cropBox.x, cropBox.y, cropBox.w, cropBox.h);
  ctx.restore();
}

// ============================================================
// 裁剪弹窗
// ============================================================
function bindCropModal() {
  $("btn-crop-confirm")?.addEventListener("click", confirmCrop);
  $("btn-crop-skip")?.addEventListener("click", skipCrop);
}

function openCropModal() {
  cropIndex = 0;
  cropBox = null;
  const modal = $("crop-modal");
  if (modal) modal.hidden = false;
  loadCropImage();
}

function closeCropModal() {
  const modal = $("crop-modal");
  if (modal) modal.hidden = true;
}

function loadCropImage() {
  if (cropIndex >= cropQueue.length) {
    // 所有图片处理完毕，进入预览
    closeCropModal();
    selectedFiles = croppedFiles.slice();
    currentFileIndex = 0;
    switchToPreviewMode();
    renderThumbs();
    if (croppedFiles.length) showPreviewImage(0);
    showMessage(`已完成 ${croppedFiles.length} 张图片截取`, "success");
    return;
  }

  cropBox = null;
  const counter = $("crop-counter");
  if (counter) counter.textContent = `${cropIndex + 1} / ${cropQueue.length}`;
  loadImageToCanvas(cropIndex);
}

async function confirmCrop() {
  try {
    if (cropBox && (cropBox.w >= 10 && cropBox.h >= 10)) {
      const file = await getCropFile();
      croppedFiles.push(file);
    } else {
      croppedFiles.push(cropQueue[cropIndex]);
    }
  } catch (error) {
    showMessage(`截取失败：${error.message}`, "error");
    croppedFiles.push(cropQueue[cropIndex]);
  }
  cropIndex++;
  loadCropImage();
}

function skipCrop() {
  croppedFiles.push(cropQueue[cropIndex]);
  cropIndex++;
  loadCropImage();
}

function getCropFile() {
  return new Promise((resolve, reject) => {
    const source = cropQueue[cropIndex];
    const canvas = $("crop-canvas");
    if (!source || !canvas || !currentImage) {
      reject(new Error("没有可裁剪的图片"));
      return;
    }

    const box = cropBox || { x: 0, y: 0, w: canvas.width, h: canvas.height };
    const scaleX = currentImage.naturalWidth / canvas.width;
    const scaleY = currentImage.naturalHeight / canvas.height;
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.max(1, Math.round(box.w * scaleX));
    cropCanvas.height = Math.max(1, Math.round(box.h * scaleY));

    const ctx = cropCanvas.getContext("2d");
    ctx.drawImage(
      currentImage,
      box.x * scaleX, box.y * scaleY, box.w * scaleX, box.h * scaleY,
      0, 0, cropCanvas.width, cropCanvas.height
    );

    cropCanvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("裁剪图片失败"));
        return;
      }
      const name = `crop_${currentFileIndex + 1}_${source.name.replace(/\.[^.]+$/, "")}.png`;
      resolve(new File([blob], name, { type: "image/png" }));
    }, "image/png");
  });
}

// ============================================================
// 识别
// ============================================================
async function recognizeAll() {
  if (!selectedFiles.length) {
    showMessage("请先选择图片", "warning");
    return;
  }
  await recognizeFiles(selectedFiles, 0);
}

async function recognizeCurrent() {
  const file = selectedFiles[currentFileIndex];
  if (!file) {
    showMessage("请先选择图片", "warning");
    return;
  }
  await recognizeFiles([file], currentFileIndex);
}

async function startOcr() {
  if (!selectedFiles.length) {
    showMessage("请先选择或粘贴图片", "warning");
    return;
  }
  await recognizeFiles(selectedFiles, 0);
}

async function recognizeFiles(files, startIndex) {
  setLoading(true);
  cancelRequested = false;
  showResult("");

  try {
    const results = [];

    for (let index = 0; index < files.length; index += 1) {
      if (cancelRequested) break;

      const file = files[index];
      showMessage(`正在识别第 ${index + 1}/${files.length} 张`, "info");

      const taskId = await uploadOne(file);
      const text = await pollResult(taskId);
      results.push(formatImageResult(startIndex + index, file, text));
      showResult(results.join("\n\n"));
    }

    if (!cancelRequested) {
      loadHistory(true);
      showMessage("全部图片识别完成", "success");
    }
  } catch (error) {
    showMessage(`识别失败：${error.message}`, "error");
  } finally {
    setLoading(false);
  }
}

function formatImageResult(index, file, text) {
  const title = `第 ${index + 1} 张：${file.name}`;
  const line = "=".repeat(title.length);
  return `${line}\n${title}\n${line}\n${text || "未识别到文字"}`;
}

async function uploadOne(file) {
  const data = new FormData();
  data.append("image", file);

  const res = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    body: data,
  });
  const json = await res.json();

  if (json.code !== 200) throw new Error(json.msg || json.error || "上传失败");

  currentTaskId = json.task_id || "";
  return currentTaskId;
}

function pollResult(taskId) {
  if (!taskId) return Promise.reject(new Error("任务 ID 为空"));
  if (timer) clearInterval(timer);

  let count = 0;
  return new Promise((resolve, reject) => {
    timer = setInterval(async () => {
      count += 1;

      if (cancelRequested) {
        clearInterval(timer);
        timer = null;
        reject(new Error("已取消识别"));
        return;
      }

      if (count > 120) {
        clearInterval(timer);
        timer = null;
        reject(new Error("识别超时，请重试"));
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/status/${taskId}`);
        const json = await res.json();
        if (json.code !== 200) throw new Error(json.error || "查询失败");

        const data = json.data || {};
        if (data.status === "done") {
          clearInterval(timer);
          timer = null;
          resolve(data.result || "");
        }

        if (data.status === "failed" || data.status === "error") {
          throw new Error(data.error || "识别失败");
        }
      } catch (error) {
        clearInterval(timer);
        timer = null;
        reject(error);
      }
    }, 1000);
  });
}

function cancelOcr() {
  cancelRequested = true;
  if (timer) clearInterval(timer);
  timer = null;
  setLoading(false);
}

// ============================================================
// 结果区
// ============================================================
function showResult(text) {
  const result = $("result-text");
  const meta = $("result-meta");

  if (result) result.value = text;
  if (meta) meta.textContent = `字数：${text.length}`;
}

function clearPreview() {
  selectedFiles = [];
  currentFileIndex = 0;
  currentImage = null;
  cropBox = null;
  isCropping = false;
  cropStart = null;

  switchToUploadMode();

  const thumbs = $("preview-thumbs");
  const canvas = $("crop-canvas");
  if (thumbs) thumbs.innerHTML = "";
  if (canvas) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function clearResult() {
  currentTaskId = "";
  showResult("");
}

async function copyText() {
  const text = $("result-text")?.value || "";
  if (!text) {
    showMessage("暂无内容可复制", "warning");
    return;
  }

  await navigator.clipboard.writeText(text);
  showMessage("复制成功", "success");
}

function downloadText() {
  const text = $("result-text")?.value || "";
  if (!text) {
    showMessage("暂无内容可下载", "warning");
    return;
  }

  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}_${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}${String(now.getSeconds()).padStart(2,"0")}`;
  link.download = `ocr_result_${ts}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ============================================================
// 历史记录
// ============================================================
async function loadHistory(silent = false) {
  const list = $("history-list");
  if (!list) return;

  try {
    const res = await fetch(`${API_BASE}/history?t=${Date.now()}`, { cache: "no-store" });
    const json = await res.json();
    renderHistory(json.data || []);
  } catch (error) {
    renderHistory([]);
    if (!silent) showMessage(`加载历史失败：${error.message}`, "error");
  }
}

function renderHistory(items) {
  const list = $("history-list");
  const template = $("history-item-template");
  if (!list) return;

  list.innerHTML = "";

  if (!items.length) {
    list.innerHTML = '<li class="history-list__empty">暂无历史记录</li>';
    return;
  }

  items.forEach((item) => {
    const row = template.content.cloneNode(true);
    const text = item.ocr_text || "无识别文本";
    row.querySelector(".history-item__title").textContent =
      text.length > 60 ? `${text.slice(0, 60)}...` : text;
    row.querySelector(".history-item__time").textContent = formatTime(item.timestamp);
    row.querySelector(".history-item__btn").addEventListener("click", () => {
      showResult(item.ocr_text || "");
    });

    // 单条删除
    row.querySelector(".history-item__del").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("确定删除该条历史记录？")) return;
      try {
        const res = await fetch(`${API_BASE}/delete_history/${item.timestamp}`, { method: "DELETE" });
        const json = await res.json();
        if (json.code === 200) {
          showMessage("已删除", "success");
          loadHistory(true);
        } else {
          showMessage(`删除失败：${json.message || "服务器异常"}`, "error");
        }
      } catch (error) {
        showMessage(`删除失败：${error.message}`, "error");
      }
    });

    list.appendChild(row);
  });
}

async function searchHistory() {
  const keyword = $("history-search")?.value.trim() || "";
  const date = $("history-date")?.value || "";   // "2026-07-01"

  const body = { keyword };
  if (date) body.date = date;

  // 无筛选条件时加载全部
  if (!keyword && !date) {
    loadHistory(true);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    renderHistory(json.data || []);
  } catch (error) {
    showMessage(`搜索失败：${error.message}`, "error");
  }
}

async function clearHistory() {
  if (!confirm("确定清空所有历史记录？")) return;

  try {
    await fetch(`${API_BASE}/clear_history`, { method: "POST" });
    renderHistory([]);
    showMessage("历史已清空", "success");
  } catch (error) {
    showMessage(`清空失败：${error.message}`, "error");
  }
}

// ============================================================
// 工具函数
// ============================================================
function setLoading(loading) {
  const start = $("btn-start-ocr");
  const cancel = $("btn-cancel-ocr");
  if (start) start.disabled = loading;
  if (cancel) cancel.disabled = !loading;
}

function formatTime(value) {
  if (!value) return "";
  // 后端 timestamp 是秒级（time.time()），统一乘 1000 转毫秒
  const time = value * 1000;
  return new Date(time).toLocaleString();
}

function showMessage(text, type = "info") {
  let box = $("message-container");
  if (!box) {
    box = document.createElement("div");
    box.id = "message-container";
    box.className = "message-container";
    document.body.appendChild(box);
  }

  const item = document.createElement("div");
  item.className = `message message--${type}`;
  item.textContent = text;
  box.appendChild(item);

  setTimeout(() => item.remove(), 2500);
}
