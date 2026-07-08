import json
import time
import os

JSON_PATH = "history_data.json"

class Node:
    def __init__(self, timestamp, img_path, text):
        self.timestamp = timestamp
        self.img_path = img_path
        self.text = text
        self.left = None
        self.right = None

class BSTHistory:
    def __init__(self):
        self.root = None
        self.load_json()

    def insert(self, timestamp, img_path, text):
        new_node = Node(timestamp, img_path, text)
        if self.root is None:
            self.root = new_node
        else:
            self._insert(self.root, new_node)
        self.save_json()

    def _insert(self, root, new_node):
        if new_node.timestamp < root.timestamp:
            if root.left is None:
                root.left = new_node
            else:
                self._insert(root.left, new_node)
        else:
            if root.right is None:
                root.right = new_node
            else:
                self._insert(root.right, new_node)

    def get_all_history(self):
        res = []
        self._inorder(self.root, res)
        return res

    def _inorder(self, node, res_list):
        if node:
            self._inorder(node.left, res_list)
            res_list.append({
                "time_stamp": node.timestamp,
                "img_path": node.img_path,
                "ocr_text": node.text
            })
            self._inorder(node.right, res_list)

    def search_by_keyword(self, keyword):
        result = []
        self._search(self.root, keyword, result)
        return result

    def _search(self, node, key, res):
        if node:
            if key in node.text:
                res.append({
                    "time_stamp": node.timestamp,
                    "img_path": node.img_path,
                    "ocr_text": node.text
                })
            self._search(node.left, key, res)
            self._search(node.right, key, res)

    def save_json(self):
        data_list = self.get_all_history()
        with open(JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(data_list, f, ensure_ascii=False, indent=2)

    def load_json(self):
        if not os.path.exists(JSON_PATH):
            return
        with open(JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        for item in data:
            self.insert(item["time_stamp"], item["img_path"], item["ocr_text"])