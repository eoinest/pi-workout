import math

def angle(a,b,c):
    x=(a.x-b.x,a.y-b.y); y=(c.x-b.x,c.y-b.y)
    length=math.hypot(*x)*math.hypot(*y)
    return math.degrees(math.acos(max(-1,min(1,(x[0]*y[0]+x[1]*y[1])/length)))) if length else 0

def visible_side(points,ids,confidence):
    if not points or len(points)<33:return None
    sides=[[points[i] for i in side] for side in ids]
    visible=[side for side in sides if all(p.visibility>=confidence for p in side)]
    return max(visible,key=lambda side:min(p.visibility for p in side)) if visible else None

class CycleCounter:
    """Stable start -> work -> start; never count a partial first repetition."""
    def __init__(self,confidence=.65,up=155,down=100,hold_ms=180):
        self.confidence=confidence;self.up=up;self.down=down;self.hold_ms=hold_ms
        self.count=0;self.phase='ready';self.candidate=None;self.since=0;self.last_valid=0;self.last_time=-1

    def update(self,points,time_ms):
        if time_ms<=self.last_time:return False
        self.last_time=time_ms
        bend=self.measure_pose(points)
        if bend is None:
            self.candidate=None
            if time_ms-self.last_valid>700:self.phase='ready'
            return False
        self.last_valid=time_ms
        next_phase='start' if bend>=self.up else 'work' if bend<=self.down else None
        if next_phase is None:self.candidate=None;return True
        if self.candidate!=next_phase:self.candidate=next_phase;self.since=time_ms
        if time_ms-self.since>=self.hold_ms:
            if next_phase=='start' and self.phase=='work':self.count+=1;self.phase='start'
            elif next_phase=='start' and self.phase=='ready':self.phase='start'
            elif next_phase=='work' and self.phase=='start':self.phase='work'
        return True
