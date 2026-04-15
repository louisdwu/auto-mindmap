from tqdm import tqdm
import time

duration = 643.5
try:
    with tqdm(total=duration, unit="s", desc="Transcribing", bar_format="{l_bar}{bar}| {n:.1f}/{total:.1f}s [{elapsed}<{remaining}]") as pbar:
        pbar.update(618.5)
        time.sleep(0.5)
        raise ValueError("Simulated error in generator")
except Exception as e:
    import traceback
    traceback.print_exc()
