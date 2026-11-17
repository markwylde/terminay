"""Read Xvnc's CLIPBOARD through X11; emit only its length and SHA-256."""
import ctypes as c
import hashlib
import json
import select
import time
x = c.CDLL('libX11.so.6')
P = c.c_void_p
U = c.c_ulong
I = c.c_int
for name, args, result in [
 ('XOpenDisplay',[c.c_char_p],P),('XDefaultRootWindow',[P],U),
 ('XCreateSimpleWindow',[P,U,I,I,c.c_uint,c.c_uint,c.c_uint,U,U],U),
 ('XInternAtom',[P,c.c_char_p,I],U),('XConvertSelection',[P,U,U,U,U,U],I),
 ('XFlush',[P],I),('XConnectionNumber',[P],I),('XPending',[P],I),
 ('XNextEvent',[P,P],I),('XGetWindowProperty',[P,U,U,c.c_long,c.c_long,I,U,c.POINTER(U),c.POINTER(I),c.POINTER(U),c.POINTER(U),c.POINTER(P)],I),
 ('XFree',[P],I),('XCloseDisplay',[P],I),
]:
 f=getattr(x,name);f.argtypes=args;f.restype=result
class Selection(c.Structure):
 _fields_=[('type',I),('serial',U),('send_event',I),('display',P),('requestor',U),('selection',U),('target',U),('property',U),('time',U)]
d=x.XOpenDisplay(b':1')
if not d: raise RuntimeError('display unavailable')
w=x.XCreateSimpleWindow(d,x.XDefaultRootWindow(d),0,0,1,1,0,0,0)
atom=lambda name:x.XInternAtom(d,name.encode(),0)
p=atom('TERMINAY_CLIPBOARD_PROBE')
x.XConvertSelection(d,atom('CLIPBOARD'),atom('UTF8_STRING'),p,w,0)
x.XFlush(d)
end=time.monotonic()+5
while time.monotonic()<end:
 if not x.XPending(d):
  select.select([x.XConnectionNumber(d)],[],[],0.1)
  continue
 event=(c.c_long*24)();x.XNextEvent(d,c.byref(event))
 e=c.cast(c.byref(event),c.POINTER(Selection)).contents
 if e.type!=31:continue
 if not e.property: raise RuntimeError('clipboard has no UTF-8 text')
 actual=U();fmt=I();count=U();remaining=U();data=P()
 x.XGetWindowProperty(d,w,p,0,262144,1,0,c.byref(actual),c.byref(fmt),c.byref(count),c.byref(remaining),c.byref(data))
 value=c.string_at(data,count.value)
 x.XFree(data);x.XCloseDisplay(d)
 print(json.dumps({'bytes':len(value),'sha256':hashlib.sha256(value).hexdigest()}))
 break
else: raise TimeoutError('clipboard request timed out')
