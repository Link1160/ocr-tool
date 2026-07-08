import cv2
import numpy as np
from PIL import Image
import pytesseract
import os
import time
from history_manager import BSTHistory

TXT_SAVE_DIR = "ocr_txt_output"
os.makedirs(TXT_SAVE_DIR, exist_ok=True)

def process_image(img_path):
    img = cv2.imread(img_path)
    if img is None:
        return [], ""
    pil_img = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    ocr_data = pytesseract.image_to_data(pil_img, output_type=pytesseract.Output.DICT)
    word_boxes = []
    txt_lines = []
    prev_line_num = -1
    line_buffer = []
    for i in range(len(ocr_data["text"])):
        text = ocr_data["text"][i].strip()
        if not text:
            continue
        x = ocr_data["left"][i]
        y = ocr_data["top"][i]
        bw = ocr_data["width"][i]
        bh = ocr_data["height"][i]
        line_num = ocr_data["line_num"][i]
        word_boxes.append((x, y, x + bw, y + bh, text))
        cv2.rectangle(img, (x, y), (x + bw, y + bh), (0, 0, 255), 2)
        cv2.putText(img, text, (x, y - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 0, 0), 1)
        if line_num != prev_line_num:
            if line_buffer:
                txt_lines.append(" ".join(line_buffer))
                line_buffer.clear()
            prev_line_num = line_num
        line_buffer.append(text)
    if line_buffer:
        txt_lines.append(" ".join(line_buffer))
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