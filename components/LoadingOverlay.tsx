import React from 'react';
import { Loader2, ImageIcon, Video, Code, Zap, Sparkles } from 'lucide-react';

interface LoadingOverlayProps {
  outputMode?: 'image' | 'video' | 'svg';
  modelProvider?: string;
}

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ 
  outputMode = 'image', 
  modelProvider = 'gemini_flux' 
}) => {
  const getGenerationInfo = () => {
    switch (outputMode) {
      case 'image':
        return {
          icon: <ImageIcon className="w-5 h-5" />,
          text: 'Generating Image',
          gradient: 'from-blue-500 to-purple-500'
        };
      case 'video':
        return {
          icon: <Video className="w-5 h-5" />,
          text: 'Generating Video',
          gradient: 'from-purple-500 to-pink-500'
        };
      case 'svg':
        return {
          icon: <Code className="w-5 h-5" />,
          text: 'Generating SVG',
          gradient: 'from-green-500 to-emerald-500'
        };
      default:
        return {
          icon: <Sparkles className="w-5 h-5" />,
          text: 'Processing',
          gradient: 'from-brand-500 to-brand-600'
        };
    }
  };

  const getProviderBadge = () => {
    const providerColors = {
      'gemini_flux': 'from-blue-500/20 to-blue-600/20 text-blue-300 border-blue-500/30',
      'huggingface': 'from-orange-500/20 to-orange-600/20 text-orange-300 border-orange-500/30',
      'aihubmix': 'from-pink-500/20 to-pink-600/20 text-pink-300 border-pink-500/30'
    };

    return (
      <div className={`px-3 py-1 rounded-full text-xs font-medium border ${providerColors[modelProvider as keyof typeof providerColors] || providerColors.gemini_flux}`}>
        {modelProvider}
      </div>
    );
  };

  const generationInfo = getGenerationInfo();

  return (
    <div className="absolute inset-0 bg-gradient-to-br from-slate-900/95 via-slate-800/95 to-slate-900/95 backdrop-blur-md flex flex-col items-center justify-center z-50 rounded-2xl border border-slate-700/50">
      <div className="relative">
        <div className={`absolute inset-0 bg-gradient-to-r ${generationInfo.gradient} rounded-full blur-xl opacity-50 animate-pulse`}></div>
        <div className="relative bg-slate-900 p-6 rounded-full border border-slate-700">
          <Loader2 className={`w-16 h-16 bg-gradient-to-r ${generationInfo.gradient} bg-clip-text text-transparent animate-spin`} />
        </div>
      </div>
      
      <div className="mt-8 text-center">
        <div className="flex items-center gap-3 justify-center mb-3">
          <div className={`p-2 rounded-lg bg-gradient-to-r ${generationInfo.gradient} bg-opacity-20 border border-opacity-30 border border-current`}>
            {generationInfo.icon}
          </div>
          <h3 className={`text-2xl font-bold bg-gradient-to-r ${generationInfo.gradient} bg-clip-text text-transparent`}>
            {generationInfo.text}
          </h3>
        </div>
        
        <div className="flex items-center gap-3 justify-center mb-6">
          {getProviderBadge()}
          <div className="text-slate-400 text-sm">with {outputMode === 'image' ? 'AI' : outputMode === 'video' ? 'Video AI' : 'Code AI'}</div>
        </div>
        
        <div className="w-64 h-2 bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full bg-gradient-to-r ${generationInfo.gradient} animate-pulse`}></div>
        </div>
        
        <p className="text-slate-400 text-sm mt-4 animate-pulse">
          {outputMode === 'image' ? 'Creating amazing visuals...' : 
           outputMode === 'video' ? 'Rendering video frames...' : 
           'Generating vector code...'}
        </p>
      </div>
    </div>
  );
};

export default LoadingOverlay;
