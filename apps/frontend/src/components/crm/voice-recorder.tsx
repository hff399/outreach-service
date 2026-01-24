'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Send, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

type VoiceRecorderProps = {
  onRecorded: (blob: Blob) => void;
  onCancel: () => void;
  isUploading?: boolean;
};

// Get the best supported audio mime type for Telegram voice messages
function getSupportedAudioMimeType(): string {
  const types = [
    'audio/ogg;codecs=opus', // Best for Telegram
    'audio/ogg',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return 'audio/webm'; // Fallback
}

export function VoiceRecorder({ onRecorded, onCancel, isUploading }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const mimeTypeRef = useRef<string>('');

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        }
      });

      const mimeType = getSupportedAudioMimeType();
      mimeTypeRef.current = mimeType;

      const mediaRecorder = new MediaRecorder(stream, { mimeType });

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Use the correct mime type for the blob
        const blobType = mimeTypeRef.current.includes('ogg') ? 'audio/ogg' : 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: blobType });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch (error) {
      console.error('Failed to start recording:', error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const handleSend = () => {
    if (audioBlob) {
      // Create a new blob with proper extension hint in the name
      const ext = mimeTypeRef.current.includes('ogg') ? '.ogg' : '.webm';
      const file = new File([audioBlob], `voice${ext}`, { type: audioBlob.type });
      onRecorded(file);
    }
  };

  const handleCancel = () => {
    if (isRecording) {
      stopRecording();
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioBlob(null);
    setAudioUrl(null);
    setDuration(0);
    onCancel();
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-2">
      {!audioBlob ? (
        <>
          {/* Recording state */}
          <Button variant="ghost" size="icon" onClick={handleCancel}>
            <X className="h-5 w-5" />
          </Button>

          <div className="flex-1 flex items-center gap-3">
            {isRecording && (
              <>
                <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-medium">{formatDuration(duration)}</span>
                <div className="flex-1 flex gap-0.5 items-center h-6">
                  {Array.from({ length: 40 }).map((_, i) => (
                    <div
                      key={i}
                      className="w-1 bg-red-500 rounded-full transition-all duration-75"
                      style={{
                        height: `${20 + Math.random() * 80}%`,
                      }}
                    />
                  ))}
                </div>
              </>
            )}
            {!isRecording && (
              <span className="text-sm text-muted-foreground">
                Tap mic to start recording
              </span>
            )}
          </div>

          <Button
            variant={isRecording ? 'destructive' : 'default'}
            size="icon"
            className="rounded-full h-10 w-10"
            onClick={isRecording ? stopRecording : startRecording}
          >
            {isRecording ? (
              <Square className="h-4 w-4" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </Button>
        </>
      ) : (
        <>
          {/* Preview state */}
          <Button variant="ghost" size="icon" onClick={handleCancel} disabled={isUploading}>
            <X className="h-5 w-5" />
          </Button>

          <div className="flex-1 flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-telegram" />
            <span className="text-sm font-medium">{formatDuration(duration)}</span>
            <audio src={audioUrl!} controls className="flex-1 h-8" />
          </div>

          <Button
            variant="telegram"
            size="icon"
            className="rounded-full h-10 w-10"
            onClick={handleSend}
            disabled={isUploading}
          >
            {isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </Button>
        </>
      )}
    </div>
  );
}
