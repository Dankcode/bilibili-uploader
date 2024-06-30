// utils/videoUtils.js
'use client'
import { qualityMap } from './quality';
import { customAlphabet } from 'nanoid';
import { create } from 'zustand'
import axios from 'axios';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15'
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const nanoid = customAlphabet(alphabet, 16);

const formatSecond = (duration) => {
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration - (hours * 3600)) / 60);
  const seconds = Math.floor(duration - (minutes * 60) - (hours * 3600));
  return `${hours > 9 ? hours : '0' + hours}:${minutes > 9 ? minutes : '0' + minutes}:${seconds > 9 ? seconds : '0' + seconds}`;
};

const sleep = (timeoutMS) => new Promise((resolve) => {
  setTimeout(resolve, timeoutMS);
});

const getHighQualityAudio = (audioList) => {
  // Implement your logic for getting high-quality audio
};

const handleFilePathList = (pageIndex, title, upName, bvid, taskId) => {
  // Implement your logic for handling file paths
};

const handleFileDir = (pageIndex, title, upName, bvid, taskId) => {
  // Implement your logic for handling file directories
};

const getDownloadUrl = async (cid, bvid, quality) => {
  const SESSDATA = useSettingStore.getState().SESSDATA;
  const bfeId = useSettingStore.getState().bfeId;
  const config = {
    headers: {
      'User-Agent': `${UA}`,
      cookie: `SESSDATA=${SESSDATA};bfe_id=${bfeId}`
    },
    responseType: 'json'
  };
  const response = await fetch(
    `https://api.bilibili.com/x/player/playurl?cid=${cid}&bvid=${bvid}&qn=${quality}&type=&otype=json&fourk=1&fnver=0&fnval=80&session=68191c1dc3c75042c6f35fba895d65b0`,
    config
  );
  saveResponseCookies(response.headers['set-cookie']);
  return {
    video: response.body.data.dash.video[0].baseUrl,
    audio: response.body.data.dash.audio[0].baseUrl
  };
};

const saveResponseCookies = (responseCookies) => {
  const cookies = responseCookies.map(item => item.split(';')[0]);
  if (cookies.length) {
    const cookiesString = cookies.join(';');
    useSettingStore.getState().setBfeId(cookiesString);
  }
};

const handleRequestError = (error) => {
  useSnackbarStore.getState().setError(true);
  useSnackbarStore.getState().setMessage(error.message);
};

export const useBaseStore = create((set) => ({
  loginStatus: 0, // 0: guest, 1: regular user, 2: VIP
  downloadingTaskCount: 0,
  allowLogin: true,
  setLoginStatus: (status) => set({ loginStatus: status }),
  setDownloadingTaskCount: (num) => set({ downloadingTaskCount: num }),
  reduceDownloadingTaskCount: (count) =>
    set((state) => ({
      downloadingTaskCount: state.downloadingTaskCount - count,
    })),
  addDownloadingTaskCount: (count) =>
    set((state) => ({
      downloadingTaskCount: state.downloadingTaskCount + count,
    })),
  setAllowLogin: (flag) => set({ allowLogin: flag }),
}));

export const useSettingStore = create((set) => ({
  downloadPath: '',
  SESSDATA: '34bf5597%2C1735222183%2C2f83b%2A61CjDAsnWWlBcTtwxeAhvRFgXvSZjO-g9qTqu1uuUgWPBDrUl9J_G2Ya8-xNVLXRFRf30SVmpCaHFzNVpPaVZIaTVLbTN4eFcxSERCVEU1WFJuVE83bEJVa1dDaG43OFVqOHFvOUd0M3JoT0k5WUpvZXJqU2xUcmFGVmVXTWtiRjNWaVN5SWdaM2N3IIEC',
  isMerge: true,
  isDelete: true,
  bfeId: '',
  isSubtitle: true,
  isDanmaku: true,
  isFolder: true,
  isCover: true,
  downloadingMaxSize: 5,
  setDownloadPath: (path) => {
    set({ downloadPath: path });
    window.electron.setStore('setting.downloadPath', path);
  },
  setSESSDATA: (SESSDATA) => {
    set({ SESSDATA });
    window.electron.setStore('setting.SESSDATA', SESSDATA);
  },
  setIsMerge: (data) => {
    set({ isMerge: data });
    window.electron.setStore('setting.isMerge', data);
  },
  setIsDelete: (data) => {
    set({ isDelete: data });
    window.electron.setStore('setting.isDelete', data);
  },
  setBfeId: (bfeId) => {
    set({ bfeId });
    window.electron.setStore('setting.bfeId', bfeId);
  },
  setIsSubtitle: (data) => {
    set({ isSubtitle: data });
    window.electron.setStore('setting.isSubtitle', data);
  },
  setIsDanmaku: (data) => {
    set({ isDanmaku: data });
    window.electron.setStore('setting.isDanmaku', data);
  },
  setIsFolder: (data) => {
    set({ isFolder: data });
    window.electron.setStore('setting.isFolder', data);
  },
  setIsCover: (data) => {
    set({ isCover: data });
    window.electron.setStore('setting.isCover', data);
  },
  setDownloadingMaxSize: (size) => {
    set({ downloadingMaxSize: size });
    window.electron.setStore('setting.downloadingMaxSize', size);
  },
  setSetting: (setting) => {
    set((state) => {
      const updatedSettings = { ...state, ...setting };
      window.electron.setStore('setting', updatedSettings);
      return updatedSettings;
    });
  },
}));

