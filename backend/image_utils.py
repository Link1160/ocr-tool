import cv2
import numpy as np
import os
import time
from paddleocr import PaddleOCR
from history_manager import BSTHistory

TXT_SAVE_DIR = "ocr_txt_output"
os.makedirs(TXT_SAVE_DIR, exist_ok=True)

ocr = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)

def process_image(img_path):
    img = cv2.imread(img_path)
    if img is None:
        return [], ""
    result = ocr.ocr(img_path, cls=True)
    word_boxes = []
    txt_lines = []
    if result[0] is None:
        return word_boxes, ""
    for line_info in result[0]:
        coords = line_info[0]
        text, score = line_info[1]
        x1 = int(coords[0][0])
        y1 = int(coords[0][1])
        x2 = int(coords[2][0])
        y2 = int(coords[2][1])
        word_boxes.append((x1, y1, x2, y2, text))
        cv2.rectangle(img, (x1, y1), (x2, y2), (0, 0, 255), 2)
        cv2.putText(img, text, (x1, y1 - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 0, 0), 1)
        txt_lines.append(text)
    box_img_save_path = os.path.splitext(img_path)[0] + "_boxed.png"
    cv2.imwrite(box_img_save_path, img)
    full_text = "\n".join(txt_lines)
    base_name = os.path.basename(os.path.splitext(img_path)[0])
    txt_path = os.path.join(TXT_SAVE_DIR, f"{base_name}.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(full_text)
    return word_boxes, full_text

if __name__ == "__main__":
    history = BSTHistory()
    test_img = "test.jpg"
    if os.path.exists(test_img):
        stamp = time.time()
        box_data, ocr_text = process_image(test_img)
        history.insert(stamp, test_img, ocr_text, box_data)
        print("处理完成，已生成标注图片与TXT，并写入历史记录")
    else:
        print("未找到test.jpg，请将测试图片放到当前目录")
    input("按回车退出...")