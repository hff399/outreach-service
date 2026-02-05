import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

// POST /api/uploads/media
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const isVideoNote = formData.get('video_note') === 'true';

    if (!file) {
      return NextResponse.json({
        success: false,
        error: { code: 'NO_FILE', message: 'No file provided' },
      }, { status: 400 });
    }

    // Determine file type
    const mimetype = file.type;
    let type: 'photo' | 'video' | 'voice' | 'video_note' | 'document';

    if (isVideoNote) {
      type = 'video_note';
    } else if (mimetype.startsWith('image/')) {
      type = 'photo';
    } else if (mimetype.startsWith('video/')) {
      type = 'video';
    } else if (mimetype.startsWith('audio/') || mimetype === 'application/ogg') {
      type = 'voice';
    } else {
      type = 'document';
    }

    // Generate filename
    const ext = file.name.split('.').pop() || 'bin';
    const filename = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${ext}`;

    // Ensure uploads directory exists
    const uploadsDir = join(process.cwd(), 'public', 'uploads');
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    // Save file
    const filepath = join(uploadsDir, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filepath, buffer);

    const url = `/uploads/${filename}`;

    return NextResponse.json({
      success: true,
      data: {
        id: filename,
        filename,
        originalName: file.name,
        mimetype,
        type,
        path: filepath,
        url,
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: { code: 'UPLOAD_ERROR', message: (error as Error).message },
    }, { status: 500 });
  }
}
