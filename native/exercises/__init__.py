from .curls import CurlCounter
from .pullups import PullupCounter
from .pushups import PushupCounter
from .squats import SquatCounter
from .situps import SitupCounter

# Each counter implements update(points, timestamp_ms), count and guidance.
EXERCISES={
    'curls':CurlCounter,
    'pullups':PullupCounter,
    'pushups':PushupCounter,
    'squats':SquatCounter,
    'situps':SitupCounter,
}

def create_counter(settings):
    exercise=EXERCISES.get(settings['exercise'])
    if exercise is None:raise ValueError('Unsupported exercise: '+settings['exercise'])
    return exercise(settings['confidence'],settings['upAngle'],settings['downAngle'],settings['holdMs'])
