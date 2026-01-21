import React from 'react';
import { Sparkles, Zap } from 'lucide-react';

const Header: React.FC = () => {
  return (
    <header className="w-full py-6 px-4 sm:px-8 flex items-center justify-between border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <div className="p-2 bg-brand-500/10 rounded-lg border border-brand-500/20">
          <Zap className="w-6 h-6 text-brand-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Road Runner <span className="text-slate-500 font-light">Studio</span></h1>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <a 
          href="https://roadrunner-sigma.vercel.app" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-sm text-slate-400 hover:text-white transition-colors hidden sm:block"
        >
          Main Site
        </a>
        <div className="px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs font-medium text-brand-300 flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          Gemini 2.5 Flash
        </div>
      </div>
    </header>
  );
};

export default Header;
