import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SoundButton } from './components/SoundButton';
import { SoundEditorModal, SoundData } from './components/SoundEditorModal';
import { ModelRegistrationModal, VoiceModel } from './components/ModelRegistrationModal';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Plyr, APITypes } from 'plyr-react';
import 'plyr-react/plyr.css';
import './index.css';

function App() {
  const [voiceChanger, setVoiceChanger] = useState(false);
  const [hearMyself, setHearMyself] = useState(false);
  const [hasVirtualCable, setHasVirtualCable] = useState<boolean | null>(null);

  const [satanic1, setSatanic1] = useState(false);
  const [satanic2, setSatanic2] = useState(false);

  const [activeTab, setActiveTab] = useState<'soundboard' | 'settings' | 'voicebox' | 'web' | 'voice-effects'>('soundboard');
  const [webUrl, setWebUrl] = useState<string>('');
  const [currentMediaUrl, setCurrentMediaUrl] = useState<string>('');
  const [cableDeviceId, setCableDeviceId] = useState<string>('');
  const [deviceError, setDeviceError] = useState<string>('');

  const hiddenAudioRef = useRef<HTMLAudioElement>(null);
  const plyrRef = useRef<APITypes>(null);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [extractedMediaUrl, setExtractedMediaUrl] = useState<string>('');
  const [inputDevices, setInputDevices] = useState<string[]>([]);
  const [selectedInputDevice, setSelectedInputDevice] = useState<string>('');
  const [appDataDir, setAppDataDir] = useState<string>('');
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);

  const [sounds, setSounds] = useState<SoundData[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSound, setEditingSound] = useState<SoundData | null>(null);

  const [voiceModels, setVoiceModels] = useState<VoiceModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<VoiceModel | null>(null);
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [voicePitch, setVoicePitch] = useState<number>(0);
  const [pitchEstimator, setPitchEstimator] = useState<string>('rmvpe');
  const [indexRate, setIndexRate] = useState<number>(0.7);
  const [chunkSec, setChunkSec] = useState<number>(30720); // 0.64s default
  const [extraFrameSec, setExtraFrameSec] = useState<number>(12000); // 0.25s default
  const [embedder, setEmbedder] = useState<string>('hubert_base');

  // Check for virtual cable
  useEffect(() => {
    const checkCable = async () => {
      try {
        const hasCable = await invoke<boolean>('check_audio_cable');
        setHasVirtualCable(hasCable);
      } catch (e) {
        console.error("Failed to check audio cable", e);
      }
    };
    checkCable();
    const interval = setInterval(checkCable, 3000); // Check every 3 seconds
    return () => clearInterval(interval);
  }, []);

  // Detect Virtual Cable for setSinkId
  useEffect(() => {
    const detectCable = async () => {
      try {
        // Request permissions to enumerate devices fully
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();
        const cable = devices.find(d =>
          d.kind === 'audiooutput' &&
          (d.label.toLowerCase().includes('cable') || d.label.toLowerCase().includes('virtual'))
        );

        if (cable) {
          setCableDeviceId(cable.deviceId);
          setDeviceError('');
        } else {
          setDeviceError('Nenhum dispositivo "Cable" ou "Virtual" encontrado no navegador.');
        }
      } catch (e: any) {
        setDeviceError(e.message || String(e));
      }
    };
    detectCable();
  }, []);

  // Set the audio sink of the hidden audio element
  useEffect(() => {
    if (hiddenAudioRef.current && cableDeviceId) {
      if (typeof (hiddenAudioRef.current as any).setSinkId === 'function') {
        (hiddenAudioRef.current as any).setSinkId(cableDeviceId)
          .catch((e: any) => console.error("Failed to set sink ID:", e));
      }
    }
  }, [cableDeviceId, extractedMediaUrl]);

  // Sync video and hidden audio (DUAL ROUTING SEM CORS)
  useEffect(() => {
    let unbind = () => { };
    let isCancelled = false;
    let bindTimeout: any = null;

    const tryBind = () => {
      if (isCancelled) return;

      const video = (plyrRef.current?.plyr as any)?.media as HTMLVideoElement;
      const audio = hiddenAudioRef.current;

      // Se ainda não inicializou o plyr ou o audio, tenta novamente em breve
      if (!video || !audio) {
        bindTimeout = setTimeout(tryBind, 200);
        return;
      }

      const syncTime = () => {
        if (Math.abs(audio.currentTime - video.currentTime) > 0.3) {
          audio.currentTime = video.currentTime;
        }
      };

      const onPlay = () => { audio.play().catch(console.error); syncTime(); };
      const onPause = () => { audio.pause(); };
      const onSeeked = () => { audio.currentTime = video.currentTime; };
      const onRateChange = () => { audio.playbackRate = video.playbackRate; };
      const onVolumeChange = () => {
        audio.volume = video.volume;
        audio.muted = video.muted;
      };
      const onWaiting = () => { audio.pause(); };
      const onPlaying = () => { audio.play().catch(console.error); syncTime(); };
      const onTimeUpdate = () => {
        if (!video.paused && Math.abs(audio.currentTime - video.currentTime) > 0.5) {
          audio.currentTime = video.currentTime;
        }
      };

      video.addEventListener('play', onPlay);
      video.addEventListener('pause', onPause);
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('ratechange', onRateChange);
      video.addEventListener('volumechange', onVolumeChange);
      video.addEventListener('waiting', onWaiting);
      video.addEventListener('playing', onPlaying);
      video.addEventListener('timeupdate', onTimeUpdate);

      unbind = () => {
        video.removeEventListener('play', onPlay);
        video.removeEventListener('pause', onPause);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('ratechange', onRateChange);
        video.removeEventListener('volumechange', onVolumeChange);
        video.removeEventListener('waiting', onWaiting);
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('timeupdate', onTimeUpdate);
      };
    };

    if (extractedMediaUrl) {
      tryBind();
    }

    return () => {
      isCancelled = true;
      if (bindTimeout) clearTimeout(bindTimeout);
      unbind();
    };
  }, [extractedMediaUrl]);

  // Load media url (handles YouTube vs local files)
  useEffect(() => {
    if (!currentMediaUrl) {
      setExtractedMediaUrl('');
      return;
    }

    const loadMedia = async () => {
      setIsVideoLoading(true);
      setDeviceError('');
      try {
        if (currentMediaUrl.includes('youtube.com') || currentMediaUrl.includes('youtu.be')) {
          const directUrl = await invoke<string>('extract_youtube_stream_url', { url: currentMediaUrl });
          setExtractedMediaUrl(directUrl);
        } else {
          // Verify if local path and convert
          if (currentMediaUrl.includes(':\\') || currentMediaUrl.startsWith('/')) {
            setExtractedMediaUrl(convertFileSrc(currentMediaUrl));
          } else {
            setExtractedMediaUrl(currentMediaUrl); // normal web url
          }
        }
      } catch (e: any) {
        console.error("Erro ao carregar mídia:", e);
        setDeviceError(String(e));
      } finally {
        setIsVideoLoading(false);
      }
    };
    loadMedia();
  }, [currentMediaUrl]);

  // Pause web media when leaving the tab, and resync when returning to avoid browser display:none optimizations breaking sync
  useEffect(() => {
    const video = (plyrRef.current?.plyr as any)?.media as HTMLVideoElement;
    const audio = hiddenAudioRef.current;

    if (activeTab !== 'web') {
      if (video) video.pause();
      if (audio) audio.pause();
    } else {
      // Upon returning to the tab, make sure they are perfectly aligned
      if (video && audio) {
        audio.currentTime = video.currentTime;
      }
    }
  }, [activeTab]);

  // Plyr-react handles its own updates, so we don't need manual initialization

  useEffect(() => {
    const loadAppData = async () => {
      try {
        const dir = await invoke<string>('get_appdata_dir');
        setAppDataDir(dir);

        const configStr = await invoke<string>('load_config');
        try {
          const config = JSON.parse(configStr);
          if (config.sounds) setSounds(config.sounds);
          if (config.voiceModels) setVoiceModels(config.voiceModels);
        } catch (e) {
          console.error("Failed to parse config", e);
        }

        const savedMic = localStorage.getItem('soundboard_mic');
        if (savedMic) {
          setSelectedInputDevice(savedMic);
          invoke('set_input_device', { deviceName: savedMic }).catch(err => console.error(err));
        }

        const savedPitch = localStorage.getItem('soundboard_pitch');
        if (savedPitch) {
          setVoicePitch(parseInt(savedPitch, 10));
          invoke('set_voice_pitch', { pitch: parseInt(savedPitch, 10) }).catch(err => console.error(err));
        }

        const savedEstimator = localStorage.getItem('soundboard_estimator');
        if (savedEstimator) setPitchEstimator(savedEstimator);

        const savedIndex = localStorage.getItem('soundboard_index');
        if (savedIndex) setIndexRate(parseFloat(savedIndex));

        const savedChunk = localStorage.getItem('soundboard_chunk');
        if (savedChunk) setChunkSec(parseInt(savedChunk, 10));

        const savedExtra = localStorage.getItem('soundboard_extra');
        if (savedExtra) setExtraFrameSec(parseInt(savedExtra, 10));

        const savedEmbedder = localStorage.getItem('soundboard_embedder');
        if (savedEmbedder) setEmbedder(savedEmbedder);

      } catch (err) {
        console.error("Error loading app data:", err);
      } finally {
        setIsConfigLoaded(true);
      }
    };

    loadAppData();
    invoke<string[]>('get_input_devices').then(devs => setInputDevices(devs)).catch(err => console.error(err));
  }, []);

  // Set the active model after config is loaded
  useEffect(() => {
    if (isConfigLoaded && voiceModels.length > 0 && appDataDir) {
      const savedModelId = localStorage.getItem('soundboard_model_id');
      if (savedModelId) {
        const active = voiceModels.find(m => m.id === savedModelId);
        if (active) {
          setSelectedModel(active);
          const onnxFullPath = active.onnxPath.includes(':') || active.onnxPath.startsWith('/') 
            ? active.onnxPath 
            : `${appDataDir}/models/${active.onnxPath}`;
          const indexFullPath = active.indexPath 
            ? (active.indexPath.includes(':') || active.indexPath.startsWith('/') ? active.indexPath : `${appDataDir}/models/${active.indexPath}`) 
            : "";
            
          invoke('set_voice_model', {
            path: onnxFullPath,
            indexPath: indexFullPath
          }).catch(err => console.error(err));
        }
      }
    }
  }, [isConfigLoaded, voiceModels, appDataDir]);

  // Save config when sounds or voiceModels change
  useEffect(() => {
    if (!isConfigLoaded) return;
    const config = { sounds, voiceModels };
    invoke('save_config', { config: JSON.stringify(config) }).catch(console.error);
  }, [sounds, voiceModels, isConfigLoaded]);

  // Sync Voice Control settings
  useEffect(() => {
    if (!isConfigLoaded) return;
    localStorage.setItem('soundboard_estimator', pitchEstimator);
    localStorage.setItem('soundboard_index', indexRate.toString());
    localStorage.setItem('soundboard_chunk', chunkSec.toString());
    localStorage.setItem('soundboard_extra', extraFrameSec.toString());
    localStorage.setItem('soundboard_embedder', embedder);

    invoke('set_voice_control', {
      pitchEstimator,
      indexRate,
      chunkFrames: chunkSec,
      extraFrames: extraFrameSec,
      embedder
    }).catch(console.error);
  }, [pitchEstimator, indexRate, chunkSec, extraFrameSec, embedder, isConfigLoaded]);

  const handleAddSound = () => {
    setEditingSound(null);
    setIsModalOpen(true);
  };

  const handleEditSound = (id: string) => {
    const sound = sounds.find(s => s.id === id);
    if (sound) {
      setEditingSound(sound);
      setIsModalOpen(true);
    }
  };

  const handleSaveSound = (savedSound: SoundData) => {
    setSounds(prev => {
      const exists = prev.find(s => s.id === savedSound.id);
      if (exists) {
        return prev.map(s => s.id === savedSound.id ? savedSound : s);
      }
      return [...prev, savedSound];
    });
  };

  const handleDeleteSound = (id: string) => {
    setSounds(prev => prev.filter(s => s.id !== id));
  };

  const loadVoiceModel = async (model: VoiceModel) => {
    const onnxFullPath = model.onnxPath.includes(':') || model.onnxPath.startsWith('/') 
      ? model.onnxPath 
      : `${appDataDir}/models/${model.onnxPath}`;
    const indexFullPath = model.indexPath 
      ? (model.indexPath.includes(':') || model.indexPath.startsWith('/') ? model.indexPath : `${appDataDir}/models/${model.indexPath}`) 
      : "";
      
    await invoke('set_voice_model', {
      path: onnxFullPath,
      indexPath: indexFullPath
    });
  };

  const [editingVoiceModel, setEditingVoiceModel] = useState<VoiceModel | null>(null);

  const handleEditVoiceModel = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const model = voiceModels.find(m => m.id === id);
    if (model) {
      setEditingVoiceModel(model);
      setIsModelModalOpen(true);
    }
  };

  const handleDeleteVoiceModel = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this voice model?")) {
      setVoiceModels(prev => prev.filter(m => m.id !== id));
      if (selectedModel?.id === id) {
        setSelectedModel(null);
        localStorage.removeItem('soundboard_model_id');
      }
    }
  };

  const handleSaveVoiceModel = (savedModel: VoiceModel) => {
    setVoiceModels(prev => {
      const exists = prev.find(m => m.id === savedModel.id);
      if (exists) {
        return prev.map(m => m.id === savedModel.id ? savedModel : m);
      }
      return [...prev, savedModel];
    });
  };

  const handleVoiceChangerToggle = async () => {
    const newState = !voiceChanger;
    if (newState && selectedModel) {
      await loadVoiceModel(selectedModel);
    } else if (newState && !selectedModel) {
      alert('Select a voice model before enabling Voice Changer.');
      return;
    }

    setVoiceChanger(newState);
    try {
      await invoke('toggle_voice', { enabled: newState });
    } catch (e) {
      console.error("Failed to toggle voice", e);
      setVoiceChanger(!newState);
    }
  };

  // Effect removed since MPV routes natively via Rust/MPV config

  return (
    <>
      {hasVirtualCable === false && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: '#000000', zIndex: 9999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: 'white', padding: '2rem', textAlign: 'center'
        }}>
          <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem', color: '#ff4444' }}>Cabo de Áudio Virtual Necessário!</h1>
          <p style={{ fontSize: '1.2rem', marginBottom: '2rem', maxWidth: '600px' }}>
            Para que o Soundboard funcione corretamente e o Discord possa ouvir seus áudios (sem que você ouça a si mesmo), é obrigatório instalar um Cabo de Áudio Virtual.
          </p>
          <div style={{ padding: '2rem', backgroundColor: '#1a1a2e', borderRadius: '1rem', border: '1px solid #8a2be2' }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Passo a Passo:</h2>
            <ol style={{ textAlign: 'left', marginBottom: '2rem', lineHeight: '1.8' }}>
              <li>Clique no botão abaixo para iniciar a instalação.</li>
              <li>Aparecerá uma tela do Windows pedindo permissão de Administrador (clique em <b>Sim</b>).</li>
              <li>Na janela do VB-Audio, clique no botão <b>"Install Driver"</b>.</li>
              <li>Após instalar, esta tela desaparecerá automaticamente!</li>
            </ol>
            <button
              style={{ padding: '1rem 2rem', fontSize: '1.2rem', backgroundColor: '#8a2be2', color: 'white', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 'bold' }}
              onClick={async () => {
                try {
                  await invoke('install_audio_cable');
                } catch (e) {
                  console.error("Failed to install cable", e);
                  alert('Erro ao abrir instalador: ' + e);
                }
              }}
            >
              🔌 Iniciar Instalação do Cabo Virtual
            </button>
          </div>
        </div>
      )}

      <div className="flex h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
        {/* Sidebar Navigation */}
        <aside className="w-64 bg-zinc-900/50 backdrop-blur-xl border-r border-white/5 flex flex-col shadow-2xl relative z-20">
          <div className="h-24 flex items-center px-8 border-b border-white/5">
            <h1 className="font-heading font-extrabold text-2xl tracking-tighter bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
              SOUNDBOARD
            </h1>
          </div>
          <nav className="flex-1 p-4 flex flex-col gap-2">
            <div
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold cursor-pointer transition-all duration-300 ${activeTab === 'voicebox' ? 'bg-indigo-500/15 text-indigo-400 shadow-inner' : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5'}`}
              onClick={() => setActiveTab('voicebox')}
            >
              <span className="text-xl">🎙️</span> Voicebox
            </div>
            <div
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold cursor-pointer transition-all duration-300 ${activeTab === 'voice-effects' ? 'bg-indigo-500/15 text-indigo-400 shadow-inner' : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5'}`}
              onClick={() => setActiveTab('voice-effects')}
            >
              <span className="text-xl">👹</span> Efeitos de Voz
            </div>
            <div
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold cursor-pointer transition-all duration-300 ${activeTab === 'soundboard' ? 'bg-indigo-500/15 text-indigo-400 shadow-inner' : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5'}`}
              onClick={() => setActiveTab('soundboard')}
            >
              <span className="text-xl">🎛️</span> Soundboard
            </div>
            <div
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold cursor-pointer transition-all duration-300 ${activeTab === 'web' ? 'bg-indigo-500/15 text-indigo-400 shadow-inner' : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5'}`}
              onClick={() => setActiveTab('web')}
            >
              <span className="text-xl">🌐</span> Web Media
            </div>
            <div
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold cursor-pointer transition-all duration-300 ${activeTab === 'settings' ? 'bg-indigo-500/15 text-indigo-400 shadow-inner' : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5'}`}
              onClick={() => setActiveTab('settings')}
            >
              <span className="text-xl">⚙️</span> Settings
            </div>
          </nav>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col relative z-10 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-black">
          {/* Top Controls Bar */}
          <header className="h-20 flex items-center px-8 border-b border-white/5 bg-zinc-900/30 backdrop-blur-md gap-4">
            <button
              className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-bold text-sm transition-all duration-300 active:scale-95 border ${voiceChanger ? 'bg-indigo-500 border-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.4)]' : 'bg-zinc-800/80 border-white/10 text-zinc-300 hover:bg-zinc-700'}`}
              onClick={handleVoiceChangerToggle}
            >
              🎙️ Voice Changer {voiceChanger ? 'ON' : 'OFF'}
            </button>
            <button
              className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-bold text-sm transition-all duration-300 active:scale-95 border ${hearMyself ? 'bg-emerald-500 border-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-zinc-800/80 border-white/10 text-zinc-300 hover:bg-zinc-700'}`}
              onClick={async () => {
                const newState = !hearMyself;
                setHearMyself(newState);
                try {
                  await invoke('toggle_hear_myself', { enabled: newState });
                } catch (e) { console.error("Failed to toggle hear myself", e); }
              }}
            >
              🎧 Hear Myself {hearMyself ? 'ON' : 'OFF'}
            </button>
          </header>

          {/* Tab Content */}
          {activeTab === 'voice-effects' && (
            <div className="flex-1 p-8 overflow-y-auto bg-transparent">
              <div className="flex justify-between items-end mb-8">
                <div>
                  <h2 className="font-heading text-4xl font-bold bg-gradient-to-r from-red-500 via-purple-500 to-indigo-500 bg-clip-text text-transparent">
                    Efeitos de Voz
                  </h2>
                  <p className="text-zinc-400 mt-2 text-lg">Modulação de voz demônica e sombria em tempo real.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl">
                {/* Satanic 1 Card */}
                <div 
                  className={`bg-zinc-900/40 backdrop-blur-sm border rounded-3xl p-8 shadow-xl transition-all duration-500 relative overflow-hidden group ${
                    satanic1 
                      ? 'border-purple-500/50 shadow-[0_0_30px_rgba(168,85,247,0.15)] scale-[1.01]' 
                      : 'border-white/5 hover:border-white/10 hover:scale-[1.02]'
                  }`}
                >
                  {/* Decorative background glow */}
                  <div className={`absolute -right-16 -top-16 w-32 h-32 rounded-full blur-3xl transition-all duration-500 ${
                    satanic1 ? 'bg-purple-600/20' : 'bg-transparent group-hover:bg-purple-600/5'
                  }`} />
                  
                  <div className="flex items-start justify-between relative z-10 mb-6">
                    <div>
                      <span className="text-4xl">👹</span>
                      <h3 className="text-2xl font-bold mt-4 text-zinc-100">Satanic 1</h3>
                      <p className="text-zinc-500 text-xs mt-1 uppercase tracking-wider font-semibold">C++ DSP Chain Profile</p>
                    </div>
                    
                    <button
                      onClick={async () => {
                        const nextState = !satanic1;
                        setSatanic1(nextState);
                        if (nextState) {
                          setSatanic2(false);
                          await invoke('toggle_satanic_2', { enabled: false });
                        }
                        try {
                          await invoke('toggle_satanic_1', { enabled: nextState });
                        } catch (e) {
                          console.error("Failed to toggle Satanic 1", e);
                          setSatanic1(!nextState);
                        }
                      }}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-all duration-300 outline-none ${
                        satanic1 ? 'bg-purple-500' : 'bg-zinc-700'
                      }`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-all duration-300 ${
                        satanic1 ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>

                  <p className="text-zinc-300 text-sm leading-relaxed mb-6 relative z-10">
                    Processamento avançado de voz usando efeitos DSP encadeados em tempo real:
                  </p>
                  
                  <ul className="text-xs text-zinc-400 space-y-2.5 relative z-10 border-t border-white/5 pt-4">
                    <li className="flex items-center gap-2">
                      <span className="text-purple-400">⬇️</span> <b>Pitch Shift:</b> Redução de tom para 0.65x (grave profano).
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-purple-400">👥</span> <b>Chorus:</b> Rate de 1.5Hz com modulação para voz dupla.
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-purple-400">🔥</span> <b>Distortion:</b> Saturação harmônica suave de 1.5x.
                    </li>
                  </ul>
                </div>

                {/* Satanic 2 Card */}
                <div 
                  className={`bg-zinc-900/40 backdrop-blur-sm border rounded-3xl p-8 shadow-xl transition-all duration-500 relative overflow-hidden group ${
                    satanic2 
                      ? 'border-red-500/50 shadow-[0_0_30px_rgba(239,68,68,0.15)] scale-[1.01]' 
                      : 'border-white/5 hover:border-white/10 hover:scale-[1.02]'
                  }`}
                >
                  {/* Decorative background glow */}
                  <div className={`absolute -right-16 -top-16 w-32 h-32 rounded-full blur-3xl transition-all duration-500 ${
                    satanic2 ? 'bg-red-600/20' : 'bg-transparent group-hover:bg-red-600/5'
                  }`} />
                  
                  <div className="flex items-start justify-between relative z-10 mb-6">
                    <div>
                      <span className="text-4xl">💀</span>
                      <h3 className="text-2xl font-bold mt-4 text-zinc-100">Satanic 2</h3>
                      <p className="text-zinc-500 text-xs mt-1 uppercase tracking-wider font-semibold">Raw Buffer Modulator Profile</p>
                    </div>
                    
                    <button
                      onClick={async () => {
                        const nextState = !satanic2;
                        setSatanic2(nextState);
                        if (nextState) {
                          setSatanic1(false);
                          await invoke('toggle_satanic_1', { enabled: false });
                        }
                        try {
                          await invoke('toggle_satanic_2', { enabled: nextState });
                        } catch (e) {
                          console.error("Failed to toggle Satanic 2", e);
                          setSatanic2(!nextState);
                        }
                      }}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-all duration-300 outline-none ${
                        satanic2 ? 'bg-red-500' : 'bg-zinc-700'
                      }`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-all duration-300 ${
                        satanic2 ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>

                  <p className="text-zinc-300 text-sm leading-relaxed mb-6 relative z-10">
                    Modulação profunda de baixa frequência e distorção agressiva no buffer bruto:
                  </p>
                  
                  <ul className="text-xs text-zinc-400 space-y-2.5 relative z-10 border-t border-white/5 pt-4">
                    <li className="flex items-center gap-2">
                      <span className="text-red-400">⚡</span> <b>Ring Modulation:</b> Modulação por senoide de 45Hz.
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-red-400">🧬</span> <b>Dual Layer Mix:</b> 60% tom grave (0.55x) + 40% modulado.
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-red-400">✂️</span> <b>Soft Clipping:</b> Limitador rígido em ±0.8 para distorção crua.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'voicebox' && (
            <div className="flex-1 p-8 overflow-y-auto bg-transparent">
              <div className="flex justify-between items-end mb-8">
                <div>
                  <h2 className="font-heading text-4xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">RVC Voice Changer</h2>
                  <p className="text-zinc-400 mt-2 text-lg">Transform your voice in real-time with AI.</p>
                </div>
              </div>

              <div className="bg-zinc-900/40 backdrop-blur-sm border border-white/5 rounded-2xl p-8 mb-8 shadow-xl">
                <h3 className="mt-0 mb-6 text-xl font-bold text-zinc-100 flex items-center gap-2">
                  <span className="text-indigo-400">⚡</span> Active Voice Model
                </h3>

                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-5 mb-8">
                  {voiceModels.map((mod) => (
                    <div
                      key={mod.id}
                      className={`relative aspect-square rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all duration-300 overflow-hidden group ${selectedModel?.id === mod.id ? 'bg-indigo-500/20 border-2 border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.3)] scale-[1.02]' : 'bg-zinc-800/50 border border-white/5 hover:bg-zinc-700/50 hover:scale-105 hover:shadow-xl'}`}
                      onClick={async () => {
                        setSelectedModel(mod);
                        localStorage.setItem('soundboard_model_id', mod.id);
                        try {
                          await loadVoiceModel(mod);
                        } catch (err) {
                          console.error(err);
                        }
                      }}
                    >
                      {selectedModel?.id === mod.id && (
                        <div className="absolute top-2 left-2 z-20 bg-indigo-500 rounded-full w-5 h-5 flex items-center justify-center text-[10px] shadow-lg font-bold">
                          ✓
                        </div>
                      )}

                      <div className="absolute top-2 right-2 z-30 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <button
                          className="bg-black/60 hover:bg-indigo-500 p-1.5 rounded-lg text-xs backdrop-blur-md transition-colors"
                          onClick={(e) => handleEditVoiceModel(mod.id, e)}
                          title="Edit"
                        >⚙️</button>
                        <button
                          className="bg-black/60 hover:bg-red-500 p-1.5 rounded-lg text-xs backdrop-blur-md transition-colors"
                          onClick={(e) => handleDeleteVoiceModel(mod.id, e)}
                          title="Delete"
                        >🗑️</button>
                      </div>

                      {mod.imagePath && (
                        <img
                          src={convertFileSrc(`${appDataDir}/models/${mod.imagePath}`)}
                          alt={mod.name}
                          className="absolute inset-0 w-full h-full object-cover opacity-20 group-hover:opacity-30 transition-opacity duration-300"
                        />
                      )}
                      
                      <span className="relative z-10 text-4xl mb-3 drop-shadow-lg transition-transform group-hover:scale-110 duration-300">🗣️</span>
                      <span className="relative z-10 font-bold text-sm text-center px-3 truncate w-full">{mod.name}</span>
                    </div>
                  ))}

                  <div 
                    className="relative aspect-square bg-zinc-800/30 border border-dashed border-white/20 rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all duration-300 hover:bg-zinc-800/60 hover:border-indigo-400 hover:text-indigo-400 group"
                    onClick={() => setIsModelModalOpen(true)}
                  >
                    <span className="text-3xl mb-2 group-hover:scale-110 transition-transform duration-300">➕</span>
                    <span className="font-bold text-sm">Add Model</span>
                  </div>
                </div>

                <div className="bg-zinc-950/50 p-6 rounded-2xl max-w-2xl border border-white/5">
                  <h3 className="mt-0 mb-6 pb-3 border-b border-white/10 text-lg font-bold text-indigo-400">Voice Control Parameters</h3>

                  <div className="flex flex-col gap-6">

                    {/* Pitch Estimator */}
                    <div className="flex items-center gap-4">
                      <div className="w-32 text-right text-zinc-400 font-semibold text-sm">Pitch Estimator</div>
                      <select
                        value={pitchEstimator}
                        onChange={(e) => setPitchEstimator(e.target.value)}
                        className="flex-1 p-3 rounded-lg bg-zinc-900 text-white border border-white/10 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all cursor-pointer"
                      >
                        <option value="rmvpe">rmvpe (Recommended)</option>
                        <option value="harvest">harvest</option>
                        <option value="crepe">crepe</option>
                        <option value="dio">dio</option>
                      </select>
                    </div>

                    {/* Pitch Slider */}
                    <div className="flex items-center gap-4">
                      <div className="w-32 text-right text-zinc-400 font-semibold text-sm">Pitch</div>
                      <input
                        type="range" min="-24" max="24" value={voicePitch}
                        onChange={(e) => {
                          const p = parseInt(e.target.value, 10);
                          setVoicePitch(p);
                          localStorage.setItem('soundboard_pitch', p.toString());
                          invoke('set_voice_pitch', { pitch: p }).catch(console.error);
                        }}
                        className="flex-1 cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all h-2 bg-zinc-800 rounded-lg appearance-none"
                      />
                      <div className="w-8 text-right font-mono bg-zinc-900 px-2 py-1 rounded text-sm text-zinc-300">{voicePitch}</div>
                    </div>

                    {/* Index Slider */}
                    <div className="flex items-center gap-4">
                      <div className="w-32 text-right text-zinc-400 font-semibold text-sm">Index</div>
                      <input
                        type="range" min="0" max="1" step="0.01" value={indexRate}
                        onChange={(e) => setIndexRate(parseFloat(e.target.value))}
                        className="flex-1 cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all h-2 bg-zinc-800 rounded-lg appearance-none"
                      />
                      <div className="w-8 text-right font-mono bg-zinc-900 px-2 py-1 rounded text-sm text-zinc-300">{indexRate.toFixed(2)}</div>
                    </div>

                    {/* chunkSec */}
                    <div className="flex items-center gap-4">
                      <div className="w-32 text-right text-zinc-400 font-semibold text-sm">Chunk Sec</div>
                      <select
                        value={chunkSec}
                        onChange={(e) => setChunkSec(parseInt(e.target.value, 10))}
                        className="flex-1 p-3 rounded-lg bg-zinc-900 text-white border border-white/10 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all cursor-pointer"
                      >
                        <option value="12000">12000 [0.25 sec]</option>
                        <option value="24000">24000 [0.5 sec]</option>
                        <option value="30720">30720 [0.64 sec]</option>
                        <option value="48000">48000 [1.0 sec]</option>
                      </select>
                    </div>

                    {/* extraFrameSec */}
                    <div className="flex items-center gap-4">
                      <div className="w-32 text-right text-zinc-400 font-semibold text-sm">Extra Frame Sec</div>
                      <select
                        value={extraFrameSec}
                        onChange={(e) => setExtraFrameSec(parseInt(e.target.value, 10))}
                        className="flex-1 p-3 rounded-lg bg-zinc-900 text-white border border-white/10 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all cursor-pointer"
                      >
                        <option value="1920">1920 [0.04 sec]</option>
                        <option value="3840">3840 [0.08 sec]</option>
                        <option value="12000">12000 [0.25 sec]</option>
                        <option value="24000">24000 [0.50 sec]</option>
                      </select>
                    </div>

                    {/* Embedder */}
                    <div className="flex items-center gap-4">
                      <div className="w-32 text-right text-zinc-400 font-semibold text-sm">Embedder</div>
                      <select
                        value={embedder}
                        onChange={(e) => setEmbedder(e.target.value)}
                        className="flex-1 p-3 rounded-lg bg-zinc-900 text-white border border-white/10 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all cursor-pointer"
                      >
                        <option value="hubert_base">Default (hubert_base_l12)</option>
                        <option value="portuguese_hubert_base">Portuguese HuBERT</option>
                        <option value="contentvec">contentvec</option>
                        <option value="distilhubert">distilhubert</option>
                      </select>
                    </div>

                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'soundboard' && (
            <div className="flex-1 p-8 overflow-y-auto bg-transparent">
              <div className="flex justify-between items-end mb-8">
                <div>
                  <h2 className="font-heading text-4xl font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">My Sounds</h2>
                  <p className="text-zinc-400 mt-2 text-lg">Click a tile or press its hotkey to play.</p>
                </div>
              </div>

              <div className="bg-zinc-900/40 backdrop-blur-sm border border-white/5 rounded-2xl p-8 shadow-xl">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-5">
                  {sounds.map(sound => (
                    <SoundButton
                      key={sound.id}
                      id={sound.id}
                      name={sound.name}
                      audioSrc={sound.audioSrc}
                      hotkey={sound.hotkey}
                      icon={sound.icon}
                      volume={sound.volume}
                      startTime={sound.startTime}
                      endTime={sound.endTime}
                      onEdit={handleEditSound}
                      hearMyself={hearMyself}
                    />
                  ))}

                  {/* Add Sound Tile */}
                  <div 
                    className="relative aspect-square bg-zinc-800/30 border border-dashed border-white/20 rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all duration-300 hover:bg-zinc-800/60 hover:border-emerald-400 hover:text-emerald-400 group" 
                    onClick={handleAddSound}
                  >
                    <span className="text-3xl mb-2 group-hover:scale-110 transition-transform duration-300">➕</span>
                    <span className="font-bold text-sm">Add Sound</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className={`flex-1 p-8 overflow-y-auto bg-transparent flex flex-col ${activeTab === 'web' ? '' : 'hidden'}`}>
            <div className="flex justify-between items-end mb-8">
              <div>
                <h2 className="font-heading text-4xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">Web Media</h2>
                <p className="text-zinc-400 mt-2 text-lg">Stream and retransmit audio and video from the web.</p>
              </div>
            </div>

            <div className="bg-zinc-900/40 backdrop-blur-sm border border-white/5 rounded-2xl p-6 shadow-xl flex-1 flex flex-col min-h-0">
              <div className="flex gap-3 mb-6">
                <input
                  type="text"
                  value={webUrl}
                  onChange={(e) => setWebUrl(e.target.value)}
                  placeholder="Enter Media URL (YouTube, MP4, MP3, etc.)"
                  className="flex-1 p-4 rounded-xl bg-zinc-950/80 text-white border border-white/10 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setCurrentMediaUrl(webUrl);
                  }}
                />
                <button
                  onClick={() => setCurrentMediaUrl(webUrl)}
                  className="px-8 py-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-[0_0_15px_rgba(37,99,235,0.3)] hover:shadow-[0_0_20px_rgba(37,99,235,0.5)]"
                >
                  Load URL
                </button>
                <button
                  onClick={async () => {
                    const selected = await open({
                      multiple: false,
                      filters: [{ name: 'Media', extensions: ['mp3', 'mp4', 'wav', 'webm', 'ogg'] }]
                    });
                    if (selected && typeof selected === 'string') {
                      setCurrentMediaUrl(selected);
                    }
                  }}
                  className="px-6 py-4 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-900 text-white font-bold rounded-xl border border-white/10 transition-all flex items-center gap-2"
                >
                  📁 Open File
                </button>
              </div>

              <div className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm mb-6 border ${cableDeviceId ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                <div className={`w-2.5 h-2.5 rounded-full ${cableDeviceId ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse' : 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]'}`} />
                {cableDeviceId ? 'Cabo Virtual Conectado' : 'Cabo Virtual Não Encontrado'}
              </div>

              {deviceError && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl mb-6 font-mono text-sm">
                  <strong>Detalhes do Erro:</strong> {deviceError}
                </div>
              )}

              <div className="relative flex-1 bg-black rounded-xl overflow-hidden border border-white/10 min-h-[400px]">
                <div className="absolute inset-0 flex flex-col">
                  {/* Elemento de áudio invisível usado para espelhar o som para o Cabo Virtual sem usar AudioContext (foge do CORS) */}
                  <audio ref={hiddenAudioRef} src={extractedMediaUrl || undefined} className="hidden" />

                  {/* The video element is ALWAYS rendered so React never crashes on unmount due to Plyr's DOM mutations */}
                  <div className="flex-1 w-full h-full video-container" style={{ '--plyr-color-main': '#3b82f6' } as React.CSSProperties}>
                    {extractedMediaUrl && (
                      <Plyr
                        ref={plyrRef}
                        source={{ type: 'video', sources: [{ src: extractedMediaUrl }] }}
                        options={{
                          controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen'],
                          settings: ['captions', 'quality', 'speed', 'loop']
                        }}
                      />
                    )}
                  </div>

                  {isVideoLoading && (
                    <div className="absolute inset-0 z-10 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                      <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                      <span className="text-zinc-400 font-medium">Buscando a melhor qualidade... (Aguarde alguns segundos)</span>
                    </div>
                  )}

                  {!isVideoLoading && !extractedMediaUrl && (
                    <div className="absolute inset-0 z-10 bg-zinc-900/80 flex flex-col items-center justify-center gap-4">
                      <div className="text-6xl drop-shadow-xl opacity-50">🎬</div>
                      <span className="text-zinc-400 font-medium">Insira uma mídia ou link do YouTube para reproduzir.</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {activeTab === 'settings' && (
            <div className="flex-1 p-8 overflow-y-auto bg-transparent">
              <div className="flex justify-between items-end mb-8">
                <div>
                  <h2 className="font-heading text-4xl font-bold bg-gradient-to-r from-orange-400 to-rose-400 bg-clip-text text-transparent">Settings</h2>
                  <p className="text-zinc-400 mt-2 text-lg">Configure your audio devices and preferences.</p>
                </div>
              </div>

              <div className="bg-zinc-900/40 backdrop-blur-sm border border-white/5 p-8 rounded-2xl max-w-2xl shadow-xl">
                <h3 className="mt-0 mb-4 text-xl font-bold text-zinc-100">Input Device (Microphone)</h3>
                <p className="text-zinc-400 mb-6 leading-relaxed">
                  Select the microphone you want to route through the Voice Changer and Virtual Cable.
                </p>
                <select
                  value={selectedInputDevice}
                  onChange={(e) => {
                    const dev = e.target.value;
                    setSelectedInputDevice(dev);
                    localStorage.setItem('soundboard_mic', dev);
                    invoke('set_input_device', { deviceName: dev }).catch(err => console.error(err));
                  }}
                  className="w-full p-4 rounded-xl bg-zinc-950 text-white border border-white/10 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none transition-all cursor-pointer font-medium"
                >
                  <option value="">-- Default Microphone --</option>
                  {inputDevices.map((dev, i) => (
                    <option key={i} value={dev}>{dev}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </main>

        <SoundEditorModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveSound}
          onDelete={handleDeleteSound}
          initialData={editingSound}
        />

        <ModelRegistrationModal
          isOpen={isModelModalOpen}
          onClose={() => {
            setIsModelModalOpen(false);
            setEditingVoiceModel(null);
          }}
          onSave={handleSaveVoiceModel}
          editingModel={editingVoiceModel}
        />
      </div>
    </>
  );
}

export default App;