export const useTaskStore = create((set) => ({
  taskList: new Map(),
  rightTaskId: '',
  setTaskList: (taskList) => set({ taskList }),
  getTask: (id) => (state) => state.taskList.get(id),
  setTask: (taskList) => {
    taskList.forEach((task) => {
      set((state) => {
        state.taskList.set(task.id, task);
        window.electron.setStore(`taskList.${task.id}`, task);
        return { taskList: state.taskList };
      });
    });
  },
  setTaskEasy: (taskList) => {
    taskList.forEach((task) => {
      set((state) => {
        state.taskList.set(task.id, task);
        return { taskList: state.taskList };
      });
    });
  },
  deleteTask: (list) => {
    list.forEach((id) => {
      set((state) => {
        state.taskList.delete(id);
        window.electron.deleteStore(`taskList.${id}`);
        return { taskList: state.taskList };
      });
    });
  },
  has: (id) => (state) => state.taskList.has(id),
  setRightTaskId: (id) => set({ rightTaskId: id }),
  rightTask: (state) => {
    const task = state.taskList.get(state.rightTaskId);
    return task ? task : taskData;
  },
  taskListArray: (state) => Array.from(state.taskList),
}));

export const useSnackbarStore = create((set) => ({
  error: false,
  message: '',
  setError: (flag) => set({ error: flag }),
  setMessage: (msg) => set({ message: msg }),
}));
const getDownloadList = async (videoInfo, selected, quality) => {
  const downloadList = [];
  for (let index = 0; index < selected.length; index++) {
    const currentPage = selected[index];
    const currentPageData = videoInfo.page.find(item => item.page === currentPage);
    if (!currentPageData) throw new Error('获取视频下载地址错误');
    const currentCid = currentPageData.cid;
    const currentBvid = currentPageData.bvid;

    const downloadUrl = { video: '', audio: '' };
    const videoUrl = videoInfo.video.find(item => item.id === quality && item.cid === currentCid);
    const audioUrl = getHighQualityAudio(videoInfo.audio);

    if (videoUrl && audioUrl) {
      downloadUrl.video = videoUrl.url;
      downloadUrl.audio = audioUrl.url;
    } else {
      const { video, audio } = await getDownloadUrl(currentCid, currentBvid, quality);
      downloadUrl.video = video;
      downloadUrl.audio = audio;
    }

    const subtitle = await getSubtitle(currentCid, currentBvid);
    const taskId = nanoid();
    const videoData = {
      ...videoInfo,
      id: taskId,
      title: currentPageData.title,
      url: currentPageData.url,
      quality: quality,
      duration: currentPageData.duration,
      createdTime: +new Date(),
      cid: currentCid,
      bvid: currentBvid,
      downloadUrl,
      filePathList: handleFilePathList(selected.length === 1 ? 0 : currentPage, currentPageData.title, videoInfo.up[0].name, currentBvid, taskId),
      fileDir: handleFileDir(selected.length === 1 ? 0 : currentPage, currentPageData.title, videoInfo.up[0].name, currentBvid, taskId),
      subtitle
    };
    downloadList.push(videoData);
    if (index !== selected.length - 1) {
      await sleep(1000);
    }
  }
  return downloadList;
};

