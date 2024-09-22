const fs = require('fs');
const path = require('path');

// Function to remove all files within a specified folder
async function removeFilesInFolder(folderPath) {
  return new Promise((resolve, reject) => {
    fs.readdir(folderPath, (err, files) => {
      if (err) {
        console.error(`Error reading directory: ${err}`);
        reject(err);
        return;
      }

      // If no files are found, resolve immediately
      if (files.length === 0) {
        console.log('No files found to delete.');
        resolve();
        return;
      }

      // Remove each file asynchronously
      const deletePromises = files.map((file) => {
        const filePath = path.join(folderPath, file);
        return new Promise((resolve, reject) => {
          fs.stat(filePath, (err, stats) => {
            if (err) {
              console.error(`Error checking file status: ${filePath}, ${err}`);
              reject(err);
              return;
            }

            if (stats.isFile()) {
              fs.unlink(filePath, (err) => {
                if (err) {
                  console.error(`Error deleting file: ${filePath}, ${err}`);
                  reject(err);
                } else {
                  console.log(`Deleted file: ${filePath}`);
                  resolve();
                }
              });
            } else {
              // Ignore directories and other types of files
              resolve();
            }
          });
        });
      });

      // Wait for all delete operations to finish
      Promise.all(deletePromises)
        .then(() => {
          console.log('All files deleted successfully.');
          resolve();
        })
        .catch((error) => {
          console.error('Error deleting files:', error);
          reject(error);
        });
    });
  });
}

// Function to remove files from VideoAudioMix folder
async function removeVideoAudioMix() {
  const folderPath = './VideoAudioMix';
  return removeFilesInFolder(folderPath);
}

// Function to remove files from Videos folder
async function removeVideos() {
  const folderPath = './Videos';
  return removeFilesInFolder(folderPath);
}

export {
  removeVideoAudioMix,
  removeVideos,
};