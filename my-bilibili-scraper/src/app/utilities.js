import { GM_xmlhttpRequest } from 'some-greasemonkey-package';

const send = (config) => {
  const xhr = new XMLHttpRequest();
  const { isText = true, body } = config(xhr);
  return new Promise((resolve, reject) => {
    xhr.addEventListener('load', () => resolve(isText ? xhr.responseText : xhr.response));
    xhr.addEventListener('error', () => reject(xhr.status));
    xhr.send(body);
  });
};

const withCredentials = (config) => (xhr) => {
  xhr.withCredentials = true;
  return config(xhr);
};

// GET
const blobRequest = (url) => (xhr) => {
  xhr.responseType = 'blob';
  xhr.open('GET', url);
  return {
    isText: false,
  };
};

export const getBlob = (url) => send(blobRequest(url));
export const getBlobWithCredentials = (url) => send(withCredentials(blobRequest(url)));

const textRequest = (url) => (xhr) => {
  xhr.responseType = 'text';
  xhr.open('GET', url);
  return {
    isText: true,
  };
};

export const getText = (url) => send(textRequest(url));
export const getTextWithCredentials = (url) => send(withCredentials(textRequest(url)));

const jsonRequest = (url) => (xhr) => {
  xhr.responseType = 'json';
  xhr.open('GET', url);
  return {
    isText: false,
  };
};

const convertToJson = (response) => {
  if (typeof response === 'string') {
    return JSON.parse(response);
  }
  return response;
};

export const getJson = async (url) => {
  const response = await send(jsonRequest(url));
  return convertToJson(response);
};

export const getJsonWithCredentials = async (url) => {
  const response = await send(withCredentials(jsonRequest(url)));
  return convertToJson(response);
};

// POST
export const postText = (url, text) =>
  send((xhr) => {
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    return {
      isText: false,
      body: text,
    };
  });

export const postTextWithCredentials = (url, text) =>
  send((xhr) => {
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    return {
      isText: false,
      body: text,
    };
  });

export const postJson = (url, json) =>
  send((xhr) => {
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    return {
      isText: false,
      body: JSON.stringify(json),
    };
  });

export const postJsonWithCredentials = (url, json) =>
  send((xhr) => {
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/json');
    return {
      isText: false,
      body: JSON.stringify(json),
    };
  });

export const monkey = (details) =>
  new Promise((resolve, reject) => {
    const fullDetails = {
      nocache: true,
      ...details,
      onload: (r) => resolve(r.response),
      onerror: (r) => {
        const realObject = {
          ...JSON.parse(JSON.stringify(r)),
          toString() {
            return JSON.stringify(this);
          },
        };
        reject(realObject);
      },
    };
    if (!('method' in fullDetails)) {
      fullDetails.method = 'GET';
    }
    GM_xmlhttpRequest(fullDetails);
  });
  
  export const bilibiliApi = async (apiPromise, errorMessage) => {
    const json = await apiPromise;
    if (json.code !== 0) {
      const error = new Error(
        `${errorMessage}: code = ${json.code}, message = ${json.message || json.msg}`
      );
      logError(error);
      throw error;
    }
    return json.data || json.result || {};
  };
  