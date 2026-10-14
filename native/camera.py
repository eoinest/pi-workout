import argparse
import json
import signal
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from capture import CameraReader,macos_devices,request_macos_permission,select_device
from exercises import create_counter

def emit(kind,**data):
    print(json.dumps({'type':kind,**data}),flush=True)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--settings');parser.add_argument('--model');parser.add_argument('--list-cameras',action='store_true')
    args=parser.parse_args()
    if args.list_cameras:
        if sys.platform=='darwin':
            emit('cameras',devices=[{'index':d.index,'name':d.name,'builtIn':d.built_in,'continuity':d.continuity} for d in macos_devices()])
        else:emit('cameras',devices=[],message='Use /workout camera N to select your camera index. Device-name listing is available on macOS.')
        return
    if not args.settings or not args.model:parser.error('--settings and --model are required for capture')
    settings=json.loads(args.settings)
    stopped=False
    def cancel(_signal,_frame):
        nonlocal stopped
        stopped=True
    signal.signal(signal.SIGTERM,cancel);signal.signal(signal.SIGINT,cancel)
    status=lambda message:emit('status',message=message)
    if sys.platform=='darwin' and not request_macos_permission(lambda:stopped,status):emit('cancelled');return
    device=select_device(settings['camera'])
    import cv2
    import mediapipe as mp
    import numpy as np
    from mediapipe.tasks.python import vision
    counter=create_counter(settings)
    model=Path(args.model)
    if not model.exists():raise RuntimeError('Pose model missing. Run /workout setup.')
    options=vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
        running_mode=vision.RunningMode.VIDEO,num_poses=1,
        min_pose_detection_confidence=settings['confidence'],min_pose_presence_confidence=settings['confidence'],
        min_tracking_confidence=settings['confidence'])
    reader=None;window='Pi — workout gate (Esc to edit prompt)'
    try:
        cv2.namedWindow(window,cv2.WINDOW_NORMAL)
        placeholder=np.zeros((360,640,3),dtype=np.uint8)
        cv2.putText(placeholder,'Starting camera. Escape returns to your prompt.',(15,180),cv2.FONT_HERSHEY_SIMPLEX,.6,(240,240,240),1)
        cv2.imshow(window,placeholder);cv2.waitKey(1)
        backend=cv2.CAP_AVFOUNDATION if sys.platform=='darwin' else cv2.CAP_ANY
        # Retain the camera's native format. Resize frames in software if needed.
        reader=CameraReader(device,lambda index:cv2.VideoCapture(index,backend),status)
        with vision.PoseLandmarker.create_from_options(options) as tracker:
            previous=-1;last_count=-1
            while not stopped:
                if cv2.waitKey(1)&0xff==27 or cv2.getWindowProperty(window,cv2.WND_PROP_VISIBLE)<1:stopped=True;break
                frame=reader.read()
                timestamp=max(previous+1,int(time.monotonic()*1000));previous=timestamp
                if frame is None:
                    counter.update(None,timestamp)
                    # Never count or display a stale pose when frames are missing.
                    cv2.imshow(window,placeholder)
                    if cv2.waitKey(30)&0xff==27:stopped=True
                    continue
                if frame.shape[1]>960:
                    scale=960/frame.shape[1];frame=cv2.resize(frame,(960,round(frame.shape[0]*scale)))
                height,width=frame.shape[:2]
                image=mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(frame,cv2.COLOR_BGR2RGB))
                result=tracker.detect_for_video(image,timestamp)
                points=result.pose_landmarks[0] if result.pose_landmarks else None
                if points:
                    for connection in vision.PoseLandmarksConnections.POSE_LANDMARKS:
                        a,b=points[connection.start],points[connection.end]
                        if min(a.visibility,b.visibility)>=settings['confidence']:
                            cv2.line(frame,(int(a.x*width),int(a.y*height)),(int(b.x*width),int(b.y*height)),(110,240,150),3)
                    for point in points:
                        if point.visibility>=settings['confidence']:cv2.circle(frame,(int(point.x*width),int(point.y*height)),5,(230,255,240),-1)
                    geometry=[SimpleNamespace(x=p.x*width/height,y=p.y,visibility=p.visibility) for p in points]
                else:geometry=None
                tracking=counter.update(geometry,timestamp)
                if counter.count!=last_count:emit('progress',count=counter.count);last_count=counter.count
                frame=cv2.flip(frame,1)
                cv2.rectangle(frame,(0,0),(width,100),(25,35,25),-1)
                cv2.putText(frame,f"{counter.count} / {settings['reps']} {settings['exercise']}",(20,40),cv2.FONT_HERSHEY_SIMPLEX,1,(180,240,160),2)
                cv2.putText(frame,counter.guidance(tracking),(20,75),cv2.FONT_HERSHEY_SIMPLEX,.55,(240,240,240),1)
                cv2.imshow(window,frame)
                if cv2.waitKey(1)&0xff==27 or cv2.getWindowProperty(window,cv2.WND_PROP_VISIBLE)<1:stopped=True
                if not stopped and counter.count>=settings['reps']:emit('complete');return
            emit('cancelled')
    finally:
        if reader is not None:reader.close()
        cv2.destroyAllWindows()

if __name__=='__main__':
    try:main()
    except Exception as error:emit('error',message=str(error));sys.exit(1)
