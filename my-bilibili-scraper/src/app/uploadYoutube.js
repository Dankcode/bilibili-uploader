const { exec } = require('child_process');
const path = require('path');

const PYTHON_SCRIPT_PATH = path.join('../', 'youtube_video_and_thumbnail_uploader.py');

export default function uploadYoutubeVideo(videoPath, title, description) {
    return new Promise((resolve, reject) => {
        exec(`py ${PYTHON_SCRIPT_PATH} "${videoPath}" "${title}" "${description}"`, (error, stdout, stderr) => {
            if (error) {
                return reject(`Error executing the script: ${error.message}`);
            }
33
            if (stderr) {
                return reject(`Error in the script: ${stderr}`);
            }

            try {
                const output = JSON.parse(stdout.trim());
                resolve(output.video_id);
            } catch (parseError) {
                reject(`Error parsing JSON output: ${parseError.message}`);
            }
        });
    });
}