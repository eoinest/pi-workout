import sys
import cv2
import mediapipe

if not (3,10)<=sys.version_info[:2]<=(3,12):
    raise RuntimeError('The camera runtime requires Python 3.10–3.12.')
if mediapipe.__version__!='1.1.0' or cv2.__version__!='5.0.0':
    raise RuntimeError('Camera dependencies do not match the plugin version.')
print('Camera runtime ready (no camera opened).')
