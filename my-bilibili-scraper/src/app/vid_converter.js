const { spawn } = require('child_process');

const convertVideo = async (req, res) => {
  try {
    const { videoPath } = req.body; // Replace with actual data source (e.g., form field)

    const outputPath = `converted/${videoPath.split('/').pop()}.mp4`; // Generate output filename

    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath,
      '-c:v libx264', // Specify output video codec (MP4)
      outputPath,
    ]);

    ffmpeg.on('error', (err) => {
      console.error(err);
      res.status(500).json({ error: 'Conversion failed' });
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        res.status(200).json({ success: true });
      } else {
        res.status(500).json({ error: 'Conversion failed' });
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Conversion failed' });
  }
};

module.exports = { convertVideo }; // Export functions