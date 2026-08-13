# Proof assets

`face_detection_yunet_2023mar.onnx` is the YuNet face detector from the
[OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet).
It is used only by the deterministic geometric face-swap proof fallback.

The production face-swap processor remains FaceFusion and uses the models
selected in the FaceFusion connection settings.
