/**
 * FFmpeg helpers for the voiceover pipeline (fluent-ffmpeg — already a dep).
 * Kept isolated so the processor stays declarative and this stays the only
 * place that builds filtergraphs.
 */

import ffmpeg from 'fluent-ffmpeg';

/** Extract a mono 16 kHz WAV suitable for Whisper transcription. */
export function extractAudio(videoPath, outPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('pcm_s16le')
      .format('wav')
      .on('error', (err) => reject(new Error(`Audio extraction failed: ${err.message}`)))
      .on('end', () => resolve(outPath))
      .save(outPath);
  });
}

/** Duration of a media file in seconds (ffprobe). */
export function probeDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(new Error(`ffprobe failed: ${err.message}`));
      resolve(Number(data?.format?.duration) || 0);
    });
  });
}

/**
 * Mix English voiceover clips over the original video.
 *  - the original audio is ducked to `originalVolume` (0..1)
 *  - each clip is delayed to its segment start and amix'd in
 *
 * @param {object} p
 * @param {string} p.videoPath
 * @param {Array<{path:string,start:number}>} p.clips
 * @param {string} p.outPath
 * @param {number} [p.originalVolume=0.15]
 * @param {function} [p.onProgress]
 */
export function mixVoiceover({ videoPath, clips, outPath, originalVolume = 0.15, onProgress }) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(clips) || clips.length === 0) {
      return reject(new Error('mixVoiceover requires at least one voiceover clip.'));
    }
    const cmd = ffmpeg(videoPath);
    clips.forEach((clip) => cmd.input(clip.path));

    const filters = [`[0:a]volume=${originalVolume}[bg]`];
    const mixLabels = ['[bg]'];
    clips.forEach((clip, i) => {
      const ms = Math.max(0, Math.round((clip.start || 0) * 1000));
      const inLabel = `${i + 1}:a`;
      const outLabel = `d${i}`;
      filters.push(`[${inLabel}]adelay=${ms}|${ms}[${outLabel}]`);
      mixLabels.push(`[${outLabel}]`);
    });
    filters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:normalize=0:dropout_transition=0[mix]`);

    cmd
      .complexFilter(filters)
      .outputOptions(['-map', '0:v', '-map', '[mix]', '-c:v', 'copy', '-shortest'])
      .on('progress', (p) => onProgress && onProgress(p))
      .on('error', (err) => reject(new Error(`Voiceover mix failed: ${err.message}`)))
      .on('end', () => resolve(outPath))
      .save(outPath);
  });
}

/** Burn a subtitle file into the video (re-encodes video). */
export function burnSubtitles(videoPath, srtPath, outPath) {
  return new Promise((resolve, reject) => {
    const escaped = String(srtPath).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
    ffmpeg(videoPath)
      .videoFilters(`subtitles='${escaped}'`)
      .outputOptions(['-c:a', 'copy'])
      .on('error', (err) => reject(new Error(`Subtitle burn failed: ${err.message}`)))
      .on('end', () => resolve(outPath))
      .save(outPath);
  });
}
