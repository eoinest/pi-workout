import unittest
from types import SimpleNamespace
from exercises import create_counter,EXERCISES

ANGLES={'curls':(155,65),'pullups':(155,80),'pushups':(155,100),'squats':(160,100),'situps':(150,100)}

def pose(exercise,work=False):
    p=[SimpleNamespace(x=0,y=0,visibility=0) for _ in range(33)]
    if exercise=='pushups':
        values=[(.25,.5),(.25,.65),(.4,.65),(.55,.5),(.7,.5),(.9,.5)] if work else [(.25,.25),(.25,.45),(.25,.65),(.55,.25),(.7,.25),(.9,.25)]
    elif exercise=='curls':
        values=[(.5,.2),(.5,.45),(.6,.25) if work else (.5,.7),(.5,.7),(.5,.85),(.5,1)]
    elif exercise=='pullups':
        values=[(.5,.25),(.65,.3),(.55,.13),(.5,.7),(.5,.85),(.5,1)] if work else [(.5,.45),(.5,.3),(.5,.1),(.5,.7),(.5,.85),(.5,1)]
    elif exercise=='squats':
        values=[(.32,.28),(.3,.4),(.3,.5),(.3,.55),(.55,.55),(.55,.9)] if work else [(.5,.1),(.5,.2),(.5,.3),(.5,.4),(.5,.65),(.5,.9)]
    else:
        values=[(.5,.5) if work else (.2,.8),(.3,.6),(.3,.5),(.5,.8),(.7,.6),(.9,.8)]
    for i,(x,y) in zip([11,13,15,23,25,27],values):p[i]=SimpleNamespace(x=x,y=y,visibility=.95)
    return p

def counter(exercise):
    up,down=ANGLES[exercise]
    return create_counter({'exercise':exercise,'confidence':.65,'upAngle':up,'downAngle':down,'holdMs':180})

class ExerciseTest(unittest.TestCase):
    def test_all_five_full_cycles_count_once_and_holds_do_not_repeat(self):
        self.assertEqual(set(EXERCISES),set(ANGLES))
        for exercise in EXERCISES:
            with self.subTest(exercise=exercise):
                c=counter(exercise)
                for work,times in [(False,[0,200,400]),(True,[600,800,1000]),(False,[1200,1400,1600,1800])]:
                    for t in times:self.assertTrue(c.update(pose(exercise,work),t))
                self.assertEqual(c.count,1)
    def test_starting_in_work_pose_does_not_count_partial_rep(self):
        for exercise in EXERCISES:
            with self.subTest(exercise=exercise):
                c=counter(exercise)
                for work,t in [(True,0),(True,200),(False,400),(False,600)]:c.update(pose(exercise,work),t)
                self.assertEqual(c.count,0)
    def test_short_jitter_does_not_count(self):
        for exercise in EXERCISES:
            with self.subTest(exercise=exercise):
                c=counter(exercise)
                for work,t in [(False,0),(False,200),(True,250),(False,300),(False,500)]:c.update(pose(exercise,work),t)
                self.assertEqual(c.count,0)
    def test_lost_tracking_and_low_confidence_reject_completion(self):
        for exercise in EXERCISES:
            with self.subTest(exercise=exercise):
                c=counter(exercise)
                for work,t in [(False,0),(False,200),(True,400),(True,600)]:c.update(pose(exercise,work),t)
                hidden=pose(exercise);hidden[11].visibility=.1
                self.assertFalse(c.update(hidden,700));c.update(None,1500)
                c.update(pose(exercise),1700);c.update(pose(exercise),1900)
                self.assertEqual(c.count,0)
    def test_wrong_body_orientation_is_rejected(self):
        self.assertIsNone(counter('curls').measure_pose(pose('pullups')))
        self.assertIsNone(counter('pullups').measure_pose(pose('curls')))
        self.assertIsNone(counter('pushups').measure_pose(pose('squats')))
        self.assertIsNone(counter('squats').measure_pose(pose('pushups')))
        self.assertIsNone(counter('situps').measure_pose(pose('squats')))
    def test_unsupported_exercise_fails_closed(self):
        with self.assertRaises(ValueError):create_counter({'exercise':'unknown'})

if __name__=='__main__':unittest.main()
