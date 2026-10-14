import unittest
from types import SimpleNamespace
from unittest.mock import patch
from capture import CameraDevice,CameraReader,order_macos_devices,request_macos_permission

FRAME=SimpleNamespace(size=100)
EMPTY=SimpleNamespace(size=0)
class Clock:
    def __init__(self):self.time=0
    def __call__(self):return self.time
class Capture:
    def __init__(self,frames=None,opened=True):self.frames=list(frames or []);self.opened=opened;self.released=False
    def isOpened(self):return self.opened
    def read(self):return self.frames.pop(0) if self.frames else (False,None)
    def release(self):self.released=True
    def set(self,*_):raise AssertionError('Camera format must not be forced')
class Factory:
    def __init__(self,*captures):self.captures=list(captures);self.indices=[]
    def __call__(self,index):self.indices.append(index);return self.captures.pop(0)

class CaptureTest(unittest.TestCase):
    def reader(self,factory,device=None):
        clock=Clock();messages=[]
        reader=CameraReader(device or CameraDevice(0,1,'MacBook Pro Camera',True),factory,messages.append,clock)
        return reader,clock,messages
    def test_builtin_is_logical_zero_even_when_iphone_sorts_first_in_opencv(self):
        result=order_macos_devices([
            {'id':'6C707041','name':'MacBook Pro Camera','built_in':True,'continuity':False},
            {'id':'39FFC234','name':'iPhone Camera','built_in':False,'continuity':True},
        ])
        self.assertEqual((result[0].index,result[0].backend_index,result[0].name),(0,1,'MacBook Pro Camera'))
        self.assertEqual((result[1].index,result[1].backend_index),(1,0))
    def test_duplicate_muxed_device_keeps_opencv_backend_indices(self):
        iphone={'id':'A','name':'iPhone Camera','built_in':False,'continuity':True}
        mac={'id':'B','name':'MacBook Pro Camera','built_in':True,'continuity':False}
        result=order_macos_devices([iphone,mac,iphone])
        self.assertEqual(len(result),2);self.assertEqual(result[0].backend_index,2)
    def test_startup_misses_are_retried_and_native_format_is_retained(self):
        capture=Capture([(False,None),(False,None),(True,FRAME)])
        reader,clock,_=self.reader(Factory(capture))
        self.assertIsNone(reader.read());clock.time=1;self.assertIsNone(reader.read())
        clock.time=2;self.assertIs(reader.read(),FRAME);self.assertTrue(reader.live)
        reader.close();self.assertTrue(capture.released)
    def test_one_missed_frame_does_not_disconnect_or_reopen(self):
        factory=Factory(Capture([(True,FRAME),(False,None),(True,FRAME)]))
        reader,clock,_=self.reader(factory)
        self.assertIs(reader.read(),FRAME);clock.time=1;self.assertIsNone(reader.read())
        clock.time=2;self.assertIs(reader.read(),FRAME);self.assertEqual(factory.indices,[1])
    def test_startup_timeout_reopens_same_device_once_and_recovers(self):
        first=Capture();second=Capture([(True,FRAME)]);factory=Factory(first,second)
        reader,clock,messages=self.reader(factory)
        clock.time=12;self.assertIsNone(reader.read());self.assertTrue(first.released)
        clock.time=13;self.assertIs(reader.read(),FRAME);self.assertEqual(factory.indices,[1,1])
        self.assertIn('Reconnecting MacBook Pro Camera…',messages)
    def test_persistent_failure_identifies_device_and_actionable_iphone_hint(self):
        factory=Factory(Capture(),Capture());device=CameraDevice(1,0,'iPhone Camera',False,True)
        reader,clock,_=self.reader(factory,device)
        clock.time=12;reader.read();clock.time=24
        with self.assertRaisesRegex(RuntimeError,'iPhone Camera.*Unlock your iPhone'):reader.read()
        reader.close()
    def test_permission_or_open_failure_releases_capture(self):
        capture=Capture(opened=False)
        with self.assertRaisesRegex(RuntimeError,'Could not open MacBook Pro Camera'):self.reader(Factory(capture))
        self.assertTrue(capture.released)
    def test_empty_frame_is_not_sent_to_pose_tracker(self):
        reader,_,_=self.reader(Factory(Capture([(True,EMPTY),(True,FRAME)])))
        self.assertIsNone(reader.read());self.assertIs(reader.read(),FRAME)
    def test_live_disconnect_gets_retry_grace_then_reconnects(self):
        factory=Factory(Capture([(True,FRAME)]),Capture([(True,FRAME)]))
        reader,clock,_=self.reader(factory);reader.read()
        clock.time=1;self.assertIsNone(reader.read());clock.time=4;self.assertIsNone(reader.read())
        clock.time=5;self.assertIs(reader.read(),FRAME)
    def test_usb_is_preferred_before_continuity_when_no_builtin(self):
        result=order_macos_devices([
            {'id':'A','name':'iPhone Camera','built_in':False,'continuity':True},
            {'id':'B','name':'USB Camera','built_in':False,'continuity':False},
        ])
        self.assertEqual(result[0].name,'USB Camera')



