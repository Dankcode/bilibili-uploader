import React, { useState, useEffect, useRef } from 'react';
import { Form, Input, message } from 'antd';
import { useRouter } from 'next/router';

const MyComponent = () => {
  const [videoInfo, setVideoInfo] = useState({
    title: '',
    qualityOptions: [],
    page: [],
  });
  const [quality, setQuality] = useState(null);
  const router = useRouter();

    const videoInfoList = [];
    const taskInfoList = [];

        let bvId = '';
        
        // Single-episode video
      const dashVideoMap = videoInfo.dashVideoMap;
      const totalSizeMap = videoInfo.totalSizeMap;
      const videoUrl = dashVideoMap[quality];
      const totalSize = totalSizeMap[quality];
      let url = videoUrl;

      if (videoInfo.type === 'BILIBILI') {
        url = videoUrl + '#' + videoInfo.audioUrl;
      }

      const id = md5(videoInfo.title + url);

      videoInfoList.push({
        id,
        title: videoInfo.title,
        type: videoInfo.type,
        fileType: videoInfo.fileType,
        bId: videoInfo.id,
        cId: videoInfo.cId,
        quality,
        totalSize,
        url,
        savePath: downloadPath,
        coverImg: videoInfo.cover,
      });

      taskInfoList.push({
        id,
        title: videoInfo.title,
        savePath: downloadPath,
        coverImg: videoInfo.cover,
        status: 0,
        progress: 0,
        downloadSize: 0,
        totalSize,
        speed: 0,
        msg: '',
      });
    
      if (videoInfoList.length) {
        try {
          const res = await axios.post(api.Api.animeDownload, {
            json: {
              videoInfoList,
              headers: videoInfo.headers,
              // savePath: inputRef.current.value, // Not needed in API call
              responseType: 'json',
            },
          });
    
          const status = res.status;
          if (status === -1) {
            message.error('下载出现错误');
          }
        } catch (error) {
          console.error('Error downloading video:', error);
          message.error('下载出现错误'); // Inform user about the error
        }
      }
    
      setConfirmLoading(false);
      router.push('/download'); // Use Next.js router for navigation
    };
    
    const handleCancel = () => {
      setVisible(false); // Assuming you have a visible state for the modal
      setConfirmLoading(false);
      setQuality(null);
      setSelected([]);
    };
    
    const toggle = (page) => {
      const index = selected.indexOf(page);
      if (index === -1) {
        setSelected([...selected, page]);
      } else {
        setSelected([...selected.slice(0, index), ...selected.slice(index + 1)]);
      }
    // Handle saving tasks and triggering download (implement your API call here)

    setConfirmLoading(false);
    router.push('/download'); // Route to download page

  };
