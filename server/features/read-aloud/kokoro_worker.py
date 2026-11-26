"""Kokoro-82M (ONNX, CPU): read one text/voice request per line, return a base64 PCM WAV for each.

KOKORO_HOME holds kokoro-v1.0.onnx, voices-v1.0.bin and voice_presets.py (the Emma/Lily blend, Kate in the picker),
set up as in https://github.com/flowstream-kaze/lucia-voice.
"""
import base64
import io
import json
import os
import sys
import time
import wave
from contextlib import redirect_stdout
from pathlib import Path

HOME = Path(os.environ["KOKORO_HOME"])
sys.path.insert(0, str(HOME))

import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402
from kokoro_onnx import Kokoro  # noqa: E402
from voice_presets import resolve_voice  # noqa: E402

# Four threads: measured on an i9-9900K at 0.27-0.30 of real time, against 0.26 with eight,
# and it leaves half the CPU to the model servers.
THREADS = int(os.environ.get("KOKORO_THREADS", "4"))


def load():
    options = ort.SessionOptions()
    options.intra_op_num_threads = THREADS
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(
        str(HOME / "kokoro-v1.0.onnx"), options, providers=["CPUExecutionProvider"]
    )
    return Kokoro.from_session(session, str(HOME / "voices-v1.0.bin"))


styles = {}


def render(engine, text, voice):
    if voice not in styles:
        styles[voice] = resolve_voice(engine, voice)
    # British voices (bf_, bm_ and the Emma/Lily blend) need British phonemes.
    lang = "en-gb" if voice.startswith("b") else "en-us"
    started = time.perf_counter()
    audio, rate = engine.create(text, voice=styles[voice], lang=lang, speed=1.0)
    took = time.perf_counter() - started
    seconds = len(audio) / rate
    print(
        f"[read-aloud] kokoro {voice}: {len(text)} chars, {seconds:.1f} s of audio in {took:.2f} s"
        f" ({seconds / took:.1f}x real time)",
        file=sys.stderr,
        flush=True,
    )
    pcm = np.rint(np.clip(np.asarray(audio), -1, 1) * 32767).astype("<i2")
    data = io.BytesIO()
    with wave.open(data, "wb") as wav:
        wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        wav.writeframes(pcm.tobytes())
    return base64.b64encode(data.getvalue()).decode("ascii")


with redirect_stdout(sys.stderr):
    started = time.perf_counter()
    engine = load()
    engine.create("Ready.", voice="af_heart", lang="en-us")
    print(f"[read-aloud] kokoro loaded in {time.perf_counter() - started:.1f} s, {THREADS} threads",
          file=sys.stderr, flush=True)
for line in sys.stdin:
    try:
        with redirect_stdout(sys.stderr):
            request = json.loads(line)
            result = {"wav": render(engine, request["text"], request["voice"])}
    except Exception as error:
        result = {"error": str(error)}
    print(json.dumps(result), flush=True)
