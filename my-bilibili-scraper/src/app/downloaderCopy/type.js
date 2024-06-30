export const SettingData = {
  downloadPath: '',
  SESSDATA: '',
  isMerge: true,
  isDelete: true,
  bfeId: '',
  isSubtitle: true,
  isDanmaku: true,
  isFolder: true,
  isCover: true,
  downloadingMaxSize: 5,
};

export const SettingDataEasy = {
  downloadPath: '',
  SESSDATA: '',
  isMerge: true,
  isDelete: true,
  bfeId: '',
  isSubtitle: true,
  isDanmaku: true,
  isFolder: true,
  downloadingMaxSize: 5,
};

export const LoginStatus = {
  visitor: 0,
  user: 1,
  vip: 2,
};

export const UP = {
  name: '',
  mid: 0,
};

export const QualityItem = {
  label: '',
  value: 0,
};

export const Page = {
  title: '',
  url: '',
  bvid: '',
  cid: 0,
  duration: '',
  page: 0,
};

export const Subtitle = {
  title: '',
  url: '',
};

export const Video = {
  id: 0,
  cid: 0,
  url: '',
};

export const Audio = {
  id: 0,
  cid: 0,
  url: '',
};

export const DownloadUrl = {
  video: '',
  audio: '',
};

export const VideoData = {
  id: '',
  title: '',
  url: '',
  bvid: '',
  cid: 0,
  cover: '',
  createdTime: 0,
  quality: 0,
  view: 0,
  danmaku: 0,
  reply: 0,
  duration: '',
  up: [],
  qualityOptions: [],
  page: [],
  subtitle: [],
  video: [],
  audio: [],
  filePathList: [],
  fileDir: '',
  size: 0,
  downloadUrl: {
    video: '',
    audio: '',
  },
};

export const TaskData = {
  ...VideoData,
  status: 0,
  progress: 0,
};

export const TaskList = new Map();
