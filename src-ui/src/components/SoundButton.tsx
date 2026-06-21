import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface SoundButtonProps {
  id: string;
  name: string;
  audioSrc: string;
  hotkey?: string;
  icon?: string;
  volume?: number;
  startTime?: number;
  endTime?: number;
  onEdit?: (id: string) => void;
  hearMyself?: boolean;
}

export function SoundButton({ id, name, audioSrc, hotkey, icon = '🎵', volume = 1, startTime = 0, endTime = 0, onEdit, hearMyself = false }: SoundButtonProps) {
  const [isPlaying, setIsPlaying] = useState(false);

  const playSound = async () => {
    try {
      setIsPlaying(true);
      await invoke('play_sound', {
        path: audioSrc,
        volume: volume,
        startTime: startTime,
        endTime: endTime
      });


      setTimeout(() => setIsPlaying(false), 500);
    } catch (err) {
      console.error("Failed to play sound via Tauri:", err);
      alert(`Failed to play sound in C++: ${err}`);
      setIsPlaying(false);
    }
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.edit-btn')) return;
    playSound();
  };

  // Global hotkey listener
  useEffect(() => {
    if (!hotkey) return;

    // Remove all spaces to handle old saved data like "NUMPAD 1"
    const cleanHotkey = hotkey.replace(/\s+/g, '');

    // Convert our uppercase format "CTRL+SHIFT+1" to Tauri format "CommandOrControl+Shift+Digit1"
    const tauriShortcut = cleanHotkey.split('+').map(part => {
      if (part === 'CTRL') return 'CommandOrControl';
      if (part === 'ALT') return 'Alt';
      if (part === 'SHIFT') return 'Shift';
      
      // If it's a single number, prepend 'Digit'
      if (/^[0-9]$/.test(part)) return 'Digit' + part;
      // If it's a single letter, prepend 'Key'
      if (/^[A-Z]$/.test(part)) return 'Key' + part;
      
      // Capitalize first letter, lowercase the rest (e.g. NUMPAD1 -> Numpad1)
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }).join('+');

    let isActive = true;

    import('@tauri-apps/plugin-global-shortcut').then(({ register, unregister, isRegistered }) => {
      const setupShortcut = async () => {
        try {
          const alreadyTaken = await isRegistered(tauriShortcut);
          if (alreadyTaken) {
            await unregister(tauriShortcut).catch(() => {});
          }
          if (!isActive) return;

          await register(tauriShortcut, (event) => {
            if (event.state === 'Pressed') {
              playSound();
            }
          });
        } catch (err) {
          // Only alert if it's not a strict mode race condition error we already handled
          console.error('Failed to register global shortcut:', err);
          if (String(err).indexOf('already registered') === -1) {
            alert(`Failed to register hotkey ${tauriShortcut}: ${err}`);
          }
        }
      };
      
      setupShortcut();
    });

    return () => {
      isActive = false;
      import('@tauri-apps/plugin-global-shortcut').then(({ unregister }) => {
        unregister(tauriShortcut).catch(e => console.error(e));
      });
    };
  }, [hotkey, audioSrc, volume, startTime, endTime, hearMyself]);

  return (
    <div
      className={`relative aspect-square rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all duration-300 overflow-hidden group ${isPlaying ? 'bg-emerald-500/20 border-2 border-emerald-500 shadow-[0_0_20px_rgba(52,211,153,0.3)] scale-[1.02]' : 'bg-zinc-800/50 border border-white/5 hover:bg-zinc-700/50 hover:scale-105 hover:shadow-xl'}`}
      onClick={handleContainerClick}
      title={name}
    >
      <span className="relative z-10 text-4xl mb-3 drop-shadow-lg transition-transform group-hover:scale-110 duration-300">{icon}</span>
      <span className="relative z-10 font-bold text-sm text-center px-3 truncate w-full">{name}</span>
      
      {hotkey && (
        <span className="absolute top-2 left-2 text-[10px] font-mono bg-black/40 px-1.5 py-0.5 rounded text-zinc-400">
          {hotkey}
        </span>
      )}

      {onEdit && (
        <button
          className="absolute top-2 right-2 bg-black/60 hover:bg-emerald-500 p-1.5 rounded-lg text-xs backdrop-blur-md transition-colors opacity-0 group-hover:opacity-100 edit-btn"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(id);
          }}
          title="Edit Sound"
        >
          ⚙️
        </button>
      )}
    </div>
  );
}
