import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  Upload,
  Image as ImageIcon,
  Wand2,
  Download,
  AlertCircle,
  RefreshCw,
  ChevronRight,
  Sparkles,
  Type,
  Paperclip,
  X,
  Copy,
  Check,
  Code,
  Palette,
  Eye,
  Plus,
  Replace,
  Languages,
  Zap,
  KeyRound,
} from 'lucide-react';
import Header from './components/Header';
import LoadingOverlay from './components/LoadingOverlay';
import {
  editImageWithGemini,
  generateMultimodalImage,
  generateSvgWithGemini,
  translatePrompt,
} from './services/geminiService';
import { AppState, ImageAsset } from './types';

const SUGGESTED_EDIT_PROMPTS = [
  'Add a minimalist retro filter',
  'Turn this into a sleek vector logo',
  'Remove the background',
  'Make it look like a cyberpunk glitch art',
  'Add a neon glow effect',
  'Convert to a pencil sketch',
];

const SUGGESTED_GEN_PROMPTS = [
  'A futuristic road runner bird, minimalist vector logo',
  'Cyberpunk city street at night, neon blue and orange',
  'Abstract geometric shapes, 3d render, white background',
  'A sleek modern icon for a speed delivery service',
];

type Tab = 'edit' | 'generate';
type OutputMode = 'image' | 'svg';

// Helper to extract SVG content from text response
const extractSvg = (text: string) => {
  const match = text.match(/<svg[\s\S]*?<\/svg>/i);
  return match ? match[0] : null;
};

