"""Read one text/voice request per line and return a base64 PCM WAV for each passage."""
import base64
import io
import json
import sys
import wave
from contextlib import redirect_stdout

import numpy as np
from paradee import Paradee, SAMPLE_RATE


def render(model, text, voice):
    pcm = np.rint(np.clip(model(text, voice=voice), -1, 1) * 32767).astype("<i2")
    data = io.BytesIO()
    with wave.open(data, "wb") as wav:
        wav.setparams((1, 2, SAMPLE_RATE, 0, "NONE", "not compressed"))
        wav.writeframes(pcm.tobytes())
    return base64.b64encode(data.getvalue()).decode("ascii")


with redirect_stdout(sys.stderr):
    model = Paradee(version="1.3", threads=1)
for line in sys.stdin:
    try:
        with redirect_stdout(sys.stderr):
            request = json.loads(line)
            result = {"wav": render(model, request["text"], request["voice"])}
    except Exception as error:
        result = {"error": str(error)}
    print(json.dumps(result), flush=True)
