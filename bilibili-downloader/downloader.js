import React, { useState, useEffect, useRef } from 'react';
import { List, Card, Progress, Modal, message } from 'antd'; // Import necessary Ant Design components
import { useRouter } from 'next/router';
import fs from 'fs'; // Import fs for file system access (server-side only)

const MyComponent = () => {
  const [taskList, setTaskList] = useState([]);
  const [current, setCurrent] = useState(null);
  const buttonStatusRef = useRef(true); // Use ref for button state

  const router = useRouter();

  useEffect(() => {
    const getTaskList = async () => {
      const storedTasks = localStorage.getItem('taskList') || '[]'; // Use localStorage for task storage
      setTaskList(JSON.parse(storedTasks));
      if (taskList.length) {
        setCurrent(taskList[0]);
      }
    };

    getTaskList();

    const handleProgress = (event, res) => {
      const { data, status, msg } = res.res;
      const index = taskList.findIndex(item => item.id === data.id);
      if (index === -1) return;

      setTaskList(prevTaskList =>
        prevTaskList.map(task =>
          task.id === data.id
            ? {
                ...task,
                status,
                progress: parseInt(data.currentSize / data.totalSize * 100),
                downloadSize: `${(data.currentSize / 1024 / 1024).toFixed(2)}MB`,
                totalSize: `${(data.totalSize / 1024 / 1024).toFixed(2)}MB`,
                speed: `${(data.speed / 1024 / 1024).toFixed(2)}MB/s`,
                msg,
              }
            : task
        )
      );
    };

    window.ipcRenderer.on('download-progress', handleProgress);

    return () => {
      window.ipcRenderer.removeListener('download-progress', handleProgress);
    };
  }, []);

  const openFolder = videoInfo => {
    if (process.env.NODE_ENV === 'development') {
      // Simulate folder opening on development (adjust path as needed)
      console.log(`Opening folder: ${videoInfo.savePath}`);
    } else {
      window.remote.shell.showItemInFolder(videoInfo.savePath); // Use shell for production
    }
  };

  const delDir = async videoInfo => {
    Modal.confirm({
      title: '确认删除任务',
      content: '确定要删除当前任务吗？ (不会删除已下载完成的文件)',
      onOk: async () => {
        const updatedTaskList = taskList.filter(task => task.id !== videoInfo.id);
        setTaskList(updatedTaskList);
        localStorage.setItem('taskList', JSON.stringify(updatedTaskList)); // Update local storage

        // Implement API call to cancel download on server (if applicable)

        message.success('删除成功');
      },
      onCancel() {
        console.log('Cancel deletion');
      },
    });
  };

  const pause = videoInfo => {
    if (!buttonStatusRef.current) return;
    buttonStatusRef.current = false;

    const updatedTaskList = taskList.map(task =>
      task.id === videoInfo.id
        ? { ...task, status: 2, speed: 0, msg: '' } // Update status and speed
        : task
    );

    setTaskList(updatedTaskList);
    localStorage.setItem('taskList', JSON.stringify(updatedTaskList));

    // Implement API call to pause download on server (if applicable)

    buttonStatusRef.current = true;
  };

  const resume = videoInfo => {
    if (!buttonStatusRef.current) return;
    buttonStatusRef.current = false;

    const updatedTaskList = taskList.map(task =>
      task.id === videoInfo.id
        ? { ...task, status: 0, speed: 0, msg: '' } // Update status and speed
        : task
    );

    setTaskList(updatedTaskList);
    localStorage.setItem('taskList', JSON.stringify(updatedTaskList));
  }
  const getVideoSize = async (videoInfo) => {
    if (process.env.NODE_ENV === 'development') {
      return; // Simulate video size retrieval on development (adjust logic as needed)
    }

    try {
      const setting = JSON.parse(localStorage.getItem('setting')) || {};
      const filePath = `${setting.downloadPath}/${videoInfo.title}-${videoInfo.id}/${videoInfo.title}.mp4`;
      const stats = await fs.promises.stat(filePath);
      const size = `${(stats.size / 1024 / 1024).toFixed(2)}MB`;

      setTaskList(prevTaskList =>
        prevTaskList.map(task =>
          task.id === videoInfo.id ? { ...task, size } : task
        )
      );
    } catch (error) {
      console.error('Error getting video size:', error);
    }
  };

  return (
    <div>
      {/* Your JSX to render the download task list and details */}
    </div>
  );
};

export default MyComponent;
    // Implement API call to resume download on server (if applicable)