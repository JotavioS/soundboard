import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import { basename } from '@tauri-apps/api/path';
import { pthToOnnx } from 'rvc-onnx-web';

export interface VoiceModel {
  id: string;
  name: string;
  onnxPath: string;
  indexPath: string;
  imagePath: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (model: VoiceModel) => void;
  editingModel?: VoiceModel | null;
}

export function ModelRegistrationModal({ isOpen, onClose, onSave, editingModel }: Props) {
  const [name, setName] = useState('');
  const [onnxPath, setOnnxPath] = useState('');
  const [indexPath, setIndexPath] = useState('');
  const [imagePath, setImagePath] = useState('');
  const [isConverting, setIsConverting] = useState(false);

  // Load editing model when modal opens
  useEffect(() => {
    if (isOpen) {
      if (editingModel) {
        setName(editingModel.name || '');
        setOnnxPath(editingModel.onnxPath || '');
        setIndexPath(editingModel.indexPath || '');
        setImagePath(editingModel.imagePath || '');
      } else {
        setName('');
        setOnnxPath('');
        setIndexPath('');
        setImagePath('');
      }
    }
  }, [isOpen, editingModel]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!name || !onnxPath) {
      alert("Name and .onnx file are required!");
      return;
    }

    try {
      let newOnnx = "";
      if (onnxPath && (!editingModel || onnxPath !== editingModel.onnxPath)) {
        if (onnxPath.endsWith('.pth')) {
          setIsConverting(true);
          try {
            // Read the .pth file directly from the filesystem using Tauri FS
            const pthBuffer = await readFile(onnxPath);
            
            // Convert to ONNX using rvc-onnx-web WebAssembly (Zero Python Required!)
            const { onnxBuffer } = await pthToOnnx(pthBuffer, { opsetVersion: 17 });
            
            // Generate a unique file name and save the buffer
            const uuid = Date.now().toString();
            const originalName = await basename(onnxPath);
            const baseNameNoExt = originalName.replace(/\.pth$/i, '');
            const newFileName = `${uuid}_${baseNameNoExt}.onnx`;
            
            // Send buffer to backend to write file, avoiding frontend FS scope issues
            const destPath = await invoke<string>('save_voice_model', { 
              fileName: newFileName, 
              data: Array.from(new Uint8Array(onnxBuffer))
            });
            
            newOnnx = destPath;
          } catch(err) {
            console.error("Conversion error:", err);
            throw new Error(`Failed to convert .pth to .onnx: ${err}`);
          } finally {
            setIsConverting(false);
          }
        } else {
          newOnnx = await invoke<string>('import_voice_model', { sourcePath: onnxPath });
        }
      }

      let newIndex = "";
      if (indexPath && (!editingModel || indexPath !== editingModel.indexPath)) {
        newIndex = await invoke<string>('import_voice_model', { sourcePath: indexPath });
      }

      let newImage = "";
      if (imagePath && (!editingModel || imagePath !== editingModel.imagePath)) {
        newImage = await invoke<string>('import_voice_model', { sourcePath: imagePath });
      }

      const model: VoiceModel = {
        id: editingModel ? editingModel.id : Date.now().toString(),
        name,
        onnxPath: newOnnx || onnxPath, // If newOnnx is empty because it wasn't re-imported, keep the old path
        indexPath: newIndex || indexPath,
        imagePath: newImage || imagePath
      };

      onSave(model);
      onClose();
      
      // Reset form
      setName('');
      setOnnxPath('');
      setIndexPath('');
      setImagePath('');
    } catch (e) {
      console.error(e);
      setIsConverting(false);
      alert("Failed to import/convert model files: " + e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl overflow-visible flex flex-col max-h-[90vh] max-w-lg w-full">
        <div className="p-6 border-b border-white/5">
          <h2 className="m-0 font-heading text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Register RVC Voice Model</h2>
        </div>
        
        <div className="p-6 overflow-y-auto flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-zinc-400 text-sm font-bold uppercase tracking-wider">Display Name</label>
            <input 
              type="text" 
              value={name} 
              onChange={e => setName(e.target.value)} 
              placeholder="e.g. Goku, SpongeBob"
              className="w-full p-3 bg-zinc-950 text-white rounded-lg border border-white/10 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-zinc-400 text-sm font-bold uppercase tracking-wider">Voice Model (.onnx, .pth) *</label>
            <div className="flex gap-3 items-center">
              <button 
                type="button"
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold rounded-lg transition-colors border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed" 
                onClick={async () => {
                  const file = await open({ filters: [{ name: 'Model', extensions: ['onnx', 'pth'] }] });
                  if (file && typeof file === 'string') setOnnxPath(file);
                }} 
                disabled={isConverting}
              >
                ↑ Browse
              </button>
              <span className="text-zinc-300 font-mono text-sm truncate flex-1">{onnxPath || 'Select .onnx or .pth file'}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-zinc-400 text-sm font-bold uppercase tracking-wider">Index File (.index) - Optional</label>
            <div className="flex gap-3 items-center">
              <button 
                type="button"
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold rounded-lg transition-colors border border-white/10" 
                onClick={async () => {
                  const file = await open({ filters: [{ name: 'Index', extensions: ['index'] }] });
                  if (file && typeof file === 'string') setIndexPath(file);
                }}
              >
                ↑ Browse
              </button>
              <span className="text-zinc-300 font-mono text-sm truncate flex-1">{indexPath || 'Select .index file'}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-zinc-400 text-sm font-bold uppercase tracking-wider">Model Image - Optional</label>
            <div className="flex gap-3 items-center">
              <button 
                type="button"
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold rounded-lg transition-colors border border-white/10" 
                onClick={async () => {
                  const file = await open({ filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
                  if (file && typeof file === 'string') setImagePath(file);
                }}
              >
                ↑ Browse
              </button>
              <span className="text-zinc-300 font-mono text-sm truncate flex-1">{imagePath || 'Select image file'}</span>
            </div>
          </div>

          {isConverting && (
            <div className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 p-4 rounded-xl font-medium animate-pulse">
              <p>⏳ Convertendo modelo .pth para .onnx localmente via WebAssembly... Por favor aguarde alguns segundos.</p>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-white/5 bg-zinc-900/50 rounded-b-2xl flex justify-end gap-3">
          <button 
            className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold rounded-lg transition-colors border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed" 
            onClick={onClose} 
            disabled={isConverting}
          >
            Cancel
          </button>
          <button 
            className="px-8 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-bold rounded-lg transition-all shadow-[0_0_15px_rgba(99,102,241,0.3)] hover:shadow-[0_0_20px_rgba(99,102,241,0.5)] disabled:opacity-50 disabled:cursor-not-allowed" 
            onClick={handleSave} 
            disabled={isConverting}
          >
            {isConverting ? 'Converting...' : 'Save Model'}
          </button>
        </div>
      </div>
    </div>
  );
}
