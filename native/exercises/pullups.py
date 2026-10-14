import math
from .common import CycleCounter,angle,visible_side

class PullupCounter(CycleCounter):
    def measure_pose(self,points):
        side=visible_side(points,[(11,13,15,23),(12,14,16,24)],self.confidence)
        if not side:return None
        shoulder,elbow,wrist,hip=side
        torso=math.hypot(shoulder.x-hip.x,shoulder.y-hip.y)
        if torso<.08 or shoulder.y>=hip.y-torso*.65:return None
        if wrist.y>=shoulder.y-torso*.08:return None
        return angle(shoulder,elbow,wrist)
    def guidance(self,tracking):
        if not tracking:return 'Keep hands overhead, torso upright, and upper body visible'
        return 'Lower to straight arms' if self.phase=='work' else 'Pull up, then return to straight arms'
