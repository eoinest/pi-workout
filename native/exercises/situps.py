import math
from .common import CycleCounter,angle,visible_side

class SitupCounter(CycleCounter):
    def measure_pose(self,points):
        side=visible_side(points,[(11,23,25,27),(12,24,26,28)],self.confidence)
        if not side:return None
        shoulder,hip,knee,ankle=side
        torso=math.hypot(shoulder.x-hip.x,shoulder.y-hip.y)
        if torso<.08:return None
        # Bent knees plus hip/feet at similar height distinguish floor sit-ups
        # from standing hip bends. Use hip-to-ankle to handle bent knees.
        if abs(hip.y-ankle.y)>torso*.45:return None
        if abs(hip.x-ankle.x)<torso*.5 or not 40<=angle(hip,knee,ankle)<=140:return None
        if shoulder.y>hip.y+torso*.2:return None
        return angle(shoulder,hip,ankle)
    def guidance(self,tracking):
        if not tracking:return 'Lie side-on with knees bent and feet planted; show your full body'
        return 'Lie back to the starting position' if self.phase=='work' else 'Sit up, then lower back down'