class PermissionTest(unittest.TestCase):
    def modules(self,state,allowed=True,delay=0):
        requested=[];callbacks=[];ticks=[]
        def request(_media,callback):
            requested.append(True)
            if not delay:callback(allowed)
            else:callbacks.append(callback)
        def pump(_date):
            ticks.append(True)
            if len(ticks)==delay:callbacks[0](allowed)
        av=SimpleNamespace(
            AVMediaTypeVideo='video',AVAuthorizationStatusAuthorized=3,
            AVAuthorizationStatusDenied=2,AVAuthorizationStatusRestricted=1,
            AVCaptureDevice=SimpleNamespace(authorizationStatusForMediaType_=lambda _:state,requestAccessForMediaType_completionHandler_=request),
        )
        foundation=SimpleNamespace(
            NSDate=SimpleNamespace(dateWithTimeIntervalSinceNow_=lambda _:None),
            NSRunLoop=SimpleNamespace(currentRunLoop=lambda:SimpleNamespace(runUntilDate_=pump)),
        )
        return {'AVFoundation':av,'Foundation':foundation},requested,ticks
    def test_waits_for_delayed_permission_response_before_opening_capture(self):
        modules,requested,ticks=self.modules(0,delay=4)
        with patch.dict('sys.modules',modules):
            self.assertTrue(request_macos_permission(lambda:False,lambda _:None))
        self.assertEqual(len(requested),1);self.assertEqual(len(ticks),4)
    def test_existing_permission_does_not_request_it_again(self):
        modules,requested,_=self.modules(3)
        with patch.dict('sys.modules',modules):self.assertTrue(request_macos_permission(lambda:False,lambda _:None))
        self.assertFalse(requested)
    def test_denied_permission_reports_terminal_settings_without_resetting_tcc(self):
        modules,requested,_=self.modules(2)
        with patch.dict('sys.modules',modules):
            with self.assertRaisesRegex(RuntimeError,'Enable Camera for the terminal'):request_macos_permission(lambda:False,lambda _:None)
        self.assertFalse(requested)
    def test_cancel_during_permission_wait_never_opens_capture(self):
        modules,_,_=self.modules(0,delay=5)
        with patch.dict('sys.modules',modules):self.assertFalse(request_macos_permission(lambda:True,lambda _:None))
    def test_restricted_camera_permission_is_reported_separately(self):
        modules,_,_=self.modules(1)
        with patch.dict('sys.modules',modules):
            with self.assertRaisesRegex(RuntimeError,'restricted'):request_macos_permission(lambda:False,lambda _:None)

if __name__=='__main__':unittest.main()
