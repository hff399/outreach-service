'use client';

import { useState } from 'react';
import { Play, Pause, Download, FileText, Check, CheckCheck, Clock } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { uploadsApi } from '@/lib/api';

type MessageType = 'text' | 'photo' | 'video' | 'video_note' | 'voice' | 'document' | 'sticker';

type Message = {
  id: string;
  direction: 'incoming' | 'outgoing';
  type: MessageType;
  content: string | null;
  media_url: string | null;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  created_at: string;
};

type MessageBubbleProps = {
  message: Message;
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const isOutgoing = message.direction === 'outgoing';

  const getMediaUrl = (url: string | null) => {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    return uploadsApi.getMediaUrl(url);
  };

  const handlePlayVoice = () => {
    if (!message.media_url) return;

    if (audioElement) {
      if (isPlaying) {
        audioElement.pause();
        setIsPlaying(false);
      } else {
        audioElement.play();
        setIsPlaying(true);
      }
    } else {
      const audio = new Audio(getMediaUrl(message.media_url)!);
      audio.onended = () => setIsPlaying(false);
      audio.play();
      setAudioElement(audio);
      setIsPlaying(true);
    }
  };

  const renderStatus = () => {
    if (!isOutgoing) return null;

    switch (message.status) {
      case 'pending':
        return <Clock className="h-3 w-3 text-white/50" />;
      case 'sent':
        return <Check className="h-3 w-3 text-white/70" />;
      case 'delivered':
        return <CheckCheck className="h-3 w-3 text-white/70" />;
      case 'read':
        return <CheckCheck className="h-3 w-3 text-blue-400" />;
      case 'failed':
        return <span className="text-xs text-red-400">Failed</span>;
      default:
        return null;
    }
  };

  const renderContent = () => {
    switch (message.type) {
      case 'photo':
        return (
          <div className="space-y-2">
            {message.media_url && (
              <img
                src={getMediaUrl(message.media_url)!}
                alt="Photo"
                className="rounded-lg max-w-[300px] max-h-[400px] object-cover cursor-pointer hover:opacity-90"
                onClick={() => window.open(getMediaUrl(message.media_url)!, '_blank')}
              />
            )}
            {message.content && <p>{message.content}</p>}
          </div>
        );

      case 'video':
        return (
          <div className="space-y-2">
            {message.media_url && (
              <video
                src={getMediaUrl(message.media_url)!}
                controls
                className="rounded-lg max-w-[300px] max-h-[400px]"
              />
            )}
            {message.content && <p>{message.content}</p>}
          </div>
        );

      case 'video_note':
        return (
          <div className="space-y-2">
            {message.media_url && (
              <video
                src={getMediaUrl(message.media_url)!}
                controls
                className="rounded-full w-[200px] h-[200px] object-cover"
              />
            )}
          </div>
        );

      case 'voice':
        return (
          <div className="flex items-center gap-3 min-w-[200px]">
            <button
              onClick={handlePlayVoice}
              className={cn(
                'flex items-center justify-center w-10 h-10 rounded-full',
                isOutgoing ? 'bg-white/20 hover:bg-white/30' : 'bg-primary/20 hover:bg-primary/30'
              )}
            >
              {isPlaying ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5 ml-0.5" />
              )}
            </button>
            <div className="flex-1">
              <div
                className={cn(
                  'h-1 rounded-full',
                  isOutgoing ? 'bg-white/30' : 'bg-primary/30'
                )}
              >
                <div
                  className={cn(
                    'h-full rounded-full w-0 transition-all',
                    isOutgoing ? 'bg-white' : 'bg-primary'
                  )}
                  style={{ width: isPlaying ? '100%' : '0%' }}
                />
              </div>
            </div>
          </div>
        );

      case 'document':
        return (
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex items-center justify-center w-10 h-10 rounded-lg',
                isOutgoing ? 'bg-white/20' : 'bg-primary/20'
              )}
            >
              <FileText className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {message.content || 'Document'}
              </p>
              {message.media_url && (
                <a
                  href={getMediaUrl(message.media_url)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    'text-xs flex items-center gap-1',
                    isOutgoing ? 'text-white/70 hover:text-white' : 'text-primary/70 hover:text-primary'
                  )}
                >
                  <Download className="h-3 w-3" />
                  Download
                </a>
              )}
            </div>
          </div>
        );

      case 'sticker':
        return (
          <div>
            {message.media_url && (
              <img
                src={getMediaUrl(message.media_url)!}
                alt="Sticker"
                className="w-[128px] h-[128px] object-contain"
              />
            )}
          </div>
        );

      default:
        return <p className="whitespace-pre-wrap break-words">{message.content}</p>;
    }
  };

  // Stickers don't have a bubble background
  if (message.type === 'sticker') {
    return (
      <div
        className={cn(
          'flex',
          isOutgoing ? 'justify-end' : 'justify-start'
        )}
      >
        <div className="relative">
          {renderContent()}
          <div className="text-xs text-muted-foreground mt-1 text-right flex items-center justify-end gap-1">
            {formatRelativeTime(message.created_at)}
            {renderStatus()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex',
        isOutgoing ? 'justify-end' : 'justify-start'
      )}
    >
      <div
        className={cn(
          'message-bubble max-w-[70%]',
          isOutgoing ? 'outgoing' : 'incoming'
        )}
      >
        {renderContent()}
        <div
          className={cn(
            'text-xs mt-1 flex items-center justify-end gap-1',
            isOutgoing ? 'text-white/70' : 'text-muted-foreground'
          )}
        >
          {formatRelativeTime(message.created_at)}
          {renderStatus()}
        </div>
      </div>
    </div>
  );
}
