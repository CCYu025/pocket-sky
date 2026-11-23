#!/usr/bin/env python3
"""usage: synccheck.py <final.mp4>   (needs out/events-beat-B.json from verify.mjs)
For each key event time: cut 0.5 s of the FINAL file's audio centred on it and find the nearest onset (flux peak, 2.9 ms hop)."""
import numpy as np,subprocess,json,sys,os
SR=22050;f=os.path.abspath(sys.argv[1])
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),".."))  # paths are relative to promo/
x=np.frombuffer(subprocess.run(['ffmpeg','-v','error','-i',f,'-vn','-ac','1','-ar',str(SR),'-f','s16le','-'],capture_output=True).stdout,dtype='<i2').astype(np.float32)/32768
ev=[e for e in json.load(open('out/events-beat-B.json'))]
keep=[e for e in ev if e['grid']=='beat' and e['down'] and any(k in e['name'] for k in ('TAP','pulse departs','hop start','title','arc','fold','LCD count step 1','sign on','end'))]
NF,HOP=512,64;w=np.hanning(NF).astype(np.float32)
def flux(seg):
    n=(len(seg)-NF)//HOP;idx=np.arange(NF)[None,:]+HOP*np.arange(n)[:,None]
    S=np.abs(np.fft.rfft(seg[idx]*w,axis=1));f_=np.fft.rfftfreq(NF,1/SR);S=S[:,(f_>=30)&(f_<8000)]
    L=np.log1p(200*S);return np.r_[0,np.maximum(0,np.diff(L,axis=0)).sum(1)],(np.arange(n)*HOP+NF/2)/SR
print('%-22s %8s %8s %9s %s'%('event','film s','onset s','err ms','pass(+-20)'))
res=[]
for e in keep:
    t=e['t']
    if t<0.3 or t>40.4: continue
    a=t-.25;seg=x[max(0,int(a*SR)):int((t+.25)*SR)];fl,tt=flux(seg);tt=tt+max(0,a)
    # onset peaks: local maxima above 35% of the window max, refined parabolic
    pk=[i for i in range(1,len(fl)-1) if fl[i]>=fl[i-1] and fl[i]>fl[i+1] and fl[i]>.35*fl.max()]
    ons=[]
    for i in pk:
        y0,y1,y2=fl[i-1],fl[i],fl[i+1];d=.5*(y0-y2)/(y0-2*y1+y2) if (y0-2*y1+y2)!=0 else 0;ons.append(tt[i]+d*HOP/SR)
    o=min(ons,key=lambda z:abs(z-t));err=(o-t)*1000
    res.append((e['name'],t,o,err));print('%-22s %8.3f %8.3f %+8.1f   %s'%(e['name'],t,o,err,'ok' if abs(err)<=20 else 'MISS'))
a=np.array([r[3] for r in res]);print('n=%d  within 20 ms: %d  mean %+.1f ms  max|err| %.1f ms'%(len(a),(abs(a)<=20).sum(),a.mean(),abs(a).max()))
