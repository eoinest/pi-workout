import math
from .common import CycleCounter,angle,visible_side

class CurlCounter(CycleCounter):
    def measure_pose(self,points):
        side=visible_side(points,[(11,13,15,23),(12,14,16,24)],self.confidence)
        if not side:return None
        shoulder,elbow,wrist,hip=side
        torso=math.hypot(shoulder.x-hip.x,shoulder.y-hip.y)
        if torso<.08 or shoulder.y>=hip.y-torso*.65:return None
        # Upper arm stays at the torso's side; overhead bends are not curls.
        if elbow.y<shoulder.y+torso*.15 or abs(elbow.x-shoulder.x)>torso*.5:return None
        return angle(shoulder,elbow,wrist)
    def guidance(self,tracking):
        if not tracking:return 'Keep your torso upright and upper arm at your side'
        return 'Lower to a straight arm' if self.phase=='work' else 'Curl up, then lower fully'
