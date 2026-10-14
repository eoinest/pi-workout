import sys
import time
from dataclasses import dataclass

@dataclass(frozen=True)
class CameraDevice:
    index:int
    backend_index:int
    name:str
    built_in:bool=False
    continuity:bool=False

def order_macos_devices(devices):
    """Match OpenCV's uniqueID sort, then expose built-in-first user indices."""
    raw=sorted(devices,key=lambda device:device['id'])
    indexed=[];seen=set()
    for index,device in enumerate(raw):
        if device['id'] not in seen:indexed.append((index,device));seen.add(device['id'])
    preferred=sorted(indexed,key=lambda item:(not item[1]['built_in'],item[1]['continuity'],item[1]['name']))
    return [CameraDevice(index,backend_index,device['name'],device['built_in'],device['continuity'])
            for index,(backend_index,device) in enumerate(preferred)]

def macos_devices():
    import AVFoundation as av
    devices=list(av.AVCaptureDevice.devicesWithMediaType_(av.AVMediaTypeVideo))
    devices+=list(av.AVCaptureDevice.devicesWithMediaType_(av.AVMediaTypeMuxed))
    result=[]
    for device in devices:
        identifier=str(device.uniqueID())
        kind=str(device.deviceType())
        continuity=bool(device.isContinuityCamera()) if hasattr(device,'isContinuityCamera') else 'Continuity' in kind
        # Older app bundles can report an iPhone as builtInWideAngleCamera.
        continuity=continuity or str(device.modelID()).lower().startswith('iphone') or 'iphone' in str(device.localizedName()).lower()
        result.append({'id':identifier,'name':str(device.localizedName()),
                       'built_in':'BuiltIn' in kind and not continuity,'continuity':continuity})
    return order_macos_devices(result)

def select_device(index,platform=sys.platform):
    if platform!='darwin':return CameraDevice(index,index,f'Camera {index}')
    devices=macos_devices()
    if not devices:raise RuntimeError('macOS reports no connected cameras. Connect a camera and try again.')
    if not 0<=index<len(devices):
        choices=', '.join(f'{device.index}: {device.name}' for device in devices)
        raise RuntimeError(f'Camera {index} is not available. Available cameras: {choices}. Use /workout camera N.')
    return devices[index]

def request_macos_permission(cancelled,status,timeout=30):
    import AVFoundation as av
    from Foundation import NSDate,NSRunLoop
    state=av.AVCaptureDevice.authorizationStatusForMediaType_(av.AVMediaTypeVideo)
    if state==av.AVAuthorizationStatusAuthorized:return True
    if state==av.AVAuthorizationStatusDenied:
        raise RuntimeError('macOS denied camera access. Enable Camera for the terminal app running Pi in System Settings > Privacy & Security > Camera, then restart that terminal.')
    if state==av.AVAuthorizationStatusRestricted:
        raise RuntimeError('Camera access is restricted by macOS or device management.')
    status('Waiting for macOS camera permission…')
    result=[]
    av.AVCaptureDevice.requestAccessForMediaType_completionHandler_(av.AVMediaTypeVideo,lambda allowed:result.append(bool(allowed)))
    deadline=time.monotonic()+timeout
    while not result and time.monotonic()<deadline:
        if cancelled():return False
        NSRunLoop.currentRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(.05))
    if cancelled():return False
    if not result:raise RuntimeError('Camera permission request timed out. Check the macOS camera permission dialog for the terminal running Pi.')
    if not result[0]:raise RuntimeError('macOS denied camera access. Enable Camera for the terminal running Pi in System Settings > Privacy & Security > Camera.')
    return True

class CameraReader:
    """Native capture without forcing unsupported formats or treating one miss as disconnect."""
    def __init__(self,device,factory,status,clock=time.monotonic,startup_timeout=12,drop_timeout=3):
        self.device=device;self.factory=factory;self.status=status;self.clock=clock
        self.startup_timeout=startup_timeout;self.drop_timeout=drop_timeout
        self.capture=None;self.live=False;self.missing_since=None;self.reconnects=0
        self.open()

    def open(self):
        self.close()
        self.status(f'Opening {self.device.name} (camera {self.device.index})…')
        self.capture=self.factory(self.device.backend_index)
        if not self.capture.isOpened():
            self.close()
            raise RuntimeError(f'Could not open {self.device.name}. Check camera permission and close other apps using it.')
        self.started=self.clock();self.live=False;self.missing_since=None
        self.status(f'Waiting for the first frame from {self.device.name}…')

    def read(self):
        ok,frame=self.capture.read()
        if ok and frame is not None and frame.size>0:
            if not self.live:self.status(f'Camera ready: {self.device.name}')
            self.live=True;self.missing_since=None;self.reconnects=0
            return frame
        now=self.clock()
        if self.missing_since is None:
            self.missing_since=now if self.live else self.started
            if self.live:self.status(f'Waiting for {self.device.name} to resume…')
        timeout=self.drop_timeout if self.live else self.startup_timeout
        if now-self.missing_since<timeout:return None
        if self.reconnects<1:
            self.reconnects+=1;self.status(f'Reconnecting {self.device.name}…');self.open();return None
        hint='Unlock your iPhone and make sure Continuity Camera is connected, or use /workout camera 0 for the built-in camera.' if self.device.continuity else 'Close other camera apps, check camera permission, or choose another device with /workout cameras.'
        raise RuntimeError(f'{self.device.name} opened but delivered no usable frames after waiting and reconnecting. {hint}')

    def close(self):
        if self.capture is not None:self.capture.release();self.capture=None
