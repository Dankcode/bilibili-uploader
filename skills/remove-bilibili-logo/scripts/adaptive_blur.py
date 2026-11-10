#!/usr/bin/env python3
"""Apply an adaptive, soft color-selection blur within a SAM3 watermark mask."""
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
support=cv2.dilate((m>32).astype(np.uint8),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(13,13)))
y,x=np.where(support)
if not len(x): raise ValueError('SAM3 mask is empty')
x0=max(0,int(x.min())-14);x1=min(w,int(x.max())+15);y0=max(0,int(y.min())-14);y1=min(h,int(y.max())+15)
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
  lab=cv2.cvtColor(region,cv2.COLOR_BGR2LAB); lum=lab[:,:,0].astype(np.float32)
  background=cv2.GaussianBlur(lum,(0,0),5)
  # Per-frame brightness contrast selects light watermark pixels, bounded by
  # the SAM3 support to prevent unrelated light regions from being selected.
  response=np.clip((lum-background-2)/11,0,1)*roi
  response=cv2.dilate(response,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5)))
  alpha=cv2.GaussianBlur(response,(0,0),1.5)[:,:,None]
  soft=cv2.GaussianBlur(region,(0,0),8).astype(np.float32)
  region[:]=np.clip(region.astype(np.float32)*(1-alpha)+soft*alpha,0,255).astype(np.uint8)
  enc.stdin.write(frame.tobytes()); count+=1
  if count%1800==0: print(f'Processed {count} frames',file=sys.stderr,flush=True)
 enc.stdin.close(); dec.stdout.close()
 d=dec.wait(); e=enc.wait()
 if d or e: raise RuntimeError(f'ffmpeg failed (decode={d}, encode={e})')
 print(f'Processed {count} frames')
except BaseException:
 dec.kill(); enc.kill(); raise
