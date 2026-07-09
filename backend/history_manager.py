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

HISTORY_ROOT = "history_storage"
BOX_SUB_DIR = os.path.join(HISTORY_ROOT, "boxed")
TXT_SUB_DIR = os.path.join(HISTORY_ROOT, "txt")
RECORD_JSON = os.path.join(HISTORY_ROOT, "history_records.json")

for path in [HISTORY_ROOT, BOX_SUB_DIR, TXT_SUB_DIR]:
    os.makedirs(path, exist_ok=True)

bst = BSTHistory()

def save_records_to_file():
    data = bst.get_all_history()
    with open(RECORD_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def load_records_from_file():
    if not os.path.exists(RECORD_JSON):
        return
    with open(RECORD_JSON, "r", encoding="utf-8") as f:
        records = json.load(f)
    for item in records:
        bst.insert(
            stamp=item["timestamp"],
            image_file_path=item["image_file_path"],
            ocr_text=item["ocr_text"],
            box_data=item["box_data"]
        )

load_records_from_file()

# 仅保存原图地址，不持久存储box_img_url，节省存储空间
def add_ocr_record(timestamp, img_url, box_img_url, txt_url, full_text, box_data):
    bst.insert(timestamp, img_url, full_text, box_data)
    all_records = bst.get_all_history()
    new_record = all_records[-1]
    new_record["image_file_path"] = img_url
    save_records_to_file()
    return new_record

def get_all_records():
    return bst.get_all_history()

def search_records(keyword):
    return bst.search_by_keyword(keyword)