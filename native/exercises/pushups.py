import math
from .common import CycleCounter,angle,visible_side

def measure(points,confidence=.65):
    side=visible_side(points,[(11,13,15,23,25,27),(12,14,16,24,26,28)],confidence)
    if not side:return None
    shoulder,elbow,wrist,hip,knee,ankle=side
    torso=math.hypot(shoulder.x-hip.x,shoulder.y-hip.y)
    if torso<.08 or abs(shoulder.x-hip.x)<=abs(shoulder.y-hip.y)*1.3:return None
    if wrist.y<=shoulder.y+torso*.08:return None
    if angle(shoulder,hip,knee)<145 or angle(hip,knee,ankle)<145:return None
    return angle(shoulder,elbow,wrist)

class PushupCounter(CycleCounter):
    def measure_pose(self,points):return measure(points,self.confidence)
    def guidance(self,tracking):
        if not tracking:return 'Move side-on; keep your full body visible'
        return 'Push back up' if self.phase=='work' else 'Lower, then return to a straight-arm plank'
