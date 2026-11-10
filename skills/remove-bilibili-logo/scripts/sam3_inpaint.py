#!/usr/bin/env python3
"""Reconstruct a SAM3-masked watermark from surrounding pixels on each frame."""
import argparse, json, subprocess, sys
import cv2
import numpy as np

p=argparse.ArgumentParser()
p.add_argument('--input',required=True); p.add_argument('--mask',required=True); p.add_argument('--output',required=True)
p.add_argument('--ffmpeg',required=True); p.add_argument('--ffprobe',required=True)
a=p.parse_args()
meta=json.loads(subprocess.check_output([a.ffprobe,'-v','error','-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate','-of','json',a.input]))['streams'][0]
w,h=meta['width'],meta['height']; fps=meta['avg_frame_rate']
m=cv2.imread(a.mask,cv2.IMREAD_GRAYSCALE)
if m is None or m.shape!=(h,w): raise ValueError('Mask must match video dimensions')
scale=max(w/480,h/852)
kernel=max(3,int(round(13*scale)) | 1)
support=cv2.dilate((m>32).astype(np.uint8),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(kernel,kernel)))
y,x=np.where(support)
if not len(x): raise ValueError('SAM3 mask is empty')
margin=max(14,int(round(14*scale)))
x0=max(0,int(x.min())-margin);x1=min(w,int(x.max())+margin+1);y0=max(0,int(y.min())-margin);y1=min(h,int(y.max())+margin+1)
roi=support[y0:y1,x0:x1]
dec=subprocess.Popen([a.ffmpeg,'-v','error','-i',a.input,'-map','0:v:0','-f','rawvideo','-pix_fmt','bgr24','-'],stdout=subprocess.PIPE)
enc=subprocess.Popen([a.ffmpeg,'-v','error','-f','rawvideo','-pix_fmt','bgr24','-s',f'{w}x{h}','-r',fps,'-i','pipe:0','-i',a.input,'-map','0:v:0','-map','1:a?','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart','-y',a.output],stdin=subprocess.PIPE)
size=w*h*3; count=0
try:
 while True:
  data=dec.stdout.read(size)
  if not data: break
  if len(data)!=size: raise RuntimeError('Truncated decoded frame')
  frame=np.frombuffer(data,dtype=np.uint8).reshape((h,w,3)).copy()
  region=frame[y0:y1,x0:x1]
  # Reconstruct the marked area using surrounding pixels on this frame.
  target=(roi*255).astype(np.uint8)
  restored=cv2.inpaint(region,target,5*scale,cv2.INPAINT_TELEA)
  alpha=cv2.GaussianBlur(roi.astype(np.float32),(0,0),1.2*scale)[:,:,None]
  region[:]=np.clip(region.astype(np.float32)*(1-alpha)+restored.astype(np.float32)*alpha,0,255).astype(np.uint8)
  enc.stdin.write(frame.tobytes()); count+=1
  if count%1800==0: print(f'Processed {count} frames',file=sys.stderr,flush=True)
 enc.stdin.close(); dec.stdout.close()
 d=dec.wait(); e=enc.wait()
 if d or e: raise RuntimeError(f'ffmpeg failed (decode={d}, encode={e})')
 print(f'Processed {count} frames')
except BaseException:
 dec.kill(); enc.kill(); raise
