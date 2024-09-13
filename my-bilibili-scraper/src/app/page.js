'use client';
import { useState } from 'react';

export default function Home() {
  const [videoFile, setVideoFile] = useState(null);
  const [audioFile, setAudioFile] = useState(null);
  const [mergedVideoUrl, setMergedVideoUrl] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleFileChange = (e) => {
    if (e.target.name === 'video') {
      setVideoFile(e.target.files[0]);
    } else if (e.target.name === 'audio') {
      setAudioFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!videoFile || !audioFile) {
      alert('Please upload both video and audio files.');
      return;
    }

    const formData = new FormData();
    formData.append('video', videoFile);
    formData.append('audio', audioFile);

    setLoading(true);

    try {
      const response = await fetch('./api/bilibili', {
        method: 'POST',
        body: formData,
      });
      console.log(formData)
      if (response.ok) {
        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        setMergedVideoUrl(downloadUrl);
      } else {
        const data = await response.json();
        alert('Merging failed: ' + data.error);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('An error occurred while merging the files.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Merge Video and Audio</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="video">Video File:</label>
          <input type="file" name="video" accept="video/*" onChange={handleFileChange} />
        </div>
        <div>
          <label htmlFor="audio">Audio File:</label>
          <input type="file" name="audio" accept="audio/*" onChange={handleFileChange} />
        </div>
        <button type="submit">Merge Files</button>
      </form>
      {loading && <p>Merging files, please wait...</p>}
      {mergedVideoUrl && (
        <div>
          <h2>Merged Video</h2>
          <video src={mergedVideoUrl} controls></video>
          <a href={mergedVideoUrl} download="merged-video.mp4">Download Merged Video</a>
        </div>
      )}
    </div>
  );
}