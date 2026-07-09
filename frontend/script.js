const API_BASE = "http://127.0.0.1:5000";

let currentTaskId = "";
let timer = null;
let selectedFile = null;

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  bindUpload();
  bindButtons();
  loadHistory(true);
});

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
    const file = event.dataTransfer.files?.[0];
    if (file) chooseFile(file);
  });

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) chooseFile(file);
    input.value = "";
  });

  document.addEventListener("paste", (event) => {
    const file = [...event.clipboardData.files].find((item) => item.type.startsWith("image/"));
    if (file) chooseFile(file);
  });
}

function bindButtons() {
  $("btn-start-ocr")?.addEventListener("click", startOcr);
  $("btn-cancel-ocr")?.addEventListener("click", cancelOcr);
  $("btn-clear-preview")?.addEventListener("click", clearPreview);
  $("btn-clear-result")?.addEventListener("click", clearResult);
  $("btn-copy")?.addEventListener("click", copyText);
  $("btn-save-txt")?.addEventListener("click", downloadText);
  $("btn-clear-history")?.addEventListener("click", clearHistory);
  $("btn-toggle-history")?.addEventListener("click", toggleHistory);
  $("btn-search")?.addEventListener("click", searchHistory);
  $("history-search")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchHistory();
  });
}

function toggleHistory() {
  const panel = $("sidebar");
  const button = $("btn-toggle-history");
  if (!panel || !button) return;

  const collapsed = panel.classList.toggle("is-collapsed");
  button.textContent = collapsed ? "展开历史" : "收起历史";
}

function chooseFile(file) {
  if (!file.type.startsWith("image/")) {
    showMessage("请上传图片文件", "error");
    return;
  }

  selectedFile = file;
  renderPreview(file);
}

function renderPreview(file) {
  const empty = $("preview-empty");
  const grid = $("preview-grid");
  const template = $("preview-item-template");

  if (!grid || !template) return;

  grid.innerHTML = "";
  const item = template.content.cloneNode(true);
  item.querySelector("img").src = URL.createObjectURL(file);
  item.querySelector("figcaption").textContent = file.name;
  grid.appendChild(item);

  grid.hidden = false;
  if (empty) empty.style.display = "none";
}

async function startOcr() {
  if (!selectedFile) {
    showMessage("请先选择或粘贴图片", "warning");
    return;
  }

  setLoading(true);

  try {
    const data = new FormData();
    data.append("image", selectedFile);

    const res = await fetch(`${API_BASE}/upload`, {
      method: "POST",
      body: data,
    });
    const json = await res.json();

    if (json.code !== 200) throw new Error(json.error || "上传失败");

    currentTaskId = json.data?.task_id || "";
    pollResult(currentTaskId);
  } catch (error) {
    setLoading(false);
    showMessage(`上传失败：${error.message}`, "error");
  }
}

function pollResult(taskId) {
  if (!taskId) return;
  if (timer) clearInterval(timer);

  let count = 0;
  timer = setInterval(async () => {
    count += 1;

    if (count > 120) {
      cancelOcr();
      showMessage("识别超时，请重试", "error");
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
        setLoading(false);
        showResult(data.result || "");
        loadHistory(true);
      }

      if (data.status === "error") {
        throw new Error(data.error || "识别失败");
      }
    } catch (error) {
      cancelOcr();
      showMessage(`识别失败：${error.message}`, "error");
    }
  }, 1000);
}

function cancelOcr() {
  if (timer) clearInterval(timer);
  timer = null;
  setLoading(false);
}

function showResult(text) {
  const result = $("result-text");
  const meta = $("result-meta");

  if (result) result.value = text;
  if (meta) meta.textContent = `字数：${text.length}`;
}

function clearPreview() {
  selectedFile = null;
  const grid = $("preview-grid");
  const empty = $("preview-empty");

  if (grid) {
    grid.innerHTML = "";
    grid.hidden = true;
  }
  if (empty) empty.style.display = "flex";
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
  link.download = "ocr_result.txt";
  link.click();
  URL.revokeObjectURL(link.href);
}

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
    row.querySelector(".history-item__title").textContent = item.ocr_text || "无识别文本";
    row.querySelector(".history-item__time").textContent = formatTime(item.timestamp);
    row.querySelector(".history-item__btn").addEventListener("click", () => {
      showResult(item.ocr_text || "");
    });
    list.appendChild(row);
  });
}

async function searchHistory() {
  const keyword = $("history-search")?.value.trim() || "";

  if (!keyword) {
    loadHistory(false);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword }),
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

function setLoading(loading) {
  const start = $("btn-start-ocr");
  const cancel = $("btn-cancel-ocr");
  if (start) start.disabled = loading;
  if (cancel) cancel.disabled = !loading;
}

function formatTime(value) {
  if (!value) return "";
  const time = String(value).length === 10 ? value * 1000 : value;
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
