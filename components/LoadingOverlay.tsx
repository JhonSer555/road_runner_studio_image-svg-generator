import React from 'react';
import { Loader2 } from 'lucide-react';

const LoadingOverlay: React.FC = () => {
  return (
    <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center z-10 rounded-xl">
      <Loader2 className="w-12 h-12 text-brand-500 animate-spin mb-4" />
      <p className="text-brand-200 font-medium animate-pulse">Processing with Nano Banana...</p>
    </div>
  );
};

export default LoadingOverlay;
