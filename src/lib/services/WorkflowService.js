import fs from 'fs';
import {
  addVideo, getDueUploads, getValidUploadSearch, logError, updateVideoMetadata, updateVideoStatus,
} from '../db/sqlite';
import { getEnglishData } from '../ai/getEnglish';
import { createJob } from '../pipeline/pipeline';
import Scraper from '../video/scraper';

const DEFAULT_DESC = "Hi, my name is, nice to meet you! I'm an ASMR artist and I hope you like it here. These videos are made to help you relax and sleep.";

function stripJsonFence(value) {
  const text = String(value || '').trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) return fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function validateMetadata(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('AI metadata is not an object.');
  if (typeof payload.Title !== 'string' || !payload.Title.trim()) throw new Error('AI metadata is missing Title.');
  if (typeof payload.Description !== 'string' || !payload.Description.trim()) throw new Error('AI metadata is missing Description.');
  if (!Array.isArray(payload.Tags)) throw new Error('AI metadata Tags must be an array.');
  return {
    title: payload.Title.trim(),
    description: payload.Description.trim(),
    tags: payload.Tags.map((tag) => String(tag).trim()).filter(Boolean),
  };
}

function parseTags(tags) {
  if (Array.isArray(tags)) return tags;
  try {
    const parsed = JSON.parse(tags || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(tags || '').split(/[,\s]+/).filter(Boolean);
  }
}

async function ensureMetadata(video) {
  if (video.english_name && video.english_description) {
    return { title: video.english_name, description: video.english_description, tags: parseTags(video.tags) };
  }
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await getEnglishData(video.chinese_name, video.chinese_description || DEFAULT_DESC);
      const metadata = validateMetadata(JSON.parse(stripJsonFence(raw)));
      updateVideoMetadata(video.id, {
        english_name: metadata.title,
        english_description: metadata.description,
        tags: metadata.tags,
      });
      return metadata;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`AI metadata was invalid after retry: ${lastError?.message || 'unknown error'}`);
}

export class WorkflowService {
  constructor(spaceId) {
    this.spaceId = spaceId;
  }

  static async checkAllDueUploads() {
    const jobs = [];
    for (const video of getDueUploads()) {
      try {
        jobs.push(await new WorkflowService(video.space_id).processSpecificVideo(video));
      } catch (error) {
        console.error(`[Workflow] Failed to queue due video ${video.id}:`, error.message);
      }
    }
    return jobs;
  }

  async execute() {
    let video = getValidUploadSearch(this.spaceId);
    if (!video && this.spaceId) {
      const pageUrl = `https://space.bilibili.com/${this.spaceId}/video?tid=0&pn=1&keyword=&order=pubdate`;
      const scraped = await Scraper(pageUrl);
      for (const item of scraped) {
        addVideo({
          space_id: this.spaceId,
          chinese_name: item.name,
          bilibili_url: item.link,
        });
      }
      video = getValidUploadSearch(this.spaceId);
    }
    if (!video) return null;
    return this.processSpecificVideo(video);
  }

  async processSpecificVideo(video, force = false) {
    if (!force && video.auto_upload_time && new Date() < new Date(video.auto_upload_time)) return null;
    try {
      updateVideoStatus(video.id, 'In progress');
      const metadata = await ensureMetadata(video);
      const editedFileExists = Boolean(video.edited_video_path && fs.existsSync(video.edited_video_path));
      return createJob({
        sourceId: editedFileExists ? 'localFile' : 'bilibili',
        sourceInput: editedFileExists ? video.edited_video_path : video.bilibili_url,
        processorIds: [],
        uploaderId: 'youtube',
        videoRowId: video.id,
        options: {
          youtube: {
            ...metadata,
            privacyStatus: 'private',
          },
        },
      });
    } catch (error) {
      updateVideoStatus(video.id, 'Not started');
      logError(video.id, error.message);
      throw error;
    }
  }
}
