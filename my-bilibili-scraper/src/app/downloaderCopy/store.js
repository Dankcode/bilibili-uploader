import create from 'zustand';
import { taskData } from './default';

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

// Setting Store
export const useSettingStore = create((set) => ({
  downloadPath: '',
  SESSDATA: '42e74d36%2C1734950611%2C1c25d%2A61CjDHJF62m-9BH_eDmCkxnpR2YIV0-rtAasnOU3KAAFEKK-1K6csAQJ-mYVK8MO-Xy4kSVkJNN3M3OGNxS1B0TjlUTllIekRFUmhIdWhxUnVreWxhN3l3SFlPUm1Ub29FZEhoOVBjWlk3RV8wM0NqOUZsRUN2V2NtSFpNaEk2SzQxMEhRcWlJdHN3IIEC',
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

// Task Store

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
// Export Stores