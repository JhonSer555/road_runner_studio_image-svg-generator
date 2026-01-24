import { Sparkles, Zap, KeyRound, Eye } from 'lucide-react';

type HeaderProps = {
  onChangeApiKey?: () => void;
};

const Header: React.FC<HeaderProps> = ({ onChangeApiKey }) => {
  return (
    <header className="w-full py-4 px-3 sm:py-6 sm:px-8 flex items-center justify-between border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <div className="p-2 bg-brand-500/10 rounded-lg border border-brand-500/20">
          <Zap className="w-5 h-5 sm:w-6 sm:h-6 text-brand-400" />
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
            Road Runner <span className="text-slate-500 font-light hidden xs:inline">Studio</span>
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <a
          href="https://roadrunner-sigma.vercel.app"
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 text-slate-400 hover:text-white transition-colors flex items-center gap-1.5"
          title="Main Site"
        >
          <Eye className="w-4 h-4" />
          <span className="text-xs font-medium hidden md:block">Main Site</span>
        </a>

        {onChangeApiKey && (
          <button
            onClick={onChangeApiKey}
            className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-brand-300 bg-slate-800 p-2 sm:px-3 sm:py-1.5 rounded-lg border border-slate-700 transition-colors"
            title="Change API Key"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span className="hidden md:block">Change API key</span>
          </button>
        )}

        <div className="px-2 py-1 sm:px-3 sm:py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-[10px] sm:text-xs font-medium text-brand-300 flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          <span className="hidden xs:block">Gemini 2.5 Flash</span>
          <span className="xs:hidden">2.5 F</span>
        </div>
      </div>
    </header>
  );
};

export default Header;

