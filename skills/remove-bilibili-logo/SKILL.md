---
name: remove-bilibili-logo
description: Blur Bilibili logos and the adjacent Chinese creator name in a video, using video-automation and its connected SAM3/ComfyUI tools when available.
---

# Remove Bilibili logo

Find and blur the Bilibili logo and adjacent Chinese account name throughout the requested video. Work on a new output file; preserve the input and audio. Do not upload or publish unless separately requested.

1. Retrieve the highest available source quality when requested, verify the Bilibili session rather than relying on stored-cookie expiry, and probe the actual downloaded resolution. An upscale does not recover source detail. Probe the input and inspect frames across its full duration, including the beginning and end. Establish the location and whether the overlay moves or changes; do not assume coordinates from another video.
2. Prefer the video-automation connection to the desktop ComfyUI and SAM3 for segmentation. The desktop node catalog exposes `SAM3_Detect`, `SAM3_VideoTrack`, `SAM3_TrackToMask`, `ImageBlur`, and `ImageCompositeMasked`; discover the current schemas and models before use. Test on a frame before processing. Include the adjacent Chinese name as well as the logo in the blur region. If SAM3 cannot reliably segment small text, expand its mask or use a suitable region; if the overlay moves, use tracking or time-varying regions.
3. For a stationary overlay, use the SAM3 mask only to identify the area to reconstruct. Run `scripts/sam3_inpaint.py` to fill that area from surrounding pixels separately on every frame; do not apply magic-wand color selection inside the mask. Feather the boundary to avoid an obvious rectangle. Maintain original duration, dimensions, frame rate, and audio, including existing translations and edits.
4. Check representative frames throughout the output for coverage and avoid obscuring more of the image than necessary. Probe and compare duration and dimensions with the input, and record the resulting version in the uploader when it is part of a tracked job. Report how SAM3 was used and any limitations.

For the 480×852 Prisma Whispers source `BV1sN4A6DEoX`, both marks lie approximately within x=8–224, y=8–54. SAM3 can segment them with a prompt such as “white Chinese text watermark in top left corner”; grow the mask slightly and feather it for a soft edge. These coordinates are specific to that file; recheck every source. When compositing with FFmpeg maskedmerge, ensure the video remains in color and verify the result.


For a fixed watermark with changing background, use `scripts/sam3_inpaint.py` with a full-resolution SAM3 mask. It scales its mask expansion and inpainting radius to the input resolution and reconstructs the marked region from surrounding pixels on each frame with OpenCV inpainting; it does not color-select inside the mask. The input mask defines fixed coverage, so use video tracking if the watermark moves. Inspect results at multiple times, including dark and bright backgrounds, for edge artifacts and temporal flicker. Verify video and audio stream durations separately.

## Running the inpainting script

The script requires Python with OpenCV (`cv2`) and NumPy, plus FFmpeg and FFprobe. Obtain a full-resolution grayscale mask from SAM3; white marks the pixels to cover. Mask dimensions must match the input video. For a video with audio that cannot be copied into MP4, convert the audio to AAC first.

```sh
python scripts/sam3_inpaint.py --input input.mp4 --mask sam3-mask.png \
  --output output.mp4 --ffmpeg /path/to/ffmpeg --ffprobe /path/to/ffprobe
```

For variable-frame-rate footage, compare timestamps and frame timing carefully: the script encodes a constant frame rate from the input average. Never claim a mask is dynamically tracked when it is fixed.
