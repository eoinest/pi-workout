import math
from .common import CycleCounter,angle,visible_side

class SquatCounter(CycleCounter):
    def measure_pose(self,points):
        side=visible_side(points,[(11,23,25,27),(12,24,26,28)],self.confidence)
        if not side:return None
        shoulder,hip,knee,ankle=side
        torso=math.hypot(shoulder.x-hip.x,shoulder.y-hip.y)
        if torso<.08 or shoulder.y>=hip.y-torso*.4:return None
        if knee.y>=ankle.y-torso*.08 or hip.y>=ankle.y-torso*.15:return None
        return angle(hip,knee,ankle)
    def guidance(self,tracking):
        if not tracking:return 'Stand side-on; keep shoulders, hips, knees and ankles visible'
        return 'Stand back up fully' if self.phase=='work' else 'Squat down, then stand tall'
