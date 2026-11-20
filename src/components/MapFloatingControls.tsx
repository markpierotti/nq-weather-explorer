import { Plus, Minus, Crosshair, Layers, Search } from 'lucide-react';
import { useMap } from '@vis.gl/react-google-maps';
import { useAppData } from '../state/AppDataContext';

interface MapFloatingControlsProps {
  onLocateUser: () => void;
  isLocating?: boolean;
}

const btn =
  'w-11 h-11 rounded-xl bg-[#2c2c2e]/90 border border-white/10 backdrop-blur-md flex items-center justify-center transition-colors active:scale-95 cursor-pointer shadow-lg shadow-black/40';

/**
 * Single vertical control stack, top-right: search, locate, layers (+ zoom on desktop).
 * On mobile it sits below the top safe area and is hidden while the sheet is fully open.
 */
export function MapFloatingControls({ onLocateUser, isLocating }: MapFloatingControlsProps) {
  const map = useMap();
  const { isDesktop, sheetSnap, onOpenSearch, isLayersMenuOpen, onSetLayersMenuOpen } = useAppData();
  const hidden = !isDesktop && sheetSnap === 'full';

  const zoomBy = (delta: number) => {
    if (!map) return;
    map.setZoom(Math.max(1, (map.getZoom() || 5) + delta));
  };

  return (
    <div
      className={`absolute z-20 flex flex-col gap-2 select-none transition-opacity duration-200 ${
        isDesktop ? 'top-6 right-6' : 'right-3'
      } ${hidden ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'}`}
      style={isDesktop ? undefined : { top: 'calc(env(safe-area-inset-top) + 12px)' }}
      aria-hidden={hidden}
      inert={hidden}
    >
      <button
        id="btn-map-search"
        type="button"
        onClick={onOpenSearch}
        className={`${btn} text-white/90 hover:bg-[#3a3a3c] hover:text-white`}
        title="Search for a place"
        aria-label="Search for a place"
      >
        <Search className="w-5 h-5" />
      </button>

      <button
        id="btn-locate-user"
        type="button"
        onClick={onLocateUser}
        className={`${btn} ${isLocating ? 'text-[#32ADE6]' : 'text-white/90 hover:bg-[#3a3a3c] hover:text-white'}`}
        title="Find My Location"
        aria-label="Find My Location"
      >
        <Crosshair className={`w-5 h-5 ${isLocating ? 'animate-spin' : ''}`} />
      </button>

      <button
        id="btn-map-layers"
        type="button"
        data-layers-toggle
        onClick={() => onSetLayersMenuOpen(!isLayersMenuOpen)}
        className={`${btn} ${
          isLayersMenuOpen ? 'text-white bg-[#32ADE6]/80 border-[#32ADE6]' : 'text-[#32ADE6] hover:bg-[#3a3a3c] hover:text-white'
        }`}
        title="Map layers"
        aria-label="Map layers"
        aria-expanded={isLayersMenuOpen}
      >
        <Layers className="w-5 h-5" />
      </button>

      {/* Zoom: desktop only (pinch-zoom on touch devices). */}
      {isDesktop && (
        <div className="flex flex-col bg-[#2c2c2e]/90 border border-white/10 rounded-xl backdrop-blur-md overflow-hidden shadow-lg shadow-black/40 mt-1">
          <button
            id="btn-zoom-in"
            type="button"
            onClick={() => zoomBy(1)}
            className="w-11 h-11 text-white/90 hover:bg-[#3a3a3c] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Zoom In"
            aria-label="Zoom In"
          >
            <Plus className="w-4 h-4" />
          </button>
          <div className="h-px bg-white/10" />
          <button
            id="btn-zoom-out"
            type="button"
            onClick={() => zoomBy(-1)}
            className="w-11 h-11 text-white/90 hover:bg-[#3a3a3c] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Zoom Out"
            aria-label="Zoom Out"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