const addDownload = (videoList) => {
  const allowDownloadCount = useSettingStore.getState().downloadingMaxSize - useBaseStore.getState().downloadingTaskCount;
  const taskList = [];
  if (allowDownloadCount >= 0) {
    videoList.forEach((item, index) => {
      if (index < allowDownloadCount) {
        taskList.push({
          ...item,
          status: 1,
          progress: 0
        });
      } else {
        taskList.push({
          ...item,
          status: 4,
          progress: 0
        });
      }
    });
  }
  return taskList;
};



const checkUrl = (url) => {
  const mapUrl = {
    'video/av': 'BV',
    'video/BV': 'BV',
    'play/ss': 'ss',
    'play/ep': 'ep'
  };
  for (const key in mapUrl) {
    if (url.includes(key)) {
      return mapUrl[key];
    }
  }
  return '';
};
// try {
//   const config = {
//     headers: {
//       'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15',
//       cookie: `SESSDATA=34bf5597%2C1735222183%2C2f83b%2A61CjDAsnWWlBcTtwxeAhvRFgXvSZjO-g9qTqu1uuUgWPBDrUl9J_G2Ya8-xNVLXRFRf30SVmpCaHFzNVpPaVZIaTVLbTN4eFcxSERCVEU1WFJuVE83bEJVa1dDaG43OFVqOHFvOUd0M3JoT0k5WUpvZXJqU2xUcmFGVmVXTWtiRjNWaVN5SWdaM2N3IIEC`
//     }
//   };
//   const body = await axios.get('https://www.bilibili.com/video/BV1wz4y1F7Vc', config);
//   return console.log(body);
// } catch (error) {
//   setLoading(false);
//   alert(`解析错误：${error}`);
// }
const checkUrlRedirect = async (videoUrl) => {
  const SESSDATA = useSettingStore.getState().SESSDATA;
  const config = {
    headers: {
      'User-Agent': `${UA}`,
      cookie: `SESSDATA=34bf5597%2C1735222183%2C2f83b%2A61CjDAsnWWlBcTtwxeAhvRFgXvSZjO-g9qTqu1uuUgWPBDrUl9J_G2Ya8-xNVLXRFRf30SVmpCaHFzNVpPaVZIaTVLbTN4eFcxSERCVEU1WFJuVE83bEJVa1dDaG43OFVqOHFvOUd0M3JoT0k5WUpvZXJqU2xUcmFGVmVXTWtiRjNWaVN5SWdaM2N3IIEC`
    }
  };
  const body = await axios.get('https://www.bilibili.com/video/BV1wz4y1F7Vc', config);
  const url = redirectUrls[0] ? redirectUrls[0] : videoUrl;
  return console.log(body)
};

const parseHtml = (html, type, url) => {
      return parseBV(html, url);
};

