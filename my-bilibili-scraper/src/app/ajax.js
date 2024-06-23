import axios from 'axios';

// Utility functions using Axios
const sendRequest = async (url, config) => {
  try {
    const response = await axios(url, config);
    return response.data;
  } catch (error) {
    throw new Error(`Request failed: ${error}`);
  }
};

// GET Blob
export const getBlob = (url) => sendRequest(url, { responseType: 'blob' });
export const getBlobWithCredentials = (url) => sendRequest(url, { responseType: 'blob', withCredentials: true });

// GET Text
export const getText = (url) => sendRequest(url, { responseType: 'text' });
export const getTextWithCredentials = (url) => sendRequest(url, { responseType: 'text', withCredentials: true });

// GET JSON
export const getJson = async (url) => sendRequest(url, { responseType: 'json' });
export const getJsonWithCredentials = async (url) => sendRequest(url, { responseType: 'json', withCredentials: true });

// POST Text
export const postText = (url, text) => sendRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data: text });
export const postTextWithCredentials = (url, text) => sendRequest(url, { method: 'POST', withCredentials: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data: text });

// POST JSON
export const postJson = (url, json) => sendRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: json });
export const postJsonWithCredentials = (url, json) => sendRequest(url, { method: 'POST', withCredentials: true, headers: { 'Content-Type': 'application/json' }, data: json });

// Handle Bilibili API standard response
export const bilibiliApi = async (apiPromise, errorMessage) => {
  const json = await apiPromise;
  if (json.code !== 0) {
    const error = new Error(`${errorMessage}: code = ${json.code}, message = ${json.message || json.msg}`);
    console.error(error);
    throw error;
  }
  return json.data || json.result || {};
};