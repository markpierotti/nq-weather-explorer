import { Plus, Minus, Crosshair, Map as MapIcon, Globe, Layers } from 'lucide-react';
import { useMap } from '@vis.gl/react-google-maps';

interface MapFloatingControlsProps {
  mapTypeId: string;
  onChangeMapType: (type: 'roadmap' | 'satellite' | 'hybrid' | 'terrain') => void;
  onLocateUser: () => void;
  isLocating?: boolean;
}

export function MapFloatingControls({
  mapTypeId,
  onChangeMapType,
  onLocateUser,
  isLocating,
}: MapFloatingControlsProps) {
  const map = useMap();

  const handleZoomIn = () => {
    if (!map) return;
    const current = map.getZoom() || 5;
    map.setZoom(current + 1);
  };

  const handleZoomOut = () => {
    if (!map) return;
    const current = map.getZoom() || 5;
    map.setZoom(Math.max(1, current - 1));
  };

  const mapModes: Array<{
    id: 'roadmap' | 'satellite' | 'terrain';
    label: string;
    nextType: 'roadmap' | 'satellite' | 'terrain';
    nextLabel: string;
    icon: typeof MapIcon;
  }> = [
    { id: 'roadmap', label: 'Dark Map', nextType: 'satellite', nextLabel: 'Satellite', icon: MapIcon },
    { id: 'satellite', label: 'Satellite', nextType: 'terrain', nextLabel: 'Terrain', icon: Globe },
    { id: 'terrain', label: 'Terrain', nextType: 'roadmap', nextLabel: 'Dark Map', icon: Layers },
  ];

  const currentMode = mapModes.find((m) => m.id === mapTypeId) || mapModes[0];
  const CurrentIcon = currentMode.icon;

  const handleToggleMapType = () => {
    onChangeMapType(currentMode.nextType);
  };

  return (
    <div className="absolute top-6 right-6 z-20 flex flex-col gap-2 pointer-events-auto select-none">
      {/* Map Style & Geolocation */}
      <div className="flex flex-col gap-1.5">
        <button
          id="btn-map-type-toggle"
          type="button"
          onClick={handleToggleMapType}
          className="w-11 h-11 rounded-xl bg-[#2c2c2e]/90 border border-white/10 backdrop-blur-md text-[#32ADE6] hover:bg-[#3a3a3c] hover:text-white flex items-center justify-center transition-colors active:scale-95 cursor-pointer shadow-lg shadow-black/40"
          title={`Map View: ${currentMode.label} (Click to switch to ${currentMode.nextLabel})`}
          aria-label={`Current map style is ${currentMode.label}. Click to switch to ${currentMode.nextLabel}`}
        >
          <CurrentIcon className="w-5 h-5" />
        </button>

        <button
          id="btn-locate-user"
          type="button"
          onClick={onLocateUser}
          className={`w-11 h-11 rounded-xl bg-[#2c2c2e]/90 border border-white/10 backdrop-blur-md flex items-center justify-center transition-colors active:scale-95 cursor-pointer shadow-lg shadow-black/40 ${
            isLocating ? 'animate-spin text-[#32ADE6]' : 'text-white/90 hover:bg-[#3a3a3c] hover:text-white'
          }`}
          title="Find My Location"
          aria-label="Find My Location"
        >
          <Crosshair className="w-5 h-5" />
        </button>
      </div>

      {/* Zoom Controls */}
      <div className="flex flex-col bg-[#2c2c2e]/90 border border-white/10 rounded-xl backdrop-blur-md overflow-hidden shadow-lg shadow-black/40 mt-1">
        <button
          id="btn-zoom-in"
          type="button"
          onClick={handleZoomIn}
          className="w-11 h-10 text-white/90 hover:bg-[#3a3a3c] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          title="Zoom In"
          aria-label="Zoom In"
        >
          <Plus className="w-4 h-4" />
        </button>
        <div className="h-px bg-white/10" />
        <button
          id="btn-zoom-out"
          type="button"
          onClick={handleZoomOut}
          className="w-11 h-10 text-white/90 hover:bg-[#3a3a3c] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          title="Zoom Out"
          aria-label="Zoom Out"
        >
          <Minus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
