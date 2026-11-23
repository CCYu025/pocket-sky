#!/usr/bin/env python3
"""Local drift-aware beat/downbeat tracker (numpy only). Usage: beatgrid.py song.raw(22050 mono s16) A B  -> audio/beats_raw.json (gitignored intermediate)"""
import numpy as np, json, sys, os
sys.argv[1]=os.path.abspath(sys.argv[1])  # song.raw as given from the caller's cwd
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),".."))  # paths below are relative to promo/
SR=22050; HOP=128; NF=1024
x=np.fromfile(sys.argv[1],dtype='<i2').astype(np.float32)/32768
A=float(sys.argv[2]);B=float(sys.argv[3])
def stft_flux(x,lo,hi):
    w=np.hanning(NF).astype(np.float32); n=(len(x)-NF)//HOP
    idx=np.arange(NF)[None,:]+HOP*np.arange(n)[:,None]
    S=np.abs(np.fft.rfft(x[idx]*w,axis=1)); f=np.fft.rfftfreq(NF,1/SR)
    S=S[:,(f>=lo)&(f<hi)]; L=np.log1p(200*S)
    fl=np.r_[0,np.maximum(0,np.diff(L,axis=0)).sum(1)]
    return fl, (np.arange(n)*HOP+NF/2)/SR   # frame centre times
a0=int((A-3)*SR);b0=int((B+3)*SR);xs=x[a0:b0]
fl,tt=stft_flux(xs,30,8000); fl_lo,_=stft_flux(xs,30,180); tt=tt+a0/SR
def norm(v):
    m=np.convolve(v,np.ones(400)/400,'same'); return np.maximum(0,v-m)/(np.std(v)+1e-9)
o=norm(fl); olo=norm(fl_lo); dt=HOP/SR
# global tempo via autocorr
m=(tt>=A)&(tt<=B); ac=np.correlate(o[m],o[m],'full')[m.sum()-1:]
lags=np.arange(len(ac))*dt; sel=(lags>60/125)&(lags<60/90); P0=lags[sel][np.argmax(ac[sel])]
# refine autocorr peak parabolic
i=np.argmax(np.where(sel,ac,-1)); y0,y1,y2=ac[i-1],ac[i],ac[i+1]; P0=(i+.5*(y0-y2)/(y0-2*y1+y2))*dt
print('global period %.4f s = %.2f BPM'%(P0,60/P0),file=sys.stderr)
# Ellis DP beat tracker
g=np.exp(-.5*(np.arange(-8,9)/2.5)**2); os_=np.convolve(o,g,'same')
per=P0/dt; N=len(os_); score=os_.copy(); back=np.zeros(N,int); tight=100.
for i in range(N):
    lo=int(i-1.3*per);hi=int(i-.75*per)
    if hi<0: continue
    lo=max(lo,0); js=np.arange(lo,hi+1)
    pen=-tight*np.log((i-js)/per)**2
    k=np.argmax(score[js]+pen); score[i]=os_[i]+score[js][k]+pen[k]; back[i]=js[k]
end=np.argmax(score[:int((B+2-(tt[0]))/dt)]); bt=[]
while end>0: bt.append(end); end=back[end]
bt=np.array(bt[::-1]); bt=bt[(tt[bt]>=A-1)&(tt[bt]<=B+1)]
# refine to nearest onset peak (local max of unsmoothed o, parabolic)
ref=[]
for b in bt:
    lo=max(1,b-int(.045/dt)); hi=min(N-2,b+int(.045/dt)); j=lo+np.argmax(o[lo:hi+1])
    y0,y1,y2=o[j-1],o[j],o[j+1]; d=.5*(y0-y2)/(y0-2*y1+y2) if (y0-2*y1+y2)!=0 else 0
    ref.append((tt[j]+d*dt, o[j]))
ref=np.array(ref); T=ref[:,0]
# smooth outliers: if the refined peak is weak (<0.3) keep tracker position
for k,(t,s) in enumerate(ref):
    if s<0.3: T[k]=tt[bt[k]]
# downbeat: low-band onset strength at each beat by phase mod 4
lo_s=np.interp(T,tt,np.convolve(olo,g,'same'))
ph=[lo_s[k::4].mean() for k in range(4)]
print('low-band strength by phase',np.round(ph,2),file=sys.stderr)
# --- leading-edge refinement (broadband flux, 512/64 => 2.9 ms resolution)
def lead(NF2,HOP2,lo,hi):
    w=np.hanning(NF2).astype(np.float32);a1=int((A-3)*SR);xs2=x[a1:int((B+3)*SR)];n=(len(xs2)-NF2)//HOP2
    idx=np.arange(NF2)[None,:]+HOP2*np.arange(n)[:,None]
    S=np.abs(np.fft.rfft(xs2[idx]*w,axis=1));f=np.fft.rfftfreq(NF2,1/SR);S=S[:,(f>=lo)&(f<hi)]
    L=np.log1p(200*S);fl2=np.r_[0,np.maximum(0,np.diff(L,axis=0)).sum(1)];t2=(a1+np.arange(n)*HOP2+NF2/2)/SR
    out=[]
    for tb in T:
        j=np.where((t2>tb-.06)&(t2<tb+.06))[0];pk=j[np.argmax(fl2[j])];k=pk
        while k>j[0] and fl2[k]>.35*fl2[pk]:k-=1
        out.append(t2[k])
    return np.array(out)
Tl=lead(512,64,30,8000);Tlow=lead(512,64,30,200)
T_peak=T.copy();T=Tl
json.dump({'t_peak':T_peak.tolist(),'t_low':Tlow.tolist(),'t':T.tolist(),'strength':ref[:,1].tolist(),'low':lo_s.tolist(),'phase_scores':[float(p) for p in ph],'P0':float(P0)},open('audio/beats_raw.json','w'))
ibi=np.diff(T); print('n',len(T),'ibi mean %.4f sd %.4f min %.3f max %.3f'%(ibi.mean(),ibi.std(),ibi.min(),ibi.max()),file=sys.stderr)
for k in range(len(T)): print('%3d %8.3f ibi %.3f str %.1f low %.1f'%(k,T[k],ibi[k-1] if k else 0,ref[k,1],lo_s[k]))