// Remove @import and external URLs from <style> blocks
const sanitizeSvgCss = (svg: string | null) => {
  if (!svg) return svg;

  return svg.replace(
    /<style[^>]*>[\s\S]*?<\/style>/gi,
    (styleBlock) => {
      let cleaned = styleBlock;

      // Remove @import rules
      cleaned = cleaned.replace(/@import[^;]+;/gi, '');

      // Remove url(...) usages
      cleaned = cleaned.replace(/url\([^)]*\)/gi, 'none');

      return cleaned;
    }
  );
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('edit');
  const [outputMode, setOutputMode] = useState<OutputMode>('image');
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);

  // State for images
  const [originalImage, setOriginalImage] = useState<ImageAsset | null>(null);
  const [referenceImages, setReferenceImages] = useState<ImageAsset[]>([]);

  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [generatedText, setGeneratedText] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [isTranslating, setIsTranslating] = useState(false);


  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  // API key modal state
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hfKeyInput, setHfKeyInput] = useState('');
  const [modalTab, setModalTab] = useState<'gemini' | 'hf'>('gemini');
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [hfKeySaved, setHfKeySaved] = useState(false);

  // Extract SVG if present in generated text and sanitize it
  const svgContent = useMemo(
    () => (generatedText ? sanitizeSvgCss(extractSvg(generatedText)) : null),
    [generatedText]
  );

  // Check for API keys on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const storedGeminiKey = window.localStorage.getItem('GEMINI_API_KEY');
        const storedHfKey = window.localStorage.getItem('HF_API_KEY');

        if (storedGeminiKey) setApiKeyInput(storedGeminiKey);
        if (storedHfKey) setHfKeyInput(storedHfKey);

        if (!storedGeminiKey || !storedHfKey) {
          setApiKeyModalOpen(true);
          if (storedGeminiKey && !storedHfKey) {
            setModalTab('hf');
          }
        }
      } catch (err) {
        setApiKeyModalOpen(true);
      }
    }
  }, []);

  const handleSaveApiKey = () => {
    const isGemini = modalTab === 'gemini';
    const input = isGemini ? apiKeyInput : hfKeyInput;
    const trimmed = input.trim();

    if (!trimmed) return;

    try {
      if (isGemini) {
        window.localStorage.setItem('GEMINI_API_KEY', trimmed);
        setApiKeySaved(true);
      } else {
        window.localStorage.setItem('HF_API_KEY', trimmed);
        setHfKeySaved(true);
      }

      setTimeout(() => {
        if (isGemini) setApiKeySaved(false);
        else setHfKeySaved(false);
      }, 1500);
    } catch (err) {
      console.error('Failed to save API key to localStorage', err);
      setErrorMsg(
        'Failed to save API key in the browser. Please check your browser settings.'
      );
    }
  };

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    isAttachment: boolean = false
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please upload a valid image file.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const match = result.match(/^data:(.+);base64,(.+)$/);
      if (match) {
        const asset: ImageAsset = {
          id: crypto.randomUUID(),
          url: result,
          mimeType: match[1],
          base64Data: match[2],
        };

        if (isAttachment) {
          // Add to reference images (limit 3)
          if (referenceImages.length < 3) {
            setReferenceImages((prev) => [...prev, asset]);
          }
          if (attachmentInputRef.current) attachmentInputRef.current.value = '';
        } else {
          // Set/Replace original image for Editing
          setOriginalImage(asset);

          if (appState === AppState.IDLE) {
            setGeneratedImage(null);
            setGeneratedText(null);
            setErrorMsg(null);
          }
          setActiveTab('edit');
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (activeTab === 'edit' && !originalImage) return;

    setAppState(AppState.PROCESSING);
    setErrorMsg(null);
    setCopied(false);
    setViewMode('preview');

    try {
      let result;

      if (outputMode === 'svg') {
        const imagesToUse =
          activeTab === 'edit' && originalImage
            ? [originalImage]
            : referenceImages;

        result = await generateSvgWithGemini(prompt, imagesToUse);
      } else {
        if (activeTab === 'edit' && originalImage) {
          result = await editImageWithGemini(
            originalImage.base64Data,
            originalImage.mimeType,
            prompt
          );
        } else {
          result = await generateMultimodalImage(prompt, referenceImages);
        }
      }

      if (result.imageUrl) {
        setGeneratedImage(result.imageUrl);
        setGeneratedText(null);
        setAppState(AppState.SUCCESS);
      } else if (result.text) {
        setGeneratedText(result.text);
        setGeneratedImage(null);
        setAppState(AppState.SUCCESS);
      } else {
        setErrorMsg(
          'The model returned text but no image. Try a more specific visual prompt.'
        );
        setAppState(AppState.ERROR);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'An unexpected error occurred.'
      );
      setAppState(AppState.ERROR);
    }
  };

  const handleDownload = () => {
    if (generatedImage) {
      const link = document.createElement('a');
      link.href = generatedImage;
      link.download = `roadrunner-${activeTab}-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (svgContent) {
      const safeSvg = sanitizeSvgCss(svgContent);
      const blob = new Blob([safeSvg ?? ''], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `roadrunner-logo-${Date.now()}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

  const handleCopyText = () => {
    if (generatedText) {
      navigator.clipboard.writeText(generatedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const resetApp = () => {
    setOriginalImage(null);
    setReferenceImages([]);
    setGeneratedImage(null);
    setGeneratedText(null);
    setPrompt('');
    setAppState(AppState.IDLE);
    setErrorMsg(null);
  };

  const removeReferenceImage = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setReferenceImages((prev) => prev.filter((img) => img.id !== id));
  };

  const triggerReplaceOriginal = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleTranslate = async () => {
    if (!prompt.trim() || isTranslating) return;
    try {
      setIsTranslating(true);
      const translated = await translatePrompt(prompt);
      setPrompt(translated);
    } catch (err) {
      console.error('Translation error:', err);
      setErrorMsg('Translation failed. Please try again.');
    } finally {
      setIsTranslating(false);
    }
  };

  const needsTranslation = useMemo(() => /[^\x00-\x7F]/.test(prompt), [prompt]);

  const showWorkspace =
    (activeTab === 'edit' && originalImage) ||
    (activeTab === 'generate' &&
      (appState !== AppState.IDLE ||
        generatedImage ||
        generatedText ||
        referenceImages.length > 0));

  const suggestedPrompts =
    activeTab === 'edit' ? SUGGESTED_EDIT_PROMPTS : SUGGESTED_GEN_PROMPTS;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-brand-500/30">
      <Header onChangeApiKey={() => setApiKeyModalOpen(true)} />

      <main className="max-w-6xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {!showWorkspace && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-8 animate-in fade-in zoom-in duration-500">
            <div className="space-y-4 max-w-2xl">
              <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-brand-200 to-brand-500 pb-2">
                Reimagine Your Visuals
              </h2>
              <p className="text-slate-400 text-lg">
                Create stunning visuals or Generate SVG code with Gemini. <br />
                Edit existing images or generate new ones from scratch.
              </p>
            </div>

            <div className="p-1 bg-slate-900 rounded-xl sm:rounded-full border border-slate-800 flex w-full sm:w-auto relative">
              <button
                onClick={() => {
                  setActiveTab('edit');
                  setErrorMsg(null);
                }}
                className={`relative z-10 flex-1 sm:flex-none px-4 sm:px-6 py-2 rounded-lg sm:rounded-full text-xs sm:text-sm font-medium transition-all duration-300 ${activeTab === 'edit'
                  ? 'text-white bg-slate-800 shadow-sm border border-slate-700'
                  : 'text-slate-500 hover:text-slate-300'
                  }`}
              >
                Edit Image
              </button>
              <button
                onClick={() => {
                  setActiveTab('generate');
                  setErrorMsg(null);
                }}
                className={`relative z-10 flex-1 sm:flex-none px-4 sm:px-6 py-2 rounded-lg sm:rounded-full text-xs sm:text-sm font-medium transition-all duration-300 ${activeTab === 'generate'
                  ? 'text-white bg-slate-800 shadow-sm border border-slate-700'
                  : 'text-slate-500 hover:text-slate-300'
                  }`}
              >
                Generate Image
              </button>
            </div>

            {activeTab === 'edit' ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="group relative cursor-pointer w-full max-w-lg"
              >
                <div className="absolute -inset-0.5 bg-gradient-to-r from-brand-600 to-indigo-600 rounded-2xl blur opacity-30 group-hover:opacity-75 transition duration-1000 group-hover:duration-200 animate-tilt"></div>
                <div className="relative px-12 py-10 bg-slate-900 rounded-xl border border-slate-800 hover:border-brand-500/50 transition-colors flex flex-col items-center gap-4">
                  <div className="p-4 bg-slate-800 rounded-full group-hover:bg-brand-900/30 group-hover:text-brand-400 transition-colors">
                    <Upload className="w-8 h-8" />
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-white group-hover:text-brand-200">
                      Click to Upload Image
                    </p>
                    <p className="text-sm text-slate-500">PNG, JPG up to 10MB</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="w-full max-w-xl space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="relative group">
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-600 to-brand-600 rounded-2xl blur opacity-20 group-hover:opacity-60 transition duration-1000 group-hover:duration-200"></div>
                  <div className="relative bg-slate-900 rounded-xl p-2 border border-slate-800 hover:border-brand-500/50 transition-colors">
                    {referenceImages.length > 0 && (
                      <div className="mx-4 mt-2 mb-1 flex gap-2 flex-wrap">
                        {referenceImages.map((img) => (
                          <div
                            key={img.id}
                            className="relative rounded-lg overflow-hidden border border-slate-700 group/preview w-20 h-20"
                          >
                            <img
                              src={img.url}
                              alt="Reference"
                              className="w-full h-full object-cover opacity-80"
                            />
                            <button
                              onClick={(e) =>
                                removeReferenceImage(img.id, e)
                              }
                              className="absolute top-1 right-1 bg-slate-900/80 hover:bg-red-500/80 text-white p-1 rounded-full transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                        {referenceImages.length < 3 && (
                          <button
                            onClick={() =>
                              attachmentInputRef.current?.click()
                            }
                            className="w-20 h-20 rounded-lg border border-dashed border-slate-700 flex flex-col items-center justify-center text-slate-500 hover:text-brand-400 hover:border-brand-500/50 hover:bg-slate-800/50 transition-colors"
                          >
                            <Plus className="w-5 h-5 mb-1" />
                            <span className="text-[10px]">Add</span>
                          </button>
                        )}
                      </div>
                    )}

                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder={
                        referenceImages.length > 0
                          ? 'Describe how to use these images...'
                          : 'Describe the image you want to generate...'
                      }
                      className="w-full bg-transparent border-none text-slate-100 placeholder:text-slate-600 focus:ring-0 p-4 resize-none h-32 text-lg"
                    />
                    <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 px-4 pb-4 sm:pb-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex bg-slate-950 rounded-lg p-0.5 border border-slate-800 flex-1 sm:flex-none">
                          <button
                            onClick={() => setOutputMode('image')}
                            className={`flex-1 sm:flex-none px-2 py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center gap-1 transition-colors ${outputMode === 'image'
                              ? 'bg-slate-800 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-300'
                              }`}
                            title="Generate Raster Image"
                          >
                            <Palette className="w-3 h-3" /> Image
                          </button>
                          <button
                            onClick={() => setOutputMode('svg')}
                            className={`flex-1 sm:flex-none px-2 py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center gap-1 transition-colors ${outputMode === 'svg'
                              ? 'bg-slate-800 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-300'
                              }`}
                            title="Generate SVG/Code"
                          >
                            <Code className="w-3 h-3" /> SVG/Code
                          </button>
                        </div>

                        {referenceImages.length === 0 && (
                          <button
                            onClick={() =>
                              attachmentInputRef.current?.click()
                            }
                            className="flex items-center justify-center gap-1.5 text-[10px] sm:text-xs bg-slate-800 hover:bg-slate-700 text-brand-300 px-3 py-1.5 rounded-full transition-colors border border-slate-700/50"
                            title="Attach up to 3 images"
                          >
                            <Paperclip className="w-3.5 h-3.5" />
                            <span className="hidden xs:inline">Attach</span>
                          </button>
                        )}

                        {needsTranslation && (
                          <button
                            onClick={handleTranslate}
                            disabled={isTranslating}
                            className="flex items-center justify-center gap-1.5 text-[10px] sm:text-xs bg-brand-600/10 hover:bg-brand-600/20 text-brand-400 px-3 py-1.5 rounded-full transition-colors border border-brand-500/20 animate-in fade-in zoom-in duration-300"
                            title="Translate to English"
                          >
                            <Languages className="w-3 h-3" />
                            {isTranslating ? '...' : 'Translate'}
                          </button>
                        )}
                      </div>

                      <button
                        onClick={handleGenerate}
                        disabled={!prompt.trim()}
                        className="bg-brand-600 hover:bg-brand-500 text-white px-6 py-2.5 rounded-xl sm:rounded-lg font-semibold sm:font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-brand-600/20"
                      >
                        Generate <Sparkles className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTED_GEN_PROMPTS.slice(0, 3).map((suggestion, idx) => (
                    <button
                      key={idx}
                      onClick={() => setPrompt(suggestion)}
                      className="text-xs px-3 py-1.5 rounded-full bg-slate-900/50 hover:bg-slate-800 text-slate-500 hover:text-brand-300 border border-slate-800 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {showWorkspace && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in slide-in-from-bottom-8 duration-500">
            <div className="space-y-6">
              {activeTab === 'generate' && (
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Type className="w-5 h-5 text-brand-400" />
                    {referenceImages.length > 0
                      ? `Text to Image (${referenceImages.length} references)`
                      : 'Text to Image'}
                  </h3>
                  <button
                    onClick={resetApp}
                    className="text-xs text-slate-500 hover:text-white transition-colors"
                  >
                    Start Over
                  </button>
                </div>
              )}

              {activeTab === 'edit' && originalImage && (
                <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800 backdrop-blur-sm">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <ImageIcon className="w-4 h-4" /> Original Source
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={triggerReplaceOriginal}
                        className="text-xs bg-slate-800 hover:bg-slate-700 text-brand-300 px-3 py-1 rounded-lg border border-slate-700 transition-colors flex items-center gap-1"
                      >
                        <Replace className="w-3 h-3" /> Replace
                      </button>
                      <button
                        onClick={resetApp}
                        className="text-xs text-slate-500 hover:text-red-400 transition-colors flex items-center gap-1 px-2"
                      >
                        <RefreshCw className="w-3 h-3" /> Reset
                      </button>
                    </div>
                  </div>
                  <div className="relative aspect-video rounded-lg overflow-hidden bg-slate-950 border border-slate-800/50 flex items-center justify-center group">
                    <img
                      src={originalImage.url}
                      alt="Original"
                      className="max-h-full max-w-full object-contain"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none"></div>
                  </div>
                </div>
              )}

              <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl">
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-slate-300">
                    {activeTab === 'edit' || referenceImages.length > 0
                      ? 'Context & Prompt'
                      : 'Refine your prompt'}
                  </label>

                  <div className="flex bg-slate-950 rounded-lg p-0.5 border border-slate-700">
                    <button
                      onClick={() => setOutputMode('image')}
                      className={`px-3 py-1 rounded-md text-xs flex items-center gap-1.5 transition-colors ${outputMode === 'image'
                        ? 'bg-slate-800 text-white shadow-sm font-medium'
                        : 'text-slate-500 hover:text-slate-300'
                        }`}
                      title="Generate Raster Image (PNG)"
                    >
                      <Palette className="w-3.5 h-3.5" /> Image
                    </button>
                    <button
                      onClick={() => setOutputMode('svg')}
                      className={`px-3 py-1 rounded-md text-xs flex items-center gap-1.5 transition-colors ${outputMode === 'svg'
                        ? 'bg-slate-800 text-white shadow-sm font-medium'
                        : 'text-slate-500 hover:text-slate-300'
                        }`}
                      title="Generate SVG Code"
                    >
                      <Code className="w-3.5 h-3.5" /> SVG/Code
                    </button>
                  </div>

                </div>

                <div className="relative">
                  {activeTab === 'generate' && referenceImages.length > 0 && (
                    <div className="flex gap-2 p-2 absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-slate-900/90 to-transparent">
                      {referenceImages.map((img) => (
                        <div
                          key={img.id}
                          className="relative rounded-md overflow-hidden border border-slate-700 shadow-lg bg-slate-950 w-16 h-16 flex-shrink-0"
                        >
                          <img
                            src={img.url}
                            alt="Reference"
                            className="w-full h-full object-cover opacity-80"
                          />
                          <button
                            onClick={(e) => removeReferenceImage(img.id, e)}
                            className="absolute top-0.5 right-0.5 bg-slate-900/80 hover:bg-red-500/80 text-white p-0.5 rounded-full transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      {referenceImages.length < 3 && (
                        <button
                          onClick={() => attachmentInputRef.current?.click()}
                          className="w-16 h-16 rounded-md border border-dashed border-slate-700 bg-slate-800/30 hover:bg-slate-800 flex flex-col items-center justify-center text-slate-500 hover:text-brand-300 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}

                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={
                      outputMode === 'svg'
                        ? "E.g., 'Create a minimalist SVG logo for Road Runner...'"
                        : 'Describe your image...'
                    }
                    className={`w-full bg-slate-950 border border-slate-700 rounded-xl p-4 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50 resize-none h-40 transition-shadow ${referenceImages.length > 0 && activeTab === 'generate'
                      ? 'pt-20'
                      : ''
                      }`}
                    disabled={appState === AppState.PROCESSING}
                  />

                  <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 mt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {activeTab === 'generate' &&
                        referenceImages.length === 0 && (
                          <button
                            onClick={() => attachmentInputRef.current?.click()}
                            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-brand-400 transition-colors bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700/50"
                            title="Attach image"
                          >
                            <Paperclip className="w-3 h-3" />
                            <span>Attach (0/3)</span>
                          </button>
                        )}
                      {activeTab === 'generate' &&
                        referenceImages.length > 0 && (
                          <span className="text-xs text-slate-500 bg-slate-800/30 px-3 py-1.5 rounded-lg">
                            {referenceImages.length}/3 attached
                          </span>
                        )}
                      {needsTranslation && (
                        <button
                          onClick={handleTranslate}
                          disabled={isTranslating}
                          className="flex items-center gap-1.5 text-xs bg-brand-600/10 hover:bg-brand-600/20 text-brand-400 px-3 py-1.5 rounded-lg transition-colors border border-brand-500/20 animate-in fade-in zoom-in duration-300"
                          title="Translate to English"
                        >
                          <Languages className="w-3 h-3" />
                          {isTranslating ? '...' : 'Translate'}
                        </button>
                      )}
                    </div>

                    <button
                      onClick={handleGenerate}
                      disabled={!prompt.trim() || appState === AppState.PROCESSING}
                      className={`
                        flex items-center justify-center gap-2 px-8 py-2.5 rounded-xl font-semibold transition-all
                        ${!prompt.trim() || appState === AppState.PROCESSING
                          ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          : 'bg-brand-600 text-white hover:bg-brand-500 shadow-lg shadow-brand-500/20 hover:shadow-brand-500/40 active:scale-95'
                        }
                      `}
                    >
                      {appState === AppState.PROCESSING
                        ? 'Processing...'
                        : 'Generate'}
                      {appState !== AppState.PROCESSING && (
                        <Wand2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-xs text-slate-500 mb-2">
                    Try these prompts:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {suggestedPrompts.map((suggestion, idx) => (
                      <button
                        key={idx}
                        onClick={() => setPrompt(suggestion)}
                        disabled={appState === AppState.PROCESSING}
                        className="text-xs px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-brand-300 border border-slate-700 transition-colors text-left"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>

                {errorMsg && (
                  <div className="mt-4 p-3 bg-red-900/20 border border-red-900/50 rounded-lg flex items-start gap-2 text-red-200 text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <p>{errorMsg}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="relative h-full min-h-[400px]">
              <div className="hidden lg:flex absolute -left-12 top-1/2 -translate-y-1/2 justify-center w-8 z-10 opacity-30">
                <ChevronRight className="w-8 h-8 text-slate-500" />
              </div>

              <div className="h-full bg-gradient-to-b from-slate-900 to-slate-900/50 p-6 rounded-2xl border border-slate-800 flex flex-col shadow-2xl relative overflow-hidden">
                <div className="flex justify-between items-center mb-4 relative z-10">
                  <h3 className="text-sm font-semibold text-brand-400 uppercase tracking-wider flex items-center gap-2">
                    <Sparkles className="w-4 h-4" /> Generated Result
                  </h3>

                  {generatedImage && (
                    <button
                      onClick={handleDownload}
                      className="text-xs bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded-lg border border-slate-700 transition-colors flex items-center gap-2"
                    >
                      <Download className="w-3 h-3" /> Download PNG
                    </button>
                  )}
                  {generatedText && (
                    <div className="flex items-center gap-2">
                      {svgContent && (
                        <button
                          onClick={handleDownload}
                          className="text-xs bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded-lg border border-slate-700 transition-colors flex items-center gap-2"
                        >
                          <Download className="w-3 h-3" /> Download SVG
                        </button>
                      )}
                      <button
                        onClick={handleCopyText}
                        className="text-xs bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded-lg border border-slate-700 transition-colors flex items-center gap-2"
                      >
                        {copied ? (
                          <Check className="w-3 h-3 text-green-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        {copied ? 'Copied' : 'Copy Text'}
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex-1 rounded-xl bg-slate-950 border-2 border-dashed border-slate-800 flex flex-col items-center justify-center relative overflow-hidden">
                  {appState === AppState.PROCESSING && <LoadingOverlay />}

                  {generatedImage && (
                    <img
                      src={generatedImage}
                      alt="Generated Result"
                      className="max-h-full max-w-full object-contain animate-in fade-in duration-700"
                    />
                  )}

                  {generatedText && (
                    <div className="w-full h-full flex flex-col">
                      {svgContent && (
                        <div className="flex border-b border-slate-800 bg-slate-900/50">
                          <button
                            onClick={() => setViewMode('preview')}
                            className={`px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1.5 ${viewMode === 'preview'
                              ? 'text-brand-400 border-b-2 border-brand-500 bg-slate-800/50'
                              : 'text-slate-500 hover:text-slate-300'
                              }`}
                          >
                            <Eye className="w-3.5 h-3.5" /> Preview
                          </button>
                          <button
                            onClick={() => setViewMode('code')}
                            className={`px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1.5 ${viewMode === 'code'
                              ? 'text-brand-400 border-b-2 border-brand-500 bg-slate-800/50'
                              : 'text-slate-500 hover:text-slate-300'
                              }`}
                          >
                            <Code className="w-3.5 h-3.5" /> Code
                          </button>
                        </div>
                      )}

                      <div className="flex-1 overflow-auto p-4 custom-scrollbar relative">
                        {svgContent && viewMode === 'preview' ? (
                          <div
                            className="w-full h-full flex items-center justify-center min-h-[300px]"
                            dangerouslySetInnerHTML={{ __html: svgContent }}
                          />
                        ) : (
                          <pre className="text-xs sm:text-sm font-mono text-slate-300 whitespace-pre-wrap break-all">
                            {generatedText}
                          </pre>
                        )}
                      </div>
                    </div>
                  )}

                  {!generatedImage && !generatedText && !appState && (
                    <div className="text-center p-6 opacity-40">
                      <Wand2 className="w-16 h-16 mx-auto mb-4 text-slate-600" />
                      <p className="text-slate-500">
                        Your masterpiece will appear here
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="w-full py-6 mt-12 border-t border-slate-900 text-center">
        <p className="text-slate-600 text-sm">
          &copy; {new Date().getFullYear()} Road Runner Studio. Powered by
          Google Gemini.
        </p>
        <p className="mt-1 text-slate-600 text-xs">
          &copy; Created by @FDTiger777
        </p>
      </footer>

      {/* File inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => handleFileChange(e, false)}
        accept="image/*"
        className="hidden"
      />
      <input
        type="file"
        ref={attachmentInputRef}
        onChange={(e) => handleFileChange(e, true)}
        accept="image/*"
        className="hidden"
      />

      {/* API key modal */}
      {apiKeyModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="w-full max-w-md bg-slate-900 rounded-3xl border border-slate-700 shadow-2xl p-0 overflow-hidden relative animate-in zoom-in-95 duration-300">
            {/* Header / Tabs */}
            <div className="flex border-b border-slate-800">
              <button
                onClick={() => setModalTab('gemini')}
                className={`flex-1 py-4 text-sm font-semibold transition-all flex items-center justify-center gap-2 ${modalTab === 'gemini'
                  ? 'bg-brand-500/10 text-brand-400 border-b-2 border-brand-500'
                  : 'text-slate-500 hover:text-slate-300'
                  }`}
              >
                <Zap className="w-4 h-4" />
                Gemini API
              </button>
              <button
                onClick={() => setModalTab('hf')}
                className={`flex-1 py-4 text-sm font-semibold transition-all flex items-center justify-center gap-2 ${modalTab === 'hf'
                  ? 'bg-brand-500/10 text-brand-400 border-b-2 border-brand-500'
                  : 'text-slate-500 hover:text-slate-300'
                  }`}
              >
                <ImageIcon className="w-4 h-4" />
                Hugging Face
              </button>
            </div>

            <button
              onClick={() => setApiKeyModalOpen(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 z-10 p-1 rounded-full hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-8">
              {modalTab === 'gemini' ? (
                <div className="animate-in slide-in-from-left-4 duration-300">
                  <h2 className="text-xl font-bold text-white mb-2">
                    Gemini AI Model
                  </h2>
                  <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                    Used for SVG generation, code analysis, and prompt enhancement.
                    Get yours at{' '}
                    <a
                      href="https://aistudio.google.com/api-keys"
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-400 hover:text-brand-300 underline font-medium"
                    >
                      aistudio.google.com
                    </a>
                  </p>

                  <div className="space-y-4">
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <KeyRound className="h-4 w-4 text-slate-600" />
                      </div>
                      <input
                        type="password"
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder="AIzaSy..."
                        className="w-full bg-slate-950 border border-slate-700/50 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/50 transition-all font-mono"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="animate-in slide-in-from-right-4 duration-300">
                  <h2 className="text-xl font-bold text-white mb-2">
                    Hugging Face (Flux)
                  </h2>
                  <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                    Used for high-quality image generation (FLUX.1).
                    Create a token (Role: Read) at{' '}
                    <a
                      href="https://huggingface.co/settings/tokens"
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-400 hover:text-brand-300 underline font-medium"
                    >
                      huggingface.co/settings/tokens
                    </a>
                  </p>

                  <div className="space-y-4">
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <KeyRound className="h-4 w-4 text-slate-600" />
                      </div>
                      <input
                        type="password"
                        value={hfKeyInput}
                        onChange={(e) => setHfKeyInput(e.target.value)}
                        placeholder="hf_..."
                        className="w-full bg-slate-950 border border-slate-700/50 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/50 transition-all font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-8 flex flex-col gap-3">
                <button
                  onClick={handleSaveApiKey}
                  disabled={(modalTab === 'gemini' ? !apiKeyInput.trim() : !hfKeyInput.trim())}
                  className={`
                    w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98]
                    ${(modalTab === 'gemini' ? apiKeyInput.trim() : hfKeyInput.trim())
                      ? 'bg-brand-600 text-white hover:bg-brand-500 shadow-lg shadow-brand-500/20'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    }
                  `}
                >
                  {(modalTab === 'gemini' ? apiKeySaved : hfKeySaved) ? (
                    <>
                      <Check className="w-5 h-5 text-green-400" />
                      Saved Successfully
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 opacity-70" />
                      Save Settings
                    </>
                  )}
                </button>

                <button
                  onClick={() => setApiKeyModalOpen(false)}
                  className="w-full py-3 text-xs text-slate-500 hover:text-slate-300 font-medium transition-colors"
                >
                  Close & Continue
                </button>
              </div>
            </div>

            <div className="bg-slate-950/50 border-t border-slate-800 px-8 py-4 flex items-start gap-3">
              <div className="mt-0.5 p-1 bg-blue-500/10 rounded-md">
                <AlertCircle className="w-3.5 h-3.5 text-blue-400" />
              </div>
              <p className="text-[10px] text-slate-500 leading-normal">
                Keys are stored securely in your browser's local storage and never leave your device except for API calls to the official models.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
