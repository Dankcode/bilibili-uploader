import { getValidUploadSearch, updateVideoStatus, updateVideoMetadata, finalizeUpload, logError, addVideo, getDueUploads } from '../db/sqlite';
import { getEnglishData } from '../ai/getEnglish';
import { processBilibiliUrl } from '../video/bilibili';
import Scraper from '../video/scraper';
import UploadVideo from '../video/uploader';
import path from 'path';
import fs from 'fs';

const DEFAULT_DESC = "Hi, my name is, nice to meet you! I'm an ASMR artist and I hope you like it here ⸜(｡ &gt; ᵕ &lt; )⸝♡ An autonomous sensory meridian response (ASMR) is a tingling sensation that usually begins on the scalp and moves down the back of the neck and upper spine. A pleasant form of paresthesia, it has been compared with auditory-tactile synesthesia and may overlap with frisson. DISCLAIMER! The only purpose of my videos is to help you fall asleep and nothing more, let's respect each other and I'm sure we'll become friends (づ๑•ᴗ•๑)づ♡";

function stripJsonFence(value) {
  const text = String(value || '').trim();
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) return fenceMatch[1].trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) return text.slice(firstBrace, lastBrace + 1);
  return text;
}

function validateMetadataPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('AI metadata is not an object');
  if (typeof payload.Title !== 'string' || !payload.Title.trim()) throw new Error('AI metadata is missing Title');
  if (typeof payload.Description !== 'string' || !payload.Description.trim()) throw new Error('AI metadata is missing Description');
  if (!Array.isArray(payload.Tags)) throw new Error('AI metadata Tags must be an array');
  return {
    Title: payload.Title.trim(),
    Description: payload.Description.trim(),
    Tags: payload.Tags.map((tag) => String(tag).trim()).filter(Boolean),
  };
}

function parseStoredTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.map((tag) => String(tag).trim()).filter(Boolean) : [];
  } catch {
    return String(tags).split(/[,\s]+/).map((tag) => tag.trim()).filter(Boolean);
  }
}

/**
 * Main Workflow Service to handle the entire video processing lifecycle using SQLite.
 */
export class WorkflowService {
  constructor(spaceId) {
    this.spaceId = spaceId; // Now specifically bound to a spaceId from the tabs
  }

