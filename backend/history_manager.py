import os
import time
import json
class BSTNode:
    def __init__(self, stamp, image_file_path, ocr_text, box_data):
        self.stamp = stamp
        self.image_file_path = image_file_path
        self.ocr_text = ocr_text
        self.left = None
        self.right = None

class BSTHistory:
    def __init__(self):
        self.root = None
        self.all_data = []  # 存储全部记录数组

    def insert(self, stamp, image_file_path, ocr_text, box_data):
        new_node = BSTNode(stamp, image_file_path, ocr_text, box_data)
        self.all_data.append({
            "timestamp": stamp,
            "image_file_path": image_file_path,
            "ocr_text": ocr_text,
            "box_data": box_data
        })
        if self.root is None:
            self.root = new_node
            return
        cur = self.root
        while True:
            if new_node.stamp < cur.stamp:
                if cur.left is None:
                    cur.left = new_node
                    break
                cur = cur.left
            else:
                if cur.right is None:
                    cur.right = new_node
                    break
                cur = cur.right

    # 清空整棵树+清空全部数据数组
    def clear_all(self):
        self.root = None
        self.all_data = []

    # 根据 timestamp 删除单条记录
    def delete_by_timestamp(self, timestamp):
        self.all_data = [item for item in self.all_data if item["timestamp"] != timestamp]
        # 重建 BST
        old_data = self.all_data[:]
        self.root = None
        self.all_data = []
        for item in old_data:
            self.insert(item["timestamp"], item["image_file_path"], item["ocr_text"], item["box_data"])

    # 倒序，最新图片在列表顶部
    def get_all_history(self):
        return list(reversed(self.all_data))

    def search_by_keyword(self, keyword):
        res = []
        kw = keyword.lower()
        for item in self.all_data:
            if kw in item["ocr_text"].lower():
                res.append(item)
        return list(reversed(res))

# 路径常量
HISTORY_ROOT = "history_storage"
BOX_SUB_DIR = os.path.join(HISTORY_ROOT, "boxed_images")
TXT_SUB_DIR = os.path.join(HISTORY_ROOT, "txt_output")
RECORD_JSON = os.path.join(HISTORY_ROOT, "history_records.json")

# 创建文件夹
for path in [HISTORY_ROOT, BOX_SUB_DIR, TXT_SUB_DIR]:
    os.makedirs(path, exist_ok=True)

# 全局实例
bst = BSTHistory()

# 写入json文件
def save_records_to_file():
    data = bst.get_all_history()
    with open(RECORD_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# 从文件加载数据（独立函数，可随时调用）
def load_records_from_file():
    # 加载前先清空现有内存数据
    bst.clear_all()
    if not os.path.exists(RECORD_JSON):
        return
    with open(RECORD_JSON, "r", encoding="utf-8") as f:
        try:
            records = json.load(f)
        except json.JSONDecodeError:
            records = []
    for item in records:
        bst.insert(
            stamp=item["timestamp"],
            image_file_path=item["image_file_path"],
            ocr_text=item["ocr_text"],
            box_data=item["box_data"]
        )

# 程序启动时加载一次
load_records_from_file()

# 新增一条OCR记录
def add_ocr_record(timestamp, img_url, box_img_url, txt_url, full_text, box_data):
    bst.insert(timestamp, img_url, full_text, box_data)
    all_records = bst.get_all_history()
    new_record = all_records[-1]
    save_records_to_file()
    return new_record

# 获取全部历史
def get_all_records():
    return bst.get_all_history()

# 关键词搜索（支持文字 + 单日日期）
def search_records(keyword="", date=""):
    all_items = bst.get_all_history()

    # 1. 先按单日日期过滤
    if date:
        try:
            parts = date.split("-")
            year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
            start_ts = time.mktime((year, month, day, 0, 0, 0, 0, 0, 0))
            end_ts = time.mktime((year, month, day, 23, 59, 59, 0, 0, 0))
            all_items = [item for item in all_items if start_ts <= item["timestamp"] <= end_ts]
        except (ValueError, IndexError, OverflowError):
            pass  # 日期格式错误时忽略日期过滤

    # 2. 再按关键词过滤
    if keyword and keyword.strip():
        kw = keyword.strip().lower()
        all_items = [item for item in all_items if kw in (item.get("ocr_text") or "").lower()]

    return all_items

# 单条删除历史记录
def delete_record(timestamp):
    """根据 timestamp 删除一条记录，同步内存和文件"""
    # 1. 从内存中删除
    bst.delete_by_timestamp(timestamp)
    # 2. 保存到文件
    save_records_to_file()

# 新增：全局清空历史接口（给app.py调用，一次性清空内存+文件）
def full_clear_history():
    # 1. 清空内存BST与数组
    bst.clear_all()
    # 2. 删除本地json文件
    if os.path.exists(RECORD_JSON):
        os.remove(RECORD_JSON)
    # 3. 新建空json文件
    with open(RECORD_JSON, "w", encoding="utf-8") as f:
        json.dump([], f, ensure_ascii=False, indent=2)
    # 4. 重新加载空文件，同步内存状态
    load_records_from_file()