const parseBV = async (html, url) => {
  try {
    const videoInfo = html.match(/<\/script><script>window\.__INITIAL_STATE__=([\s\S]*?);\(function\(\)/);
    console.log(videoInfo)
    if (!videoInfo) throw new Error('parse bv error');
    const { videoData } = JSON.parse(videoInfo[1]);

    let acceptQuality = null;
    try {
      let downLoadData = html.match(/<script>window\.__playinfo__=([\s\S]*?)<\/script><script>window\.__INITIAL_STATE__=/);
      console.log(downLoadData)
      if (!downLoadData) throw new Error('parse bv error');
      downLoadData = JSON.parse(downLoadData[1]);
      acceptQuality = {
        accept_quality: downLoadData.data.accept_quality,
        video: downLoadData.data.dash.video,
        audio: downLoadData.data.dash.audio
      };
    } catch (error) {
      acceptQuality = await getAcceptQuality(videoData.cid, videoData.bvid);
    }

    const obj = {
      id: '',
      title: videoData.title,
      url,
      bvid: videoData.bvid,
      cid: videoData.cid,
      cover: videoData.pic,
      createdTime: -1,
      quality: -1,
      view: videoData.stat.view,
      danmaku: videoData.stat.danmaku,
      reply: videoData.stat.reply,
      duration: formatSecond(videoData.duration),
      up: videoData.hasOwnProperty('staff') ? videoData.staff.map(item => ({ name: item.name, mid: item.mid })) : [{ name: videoData.owner.name, mid: videoData.owner.mid }],
      qualityOptions: acceptQuality.accept_quality.map(item => ({ label: qualityMap[item], value: item })),
      page: parseBVPageData(videoData, url),
      subtitle: [],
      video: acceptQuality.video ? acceptQuality.video.map(item => ({ id: item.id, cid: videoData.cid, url: item.baseUrl })) : [],
      audio: acceptQuality.audio ? acceptQuality.audio.map(item => ({ id: item.id, cid: videoData.cid, url: item.baseUrl })) : [],
      filePathList: [],
      fileDir: '',
      size: -1,
      downloadUrl: { video: '', audio: '' }
    };
    return obj;
  } catch (error) {
    throw new Error(error);
  }
};

const parseEP = async (html, url) => {
  try {
    const videoInfo = html.match(/<script>window\.__INITIAL_STATE__=([\s\S]*?);\(function\(\)\{var s;/);
    if (!videoInfo) throw new Error('parse ep error');
    const { h1Title, mediaInfo, epInfo, epList } = JSON.parse(videoInfo[1]);

    let acceptQuality = null;
    try {
      let downLoadData = html.match(/<script>window\.__playinfo__=([\s\S]*?)<\/script><script>window\.__INITIAL_STATE__=/);
      if (!downLoadData) throw new Error('parse ep error');
      downLoadData = JSON.parse(downLoadData[1]);
      acceptQuality = {
        accept_quality: downLoadData.data.accept_quality,
        video: downLoadData.data.dash.video,
        audio: downLoadData.data.dash.audio
      };
    } catch (error) {
      acceptQuality = await getAcceptQuality(epInfo.cid, epInfo.bvid);
    }

    const obj = {
      id: '',
      title: h1Title,
      url,
      bvid: epInfo.bvid,
      cid: epInfo.cid,
      cover: `http:${mediaInfo.cover}`,
      createdTime: -1,
      quality: -1,
      view: mediaInfo.stat.views,
      danmaku: mediaInfo.stat.danmakus,
      reply: mediaInfo.stat.reply,
      duration: formatSecond(epInfo.duration / 1000),
      up: [{ name: mediaInfo.upInfo.name, mid: mediaInfo.upInfo.mid }],
      qualityOptions: acceptQuality.accept_quality.map(item => ({ label: qualityMap[item], value: item })),
      page: parseEPPageData(epList),
      subtitle: [],
      video: acceptQuality.video ? acceptQuality.video.map(item => ({ id: item.id, cid: epInfo.cid, url: item.baseUrl })) : [],
      audio: acceptQuality.audio ? acceptQuality.audio.map(item => ({ id: item.id, cid: epInfo.cid, url: item.baseUrl })) : [],
      filePathList: [],
      fileDir: '',
      size: -1,
      downloadUrl: { video: '', audio: '' }
    };
    return obj;
  } catch (error) {
    throw new Error(error);
  }
};

const parseSS = async (html) => {
  try {
    const videoInfo = html.match(/<script>window\.__INITIAL_STATE__=([\s\S]*?);\(function\(\)\{var s;/);
    if (!videoInfo) throw new Error('parse ss error');
    const { mediaInfo } = JSON.parse(videoInfo[1]);
    const params = {
      url: `https://www.bilibili.com/bangumi/play/ep${mediaInfo.newestEp.id}`,
      config: {
        headers: {
          'User-Agent': `${UA}`,
          cookie: `SESSDATA=${useSettingStore.getState().SESSDATA}`
        }
      }
    };
    const { body } = await axios.get(params.url, params.config);
    return parseEP(body, params.url);
  } catch (error) {
    throw new Error(error);
  }
};

const getAcceptQuality = async (cid, bvid) => {
  const SESSDATA = useSettingStore.getState().SESSDATA;
  const bfeId = useSettingStore.getState().bfeId;
  const config = {
    headers: {
      'User-Agent': `${UA}`,
      cookie: `SESSDATA=${SESSDATA};bfe_id=${bfeId}`
    },
    responseType: 'json'
  };
  const response = await axios.get(
    `https://api.bilibili.com/x/player/playurl?cid=${cid}&bvid=${bvid}&qn=127&type=&otype=json&fourk=1&fnver=0&fnval=80&session=68191c1dc3c75042c6f35fba895d65b0`,
    config
  );
  saveResponseCookies(response.headers['set-cookie']);
  return {
    accept_quality: response.body.data.accept_quality,
    video: response.body.data.dash.video,
    audio: response.body.data.dash.audio
  };
};

export {
  checkUrl,
  checkUrlRedirect,
  parseHtml,
  getDownloadUrl,
  handleRequestError
};
