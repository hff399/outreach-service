import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import { join, extname } from 'path';

const UPLOAD_DIR = './uploads';
const ALLOWED_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  audio: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'],
  document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};

// Ensure upload directory exists
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

function getMediaType(mimeType: string): 'photo' | 'video' | 'voice' | 'video_note' | 'document' | null {
  if (ALLOWED_TYPES.image.includes(mimeType)) return 'photo';
  if (ALLOWED_TYPES.video.includes(mimeType)) return 'video';
  if (ALLOWED_TYPES.audio.includes(mimeType)) return 'voice';
  if (ALLOWED_TYPES.document.includes(mimeType)) return 'document';
  return null;
}

export async function uploadsRoutes(fastify: FastifyInstance) {
  // Upload single file
  fastify.post('/media', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_FILE', message: 'No file uploaded' },
        });
      }

      const mediaType = getMediaType(data.mimetype);
      if (!mediaType) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TYPE', message: 'File type not allowed' },
        });
      }

      // Check for video_note flag in fields
      const isVideoNote = data.fields?.video_note?.toString() === 'true';
      const finalType = isVideoNote && mediaType === 'video' ? 'video_note' : mediaType;

      // Generate unique filename
      const fileId = randomUUID();
      const ext = extname(data.filename) || '.bin';
      const filename = `${fileId}${ext}`;
      const filepath = join(UPLOAD_DIR, filename);

      // Save file
      await pipeline(data.file, createWriteStream(filepath));

      // Return file info
      return {
        success: true,
        data: {
          id: fileId,
          filename,
          originalName: data.filename,
          mimetype: data.mimetype,
          type: finalType,
          path: filepath,
          url: `/uploads/${filename}`,
        },
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: (error as Error).message },
      });
    }
  });

  // Serve uploaded files
  fastify.get('/:filename', async (request: FastifyRequest<{ Params: { filename: string } }>, reply: FastifyReply) => {
    const { filename } = request.params;
    const filepath = join(UPLOAD_DIR, filename);

    if (!existsSync(filepath)) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'File not found' },
      });
    }

    return reply.sendFile(filename, UPLOAD_DIR);
  });
}
