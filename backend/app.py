# ============== 顶部全局禁用OneDNN + PIR ==============
import os
os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["FLAGS_use_mkldnn_int8"] = "0"
os.environ["FLAGS_use_onednn"] = "0"
os.environ["FLAGS_enable_pir_in_executor"] = "0"
os.environ["FLAGS_use_pir_inference"] = "0"
os.environ["FLAGS_new_executor"] = "0"

import time
from flask import Flask, jsonify, request, send_file, Response, send_from_directory
from flask_cors import CORS
from task_queue import add_task, get_next_task, update_status, get_task_info, get_progress
from history_manager import bst, add_ocr_record, get_all_records, search_records, RECORD_JSON, HISTORY_ROOT, BOX_SUB_DIR, TXT_SUB_DIR, full_clear_history
from image_utils import run_ocr
import threading

app = Flask(__name__)
CORS(app)

# 全局绝对路径
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
if not os.path.exists(FRONTEND_DIR):
    FRONTEND_DIR = os.path.join(os.path.dirname(BASE_DIR), "frontend")

UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
RESULT_DIR = os.path.join(BASE_DIR, "results")
OCR_TXT_DIR = os.path.join(BASE_DIR, "ocr_txt_output")
# 标注图、文本目录转绝对路径
BOX_ABS_DIR = os.path.join(BASE_DIR, BOX_SUB_DIR)
TXT_ABS_DIR = os.path.join(BASE_DIR, TXT_SUB_DIR)

# 自动创建所有文件夹
for folder in [UPLOAD_DIR, RESULT_DIR, OCR_TXT_DIR, BOX_ABS_DIR, TXT_ABS_DIR]:
    os.makedirs(folder, exist_ok=True)

# ====================== 图片访问路由（修复：用绝对路径 + 自动识别MIME） ======================
# 标注图访问
@app.route('/images/boxed/<filename>')
def serve_boxed_image(filename):
    return send_from_directory(BOX_ABS_DIR, filename)

# 上传原图访问
@app.route('/images/upload/<filename>')
def serve_upload_image(filename):
    return send_from_directory(UPLOAD_DIR, filename)

# 前端页面路由
@app.route('/')
def index():
    html_path = os.path.join(FRONTEND_DIR, "index.html")
    try:
        with open(html_path, "r", encoding="utf-8") as f:
            html_content = f.read()
        return Response(html_content, mimetype="text/html")
    except FileNotFoundError:
        return Response(f"<h1>文件不存在</h1><p>查找路径：{html_path}</p>", mimetype="text/html")
    except Exception as err:
        return Response(f"<h1>页面加载异常</h1><p>错误：{str(err)}</p>", mimetype="text/html")

@app.route('/script.js')
def serve_js():
    js_path = os.path.join(FRONTEND_DIR, "script.js")
    try:
        return send_file(js_path, mimetype="application/javascript")
    except Exception as e:
        return f"JS文件不存在: {str(e)}", 404

@app.route('/style.css')
def serve_css():
    css_path = os.path.join(FRONTEND_DIR, "style.css")
    try:
        return send_file(css_path, mimetype="text/css")
    except Exception as e:
        return f"CSS文件不存在: {str(e)}", 404

# -------------------- 业务接口 --------------------
@app.route('/ping', methods=["GET"])
def ping():
    return jsonify({"code": 200, "msg": "service running", "time": time.time()})

@app.route('/api', methods=["GET"])
def api_list():
    api_info = {
        "api_list": [
            "GET  /ping 健康检测",
            "POST /upload 上传图片识别",
            "GET  /status/<task_id> 查询任务状态",
            "GET  /history 获取全部历史",
            "POST /search 关键词检索",
            "POST /clear_history 清空历史",
            "GET  /export/<task_id> 导出txt"
        ],
        "message": "OCR后端服务运行正常",
        "port": 5000
    }
    return jsonify({"code": 200, "data": api_info})

@app.route('/clear_history', methods=['POST'])
def clear_history():
    full_clear_history()
    resp = jsonify({"code": 200, "message": "全部识别历史已永久清空"})
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

