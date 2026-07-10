import os
import time
import json

class BSTNode:
    def __init__(self, stamp, image_file_path, ocr_text, box_data):
        self.stamp = stamp
        self.image_file_path = image_file_path
        self.ocr_text = ocr_text
        self.box_data = box_data
        self.left = None
        self.right = None

class BSTHistory:
    def __init__(self):
        self.root = None
        self.all_data = []

    def clear_all(self):
        self.root = None
        self.all_data.clear()

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

    def get_all_history(self):
        return list(reversed(self.all_data))

    def search_by_keyword(self, keyword):
        kw = keyword.lower()
        return list(reversed([i for i in self.all_data if kw in i["ocr_text"].lower()]))

# 全局路径常量
HISTORY_ROOT = "history_storage"
BOX_SUB_DIR = os.path.join(HISTORY_ROOT, "boxed")
TXT_SUB_DIR = os.path.join(HISTORY_ROOT, "txt")
RECORD_JSON = os.path.join(HISTORY_ROOT, "history_records.json")

# 自动创建目录
os.makedirs(HISTORY_ROOT, exist_ok=True)
os.makedirs(BOX_SUB_DIR, exist_ok=True)
os.makedirs(TXT_SUB_DIR, exist_ok=True)

# 全局BST实例
bst = BSTHistory()

# 从文件加载历史记录
def load_records_from_file():
    bst.clear_all()
    if not os.path.exists(RECORD_JSON):
        return
    with open(RECORD_JSON, "r", encoding="utf-8") as f:
        records = json.load(f)
    for item in records:
        bst.insert(item["timestamp"], item["image_file_path"], item["ocr_text"], item["box_data"])

# 保存历史记录到文件
def save_records_to_file():
    data = bst.get_all_history()
    with open(RECORD_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.flush()

# 新增识别记录
def add_ocr_record(timestamp, img_url, box_img_url, txt_url, full_text, box_data):
    load_records_from_file()
    bst.insert(timestamp, img_url, full_text, box_data)
    save_records_to_file()
    return bst.get_all_history()[-1]

# 获取全部历史
def get_all_records():
    load_records_from_file()
    return bst.get_all_history()

# 关键词检索
def search_records(keyword):
    load_records_from_file()
    return bst.search_by_keyword(keyword)

# 一键清空全部历史（内存+文件双重清空，无回弹）
def full_clear_history():
    bst.clear_all()
    if os.path.exists(RECORD_JSON):
        os.remove(RECORD_JSON)
    with open(RECORD_JSON, "w", encoding="utf-8") as f:
        json.dump([], f, ensure_ascii=False)
        f.flush()
    load_records_from_file()

# 程序启动自动加载历史
load_records_from_file()