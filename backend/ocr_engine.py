import os
from PIL import Image, ImageEnhance, ImageFilter
_ocr = None

def init_ocr():
    global _ocr
    if _ocr is None:
        from paddleocr import PaddleOCR
        _ocr = PaddleOCR(use_textline_orientation=True, lang='ch')
    return _ocr

def preprocess_image(image_path):
    try:
        img = Image.open(image_path)
        img = img.filter(ImageFilter.MedianFilter(size=3))
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.5)
        img = img.filter(ImageFilter.SHARPEN)
        dir_name = os.path.dirname(image_path)
        base_name = os.path.basename(image_path)
        processed_path = os.path.join(dir_name, f"processed_{base_name}")
        img.save(processed_path)
        return processed_path
    except Exception as e:
        print(f"预处理失败，使用原图: {e}")
        return image_path

def recognize_text(image_path):
    ocr = init_ocr()
    final_img_path = preprocess_image(image_path)
    try:
        result = ocr.ocr(final_img_path, cls=True)
        if not result or not result[0]:
            return ""
        text_list = []
        for line in result[0]:
            text = line[1][0]
            confidence = line[1][1]
            if confidence > 0.5:
                text_list.append(text)
        return "\n".join(text_list)
    except Exception as e:
        print(f"识别出错: {e}")
        return f"识别失败: {str(e)}"