'use client';

import { useState, useRef, useEffect } from 'react';
import { Video, Square, Send, X, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type VideoRecorderProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: (blob: Blob) => void;
  isUploading?: boolean;
};

// Get the best supported video mime type
function getSupportedVideoMimeType(): string {
  const types = [
    'video/mp4;codecs=h264,aac', // Best for Telegram
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return 'video/webm';
}

export function VideoRecorder({ open, onOpenChange, onRecorded, isUploading }: VideoRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const mimeTypeRef = useRef<string>('');

  useEffect(() => {
    if (open) {
      startCamera();
    } else {
      stopCamera();
      reset();
    }

    return () => {
      stopCamera();
    };
  }, [open, facingMode]);

  const startCamera = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 480, max: 480 },
          height: { ideal: 480, max: 480 },
          aspectRatio: { exact: 1 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Failed to access camera:', err);
      setError('Failed to access camera. Please check permissions.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const reset = () => {
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
    setVideoBlob(null);
    setVideoUrl(null);
    setDuration(0);
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
  };

  const startRecording = () => {
    if (!streamRef.current) return;

    const mimeType = getSupportedVideoMimeType();
    mimeTypeRef.current = mimeType;

    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType,
      videoBitsPerSecond: 1000000, // 1 Mbps for reasonable quality
    });

    mediaRecorderRef.current = mediaRecorder;
    chunksRef.current = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blobType = mimeTypeRef.current.includes('mp4') ? 'video/mp4' : 'video/webm';
      const blob = new Blob(chunksRef.current, { type: blobType });
      setVideoBlob(blob);
      setVideoUrl(URL.createObjectURL(blob));
    };

    mediaRecorder.start(100);
    setIsRecording(true);
    setDuration(0);

    timerRef.current = setInterval(() => {
      setDuration((d) => {
        // Max 60 seconds for video notes
        if (d >= 59) {
          stopRecording();
          return 60;
        }
        return d + 1;
      });
    }, 1000);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      stopCamera();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const handleSend = () => {
    if (videoBlob) {
      // Create a file with proper extension
      const ext = mimeTypeRef.current.includes('mp4') ? '.mp4' : '.webm';
      const file = new File([videoBlob], `video_note${ext}`, { type: videoBlob.type });
      onRecorded(file);
    }
  };

  const handleRetake = () => {
    reset();
    startCamera();
  };

  const toggleCamera = () => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate progress for the ring (0-60 seconds)
  const progress = (duration / 60) * 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Video Message</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {error ? (
            <div className="w-64 h-64 rounded-full bg-muted flex items-center justify-center">
              <p className="text-sm text-muted-foreground text-center px-4">{error}</p>
            </div>
          ) : !videoBlob ? (
            <>
              {/* Camera preview */}
              <div className="relative">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className={cn(
                    'w-64 h-64 rounded-full object-cover bg-black',
                    facingMode === 'user' && 'scale-x-[-1]'
                  )}
                />

                {/* Duration overlay */}
                {isRecording && (
                  <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-full">
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-white text-sm font-medium tabular-nums">
                      {formatDuration(duration)}
                    </span>
                  </div>
                )}

                {/* Progress ring */}
                <svg
                  className="absolute inset-0 w-64 h-64 -rotate-90 pointer-events-none"
                  viewBox="0 0 256 256"
                >
                  <circle
                    cx="128"
                    cy="128"
                    r="126"
                    fill="none"
                    stroke={isRecording ? 'rgba(255,255,255,0.2)' : 'transparent'}
                    strokeWidth="4"
                  />
                  {isRecording && (
                    <circle
                      cx="128"
                      cy="128"
                      r="126"
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={`${(progress / 100) * 792} 792`}
                      className="transition-all duration-100"
                    />
                  )}
                </svg>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-6">
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full"
                  onClick={toggleCamera}
                  disabled={isRecording}
                >
                  <RotateCcw className="h-5 w-5" />
                </Button>

                <Button
                  variant={isRecording ? 'destructive' : 'default'}
                  size="lg"
                  className="w-16 h-16 rounded-full"
                  onClick={isRecording ? stopRecording : startRecording}
                >
                  {isRecording ? (
                    <Square className="h-6 w-6" />
                  ) : (
                    <Video className="h-6 w-6" />
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  onClick={() => onOpenChange(false)}
                  disabled={isRecording}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              <p className="text-sm text-muted-foreground">
                {isRecording ? 'Tap to stop' : 'Tap to start recording (max 60s)'}
              </p>
            </>
          ) : (
            <>
              {/* Video preview */}
              <div className="relative">
                <video
                  ref={previewRef}
                  src={videoUrl!}
                  autoPlay
                  loop
                  playsInline
                  className="w-64 h-64 rounded-full object-cover bg-black"
                />
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 px-3 py-1 rounded-full">
                  <span className="text-white text-sm font-medium">{formatDuration(duration)}</span>
                </div>
              </div>

              {/* Preview controls */}
              <div className="flex items-center gap-4">
                <Button variant="outline" onClick={handleRetake} disabled={isUploading}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Retake
                </Button>

                <Button variant="telegram" onClick={handleSend} disabled={isUploading}>
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Send
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
