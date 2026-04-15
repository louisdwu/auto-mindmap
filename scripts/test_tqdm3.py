from tqdm import tqdm

duration = 643.5
segments = [600.0, 618.5, 645.0, 650.0]

with tqdm(total=duration, unit="s", desc="Transcribing", bar_format="{l_bar}{bar}| {n:.1f}/{total:.1f}s [{elapsed}<{remaining}]") as pbar:
    last_end = 0
    for seg_end in segments:
        # Clamped logic
        segment_end = min(seg_end, duration)
        pbar.update(segment_end - last_end)
        last_end = segment_end
    
    if last_end < duration:
        pbar.update(duration - last_end)
