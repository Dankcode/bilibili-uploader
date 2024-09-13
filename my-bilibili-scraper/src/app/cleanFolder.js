const fs = require('fs');
const path = require('path');

async function removeVideoAudioMix() {
  const folderPath = './VideoAudioMix';
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
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error(`Error deleting file: ${filePath}, ${err}`);
              reject(err);
            } else {
              console.log(`Deleted file: ${filePath}`);
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

async function removeVideos() {
  folderPath = './Videos'
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
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error(`Error deleting file: ${filePath}, ${err}`);
              reject(err);
            } else {
              console.log(`Deleted file: ${filePath}`);
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

export {
  removeVideoAudioMix,
  removeVideos,
}