# 历史记录接口：本地路径转HTTP URL
@app.route("/history", methods=["GET"])
def get_history():
    raw_data = get_all_records()
    result_list = []
    for item in raw_data:
        item_copy = item.copy()
        if item.get("image_file_path"):
            fname = os.path.basename(item["image_file_path"])
            item_copy["image_file_path"] = f"/images/upload/{fname}"
        if item.get("box_img_path"):
            fname = os.path.basename(item["box_img_path"])
            item_copy["box_img_url"] = f"/images/boxed/{fname}"
        result_list.append(item_copy)
    return jsonify({"code": 200, "data": result_list})

@app.route("/search", methods=["POST"])
def search_history():
    req_data = request.get_json()
    keyword = req_data.get("keyword", "")
    raw_list = search_records(keyword)
    result_list = []
    for item in raw_list:
        item_copy = item.copy()
        if item.get("image_file_path"):
            fname = os.path.basename(item["image_file_path"])
            item_copy["image_file_path"] = f"/images/upload/{fname}"
        if item.get("box_img_path"):
            fname = os.path.basename(item["box_img_path"])
            item_copy["box_img_url"] = f"/images/boxed/{fname}"
        result_list.append(item_copy)
    return jsonify({"code": 200, "data": result_list})

# 上传图片
@app.route("/upload", methods=["POST"])
def upload():
    if "image" not in request.files or request.files["image"].filename == "":
        return jsonify({"code": 400, "msg": "未选择图片文件"})
    try:
        file = request.files["image"]
        time_stamp = str(time.time())
        save_path = os.path.join(UPLOAD_DIR, f"{time_stamp}_{file.filename}")
        file.save(save_path)
        task_id = add_task(save_path)
        return jsonify({"code": 200, "task_id": task_id})
    except Exception as e:
        return jsonify({"code": 500, "msg": f"图片上传失败：{str(e)}"})

# 任务状态接口：本地路径转HTTP URL
@app.route("/status/<task_id>", methods=["GET"])
def get_task_status(task_id):
    task_info = get_task_info(task_id)
    if not task_info:
        return jsonify({"code": 404, "msg": "任务不存在"})
    resp_data = task_info.copy()
    if resp_data.get("box_img_url"):
        fname = os.path.basename(resp_data["box_img_url"])
        resp_data["box_img_url"] = f"/images/boxed/{fname}"
    if resp_data.get("original_img_url"):
        fname = os.path.basename(resp_data["original_img_url"])
        resp_data["original_img_url"] = f"/images/upload/{fname}"
    return jsonify({"code": 200, "data": resp_data})

# 导出TXT
@app.route("/export/<task_id>", methods=["GET"])
def export_txt(task_id):
    record_list = get_all_records()
    target_item = None
    for item in record_list:
        if str(item.get("timestamp")) == task_id or item.get("timestamp") == float(task_id):
            target_item = item
            break
    if not target_item or not os.path.exists(target_item["txt_path"]):
        return jsonify({"code": 404, "msg": "文本文件不存在"}), 404
    return send_file(target_item["txt_path"], mimetype="text/plain", as_attachment=True, download_name=f"ocr_{task_id}.txt")

# 后台识别线程
def worker_loop():
    while True:
        task_id = get_next_task()
        if not task_id:
            time.sleep(0.2)
            continue
        task_info = get_task_info(task_id)
        img_path = task_info["file_path"]
        try:
            ocr_result = run_ocr(img_path)
            add_ocr_record(time.time(), img_path, ocr_result.box_img_path, ocr_result.txt_path, ocr_result.full_text, ocr_result.box_list)
            update_status(task_id, "done", result=ocr_result.full_text, original_img_url=img_path, box_img_url=ocr_result.box_img_path)
        except Exception as err:
            update_status(task_id, "error", error=str(err))

worker_thread = threading.Thread(target=worker_loop, daemon=True)
worker_thread.start()

if __name__ == "__main__":
    print(f"前端目录：{FRONTEND_DIR}")
    print(f"标注图目录：{BOX_ABS_DIR}")
    print(f"上传目录：{UPLOAD_DIR}")
    print("OneDNN已禁用，图片路由已启用")
    app.run(host="127.0.0.1", port=5000, debug=False)