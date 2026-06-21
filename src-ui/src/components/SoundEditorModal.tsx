import { useState, useEffect, useRef } from 'react';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';

export interface SoundData {
  id: string;
  name: string;
  audioSrc: string;
  hotkey?: string;
  icon?: string;
  volume?: number;
  startTime?: number;
  endTime?: number;
}

interface SoundEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (sound: SoundData) => void;
  onDelete?: (id: string) => void;
  initialData?: SoundData | null;
}

export function SoundEditorModal({ isOpen, onClose, onSave, onDelete, initialData }: SoundEditorModalProps) {
  const [name, setName] = useState('');
  const [hotkey, setHotkey] = useState('');
  const [icon, setIcon] = useState('🎵');
  const [audioSrc, setAudioSrc] = useState('');
  const [fileName, setFileName] = useState('');
  const [volume, setVolume] = useState(1);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const waveformRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<any>(null);

  useEffect(() => {
    if (isOpen) {
      setShowEmojiPicker(false);
      if (initialData) {
        setName(initialData.name);
        setHotkey(initialData.hotkey || '');
        setIcon(initialData.icon || '🎵');
        setAudioSrc(initialData.audioSrc);
        setVolume(initialData.volume ?? 1);
        setStartTime(initialData.startTime ?? 0);
        setEndTime(initialData.endTime ?? 0);
        setFileName(initialData.audioSrc.startsWith('data:') ? 'Local file uploaded' : 'Remote URL');
      } else {
        setName('');
        setHotkey('');
        setIcon('🎵');
        setAudioSrc('');
        setVolume(1);
        setStartTime(0);
        setEndTime(0);
        setFileName('');
      }
    }
  }, [isOpen, initialData]);

  // WaveSurfer initialization
  useEffect(() => {
    if (isOpen && audioSrc && waveformRef.current) {
      // Destroy previous instance if it exists
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
      }

      const ws = WaveSurfer.create({
        container: waveformRef.current,
        waveColor: 'rgba(255, 255, 255, 0.4)',
        progressColor: '#5865F2',
        cursorColor: '#5865F2',
        height: 64,
        normalize: true,
      });

      const wsRegions = ws.registerPlugin(RegionsPlugin.create());

      // We need to convert absolute file path to a webview asset URL
      import('@tauri-apps/api/core').then(({ convertFileSrc }) => {
        let loadUrl = audioSrc;
        // Check if it's an absolute Windows/Unix path (not http, data, or blob)
        if (!audioSrc.startsWith('http') && !audioSrc.startsWith('data') && !audioSrc.startsWith('blob')) {
          loadUrl = convertFileSrc(audioSrc);
        }
        ws.load(loadUrl);
      }).catch(() => {
        ws.load(audioSrc); // Fallback
      });

      ws.on('decode', () => {
        if (wavesurferRef.current !== ws) return;
        
        const duration = ws.getDuration();
        const start = initialData?.startTime ?? 0;
        const end = initialData?.endTime || duration;

        // Update states to actual limits if not set
        if (!initialData?.endTime) {
          setEndTime(duration);
        }

        wsRegions.addRegion({
          start: start,
          end: end,
          color: 'rgba(99, 102, 241, 0.25)',
          drag: true,
          resize: true,
          id: 'trim-region'
        });
      });

      wsRegions.on('region-updated', (region) => {
        if (region.id === 'trim-region') {
          setStartTime(region.start);
          setEndTime(region.end);
        }
      });

      ws.on('interaction', () => {
        ws.play();
      });

      wavesurferRef.current = ws;
      regionsRef.current = wsRegions;

      return () => {
        ws.destroy();
        wavesurferRef.current = null;
      };
    }
  }, [isOpen, audioSrc, initialData]);

  // Update playback volume when slider changes
  useEffect(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(volume);
    }
  }, [volume]);

  if (!isOpen) return null;

  const handleFileChange = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { invoke } = await import('@tauri-apps/api/core');
      
      const file = await open({
        multiple: false,
        filters: [{
          name: 'Audio',
          extensions: ['mp3', 'wav', 'ogg']
        }]
      });

      if (file) {
        const filePath = file as string;
        
        // Import file securely to AppData immediately so WaveSurfer has permission to read it via asset://
        const newSecurePath = await invoke<string>('import_sound_file', { sourcePath: filePath });
        
        const nameParts = filePath.split(/[\\/]/);
        const fileName = nameParts[nameParts.length - 1];
        
        setFileName(fileName);
        setStartTime(0);
        setEndTime(0);
        
        setAudioSrc(newSecurePath);
      }
    } catch (err) {
      console.error("Failed to open file dialog or import sound", err);
      alert("Failed to load audio file: " + err);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !audioSrc) {
      alert("Name and Audio are required");
      return;
    }

    let finalAudioSrc = audioSrc;

    try {
      const { invoke } = await import('@tauri-apps/api/core');

      const appData = await invoke<string>('get_appdata_dir');
      const soundsDir = `${appData}/sounds`.replace(/\\/g, '/');
      const normalizedAudioSrc = audioSrc.replace(/\\/g, '/');

      // If the file is not already in our sounds directory, copy it
      if (!normalizedAudioSrc.startsWith(soundsDir)) {
        finalAudioSrc = await invoke<string>('import_sound_file', { sourcePath: audioSrc });
      }

      // Check if we need to trim
      const duration = wavesurferRef.current?.getDuration() || 0;
      const shouldTrim = startTime > 0.01 || (endTime > 0 && Math.abs(endTime - duration) > 0.05);

      if (shouldTrim) {
        finalAudioSrc = await invoke<string>('trim_sound_file', {
          path: finalAudioSrc,
          startTime,
          endTime
        });
        
        onSave({
          id: initialData?.id || Date.now().toString(),
          name,
          hotkey: hotkey.toUpperCase(),
          icon,
          audioSrc: finalAudioSrc,
          volume,
          startTime: 0,
          endTime: 0
        });
        onClose();
        return;
      }
    } catch (err) {
      console.error("Failed to copy/trim audio file:", err);
      alert("Failed to save/trim audio file: " + err);
      return;
    }

    onSave({
      id: initialData?.id || Date.now().toString(),
      name,
      hotkey: hotkey.toUpperCase(),
      icon,
      audioSrc: finalAudioSrc,
      volume,
      startTime,
      endTime
    });
    onClose();
  };

  const playPreview = () => {
    if (wavesurferRef.current) {
      // Start playing from the region start
      wavesurferRef.current.setTime(startTime);
      wavesurferRef.current.play();

      // We could add an interval to pause exactly at endTime, 
      // but regions plugin natively can handle 'out' event if we set it up.
      // For simple preview, user sees the visual region anyway.
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl overflow-visible flex flex-col max-h-[90vh]" onClick={() => setShowEmojiPicker(false)} style={{ width: '500px' }}>
        
        <div className="p-6 border-b border-white/5">
          <h2 className="m-0 font-heading text-2xl font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">{initialData ? 'Edit Sound' : 'Upload Sound'}</h2>
        </div>

        <div className="p-6 overflow-y-auto flex flex-col gap-6">
          {/* WAVEFORM PREVIEW */}
          <div className="flex flex-col gap-2">
            <label className="text-zinc-400 text-sm font-bold uppercase tracking-wider">Preview & Trim</label>
            <div className="bg-black/40 rounded-xl p-3 border border-white/5 relative">
              {!audioSrc && (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-500 font-medium z-10 pointer-events-none">
                  Upload an audio file to see preview
                </div>
              )}

              <div className="flex gap-3 items-center">
                <button
                  type="button"
                  onClick={playPreview}
                  className="bg-zinc-800 hover:bg-emerald-600 disabled:opacity-50 disabled:hover:bg-zinc-800 text-white rounded-full w-10 h-10 flex items-center justify-center cursor-pointer z-10 flex-shrink-0 transition-colors shadow-lg"
                  disabled={!audioSrc}
                >
                  ▶
                </button>
                <div ref={waveformRef} className="flex-1 min-h-[64px]"></div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-zinc-400 text-sm font-bold uppercase tracking-wider">Audio File *</label>
            <div className="flex gap-3 items-center">
              <button
                type="button"
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold rounded-lg transition-colors border border-white/10"
                onClick={handleFileChange}
              >
                ↑ Browse
              </button>
              <span className="text-zinc-300 font-mono text-sm truncate flex-1">{fileName || 'Select audio file...'}</span>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex flex-col gap-2 flex-[2]" onClick={(e) => e.stopPropagation()}>
              <label className="text-zinc-400 text-sm font-bold uppercase tracking-wider">Sound Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sound Name"
                className="w-full p-3 bg-zinc-950 text-white rounded-lg border border-white/10 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all"
              />
            </div>

            <div className="flex flex-col gap-2 flex-1 relative" onClick={(e) => e.stopPropagation()}>
              <label className="text-zinc-400 text-sm font-bold uppercase tracking-wider">Icon</label>
              <button
                type="button"
                className="w-full p-3 bg-zinc-950 text-white rounded-lg border border-white/10 hover:border-emerald-500 hover:bg-zinc-900 outline-none transition-all text-xl text-center cursor-pointer"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              >
                {icon}
              </button>

              {showEmojiPicker && (
                <div className="absolute top-full right-0 z-[2000] mt-2 shadow-2xl">
                  <EmojiPicker
                    theme={Theme.DARK}
                    onEmojiClick={(emojiData) => {
                      setIcon(emojiData.emoji);
                      setShowEmojiPicker(false);
                    }}
                    autoFocusSearch={true}
                    searchPlaceHolder="Search emoji..."
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex flex-col gap-2 flex-1">
              <label className="text-zinc-400 text-sm font-bold uppercase tracking-wider">Hotkey</label>
              <input 
                type="text" 
                value={hotkey}
                readOnly
                onKeyDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.key === 'Backspace' || e.key === 'Escape') {
                    setHotkey('');
                    return;
                  }
                  const keys = [];
                  if (e.ctrlKey) keys.push('CTRL');
                  if (e.altKey) keys.push('ALT');
                  if (e.shiftKey) keys.push('SHIFT');
                  
                  if (e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Shift' && e.key !== 'Meta') {
                    let keyName = e.code || e.key;
                    if (keyName.startsWith('Key')) keyName = keyName.substring(3);
                    else if (keyName.startsWith('Digit')) keyName = keyName.substring(5);
                    // Keep Numpad as Numpad1, Numpad2, etc. (no space)
                    else if (keyName.startsWith('Numpad')) keyName = keyName;
                    
                    if (keyName === 'Space') keyName = 'SPACE';
                    
                    keys.push(keyName.toUpperCase());
                  }
                  setHotkey(keys.join(' + '));
                }}
                placeholder="Click & press keys..." 
                className="w-full p-3 bg-zinc-950 text-white font-mono rounded-lg border border-white/10 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all cursor-pointer caret-transparent"
              />
            </div>

            <div className="flex flex-col gap-2 flex-1 justify-center">
              <label className="text-zinc-400 text-sm font-bold uppercase tracking-wider">Volume</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-full cursor-pointer accent-emerald-500 hover:accent-emerald-400 transition-all h-2 bg-zinc-800 rounded-lg appearance-none mt-2"
              />
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-white/5 bg-zinc-900/50 rounded-b-2xl flex gap-3" onClick={(e) => e.stopPropagation()}>
          {initialData && onDelete && (
            <button className="mr-auto px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold rounded-lg transition-colors border border-red-500/20 flex items-center gap-2" onClick={() => { onDelete(initialData.id); onClose(); }}>
              🗑️ Delete
            </button>
          )}
          <button className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold rounded-lg transition-colors border border-white/10" onClick={onClose}>Nevermind</button>
          <button className="px-8 py-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold rounded-lg transition-all shadow-[0_0_15px_rgba(52,211,153,0.3)] hover:shadow-[0_0_20px_rgba(52,211,153,0.5)]" onClick={handleSave}>Submit</button>
        </div>
      </div>
    </div>
  );
}
