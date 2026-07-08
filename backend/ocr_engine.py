import os
from PIL import Image, ImageEnhance, ImageFilter

# 全局 OCR 实例（只加载一次）
_ocr = None


def init_ocr():
    """初始化 PaddleOCR（全局只执行一次）"""
    global _ocr
    if _ocr is None:
        from paddleocr import PaddleOCR
        # use_angle_cls=True 开启方向分类，应对轻微倾斜
        _ocr = PaddleOCR(use_angle_cls=True, lang='ch')
    return _ocr


def preprocess_image(image_path):
    """
    轻量级预处理（只调现成库函数，不手写算法）
    返回处理后的图片路径
    """
    try:
        img = Image.open(image_path)

        # 1. 中值滤波去噪（调用PIL现成接口）
        img = img.filter(ImageFilter.MedianFilter(size=3))

        # 2. 增强对比度（让文字更突出）
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.5)

        # 3. 锐化（让边缘更清晰）
        img = img.filter(ImageFilter.SHARPEN)

        # 保存预处理后的图片（覆盖原图或新建）
        dir_name = os.path.dirname(image_path)
        base_name = os.path.basename(image_path)
        processed_path = os.path.join(dir_name, f"processed_{base_name}")
        img.save(processed_path)
        return processed_path
    except Exception as e:
        print(f"预处理失败，使用原图: {e}")
        return image_path  # 预处理失败则返回原图


def recognize_text(image_path):
    """
    核心识别函数：先预处理，再调用PaddleOCR
    返回识别的文字字符串
    """
    # 1. 确保OCR已初始化
    ocr = init_ocr()

    # 2. 预处理图片
    final_img_path = preprocess_image(image_path)

    # 3. 调用 PaddleOCR 推理
    try:
        result = ocr.ocr(final_img_path, cls=True)

        # 4. 解析结果，提取文字
        if not result or not result[0]:
            return ""

        text_list = []
        for line in result[0]:
            # line 格式: [[坐标], (识别文字, 置信度)]
            text = line[1][0]
            confidence = line[1][1]
            if confidence > 0.5:  # 过滤低置信度结果
                text_list.append(text)

        return "\n".join(text_list)

    except Exception as e:
        print(f"识别出错: {e}")
        return f"识别失败: {str(e)}"