  async runWithRetry(retries = 4, delay = 600000) {
    let attempts = 0;
    while (attempts < retries) {
      try {
        console.log(`[Workflow] Space ${this.spaceId}: Starting attempt ${attempts + 1}...`);
        await this.execute();
        console.log(`[Workflow] Space ${this.spaceId}: Completed successfully.`);
        return;
      } catch (error) {
        attempts++;
        console.error(`[Workflow] Space ${this.spaceId}: Attempt ${attempts} failed:`, error.message);
        if (attempts >= retries) throw error;
        console.log(`[Workflow] Space ${this.spaceId}: Retrying in ${delay / 60000} minutes...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  /**
   * Run check for ALL spaces to find due uploads on startup.
   */
  static async checkAllDueUploads() {
    console.log('[Workflow] Checking for due scheduled uploads across all spaces...');
    const dueVideos = getDueUploads();
    if (dueVideos.length === 0) {
      console.log('[Workflow] No scheduled uploads due at this time.');
      return;
    }

    for (const vid of dueVideos) {
      console.log(`[Workflow] Found due video: ${vid.chinese_name} (Space: ${vid.space_id})`);
      const service = new WorkflowService(vid.space_id);
      // Run the specific video upload logic (could be optimized)
      try {
        await service.processSpecificVideo(vid);
      } catch (err) {
        console.error(`[Workflow] Failed due upload for ${vid.id}:`, err.message);
      }
    }
  }

  async execute() {
    let currentVideo = null;
    try {
      // 1. Check for pending uploads in SQLite for THIS space
      currentVideo = await getValidUploadSearch(this.spaceId);

      // 2. If nothing pending, scrape Bilibili for new videos for THIS space
      if (!currentVideo && this.spaceId) {
        console.log(`[Workflow] Space ${this.spaceId}: No pending uploads. Scraping Bilibili...`);
        const pageUrl = `https://space.bilibili.com/${this.spaceId}/video?tid=0&pn=1&keyword=&order=pubdate`;
        const scrapedVideos = await Scraper(pageUrl);
        
        for (const vid of scrapedVideos) {
          addVideo({
            space_id: this.spaceId,
            chinese_name: vid.name,
            bilibili_url: vid.link
          });
        }
        
        currentVideo = await getValidUploadSearch(this.spaceId);
      }

      if (!currentVideo) {
        console.log(`[Workflow] Space ${this.spaceId}: No new content found.`);
        return;
      }

      await this.processSpecificVideo(currentVideo);

    } catch (error) {
      console.error(`[Workflow] Space ${this.spaceId} Execution Error:`, error.message);
      throw error;
    }
  }

  async processSpecificVideo(video, force = false) {
    const { id, chinese_name: chineseName, bilibili_url: bilibiliUrl, auto_upload_time: scheduledTime } = video;

    // Check if it's too early for scheduled upload (unless forced)
    if (!force && scheduledTime) {
      const now = new Date();
      const scheduled = new Date(scheduledTime);
      if (now < scheduled) {
        console.log(`[Workflow] Video ${id} is scheduled for ${scheduledTime}. Current time is ${now.toISOString()}. Skipping.`);
        return;
      }
    }

    if (force) {
      console.log(`[Workflow] FORCE UPLOAD triggered for video ${id}`);
    }

    let finalVideoPath = video.edited_video_path;

    try {
      console.log(`[Workflow] Processing Video ID ${id}: ${chineseName}`);
      await updateVideoStatus(id, 'In progress');

      // 3. AI Metadata Generation (if missing)
      let englishName = video.english_name;
      let englishDesc = video.english_description;
      let tags = parseStoredTags(video.tags);

      if (!englishName) {
        console.log(`[Workflow] Generating AI metadata...`);
        let parsed = null;
        let parseError = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const aiResponse = await getEnglishData(chineseName, DEFAULT_DESC);
            parsed = validateMetadataPayload(JSON.parse(stripJsonFence(aiResponse)));
            parseError = null;
            break;
          } catch (error) {
            parseError = error;
            console.warn(`[Workflow] AI metadata parse attempt ${attempt} failed: ${error.message}`);
          }
        }
        if (!parsed) {
          throw new Error(`AI metadata response was invalid after retry: ${parseError?.message || 'unknown parse error'}`);
        }
        englishName = parsed.Title;
        englishDesc = parsed.Description;
        tags = parsed.Tags;
        await updateVideoMetadata(id, { 
          english_name: englishName, 
          english_description: englishDesc,
          tags,
          edited_video_path: video.edited_video_path,
          auto_upload_time: video.auto_upload_time
        });
      }

      const videoTags = Array.isArray(tags) ? tags.join(' ') : tags;

      // 4. Download and Process
      const date = this.getCurrentDate();
      const runId = `${id}-${Date.now()}`;
      const workDir = path.join(process.cwd(), process.env.VIDEO_WORK_DIR || 'video-work', `legacy-${runId}`);
      
      // Use edited video path if provided, otherwise download from Bilibili
      if (!finalVideoPath || !fs.existsSync(finalVideoPath)) {
        console.log(`[Workflow] Acquiring video content from Bilibili...`);
        const mixFolder = path.join(workDir, 'mix');
        const finalFolder = path.join(workDir, 'final');
        fs.mkdirSync(mixFolder, { recursive: true });
        fs.mkdirSync(finalFolder, { recursive: true });
        finalVideoPath = await processBilibiliUrl(`video-${id}`, bilibiliUrl, {
          mixFolder,
          finalFolder,
          outputFileName: `${date}-${id}.mp4`,
        });
      } else {
        console.log(`[Workflow] Using edited video file: ${finalVideoPath}`);
      }

      if (!fs.existsSync(finalVideoPath)) throw new Error(`Video file not found: ${finalVideoPath}`);

      // 5. Upload to YouTube
      console.log('[Workflow] Uploading to YouTube...');
      const youtubeUrl = await UploadVideo(finalVideoPath, englishName, englishDesc, videoTags);

      // 6. Finalize
      await finalizeUpload(id, youtubeUrl, date);
      console.log(`[Workflow] Successfully finished processing for ID ${id}`);

    } catch (error) {
      console.error(`[Workflow] Error processing video ${id}:`, error.message);
      logError(id, error.message);
      throw error;
    } finally {
      console.log('[Workflow] Cleanup...');
      if (finalVideoPath && finalVideoPath.includes(`${path.sep}${process.env.VIDEO_WORK_DIR || 'video-work'}${path.sep}`)) {
        fs.rmSync(path.dirname(path.dirname(finalVideoPath)), { recursive: true, force: true });
      }
    }
  }

  getCurrentDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
